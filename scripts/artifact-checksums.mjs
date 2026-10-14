import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectTarget, TARGETS } from './cli-artifacts.mjs';

export function artifactNames(version, name) {
  selectTarget(name);
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
    throw new Error('The app must have a valid release version.');
  const prefix = 'gog-achievements-' + version + '-' + name;
  const extensions = TARGETS[name].platform === 'darwin' ? ['dmg', 'zip'] : ['exe'];
  return extensions.map((extension) => prefix + '.' + extension);
}

export async function writeArtifactChecksums(directory, version, name) {
  const names = artifactNames(version, name);
  const checksums = await Promise.all(
    names.map(async (file) => {
      const path = join(directory, file);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0)
        throw new Error('Package artifact must be a nonempty regular file: ' + file + '.');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return { file, checksum: hash.digest('hex') };
    }),
  );
  for (const { file, checksum } of checksums) {
    const destination = join(directory, file + '.sha256');
    const temporary = join(directory, '.' + randomUUID() + '.sha256.tmp');
    try {
      await writeFile(temporary, checksum + '  ' + file + '\n', { flag: 'wx', mode: 0o644 });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return names;
}
