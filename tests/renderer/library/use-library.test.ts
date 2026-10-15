// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { AchievementsData, DesktopApi, Game } from '../../../src/shared/api';
import { useLibrary } from '../../../src/renderer/features/library/use-library';

afterEach(cleanup);

const USER = '123456789';
const game = (id: string): Game => ({ id, title: `Game ${id}` });

function data(id: string, userId = USER): AchievementsData {
  return {
    user_id: userId,
    game: { ...game(id), client_id: '100001' },
    count: 1,
    achievements: [
      {
        id: `${id}01`,
        key: `unlock-${id}`,
        name: `Achievement ${id}`,
        description: 'Sample description',
        unlocked: false,
        unlocked_at: null,
        hidden: false,
        image_locked: null,
        image_unlocked: null,
        rarity: null,
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function library() {
  const api = {
    listAchievements: vi
      .fn<DesktopApi['listAchievements']>()
      .mockImplementation(async (id) => data(id)),
    checkCurrentState: vi
      .fn<DesktopApi['checkCurrentState']>()
      .mockImplementation(async ({ gameId }) => data(gameId)),
  };
  const assertOwner = vi.fn((userId: string) => {
    if (userId !== USER)
      throw Object.assign(new Error('Account changed'), { code: 'ACCOUNT_CHANGED' });
  });
  const syncQueue = vi
    .fn<(gameId: string, isCurrent: () => boolean) => Promise<void>>()
    .mockResolvedValue(undefined);
  const hook = renderHook(({ api }) => useLibrary(api, { assertOwner, syncQueue }), {
    initialProps: { api },
  });
  return { ...hook, api, assertOwner, syncQueue };
}

it('accepts a matching account library and chooses the preferred, first or no game', () => {
  const { result, assertOwner } = library();
  const values = { user_id: USER, count: 2, games: [game('1'), game('2')] };
  expect(result.current.libraryLoaded).toBe(false);
  act(() => {
    expect(result.current.acceptGames(values, '2')).toEqual(game('2'));
  });
  expect(result.current.games).toEqual(values.games);
  expect(result.current.libraryLoaded).toBe(true);
  expect(result.current.game).toBeNull();
  act(() => {
    expect(result.current.acceptGames(values, 'missing')).toEqual(game('1'));
    expect(result.current.acceptGames({ ...values, count: 0, games: [] })).toBeUndefined();
  });
  expect(result.current.libraryLoaded).toBe(true);
  expect(result.current.games).toEqual([]);
  expect(() => result.current.acceptGames({ ...values, user_id: '987654321' })).toThrow(
    'Account changed',
  );
  expect(assertOwner).toHaveBeenCalledTimes(4);
  expect(result.current.games).toEqual([]);
});

it('shows a pending selection and publishes achievements only after its queue read', async () => {
  const { result, api, syncQueue } = library();
  const queue = deferred<void>();
  syncQueue.mockReturnValueOnce(queue.promise);
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.loadGame(game('1'));
  });
  expect(result.current.game).toEqual(game('1'));
  expect(result.current.achievementsLoaded).toBe(false);
  await waitFor(() => expect(syncQueue).toHaveBeenCalledTimes(1));
  expect(result.current.achievements).toEqual([]);
  await act(async () => {
    queue.resolve(undefined);
    await loading;
  });
  expect(api.listAchievements).toHaveBeenCalledExactlyOnceWith('1');
  expect(result.current.achievementsLoaded).toBe(true);
  expect(result.current.achievements).toEqual(data('1').achievements);
  expect(result.current.achievementFor('1', '101')).toEqual(data('1').achievements[0]);
  expect(result.current.metadataFor('1')).toEqual(data('1').game);
});

it('ignores an older game response before account validation or queue reads', async () => {
  const { result, api, assertOwner, syncQueue } = library();
  const earlier = deferred<AchievementsData>();
  api.listAchievements.mockReturnValueOnce(earlier.promise);
  let first!: Promise<void>;
  act(() => {
    first = result.current.loadGame(game('1'));
  });
  await act(() => result.current.loadGame(game('2')));
  await act(async () => {
    earlier.resolve(data('1', '987654321'));
    await first;
  });
  expect(result.current.game).toEqual(game('2'));
  expect(result.current.achievements).toEqual(data('2').achievements);
  expect(result.current.hasAchievements('1')).toBe(false);
  expect(assertOwner).toHaveBeenCalledExactlyOnceWith(USER);
  expect(syncQueue).toHaveBeenCalledExactlyOnceWith('2', expect.any(Function));
});

it('clears account data and prevents a pending response from restoring it', async () => {
  const { result, api, assertOwner, syncQueue } = library();
  await act(() => result.current.loadGame(game('1')));
  act(() => {
    result.current.acceptGames({ user_id: USER, count: 1, games: [game('1')] });
  });
  const pending = deferred<AchievementsData>();
  api.listAchievements.mockReturnValueOnce(pending.promise);
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.refreshSelected();
    result.current.clear();
  });
  assertOwner.mockClear();
  syncQueue.mockClear();
  await act(async () => {
    pending.resolve(data('1'));
    await loading;
  });
  expect(result.current.games).toEqual([]);
  expect(result.current.libraryLoaded).toBe(false);
  expect(result.current.game).toBeNull();
  expect(result.current.currentGame()).toBeNull();
  expect(result.current.achievements).toEqual([]);
  expect(result.current.achievementsLoaded).toBe(false);
  expect(result.current.achievementFor('1', '101')).toBeUndefined();
  expect(result.current.metadataFor('1')).toBeUndefined();
  expect(assertOwner).not.toHaveBeenCalled();
  expect(syncQueue).not.toHaveBeenCalled();
});

