import type { z } from 'zod';
import type { CliUpdateActions } from './cli-updates';
import type {
  achievementSchema,
  achievementsSchema,
  additionSchema,
  applyInputSchema,
  authSchema,
  datesSchema,
  exportInputSchema,
  exportResultSchema,
  gameInputSchema,
  gameSchema,
  gamesSchema,
  historyInputSchema,
  lockQueueItemSchema,
  lockReportItemSchema,
  queueGameSchema,
  queueSchema,
  reportSchema,
  selectionSchema,
  unlockQueueItemSchema,
  unlockReportItemSchema,
} from './schemas';

export type AuthStatus = z.infer<typeof authSchema>;
export type Game = z.infer<typeof gameSchema>;
export type QueueGame = z.infer<typeof queueGameSchema>;
export type Achievement = z.infer<typeof achievementSchema>;
export type GamesData = z.infer<typeof gamesSchema>;
export type AchievementsData = z.infer<typeof achievementsSchema>;
export type ExportInput = z.infer<typeof exportInputSchema>;
export type ExportResult =
  { cancelled: true } | ({ cancelled: false } & z.infer<typeof exportResultSchema>);
export type UnlockQueueItem = z.infer<typeof unlockQueueItemSchema>;
// Keep the public union readable before narrowing, without allowing this key in stored locks.
export type LockQueueItem = z.infer<typeof lockQueueItemSchema> & { unlocked_at?: never };
export type QueueItem = UnlockQueueItem | LockQueueItem;
export type AchievementAction = NonNullable<QueueItem['action']>;
export type Queue = Omit<z.infer<typeof queueSchema>, 'items'> & { items: QueueItem[] };
export type UnlockReportItem = z.infer<typeof unlockReportItemSchema>;
export type LockReportItem = z.infer<typeof lockReportItemSchema>;
export type ReportItem = UnlockReportItem | LockReportItem;
export type UnlockReportStatus = UnlockReportItem['status'];
export type LockReportStatus = LockReportItem['status'];
export type ReportStatus = ReportItem['status'];
export type Report = z.infer<typeof reportSchema>;
export interface PublicError {
  code: string;
  message: string;
}
export interface OperationState {
  kind: 'idle' | 'login' | 'read' | 'apply' | 'recovery';
  operationId?: string;
  gameId?: string;
  startedAt?: string;
  message?: string;
  cli?: CliRuntimeInfo;
}
export interface CliRuntimeInfo {
  version: string;
  supportsLocking: boolean;
  supportsExporting: boolean;
}
export interface OperationRecord {
  id: string;
  user_id: string;
  game_id: string;
  game_title: string;
  started_at: string;
  finished_at: string | null;
  state: 'running' | 'complete' | 'unknown';
  report: Report | null;
  error?: PublicError;
}
export interface InitializeResult {
  version: string;
  cliVersion: string;
  supportsLocking?: boolean;
  supportsExporting?: boolean;
  auth: AuthStatus;
  operation: OperationState;
}
export type SelectionInput = z.infer<typeof selectionSchema>;
export type AdditionInput = z.infer<typeof additionSchema>;
export type DatesInput = z.infer<typeof datesSchema>;
export type GameInput = z.infer<typeof gameInputSchema>;
export type ApplyInput = z.infer<typeof applyInputSchema>;
export type HistoryInput = z.infer<typeof historyInputSchema>;
export interface PreviewResult {
  token: string;
  report: Report;
}
export interface ApplyResult {
  operationId: string;
  state: 'complete' | 'unknown';
  report: Report | null;
  error?: PublicError;
}
export interface WorkspaceApi {
  readonly isDemo: boolean;
  initialize(): Promise<InitializeResult>;
  login(): Promise<AuthStatus>;
  logout(): Promise<AuthStatus>;
  listGames(): Promise<GamesData>;
  listAchievements(gameId: string): Promise<AchievementsData>;
  exportAchievements(input: ExportInput): Promise<ExportResult>;
  getQueue(gameId: string): Promise<Queue | null>;
  listQueues(): Promise<Queue[]>;
  addAchievements(input: AdditionInput): Promise<Queue>;
  removeAchievements(input: SelectionInput): Promise<Queue>;
  setDates(input: DatesInput): Promise<Queue>;
  preview(input: GameInput): Promise<PreviewResult>;
  cancelPreview(input: ApplyInput): Promise<void>;
  apply(input: ApplyInput): Promise<ApplyResult>;
  history(input: HistoryInput): Promise<OperationRecord[]>;
  checkCurrentState(input: GameInput): Promise<AchievementsData>;
  onOperation(listener: (state: OperationState) => void): () => void;
}
export interface DesktopApi extends WorkspaceApi, CliUpdateActions {
  checkForUpdates(): Promise<void>;
}
export type AppUpdateActions = Pick<
  DesktopApi,
  'checkForUpdates' | 'getCliUpdateState' | 'setCliActivationBlocked'
>;
export interface DesktopPlatform extends Pick<WorkspaceApi, 'isDemo' | 'onOperation'> {
  ready(): Promise<void>;
}
export type ApiMethod = Exclude<keyof DesktopApi, 'isDemo' | 'onOperation'>;
export type IpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: PublicError };
export const IPC_OPERATION = 'gog-achievements:operation';
