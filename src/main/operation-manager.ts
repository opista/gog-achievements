import { randomUUID } from 'node:crypto';
import type {
  AuthStatus,
  DesktopApi,
  OperationState,
  OperationRecord,
  Queue,
  Report,
  PreviewResult,
  ApplyResult,
  SelectionInput,
  DatesInput,
  GamesData,
  AchievementsData,
  InitializeResult,
} from '../shared/api';
import {
  authSchema,
  gamesSchema,
  achievementsSchema,
  queueSchema,
  reportSchema,
  idSchema,
  selectionSchema,
  datesSchema,
  tokenSchema,
  historyInputSchema,
} from '../shared/schemas';
import { QueueStore, digestBytes, type StoredOperation } from './queue-store';
import type { CliRunner, CliCommand } from './cli-client';
import { requireSuccess } from './cli-client';
import { DesktopError, publicError, cliError } from './errors';
import { NativeProcessProbe, type ProcessProbe } from './process-identity';
import { CLI_VERSION } from '../shared/cli-release';
import { isConfirmedUnlock, sameQueueRequest } from '../shared/queue-cleanup';
interface Preview {
  token: string;
  path: string;
  draft: string;
  digest: string;
  queue: Queue;
  report: Report;
}
export class OperationManager implements DesktopApi {
  readonly isDemo = false;
  private operation: OperationState = { kind: 'idle' };
  private listeners = new Set<(state: OperationState) => void>();
  private auth: AuthStatus = { authenticated: false };
  private previews = new Map<string, Preview>();
  private recoveryLoaded: Promise<void> | null = null;
  private recoveryCheck: Promise<void> | null = null;
  private recovering: StoredOperation[] = [];
  constructor(
    private readonly cli: CliRunner,
    private readonly store: QueueStore,
    private readonly version: string,
    private readonly cliVersion = CLI_VERSION,
    private readonly probe: ProcessProbe = new NativeProcessProbe(),
  ) {}
  get currentOperation(): OperationState {
    return { ...this.operation };
  }
  onOperation(listener: (state: OperationState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private setOperation(state: OperationState): void {
    this.operation = state;
    for (const listener of this.listeners) {
      try {
        listener({ ...state });
      } catch {
        /* A disconnected observer must not interrupt a write. */
      }
    }
  }
  private async run<T>(
    kind: OperationState['kind'],
    action: () => Promise<T>,
    gameId?: string,
  ): Promise<T> {
    await this.ensureRecovery();
    if (this.operation.kind === 'recovery') await this.recover();
    if (this.operation.kind !== 'idle')
      throw new DesktopError('BUSY', 'Another operation is active. Wait for its result.');
    this.setOperation({ kind, ...(gameId ? { gameId } : {}), startedAt: new Date().toISOString() });
    try {
      return await action();
    } finally {
      if (this.currentOperation.kind !== 'recovery') this.setOperation({ kind: 'idle' });
    }
  }
  private async read(command: CliCommand): Promise<unknown> {
    return requireSuccess(await this.cli.run(command));
  }
  private async account(): Promise<string> {
    const auth = authSchema.parse(await this.read({ kind: 'auth-status' })) as AuthStatus;
    if (auth.user_id !== this.auth.user_id || auth.authenticated !== this.auth.authenticated)
      this.previews.clear();
    this.auth = auth;
    if (!auth.authenticated || !auth.user_id)
      throw new DesktopError('AUTH_REQUIRED', 'Sign in to GOG to continue.');
    return auth.user_id;
  }
  private assertAccount(userId: string, expected: string): void {
    if (userId !== expected) {
      this.previews.clear();
      throw new DesktopError('ACCOUNT_CHANGED', 'The GOG account changed. Load the library again.');
    }
  }
  private invalidate(): void {
    this.previews.clear();
  }
  private async ensureRecovery(): Promise<void> {
    this.recoveryLoaded ??= (async () => {
      this.recovering = (await this.store.operations()).filter(
        (record) => record.state === 'running',
      );
      if (this.recovering.length) await this.recover();
    })().catch((error: unknown) => {
      this.recoveryLoaded = null;
      throw error;
    });
    await this.recoveryLoaded;
  }
  private async recover(): Promise<void> {
    this.recoveryCheck ??= this.inspectRecovery().finally(() => {
      this.recoveryCheck = null;
    });
    await this.recoveryCheck;
  }
  private async inspectRecovery(): Promise<void> {
    let active: StoredOperation | undefined;
    for (const record of this.recovering) {
      const status = await this.probe.find(
        this.store.snapshotPath(record.user_id, record.id),
        record.process,
      );
      if (status.state !== 'gone') {
        active ??= record;
        continue;
      }
      record.state = 'unknown';
      record.finished_at = new Date().toISOString();
      record.error = {
        code: 'INTERRUPTED',
        message:
          'The operation ended without a saved result. Check current state before another apply.',
      };
      await this.store.saveOperation(record);
    }
    this.recovering = this.recovering.filter((record) => record.state === 'running');
    if (active)
      this.setOperation({
        kind: 'recovery',
        operationId: active.id,
        gameId: active.game_id,
        startedAt: active.started_at,
        message: 'A previous operation may still be active. Waiting for it to finish.',
      });
    else this.setOperation({ kind: 'idle' });
  }
  async refreshRecovery(): Promise<void> {
    if (this.operation.kind === 'recovery') await this.recover();
  }
  async initialize(): Promise<InitializeResult> {
    await this.ensureRecovery();
    if (this.operation.kind === 'recovery') await this.recover();
    if (this.operation.kind === 'recovery')
      return {
        version: this.version,
        cliVersion: this.cliVersion,
        auth: { authenticated: false },
        operation: this.currentOperation,
      };
    return this.run('read', async () => {
      const help = (await this.read({ kind: 'help' })) as { version?: unknown };
      if (help.version !== this.cliVersion)
        throw new DesktopError(
          'CLI_VERSION_MISMATCH',
          'The bundled CLI version does not match this app.',
        );
      const doctor = (await this.read({ kind: 'doctor' })) as {
        supported?: unknown;
        credentials_available?: unknown;
      };
      if (doctor.supported !== true)
        throw new DesktopError(
          'UNSUPPORTED_PLATFORM',
          'The bundled CLI does not support this platform.',
        );
      this.auth = authSchema.parse(await this.read({ kind: 'auth-status' })) as AuthStatus;
      return {
        version: this.version,
        cliVersion: this.cliVersion,
        auth: this.auth,
        operation: { kind: 'idle' as const },
      };
    });
  }
  async login(): Promise<AuthStatus> {
    return this.run('login', async () => {
      this.invalidate();
      this.auth = authSchema.parse(await this.read({ kind: 'auth-login' })) as AuthStatus;
      return this.auth;
    });
  }
  async logout(): Promise<AuthStatus> {
    return this.run('read', async () => {
      this.invalidate();
      this.auth = authSchema.parse(await this.read({ kind: 'auth-logout' })) as AuthStatus;
      return this.auth;
    });
  }
  async listGames(): Promise<GamesData> {
    return this.run('read', async () => {
      const account = await this.account();
      const data = gamesSchema.parse(await this.read({ kind: 'games' })) as GamesData;
      this.assertAccount(data.user_id, account);
      return data;
    });
  }
  async listAchievements(gameId: string): Promise<AchievementsData> {
    return this.run('read', () => this.achievementData(idSchema.parse(gameId)), gameId);
  }
  private async achievementData(gameId: string): Promise<AchievementsData> {
    const account = await this.account();
    const data = achievementsSchema.parse(
      await this.read({ kind: 'achievements', gameId }),
    ) as AchievementsData;
    this.assertAccount(data.user_id, account);
    if (data.game.id !== gameId)
      throw new DesktopError('GAME_CHANGED', 'The returned game did not match the request.');
    return data;
  }
  private async queue(gameId: string, account: string): Promise<Queue | null> {
    const path = await this.store.draftPath(account, gameId);
    if (!(await this.store.exists(path))) return null;
    const queue = queueSchema.parse(await this.read({ kind: 'queue-show', file: path })) as Queue;
    this.assertAccount(queue.user_id, account);
    if (queue.game.id !== gameId)
      throw new DesktopError('GAME_CHANGED', 'The saved queue does not match this game.');
    return queue;
  }
  async getQueue(gameId: string): Promise<Queue | null> {
    return this.run(
      'read',
      async () => {
        const id = idSchema.parse(gameId);
        const account = await this.account();
        const queue = await this.queue(id, account);
        if (!queue?.items.length || !(await this.reconcileSavedResults(queue))) return queue;
        try {
          return await this.queue(id, account);
        } catch {
          // Housekeeping must not hide the last readable draft.
          return queue;
        }
      },
      gameId,
    );
  }
  async listQueues(): Promise<Queue[]> {
    return this.run('read', async () => {
      const account = await this.account();
      const drafts = await this.store.drafts(account);
      const records = drafts.some((queue) => queue.items.length)
        ? await this.store.operations(account).catch(() => [])
        : [];
      let cleaned = false;
      for (const draft of drafts.filter((queue) => queue.items.length))
        cleaned = (await this.reconcileSavedResults(draft, records)) || cleaned;
      return (cleaned ? await this.store.drafts(account) : drafts).filter(
        (queue) => queue.items.length,
      );
    });
  }
  private async reconcileSavedResults(
    draft: Queue,
    savedRecords?: StoredOperation[],
  ): Promise<boolean> {
    const records = savedRecords ?? (await this.store.operations(draft.user_id).catch(() => []));
    const current = new Map(draft.items.map((item) => [item.achievement_id, item]));
    const seen = new Set<string>();
    let cleaned = false;
    for (const record of records.filter((item) => item.game_id === draft.game.id)) {
      try {
        const bytes = await this.store.bytes(this.store.snapshotPath(record.user_id, record.id));
        if (digestBytes(bytes) !== record.digest) break;
        const reviewed = queueSchema.parse(JSON.parse(bytes.toString('utf8'))) as Queue;
        if (
          reviewed.user_id !== draft.user_id ||
          reviewed.game.id !== draft.game.id ||
          reviewed.game.client_id !== draft.game.client_id
        )
          break;
        if (record.report) this.validateReport(record.report, reviewed, false);
        const items = reviewed.items.filter((item) => {
          const saved = current.get(item.achievement_id);
          return saved && !seen.has(item.achievement_id) && sameQueueRequest(saved, item);
        });
        for (const item of items) seen.add(item.achievement_id);
        // A newer unknown or unresolved attempt protects its matching requests.
        if (record.state !== 'complete' || !record.report) continue;
        const confirmed = new Set(
          record.report.results.filter(isConfirmedUnlock).map((item) => item.achievement_id),
        );
        const completed = items.filter((item) => confirmed.has(item.achievement_id));
        if (!completed.length) continue;
        await this.store.clearConfirmedItems({ ...reviewed, items: completed }, record.report);
        cleaned = true;
      } catch {
        // Missing evidence or a busy draft stops housekeeping, without a new apply.
        break;
      }
    }
    return cleaned;
  }
  private async mutate(input: SelectionInput, kind: 'queue-add' | 'queue-remove'): Promise<Queue> {
    const parsed = selectionSchema.parse(input);
    return this.run(
      'read',
      async () => {
        this.invalidate();
        const account = await this.account();
        const file = await this.store.draftPath(account, parsed.gameId);
        const exists = await this.store.exists(file);
        if (!exists && kind === 'queue-remove')
          throw new DesktopError('QUEUE_MISSING', 'There is no saved queue for this game.');
        const command: CliCommand = !exists
          ? {
              kind: 'queue-create',
              file,
              gameId: parsed.gameId,
              achievementIds: parsed.achievementIds,
            }
          : { kind, file, achievementIds: parsed.achievementIds };
        const queue = queueSchema.parse(await this.read(command)) as Queue;
        this.assertAccount(queue.user_id, account);
        if (queue.game.id !== parsed.gameId)
          throw new DesktopError('GAME_CHANGED', 'The returned queue does not match this game.');
        return queue;
      },
      parsed.gameId,
    );
  }
  addAchievements(input: SelectionInput): Promise<Queue> {
    return this.mutate(input, 'queue-add');
  }
  removeAchievements(input: SelectionInput): Promise<Queue> {
    return this.mutate(input, 'queue-remove');
  }
  async setDates(input: DatesInput): Promise<Queue> {
    const parsed = datesSchema.parse(input);
    return this.run(
      'read',
      async () => {
        this.invalidate();
        const account = await this.account();
        const queue = await this.queue(parsed.gameId, account);
        if (!queue)
          throw new DesktopError('QUEUE_MISSING', 'There is no saved queue for this game.');
        const live = achievementsSchema.parse(
          await this.read({ kind: 'achievements', gameId: parsed.gameId }),
        ) as AchievementsData;
        this.assertAccount(live.user_id, account);
        if (live.game.id !== parsed.gameId || live.game.client_id !== queue.game.client_id)
          throw new DesktopError(
            'GAME_CHANGED',
            'The game metadata changed. Review the queue again.',
          );
        const known = new Set(queue.items.map((item) => item.achievement_id));
        if (Object.keys(parsed.dates).some((id) => !known.has(id)))
          throw new DesktopError(
            'ACHIEVEMENT_NOT_QUEUED',
            'A selected achievement is not in the queue.',
          );
        const unlocked = new Set(
          live.achievements.filter((item) => item.unlocked).map((item) => item.id),
        );
        if (Object.keys(parsed.dates).some((id) => unlocked.has(id)))
          throw new DesktopError('ALREADY_UNLOCKED', 'An existing unlock date cannot be changed.');
        const groups = new Map<string, string[]>();
        for (const [id, date] of Object.entries(parsed.dates)) {
          const group = groups.get(date) ?? [];
          group.push(id);
          groups.set(date, group);
        }
        const file = await this.store.draftPath(account, parsed.gameId);
        let result = queue;
        for (const [timestamp, achievementIds] of groups)
          result = queueSchema.parse(
            await this.read({ kind: 'queue-date', file, achievementIds, timestamp }),
          ) as Queue;
        return result;
      },
      parsed.gameId,
    );
  }
  async preview({ gameId }: { gameId: string }): Promise<PreviewResult> {
    gameId = idSchema.parse(gameId);
    return this.run(
      'read',
      async () => {
        this.invalidate();
        const account = await this.account();
        const queue = await this.queue(gameId, account);
        if (!queue?.items.length)
          throw new DesktopError('EMPTY_QUEUE', 'Add an achievement to the queue first.');
        const token = randomUUID();
        const draft = await this.store.draftPath(account, gameId);
        const snapshot = await this.store.snapshot(account, token, draft);
        const report = reportSchema.parse(
          await this.read({ kind: 'queue-preview', file: snapshot.path }),
        ) as Report;
        this.assertAccount(report.user_id, account);
        this.validateReport(report, queue, true);
        this.previews.set(token, {
          token,
          path: snapshot.path,
          draft,
          digest: snapshot.digest,
          queue,
          report,
        });
        return { token, report };
      },
      gameId,
    );
  }
  private validateReport(report: Report, queue: Queue, dryRun: boolean): void {
    const rowsMatch =
      report.results.length === queue.items.length &&
      report.results.every(
        (row, index) =>
          row.achievement_id === queue.items[index]?.achievement_id &&
          Date.parse(row.requested_unlocked_at) === Date.parse(queue.items[index]!.unlocked_at),
      );
    if (
      report.dry_run !== dryRun ||
      report.user_id !== queue.user_id ||
      report.game.id !== queue.game.id ||
      report.game.client_id !== queue.game.client_id ||
      !rowsMatch
    )
      throw new DesktopError(
        'INVALID_REPORT',
        'The CLI report did not match the reviewed queue. Check current state before another apply.',
      );
  }
  async apply({ previewToken }: { previewToken: string }): Promise<ApplyResult> {
    tokenSchema.parse(previewToken);
    return this.run('apply', async () => {
      const preview = this.previews.get(previewToken);
      if (!preview)
        throw new DesktopError('STALE_PREVIEW', 'Preview the queue again before applying.');
      this.previews.delete(previewToken);
      const account = await this.account();
      this.assertAccount(account, preview.queue.user_id);
      if (
        digestBytes(await this.store.bytes(preview.path)) !== preview.digest ||
        digestBytes(await this.store.bytes(preview.draft)) !== preview.digest
      )
        throw new DesktopError(
          'STALE_PREVIEW',
          'The queue changed. Preview it again before applying.',
        );
      if (!preview.report.results.some((item) => item.status === 'pending'))
        throw new DesktopError(
          'NOTHING_TO_APPLY',
          'All selected achievements are already unlocked.',
        );
      const record: StoredOperation = {
        id: previewToken,
        user_id: account,
        game_id: preview.queue.game.id,
        game_title: preview.queue.game.title,
        started_at: new Date().toISOString(),
        finished_at: null,
        state: 'running',
        report: null,
        digest: preview.digest,
        process: null,
      };
      await this.store.saveOperation(record);
      this.setOperation({
        kind: 'apply',
        operationId: record.id,
        gameId: record.game_id,
        startedAt: record.started_at,
      });
      try {
        const outcome = await this.cli.run(
          { kind: 'queue-apply', file: preview.path },
          async () => {
            const found = await this.probe.find(preview.path);
            if (found.state === 'alive') record.process = found.identity;
            await this.store.saveOperation(record);
          },
        );
        const raw = outcome.result.ok
          ? outcome.result.data
          : outcome.exitCode === 6 && outcome.result.error.code === 'APPLY_INCOMPLETE'
            ? (outcome.result.error.details as { report?: unknown } | undefined)?.report
            : undefined;
        if (raw !== undefined) {
          const report = reportSchema.parse(raw) as Report;
          this.assertAccount(report.user_id, account);
          this.validateReport(report, preview.queue, false);
          if ((outcome.exitCode === 0) !== report.complete)
            throw new DesktopError(
              'INVALID_APPLY_REPORT',
              'The result status did not match the CLI exit code.',
            );
          record.report = report;
          record.state = 'complete';
          if (!report.complete) record.error = publicError(cliError('APPLY_INCOMPLETE'));
        } else {
          record.state = 'unknown';
          record.error = outcome.result.ok
            ? { code: 'INVALID_APPLY_REPORT', message: 'No valid apply report was returned.' }
            : publicError(cliError(outcome.result.error.code));
        }
      } catch (error) {
        record.state = 'unknown';
        record.error = publicError(error);
      }
      record.finished_at = new Date().toISOString();
      try {
        await this.store.saveOperation(record);
      } catch {
        throw new DesktopError(
          'REPORT_SAVE_FAILED',
          'The result could not be saved. Check current state before another apply.',
        );
      }
      if (record.report) {
        try {
          await this.store.clearConfirmedItems(preview.queue, record.report);
        } catch {
          record.error = {
            code: 'QUEUE_CLEANUP_FAILED',
            message:
              'The result was saved, but queue cleanup could not finish. Review the queue before another apply.',
          };
          // The confirmed report is already durable even if saving this warning fails.
          await this.store.saveOperation(record).catch(() => {});
        }
      }
      return {
        operationId: record.id,
        state: record.state === 'complete' ? 'complete' : 'unknown',
        report: record.report,
        ...(record.error ? { error: record.error } : {}),
      };
    });
  }
  async history(input: { gameId?: string }): Promise<OperationRecord[]> {
    const { gameId } = historyInputSchema.parse(input);
    return this.run(
      'read',
      async () => {
        const account = await this.account();
        return (await this.store.operations(account))
          .filter((record) => gameId === undefined || record.game_id === gameId)
          .map((record) => this.store.publicRecord(record));
      },
      gameId,
    );
  }
  async checkCurrentState({ gameId }: { gameId: string }): Promise<AchievementsData> {
    this.invalidate();
    return this.listAchievements(gameId);
  }
}
