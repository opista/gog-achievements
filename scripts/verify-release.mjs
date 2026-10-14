import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { artifactNames } from './artifact-checksums.mjs';
import { isMain, PROJECT_ROOT, TARGETS } from './cli-artifacts.mjs';

export async function verifyReleaseVersion(tag, { root = PROJECT_ROOT } = {}) {
  const [pkg, lock, manifest] = await Promise.all(
    ['package.json', 'package-lock.json', '.release-please-manifest.json'].map(async (name) =>
      JSON.parse(await readFile(join(root, name), 'utf8')),
    ),
  );
  artifactNames(pkg.version, 'macos-arm64');
  if (tag !== 'v' + pkg.version)
    throw new Error('The release tag must match package.json version.');
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version)
    throw new Error('The package lock must match the release version.');
  if (manifest['.'] !== pkg.version)
    throw new Error('The Release Please manifest must match the release version.');
  return pkg.version;
}

export async function verifyRelease(
  tag,
  { root = PROJECT_ROOT, directory = join(root, 'dist') } = {},
) {
  const version = await verifyReleaseVersion(tag, { root });
  const packages = Object.keys(TARGETS).flatMap((name) => artifactNames(version, name));
  const expected = packages.flatMap((name) => [name, name + '.sha256']).sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('The release must contain all six native packages and their six checksums.');
  for (const name of packages) {
    const path = join(directory, name);
    const stat = await lstat(path);
    const checksumPath = path + '.sha256';
    const checksumStat = await lstat(checksumPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0)
      throw new Error('A release package must be a nonempty regular file: ' + name + '.');
    if (!checksumStat.isFile() || checksumStat.isSymbolicLink() || checksumStat.size > 256)
      throw new Error('A release checksum must be a small regular file: ' + name + '.sha256.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const expectedChecksum = hash.digest('hex') + '  ' + name + '\n';
    if ((await readFile(checksumPath, 'utf8')) !== expectedChecksum)
      throw new Error('A release package does not match its SHA-256 checksum: ' + name + '.');
  }
  return packages;
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { 'version-only': { type: 'boolean' }, directory: { type: 'string' } },
  });
  if (positionals.length !== 1) throw new Error('Provide one release tag, such as v0.1.0.');
  if (values['version-only']) {
    await verifyReleaseVersion(positionals[0]);
    process.stdout.write('Package, lock and Release Please versions verified.\n');
  } else {
    await verifyRelease(positionals[0], {
      directory: values.directory ? resolve(values.directory) : undefined,
    });
    process.stdout.write('Release versions, all native packages and SHA-256 checksums verified.\n');
  }
}

if (isMain(import.meta.url))
  main().catch((error) => {
    process.stderr.write('Release verification failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
