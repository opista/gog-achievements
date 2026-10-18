// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePinnedGames } from '../../../src/renderer/features/library/use-pinned-games';

const key = (user = 'account-a') => `gog-achievements:pinned-games:v1:${user}`;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it('keeps exact string IDs across remounts, including IDs outside the current library', () => {
  window.localStorage.setItem('unrelated-queue', 'unchanged');
  const first = renderHook(() => usePinnedGames('account-a', false));
  act(() => {
    first.result.current.togglePin('9007199254740993');
    first.result.current.togglePin('00123');
  });
  expect(JSON.parse(window.localStorage.getItem(key())!)).toEqual(['9007199254740993', '00123']);
  first.unmount();
  const second = renderHook(() => usePinnedGames('account-a', false));
  expect([...second.result.current.pinnedIds]).toEqual(['9007199254740993', '00123']);
  act(() => second.result.current.togglePin('00123'));
  expect(JSON.parse(window.localStorage.getItem(key())!)).toEqual(['9007199254740993']);
  expect(window.localStorage.getItem('unrelated-queue')).toBe('unchanged');
});

it('switches accounts and demo namespaces without copying pins or writing on sign-out', () => {
  const hook = renderHook(({ user, demo }) => usePinnedGames(user, demo), {
    initialProps: { user: 'account-a' as string | undefined, demo: false },
  });
  act(() => hook.result.current.togglePin('1'));
  hook.rerender({ user: 'account-b', demo: false });
  expect([...hook.result.current.pinnedIds]).toEqual([]);
  act(() => hook.result.current.togglePin('2'));
  hook.rerender({ user: undefined, demo: false });
  act(() => hook.result.current.togglePin('3'));
  expect([...hook.result.current.pinnedIds]).toEqual([]);
  expect(window.localStorage.length).toBe(2);
  hook.rerender({ user: 'account-a', demo: false });
  expect([...hook.result.current.pinnedIds]).toEqual(['1']);
  hook.rerender({ user: 'account-a', demo: true });
  expect([...hook.result.current.pinnedIds]).toEqual([]);
  act(() => hook.result.current.togglePin('4'));
  hook.rerender({ user: 'account-b', demo: false });
  expect([...hook.result.current.pinnedIds]).toEqual(['2']);
  expect(window.localStorage.getItem(key())).toBe('["1"]');
});

it.each(['{broken', '{}', 'null', '[1]', '["1",2]', '[""]'])(
  'handles malformed preferences (%s) without converting IDs',
  (stored) => {
    window.localStorage.setItem(key(), stored);
    const { result } = renderHook(() => usePinnedGames('account-a', false));
    expect([...result.current.pinnedIds]).toEqual([]);
    expect(result.current.pinError).toContain('could not be loaded');
    act(() => result.current.togglePin('1'));
    expect(result.current.pinError).toBeNull();
    expect(window.localStorage.getItem(key())).toBe('["1"]');
  },
);

it('reports unavailable storage and keeps pin controls usable for this session', () => {
  vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  const { result } = renderHook(() => usePinnedGames('account-a', false));
  expect(result.current.pinError).toContain('could not be loaded');
  act(() => result.current.togglePin('1'));
  expect([...result.current.pinnedIds]).toEqual(['1']);
  expect(result.current.pinError).toContain('could not be saved');
  act(() => result.current.togglePin('1'));
  expect([...result.current.pinnedIds]).toEqual([]);
});

it('loads changes from another window only for the active account', () => {
  window.localStorage.setItem(key(), '["1","1"]');
  const { result } = renderHook(() => usePinnedGames('account-a', false));
  expect([...result.current.pinnedIds]).toEqual(['1']);
  window.localStorage.setItem(key('account-b'), '["2"]');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key('account-b') })));
  expect([...result.current.pinnedIds]).toEqual(['1']);
  window.localStorage.setItem(key(), '["3"]');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key() })));
  expect([...result.current.pinnedIds]).toEqual(['3']);
  window.localStorage.clear();
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
  expect([...result.current.pinnedIds]).toEqual([]);
});
