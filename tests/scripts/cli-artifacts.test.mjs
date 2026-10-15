import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ARCHIVE_LIMITS,
  downloadCli,
  extractCliArchive,
  parseTargetArguments,
  selectTarget,
  sha256,
  TARGETS,
  validateReleaseLock,
} from '../../scripts/cli-artifacts.mjs';
import { packageCommands } from '../../scripts/package.mjs';
import { smokeCli } from '../../scripts/smoke-cli.mjs';
import { packageCliPath } from '../../scripts/verify-package.mjs';

const VERSION = '0.3.0';
const rootFolder = (name) => 'gog-achievements-' + VERSION + '-' + name;

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Tiny stored ZIPs exercise the actual reader without another archive dependency.
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name);
    const bytes = Buffer.from(item.bytes ?? 'fixture');
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(item.declaredSize ?? bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(item.declaredSize ?? bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, bytes);
    central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const index = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

function fixture(name = 'macos-arm64', extra = [], metadataOverride = {}) {
  const expected = TARGETS[name];
  const layout =
    name === 'macos-x64' ? 'native_launcher_with_private_runtime' : 'single_executable';
  const prefix = rootFolder(name) + '/';
  const entries = [
    {
      name: prefix + 'build.json',
      bytes: JSON.stringify({
        version: VERSION,
        ...expected,
        layout,
        runtime_included: true,
        native_helper_included: true,
        ...metadataOverride,
      }),
    },
    {
      name: prefix + 'gog-achievements' + (expected.platform === 'win32' ? '.exe' : ''),
      mode: 0o100755,
    },
    { name: prefix + 'LICENSE' },
    { name: prefix + 'THIRD_PARTY_NOTICES.md' },
    { name: prefix + 'licenses/NODE-LICENSE.txt' },
  ];
  if (layout !== 'single_executable')
    entries.push(
      { name: prefix + 'lib/node', mode: 0o100755 },
      { name: prefix + 'lib/main.cjs' },
      { name: prefix + 'native/bin/gog-login', mode: 0o100755 },
    );
  const bytes = zip([...entries, ...extra]);
  const lock = {
    schema_version: 1,
    repository: 'opista/gog-achievements-cli',
    version: VERSION,
    tag: 'v' + VERSION,
    commit: 'a'.repeat(40),
    targets: Object.fromEntries(
      Object.entries(TARGETS).map(([target, settings]) => [
        target,
        {
          ...settings,
          archive: rootFolder(target) + '.zip',
          sha256: target === name ? sha256(bytes) : 'a'.repeat(64),
          layout:
            target === 'macos-x64' ? 'native_launcher_with_private_runtime' : 'single_executable',
        },
      ]),
    ),
  };
  return { bytes, lock, name };
}

async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'gog-cli-artifacts-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('target options are explicit and native package builds reject host mismatches', () => {
  assert.deepEqual(parseTargetArguments(['--target=macos-arm64']), {
    target: 'macos-arm64',
    all: false,
    help: false,
    compileOnly: false,
  });
  assert.equal(parseTargetArguments(['--all'], { allowAll: true }).all, true);
  assert.equal(
    parseTargetArguments(['--compile-only'], { allowCompileOnly: true }).compileOnly,
    true,
  );
  for (const args of [
    ['--target'],
    ['--target', '--help'],
    ['--target=a', '--target=b'],
    ['--all', '--target=macos-arm64'],
    ['--bad'],
  ])
    assert.throws(() => parseTargetArguments(args, { allowAll: true }));
  for (const [name, target] of Object.entries(TARGETS)) {
    const host = { platform: target.platform, arch: target.architecture };
    assert.equal(selectTarget(undefined, host), name);
    assert.equal(selectTarget(name, host, true), name);
    for (const other of Object.keys(TARGETS).filter((value) => value !== name))
      assert.throws(() => selectTarget(other, host, true), /matching Node architecture/);
  }
  assert.throws(() => selectTarget(undefined, { platform: 'linux', arch: 'x64' }));
  assert.throws(() => selectTarget('unknown'));
});

