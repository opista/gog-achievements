import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { CLI_VERSION } from '../../shared/cli-release';
import { ARCHIVE_LIMITS, type CliPackage } from '../cli-package';

export const CLI_UPDATE_REPOSITORY = 'opista/gog-achievements-cli';
export const CLI_SUPPORTED_MAJOR = 0;
const RELEASES = `https://api.github.com/repos/${CLI_UPDATE_REPOSITORY}/releases`;
const DOWNLOADS = `https://github.com/${CLI_UPDATE_REPOSITORY}/releases/download`;
const METADATA_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 10;
const ASSET_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

export function stableVersion(value: string): bigint[] | null {
  if (value.length > 80 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  return value.split('.').map(BigInt);
}

export function compareVersions(left: string, right: string): number {
  const a = stableVersion(left);
  const b = stableVersion(right);
  if (!a || !b) throw new Error('Invalid CLI version.');
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

export function compatibleVersion(value: string): boolean {
  const parts = stableVersion(value);
  return parts?.[0] === BigInt(CLI_SUPPORTED_MAJOR) && compareVersions(value, CLI_VERSION) >= 0;
}

export interface CliRelease {
  version: string;
  archive: string;
  digest?: string;
}

function selectRelease(value: unknown, target: string): CliRelease | undefined {
  if (!value || typeof value !== 'object') return;
  const release = value as Record<string, unknown>;
  if (
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== 'string' ||
    !release.tag_name.startsWith('v') ||
    !compatibleVersion(release.tag_name.slice(1)) ||
    typeof release.published_at !== 'string' ||
    !Number.isFinite(Date.parse(release.published_at)) ||
    !Array.isArray(release.assets)
  )
    return;
  const version = release.tag_name.slice(1);
  const archive = `gog-achievements-${version}-${target}.zip`;
  let digest: string | undefined;
  for (const name of [archive, `${archive}.sha256`]) {
    const matches = release.assets.filter(
      (asset): asset is Record<string, unknown> =>
        asset !== null && typeof asset === 'object' && asset.name === name,
    );
    const asset = matches[0];
    if (
      matches.length !== 1 ||
      asset?.state !== 'uploaded' ||
      !Number.isSafeInteger(asset.size) ||
      (asset.size as number) <= 0 ||
      (asset.size as number) > (name === archive ? ARCHIVE_LIMITS.archiveBytes : 4096)
    )
      return;
    if (name === archive && asset.digest != null) {
      if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) return;
      digest = asset.digest.slice(7);
    }
  }
  return { version, archive, ...(digest ? { digest } : {}) };
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

interface DownloadLimits {
  totalTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  archiveBytes?: number;
}

export class CliReleaseClient {
  constructor(
    private readonly request: typeof fetch = globalThis.fetch,
    private readonly downloadLimits: DownloadLimits = {},
  ) {}

  private async response(
    url: string,
    maximum: number,
    signal: AbortSignal,
    assets: boolean,
    activity: () => void = () => {},
  ): Promise<Response> {
    for (let redirect = 0; redirect <= 3; redirect++) {
      signal.throwIfAborted();
      const pending = this.request(url, {
        redirect: 'manual',
        signal,
        headers: {
          Accept: assets ? 'application/octet-stream' : 'application/vnd.github+json',
          'User-Agent': 'gog-achievements-desktop',
        },
      });
      // A transport that settles after cancellation must still release its body.
      void pending.then(
        (response) => {
          if (signal.aborted) void response.body?.cancel().catch(() => {});
        },
        () => {},
      );
      const response = await abortable(pending, signal);
      activity();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        const location = response.headers.get('location');
        if (!assets || !location || redirect === 3) throw new Error('Invalid CLI redirect.');
        const next = new URL(location, url);
        if (
          next.protocol !== 'https:' ||
          next.username ||
          next.password ||
          next.port ||
          next.hash ||
          !ASSET_HOSTS.has(next.hostname)
        )
          throw new Error('Unsafe CLI redirect.');
        url = next.href;
        continue;
      }
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw new Error('CLI download is unavailable.');
      }
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
        void response.body.cancel().catch(() => {});
        throw new Error('CLI response is too large.');
      }
      return response;
    }
    throw new Error('Too many CLI redirects.');
  }

  private async *chunks(
    response: Response,
    maximum: number,
    signal: AbortSignal,
    activity: () => void = () => {},
  ): AsyncGenerator<Uint8Array> {
    const reader = response.body!.getReader();
    const cancel = () => void reader.cancel().catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    try {
      let size = 0;
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > maximum) throw new Error('CLI response is too large.');
        if (value.byteLength) activity();
        yield value;
      }
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener('abort', cancel);
      cancel();
      reader.releaseLock();
    }
  }

  private async bytes(url: string, maximum: number, signal: AbortSignal, assets = false) {
    const response = await this.response(url, maximum, signal, assets);
    const chunks: Buffer[] = [];
    for await (const chunk of this.chunks(response, maximum, signal))
      chunks.push(Buffer.from(chunk));
    return {
      bytes: Buffer.concat(chunks),
      next: /rel="next"/.test(response.headers.get('link') ?? ''),
    };
  }

  async latest(target: string, rejected: readonly string[], signal: AbortSignal) {
    const releases: CliRelease[] = [];
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await this.bytes(
        `${RELEASES}?per_page=100&page=${page}`,
        METADATA_BYTES,
        bounded,
      );
      const values: unknown = JSON.parse(result.bytes.toString('utf8'));
      if (!Array.isArray(values) || values.length > 100) throw new Error('Invalid CLI releases.');
      for (const value of values) {
        const release = selectRelease(value, target);
        if (release && !rejected.includes(release.version)) releases.push(release);
      }
      if (!result.next) return releases.sort((a, b) => compareVersions(b.version, a.version))[0];
    }
    throw new Error('CLI release listing is incomplete.');
  }

  /** The cache owns the private destination directory; failed transfers remove only their file. */
  async download(release: CliRelease, destination: string, signal: AbortSignal): Promise<string> {
    const checksumSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    const url = `${DOWNLOADS}/v${release.version}/${release.archive}`;
    const checksum = (await this.bytes(`${url}.sha256`, 4096, checksumSignal, true)).bytes
      .toString('utf8')
      .trim();
    const match = /^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/.exec(checksum);
    if (!match || match[2] !== release.archive) throw new Error('Invalid CLI checksum.');
    const expected = match[1]!.toLowerCase();
    if (release.digest && release.digest !== expected) throw new Error('CLI checksum mismatch.');
    signal.throwIfAborted();
    const controller = new AbortController();
    const bounded = AbortSignal.any([signal, controller.signal]);
    const total = setTimeout(
      () => controller.abort(new Error('CLI download deadline exceeded.')),
      this.downloadLimits.totalTimeoutMs ?? 300000,
    );
    total.unref();
    let inactivity: ReturnType<typeof setTimeout>;
    const activity = () => {
      clearTimeout(inactivity);
      inactivity = setTimeout(
        () => controller.abort(new Error('CLI download stalled.')),
        this.downloadLimits.inactivityTimeoutMs ?? 30000,
      );
      inactivity.unref();
    };
    activity();
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    let complete = false;
    try {
      file = await open(destination, 'wx', 0o600);
      created = true;
      const maximum = Math.min(
        this.downloadLimits.archiveBytes ?? ARCHIVE_LIMITS.archiveBytes,
        ARCHIVE_LIMITS.archiveBytes,
      );
      const response = await this.response(url, maximum, bounded, true, activity);
      const hash = createHash('sha256');
      for await (const chunk of this.chunks(response, maximum, bounded, activity)) {
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      bounded.throwIfAborted();
      if (hash.digest('hex') !== expected)
        throw new Error('CLI archive SHA-256 does not match its checksum.');
      await file.sync();
      bounded.throwIfAborted();
      await file.close();
      file = undefined;
      complete = true;
      return expected;
    } finally {
      clearTimeout(total);
      clearTimeout(inactivity!);
      try {
        await file?.close();
      } finally {
        if (created && !complete) await rm(destination, { force: true });
      }
    }
  }
}

export function packageSpec(version: string, target: string, sha256: string): CliPackage {
  const [os, architecture] = target.split('-');
  if (!['macos', 'windows'].includes(os!) || !['arm64', 'x64'].includes(architecture!))
    throw new Error('Unsupported CLI target.');
  return {
    version,
    platform: os === 'macos' ? 'darwin' : 'win32',
    architecture: architecture!,
    layout: target === 'macos-x64' ? 'native_launcher_with_private_runtime' : 'single_executable',
    archive: `gog-achievements-${version}-${target}.zip`,
    sha256,
  };
}
