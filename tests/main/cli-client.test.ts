import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CliClient,
  commandArgs,
  parseOutcome,
  cleanEnvironment,
  resolveCli,
  requireSuccess,
  type CliCommand,
} from '../../src/main/cli-client';
import { publicError } from '../../src/main/errors';

describe('CLI command contract', () => {
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
        version: '0.3.0',
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
