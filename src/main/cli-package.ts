import { TextDecoder } from 'node:util';
import { createHash } from 'node:crypto';
import { createWriteStream, open, close, constants } from 'node:fs';
import { chmod, lstat, mkdir, open as openFile, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

export interface CliPackage {
  version: string;
  platform: string;
  architecture: string;
  layout: string;
  archive: string;
  sha256: string;
}
export interface ArchiveLimits {
  archiveBytes: number;
  fileBytes: number;
  totalBytes: number;
  entries: number;
  ratio: number;
}
interface SafeEntry {
  entry: Entry;
  path: string;
  directory: boolean;
  mode: number;
}

export const ARCHIVE_LIMITS = Object.freeze({
  archiveBytes: 256 * 1024 * 1024,
  fileBytes: 256 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  entries: 256,
  ratio: 500,
});

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function verifyArchive(
  bytes: Buffer,
  expected: Pick<CliPackage, 'sha256'>,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
) {
  if (bytes.length > limits.archiveBytes) throw new Error('CLI archive exceeds the size limit.');
  if (sha256(bytes) !== expected.sha256)
    throw new Error('CLI archive SHA-256 does not match its lock.');
}

/** Bound disk reads as well as metadata: a file can change after lstat. */
export async function hashCliFile(path: string, maximum: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum)
    throw new Error('CLI verification requires a bounded regular file.');
  const hash = createHash('sha256');
  let size = 0;
  const file = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    for await (const chunk of file.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
      signal,
    })) {
      size += chunk.length;
      if (size > maximum || size > before.size)
        throw new Error('CLI file changed during verification.');
      hash.update(chunk);
    }
  } finally {
    await file.close();
  }
  signal?.throwIfAborted();
  const after = await lstat(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    size !== before.size ||
    after.size !== before.size ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  )
    throw new Error('CLI file changed during verification.');
  return { sha256: hash.digest('hex'), size };
}

async function openZip(source: Buffer | string) {
  const options = {
    lazyEntries: true,
    decodeStrings: false,
    autoClose: false,
    validateEntrySizes: true,
  };
  if (Buffer.isBuffer(source)) {
    const zip = await new Promise<ZipFile>((accept, reject) =>
      yauzl.fromBuffer(source, options, (error, value) =>
        error || !value ? reject(error ?? new Error('Missing ZIP.')) : accept(value),
      ),
    );
    return {
      zip,
      close: async () => {
        zip.close();
      },
    };
  }
  const descriptor = await new Promise<number>((accept, reject) =>
    open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0), (error, descriptor) =>
      error ? reject(error) : accept(descriptor),
    ),
  );
  let zip: ZipFile;
  try {
    zip = await new Promise<ZipFile>((accept, reject) =>
      yauzl.fromFd(descriptor, options, (error, value) =>
        error || !value ? reject(error ?? new Error('Missing ZIP.')) : accept(value),
      ),
    );
  } catch (error) {
    await new Promise<void>((accept, reject) =>
      close(descriptor, (failure) => (failure ? reject(failure) : accept())),
    );
    throw error;
  }
  return {
    zip,
    close: () =>
      new Promise<void>((accept, reject) => {
        // Await the descriptor close before cache cleanup, especially on Windows.
        zip.once('close', accept);
        zip.once('error', reject);
        zip.close();
      }),
  };
}

