import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CliClient,
  CLI_READ_TIMEOUTS,
  commandArgs,
  parseOutcome,
  cleanEnvironment,
  resolveCli,
  requireSuccess,
  type CliCommand,
} from '../../src/main/cli-client';
import { publicError } from '../../src/main/errors';
import { CliRuntime } from '../../src/main/application/cli-runtime';
import { OperationCoordinator } from '../../src/main/application/operation-coordinator';
import { CLI_VERSION } from '../../src/shared/cli-release';

describe('CLI command contract', () => {
  test('CSV export keeps paths, IDs and filters as separate arguments', () => {
    expect(
      commandArgs({
        kind: 'achievements-export',
        gameId: '90071992547409931',
        file: '/selected folder/export.csv',
        search: 'A, "name"',
        status: 'locked',
      }),
    ).toEqual([
      'achievements',
      'export',
      '--game',
      '90071992547409931',
      '--file',
      '/selected folder/export.csv',
      '--search',
      'A, "name"',
      '--status',
      'locked',
      '--json',
    ]);
  });
  test('only explicit apply adds --yes and all commands request JSON', () => {
    const commands: CliCommand[] = [
      { kind: 'help' },
      { kind: 'doctor' },
      { kind: 'auth-login' },
      { kind: 'auth-status' },
      { kind: 'auth-logout' },
      { kind: 'games' },
      { kind: 'achievements', gameId: '123' },
      {
        kind: 'queue-create',
        gameId: '123',
        file: '/private queue/file.json',
        achievementIds: ['18446744073709551615', '42'],
      },
      { kind: 'queue-add', file: '/q', achievementIds: ['42'] },
      { kind: 'queue-remove', file: '/q', achievementIds: ['42'] },
      { kind: 'queue-date', file: '/q', achievementIds: ['42'], timestamp: '2020-01-01T00:00:00Z' },
      { kind: 'queue-show', file: '/q' },
      { kind: 'queue-preview', file: '/q' },
      { kind: 'queue-apply', file: '/q' },
    ];
    for (const command of commands) {
      const args = commandArgs(command);
      expect(args.at(-1)).toBe('--json');
      expect(args.includes('--yes')).toBe(command.kind === 'queue-apply');
    }
    expect(commandArgs(commands[7]!)).toContain('/private queue/file.json');
    expect(commandArgs(commands[7]!)).toContain('18446744073709551615');
    expect(commandArgs({ kind: 'queue-preview', file: '/q' })).toEqual([
      'queue',
      'apply',
      '--file',
      '/q',
      '--dry-run',
      '--json',
    ]);
  });
  test('partial JSON remains available on nonzero exit; unknown diagnostics are sanitized', () => {
    const outcome = parseOutcome(
      JSON.stringify({
        ok: false,
        error: {
          code: 'APPLY_INCOMPLETE',
          message: 'secret',
          details: { report: { complete: false } },
        },
      }),
      6,
    );
    expect(outcome.result.ok).toBe(false);
    expect(() => requireSuccess(outcome)).toThrow('Results need attention');
    expect(publicError(new Error('secret'))).not.toHaveProperty('message', 'secret');
    expect(() => parseOutcome('diagnostic\n{}', 0)).toThrow();
    expect(() => parseOutcome('{"ok":true,"data":{}}', 6)).toThrow();
    expect(() => parseOutcome('{"ok":true,"data":{}}', null)).toThrow();
    expect(() =>
      parseOutcome('{"ok":false,"error":{"code":"AUTH_REQUIRED","message":"x"}}', 0),
    ).toThrow();
  });
  test('lock flags are explicit selections and never authorize writes', () => {
    for (const command of [
      {
        kind: 'queue-create' as const,
        gameId: '123',
        file: '/private queue/file.json',
        achievementIds: ['42'],
        action: 'lock' as const,
      },
      {
        kind: 'queue-add' as const,
        file: '/private queue/file.json',
        achievementIds: ['42'],
        action: 'lock' as const,
      },
    ]) {
      const args = commandArgs(command);
      expect(args.slice(-3)).toEqual(['--action', 'lock', '--json']);
      expect(args).not.toContain('--yes');
    }
    expect(commandArgs({ kind: 'queue-add', file: '/q', achievementIds: ['42'] })).not.toContain(
      '--action',
    );
  });
  test('Node startup injection is removed even with Windows-style casing', () => {
    expect(
      cleanEnvironment({
        NODE_OPTIONS: '--require bad',
        node_path: 'bad',
        PATH: '/safe',
        LANG: 'C',
      }),
    ).toEqual({ PATH: '/safe', LANG: 'C' });
  });
});
test('process adapter drains stderr, handles split and large JSON, and never uses a shell', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gog-fake-cli-'));
  try {
    const script = join(folder, 'fake-cli.mjs');
    await writeFile(
      script,
      'process.stderr.write("private fixture diagnostic");process.stdout.write(JSON.stringify({ok:true,data:{text:"x".repeat(2_000_000)}}));',
    );
    const client = new CliClient('/fixed/bundled/cli', (file, args, options) => {
      expect(file).toBe('/fixed/bundled/cli');
      expect(options.shell).toBe(false);
      expect(options.windowsHide).toBe(true);
      return spawn(process.execPath, [script, ...args], { ...options, stdio: 'pipe' });
    });
    const outcome = await client.run({ kind: 'games' });
    expect((requireSuccess(outcome) as { text: string }).text.length).toBe(2_000_000);
    const limited = new CliClient(
      '/fixed/bundled/cli',
      (_file, args, options) =>
        spawn(process.execPath, [script, ...args], { ...options, stdio: 'pipe' }),
      100,
    );
    await expect(limited.run({ kind: 'games' })).rejects.toThrow('capture limit');
    await expect(new CliClient(join(folder, 'missing')).run({ kind: 'help' })).rejects.toThrow(
      'could not start',
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test('resolve bundled CLI by OS, architecture and version without PATH fallback', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gog-cli-resolution-'));
  try {
    const options = {
      packaged: true,
      resourcesPath: folder,
      projectPath: folder,
      platform: 'darwin',
      architecture: 'arm64',
    };
    await mkdir(join(folder, 'cli'));
    await writeFile(
      join(folder, 'cli', 'build.json'),
      JSON.stringify({
        version: CLI_VERSION,
        platform: 'darwin',
        architecture: 'arm64',
        executable: 'gog-achievements',
        layout: 'single_executable',
        runtime_included: true,
        native_helper_included: true,
      }),
    );
    await writeFile(join(folder, 'cli', 'gog-achievements'), 'fixture');
    expect(await resolveCli({ ...options, resourcesPath: folder })).toBe(
      join(folder, 'cli', 'gog-achievements'),
    );
    await expect(
      resolveCli({ ...options, resourcesPath: folder, architecture: 'x64' }),
    ).rejects.toThrow('does not match');
    await expect(
      resolveCli({ ...options, resourcesPath: folder, platform: 'linux' }),
    ).rejects.toThrow('supported');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('an explicit local CLI directory is validated and works only in development', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gog-development-cli-'));
  try {
    const options = {
      packaged: false,
      resourcesPath: '/unused',
      projectPath: '/unused',
      developmentDirectory: folder,
      platform: 'darwin',
      architecture: 'arm64',
    };
    await writeFile(
      join(folder, 'build.json'),
      JSON.stringify({
        version: CLI_VERSION,
        platform: 'darwin',
        architecture: 'arm64',
        layout: 'single_executable',
        runtime_included: true,
        native_helper_included: true,
      }),
    );
    await writeFile(join(folder, 'gog-achievements'), 'fixture');
    expect(await resolveCli(options)).toBe(join(folder, 'gog-achievements'));
    await expect(resolveCli({ ...options, packaged: true })).rejects.toThrow('development mode');
    await expect(
      resolveCli({ ...options, developmentDirectory: 'relative/build' }),
    ).rejects.toThrow('absolute directory');
    await expect(resolveCli({ ...options, version: '0.0.0' })).rejects.toThrow('does not match');
    await expect(resolveCli({ ...options, architecture: 'x64' })).rejects.toThrow('does not match');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

function processFixture(
  source: string,
  timeoutMs = 500,
  outputLimit = 1024 * 1024,
  beforeSpawnReturns?: () => void,
) {
  const children: ChildProcessWithoutNullStreams[] = [];
  const signals: NodeJS.Signals[] = [];
  const closed = new Set<ChildProcessWithoutNullStreams>();
  const client = new CliClient(
    '/fixture/cli',
    (_file, _args, options) => {
      const child = spawn(process.execPath, ['-e', source], { ...options, stdio: 'pipe' });
      children.push(child);
      child.once('close', () => closed.add(child));
      const kill = child.kill.bind(child);
      vi.spyOn(child, 'kill').mockImplementation((signal) => {
        signals.push(signal as NodeJS.Signals);
        return kill(signal);
      });
      beforeSpawnReturns?.();
      return child;
    },
    outputLimit,
    {
      readTimeouts: Object.fromEntries(
        Object.keys(CLI_READ_TIMEOUTS).map((kind) => [kind, timeoutMs]),
      ),
      terminationGraceMs: 200,
    },
  );
  onTestFinished(async () => {
    await Promise.all(
      children
        .filter((child) => !closed.has(child))
        .map(async (child) => {
          const done = once(child, 'close');
          child.kill('SIGKILL');
          await done;
        }),
    );
  });
  return { client, children, signals, closed };
}

test('stuck reads are terminated and only reject after the process closes', async () => {
  const f = processFixture('process.on("SIGTERM", () => {});setInterval(() => {}, 1000);');
  await expect(f.client.run({ kind: 'games' })).rejects.toMatchObject({ code: 'CLI_READ_TIMEOUT' });
  expect(f.children).toHaveLength(1);
  expect(f.closed.has(f.children[0]!)).toBe(true);
  expect(f.signals[0]).toBe('SIGTERM');
  if (process.platform !== 'win32') expect(f.signals).toContain('SIGKILL');
});

test('a pre-cancelled read never spawns and its error exposes no cancellation reason', async () => {
  const spawnProcess = vi.fn(() => {
    throw new Error('Must not spawn');
  });
  const client = new CliClient('/fixture/cli', spawnProcess);
  await expect(
    client.run({ kind: 'games' }, undefined, {
      signal: AbortSignal.abort(new Error('private account diagnostics')),
    }),
  ).rejects.toMatchObject({ code: 'CLI_READ_CANCELLED', message: 'The read was cancelled.' });
  expect(spawnProcess).not.toHaveBeenCalled();
});

test('cancellation inside the spawn adapter is handled before the spawn event', async () => {
  const abort = new AbortController();
  const f = processFixture('setInterval(() => {}, 1000);', 2000, 1024, () => abort.abort());
  const recorded = vi.fn(async () => {});
  await expect(
    f.client.run({ kind: 'games' }, recorded, { signal: abort.signal }),
  ).rejects.toMatchObject({ code: 'CLI_READ_CANCELLED' });
  expect(recorded).toHaveBeenCalledOnce();
  expect(f.closed.has(f.children[0]!)).toBe(true);
  expect(f.signals).toContain('SIGTERM');
});

test('cancellation closes inherited output pipes only after the read child has exited', async () => {
  const f = processFixture(
    `
    const { spawn } = require('node:child_process');
    const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000);'], {
      stdio: ['ignore', 1, 2],
    });
    descendant.unref();
    process.stdout.write(String(descendant.pid), () => process.exit(0));
  `,
    2000,
  );
  const abort = new AbortController();
  const pending = f.client.run({ kind: 'games' }, undefined, { signal: abort.signal });
  const child = f.children[0]!;
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  onTestFinished(() => {
    const pid = Number(output);
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* The descendant may already have exited. */
      }
    }
  });
  await once(child, 'exit');
  expect(child.exitCode).toBe(0);
  expect(Number(output)).toBeGreaterThan(0);
  expect(f.closed.has(child)).toBe(false);
  expect(child.stdout.destroyed).toBe(false);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: 'CLI_READ_CANCELLED' });
  expect(f.closed.has(child)).toBe(true);
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
  expect(f.signals).toEqual([]);
});

test('cancellation during output waits for graceful read exit and discards private output', async () => {
  const f = processFixture(
    `
    process.on('SIGTERM', () => setTimeout(() => process.exit(0), 25));
    process.stdout.write('private incomplete output');
    process.stderr.write('private diagnostic');
    setInterval(() => {}, 1000);
  `,
    2000,
  );
  const abort = new AbortController();
  const remove = vi.spyOn(abort.signal, 'removeEventListener');
  const pending = f.client.run({ kind: 'achievements', gameId: '123' }, undefined, {
    signal: abort.signal,
  });
  f.children[0]!.stdout.once('data', () => abort.abort(new Error('private abort reason')));
  await expect(pending).rejects.toMatchObject({
    code: 'CLI_READ_CANCELLED',
    message: 'The read was cancelled.',
  });
  expect(f.closed.has(f.children[0]!)).toBe(true);
  expect(f.signals).toEqual(['SIGTERM']);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('a read that exceeds its output cap is stopped without waiting for the deadline', async () => {
  const f = processFixture(
    'process.stdout.write("x".repeat(10000));setInterval(() => {}, 1000);',
    5000,
    10,
  );
  await expect(f.client.run({ kind: 'queue-show', file: '/fixture/queue' })).rejects.toMatchObject({
    code: 'CLI_OUTPUT_LIMIT',
  });
  expect(f.closed.has(f.children[0]!)).toBe(true);
  expect(f.signals).toContain('SIGTERM');
});

test('successful reads clear timers and abort listeners without killing the child later', async () => {
  const schedule = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  const f = processFixture(
    'process.stdout.write(JSON.stringify({ok:true,data:"complete"}));',
    2000,
  );
  const abort = new AbortController();
  const remove = vi.spyOn(abort.signal, 'removeEventListener');
  expect(
    requireSuccess(await f.client.run({ kind: 'help' }, undefined, { signal: abort.signal })),
  ).toBe('complete');
  const index = schedule.mock.calls.findIndex((call) => call[1] === 2000);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(clear).toHaveBeenCalledWith(schedule.mock.results[index]!.value);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  abort.abort();
  expect(f.signals).toEqual([]);
});

test('apply ignores read deadlines and cancellation and still awaits its spawn record', async () => {
  const f = processFixture(
    'setTimeout(() => process.stdout.write(JSON.stringify({ok:true,data:"applied"})), 100);',
    10,
  );
  const abort = new AbortController();
  let recorded = false;
  const outcome = f.client.run(
    { kind: 'queue-apply', file: '/fixture/queue' },
    async () => {
      await delay(200);
      recorded = true;
    },
    { signal: abort.signal },
  );
  abort.abort();
  expect(requireSuccess(await outcome)).toBe('applied');
  expect(recorded).toBe(true);
  expect(f.signals).toEqual([]);
});

test('an oversized apply result never causes automatic termination or loses its spawn record', async () => {
  const f = processFixture(
    'process.stdout.write("x".repeat(100));setTimeout(() => process.exit(0), 100);',
    10,
    10,
  );
  const recorded = vi.fn(async () => {});
  await expect(
    f.client.run({ kind: 'queue-apply', file: '/fixture/queue' }, recorded),
  ).rejects.toMatchObject({ code: 'CLI_OUTPUT_LIMIT' });
  expect(recorded).toHaveBeenCalledOnce();
  expect(f.signals).toEqual([]);
  expect(f.closed.has(f.children[0]!)).toBe(true);
});

test('the coordinator stays busy until a timed-out read closes, then accepts the next read', async () => {
  const f = processFixture('process.on("SIGTERM", () => {});setInterval(() => {}, 1000);');
  const coordinator = new OperationCoordinator();
  let closedBeforeIdle = false;
  coordinator.onOperation((state) => {
    if (state.kind === 'idle') closedBeforeIdle = f.closed.has(f.children[0]!);
  });
  const pending = coordinator.run('read', () => f.client.run({ kind: 'games' }));
  expect(coordinator.current.kind).toBe('read');
  await expect(coordinator.run('read', async () => 'overlap')).rejects.toMatchObject({
    code: 'BUSY',
  });
  await expect(pending).rejects.toMatchObject({ code: 'CLI_READ_TIMEOUT' });
  expect(closedBeforeIdle).toBe(true);
  expect(coordinator.current.kind).toBe('idle');
  const next = processFixture('process.stdout.write(JSON.stringify({ok:true,data:"next"}));', 2000);
  expect(
    requireSuccess(await coordinator.run('read', () => next.client.run({ kind: 'games' }))),
  ).toBe('next');
  expect(coordinator.current.kind).toBe('idle');
});

test('CliRuntime forwards cancellation to the active read runner', async () => {
  const runner = {
    run: vi.fn().mockResolvedValue({ exitCode: 0, result: { ok: true, data: null } }),
  };
  const runtime = new CliRuntime(runner);
  const signal = new AbortController().signal;
  await runtime.run({ kind: 'games' }, undefined, { signal });
  expect(runner.run).toHaveBeenCalledWith({ kind: 'games' }, undefined, { signal });
});
