import { isConfirmedChange, remainingQueueItems } from './queue-cleanup';
import { disabledCliUpdates } from './cli-updates';
import { queueSchema, reportSchema } from './schemas';
import type {
  Achievement,
  ApplyResult,
  AuthStatus,
  DesktopApi,
  Game,
  OperationRecord,
  OperationState,
  PreviewResult,
  Queue,
  QueueGame,
  Report,
  ReportItem,
  QueueItem,
} from './api';

export type DemoScenario = 'complete' | 'partial' | 'unknown' | 'empty' | 'error';
export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface DemoOptions {
  delayMs?: number;
  storage?: DemoStorage;
  scenario?: DemoScenario;
}
export interface DemoDesktopApi extends DesktopApi {
  setScenario(scenario: DemoScenario): void;
  getScenario(): DemoScenario;
}
const USER_ID = '123456789';
const STORAGE_KEY = 'gog-achievements-demo:v1';
const DATES = ['2026-10-10T17:30:00Z', '2026-10-11T19:10:00Z', '2026-10-12T18:15:00Z'];
const GAMES: Game[] = [
  'Cyberpunk 2077',
  'The Witcher 3: Wild Hunt',
  'Stardew Valley',
  "Baldur's Gate 3",
  'Hades',
  'Disco Elysium',
  'Hollow Knight',
  'Celeste',
].map((title, index) => ({ id: String(index + 1), title, image: null }));
const NAMES = [
  'The World',
  'Frequent Flyer',
  'The Wandering Fool',
  'Legend of The Afterlife',
  'Full Body Conversion',
  'A sample hidden achievement',
  'Daemon In The Shell',
];
const WITCHER_NAMES = [
  'Passed the Trial',
  'Lilac and Gooseberries',
  'Geralt: The Professional',
  'Card Collector',
  'The King Is Dead',
  'A sample hidden Witcher achievement',
  'Something More',
];
function initialAchievements(gameId: string): Achievement[] {
  const names =
    gameId === '1'
      ? NAMES
      : gameId === '2'
        ? WITCHER_NAMES
        : [
            'First steps',
            'Explorer',
            'Challenge complete',
            'Collector',
            'Mastery',
            'A sample hidden achievement',
            'Veteran',
          ];
  return names.map((name, index) => ({
    id: String(gameId === '1' ? index + 1 : Number(gameId) * 100 + index + 1),
    key: gameId === '1' ? `demo_${index + 1}` : `demo_${gameId}_${index + 1}`,
    name,
    description:
      index === 5
        ? 'A concealed sample description.'
        : 'Sample achievement description. This is demo data, not a real game requirement.',
    unlocked: index === 4 || index === 6,
    unlocked_at: index === 4 || index === 6 ? '2026-10-04T11:00:00+0000' : null,
    hidden: index === 5,
    image_locked: null,
    image_unlocked: null,
    rarity: null,
  }));
}
function problem(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Offline fixture backend. It never spawns the CLI or contacts GOG. */
export function createDemoApi(options: DemoOptions = {}): DemoDesktopApi {
  let signedIn = false;
  let scenario = options.scenario ?? 'complete';
  let operation: OperationState = { kind: 'idle' };
  let preview: PreviewResult | null = null;
  const listeners = new Set<(state: OperationState) => void>();
  const achievements = new Map<string, Achievement[]>();
  const queues = new Map<string, Queue>();
  let records: OperationRecord[] = [];
  try {
    const stored = options.storage?.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { queues?: Queue[]; records?: OperationRecord[] };
      for (const queue of parsed.queues ?? []) {
        const validated = queueSchema.safeParse(queue);
        if (validated.success && validated.data.user_id === USER_ID)
          queues.set(queue.game.id, validated.data);
      }
      records = (parsed.records ?? []).filter(
        (record) =>
          record.user_id === USER_ID &&
          (!record.report || reportSchema.safeParse(record.report).success),
      );
    }
  } catch {
    /* A corrupt or blocked demo store starts a clean fixture session. */
  }
  function persist(): void {
    try {
      options.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ queues: [...queues.values()], records }),
      );
    } catch {
      /* Demo storage may be blocked by browser settings. */
    }
  }
  function emit(state: OperationState): void {
    operation = state;
    for (const listener of listeners) listener(structuredClone(state));
  }
  function auth(): AuthStatus {
    return signedIn
      ? { authenticated: true, user_id: USER_ID, storage: 'demo', method: 'demo' }
      : { authenticated: false };
  }
  function requireAuth(): void {
    if (!signedIn) throw problem('AUTH_REQUIRED', 'Sign in to the demo account first.');
  }
  function game(gameId: string): QueueGame {
    const found = GAMES.find((item) => item.id === gameId);
    if (!found) throw problem('INVALID_GAME', 'Select a game from the demo library.');
    return { id: found.id, title: found.title, client_id: String(100000 + Number(found.id)) };
  }
  function list(gameId: string): Achievement[] {
    game(gameId);
    if (!achievements.has(gameId)) {
      const source = initialAchievements(gameId);
      for (const record of records.filter((item) => item.game_id === gameId).toReversed()) {
        for (const result of record.report?.results ?? []) {
          if (!isConfirmedChange(result)) continue;
          const item = source.find((entry) => entry.id === result.achievement_id);
          if (item) {
            item.unlocked = result.action !== 'lock';
            item.unlocked_at = result.actual_unlocked_at;
          }
        }
      }
      achievements.set(gameId, source);
    }
    return achievements.get(gameId)!;
  }
  function queue(gameId: string): Queue {
    if (!queues.has(gameId)) {
      const now = new Date().toISOString();
      const source = list(gameId);
      queues.set(gameId, {
        schema_version: 1,
        user_id: USER_ID,
        game: game(gameId),
        created_at: now,
        updated_at: now,
        items:
          gameId === '1'
            ? source.slice(0, 3).map((item, index) => ({
                achievement_id: item.id,
                key: item.key,
                name: item.name,
                unlocked_at: DATES[index]!,
              }))
            : [],
      });
    }
    return queues.get(gameId)!;
  }
  function changed(value: Queue): Queue {
    preview = null;
    value.updated_at = new Date().toISOString();
    persist();
    return structuredClone(value);
  }
  async function run<T>(kind: OperationState['kind'], task: () => T, gameId?: string): Promise<T> {
    if (operation.kind !== 'idle')
      throw problem('OPERATION_BUSY', 'A demo operation is already active.');
    emit({ kind, gameId, startedAt: new Date().toISOString() });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 300));
      return task();
    } finally {
      emit({ kind: 'idle' });
    }
  }
  return {
    isDemo: true,
    async getCliUpdateState() {
      return disabledCliUpdates('0.3.0');
    },
    async checkForUpdates() {
      throw problem('DESKTOP_REQUIRED', 'Update checks are available in the installed app.');
    },
    async initialize() {
      return {
        version: '0.1.0-demo',
        cliVersion: '0.3.0',
        supportsLocking: true,
        auth: auth(),
        operation: structuredClone(operation),
      };
    },
    async login() {
      return run('login', () => {
        signedIn = true;
        return auth();
      });
    },
    async logout() {
      return run('read', () => {
        signedIn = false;
        preview = null;
        return auth();
      });
    },
    async listGames() {
      requireAuth();
      return run('read', () => {
        if (scenario === 'error')
          throw problem(
            'NETWORK_ERROR',
            'Demo library request failed. Choose another demo scenario and retry.',
          );
        const games = scenario === 'empty' ? [] : GAMES;
        return { user_id: USER_ID, count: games.length, games: structuredClone(games) };
      });
    },
    async listAchievements(gameId) {
      requireAuth();
      return run(
        'read',
        () => ({
          user_id: USER_ID,
          game: game(gameId),
          count: list(gameId).length,
          achievements: structuredClone(list(gameId)),
        }),
        gameId,
      );
    },
    async exportAchievements() {
      throw problem(
        'DESKTOP_REQUIRED',
        'CSV export is available in the desktop app with a supported CLI. No file was saved.',
      );
    },
    async getQueue(gameId) {
      requireAuth();
      return run('read', () => structuredClone(queue(gameId)), gameId);
    },
    async listQueues() {
      requireAuth();
      return run('read', () => {
        if (scenario !== 'empty') queue('1');
        const saved = [...queues.values()].filter((item) => item.items.length);
        return structuredClone(
          saved.sort(
            (left, right) =>
              left.game.title.localeCompare(right.game.title) ||
              left.game.id.localeCompare(right.game.id),
          ),
        );
      });
    },
    async addAchievements(input) {
      requireAuth();
      return run(
        'read',
        () => {
          const value = queue(input.gameId);
          const additions: QueueItem[] = [];
          for (const id of input.achievementIds) {
            const item = list(input.gameId).find((entry) => entry.id === id);
            if (!item) throw problem('INVALID_ACHIEVEMENT', 'Achievement not found.');
            if (value.items.some((entry) => entry.achievement_id === id)) continue;
            if (input.action === 'lock') {
              if (!item.unlocked || !item.unlocked_at)
                throw problem(
                  'ALREADY_LOCKED',
                  'Only unlocked achievements can be queued for locking.',
                );
              additions.push({
                achievement_id: id,
                key: item.key,
                name: item.name,
                action: 'lock',
                previous_unlocked_at: item.unlocked_at,
              });
            } else if (!item.unlocked)
              additions.push({
                achievement_id: id,
                key: item.key,
                name: item.name,
                unlocked_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
              });
          }
          value.items.push(...additions);
          return changed(value);
        },
        input.gameId,
      );
    },
    async removeAchievements(input) {
      requireAuth();
      return run(
        'read',
        () => {
          const value = queue(input.gameId);
          value.items = value.items.filter(
            (item) => !input.achievementIds.includes(item.achievement_id),
          );
          return changed(value);
        },
        input.gameId,
      );
    },
    async setDates(input) {
      requireAuth();
      return run(
        'read',
        () => {
          const value = queue(input.gameId);
          for (const [id, timestamp] of Object.entries(input.dates)) {
            const item = value.items.find((entry) => entry.achievement_id === id);
            if (
              !item ||
              item.action === 'lock' ||
              list(input.gameId).find((entry) => entry.id === id)?.unlocked
            )
              throw problem(
                'INVALID_DATE_EDIT',
                'Only queued, locked achievements can have their dates edited.',
              );
            if (
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
              !Number.isFinite(Date.parse(timestamp)) ||
              Date.parse(timestamp) > Date.now()
            )
              throw problem('INVALID_DATE', 'Enter a valid unlock date that is not in the future.');
          }
          for (const item of value.items)
            if (item.action !== 'lock' && input.dates[item.achievement_id])
              item.unlocked_at = new Date(input.dates[item.achievement_id]!)
                .toISOString()
                .replace('.000Z', 'Z');
          return changed(value);
        },
        input.gameId,
      );
    },
    async preview(input) {
      requireAuth();
      return run(
        'read',
        () => {
          const value = queue(input.gameId);
          const results: ReportItem[] = value.items.map((item) => {
            const current = list(input.gameId).find((entry) => entry.id === item.achievement_id)!;
            if (item.action === 'lock') {
              if (
                current.unlocked &&
                Date.parse(current.unlocked_at!) !== Date.parse(item.previous_unlocked_at)
              )
                throw problem(
                  'UNLOCK_DATE_CHANGED',
                  'The unlock date changed. Remove the queued lock and add it again.',
                );
              return {
                achievement_id: item.achievement_id,
                name: item.name,
                action: 'lock',
                requested_unlocked_at: null,
                previous_unlocked_at: item.previous_unlocked_at,
                actual_unlocked_at: current.unlocked_at,
                status: current.unlocked ? 'pending' : 'skipped_already_locked',
              };
            }
            return {
              achievement_id: item.achievement_id,
              name: item.name,
              requested_unlocked_at: item.unlocked_at,
              previous_unlocked_at: current.unlocked_at,
              actual_unlocked_at: current.unlocked_at,
              status: current.unlocked ? 'skipped_already_unlocked' : 'pending',
            };
          });
          preview = {
            token: crypto.randomUUID(),
            report: { dry_run: true, user_id: USER_ID, game: value.game, complete: true, results },
          };
          return structuredClone(preview);
        },
        input.gameId,
      );
    },
    async apply(input): Promise<ApplyResult> {
      requireAuth();
      if (!preview || preview.token !== input.previewToken)
        throw problem('STALE_PREVIEW', 'The queue changed. Preview again before applying.');
      const reviewed = structuredClone(preview.report);
      const reviewedQueue = structuredClone(queue(reviewed.game.id));
      preview = null;
      return run(
        'apply',
        () => {
          const id = crypto.randomUUID();
          const startedAt = operation.startedAt ?? new Date().toISOString();
          if (scenario === 'unknown') {
            records.unshift({
              id,
              user_id: USER_ID,
              game_id: reviewed.game.id,
              game_title: reviewed.game.title,
              started_at: startedAt,
              finished_at: new Date().toISOString(),
              state: 'unknown',
              report: null,
              error: {
                code: 'DEMO_UNKNOWN',
                message: 'Demo operation ended without a confirmed report.',
              },
            });
            persist();
            return {
              operationId: id,
              state: 'unknown',
              report: null,
              error: {
                code: 'DEMO_UNKNOWN',
                message: 'Demo operation ended without a confirmed report.',
              },
            };
          }
          const report: Report = {
            ...reviewed,
            dry_run: false,
            complete: scenario !== 'partial',
            results: reviewed.results.map((item, index): ReportItem => {
              if (
                item.status === 'skipped_already_unlocked' ||
                item.status === 'skipped_already_locked'
              )
                return item;
              if (item.action === 'lock') {
                const status =
                  scenario !== 'partial' || index === 0
                    ? 'locked'
                    : index === 1
                      ? 'unconfirmed'
                      : 'not_attempted';
                const current = list(reviewed.game.id).find(
                  (entry) => entry.id === item.achievement_id,
                )!;
                if (status === 'locked') {
                  current.unlocked = false;
                  current.unlocked_at = null;
                }
                return { ...item, status, actual_unlocked_at: current.unlocked_at };
              }
              const status =
                scenario !== 'partial'
                  ? 'restored'
                  : index === 0
                    ? 'restored_with_different_date'
                    : index === 1
                      ? 'unconfirmed'
                      : 'not_attempted';
              const actual =
                status === 'restored'
                  ? item.requested_unlocked_at
                  : status === 'restored_with_different_date'
                    ? new Date(Date.parse(item.requested_unlocked_at) + 120000)
                        .toISOString()
                        .replace('.000Z', 'Z')
                    : null;
              const current = list(reviewed.game.id).find(
                (entry) => entry.id === item.achievement_id,
              )!;
              if (actual) {
                current.unlocked = true;
                current.unlocked_at = actual;
              }
              return { ...item, status, actual_unlocked_at: actual };
            }),
          };
          records.unshift({
            id,
            user_id: USER_ID,
            game_id: reviewed.game.id,
            game_title: reviewed.game.title,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            state: 'complete',
            report,
          });
          // Save the attempt before reconciling the mutable draft, as the real backend does.
          persist();
          const draft = queue(reviewed.game.id);
          draft.items = remainingQueueItems(draft, reviewedQueue, report);
          changed(draft);
          return { operationId: id, state: 'complete', report: structuredClone(report) };
        },
        reviewed.game.id,
      );
    },
    async history(input) {
      requireAuth();
      return run(
        'read',
        () =>
          structuredClone(
            records.filter((item) => input.gameId === undefined || item.game_id === input.gameId),
          ),
        input.gameId,
      );
    },
    async checkCurrentState(input) {
      requireAuth();
      return run(
        'read',
        () => ({
          user_id: USER_ID,
          game: game(input.gameId),
          count: list(input.gameId).length,
          achievements: structuredClone(list(input.gameId)),
        }),
        input.gameId,
      );
    },
    onOperation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setScenario(value) {
      scenario = value;
      preview = null;
    },
    getScenario() {
      return scenario;
    },
  };
}
