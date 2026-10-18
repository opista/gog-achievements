import { expect, test, vi } from 'vitest';
import {
  access,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hashCliFile, sha256 } from '../../src/main/cli-package';
import { CliCache } from '../../src/main/cli-updates/cache';
import { verifyCliContract, type ContractRun } from '../../src/main/cli-updates/verify';
import { cliPackage, helpFixture, writeDownload } from './cli-update-fixtures';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: vi.fn(original.open) };
});

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

test.each(['macos-arm64', 'macos-x64', 'windows-arm64', 'windows-x64'])(
  'disk-backed %s installs use private staging and publish no archive',
  async (target) => {
    const root = await mkdtemp(join(tmpdir(), 'gog-cache-download-'));
    try {
      const cache = new CliCache(root, target);
      const fixture = cliPackage('0.6.0', target);
      let archive = '';
      const record = await cache.installDownload('0.6.0', async (path) => {
        archive = path;
        if (process.platform !== 'win32')
          expect((await lstat(dirname(path))).mode & 0o777).toBe(0o700);
        return writeDownload(path, fixture);
      });
      await expect(cache.verify(record)).resolves.toBe(cache.directory(record));
      expect(record.files.some((file) => file.path.endsWith('.zip'))).toBe(false);
      await expect(access(archive)).rejects.toThrow();
      const again = await cache.installDownload('0.6.0', (path) => writeDownload(path, fixture));
      expect(again).toEqual(record);
      expect(await readdir(join(root, 'cli-updates', target, 'packages'))).toEqual([
        `0.6.0-${fixture.sha256}`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each(['digest', 'corrupt-zip', 'unsafe-entry', 'download', 'abort'])(
  'failed disk install (%s) removes staging before returning and preserves active state',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'gog-cache-failure-'));
    try {
      const cache = new CliCache(root, 'macos-arm64');
      const fixture = cliPackage();
      const active = await cache.install(fixture.bytes, '0.6.0', fixture.sha256);
      await cache.save({ ...(await cache.load()), active });
      const state = await cache.load();
      const controller = new AbortController();
      let archive = '';
      await expect(
        cache.installDownload(
          '0.6.1',
          async (path) => {
            archive = path;
            const next =
              failure === 'unsafe-entry'
                ? cliPackage('0.6.1', 'macos-arm64', [{ name: '../outside', bytes: 'unsafe' }])
                : cliPackage('0.6.1');
            const bytes = failure === 'corrupt-zip' ? Buffer.from('not a ZIP') : next.bytes;
            await writeDownload(path, { bytes, sha256: sha256(bytes) });
            if (failure === 'download') throw new Error('transfer failed');
            if (failure === 'abort') controller.abort(new Error('cancelled'));
            return failure === 'digest' ? '0'.repeat(64) : sha256(bytes);
          },
          controller.signal,
        ),
      ).rejects.toThrow();
      await expect(access(archive)).rejects.toThrow();
      expect(await readdir(join(root, 'cli-updates', 'macos-arm64', 'packages'))).toEqual([
        `0.6.0-${fixture.sha256}`,
      ]);
      expect(await cache.load()).toEqual(state);
      await expect(cache.verify(active)).resolves.toBe(cache.directory(active));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('disk hashing bounds regular files and rejects growth during the read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gog-file-hash-'));
  try {
    const path = join(root, 'file');
    const bytes = Buffer.alloc(128 * 1024, 1);
    await writeFile(path, bytes);
    await expect(hashCliFile(path, bytes.length)).resolves.toEqual({
      sha256: sha256(bytes),
      size: bytes.length,
    });
    await expect(hashCliFile(path, bytes.length - 1)).rejects.toThrow('bounded regular file');
    await expect(hashCliFile(root, bytes.length)).rejects.toThrow('bounded regular file');
    if (process.platform !== 'win32') {
      const link = join(root, 'link');
      await symlink(path, link);
      await expect(hashCliFile(link, bytes.length)).rejects.toThrow('bounded regular file');
    }
    const original = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
      .open;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    const spy = vi.mocked(open).mockImplementationOnce(async (...args) => {
      handle = await original(...args);
      const create = handle.createReadStream.bind(handle);
      vi.spyOn(handle, 'createReadStream').mockImplementationOnce((options) => {
        const stream = create(options);
        stream.once('data', () => appendFileSync(path, Buffer.alloc(64 * 1024)));
        return stream;
      });
      return handle;
    });
    try {
      await expect(hashCliFile(path, bytes.length)).rejects.toThrow('changed');
      expect(handle?.fd).toBe(-1);
    } finally {
      spy.mockRestore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
