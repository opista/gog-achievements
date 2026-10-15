import type {
  Achievement,
  AchievementAction,
  Queue,
  QueueGame,
  QueueItem,
} from '../../../shared/api';

export interface QueueAction {
  kind: 'add' | 'remove' | 'date';
  gameId: string;
}

export interface QueueAddition {
  gameId: string;
  achievementIds: string[];
  action?: AchievementAction;
  game?: QueueGame;
  userId?: string;
  achievements: Achievement[];
}

export function queueGroups(queues: Queue[]): Queue[] {
  return queues
    .filter((queue) => queue.items.length > 0)
    .toSorted(
      (left, right) =>
        left.game.title.localeCompare(right.game.title) ||
        left.game.id.localeCompare(right.game.id),
    );
}

export function optimisticAddition(
  previous: Queue | null,
  { game, userId, achievements, achievementIds, action = 'unlock' }: QueueAddition,
  timestamp: string,
): Queue | undefined {
  if (!game || !userId) return undefined;
  const requested = new Set(achievementIds);
  const saved = new Set(previous?.items.map((item) => item.achievement_id));
  return {
    schema_version: 1,
    user_id: userId,
    game,
    created_at: previous?.created_at ?? timestamp,
    updated_at: timestamp,
    items: [
      ...(previous?.items ?? []),
      ...achievements
        .filter(
          (item) =>
            requested.has(item.id) &&
            (action === 'lock' ? item.unlocked && item.unlocked_at !== null : !item.unlocked) &&
            !saved.has(item.id),
        )
        .map((item): QueueItem => ({
          achievement_id: item.id,
          key: item.key,
          name: item.name,
          ...(action === 'lock'
            ? { action: 'lock' as const, previous_unlocked_at: item.unlocked_at! }
            : { unlocked_at: timestamp }),
        })),
    ],
  };
}
