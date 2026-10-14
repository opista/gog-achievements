import { expect, test, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeProcessProbe, parseUnixProcesses } from '../../src/main/process-identity';
test('real multiline ps data keeps complete operation paths and start identities', () => {
  const rows = parseUnixProcesses(
    '  42 Wed Oct 14 15:30:00 2026 /Applications/GOG Achievements.app/Contents/Resources/cli/gog-achievements queue apply --file /Users/demo/private snapshot.json --yes --json\n  99 Wed Oct 14 15:31:00 2026 /bin/unrelated\n',
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]?.pid).toBe(42);
  expect(rows[0]?.startedAt).toBe('Wed Oct 14 15:30:00 2026');
  expect(rows[0]?.command).toContain('/Users/demo/private snapshot.json');
});
test('the native probe finds a real fake child and does not treat identity mismatch as gone', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gog-probe-'));
  const snapshot = join(folder, 'private café 雪 snapshot.json');
  const script = join(folder, 'fake-cli.mjs');
  await writeFile(script, 'setTimeout(() => {}, 60000);');
  const child = spawn(
    process.execPath,
    [script, 'queue', 'apply', '--file', snapshot, '--yes', '--json'],
    { stdio: 'ignore', windowsHide: true },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const probe = new NativeProcessProbe();
    const result = await probe.find(snapshot);
    expect(result.state).toBe('alive');
    if (result.state !== 'alive') throw new Error('Fixture child could not be identified');
    expect(result.identity.pid).toBe(child.pid);
    expect((await probe.find(snapshot, result.identity)).state).toBe('alive');
    expect(
      (await probe.find(snapshot, { ...result.identity, startedAt: 'unrelated start' })).state,
    ).toBe('unknown');
    expect((await probe.find(`${snapshot}.different`, result.identity)).state).toBe('gone');
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('close', () => resolve());
    });
    await rm(folder, { recursive: true, force: true });
  }
}, 45000);

const snapshot = 'C:\\private café 雪 folder\\snapshot.json';
const identity = { pid: 42, startedAt: '/Date(1792000000000)/' };
function windowsRow(overrides: Record<string, unknown> = {}) {
  return {
    ProcessId: identity.pid,
    CreationDate: identity.startedAt,
    CommandLine: 'gog-achievements.exe queue apply --file "' + snapshot + '" --yes --json',
    Name: 'gog-achievements.exe',
    ...overrides,
  };
}
function windowsProbe(stdout: string) {
  const execute = vi.fn(async () => ({ stdout }));
  return { probe: new NativeProcessProbe({ platform: 'win32', execute }), execute };
}

