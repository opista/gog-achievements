import { expect, test } from 'vitest';
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
  const snapshot = join(folder, 'private snapshot.json');
  const script = join(folder, 'fake-cli.mjs');
  await writeFile(script, 'setTimeout(() => {}, 30000);');
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
});
