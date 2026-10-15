// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopApi, Queue } from '../../../src/shared/api';
import { createDemoApi } from '../../../src/shared/demo-api';
import { useWorkspace } from '../../../src/renderer/use-workspace';
import { deferred, OTHER_USER } from './fixtures';

afterEach(cleanup);

async function setup() {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  await api.addAchievements({ gameId: '2', achievementIds: ['201'] });
  const hook = renderHook(({ api }: { api: DesktopApi }) => useWorkspace(api), {
    initialProps: { api },
  });
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  return { api, ...hook };
}

it('serializes clearing across games, blocks overlapping edits and preserves requests added later', async () => {
  const { api, result } = await setup();
  act(() => result.current.prepareApply('1'));
  await waitFor(() => expect(result.current.preview).not.toBeNull());
  await waitFor(() => expect(result.current.busy).toBe(false));
  const remove = api.removeAchievements.bind(api);
  const first = deferred<void>();
  const removing = vi.spyOn(api, 'removeAchievements').mockImplementation(async (input) => {
    if (input.gameId === '1') await first.promise;
    return remove(input);
  });
  const adding = vi.spyOn(api, 'addAchievements');
  const apply = vi.spyOn(api, 'apply');
  let clearing!: Promise<boolean>;
  act(() => {
    clearing = result.current.clearQueue();
  });
  expect(result.current.preview).toBeNull();
  expect(result.current.busy).toBe(true);
  await act(async () => {
    expect(await result.current.clearQueue()).toBe(false);
    result.current.add(['4']);
  });
  expect(removing).toHaveBeenCalledTimes(1);
  expect(adding).not.toHaveBeenCalled();
  // Another local client can save a new request after the clear snapshot.
  await act(() => api.addAchievements({ gameId: '2', achievementIds: ['202'] }));
  await act(async () => {
    first.resolve();
    expect(await clearing).toBe(true);
  });
  expect(removing.mock.calls).toEqual([
    [{ gameId: '1', achievementIds: ['1', '2', '3'] }],
    [{ gameId: '2', achievementIds: ['201'] }],
  ]);
  expect(
    result.current.queues.flatMap((queue) => queue.items.map((item) => item.achievement_id)),
  ).toEqual(['202']);
  expect(result.current.game?.id).toBe('1');
  expect(result.current.busy).toBe(false);
  expect(apply).not.toHaveBeenCalled();
});

it('stops on a failed removal and reloads the saved queues without restoring cleared requests', async () => {
  const { api, result } = await setup();
  const remove = api.removeAchievements.bind(api);
  const removing = vi.spyOn(api, 'removeAchievements').mockImplementation(async (input) => {
    if (input.gameId === '2') throw new Error('Could not clear Witcher requests.');
    return remove(input);
  });
  await act(async () => {
    expect(await result.current.clearQueue()).toBe(false);
  });
  expect(result.current.error?.message).toBe('Could not clear Witcher requests.');
  const saved = await act(() => api.listQueues());
  expect(result.current.queues).toEqual(saved);
  expect(result.current.queues.map((queue) => queue.game.id)).toEqual(['2']);
  expect(removing).toHaveBeenCalledTimes(2);
  expect(result.current.busy).toBe(false);
});

it('clears only the requested game, including one outside the selected game', async () => {
  const { api, result } = await setup();
  const original = result.current.queue;
  const removing = vi.spyOn(api, 'removeAchievements');
  await act(async () => {
    expect(await result.current.clearQueue('2')).toBe(true);
  });
  expect(removing).toHaveBeenCalledExactlyOnceWith({ gameId: '2', achievementIds: ['201'] });
  expect(result.current.queue).toBe(original);
  expect(result.current.game?.id).toBe('1');
  expect(
    result.current.queues.filter((queue) => queue.items.length).map((queue) => queue.game.id),
  ).toEqual(['1']);
});

it('stops before the next game and clears account data when the account changes', async () => {
  const { api, result } = await setup();
  const removing = vi
    .spyOn(api, 'removeAchievements')
    .mockRejectedValueOnce(
      Object.assign(new Error('The account changed.'), { code: 'ACCOUNT_CHANGED' }),
    );
  const initial = await api.initialize();
  vi.spyOn(api, 'initialize').mockResolvedValue({
    ...initial,
    auth: { authenticated: true, user_id: OTHER_USER },
  });
  await act(async () => {
    expect(await result.current.clearQueue()).toBe(false);
  });
  expect(removing).toHaveBeenCalledTimes(1);
  expect(result.current.error?.code).toBe('ACCOUNT_CHANGED');
  expect(result.current.auth.user_id).toBe(OTHER_USER);
  expect(result.current.queues).toEqual([]);
});

it('ignores a late clear response after replacing the desktop API', async () => {
  const { api, result, rerender } = await setup();
  const pending = deferred<Queue>();
  const emptied = { ...(await api.getQueue('1'))!, items: [] };
  const removing = vi.spyOn(api, 'removeAchievements').mockReturnValueOnce(pending.promise);
  let clearing!: Promise<boolean>;
  act(() => {
    clearing = result.current.clearQueue();
  });
  const next = createDemoApi({ delayMs: 0 });
  await next.login();
  rerender({ api: next });
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => {
    pending.resolve(emptied);
    expect(await clearing).toBe(false);
  });
  expect(removing).toHaveBeenCalledTimes(1);
  expect(result.current.queue?.items).toHaveLength(3);
  expect(result.current.error).toBeNull();
});
