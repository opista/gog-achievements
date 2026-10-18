import { expect, test, vi } from 'vitest';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliCache } from '../../src/main/cli-updates/cache';
import { verifyCliContract, type ContractRun } from '../../src/main/cli-updates/verify';
import { cliPackage, helpFixture } from './cli-update-fixtures';

test('the executable probe only reads help and a local mixed-action queue and removes its fixture', async () => {
  const run = vi.fn<ContractRun>(async (_executable, args) => ({
    stderr: '',
    stdout:
      args[0] === '--help'
        ? JSON.stringify(helpFixture())
        : JSON.stringify({ ok: true, data: JSON.parse(await readFile(args[3]!, 'utf8')) }),
  }));
  await verifyCliContract('/verified/cli', '0.6.0', run);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]?.[1]).toEqual(['--help', '--json']);
  expect(run.mock.calls[1]?.[1].slice(0, 3)).toEqual(['queue', 'show', '--file']);
  expect(run.mock.calls[1]?.[1].at(-1)).toBe('--json');
  expect(run.mock.calls[0]?.[2]).toMatchObject({ timeout: 10000, windowsHide: true });
  await expect(access(run.mock.calls[0]![2].cwd)).rejects.toThrow();
});

test('a CLI that drops the original lock date or returns private diagnostics fails the probe', async () => {
  const run = vi.fn<ContractRun>(async (_executable, args) => {
    if (args[0] === '--help') return { stdout: JSON.stringify(helpFixture()), stderr: '' };
    const queue = JSON.parse(await readFile(args[3]!, 'utf8'));
    queue.items[1].previous_unlocked_at = '2020-02-01T12:34:56Z';
    return { stdout: JSON.stringify({ ok: true, data: queue }), stderr: '' };
  });
  await expect(verifyCliContract('/verified/cli', '0.6.0', run)).rejects.toThrow();
  run.mockResolvedValue({
    stdout: JSON.stringify(helpFixture()),
    stderr: 'unexpected diagnostics',
  });
  await expect(verifyCliContract('/verified/cli', '0.6.0', run)).rejects.toThrow();
});

test.each(['macos-arm64', 'macos-x64', 'windows-arm64', 'windows-x64'])(
  'cached %s packages preserve their complete runtime layout',
  async (target) => {
    const root = await mkdtemp(join(tmpdir(), 'gog-cache-layout-'));
    try {
      const cache = new CliCache(root, target);
      const fixture = cliPackage('0.6.0', target);
      const record = await cache.install(fixture.bytes, '0.6.0', fixture.sha256);
      const directory = await cache.verify(record);
      expect(directory.endsWith(join('resources', 'cli'))).toBe(true);
      if (target === 'macos-x64') {
        await writeFile(join(directory, 'native', 'bin', 'gog-login'), 'changed helper');
        await expect(cache.verify(record)).rejects.toThrow('integrity');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'a link replacing a cached helper is never followed',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'gog-cache-link-'));
    try {
      const cache = new CliCache(root, 'macos-x64');
      const fixture = cliPackage('0.6.0', 'macos-x64');
      const record = await cache.install(fixture.bytes, '0.6.0', fixture.sha256);
      const file = join(cache.directory(record), 'native', 'bin', 'gog-login');
      await rm(file);
      await symlink('/outside/helper', file);
      await expect(cache.verify(record)).rejects.toThrow('link');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
