import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, verifyRelease, verifyReleaseVersion } from '../../scripts/verify-release.mjs';

const VERSION = '0.1.0';
const TAG = 'v' + VERSION;
const PACKAGES = [
  'gog-achievements-0.1.0-macos-arm64.dmg',
  'gog-achievements-0.1.0-macos-arm64.zip',
  'gog-achievements-0.1.0-macos-x64.dmg',
  'gog-achievements-0.1.0-macos-x64.zip',
  'gog-achievements-0.1.0-windows-arm64.exe',
  'gog-achievements-0.1.0-windows-x64.exe',
];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gog-app-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'packages');
  await mkdir(directory);
  const metadata = {
    'package.json': { version: VERSION },
    'package-lock.json': { version: VERSION, packages: { '': { version: VERSION } } },
    '.release-please-manifest.json': { '.': VERSION },
  };
  for (const [name, value] of Object.entries(metadata))
    await writeFile(join(root, name), JSON.stringify(value));
  for (const name of PACKAGES) {
    const bytes = Buffer.from('Native package fixture for ' + name);
    await writeFile(join(directory, name), bytes);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(directory, name + '.sha256'), checksum + '  ' + name + '\n');
  }
  return { root, directory };
}

test('a complete release has six packages and six matching checksums across all four targets', async (t) => {
  const options = await fixture(t);
  assert.deepEqual(await verifyRelease(TAG, options), PACKAGES);
  assert.equal(await verifyReleaseVersion(TAG, options), VERSION);
});

test('release version checks reject a different tag or inconsistent package metadata', async (t) => {
  const options = await fixture(t);
  for (const tag of [undefined, '0.1.0', 'v0.2.0', '../v0.1.0'])
    await assert.rejects(verifyReleaseVersion(tag, options), /tag must match/);
  for (const field of ['lock-version', 'lock-root-version', 'manifest-version']) {
    await t.test(field, async (t) => {
      const options = await fixture(t);
      const file = field.startsWith('lock') ? 'package-lock.json' : '.release-please-manifest.json';
      const path = join(options.root, file);
      const metadata = JSON.parse(await readFile(path, 'utf8'));
      if (field === 'lock-version') metadata.version = '0.2.0';
      else if (field === 'lock-root-version') metadata.packages[''].version = '0.2.0';
      else metadata['.'] = '0.2.0';
      await writeFile(path, JSON.stringify(metadata));
      await assert.rejects(verifyRelease(TAG, options), /must match the release version/);
    });
  }
});

test('an empty initial manifest cannot be published as an already released version', async (t) => {
  const options = await fixture(t);
  await writeFile(join(options.root, '.release-please-manifest.json'), '{}');
  await assert.rejects(verifyRelease(TAG, options), /manifest must match/);
});

test('missing packages or checksums block publication for every target', async (t) => {
  for (const name of PACKAGES) {
    for (const suffix of ['', '.sha256']) {
      await t.test(name + suffix, async (t) => {
        const options = await fixture(t);
        await rm(join(options.directory, name + suffix));
        await assert.rejects(verifyRelease(TAG, options), /all six native packages/);
      });
    }
  }
});

test('blockmaps, stale versions and unexpected assets cannot enter the release set', async (t) => {
  for (const name of [
    PACKAGES[0] + '.blockmap',
    'gog-achievements-0.0.1-windows-x64.exe',
    'extra',
  ]) {
    await t.test(name, async (t) => {
      const options = await fixture(t);
      await writeFile(join(options.directory, name), 'unexpected');
      await assert.rejects(verifyRelease(TAG, options), /all six native packages/);
    });
  }
});

test('changed package bytes and checksum records with a wrong filename are rejected', async (t) => {
  const options = await fixture(t);
  const path = join(options.directory, PACKAGES[0]);
  await writeFile(path, 'corrupt package');
  await assert.rejects(verifyRelease(TAG, options), /does not match its SHA-256/);
  const checksum = createHash('sha256').update('corrupt package').digest('hex');
  await writeFile(path + '.sha256', checksum + '  other-file.dmg\n');
  await assert.rejects(verifyRelease(TAG, options), /does not match its SHA-256/);
});

test('empty packages and checksum paths that are directories are rejected', async (t) => {
  const options = await fixture(t);
  await writeFile(join(options.directory, PACKAGES[0]), '');
  await assert.rejects(verifyRelease(TAG, options), /nonempty regular file/);
  await writeFile(join(options.directory, PACKAGES[0]), 'restored nonempty fixture');
  await rm(join(options.directory, PACKAGES[0] + '.sha256'));
  await mkdir(join(options.directory, PACKAGES[0] + '.sha256'));
  await assert.rejects(verifyRelease(TAG, options), /small regular file/);
});

test(
  'symlinked packages or checksums cannot be published',
  { skip: process.platform === 'win32' },
  async (t) => {
    for (const suffix of ['', '.sha256']) {
      await t.test(suffix || 'package', async (t) => {
        const options = await fixture(t);
        const path = join(options.directory, PACKAGES[0] + suffix);
        const outside = join(options.root, 'outside-file');
        await writeFile(outside, await readFile(path));
        await rm(path);
        await symlink(outside, path);
        await assert.rejects(verifyRelease(TAG, options), /regular file/);
      });
    }
  },
);

test('release verification command rejects missing tags, extra tags and unknown flags', async () => {
  await assert.rejects(main([]), /one release tag/);
  await assert.rejects(main([TAG, 'v0.2.0']), /one release tag/);
  await assert.rejects(main([TAG, '--unknown']), /Unknown option/);
});