test('Windows queries only the two fixed CLI process names and four properties as UTF-8', async () => {
  const { probe, execute } = windowsProbe('[]');
  const hostileSnapshot = 'snapshot"; Write-Output injected; #.json';
  expect(await probe.find(hostileSnapshot)).toEqual({ state: 'gone' });
  const [file, args, options] = execute.mock.calls[0] as unknown as [
    string,
    string[],
    { timeout: number; maxBuffer: number; windowsHide: boolean },
  ];
  expect(file).toContain('WindowsPowerShell');
  expect(file).toMatch(/powershell\.exe$/);
  expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
  expect(args[3]).toContain("-Filter \"Name = 'gog-achievements.exe' OR Name = 'node.exe'\"");
  expect(args[3]).toContain('-Property ProcessId,CreationDate,CommandLine,Name');
  expect(args[3]).toContain("$ErrorActionPreference = 'Stop'");
  expect(args[3]).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)');
  expect(args[3]).toContain('-ErrorAction Stop');
  expect(args[3]).toContain('$processes = @(');
  expect(args[3]).toContain('ConvertTo-Json -InputObject $processes -Compress');
  expect(args[3]).not.toContain(hostileSnapshot);
  expect(options).toEqual({ timeout: 10000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
});

test.each(['gog-achievements.exe', 'node.exe', 'GOG-ACHIEVEMENTS.EXE'])(
  'Windows finds a visible %s writer and preserves its opaque creation identity',
  async (name) => {
    const { probe } = windowsProbe(JSON.stringify([windowsRow({ Name: name })]));
    expect(await probe.find(snapshot)).toEqual({ state: 'alive', identity });
    expect(await probe.find(snapshot, identity)).toEqual({ state: 'alive', identity });
    expect(await probe.find(snapshot, { ...identity, pid: identity.pid + 1 })).toEqual({
      state: 'unknown',
    });
    expect(await probe.find(snapshot, { ...identity, startedAt: 'reused PID' })).toEqual({
      state: 'unknown',
    });
  },
);

test('a valid empty Windows process array proves the writer is gone', async () => {
  const { probe } = windowsProbe('[]');
  expect(await probe.find(snapshot)).toEqual({ state: 'gone' });
  expect(await probe.find(snapshot, identity)).toEqual({ state: 'gone' });
});

test('complete Windows rows for unrelated commands do not identify an apply writer', async () => {
  for (const CommandLine of [
    'node.exe other-script.mjs',
    'gog-achievements.exe queue show --file "' + snapshot + '" --yes',
    'gog-achievements.exe queue apply --file "' + snapshot + '"',
    'gog-achievements.exe queue apply --file C:\\different.json --yes',
  ]) {
    const { probe } = windowsProbe(JSON.stringify([windowsRow({ CommandLine })]));
    expect(await probe.find(snapshot, identity)).toEqual({ state: 'gone' });
  }
});

test.each(['', '   ', 'null', '{}', '[', '[null]', '[[]]', 'warning\n[]'])(
  'invalid Windows output %j never proves a writer is gone',
  async (stdout) => {
    const { probe } = windowsProbe(stdout);
    expect(await probe.find(snapshot, identity)).toEqual({ state: 'unknown' });
  },
);

test.each([
  { ProcessId: '42' },
  { ProcessId: 0 },
  { ProcessId: 1.5 },
  { CreationDate: null },
  { CreationDate: '' },
  { CreationDate: {} },
  { Name: 'unrelated.exe' },
  { Name: null },
  { CommandLine: 42 },
  { CommandLine: undefined },
])('malformed Windows row %j does not prove absence', async (overrides) => {
  const { probe } = windowsProbe(
    JSON.stringify([windowsRow({ CommandLine: 'node.exe unrelated.mjs' }), windowsRow(overrides)]),
  );
  expect(await probe.find(snapshot + '.different', identity)).toEqual({ state: 'unknown' });
});

test.each(['gog-achievements.exe', 'node.exe'])(
  'Windows treats an obscured %s command as unknown even without a saved identity',
  async (name) => {
    for (const CommandLine of [null, '']) {
      const { probe } = windowsProbe(JSON.stringify([windowsRow({ Name: name, CommandLine })]));
      expect(await probe.find(snapshot)).toEqual({ state: 'unknown' });
      expect(await probe.find(snapshot, identity)).toEqual({ state: 'unknown' });
    }
  },
);

test('a failed Windows process query remains unknown', async () => {
  const execute = vi.fn(async () => {
    throw new Error('PowerShell query failed');
  });
  const probe = new NativeProcessProbe({ platform: 'win32', execute });
  expect(await probe.find(snapshot, identity)).toEqual({ state: 'unknown' });
  expect(execute).toHaveBeenCalledOnce();
});

test('the injected Unix path retains its command and empty-output safety behavior', async () => {
  const execute = vi.fn(async () => ({ stdout: '' }));
  const probe = new NativeProcessProbe({ platform: 'darwin', execute });
  expect(await probe.find(snapshot)).toEqual({ state: 'unknown' });
  expect(execute).toHaveBeenCalledWith(
    '/bin/ps',
    ['-axww', '-o', 'pid=', '-o', 'lstart=', '-o', 'command='],
    { timeout: 3000, maxBuffer: 2 * 1024 * 1024 },
  );
});
