import type { Achievement, AchievementAction } from '../../../shared/api';

export const ACHIEVEMENT_FILTERS = ['All', 'Unlocked', 'Locked'] as const;
export type AchievementFilter = (typeof ACHIEVEMENT_FILTERS)[number];
export const ACHIEVEMENT_SORTS = [
  'Locked first',
  'A–Z',
  'Newest unlocked',
  'Queued first',
] as const;
export type AchievementSort = (typeof ACHIEVEMENT_SORTS)[number];

export function isAchievementConcealed(item: Achievement, revealed: ReadonlySet<string>): boolean {
  return item.hidden && !item.unlocked && !revealed.has(item.id);
}

function group(item: Achievement): number {
  return item.unlocked ? 2 : item.hidden ? 1 : 0;
}

function unlockTime(item: Achievement): number {
  const time = item.unlocked_at ? Date.parse(item.unlocked_at) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function compareAchievements(left: Achievement, right: Achievement): number {
  const groupDifference = group(left) - group(right);
  if (groupDifference || !left.unlocked) return groupDifference;
  const leftTime = unlockTime(left);
  const rightTime = unlockTime(right);
  return leftTime === rightTime ? 0 : leftTime > rightTime ? -1 : 1;
}

export function visibleAchievements(
  achievements: Achievement[],
  filter: AchievementFilter,
  {
    search = '',
    sort = 'Locked first',
    revealed = new Set<string>(),
    queued = new Map<string, AchievementAction>(),
  }: {
    search?: string;
    sort?: AchievementSort;
    revealed?: ReadonlySet<string>;
    queued?: ReadonlyMap<string, AchievementAction>;
  } = {},
): Achievement[] {
  const query = search.trim().toLowerCase();
  const selected = achievements
    .filter(
      (item) =>
        (filter === 'All' ||
          (filter === 'Unlocked' && item.unlocked) ||
          (filter === 'Locked' && !item.unlocked)) &&
        (!query ||
          (!isAchievementConcealed(item, revealed) &&
            (item.name.toLowerCase().includes(query) ||
              item.description.toLowerCase().includes(query)))),
    )
    .sort(compareAchievements);
  if (sort === 'A–Z') {
    const name = (item: Achievement) =>
      isAchievementConcealed(item, revealed) ? 'Hidden achievement' : item.name;
    return selected.sort((left, right) =>
      name(left).localeCompare(name(right), undefined, { sensitivity: 'base' }),
    );
  }
  if (sort === 'Newest unlocked') {
    return selected.sort((left, right) => {
      const stateDifference = Number(right.unlocked) - Number(left.unlocked);
      const leftTime = unlockTime(left);
      const rightTime = unlockTime(right);
      return stateDifference || (leftTime === rightTime ? 0 : leftTime > rightTime ? -1 : 1);
    });
  }
  if (sort === 'Queued first') {
    return selected.sort(
      (left, right) => Number(queued.has(right.id)) - Number(queued.has(left.id)),
    );
  }
  return selected;
}
