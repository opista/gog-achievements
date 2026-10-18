import { join } from 'node:path';
import { CLI_VERSION } from '../../shared/cli-release';
import { disabledCliUpdates, type CliUpdateState } from '../../shared/cli-updates';
import { CliCache, initialState, type CachedCli, type CliCacheState } from './cache';
import { CliReleaseClient, compareVersions, compatibleVersion } from './release-client';
import { verifyCliContract } from './verify';

export interface CliSelection {
  executable: string;
  version: string;
}
interface Options {
  supported: boolean;
  userDataPath: string;
  resolveBundled(): Promise<string>;
  platform?: string;
  architecture?: string;
  client?: Pick<CliReleaseClient, 'latest' | 'download'>;
  verify?: typeof verifyCliContract;
}

/** A session receives one immutable selection. Downloads can only stage a later session. */
export class CliUpdateManager {
  private readonly supported: boolean;
  private readonly target: string;
  private readonly cache: CliCache;
  private readonly client: Pick<CliReleaseClient, 'latest' | 'download'>;
  private readonly verify: typeof verifyCliContract;
  private state: CliCacheState = initialState();
  private selection: CliSelection | undefined;
  private selectedRecord: CachedCli | undefined;
  private phase: CliUpdateState['status'] = 'idle';
  private message = '';
  private fallbackMessage = '';
  private preparing: Promise<CliSelection | undefined> | undefined;
  private checking: Promise<CliUpdateState> | undefined;
  private controller: AbortController | undefined;
  private canUpdate = true;
  private disposed = false;

  constructor(private readonly options: Options) {
    const platform = options.platform ?? process.platform;
    const architecture = options.architecture ?? process.arch;
    this.supported =
      options.supported &&
      ['darwin', 'win32'].includes(platform) &&
      ['arm64', 'x64'].includes(architecture);
    this.target = `${platform === 'darwin' ? 'macos' : 'windows'}-${architecture}`;
    this.cache = new CliCache(options.userDataPath, this.target);
    this.client = options.client ?? new CliReleaseClient();
    this.verify = options.verify ?? verifyCliContract;
  }

  prepare(): Promise<CliSelection | undefined> {
    return (this.preparing ??= this.prepareSession());
  }

  private async prepareSession(): Promise<CliSelection | undefined> {
    if (this.supported) {
      try {
        this.state = await this.cache.load();
      } catch {
        this.state = initialState();
        this.fallbackMessage =
          'The CLI update cache could not be read. The app is using its bundled copy.';
      }
      const candidates = [
        ...(this.state.staged &&
        compareVersions(this.state.staged.version, this.state.active?.version ?? CLI_VERSION) > 0
          ? [this.state.staged]
          : []),
        this.state.active,
        this.state.previous,
      ];
      const attempted = new Set<string>();
      for (const record of candidates) {
        if (
          !record ||
          !compatibleVersion(record.version) ||
          this.state.rejected.includes(record.version) ||
          attempted.has(record.sha256)
        )
          continue;
        attempted.add(record.sha256);
        try {
          const directory = await this.cache.verify(record);
          const executable = join(
            directory,
            this.target.startsWith('windows') ? 'gog-achievements.exe' : 'gog-achievements',
          );
          await this.verify(executable, record.version);
          this.selection = { executable, version: record.version };
          this.selectedRecord = record;
          break;
        } catch {
          this.reject(record.version);
          this.fallbackMessage =
            'A CLI update could not start. The app is using a verified fallback.';
        }
      }
    }
    if (!this.selection) {
      try {
        const executable = await this.options.resolveBundled();
        await this.verify(executable, CLI_VERSION);
        this.selection = { executable, version: CLI_VERSION };
      } catch {
        this.phase = 'unavailable';
        this.message = 'The GOG tools could not start. Reinstall the app, then try again.';
      }
    }
    if (this.supported) {
      const prior = this.state.active;
      this.state.active = this.selectedRecord ?? null;
      this.state.previous =
        prior &&
        compatibleVersion(prior.version) &&
        prior.sha256 !== this.selectedRecord?.sha256 &&
        !this.state.rejected.includes(prior.version)
          ? prior
          : this.state.previous;
      if (
        (this.state.previous && !compatibleVersion(this.state.previous.version)) ||
        this.state.previous?.sha256 === this.selectedRecord?.sha256 ||
        this.state.rejected.includes(this.state.previous?.version ?? '')
      )
        this.state.previous = null;
      this.state.staged = null;
      try {
        await this.cache.save(this.state);
        await this.prune();
      } catch {
        this.canUpdate = false;
        this.phase = 'unavailable';
        this.message =
          'CLI update files could not be saved. The current version will stay in use. Updates will be tried again next launch.';
      }
    }
    return this.selection;
  }

