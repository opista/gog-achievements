export type UpdateStatus =
  'available' | 'up-to-date' | 'no-release' | 'unavailable' | 'unsupported-target';

export const UPDATE_CHECK_FAILED_MESSAGE = 'Could not check for updates. Please try again later.';

export interface UpdateCheck {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  releaseUrl?: string;
  message: string;
}

interface Options {
  currentVersion: string;
  repository: string;
  platform: string;
  architecture: string;
  fetch?: (url: string, options: RequestInit) => Promise<Response>;
  openExternal?: (url: string) => Promise<unknown>;
  timeoutMs?: number;
}
interface StableVersion {
  value: string;
  parts: bigint[];
}
interface Download {
  url: string;
  repository: string;
  tag: string;
  asset: string;
}
const MAX_BODY_BYTES = 1_048_576;
const MAX_REDIRECTS = 3;
const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?';
const NAME = '[A-Za-z0-9_.-]{1,100}';
const REPOSITORY = new RegExp(`^${OWNER}/${NAME}$`);
const API_LATEST = new RegExp(`^/repos/(${OWNER}/${NAME})/releases/latest$`);
const API_RELEASE = new RegExp(`^/repos/(${OWNER}/${NAME})/releases/([1-9][0-9]*)$`);

function stableVersion(value: unknown): StableVersion | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value);
  return match
    ? { value: match.slice(1).join('.'), parts: match.slice(1).map((part) => BigInt(part)) }
    : null;
}

function newer(latest: StableVersion, current: StableVersion): boolean {
  for (let index = 0; index < 3; index++) {
    if (latest.parts[index] !== current.parts[index])
      return latest.parts[index]! > current.parts[index]!;
  }
  return false;
}

function repository(value: string): string {
  if (!REPOSITORY.test(value) || ['.', '..'].includes(value.split('/')[1]!))
    throw new Error('Invalid repository.');
  return value.toLowerCase();
}