test('release locks reject changed identities, missing targets and inconsistent metadata', () => {
  const { lock } = fixture();
  assert.equal(validateReleaseLock(lock), lock);
  for (const update of [
    { repository: 'other/repo' },
    { tag: 'latest' },
    { commit: 'short' },
    { targets: {} },
    { version: '../0.3.0' },
  ])
    assert.throws(() => validateReleaseLock({ ...lock, ...update }), /lock/);
  const changed = structuredClone(lock);
  changed.targets['windows-x64'].architecture = 'arm64';
  assert.throws(() => validateReleaseLock(changed), /metadata/);
});

test('all four release layouts extract with their private files and executable permissions', async (t) => {
  const root = await temporary(t);
  for (const name of Object.keys(TARGETS)) {
    const { bytes, lock } = fixture(name);
    const directory = join(root, name);
    const metadata = await extractCliArchive(bytes, directory, lock, name);
    assert.equal(metadata.version, VERSION);
    assert.equal(metadata.architecture, TARGETS[name].architecture);
    if (TARGETS[name].platform === 'darwin' && process.platform !== 'win32') {
      assert.ok((await lstat(join(directory, 'gog-achievements'))).mode & 0o111);
      if (name === 'macos-x64') assert.ok((await lstat(join(directory, 'lib/node'))).mode & 0o111);
    }
  }
});

test('SHA mismatch fails before creating extraction files', async (t) => {
  const root = await temporary(t);
  const { bytes, lock, name } = fixture();
  lock.targets[name].sha256 = 'a'.repeat(64);
  await assert.rejects(extractCliArchive(bytes, join(root, 'out'), lock, name), /SHA-256/);
  assert.deepEqual(await readdir(root), []);
});

test('ZIP reader rejects path escapes, links, duplicate names, file conflicts and size bombs', async (t) => {
  const root = await temporary(t);
  const prefix = rootFolder('macos-arm64') + '/';
  const invalid = [
    [{ name: '../outside' }],
    [{ name: '/absolute' }],
    [{ name: prefix + '../outside' }],
    [{ name: prefix + 'lib\\outside' }],
    [{ name: prefix + 'drive:stream' }],
    [{ name: prefix + 'control\0name' }],
    [{ name: prefix + 'NUL' }],
    [{ name: prefix + 'name.' }],
    [{ name: prefix + 'link', mode: 0o120777 }],
    [{ name: prefix + 'LICENSE' }],
    [{ name: prefix + 'license' }],
    [{ name: prefix + 'parent' }, { name: prefix + 'parent/child' }],
    [{ name: prefix + 'huge', declaredSize: ARCHIVE_LIMITS.fileBytes + 1 }],
  ];
  for (const [index, extra] of invalid.entries()) {
    const { bytes, lock, name } = fixture('macos-arm64', extra);
    await assert.rejects(extractCliArchive(bytes, join(root, 'out-' + index), lock, name));
  }
  const { bytes, lock, name } = fixture();
  await assert.rejects(
    extractCliArchive(bytes, join(root, 'entries'), lock, name, { ...ARCHIVE_LIMITS, entries: 1 }),
    /too many entries/,
  );
  await assert.rejects(
    extractCliArchive(bytes, join(root, 'total'), lock, name, { ...ARCHIVE_LIMITS, totalBytes: 1 }),
    /extracted size/,
  );
  await assert.rejects(
    extractCliArchive(bytes, join(root, 'archive'), lock, name, {
      ...ARCHIVE_LIMITS,
      archiveBytes: 1,
    }),
    /size limit/,
  );
  assert.deepEqual(await readdir(root), []);
});

