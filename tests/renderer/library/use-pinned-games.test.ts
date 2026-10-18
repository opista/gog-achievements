// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePinnedGames } from '../../../src/renderer/features/library/use-pinned-games';
import { pinnedGamesFirst } from '../../../src/renderer/features/library/library-model';

const key = (userId = '123') => `gog-achievements.library-pins:v1:${userId}`;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('saves only versioned string IDs and restores them after remounting', () => {
  localStorage.setItem('unrelated-preference', 'keep');
  const largeId = '90071992547409931234';
  const { result, unmount } = renderHook(() => usePinnedGames('123'));
  act(() => {
    result.current.toggle(largeId);
    result.current.toggle('0001');
  });
  expect(JSON.parse(localStorage.getItem(key())!)).toEqual({
    version: 1,
    gameIds: [largeId, '0001'],
  });
  expect(localStorage.getItem('unrelated-preference')).toBe('keep');
  expect(localStorage.length).toBe(2);
  unmount();
  const restored = renderHook(() => usePinnedGames('123'));
  expect([...restored.result.current.ids]).toEqual([largeId, '0001']);
  act(() => restored.result.current.toggle(largeId));
  expect(JSON.parse(localStorage.getItem(key())!).gameIds).toEqual(['0001']);
});

it('isolates accounts and makes no anonymous preference writes', () => {
  const { result, rerender } = renderHook(({ id }) => usePinnedGames(id), {
    initialProps: { id: '123' as string | undefined },
  });
  act(() => result.current.toggle('1'));
  rerender({ id: '456' });
  expect([...result.current.ids]).toEqual([]);
  act(() => result.current.toggle('2'));
  expect(JSON.parse(localStorage.getItem(key('123'))!).gameIds).toEqual(['1']);
  expect(JSON.parse(localStorage.getItem(key('456'))!).gameIds).toEqual(['2']);
  rerender({ id: undefined });
  act(() => result.current.toggle('3'));
  expect([...result.current.ids]).toEqual([]);
  expect(localStorage.length).toBe(2);
  rerender({ id: '123' });
  expect([...result.current.ids]).toEqual(['1']);
});

it.each([
  '{bad json',
  'null',
  '[]',
  '{"version":2,"gameIds":["1"]}',
  '{"version":1,"gameIds":[1]}',
  '{"version":1,"gameIds":[""]}',
])('ignores malformed or unsupported preference data: %s', (raw) => {
  localStorage.setItem(key(), raw);
  const { result } = renderHook(() => usePinnedGames('123'));
  expect([...result.current.ids]).toEqual([]);
  expect(localStorage.getItem(key())).toBe(raw);
});

it('reports blocked storage and keeps the saved state if a write fails', () => {
  localStorage.setItem(key(), JSON.stringify({ version: 1, gameIds: ['1'] }));
  const { result } = renderHook(() => usePinnedGames('123'));
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota exceeded');
  });
  act(() => result.current.toggle('2'));
  expect([...result.current.ids]).toEqual(['1']);
  expect(result.current.error).toMatch(/could not be saved/);
  write.mockRestore();
  act(() => result.current.toggle('2'));
  expect([...result.current.ids]).toEqual(['1', '2']);
  expect(result.current.error).toBeNull();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  const blocked = renderHook(() => usePinnedGames('456'));
  expect([...blocked.result.current.ids]).toEqual([]);
  expect(blocked.result.current.error).toMatch(/could not be read/);
});

it('loads preference changes from another window only for the current account', () => {
  const { result } = renderHook(() => usePinnedGames('123'));
  localStorage.setItem(key(), JSON.stringify({ version: 1, gameIds: ['2'] }));
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: key('456'), storageArea: localStorage }),
    );
  });
  expect([...result.current.ids]).toEqual([]);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: key(), storageArea: localStorage }));
  });
  expect([...result.current.ids]).toEqual(['2']);
});

it('partitions 10,000 games without changing source order or pruning absent pins', () => {
  const games = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), title: `Game ${i}` }));
  const ids = new Set(['9999', '5000', 'missing', '1']);
  const ordered = pinnedGamesFirst(games, ids);
  expect(ordered.slice(0, 3).map((game) => game.id)).toEqual(['1', '5000', '9999']);
  expect(ordered.slice(3)).toEqual(games.filter((game) => !ids.has(game.id)));
  expect(games[0]!.id).toBe('0');
  expect([...ids]).toEqual(['9999', '5000', 'missing', '1']);
});