  private reject(version: string): void {
    this.state.rejected = [...new Set([...this.state.rejected, version])].slice(-32);
  }

  snapshot(): CliUpdateState {
    const currentVersion = this.selection?.version ?? CLI_VERSION;
    if (!this.supported) return disabledCliUpdates(currentVersion);
    const result: CliUpdateState = {
      supported: true,
      currentVersion,
      bundledVersion: CLI_VERSION,
      status: this.phase,
      message: this.message || 'Compatible CLI updates are installed automatically.',
    };
    if (this.state.staged && this.phase !== 'checking' && this.phase !== 'downloading') {
      result.status = 'ready';
      result.pendingVersion = this.state.staged.version;
      result.message = `CLI ${this.state.staged.version} is ready. It will be used next time you open the app.`;
    } else if (this.phase === 'idle' && this.fallbackMessage) {
      result.status = 'fallback';
      result.message = this.fallbackMessage;
    }
    return result;
  }

  async check(): Promise<CliUpdateState> {
    await this.prepare();
    if (this.disposed || !this.supported || !this.canUpdate) return this.snapshot();
    if (this.checking) return this.checking;
    const controller = new AbortController();
    this.controller = controller;
    this.checking = this.performCheck(controller.signal).finally(() => {
      this.checking = undefined;
      if (this.controller === controller) this.controller = undefined;
    });
    return this.checking;
  }

  private async performCheck(signal: AbortSignal): Promise<CliUpdateState> {
    this.phase = 'checking';
    this.message = 'Checking for CLI updates…';
    try {
      const release = await this.client.latest(this.target, this.state.rejected, signal);
      signal.throwIfAborted();
      const current = this.state.staged?.version ?? this.selection?.version ?? CLI_VERSION;
      if (!release || compareVersions(release.version, current) <= 0) {
        this.phase = 'idle';
        this.message = 'The CLI is up to date.';
        return this.snapshot();
      }
      this.phase = 'downloading';
      this.message = `Downloading CLI ${release.version}…`;
      const { bytes, sha256 } = await this.client.download(release, signal);
      signal.throwIfAborted();
      const record = await this.cache.install(bytes, release.version, sha256);
      signal.throwIfAborted();
      const executable = join(
        this.cache.directory(record),
        this.target.startsWith('windows') ? 'gog-achievements.exe' : 'gog-achievements',
      );
      await this.verify(executable, record.version);
      signal.throwIfAborted();
      const next = { ...this.state, staged: record };
      await this.cache.save(next);
      this.state = next;
      this.phase = 'idle';
      this.message = '';
      await this.prune();
    } catch {
      if (!signal.aborted && !this.disposed) {
        this.phase = 'unavailable';
        this.message =
          'The CLI update could not be checked or verified. The current version will stay in use. Try again later.';
      }
    }
    return this.snapshot();
  }

  private prune(): Promise<void> {
    return this.cache.prune(
      [this.state.active, this.state.previous, this.state.staged, this.selectedRecord].filter(
        (record): record is CachedCli => record != null,
      ),
    );
  }

  close(): void {
    this.disposed = true;
    this.controller?.abort();
  }
}