test('extraction checks locked metadata and refuses to write into a populated directory', async (t) => {
  const root = await temporary(t);
  const bad = fixture('macos-arm64', [], { architecture: 'x64' });
  await assert.rejects(
    extractCliArchive(bad.bytes, join(root, 'bad'), bad.lock, bad.name),
    /metadata/,
  );
  const valid = fixture();
  const directory = join(root, 'populated');
  await writeFile(join(root, 'untouched'), 'retained');
  await assert.rejects(
    extractCliArchive(valid.bytes, root, valid.lock, valid.name),
    /empty regular/,
  );
  assert.equal(await readFile(join(root, 'untouched'), 'utf8'), 'retained');
  const result = await extractCliArchive(valid.bytes, directory, valid.lock, valid.name);
  assert.equal(result.version, VERSION);
});

test('download uses the pinned URL and verified cache, preserves other targets and keeps good output on failure', async (t) => {
  const root = await temporary(t);
  const { bytes, lock, name } = fixture();
  const urls = [];
  const request = async (url) => {
    urls.push(url);
    return new globalThis.Response(bytes);
  };
  const directory = await downloadCli(name, { root, lock, request });
  assert.equal(
    urls[0],
    'https://github.com/opista/gog-achievements-cli/releases/download/v0.3.0/' +
      rootFolder(name) +
      '.zip',
  );
  const other = join(root, 'resources/cli/windows-x64');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(other);
  await writeFile(join(other, 'keep'), 'other target');
  await downloadCli(name, { root, lock, request: () => assert.fail('Valid cache must be used') });
  assert.equal(await readFile(join(other, 'keep'), 'utf8'), 'other target');
  const corrupt = structuredClone(lock);
  corrupt.targets[name].sha256 = 'b'.repeat(64);
  await assert.rejects(downloadCli(name, { root, lock: corrupt, request }), /SHA-256/);
  assert.equal(JSON.parse(await readFile(join(directory, 'build.json'), 'utf8')).version, VERSION);
  await assert.rejects(
    downloadCli(name, {
      root,
      lock: corrupt,
      request: async () => new globalThis.Response('unavailable', { status: 503 }),
    }),
    /HTTP 503/,
  );
});

test('download bounds response bytes before extraction or cache writes', async (t) => {
  const root = await temporary(t);
  const { bytes, lock, name } = fixture();
  await assert.rejects(
    downloadCli(name, {
      root,
      lock,
      limits: { ...ARCHIVE_LIMITS, archiveBytes: 4 },
      request: async () => new globalThis.Response(bytes),
    }),
    /size limit/,
  );
  assert.deepEqual(await readdir(root), []);
});

test('package commands request exactly one architecture and cannot publish', () => {
  for (const [name, target] of Object.entries(TARGETS)) {
    const commands = packageCommands(name);
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[1][1], [
      target.platform === 'darwin' ? '--mac' : '--win',
      '--' + target.architecture,
      '--publish',
      'never',
      '--config',
      'electron-builder.config.cjs',
    ]);
    assert.equal(packageCommands(name, true).length, 1);
  }
});

