import { expect, it } from 'vitest';
import type { Achievement, AchievementAction } from '../../../src/shared/api';
import { visibleAchievements } from '../../../src/renderer/features/library/achievement-model';

function achievement(id: string, name: string, options: Partial<Achievement> = {}): Achievement {
  return {
    id,
    key: id,
    name,
    description: 'Find a relic',
    unlocked: false,
    unlocked_at: null,
    hidden: false,
    image_locked: null,
    image_unlocked: null,
    rarity: null,
    ...options,
  };
}
const input = [
  achievement('old', 'Zulu', { unlocked: true, unlocked_at: '2024-01-01T12:00:00Z' }),
  achievement('secret-z', 'Secret Zulu', { hidden: true, description: 'Spoiler Z' }),
  achievement('b', 'Beta'),
  achievement('new', 'delta', { unlocked: true, unlocked_at: '2025-01-01T12:00:00Z' }),
  achievement('secret-a', 'A secret', { hidden: true, description: 'Spoiler A' }),
  achievement('a', 'Alpha'),
];
const ids = (items: Achievement[]) => items.map((item) => item.id);

it('preserves default order and source data', () => {
  const original = structuredClone(input);
  expect(ids(visibleAchievements(input, 'All'))).toEqual([
    'b',
    'a',
    'secret-z',
    'secret-a',
    'new',
    'old',
  ]);
  expect(input).toEqual(original);
});
it('combines case-insensitive name and description search with status filters', () => {
  expect(ids(visibleAchievements(input, 'All', { search: ' ALPHA ' }))).toEqual(['a']);
  expect(ids(visibleAchievements(input, 'Locked', { search: 'RELIC' }))).toEqual(['b', 'a']);
  expect(ids(visibleAchievements(input, 'Unlocked', { search: 'RELIC' }))).toEqual(['new', 'old']);
  expect(visibleAchievements(input, 'Locked', { search: 'delta' })).toEqual([]);
  expect(ids(visibleAchievements(input, 'All', { search: '  ' }))).toEqual(
    ids(visibleAchievements(input, 'All')),
  );
});
it('excludes concealed names and descriptions until reveal, including during sorting', () => {
  expect(visibleAchievements(input, 'All', { search: 'secret' })).toEqual([]);
  expect(visibleAchievements(input, 'All', { search: 'spoiler' })).toEqual([]);
  expect(ids(visibleAchievements(input, 'All', { sort: 'A–Z' }))).toEqual([
    'a',
    'b',
    'new',
    'secret-z',
    'secret-a',
    'old',
  ]);
  expect(
    ids(
      visibleAchievements(input, 'Locked', { search: 'SPOILER', revealed: new Set(['secret-a']) }),
    ),
  ).toEqual(['secret-a']);
  const unlocked = [
    achievement('hidden-unlock', 'Earned secret', { hidden: true, unlocked: true }),
  ];
  expect(ids(visibleAchievements(unlocked, 'Unlocked', { search: 'SECRET' }))).toEqual([
    'hidden-unlock',
  ]);
});
it('sorts newest unlocks first and retains default order for the remaining rows and ties', () => {
  const extra = [
    ...input,
    achievement('tie', 'Another unlock', { unlocked: true, unlocked_at: '2025-01-01T12:00:00Z' }),
    achievement('unknown', 'Unknown date', { unlocked: true }),
    achievement('invalid', 'Invalid date', { unlocked: true, unlocked_at: 'invalid' }),
  ];
  expect(ids(visibleAchievements(extra, 'All', { sort: 'Newest unlocked' }))).toEqual([
    'new',
    'tie',
    'old',
    'unknown',
    'invalid',
    'b',
    'a',
    'secret-z',
    'secret-a',
  ]);
});
it('puts either queued action first with default order within both groups', () => {
  const queued = new Map<string, AchievementAction>([
    ['old', 'lock'],
    ['a', 'unlock'],
    ['unknown', 'lock'],
  ]);
  expect(ids(visibleAchievements(input, 'All', { sort: 'Queued first', queued }))).toEqual([
    'a',
    'old',
    'b',
    'secret-z',
    'secret-a',
    'new',
  ]);
  expect(
    ids(visibleAchievements(input, 'Locked', { sort: 'Queued first', queued, search: 'RELIC' })),
  ).toEqual(['a', 'b']);
  expect(ids(visibleAchievements(input, 'All', { sort: 'Queued first' }))).toEqual(
    ids(visibleAchievements(input, 'All')),
  );
  expect([...queued]).toEqual([
    ['old', 'lock'],
    ['a', 'unlock'],
    ['unknown', 'lock'],
  ]);
});
