import type { CliUpdateActions } from './cli-updates';

export interface AuthStatus {
  authenticated: boolean;
  user_id?: string;
  expired?: boolean;
  storage?: string;
  local_login_removed?: boolean;
  method?: string;
}
export interface Game {
  id: string;
  title: string;
  slug?: string | null;
  image?: string | null;
  works_on?: unknown;
}
export interface QueueGame {
  id: string;
  title: string;
  client_id: string;
}
export interface Achievement {
  id: string;
  key: string;
  name: string;
  description: string;
  unlocked: boolean;
  unlocked_at: string | null;
  hidden: boolean;
  image_locked: string | null;
  image_unlocked: string | null;
  rarity: unknown;
}
export interface GamesData {
  user_id: string;
  count: number;
  games: Game[];
}
export interface AchievementsData {
  user_id: string;
  game: QueueGame;
  count: number;
  achievements: Achievement[];
}
export interface ExportInput {
  gameId: string;
  search?: string;
  status?: 'all' | 'locked' | 'unlocked';
}
export type ExportResult = { cancelled: true } | { cancelled: false; path: string; count: number };
export interface UnlockQueueItem {
  achievement_id: string;
  key: string;
  name: string;
  action?: 'unlock';
  unlocked_at: string;
}
export interface LockQueueItem {
  achievement_id: string;
  key: string;
  name: string;
  action: 'lock';
  unlocked_at?: never;
  previous_unlocked_at: string;
}
export type QueueItem = UnlockQueueItem | LockQueueItem;
export type AchievementAction = 'unlock' | 'lock';
export interface Queue {
  schema_version: 1;
  user_id: string;
  game: QueueGame;
  created_at: string;
  updated_at: string;
  items: QueueItem[];
}
export type UnlockReportStatus =
  | 'pending'
  | 'restored'
  | 'skipped_already_unlocked'
  | 'restored_with_different_date'
  | 'failed'
  | 'unconfirmed'
  | 'not_attempted';
export type LockReportStatus =
  'pending' | 'locked' | 'skipped_already_locked' | 'failed' | 'unconfirmed' | 'not_attempted';
export type ReportStatus = UnlockReportStatus | LockReportStatus;
export interface UnlockReportItem {
  achievement_id: string;
  name: string;
  actual_unlocked_at: string | null;
  error_code?: string;
  action?: 'unlock';
  requested_unlocked_at: string;
  previous_unlocked_at: string | null;
  status: UnlockReportStatus;
}
export interface LockReportItem {
  achievement_id: string;
  name: string;
  actual_unlocked_at: string | null;
  error_code?: string;
  action: 'lock';
  requested_unlocked_at: null;
  previous_unlocked_at: string;
  status: LockReportStatus;
}
export type ReportItem = UnlockReportItem | LockReportItem;
export interface Report {
  dry_run: boolean;
  user_id: string;
  game: QueueGame;
  complete: boolean;
  results: ReportItem[];
}
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
export interface SelectionInput {
  gameId: string;
  achievementIds: string[];
}
export interface AdditionInput extends SelectionInput {
  action?: AchievementAction;
}
export interface DatesInput {
  gameId: string;
  dates: Record<string, string>;
}
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
  preview(input: { gameId: string }): Promise<PreviewResult>;
  apply(input: { previewToken: string }): Promise<ApplyResult>;
  history(input: { gameId?: string }): Promise<OperationRecord[]>;
  checkCurrentState(input: { gameId: string }): Promise<AchievementsData>;
  onOperation(listener: (state: OperationState) => void): () => void;
}
export interface DesktopApi extends WorkspaceApi, CliUpdateActions {
  checkForUpdates(): Promise<void>;
}
export type AppUpdateActions = Pick<
  DesktopApi,
  'checkForUpdates' | 'getCliUpdateState' | 'setAutomaticCliUpdates' | 'useBundledCli'
>;
export interface DesktopPlatform extends Pick<WorkspaceApi, 'isDemo' | 'onOperation'> {
  ready(): Promise<void>;
}
export type ApiMethod = Exclude<keyof DesktopApi, 'isDemo' | 'onOperation'>;
export type IpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: PublicError };
export const IPC_OPERATION = 'gog-achievements:operation';
