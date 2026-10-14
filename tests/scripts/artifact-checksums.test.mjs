import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactNames, writeArtifactChecksums } from '../../scripts/artifact-checksums.mjs';

async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'gog-package-checksums-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('artifact names include one target and only release package extensions', () => {
  assert.deepEqual(artifactNames('0.1.0', 'macos-arm64'), [
    'gog-achievements-0.1.0-macos-arm64.dmg',
    'gog-achievements-0.1.0-macos-arm64.zip',
  ]);
  assert.deepEqual(artifactNames('0.1.0', 'windows-arm64'), [
    'gog-achievements-0.1.0-windows-arm64.exe',
  ]);
  assert.deepEqual(artifactNames('0.1.0', 'windows-x64'), [
    'gog-achievements-0.1.0-windows-x64.exe',
  ]);
  assert.throws(() => artifactNames('../0.1.0', 'macos-arm64'), /valid release/);
  assert.throws(() => artifactNames('0.1.0', 'linux-x64'), /supported target/);
});

test('checksums cover every selected package, exclude blockmaps and preserve other targets', async (t) => {
  const directory = await temporary(t);
  const names = artifactNames('0.1.0', 'macos-arm64');
  const bytes = Buffer.from('complete package fixture');
  const expected = createHash('sha256').update(bytes).digest('hex');
  for (const name of names) await writeFile(join(directory, name), bytes);
  await writeFile(join(directory, names[0] + '.blockmap'), 'blockmap fixture');
  const other = artifactNames('0.1.0', 'windows-x64')[0];
  await writeFile(join(directory, other + '.sha256'), 'other target checksum');
  assert.deepEqual(await writeArtifactChecksums(directory, '0.1.0', 'macos-arm64'), names);
  for (const name of names)
    assert.equal(
      await readFile(join(directory, name + '.sha256'), 'utf8'),
      expected + '  ' + name + '\n',
    );
  assert.equal(await readFile(join(directory, other + '.sha256'), 'utf8'), 'other target checksum');
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith('.blockmap.sha256')));
});

test('missing or empty packages fail before writing any checksums', async (t) => {
  const directory = await temporary(t);
  const [dmg, zip] = artifactNames('0.1.0', 'macos-x64');
  await writeFile(join(directory, dmg), 'dmg fixture');
  await assert.rejects(writeArtifactChecksums(directory, '0.1.0', 'macos-x64'));
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith('.sha256')));
  await writeFile(join(directory, zip), '');
  await assert.rejects(writeArtifactChecksums(directory, '0.1.0', 'macos-x64'), /nonempty regular/);
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith('.sha256')));
});

test(
  'package checksums reject symlinked artifacts',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await temporary(t);
    const name = artifactNames('0.1.0', 'windows-x64')[0];
    await writeFile(join(directory, 'actual-file'), 'fixture');
    await symlink(join(directory, 'actual-file'), join(directory, name));
    await assert.rejects(writeArtifactChecksums(directory, '0.1.0', 'windows-x64'), /regular file/);
  },
);
