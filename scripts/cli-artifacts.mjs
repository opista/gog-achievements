import { execFile } from 'node:child_process';
import { promisify, TextDecoder } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const TARGETS = Object.freeze({
  'macos-arm64': Object.freeze({ platform: 'darwin', architecture: 'arm64' }),
  'macos-x64': Object.freeze({ platform: 'darwin', architecture: 'x64' }),
  'windows-arm64': Object.freeze({ platform: 'win32', architecture: 'arm64' }),
  'windows-x64': Object.freeze({ platform: 'win32', architecture: 'x64' }),
});
export const ARCHIVE_LIMITS = Object.freeze({
  archiveBytes: 256 * 1024 * 1024,
  fileBytes: 256 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  entries: 256,
  ratio: 500,
});

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function selectTarget(name, host = process, requireNative = false) {
  name ??= Object.keys(TARGETS).find(
    (item) => TARGETS[item].platform === host.platform && TARGETS[item].architecture === host.arch,
  );
  if (!name || !Object.hasOwn(TARGETS, name))
    throw new Error('Choose a supported target: ' + Object.keys(TARGETS).join(', ') + '.');
  const target = TARGETS[name];
  if (requireNative && (target.platform !== host.platform || target.architecture !== host.arch))
    throw new Error('Target ' + name + ' requires its OS and matching Node architecture.');
  return name;
}

export function parseTargetArguments(args, { allowAll = false, allowCompileOnly = false } = {}) {
  let target;
  let all = false;
  let help = false;
  let compileOnly = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--target' || argument.startsWith('--target=')) {
      if (target !== undefined) throw new Error('Use --target only once.');
      target = argument === '--target' ? args[++index] : argument.slice(9);
      if (!target || target.startsWith('-')) throw new Error('--target requires a target name.');
    } else if (argument === '--all' && allowAll) all = true;
    else if (argument === '--compile-only' && allowCompileOnly) compileOnly = true;
    else if (argument === '--help' || argument === '-h') help = true;
    else throw new Error('Unknown argument: ' + argument + '. Use --help.');
  }
  if (all && target !== undefined) throw new Error('Choose --all or --target, not both.');
  return { target, all, help, compileOnly };
}

export async function readReleaseLock(path = join(PROJECT_ROOT, 'cli-release.lock.json')) {
  const lock = JSON.parse(await readFile(path, 'utf8'));
  validateReleaseLock(lock);
  return lock;
}

export function validateReleaseLock(lock) {
  if (
    lock?.schema_version !== 1 ||
    lock.repository !== 'opista/gog-achievements-cli' ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(lock.version) ||
    lock.tag !== 'v' + lock.version ||
    !/^[a-f0-9]{40}$/.test(lock.commit) ||
    !lock.targets ||
    Object.keys(lock.targets).sort().join(',') !== Object.keys(TARGETS).sort().join(',')
  )
    throw new Error('The CLI release lock is invalid.');
  for (const [name, expected] of Object.entries(TARGETS)) {
    const target = lock.targets[name];
    if (
      target.platform !== expected.platform ||
      target.architecture !== expected.architecture ||
      target.archive !== 'gog-achievements-' + lock.version + '-' + name + '.zip' ||
      !/^[a-f0-9]{64}$/.test(target.sha256) ||
      target.layout !==
        (name === 'macos-x64' ? 'native_launcher_with_private_runtime' : 'single_executable')
    )
      throw new Error('The CLI release lock has invalid metadata for ' + name + '.');
  }
  return lock;
}

function verifyArchive(bytes, expected, limits) {
  if (bytes.length > limits.archiveBytes) throw new Error('CLI archive exceeds the size limit.');
  if (sha256(bytes) !== expected.sha256)
    throw new Error('CLI archive SHA-256 does not match its lock.');
}

