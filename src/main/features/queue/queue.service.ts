import { Inject, Injectable } from '@nestjs/common';
import type {
  Queue,
  SelectionInput,
  AdditionInput,
  DatesInput,
  AchievementsData,
} from '../../../shared/api';
import {
  idSchema,
  queueSchema,
  selectionSchema,
  additionSchema,
  datesSchema,
  achievementsSchema,
} from '../../../shared/schemas';
import { isConfirmedChange, sameQueueRequest } from '../../../shared/queue-cleanup';
import { QueueStore, digestBytes, type StoredOperation } from '../../queue-store';
import { requireSuccess, type CliRunner, type CliCommand } from '../../cli-client';
import { DesktopError } from '../../errors';
import { CLI_RUNNER } from '../../workspace.tokens';
import { SessionService } from '../account/session.service';
import { PreviewStore } from '../../application/preview-store';
import { validateReport } from '../../application/report-validation';
@Injectable()
export class QueueService {
  constructor(
    @Inject(CLI_RUNNER) private readonly cli: CliRunner,
    @Inject(QueueStore) private readonly store: QueueStore,
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(PreviewStore) private readonly previews: PreviewStore,
  ) {}
  private async read(command: CliCommand): Promise<unknown> {
    return requireSuccess(await this.cli.run(command));
  }
  async readQueue(gameId: string, account: string): Promise<Queue | null> {
    const path = await this.store.draftPath(account, gameId);
    if (!(await this.store.exists(path))) return null;
    const queue = queueSchema.parse(await this.read({ kind: 'queue-show', file: path })) as Queue;
    this.session.assertOwner(queue.user_id, account);
    if (queue.game.id !== gameId)
      throw new DesktopError(
        'GAME_CHANGED',
        "This game's queue could not be loaded. Refresh your library and try again.",
      );
    return queue;
  }

  async get(gameId: string): Promise<Queue | null> {
    const id = idSchema.parse(gameId);
    const account = await this.session.requireAccount();
    const queue = await this.readQueue(id, account);
    if (!queue?.items.length || !(await this.reconcileSavedResults(queue))) return queue;
    try {
      return await this.readQueue(id, account);
    } catch (failure) {
      if (
        failure instanceof DesktopError &&
        ['ACCOUNT_CHANGED', 'GAME_CHANGED'].includes(failure.code)
      )
        throw failure;
      // Housekeeping must not hide the last readable draft.
      return queue;
    }
  }
  async list(): Promise<Queue[]> {
    const account = await this.session.requireAccount();
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
        if (record.report) validateReport(record.report, reviewed, false);
        const items = reviewed.items.filter((item) => {
          const saved = current.get(item.achievement_id);
          return saved && !seen.has(item.achievement_id) && sameQueueRequest(saved, item);
        });
        for (const item of items) seen.add(item.achievement_id);
        // A newer unknown or unresolved attempt protects its matching requests.
        if (record.state !== 'complete' || !record.report) continue;
        const confirmed = new Set(
          record.report.results.filter(isConfirmedChange).map((item) => item.achievement_id),
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

  private async mutate(input: AdditionInput, kind: 'queue-add' | 'queue-remove'): Promise<Queue> {
    const parsed: AdditionInput =
      kind === 'queue-add' ? additionSchema.parse(input) : selectionSchema.parse(input);
    const action = parsed.action;
    if (action === 'lock') await this.session.requireLockSupport();
    await this.previews.clear();
    const account = await this.session.requireAccount();
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
          ...(action ? { action } : {}),
        }
      : kind === 'queue-add'
        ? { kind, file, achievementIds: parsed.achievementIds, ...(action ? { action } : {}) }
        : { kind, file, achievementIds: parsed.achievementIds };
    const queue = queueSchema.parse(await this.read(command)) as Queue;
    this.session.assertOwner(queue.user_id, account);
    if (queue.game.id !== parsed.gameId)
      throw new DesktopError(
        'GAME_CHANGED',
        "This game's queue could not be loaded. Refresh your library and try again.",
      );
    return queue;
  }
  add(input: AdditionInput): Promise<Queue> {
    return this.mutate(input, 'queue-add');
  }
  remove(input: SelectionInput): Promise<Queue> {
    return this.mutate(input, 'queue-remove');
  }
  async setDates(input: DatesInput): Promise<Queue> {
    const parsed = datesSchema.parse(input);
    await this.previews.clear();
    const account = await this.session.requireAccount();
    const queue = await this.readQueue(parsed.gameId, account);
    if (!queue) throw new DesktopError('QUEUE_MISSING', 'There is no saved queue for this game.');
    if (
      queue.items.some(
        (item) => item.action === 'lock' && Object.hasOwn(parsed.dates, item.achievement_id),
      )
    )
      throw new DesktopError(
        'INVALID_DATE_EDIT',
        'Only queued unlocks can have their dates edited.',
      );
    const live = achievementsSchema.parse(
      await this.read({ kind: 'achievements', gameId: parsed.gameId }),
    ) as AchievementsData;
    this.session.assertOwner(live.user_id, account);
    if (live.game.id !== parsed.gameId || live.game.client_id !== queue.game.client_id)
      throw new DesktopError(
        'GAME_CHANGED',
        "This game's achievement list changed. Remove its queued achievements and add them again.",
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
    for (const [timestamp, achievementIds] of groups) {
      result = queueSchema.parse(
        await this.read({ kind: 'queue-date', file, achievementIds, timestamp }),
      ) as Queue;
      this.session.assertOwner(result.user_id, account);
      if (result.game.id !== parsed.gameId || result.game.client_id !== queue.game.client_id)
        throw new DesktopError(
          'GAME_CHANGED',
          "This game's queue no longer matches the saved request. Refresh your library.",
        );
    }
    return result;
  }
}
