import { expect, it } from 'vitest';
import type { Achievement, AchievementAction } from '../../../src/shared/api';
import {
  ACHIEVEMENT_FILTERS,
  ACHIEVEMENT_SORTS,
  visibleAchievements,
  type AchievementSort,
} from '../../../src/renderer/features/library/achievement-model';

function achievement(id: string, name: string, options: Partial<Achievement> = {}): Achievement {
  return {
    id,
    key: id,
    name,
    description: 'Reach the checkpoint',
    unlocked: false,
    unlocked_at: null,
    hidden: false,
    image_locked: null,
    image_unlocked: null,
    rarity: null,
    ...options,
  };
}

const input = Object.freeze(
  [
    achievement('old', 'Bravo', {
      unlocked: true,
      unlocked_at: '2023-01-01T12:00:00Z',
      description: 'Other',
    }),
    achievement('secret', 'Aardvark secret', { hidden: true }),
    achievement('b', 'beta'),
    achievement('new', 'Delta', { unlocked: true, unlocked_at: '2025-01-01T12:00:00Z' }),
    achievement('a', 'Alpha'),
    achievement('no-date', 'Echo', { unlocked: true }),
    achievement('invalid', 'Foxtrot', {
      unlocked: true,
      unlocked_at: 'invalid',
      description: 'Other',
    }),
    achievement('visible-secret', 'Charlie secret', {
      hidden: true,
      unlocked: true,
      unlocked_at: '2024-01-01T12:00:00Z',
    }),
    achievement('stale', 'Zulu', { unlocked_at: '2099-01-01T12:00:00Z', description: 'Other' }),
  ].map((item) => Object.freeze(item)),
);
const queued = new Map<string, AchievementAction>([
  ['new', 'lock'],
  ['a', 'unlock'],
  ['outside-list', 'unlock'],
]);
const searchedOrder: Record<AchievementSort, string[]> = {
  Default: ['b', 'a', 'new', 'visible-secret', 'no-date'],
  'A–Z': ['a', 'b', 'visible-secret', 'new', 'no-date'],
  'Newest unlocked': ['new', 'visible-secret', 'b', 'a', 'no-date'],
  'Queued first': ['a', 'new', 'b', 'visible-secret', 'no-date'],
};

for (const filter of ACHIEVEMENT_FILTERS) {
  it.each(ACHIEVEMENT_SORTS)(
    `combines trimmed description search and ${filter} with %s`,
    (sort) => {
      const expected = searchedOrder[sort].filter((id) => {
        const item = input.find((entry) => entry.id === id)!;
        return filter === 'All' || item.unlocked === (filter === 'Unlocked');
      });
      const result = visibleAchievements(input, filter, { search: '  CHECKPOINT  ', sort, queued });
      expect(result.map((item) => item.id)).toEqual(expected);
    },
  );
}

it('preserves default ordering for empty and whitespace searches', () => {
  const expected = [
    'b',
    'a',
    'stale',
    'secret',
    'new',
    'visible-secret',
    'old',
    'no-date',
    'invalid',
  ];
  expect(visibleAchievements(input, 'All').map((item) => item.id)).toEqual(expected);
  expect(visibleAchievements(input, 'All', { search: '   ' }).map((item) => item.id)).toEqual(
    expected,
  );
});

it.each(ACHIEVEMENT_SORTS)(
  'conceals names and descriptions during %s searches until revealed',
  (sort) => {
    expect(visibleAchievements(input, 'Locked', { search: 'AARDVARK', sort })).toEqual([]);
    expect(
      visibleAchievements(input, 'Locked', { search: 'checkpoint', sort }).map((item) => item.id),
    ).not.toContain('secret');
    const revealed = new Set(['secret']);
    expect(
      visibleAchievements(input, 'Locked', { search: '  AARDVARK  ', sort, revealed }).map(
        (item) => item.id,
      ),
    ).toEqual(['secret']);
    expect(
      visibleAchievements(input, 'Locked', { search: 'checkpoint', sort, revealed }).map(
        (item) => item.id,
      ),
    ).toContain('secret');
    expect(
      visibleAchievements(input, 'Unlocked', { search: 'SECRET', sort }).map((item) => item.id),
    ).toEqual(['visible-secret']);
  },
);

it('sorts by the displayed name and updates the order after reveal', () => {
  const sorted = (revealed?: ReadonlySet<string>) =>
    visibleAchievements(input, 'All', { sort: 'A–Z', revealed }).map((item) => item.id);
  expect(sorted()).toEqual([
    'a',
    'b',
    'old',
    'visible-secret',
    'new',
    'no-date',
    'invalid',
    'secret',
    'stale',
  ]);
  expect(sorted(new Set(['secret']))[0]).toBe('secret');
});

it('sorts real unlock times first and keeps missing or invalid dates in default order', () => {
  expect(
    visibleAchievements(input, 'All', { sort: 'Newest unlocked' }).map((item) => item.id),
  ).toEqual(['new', 'visible-secret', 'old', 'b', 'a', 'stale', 'secret', 'no-date', 'invalid']);
});

it('keeps default ordering for tied names and equivalent unlock times', () => {
  const tied = [
    achievement('first', 'same', { unlocked: true, unlocked_at: '2025-01-01T12:00:00Z' }),
    achievement('second', 'Same', { unlocked: true, unlocked_at: '2025-01-01T13:00:00+01:00' }),
  ];
  for (const sort of ACHIEVEMENT_SORTS) {
    expect(visibleAchievements(tied, 'All', { sort }).map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
  }
});

it('reacts to mixed queue additions and removals without changing the source or saved requests', () => {
  const original = structuredClone({ input, queued });
  const ids = (queue: ReadonlyMap<string, AchievementAction>) =>
    visibleAchievements(input, 'All', { sort: 'Queued first', queued: queue }).map(
      (item) => item.id,
    );
  expect(ids(queued)).toEqual([
    'a',
    'new',
    'b',
    'stale',
    'secret',
    'visible-secret',
    'old',
    'no-date',
    'invalid',
  ]);
  const changed = new Map(queued).set('secret', 'unlock').set('old', 'lock');
  changed.delete('a');
  expect(ids(changed)).toEqual([
    'secret',
    'new',
    'old',
    'b',
    'a',
    'stale',
    'visible-secret',
    'no-date',
    'invalid',
  ]);
  expect({ input, queued }).toEqual(original);
});
