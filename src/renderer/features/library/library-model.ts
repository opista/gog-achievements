import type { Achievement, Game } from '../../../shared/api';

export interface GameProgress {
  unlocked: number;
  total: number;
  percentage: number | null;
}

export function achievementProgress(achievements: readonly Achievement[]): GameProgress {
  const total = achievements.length;
  const unlocked = achievements.reduce((count, item) => count + (item.unlocked ? 1 : 0), 0);
  return {
    unlocked,
    total,
    percentage:
      total === 0
        ? null
        : unlocked === total
          ? 100
          : Math.min(99, Math.round((unlocked / total) * 100)),
  };
}

export function filterGames(games: Game[], search: string): Game[] {
  const query = search.trim().toLocaleLowerCase();
  return games.filter((game) => game.title.toLocaleLowerCase().includes(query));
}

export function pinnedGamesFirst(games: Game[], pinnedIds: ReadonlySet<string>): Game[] {
  const pinned: Game[] = [];
  const unpinned: Game[] = [];
  for (const game of games) (pinnedIds.has(game.id) ? pinned : unpinned).push(game);
  return [...pinned, ...unpinned];
}

export function preferredGame(games: Game[], preferredId?: string): Game | undefined {
  return games.find((game) => game.id === preferredId) ?? games[0];
}
