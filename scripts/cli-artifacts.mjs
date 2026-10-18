import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT, selectTarget, TARGETS } from './build-targets.mjs';
export {
  PROJECT_ROOT,
  selectTarget,
  TARGETS,
  parseTargetArguments,
  isMain,
} from './build-targets.mjs';
import {
  ARCHIVE_LIMITS,
  sha256,
  verifyArchive,
  extractCliPackage,
  validateCliPackage,
} from '../src/main/cli-package.ts';
export { ARCHIVE_LIMITS, sha256 };

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

export async function validateDistribution(directory, lock, name) {
  selectTarget(name);
  return validateCliPackage(directory, { ...lock.targets[name], version: lock.version });
}

export async function extractCliArchive(bytes, directory, lock, name, limits = ARCHIVE_LIMITS) {
  validateReleaseLock(lock);
  selectTarget(name);
  return extractCliPackage(
    bytes,
    directory,
    { ...lock.targets[name], version: lock.version },
    limits,
  );
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
