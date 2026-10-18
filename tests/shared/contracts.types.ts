import type { z } from 'zod';
import type {
  Achievement,
  AdditionInput,
  AuthStatus,
  ExportInput,
  Game,
  HistoryInput,
  LockQueueItem,
  LockReportItem,
  Queue,
  QueueItem,
  Report,
  ReportItem,
  UnlockQueueItem,
  UnlockReportItem,
} from '../../src/shared/api';
import type { queueSchema, reportSchema } from '../../src/shared/schemas';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Optional<T, K extends keyof T> = Record<never, never> extends Pick<T, K> ? true : false;

// Compiled by typecheck. These protect contracts that can drift when schemas are inferred.
export type DataContractChecks = [
  Assert<Equal<Optional<Achievement, 'rarity'>, false>>,
  Assert<Equal<Achievement['rarity'], unknown>>,
  Assert<Equal<Optional<Game, 'works_on'>, true>>,
  Assert<Equal<Optional<AuthStatus, 'user_id'>, true>>,
  Assert<Equal<Optional<AdditionInput, 'action'>, true>>,
  Assert<Equal<Optional<ExportInput, 'search'>, true>>,
  Assert<Equal<Optional<HistoryInput, 'gameId'>, true>>,
  Assert<Equal<UnlockQueueItem['action'], 'unlock' | undefined>>,
  Assert<Equal<LockQueueItem['action'], 'lock'>>,
  Assert<Equal<LockQueueItem['unlocked_at'], undefined>>,
  Assert<Equal<LockQueueItem['previous_unlocked_at'], string>>,
  Assert<Equal<Extract<QueueItem, { action: 'lock' }>, LockQueueItem>>,
  Assert<Equal<Exclude<QueueItem, { action: 'lock' }>, UnlockQueueItem>>,
  Assert<Equal<Extract<ReportItem, { action: 'lock' }>, LockReportItem>>,
  Assert<Equal<Exclude<ReportItem, { action: 'lock' }>, UnlockReportItem>>,
  Assert<Equal<LockReportItem['requested_unlocked_at'], null>>,
  Assert<Equal<UnlockReportItem['requested_unlocked_at'], string>>,
  Assert<Equal<Extract<LockReportItem['status'], 'restored'>, never>>,
  Assert<Equal<Extract<UnlockReportItem['status'], 'locked'>, never>>,
  Assert<z.output<typeof queueSchema> extends Queue ? true : false>,
  Assert<Queue extends z.output<typeof queueSchema> ? true : false>,
  Assert<z.output<typeof reportSchema> extends Report ? true : false>,
  Assert<Report extends z.output<typeof reportSchema> ? true : false>,
];
