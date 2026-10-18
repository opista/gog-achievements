import { Inject, Injectable } from '@nestjs/common';
import type {
  WorkspaceApi,
  InitializeResult,
  OperationState,
  SelectionInput,
  AdditionInput,
  DatesInput,
  ExportInput,
} from '../shared/api';
import { OperationCoordinator } from './application/operation-coordinator';
import { SessionService } from './features/account/session.service';
import { LibraryService } from './features/library/library.service';
import { QueueService } from './features/queue/queue.service';
import { ApplyService } from './features/apply/apply.service';
import { HistoryService } from './features/history/history.service';
import { RecoveryService } from './features/recovery/recovery.service';
import { WORKSPACE_VERSIONS, type WorkspaceVersions } from './workspace.tokens';
import { CliRuntime } from './application/cli-runtime';
import { PreviewStore } from './application/preview-store';
import type { CliActivation } from './cli-updates/manager';

// The only exported feature API. Every route uses the same recovery gate and lock.
@Injectable()
export class WorkspaceService implements WorkspaceApi {
  readonly isDemo = false;
  private activationBlocked = false;
  private activating: Promise<boolean> | undefined;
  constructor(
    @Inject(OperationCoordinator) private readonly operations: OperationCoordinator,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(ApplyService) private readonly changes: ApplyService,
    @Inject(HistoryService) private readonly records: HistoryService,
    @Inject(WORKSPACE_VERSIONS) private readonly versions: WorkspaceVersions,
    @Inject(CliRuntime) private readonly runtime: CliRuntime,
    @Inject(PreviewStore) private readonly previews: PreviewStore,
  ) {}
  async setCliActivationBlocked({ blocked }: { blocked: boolean }): Promise<void> {
    this.activationBlocked = blocked;
    if (blocked) await this.activating;
    else if (this.operations.current.kind === 'idle') this.operations.publish({ kind: 'idle' });
  }
  activateCli(activation: CliActivation): Promise<boolean> {
    if (this.activating) return this.activating;
    if (this.activationBlocked || this.previews.pending || this.operations.current.kind !== 'idle')
      return Promise.resolve(false);
    this.activating = this.operations
      .run('read', async () => {
        await activation.verify();
        const runner = this.runtime.create(activation.selection);
        const info = await this.session.inspectCli(runner, activation.selection.version);
        await activation.commit();
        this.runtime.replace(runner);
        this.session.acceptCli(info);
        this.operations.setCli(info);
        return true;
      })
      .finally(() => {
        this.activating = undefined;
      });
    return this.activating;
  }
  get currentOperation(): OperationState {
    return this.operations.current;
  }
  onOperation(listener: (state: OperationState) => void): () => void {
    return this.operations.onOperation(listener);
  }
  private async run<T>(
    kind: 'read' | 'login' | 'apply',
    action: () => Promise<T>,
    gameId?: string,
  ): Promise<T> {
    await this.recovery.ensure();
    await this.recovery.refresh();
    return this.operations.run(kind, action, gameId);
  }
  async initialize(): Promise<InitializeResult> {
    await this.recovery.ensure();
    await this.recovery.refresh();
    if (this.operations.current.kind === 'recovery')
      return {
        version: this.versions.app,
        cliVersion: this.versions.cli,
        auth: { authenticated: false },
        operation: this.operations.current,
      };
    return this.run('read', () => this.session.initialize());
  }
  login() {
    return this.run('login', () => this.session.login());
  }
  logout() {
    return this.run('read', () => this.session.logout());
  }
  listGames() {
    return this.run('read', () => this.library.games());
  }
  listAchievements(gameId: string) {
    return this.run('read', () => this.library.achievements(gameId), gameId);
  }
  exportAchievements(input: ExportInput) {
    return this.run('read', () => this.library.exportAchievements(input), input.gameId);
  }
  getQueue(gameId: string) {
    return this.run('read', () => this.queues.get(gameId), gameId);
  }
  listQueues() {
    return this.run('read', () => this.queues.list());
  }
  addAchievements(input: AdditionInput) {
    return this.run('read', () => this.queues.add(input), input.gameId);
  }
  removeAchievements(input: SelectionInput) {
    return this.run('read', () => this.queues.remove(input), input.gameId);
  }
  setDates(input: DatesInput) {
    return this.run('read', () => this.queues.setDates(input), input.gameId);
  }
  preview(input: { gameId: string }) {
    return this.run('read', () => this.changes.preview(input), input.gameId);
  }
  async cancelPreview({ previewToken }: { previewToken: string }): Promise<void> {
    this.previews.discard(previewToken);
    if (this.operations.current.kind === 'idle') this.operations.publish({ kind: 'idle' });
  }
  apply(input: { previewToken: string }) {
    return this.run('apply', () => this.changes.apply(input));
  }
  history(input: { gameId?: string }) {
    return this.run('read', () => this.records.list(input), input.gameId);
  }
  checkCurrentState(input: { gameId: string }) {
    return this.run('read', () => this.library.checkCurrentState(input), input.gameId);
  }
}
