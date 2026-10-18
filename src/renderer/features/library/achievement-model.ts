import type { Achievement, AchievementAction } from '../../../shared/api';

export const ACHIEVEMENT_FILTERS = ['All', 'Unlocked', 'Locked'] as const;
export type AchievementFilter = (typeof ACHIEVEMENT_FILTERS)[number];
export const ACHIEVEMENT_SORTS = ['Default', 'A–Z', 'Newest unlocked', 'Queued first'] as const;
export type AchievementSort = (typeof ACHIEVEMENT_SORTS)[number];

interface AchievementView {
  search?: string;
  sort?: AchievementSort;
  revealed?: ReadonlySet<string>;
  queued?: ReadonlyMap<string, AchievementAction>;
}

export function isAchievementConcealed(item: Achievement, revealed?: ReadonlySet<string>): boolean {
  return item.hidden && !item.unlocked && !revealed?.has(item.id);
}

export function visibleAchievementName(item: Achievement, revealed?: ReadonlySet<string>): string {
  return isAchievementConcealed(item, revealed) ? 'Hidden achievement' : item.name;
}

function group(item: Achievement): number {
  return item.unlocked ? 2 : item.hidden ? 1 : 0;
}

function unlockTime(item: Achievement): number {
  const time = item.unlocked && item.unlocked_at ? Date.parse(item.unlocked_at) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function compareUnlockTime(left: Achievement, right: Achievement): number {
  const leftTime = unlockTime(left);
  const rightTime = unlockTime(right);
  return leftTime === rightTime ? 0 : leftTime > rightTime ? -1 : 1;
}

function compareAchievements(left: Achievement, right: Achievement): number {
  const groupDifference = group(left) - group(right);
  if (groupDifference || !left.unlocked) return groupDifference;
  return compareUnlockTime(left, right);
}

export function visibleAchievements(
  achievements: readonly Achievement[],
  filter: AchievementFilter,
  { search = '', sort = 'Default', revealed, queued }: AchievementView = {},
): Achievement[] {
  const query = search.trim().toLocaleLowerCase();
  const filtered = achievements
    .filter(
      (item) =>
        filter === 'All' ||
        (filter === 'Unlocked' && item.unlocked) ||
        (filter === 'Locked' && !item.unlocked),
    )
    .filter(
      (item) =>
        !query ||
        (!isAchievementConcealed(item, revealed) &&
          (item.name.toLocaleLowerCase().includes(query) ||
            item.description.toLocaleLowerCase().includes(query))),
    )
    .toSorted(compareAchievements);

  switch (sort) {
    case 'A–Z':
      return filtered.toSorted((left, right) =>
        visibleAchievementName(left, revealed).localeCompare(
          visibleAchievementName(right, revealed),
          undefined,
          { sensitivity: 'base' },
        ),
      );
    case 'Newest unlocked':
      return filtered.toSorted(compareUnlockTime);
    case 'Queued first':
      return filtered.toSorted(
        (left, right) =>
          Number(queued?.has(right.id) ?? false) - Number(queued?.has(left.id) ?? false),
      );
    default:
      return filtered;
  }
}
