import { Inject, Injectable } from '@nestjs/common';
import type {
  WorkspaceApi,
  InitializeResult,
  OperationState,
  SelectionInput,
  AdditionInput,
  DatesInput,
} from '../shared/api';
import { OperationCoordinator } from './application/operation-coordinator';
import { SessionService } from './features/account/session.service';
import { LibraryService } from './features/library/library.service';
import { QueueService } from './features/queue/queue.service';
import { ApplyService } from './features/apply/apply.service';
import { HistoryService } from './features/history/history.service';
import { RecoveryService } from './features/recovery/recovery.service';
import { WORKSPACE_VERSIONS, type WorkspaceVersions } from './workspace.tokens';

// The only exported feature API. Every route uses the same recovery gate and lock.
@Injectable()
export class WorkspaceService implements WorkspaceApi {
  readonly isDemo = false;
  constructor(
    @Inject(OperationCoordinator) private readonly operations: OperationCoordinator,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(ApplyService) private readonly changes: ApplyService,
    @Inject(HistoryService) private readonly records: HistoryService,
    @Inject(WORKSPACE_VERSIONS) private readonly versions: WorkspaceVersions,
  ) {}
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