function safeEntry(entry, root, seen, limits) {
  const name = new TextDecoder('utf-8', { fatal: true }).decode(entry.fileName);
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

async function readZip(bytes, root, limits) {
  const zip = await new Promise((accept, reject) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, decodeStrings: false, autoClose: false, validateEntrySizes: true },
      (error, value) => (error ? reject(error) : accept(value)),
    ),
  );
  try {
    const entries = await new Promise((accept, reject) => {
      const result = [];
      const seen = new Map();
      let size = 0;
      zip.on('error', reject);
      zip.on('entry', (entry) => {
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
    return { zip, entries };
  } catch (error) {
    zip.close();
    throw error;
  }
}

export async function validateDistribution(directory, lock, name) {
  selectTarget(name);
  const target = lock.targets[name];
  const metadataPath = join(directory, 'build.json');
  const metadataStat = await lstat(metadataPath);
  if (!metadataStat.isFile() || metadataStat.size > 65536)
    throw new Error('CLI build metadata must be a small regular file.');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  for (const key of ['platform', 'architecture', 'layout']) {
    if (metadata[key] !== target[key])
      throw new Error('CLI build metadata does not match ' + name + '.');
  }
  if (
    metadata.version !== lock.version ||
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

export async function extractCliArchive(bytes, directory, lock, name, limits = ARCHIVE_LIMITS) {
  validateReleaseLock(lock);
  selectTarget(name);
  const target = lock.targets[name];
  verifyArchive(bytes, target, limits);
  const { zip, entries } = await readZip(bytes, target.archive.slice(0, -4), limits);
  try {
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(directory)).length)
      throw new Error('CLI extraction requires an empty regular directory.');
    for (const item of entries) {
      if (!item.path) continue;
      const path = join(directory, item.path);
      if (item.directory) await mkdir(path, { recursive: true, mode: 0o755 });
      else {
        await mkdir(dirname(path), { recursive: true, mode: 0o755 });
        const stream = await new Promise((accept, reject) =>
          zip.openReadStream(item.entry, (error, value) => (error ? reject(error) : accept(value))),
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
        await pipeline(stream, count, createWriteStream(path, { flags: 'wx', mode: 0o644 }));
        if (size !== item.entry.uncompressedSize)
          throw new Error('CLI archive entry size is invalid.');
        if (TARGETS[name].platform === 'darwin' && item.mode & 0o111) await chmod(path, 0o755);
      }
    }
    return await validateDistribution(directory, lock, name);
  } finally {
    zip.close();
  }
}

async function fetchBytes(url, request, maximum, headers = {}) {
  const signal = AbortSignal.timeout(60000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await request(url, {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'gog-achievements-desktop-build',
        ...headers,
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('CLI download has an invalid redirect.');
      const destination = new URL(location, url);
      if (destination.protocol !== 'https:' || destination.username || destination.password)
        throw new Error('CLI download redirected to an unsafe URL.');
      url = destination.href;
      // GitHub tokens must never be forwarded to its asset CDN.
      headers = {};
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error(
        'CLI download failed with HTTP ' +
          response.status +
          (response.status === 404
            ? '. Private releases need GH_TOKEN with repository read access or gh auth login.'
            : '.'),
      );
    const length = Number(response.headers.get('content-length'));
    if (length > maximum) throw new Error('CLI download exceeds the size limit.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maximum) throw new Error('CLI download exceeds the size limit.');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('CLI download has too many redirects.');
}

async function buildGitHubToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)
    return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    const { stdout } = await promisify(execFile)(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: 5000, maxBuffer: 16000, windowsHide: true },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function fetchArchive(lock, target, request, limits, token) {
  if (!token) {
    const url =
      'https://github.com/' +
      lock.repository +
      '/releases/download/' +
      encodeURIComponent(lock.tag) +
      '/' +
      encodeURIComponent(target.archive);
    return fetchBytes(url, request, limits.archiveBytes);
  }
  const api = 'https://api.github.com/repos/' + lock.repository;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  const bytes = await fetchBytes(
    api + '/releases/tags/' + encodeURIComponent(lock.tag),
    request,
    1024 * 1024,
    headers,
  );
  const release = JSON.parse(bytes.toString('utf8'));
  const assets = Array.isArray(release.assets)
    ? release.assets.filter((asset) => asset.name === target.archive)
    : [];
  if (
    release.draft !== false ||
    release.tag_name !== lock.tag ||
    assets.length !== 1 ||
    !Number.isSafeInteger(assets[0].id) ||
    assets[0].id <= 0
  )
    throw new Error('GitHub does not have the exact published CLI release asset.');
  return fetchBytes(api + '/releases/assets/' + assets[0].id, request, limits.archiveBytes, {
    ...headers,
    Accept: 'application/octet-stream',
  });
}

export async function downloadCli(
  name,
  { root = PROJECT_ROOT, lock, request = fetch, limits = ARCHIVE_LIMITS, token } = {},
) {
  lock ??= await readReleaseLock(join(root, 'cli-release.lock.json'));
  validateReleaseLock(lock);
  selectTarget(name);
  const target = lock.targets[name];
  const cache = join(root, '.cache', 'cli');
  const archivePath = join(cache, target.archive);
  let bytes;
  try {
    const stat = await lstat(archivePath);
    if (!stat.isFile() || stat.size > limits.archiveBytes) throw new Error();
    bytes = await readFile(archivePath);
    verifyArchive(bytes, target, limits);
  } catch {
    const credential = token ?? (request === fetch ? await buildGitHubToken() : undefined);
    bytes = await fetchArchive(lock, target, request, limits, credential);
    verifyArchive(bytes, target, limits);
  }
  const outputRoot = join(root, 'resources', 'cli');
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(join(outputRoot, '.' + name + '-'));
  const destination = join(outputRoot, name);
  const backup = join(outputRoot, '.' + name + '-previous-' + randomUUID());
  let previous = false;
  try {
    await extractCliArchive(bytes, staging, lock, name, limits);
    await mkdir(cache, { recursive: true });
    const temporary = join(cache, randomUUID() + '.tmp');
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, archivePath);
    } finally {
      await rm(temporary, { force: true });
    }
    try {
      await rename(destination, backup);
      previous = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (previous) await rename(backup, destination);
      throw error;
    }
    if (previous) await rm(backup, { recursive: true, force: true });
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function isMain(moduleUrl) {
  return !!process.argv[1] && fileURLToPath(moduleUrl) === resolve(process.argv[1]);
}
