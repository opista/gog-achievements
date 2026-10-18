import { join } from 'node:path';
import { CLI_VERSION } from '../../shared/cli-release';
import { disabledCliUpdates, type CliUpdateState } from '../../shared/cli-updates';
import { DesktopError } from '../errors';
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
  private changes: Promise<void> = Promise.resolve();
  private controller: AbortController | undefined;
  private generation = 0;
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
        this.state = { ...initialState(), automatic: false };
        this.fallbackMessage =
          'Update settings could not be read. Automatic component updates are off.';
      }
      const candidates = this.state.preferBundled
        ? []
        : [
            ...(this.state.automatic &&
            this.state.staged &&
            compareVersions(this.state.staged.version, this.state.active?.version ?? CLI_VERSION) >
              0
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
        this.state.automatic = false;
        this.fallbackMessage =
          'Update files could not be saved. Automatic component updates are off.';
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
      automatic: this.state.automatic,
      currentVersion,
      bundledVersion: CLI_VERSION,
      status: this.phase,
      message:
        this.message ||
        (this.state.automatic
          ? 'Compatible CLI updates are installed automatically.'
          : 'Automatic component updates are off.'),
    };
    if (this.state.preferBundled && currentVersion !== CLI_VERSION) {
      result.status = 'ready';
      result.pendingVersion = CLI_VERSION;
      result.message = `The bundled CLI ${CLI_VERSION} will be used next time you open the app.`;
    } else if (this.state.automatic && this.state.staged) {
      result.status = 'ready';
      result.pendingVersion = this.state.staged.version;
      result.message = `CLI ${this.state.staged.version} is ready. It will be used next time you open the app.`;
    } else if (this.phase === 'idle' && this.fallbackMessage) {
      result.status = 'fallback';
      result.message = this.fallbackMessage;
    }
    return result;
  }

  private change<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.changes.then(action);
    this.changes = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  async setAutomatic(input: { enabled: boolean }): Promise<CliUpdateState> {
    await this.prepare();
    if (!this.supported) return this.snapshot();
    const result = await this.change(async () => {
      const next: CliCacheState = {
        ...this.state,
        automatic: input.enabled,
        preferBundled: input.enabled ? false : this.state.preferBundled,
        staged: input.enabled ? this.state.staged : null,
      };
      try {
        await this.cache.save(next);
      } catch {
        throw new DesktopError(
          'CLI_UPDATE_SETTINGS_FAILED',
          'Update settings could not be saved. Try again.',
        );
      }
      this.state = next;
      this.generation++;
      this.controller?.abort();
      this.phase = 'idle';
      this.message = '';
      return this.snapshot();
    });
    if (input.enabled) {
      void (this.checking ?? Promise.resolve()).then(() => {
        if (!this.disposed && this.state.automatic) void this.check();
      });
    }
    return result;
  }

  async useBundled(): Promise<CliUpdateState> {
    await this.prepare();
    if (!this.supported) return this.snapshot();
    return this.change(async () => {
      const next = { ...this.state, automatic: false, preferBundled: true, staged: null };
      if (this.selection && this.selection.version !== CLI_VERSION)
        next.rejected = [...new Set([...next.rejected, this.selection.version])].slice(-32);
      try {
        await this.cache.save(next);
      } catch {
        throw new DesktopError(
          'CLI_UPDATE_SETTINGS_FAILED',
          'The fallback could not be selected. Try again.',
        );
      }
      this.state = next;
      this.generation++;
      this.controller?.abort();
      this.phase = 'idle';
      this.message = '';
      return this.snapshot();
    });
  }

  async check(manual = false): Promise<CliUpdateState> {
    await this.prepare();
    if (this.disposed || !this.supported || (!manual && !this.state.automatic))
      return this.snapshot();
    if (this.checking) return this.checking;
    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    this.checking = this.performCheck(controller.signal, generation).finally(() => {
      this.checking = undefined;
      if (this.controller === controller) this.controller = undefined;
    });
    return this.checking;
  }

  private async performCheck(signal: AbortSignal, generation: number): Promise<CliUpdateState> {
    this.phase = 'checking';
    this.message = 'Checking for CLI updates…';
    try {
      const release = await this.client.latest(this.target, this.state.rejected, signal);
      signal.throwIfAborted();
      const current = this.state.staged?.version ?? this.selection?.version ?? CLI_VERSION;
      if (!release || compareVersions(release.version, current) <= 0) {
        this.phase = 'idle';
        this.message = this.state.automatic
          ? 'The CLI is up to date.'
          : 'Automatic component updates are off.';
        return this.snapshot();
      }
      if (!this.state.automatic) {
        this.phase = 'available';
        this.message = `CLI ${release.version} is available. Enable automatic component updates to download it.`;
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
      await this.change(async () => {
        if (generation !== this.generation || !this.state.automatic || this.disposed) return;
        const next = { ...this.state, staged: record };
        await this.cache.save(next);
        this.state = next;
        this.phase = 'idle';
        this.message = '';
        await this.prune();
      });
    } catch {
      if (!signal.aborted && generation === this.generation && !this.disposed) {
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
