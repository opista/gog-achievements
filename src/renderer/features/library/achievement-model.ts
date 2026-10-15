import type { Achievement } from '../../../shared/api';

export const ACHIEVEMENT_FILTERS = ['All', 'Unlocked', 'Locked'] as const;
export type AchievementFilter = (typeof ACHIEVEMENT_FILTERS)[number];

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
): Achievement[] {
  return achievements
    .toSorted(compareAchievements)
    .filter(
      (item) =>
        filter === 'All' ||
        (filter === 'Unlocked' && item.unlocked) ||
        (filter === 'Locked' && !item.unlocked),
    );
}
