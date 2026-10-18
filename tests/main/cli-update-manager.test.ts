import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI_VERSION } from '../../src/shared/cli-release';
import { CliUpdateManager } from '../../src/main/cli-updates/manager';
import { CliCache } from '../../src/main/cli-updates/cache';
import { cliPackage, helpFixture } from './cli-update-fixtures';
import { verifyHelpContract } from '../../src/main/cli-updates/verify';

const roots: string[] = [];
const managers: CliUpdateManager[] = [];
afterEach(async () => {
  managers.splice(0).forEach((manager) => manager.close());
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gog-cli-updates-'));
  roots.push(root);
  let release = cliPackage();
  const latest = vi.fn(async (_target: string, rejected: readonly string[]) =>
    rejected.includes(release.release.version) ? undefined : release.release,
  );
  const download = vi.fn(async () => ({ bytes: release.bytes, sha256: release.sha256 }));
  const verify = vi.fn(async (_executable: string, _version: string) => {});
  const bundled = join(root, 'bundled', 'gog-achievements');
  const resolveBundled = vi.fn(async () => bundled);
  function create(supported = true) {
    const manager = new CliUpdateManager({
      supported,
      userDataPath: root,
      platform: 'darwin',
      architecture: 'arm64',
      resolveBundled,
      client: { latest, download },
      verify,
    });
    managers.push(manager);
    return manager;
  }
  return {
    root,
    create,
    latest,
    download,
    verify,
    bundled,
    resolveBundled,
    cache: new CliCache(root, 'macos-arm64'),
    changeRelease: (version: string) => {
      release = cliPackage(version);
    },
  };
}

test('a download is staged without changing the running CLI and activates only on the next launch', async () => {
  const f = await fixture();
  const first = f.create();
  const selected = await first.prepare();
  expect(selected).toEqual({ executable: f.bundled, version: CLI_VERSION });
  expect(await first.check()).toMatchObject({
    currentVersion: CLI_VERSION,
    status: 'ready',
    pendingVersion: '0.6.0',
  });
  expect(await first.prepare()).toBe(selected);
  first.close();
  f.latest.mockClear();
  const second = f.create();
  expect(await second.prepare()).toMatchObject({ version: '0.6.0' });
  expect(f.latest).not.toHaveBeenCalled();
  expect(second.snapshot()).toMatchObject({ currentVersion: '0.6.0', status: 'idle' });
  expect((await f.cache.load()).staged).toBeNull();
  expect((await f.cache.load()).active?.version).toBe('0.6.0');
});

test('legacy opt-out preferences cannot prevent activation or automatic downloads', async () => {
  const f = await fixture();
  const first = f.create();
  await first.prepare();
  await first.check();
  first.close();
  const path = join(f.root, 'cli-updates', 'macos-arm64', 'state.json');
  await writeFile(
    path,
    JSON.stringify({ ...(await f.cache.load()), automatic: false, preferBundled: true }),
  );
  const second = f.create();
  expect(await second.prepare()).toMatchObject({ version: '0.6.0' });
  expect(JSON.parse(await readFile(path, 'utf8'))).not.toHaveProperty('automatic');
  expect(JSON.parse(await readFile(path, 'utf8'))).not.toHaveProperty('preferBundled');
  f.changeRelease('0.7.0');
  f.latest.mockClear();
  f.download.mockClear();
  expect(await second.check()).toMatchObject({ status: 'ready', pendingVersion: '0.7.0' });
  expect(f.latest).toHaveBeenCalledOnce();
  expect(f.download).toHaveBeenCalledOnce();
});

test('closing the app during a download prevents even a late response from staging', async () => {
  const f = await fixture();
  const packageFixture = cliPackage();
  let finish!: (value: { bytes: Buffer; sha256: string }) => void;
  f.download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const manager = f.create();
  await manager.prepare();
  const check = manager.check();
  await vi.waitFor(() => expect(f.download).toHaveBeenCalledOnce());
  manager.close();
  finish(packageFixture);
  expect(await check).toMatchObject({ currentVersion: CLI_VERSION });
  expect((await f.cache.load()).staged).toBeNull();
  expect(await readdir(join(f.root, 'cli-updates', 'macos-arm64', 'packages'))).toEqual([]);
});

test('concurrent checks share one download and one immutable pending package', async () => {
  const f = await fixture();
  const manager = f.create();
  await manager.prepare();
  await Promise.all([manager.check(), manager.check(), manager.check()]);
  expect(f.latest).toHaveBeenCalledOnce();
  expect(f.download).toHaveBeenCalledOnce();
  expect((await f.cache.load()).staged?.version).toBe('0.6.0');
});

test('a pending package does not hide a later background check or download', async () => {
  const f = await fixture();
  const manager = f.create();
  await manager.check();
  const nextRelease = cliPackage('0.7.0');
  let finishCheck!: (value: typeof nextRelease.release) => void;
  let finishDownload!: (value: { bytes: Buffer; sha256: string }) => void;
  f.latest.mockImplementationOnce(() => new Promise((resolve) => (finishCheck = resolve)));
  f.download.mockImplementationOnce(() => new Promise((resolve) => (finishDownload = resolve)));
  const check = manager.check();
  await vi.waitFor(() => expect(manager.snapshot().status).toBe('checking'));
  expect(manager.snapshot().currentVersion).toBe(CLI_VERSION);
  finishCheck(nextRelease.release);
  await vi.waitFor(() => expect(manager.snapshot().status).toBe('downloading'));
  expect(manager.snapshot().currentVersion).toBe(CLI_VERSION);
  finishDownload(nextRelease);
  expect(await check).toMatchObject({
    currentVersion: CLI_VERSION,
    status: 'ready',
    pendingVersion: '0.7.0',
  });
});

test('damaged staged code is rejected before execution and the bundled CLI still starts', async () => {
  const f = await fixture();
  const first = f.create();
  await first.prepare();
  await first.check();
  first.close();
  const staged = (await f.cache.load()).staged!;
  await writeFile(join(f.cache.directory(staged), 'gog-achievements'), 'damaged');
  f.verify.mockClear();
  const next = f.create();
  expect(await next.prepare()).toEqual({ executable: f.bundled, version: CLI_VERSION });
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(f.bundled, CLI_VERSION);
  expect(next.snapshot().status).toBe('fallback');
  expect((await f.cache.load()).rejected).toContain('0.6.0');
  f.latest.mockClear();
  await next.check();
  expect(f.latest).toHaveBeenCalledWith('macos-arm64', ['0.6.0'], expect.any(AbortSignal));
});

test('a failed new CLI keeps the last working cached version', async () => {
  const f = await fixture();
  const first = f.create();
  await first.prepare();
  await first.check();
  first.close();
  const active = f.create();
  await active.prepare();
  f.changeRelease('0.7.0');
  await active.check();
  active.close();
  f.verify.mockImplementation(async (_executable, version) => {
    if (version === '0.7.0') throw new Error('Contract failed');
  });
  const next = f.create();
  expect(await next.prepare()).toMatchObject({ version: '0.6.0' });
  expect(next.snapshot().status).toBe('fallback');
  expect((await f.cache.load()).rejected).toContain('0.7.0');
});

test('active corruption falls back to the retained previous cache and verifies it again', async () => {
  const f = await fixture();
  const first = f.create();
  await first.prepare();
  await first.check();
  first.close();
  const second = f.create();
  await second.prepare();
  f.changeRelease('0.7.0');
  await second.check();
  second.close();
  const third = f.create();
  expect((await third.prepare())?.version).toBe('0.7.0');
  third.close();
  const state = await f.cache.load();
  expect(state.previous?.version).toBe('0.6.0');
  await writeFile(join(f.cache.directory(state.active!), 'gog-achievements'), 'modified');
  f.verify.mockClear();
  const next = f.create();
  expect((await next.prepare())?.version).toBe('0.6.0');
  expect(f.verify.mock.calls.map(([, version]) => version)).toEqual(['0.6.0']);
});

test('automatic fallback can receive a later fixed release without user settings', async () => {
  const f = await fixture();
  const first = f.create();
  await first.prepare();
  await first.check();
  first.close();
  const staged = (await f.cache.load()).staged!;
  await writeFile(join(f.cache.directory(staged), 'gog-achievements'), 'damaged');
  const fallback = f.create();
  expect((await fallback.prepare())?.version).toBe(CLI_VERSION);
  expect(fallback.snapshot().status).toBe('fallback');
  expect((await f.cache.load()).rejected).toContain('0.6.0');
  f.changeRelease('0.7.0');
  expect(await fallback.check()).toMatchObject({ status: 'ready', pendingVersion: '0.7.0' });
  fallback.close();
  const next = f.create();
  expect((await next.prepare())?.version).toBe('0.7.0');
});

test('a checksum failure never stages unverified bytes or changes the current CLI', async () => {
  const f = await fixture();
  f.download.mockResolvedValueOnce({
    bytes: Buffer.from('corrupt archive'),
    sha256: '0'.repeat(64),
  });
  const manager = f.create();
  await manager.prepare();
  expect(await manager.check()).toMatchObject({
    status: 'unavailable',
    currentVersion: CLI_VERSION,
  });
  expect((await f.cache.load()).staged).toBeNull();
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(f.bundled, CLI_VERSION);
});

test('unknown extra cached files are rejected as well as changes to known files', async () => {
  const f = await fixture();
  const first = f.create();
  await first.prepare();
  await first.check();
  first.close();
  await writeFile(
    join(f.cache.directory((await f.cache.load()).staged!), 'unexpected.dll'),
    'untrusted',
  );
  f.verify.mockClear();
  expect((await f.create().prepare())?.version).toBe(CLI_VERSION);
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(f.bundled, CLI_VERSION);
});

test('corrupt update state recovers with the bundled CLI and resumes automatic updates', async () => {
  const f = await fixture();
  const first = f.create();
  await first.prepare();
  first.close();
  await writeFile(join(f.root, 'cli-updates', 'macos-arm64', 'state.json'), '{interrupted');
  const next = f.create();
  expect((await next.prepare())?.version).toBe(CLI_VERSION);
  expect(next.snapshot()).toMatchObject({ status: 'fallback' });
  expect(await next.check()).toMatchObject({ status: 'ready', pendingVersion: '0.6.0' });
  expect(f.latest).toHaveBeenCalledOnce();
});

test('an unwritable cache keeps the current CLI and retries updates on a later launch', async () => {
  const f = await fixture();
  const blocked = join(f.root, 'cli-updates');
  await writeFile(blocked, 'blocked cache');
  const manager = f.create();
  expect((await manager.prepare())?.version).toBe(CLI_VERSION);
  expect(await manager.check()).toMatchObject({
    status: 'unavailable',
    message: expect.stringContaining('tried again next launch'),
  });
  expect(f.latest).not.toHaveBeenCalled();
  expect(await readFile(blocked, 'utf8')).toBe('blocked cache');
  manager.close();
  await rm(blocked);
  expect(await f.create().check()).toMatchObject({ status: 'ready', pendingVersion: '0.6.0' });
});

test('an incompatible cached major is ignored without executing it', async () => {
  const f = await fixture();
  const packageFixture = cliPackage();
  const record = await f.cache.install(packageFixture.bytes, '0.6.0', packageFixture.sha256);
  const state = await f.cache.load();
  state.active = { ...record, version: '1.0.0' };
  await f.cache.save(state);
  const manager = f.create();
  expect((await manager.prepare())?.version).toBe(CLI_VERSION);
  expect(manager.snapshot()).toMatchObject({ status: 'idle' });
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(f.bundled, CLI_VERSION);
  expect((await f.cache.load()).previous).toBeNull();
});

test('source runs never write update state or start release requests', async () => {
  const f = await fixture();
  const manager = f.create(false);
  await manager.prepare();
  await manager.check();
  expect(manager.snapshot().supported).toBe(false);
  expect(f.latest).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
  expect(await readdir(f.root)).toEqual([]);
});

test('staging does not touch queues or preferences outside the update cache', async () => {
  const f = await fixture();
  const original = Buffer.from('saved queue and original dates');
  await writeFile(join(f.root, 'queue.json'), original);
  const manager = f.create();
  await manager.prepare();
  await manager.check();
  expect(await readFile(join(f.root, 'queue.json'))).toEqual(original);
});

test('offline contract checks reject missing apply safety flags, wrong versions and bad envelopes', () => {
  expect(() => verifyHelpContract(JSON.stringify(helpFixture()), '0.6.0')).not.toThrow();
  const missing = helpFixture();
  missing.data.commands.find((command) => command.command === 'queue apply')!.flags = ['file'];
  for (const help of [
    missing,
    helpFixture('0.7.0'),
    { ok: false, data: {} },
    { ...helpFixture(), data: { ...helpFixture().data, common_flags: [] } },
  ])
    expect(() => verifyHelpContract(JSON.stringify(help), '0.6.0')).toThrow();
});
