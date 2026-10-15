import { expect, it } from 'vitest';
import { optimisticAddition, queueGroups } from '../../../src/renderer/features/queue/queue-model';
import { achievement, DATE, game, queue, USER } from './fixtures';

it('groups non-empty queues by title and game ID without changing their saved order', () => {
  const values = [queue('3'), queue('2'), queue('1'), { ...queue('4'), items: [] }];
  values[0]!.game.title = 'Alpha';
  values[1]!.game.title = 'Alpha';
  expect(queueGroups(values).map((value) => value.game.id)).toEqual(['2', '3', '1']);
  expect(values.map((value) => value.game.id)).toEqual(['3', '2', '1', '4']);
});

it('adds only requested locked achievements and preserves saved dates, order and creation time', () => {
  const previous = queue();
  const before = structuredClone(previous);
  const timestamp = '2026-10-15T09:00:00.123Z';
  const next = optimisticAddition(
    previous,
    {
      gameId: '1',
      achievementIds: ['1', '2', '2', '3', 'missing'],
      game: game(),
      userId: USER,
      achievements: [achievement('1'), achievement('2'), achievement('3', true), achievement('4')],
    },
    timestamp,
  );
  expect(next?.items.map((item) => item.achievement_id)).toEqual(['1', '2']);
  expect(next?.items[0]?.unlocked_at).toBe(DATE);
  expect(next?.items[1]?.unlocked_at).toBe(timestamp);
  expect(next?.created_at).toBe(DATE);
  expect(next?.updated_at).toBe(timestamp);
  expect(next?.user_id).toBe(USER);
  expect(previous).toEqual(before);
});

it('starts a new provisional queue with the requested game and exact timestamp', () => {
  const next = optimisticAddition(
    null,
    {
      gameId: '2',
      game: game('2'),
      userId: USER,
      achievementIds: ['5'],
      achievements: [achievement('5')],
    },
    DATE,
  );
  expect(next).toEqual({
    schema_version: 1,
    user_id: USER,
    game: game('2'),
    created_at: DATE,
    updated_at: DATE,
    items: [{ achievement_id: '5', key: 'key-5', name: 'Achievement 5', unlocked_at: DATE }],
  });
});

it.each(['game', 'userId'] as const)('waits for saved data when %s is unavailable', (missing) => {
  const input = {
    gameId: '1',
    game: game(),
    userId: USER,
    achievementIds: ['1'],
    achievements: [achievement('1')],
  };
  expect(optimisticAddition(null, { ...input, [missing]: undefined }, DATE)).toBeUndefined();
});
