import type { Game } from '../../../shared/api';

export function filterGames(games: Game[], search: string): Game[] {
  const query = search.trim().toLocaleLowerCase();
  return games.filter((game) => game.title.toLocaleLowerCase().includes(query));
}

export function preferredGame(games: Game[], preferredId?: string): Game | undefined {
  return games.find((game) => game.id === preferredId) ?? games[0];
}
