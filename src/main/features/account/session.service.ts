import { Inject, Injectable } from '@nestjs/common';
import type { AuthStatus, InitializeResult } from '../../../shared/api';
import { authSchema } from '../../../shared/schemas';
import { requireSuccess, type CliRunner, type CliCommand } from '../../cli-client';
import { DesktopError } from '../../errors';
import { CLI_RUNNER, WORKSPACE_VERSIONS, type WorkspaceVersions } from '../../workspace.tokens';
import { PreviewStore } from '../../application/preview-store';
@Injectable()
export class SessionService {
  private auth: AuthStatus = { authenticated: false };
  private supportsLocking: boolean | undefined;
  constructor(
    @Inject(CLI_RUNNER) private readonly cli: CliRunner,
    @Inject(PreviewStore) private readonly previews: PreviewStore,
    @Inject(WORKSPACE_VERSIONS) private readonly versions: WorkspaceVersions,
  ) {}
  private async read(command: CliCommand): Promise<unknown> {
    return requireSuccess(await this.cli.run(command));
  }
  private accept(auth: AuthStatus): AuthStatus {
    if (auth.user_id !== this.auth.user_id || auth.authenticated !== this.auth.authenticated)
      this.previews.clear();
    this.auth = auth;
    return auth;
  }
  private async inspectHelp(): Promise<void> {
    const help = (await this.read({ kind: 'help' })) as {
      version?: unknown;
      commands?: { command?: unknown; flags?: unknown }[];
    };
    if (help.version !== this.versions.cli)
      throw new DesktopError(
        'CLI_VERSION_MISMATCH',
        'Some app files do not match. Reinstall the app.',
      );
    this.supportsLocking = ['queue create', 'queue add'].every(
      (command) =>
        Array.isArray(help.commands) &&
        help.commands.some(
          (entry) =>
            entry?.command === command &&
            Array.isArray(entry.flags) &&
            entry.flags.includes('action'),
        ),
    );
  }
  async requireLockSupport(): Promise<void> {
    if (this.supportsLocking === undefined) await this.inspectHelp();
    if (!this.supportsLocking)
      throw new DesktopError(
        'CLI_UPDATE_REQUIRED',
        'Locking achievements needs a newer CLI. Update the app to continue.',
      );
  }
  async initialize(): Promise<InitializeResult> {
    await this.inspectHelp();
    const doctor = (await this.read({ kind: 'doctor' })) as {
      supported?: unknown;
      credentials_available?: unknown;
    };
    if (doctor.supported !== true)
      throw new DesktopError(
        'UNSUPPORTED_PLATFORM',
        'This app does not support your computer. Download the version for your system.',
      );
    this.accept(authSchema.parse(await this.read({ kind: 'auth-status' })));
    return {
      version: this.versions.app,
      cliVersion: this.versions.cli,
      supportsLocking: this.supportsLocking,
      auth: this.auth,
      operation: { kind: 'idle' as const },
    };
  }
  async login(): Promise<AuthStatus> {
    this.previews.clear();
    return this.accept(authSchema.parse(await this.read({ kind: 'auth-login' })));
  }
  async logout(): Promise<AuthStatus> {
    this.previews.clear();
    return this.accept(authSchema.parse(await this.read({ kind: 'auth-logout' })));
  }
  async requireAccount(): Promise<string> {
    const auth = this.accept(authSchema.parse(await this.read({ kind: 'auth-status' })));
    if (!auth.authenticated || !auth.user_id)
      throw new DesktopError('AUTH_REQUIRED', 'Sign in to GOG to continue.');
    return auth.user_id;
  }
  assertOwner(userId: string, expected: string): void {
    if (userId !== expected) {
      this.previews.clear();
      throw new DesktopError('ACCOUNT_CHANGED', 'Your GOG account changed. Refresh your library.');
    }
  }
}
