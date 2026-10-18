import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Achievement,
  AchievementsData,
  DesktopApi,
  Game,
  GamesData,
  QueueGame,
} from '../../../shared/api';
import { achievementProgress, preferredGame } from './library-model';

interface LibraryDependencies {
  assertOwner(userId: string): void;
  syncQueue(gameId: string, isCurrent: () => boolean): Promise<void>;
}

export function useLibrary(
  api: Pick<DesktopApi, 'listAchievements' | 'checkCurrentState'>,
  { assertOwner, syncQueue }: LibraryDependencies,
) {
  const [games, setGames] = useState<Game[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [achievementsLoaded, setAchievementsLoaded] = useState(false);
  const [cache, setCache] = useState<Record<string, Achievement[]>>({});
  const completion = useMemo(
    () => (achievementsLoaded ? achievementProgress(achievements) : undefined),
    [achievements, achievementsLoaded],
  );
  const selected = useRef<Game | null>(null);
  const metadata = useRef(new Map<string, QueueGame>());
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [api],
  );

  function acceptGames(data: GamesData, preferredId?: string): Game | undefined {
    assertOwner(data.user_id);
    setGames(data.games);
    setLibraryLoaded(true);
    return preferredGame(data.games, preferredId);
  }

  function clearSelection(): void {
    generation.current += 1;
    selected.current = null;
    setGame(null);
    setAchievements([]);
    setAchievementsLoaded(false);
  }

  function clear(): void {
    clearSelection();
    setGames([]);
    setLibraryLoaded(false);
    setCache({});
    metadata.current.clear();
  }

  function isCurrent(stamp: number, gameId?: string): boolean {
    return (
      stamp === generation.current && (gameId === undefined || selected.current?.id === gameId)
    );
  }

  async function readAchievements(
    gameId: string,
    stamp: number,
    currentState = false,
  ): Promise<AchievementsData | null> {
    const data = currentState
      ? await api.checkCurrentState({ gameId })
      : await api.listAchievements(gameId);
    if (!isCurrent(stamp)) return null;
    assertOwner(data.user_id);
    if (data.game.id !== gameId)
      throw Object.assign(
        new Error('Could not load the selected game. Refresh your library and try again.'),
        { code: 'GAME_CHANGED' },
      );
    return data;
  }

  function cacheAchievements(data: AchievementsData): void {
    setCache((previous) => ({ ...previous, [data.game.id]: data.achievements }));
  }

  function publishAchievements(data: AchievementsData): void {
    setAchievements(data.achievements);
    cacheAchievements(data);
  }

  async function loadGame(next: Game, currentState = false): Promise<void> {
    const stamp = ++generation.current;
    if (selected.current?.id !== next.id) {
      selected.current = next;
      setGame(next);
      setAchievements([]);
      setAchievementsLoaded(false);
    }
    const data = await readAchievements(next.id, stamp, currentState);
    if (!data) return;
    metadata.current.set(next.id, data.game);
    await syncQueue(next.id, () => isCurrent(stamp, next.id));
    if (!isCurrent(stamp, next.id)) return;
    selected.current = next;
    setGame(next);
    publishAchievements(data);
    setAchievementsLoaded(true);
  }

  async function refreshSelected(currentState = false): Promise<void> {
    const next = selected.current;
    if (!next) return;
    if (!achievementsLoaded) return loadGame(next);
    const stamp = ++generation.current;
    const data = await readAchievements(next.id, stamp, currentState);
    if (!data) return;
    await syncQueue(next.id, () => isCurrent(stamp, next.id));
    if (isCurrent(stamp, next.id)) publishAchievements(data);
  }

  async function refreshAfterApply(gameId: string): Promise<void> {
    if (selected.current?.id !== gameId) return;
    const stamp = ++generation.current;
    const data = await readAchievements(gameId, stamp);
    if (data && isCurrent(stamp, gameId)) publishAchievements(data);
  }

  return {
    games,
    completion,
    libraryLoaded,
    game,
    achievements,
    achievementsLoaded,
    acceptGames,
    clear,
    clearSelection,
    loadGame,
    refreshSelected,
    refreshAfterApply,
    currentGame: () => selected.current,
    metadataFor: (gameId: string) => metadata.current.get(gameId),
    hasAchievements: (gameId: string) => Boolean(cache[gameId]),
    achievementFor: (gameId: string, achievementId: string) =>
      cache[gameId]?.find((item) => item.id === achievementId),
  };
}