test('smoke checks execute only JSON help and an offline queue read on every target', async (t) => {
  for (const [name, target] of Object.entries(TARGETS)) {
    await t.test(name, async (t) => {
      const root = await temporary(t);
      const { bytes, lock } = fixture(name);
      await extractCliArchive(bytes, root, lock, name);
      const calls = [];
      await smokeCli(
        root,
        lock,
        name,
        async (_executable, args, options) => {
          calls.push(args);
          assert.equal(options.windowsHide, true);
          assert.equal(options.env.NODE_OPTIONS, undefined);
          assert.equal(options.env.NODE_PATH, undefined);
          if (args[0] === '--help')
            return {
              stderr: '',
              stdout: JSON.stringify({
                ok: true,
                data: {
                  name: 'gog-achievements',
                  version: VERSION,
                  commands: ['queue create', 'queue add'].map((command) => ({
                    command,
                    flags: ['action'],
                  })),
                },
              }),
            };
          const queue = JSON.parse(await readFile(args[3], 'utf8'));
          assert.deepEqual(
            queue.items.map((item) => item.action ?? 'unlock'),
            ['unlock', 'lock'],
          );
          assert.equal(queue.items[1].previous_unlocked_at, '2020-02-01T12:34:56.123456+0000');
          return { stderr: '', stdout: JSON.stringify({ ok: true, data: queue }) };
        },
        { platform: target.platform, arch: target.architecture },
      );
      assert.deepEqual(
        calls.map((args) => args.slice(0, 2)),
        [
          ['--help', '--json'],
          ['queue', 'show'],
        ],
      );
      assert.equal(calls.length, 2);
      assert.ok(calls.every((args) => !args.includes('--yes') && !args.includes('login')));
    });
  }
});

test('private release downloads resolve exact API assets and remove tokens before CDN redirects', async (t) => {
  const root = await temporary(t);
  const { bytes, lock, name } = fixture();
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (calls.length === 1)
      return new globalThis.Response(
        JSON.stringify({
          draft: false,
          tag_name: lock.tag,
          assets: [{ id: 456, name: lock.targets[name].archive }],
        }),
      );
    if (calls.length === 2)
      return new globalThis.Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/fixture.zip' },
      });
    return new globalThis.Response(bytes);
  };
  await downloadCli(name, { root, lock, request, token: 'fixture-build-token' });
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/opista/gog-achievements-cli/releases/tags/v0.3.0',
  );
  assert.equal(
    calls[1].url,
    'https://api.github.com/repos/opista/gog-achievements-cli/releases/assets/456',
  );
  assert.equal(calls[1].headers.Authorization, 'Bearer fixture-build-token');
  assert.equal(calls[1].headers.Accept, 'application/octet-stream');
  assert.equal(calls[2].headers.Authorization, undefined);
});

test('private asset metadata and unsafe redirects fail before project writes', async (t) => {
  const root = await temporary(t);
  const { bytes, lock, name } = fixture();
  for (const release of [
    { draft: true, tag_name: lock.tag, assets: [{ id: 1, name: lock.targets[name].archive }] },
    { draft: false, tag_name: 'v9.0.0', assets: [{ id: 1, name: lock.targets[name].archive }] },
    { draft: false, tag_name: lock.tag, assets: [] },
    {
      draft: false,
      tag_name: lock.tag,
      assets: [
        { id: 1, name: lock.targets[name].archive },
        { id: 2, name: lock.targets[name].archive },
      ],
    },
  ]) {
    await assert.rejects(
      downloadCli(name, {
        root,
        lock,
        token: 'fixture-build-token',
        request: async () => new globalThis.Response(JSON.stringify(release)),
      }),
      /exact published/,
    );
  }
  await assert.rejects(
    downloadCli(name, {
      root,
      lock,
      request: async () =>
        new globalThis.Response(null, {
          status: 302,
          headers: { location: 'http://example.invalid/' },
        }),
    }),
    /unsafe URL/,
  );
  const oversized = async () =>
    new globalThis.Response(bytes, {
      headers: { 'content-length': String(ARCHIVE_LIMITS.archiveBytes + 1) },
    });
  await assert.rejects(downloadCli(name, { root, lock, request: oversized }), /size limit/);
  assert.deepEqual(await readdir(root), []);
});

test('packaged verification resolves CLI resources outside ASAR for both operating systems', () => {
  for (const [name, target] of Object.entries(TARGETS)) {
    const path = packageCliPath('/tmp/App With Spaces.app', name);
    assert.equal(
      path,
      join(
        resolve('/tmp/App With Spaces.app'),
        ...(target.platform === 'darwin' ? ['Contents', 'Resources', 'cli'] : ['resources', 'cli']),
      ),
    );
  }
});