it('invalidates a queue callback and its achievement result when selection is cleared', async () => {
  const { result, syncQueue } = library();
  const pending = deferred<void>();
  syncQueue.mockReturnValueOnce(pending.promise);
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.loadGame(game('1'));
  });
  await waitFor(() => expect(syncQueue).toHaveBeenCalledTimes(1));
  const isCurrent = syncQueue.mock.calls[0]![1];
  expect(isCurrent()).toBe(true);
  act(() => result.current.clearSelection());
  expect(isCurrent()).toBe(false);
  await act(async () => {
    pending.resolve(undefined);
    await loading;
  });
  expect(result.current.game).toBeNull();
  expect(result.current.achievements).toEqual([]);
  expect(result.current.achievementsLoaded).toBe(false);
});

it.each([
  { source: 'another account', code: 'ACCOUNT_CHANGED', value: data('1', '987654321') },
  { source: 'another game', code: 'GAME_CHANGED', value: data('2') },
])(
  'rejects achievements from $source before queue sync or cache publication',
  async ({ code, value }) => {
    const { result, api, syncQueue } = library();
    api.listAchievements.mockResolvedValueOnce(value);
    await act(async () => {
      await expect(result.current.loadGame(game('1'))).rejects.toMatchObject({ code });
    });
    expect(result.current.achievements).toEqual([]);
    expect(result.current.achievementsLoaded).toBe(false);
    expect(result.current.hasAchievements('1')).toBe(false);
    expect(result.current.hasAchievements('2')).toBe(false);
    expect(syncQueue).not.toHaveBeenCalled();
  },
);

it('loads cached details for saved queues without changing the selected game', async () => {
  const { result, syncQueue } = library();
  await act(() => result.current.loadGame(game('1')));
  syncQueue.mockClear();
  await act(() => result.current.loadDetails('2'));
  expect(result.current.game).toEqual(game('1'));
  expect(result.current.achievements).toEqual(data('1').achievements);
  expect(result.current.achievementFor('2', '201')).toEqual(data('2').achievements[0]);
  expect(result.current.hasAchievements('2')).toBe(true);
  expect(syncQueue).not.toHaveBeenCalled();
});

it('refreshes selected current state while preserving rows until the read succeeds', async () => {
  const { result, api, syncQueue } = library();
  await act(() => result.current.loadGame(game('1')));
  const pending = deferred<AchievementsData>();
  api.checkCurrentState.mockReturnValueOnce(pending.promise);
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = result.current.refreshSelected(true);
  });
  expect(result.current.achievements).toEqual(data('1').achievements);
  const next = data('1');
  next.achievements[0]!.description = 'Updated description';
  await act(async () => {
    pending.resolve(next);
    await refreshing;
  });
  expect(api.checkCurrentState).toHaveBeenCalledExactlyOnceWith({ gameId: '1' });
  expect(api.listAchievements).toHaveBeenCalledTimes(1);
  expect(syncQueue).toHaveBeenCalledTimes(2);
  expect(result.current.achievements).toEqual(next.achievements);
  expect(result.current.achievementFor('1', '101')?.description).toBe('Updated description');
});

it('refreshes after apply only for the selected game without repeating queue sync', async () => {
  const { result, api, syncQueue } = library();
  await act(() => result.current.loadGame(game('1')));
  api.listAchievements.mockClear();
  syncQueue.mockClear();
  await act(() => result.current.refreshAfterApply('2'));
  expect(api.listAchievements).not.toHaveBeenCalled();
  await act(() => result.current.refreshAfterApply('1'));
  expect(api.listAchievements).toHaveBeenCalledExactlyOnceWith('1');
  expect(syncQueue).not.toHaveBeenCalled();
  expect(result.current.game).toEqual(game('1'));
});

it.each(['API replacement', 'unmount'])('invalidates pending reads on %s', async (change) => {
  const { result, api, assertOwner, syncQueue, rerender, unmount } = library();
  const pending = deferred<AchievementsData>();
  api.listAchievements.mockReturnValueOnce(pending.promise);
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.loadGame(game('1'));
  });
  if (change === 'unmount') unmount();
  else rerender({ api: { ...api } });
  await act(async () => {
    pending.resolve(data('1'));
    await loading;
  });
  expect(assertOwner).not.toHaveBeenCalled();
  expect(syncQueue).not.toHaveBeenCalled();
});

it('preserves the selected data and propagates refresh failures to the workspace', async () => {
  const { result, api, syncQueue } = library();
  await act(() => result.current.loadGame(game('1')));
  const failure = new Error('Read failed');
  api.listAchievements.mockRejectedValueOnce(failure);
  syncQueue.mockClear();
  await act(async () => {
    await expect(result.current.refreshSelected()).rejects.toBe(failure);
  });
  expect(result.current.achievements).toEqual(data('1').achievements);
  expect(result.current.achievementsLoaded).toBe(true);
  expect(syncQueue).not.toHaveBeenCalled();
});