function safeEntry(entry: Entry, root: string, seen: Map<string, boolean>, limits: ArchiveLimits) {
  const name = new TextDecoder('utf-8', { fatal: true }).decode(
    entry.fileName as unknown as Uint8Array,
  );
  if (
    !name ||
    /[\\:]/.test(name) ||
    name.startsWith('/') ||
    [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('CLI archive contains an unsafe path.');
  const directory = name.endsWith('/');
  const components = name.split('/');
  if (directory) components.pop();
  if (
    components.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new Error('CLI archive contains an unsafe path.');
  if (components.shift() !== root) throw new Error('CLI archive has an unexpected root folder.');
  const path = components.join('/');
  const key = path.normalize('NFC').toLowerCase();
  if (seen.has(key)) throw new Error('CLI archive contains duplicate paths.');
  seen.set(key, directory);
  const mode = entry.externalFileAttributes >>> 16;
  const type = mode & 0xf000;
  if (
    (type && type !== 0x8000 && type !== 0x4000) ||
    ((type === 0x4000) !== directory && type !== 0)
  )
    throw new Error('CLI archive contains a link or special file.');
  if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod))
    throw new Error('CLI archive uses unsupported encryption or compression.');
  if (
    entry.uncompressedSize > limits.fileBytes ||
    entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.ratio
  )
    throw new Error('CLI archive entry exceeds the size limit.');
  return { entry, path, directory, mode };
}

async function readZip(source: Buffer | string, root: string, limits: ArchiveLimits) {
  const { zip, close } = await openZip(source);
  try {
    const entries = await new Promise<SafeEntry[]>((accept, reject) => {
      const result: SafeEntry[] = [];
      const seen = new Map<string, boolean>();
      let size = 0;
      zip.on('error', reject);
      zip.on('entry', (entry: Entry) => {
        try {
          if (result.length >= limits.entries)
            throw new Error('CLI archive contains too many entries.');
          size += entry.uncompressedSize;
          if (size > limits.totalBytes)
            throw new Error('CLI archive exceeds the extracted size limit.');
          result.push(safeEntry(entry, root, seen, limits));
          zip.readEntry();
        } catch (error) {
          reject(error);
        }
      });
      zip.on('end', () => {
        for (const item of result) {
          const parts = item.path.split('/');
          parts.pop();
          while (parts.length) {
            if (seen.get(parts.join('/').normalize('NFC').toLowerCase()) === false)
              return reject(new Error('CLI archive has a file/directory conflict.'));
            parts.pop();
          }
        }
        accept(result);
      });
      zip.readEntry();
    });
    return { zip, entries, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function validateCliPackage(directory: string, target: CliPackage) {
  const metadataPath = join(directory, 'build.json');
  const metadataStat = await lstat(metadataPath);
  if (!metadataStat.isFile() || metadataStat.size > 65536)
    throw new Error('CLI build metadata must be a small regular file.');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>;
  for (const key of ['platform', 'architecture', 'layout'] as const) {
    if (metadata[key] !== target[key])
      throw new Error('CLI build metadata does not match its target.');
  }
  if (
    metadata.version !== target.version ||
    metadata.runtime_included !== true ||
    metadata.native_helper_included !== true
  )
    throw new Error('CLI build metadata does not match its locked release.');
  const files = [
    'gog-achievements' + (target.platform === 'win32' ? '.exe' : ''),
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'licenses/NODE-LICENSE.txt',
  ];
  const executables = [files[0]];
  if (target.layout === 'native_launcher_with_private_runtime') {
    files.push('lib/node', 'lib/main.cjs', 'native/bin/gog-login');
    executables.push('lib/node', 'native/bin/gog-login');
  }
  for (const file of files) {
    const stat = await lstat(join(directory, file));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0)
      throw new Error('CLI distribution is missing a regular file: ' + file + '.');
    if (
      process.platform !== 'win32' &&
      target.platform !== 'win32' &&
      executables.includes(file) &&
      !(stat.mode & 0o111)
    )
      throw new Error('CLI executable permission is missing: ' + file + '.');
  }
  return metadata;
}

export async function extractCliPackage(
  source: Buffer | string,
  directory: string,
  target: CliPackage,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (Buffer.isBuffer(source)) verifyArchive(source, target, limits);
  else if ((await hashCliFile(source, limits.archiveBytes, signal)).sha256 !== target.sha256)
    throw new Error('CLI archive SHA-256 does not match its lock.');
  signal?.throwIfAborted();
  const { zip, entries, close } = await readZip(source, target.archive.slice(0, -4), limits);
  try {
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(directory)).length)
      throw new Error('CLI extraction requires an empty regular directory.');
    for (const item of entries) {
      signal?.throwIfAborted();
      if (!item.path) continue;
      const path = join(directory, item.path);
      if (item.directory) await mkdir(path, { recursive: true, mode: 0o755 });
      else {
        await mkdir(dirname(path), { recursive: true, mode: 0o755 });
        const stream = await new Promise<Readable>((accept, reject) =>
          zip.openReadStream(item.entry, (error, value) =>
            error || !value ? reject(error ?? new Error('Missing ZIP stream.')) : accept(value),
          ),
        );
        let size = 0;
        const count = new Transform({
          transform(chunk, _encoding, done) {
            size += chunk.length;
            done(
              size > item.entry.uncompressedSize
                ? new Error('CLI archive entry size is invalid.')
                : null,
              chunk,
            );
          },
        });
        await pipeline(stream, count, createWriteStream(path, { flags: 'wx', mode: 0o644 }), {
          signal,
        });
        if (size !== item.entry.uncompressedSize)
          throw new Error('CLI archive entry size is invalid.');
        if (target.platform === 'darwin' && item.mode & 0o111) await chmod(path, 0o755);
      }
    }
    signal?.throwIfAborted();
    return await validateCliPackage(directory, target);
  } finally {
    await close();
  }
}
