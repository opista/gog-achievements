// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createDemoApi } from '../../src/shared/demo-api';
import { useWorkspace } from '../../src/renderer/use-workspace';
const OTHER_USER = '987654321';
afterEach(cleanup);
async function workspace() {
  const api = createDemoApi({ delayMs: 0 });
  const hook = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  act(() => hook.result.current.login());
  await waitFor(() => expect(hook.result.current.queue?.items).toHaveLength(3));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  return { api, ...hook };
}
function expectAccountDataCleared(value: ReturnType<typeof useWorkspace>) {
  expect(value.games).toEqual([]);
  expect(value.game).toBeNull();
  expect(value.achievements).toEqual([]);
  expect(value.queue).toBeNull();
  expect(value.history).toEqual([]);
  expect(value.preview).toBeNull();
  expect(value.result).toBeNull();
}
it('clears the old account before a new-account library request can fail', async () => {
  const { api, result } = await workspace();
  act(() => result.current.createPreview());
  await waitFor(() => expect(result.current.preview).not.toBeNull());
  await waitFor(() => expect(result.current.busy).toBe(false));
  vi.spyOn(api, 'login').mockResolvedValue({ authenticated: true, user_id: OTHER_USER });
  vi.spyOn(api, 'listGames').mockRejectedValue(
    new Error('New account library could not be loaded.'),
  );
  act(() => result.current.login());
  await waitFor(() =>
    expect(result.current.error?.message).toBe('New account library could not be loaded.'),
  );
  expect(result.current.auth.user_id).toBe(OTHER_USER);
  expectAccountDataCleared(result.current);
});
it('rechecks auth before committing a library response from a different account', async () => {
  const { api, result } = await workspace();
  const nextGame = { id: '9', title: 'New account game' };
  const initialize = vi.spyOn(api, 'initialize').mockResolvedValue({
    version: '0.1.0',
    cliVersion: '0.3.0',
    auth: { authenticated: true, user_id: OTHER_USER },
    operation: { kind: 'idle' },
  });
  vi.spyOn(api, 'listGames').mockResolvedValue({
    user_id: OTHER_USER,
    count: 1,
    games: [nextGame],
  });
  vi.spyOn(api, 'listAchievements').mockResolvedValue({
    user_id: OTHER_USER,
    game: { ...nextGame, client_id: '100009' },
    count: 0,
    achievements: [],
  });
  vi.spyOn(api, 'getQueue').mockResolvedValue(null);
  vi.spyOn(api, 'history').mockResolvedValue([]);
  act(() => result.current.refreshLibrary());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(result.current.auth.user_id).toBe(OTHER_USER);
  expect(result.current.games).toEqual([nextGame]);
  expect(result.current.game?.id).toBe('9');
  expect(result.current.queue).toBeNull();
  expect(result.current.result).toBeNull();
});
it('does not display achievement data under a different account header', async () => {
  const { api, result } = await workspace();
  vi.spyOn(api, 'listAchievements').mockResolvedValue({
    user_id: OTHER_USER,
    game: { id: '1', title: 'Cyberpunk 2077', client_id: '100001' },
    count: 1,
    achievements: [
      {
        id: '999',
        key: 'different',
        name: 'Another account achievement',
        description: '',
        unlocked: false,
        unlocked_at: null,
        hidden: false,
        image_locked: null,
        image_unlocked: null,
        rarity: null,
      },
    ],
  });
  vi.spyOn(api, 'initialize').mockResolvedValue({
    version: '0.1.0',
    cliVersion: '0.3.0',
    auth: { authenticated: true, user_id: OTHER_USER },
    operation: { kind: 'idle' },
  });
  act(() => result.current.refreshAchievements());
  await waitFor(() => expect(result.current.error?.code).toBe('ACCOUNT_CHANGED'));
  expect(result.current.auth.user_id).toBe(OTHER_USER);
  expectAccountDataCleared(result.current);
});
it.each(['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'])(
  'invalidates account-scoped state for %s errors',
  async (code) => {
    const { api, result } = await workspace();
    vi.spyOn(api, 'listGames').mockRejectedValue(
      Object.assign(new Error('The account changed.'), { code }),
    );
    vi.spyOn(api, 'initialize').mockResolvedValue({
      version: '0.1.0',
      cliVersion: '0.3.0',
      auth: { authenticated: true, user_id: OTHER_USER },
      operation: { kind: 'idle' },
    });
    act(() => result.current.refreshLibrary());
    await waitFor(() => expect(result.current.error?.code).toBe(code));
    expect(result.current.auth.user_id).toBe(OTHER_USER);
    expectAccountDataCleared(result.current);
  },
);
it('keeps the matching draft and report visible after a failed library refresh', async () => {
  const { api, result } = await workspace();
  act(() => result.current.createPreview());
  await waitFor(() => expect(result.current.preview).not.toBeNull());
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.apply());
  await waitFor(() => expect(result.current.view).toBe('results'));
  await waitFor(() => expect(result.current.busy).toBe(false));
  const priorResult = result.current.result;
  const priorQueue = result.current.queue;
  const priorHistory = result.current.history;
  vi.spyOn(api, 'listAchievements').mockRejectedValue(new Error('Read failed.'));
  act(() => result.current.refreshLibrary());
  await waitFor(() => expect(result.current.error?.message).toBe('Read failed.'));
  expect(result.current.view).toBe('results');
  expect(result.current.result).toBe(priorResult);
  expect(result.current.queue).toBe(priorQueue);
  expect(result.current.history).toBe(priorHistory);
});
