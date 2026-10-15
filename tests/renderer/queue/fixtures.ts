import type { Achievement, Queue, QueueGame, UnlockQueueItem } from '../../../src/shared/api';

export const USER = '123456789';
export const OTHER_USER = '987654321';
export const DATE = '2020-02-02T13:14:15Z';

export function game(id = '1', title = `Sample game ${id}`): QueueGame {
  return { id, title, client_id: `client-${id}` };
}

export function achievement(id: string, unlocked = false): Achievement {
  return {
    id,
    key: `key-${id}`,
    name: `Achievement ${id}`,
    description: `Description ${id}`,
    unlocked,
    unlocked_at: unlocked ? DATE : null,
    hidden: false,
    image_locked: null,
    image_unlocked: null,
    rarity: null,
  };
}

export function queue(id = '1', userId = USER): Queue & { items: UnlockQueueItem[] } {
  return {
    schema_version: 1,
    user_id: userId,
    game: game(id),
    created_at: DATE,
    updated_at: DATE,
    items: [{ achievement_id: '1', key: 'key-1', name: 'Achievement 1', unlocked_at: DATE }],
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
