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
export interface QueueItem {
  achievement_id: string;
  key: string;
  name: string;
  unlocked_at: string;
}
export interface Queue {
  schema_version: 1;
  user_id: string;
  game: QueueGame;
  created_at: string;
  updated_at: string;
  items: QueueItem[];
}
export type ReportStatus =
  | 'pending'
  | 'restored'
  | 'skipped_already_unlocked'
  | 'restored_with_different_date'
  | 'failed'
  | 'unconfirmed'
  | 'not_attempted';
export interface ReportItem {
  achievement_id: string;
  name: string;
  requested_unlocked_at: string;
  previous_unlocked_at: string | null;
  actual_unlocked_at: string | null;
  status: ReportStatus;
  error_code?: string;
}
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
  auth: AuthStatus;
  operation: OperationState;
}
export interface SelectionInput {
  gameId: string;
  achievementIds: string[];
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
export interface DesktopApi {
  readonly isDemo: boolean;
  initialize(): Promise<InitializeResult>;
  login(): Promise<AuthStatus>;
  logout(): Promise<AuthStatus>;
  listGames(): Promise<GamesData>;
  listAchievements(gameId: string): Promise<AchievementsData>;
  getQueue(gameId: string): Promise<Queue | null>;
  addAchievements(input: SelectionInput): Promise<Queue>;
  removeAchievements(input: SelectionInput): Promise<Queue>;
  setDates(input: DatesInput): Promise<Queue>;
  preview(input: { gameId: string }): Promise<PreviewResult>;
  apply(input: { previewToken: string }): Promise<ApplyResult>;
  history(input: { gameId: string }): Promise<OperationRecord[]>;
  checkCurrentState(input: { gameId: string }): Promise<AchievementsData>;
  onOperation(listener: (state: OperationState) => void): () => void;
}
export type ApiMethod = Exclude<keyof DesktopApi, 'isDemo' | 'onOperation'>;
export type IpcResult = { ok: true; data: unknown } | { ok: false; error: PublicError };
export const IPC_REQUEST = 'gog-achievements:request';
export const IPC_OPERATION = 'gog-achievements:operation';