function githubUrl(value: unknown, host: string): URL {
  if (typeof value !== 'string' || value.trim() !== value || /[%\\\s]/.test(value))
    throw new Error('Invalid GitHub URL.');
  const url = new URL(value);
  if (url.origin !== `https://${host}` || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid GitHub URL.');
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(value.replace(/^https:\/\//, '')))
    throw new Error('Invalid GitHub path.');
  return url;
}

function latestApi(value: unknown): { url: URL; repository?: string } {
  const url = githubUrl(value, 'api.github.com');
  const named = API_LATEST.exec(url.pathname);
  if (named) return { url, repository: repository(named[1]!) };
  if (/^\/repositories\/[1-9][0-9]*\/releases\/latest$/.test(url.pathname)) return { url };
  throw new Error('Invalid release API URL.');
}

function downloadUrl(value: unknown, download: Omit<Download, 'url'>): string {
  const url = githubUrl(value, 'github.com');
  const expected = `/${download.repository}/releases/download/${download.tag}/${download.asset}`;
  const prefix = `/${download.repository}`;
  if (
    url.pathname.slice(0, prefix.length).toLowerCase() !== prefix ||
    url.pathname.slice(prefix.length) !== expected.slice(prefix.length)
  )
    throw new Error('The installer does not match this release.');
  return url.href;
}

async function bodyJson(response: Response, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const length = response.headers.get('content-length');
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Release metadata is too large.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing release metadata.');
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('Release metadata is too large.');
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

/** Public release metadata only. No credentials, asset download or installation. */
export class UpdateService {
  private pending: Promise<UpdateCheck> | undefined;
  private download: Download | undefined;
  private readonly fetch: NonNullable<Options['fetch']>;
  private readonly timeoutMs: number;

  constructor(private readonly options: Options) {
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  check(): Promise<UpdateCheck> {
    if (this.pending) return this.pending;
    this.download = undefined;
    this.pending = this.performCheck().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  async openDownload(): Promise<boolean> {
    if (!this.download || !this.options.openExternal) return false;
    try {
      const url = downloadUrl(this.download.url, this.download);
      await this.options.openExternal(url);
      return true;
    } catch {
      return false;
    }
  }

  private result(status: UpdateStatus, message: string, latestVersion?: string): UpdateCheck {
    return {
      status,
      currentVersion: this.options.currentVersion,
      ...(latestVersion ? { latestVersion } : {}),
      message,
    };
  }

  private async performCheck(): Promise<UpdateCheck> {
    const { platform, architecture } = this.options;
    if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(architecture))
      return this.result('unsupported-target', 'Update checks are not available on this device.');
    const current = stableVersion(this.options.currentVersion);
    if (!current) return this.result('unavailable', UPDATE_CHECK_FAILED_MESSAGE);
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 30000)
      return this.result('unavailable', UPDATE_CHECK_FAILED_MESSAGE);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Update check timed out.'));
        }, this.timeoutMs);
      });
      return await Promise.race([this.fetchRelease(current, controller.signal), timeout]);
    } catch {
      return this.result('unavailable', UPDATE_CHECK_FAILED_MESSAGE);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async fetchRelease(current: StableVersion, signal: AbortSignal): Promise<UpdateCheck> {
    const configured = repository(this.options.repository);
    const trusted = new Set([configured]);
    let request = latestApi(`https://api.github.com/repos/${configured}/releases/latest`);
    let transferredById = false;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await this.fetch(request.url.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'GOG-Achievements-Update-Check',
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
      signal.throwIfAborted();
      if (response.url && latestApi(response.url).url.href !== request.url.href)
        throw new Error('Unexpected release API response.');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        if (redirects === MAX_REDIRECTS) throw new Error('Too many repository redirects.');
        const location = response.headers.get('location');
        request = latestApi(
          location?.startsWith('/') && !location.startsWith('//')
            ? `https://api.github.com${location}`
            : location,
        );
        if (request.repository) trusted.add(request.repository);
        else transferredById = true;
        continue;
      }
      if (response.status === 404) {
        void response.body?.cancel().catch(() => {});
        return this.result('no-release', UPDATE_CHECK_FAILED_MESSAGE);
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        throw new Error('The public release API is unavailable.');
      }
      const raw = await bodyJson(response, signal);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid release metadata.');
      const release = raw as Record<string, unknown>;
      const latest = stableVersion(release.tag_name);
      if (
        !latest ||
        release.draft !== false ||
        release.prerelease !== false ||
        !Array.isArray(release.assets)
      )
        throw new Error('No verified stable release.');
      const api = githubUrl(release.url, 'api.github.com');
      const identity = API_RELEASE.exec(api.pathname);
      if (!identity || !Number.isSafeInteger(release.id) || release.id !== Number(identity[2]))
        throw new Error('Invalid release identity.');
      const canonical = repository(identity[1]!);
      if (!trusted.has(canonical) && !transferredById)
        throw new Error('Unexpected release repository.');
      const page = githubUrl(release.html_url, 'github.com');
      if (
        page.pathname.toLowerCase() !==
        `/${canonical}/releases/tag/${String(release.tag_name)}`.toLowerCase()
      )
        throw new Error('Invalid release page.');
      if (!newer(latest, current))
        return this.result('up-to-date', 'Your app is up to date.', latest.value);
      const target = `${this.options.platform === 'darwin' ? 'macos' : 'windows'}-${this.options.architecture}`;
      const asset = `gog-achievements-${latest.value}-${target}.${this.options.platform === 'darwin' ? 'dmg' : 'exe'}`;
      const matches = release.assets.filter(
        (item: unknown) =>
          item && typeof item === 'object' && (item as Record<string, unknown>).name === asset,
      );
      if (matches.length !== 1) throw new Error('Missing or duplicate target installer.');
      const found = matches[0] as Record<string, unknown>;
      if (
        found.state !== 'uploaded' ||
        !Number.isSafeInteger(found.size) ||
        Number(found.size) <= 0
      )
        throw new Error('Invalid installer metadata.');
      const download = { repository: canonical, tag: String(release.tag_name), asset };
      const url = downloadUrl(found.browser_download_url, download);
      signal.throwIfAborted();
      this.download = { ...download, url };
      return {
        ...this.result('available', `Version ${latest.value} is available.`, latest.value),
        downloadUrl: url,
        releaseUrl: page.href,
      };
    }
    throw new Error('No release response.');
  }
}
