// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Queue } from '../../../src/shared/api';
import { createDemoApi } from '../../../src/shared/demo-api';
import { useWorkspace } from '../../../src/renderer/use-workspace';
import { deferred, OTHER_USER } from './fixtures';

afterEach(cleanup);

async function setup() {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  await api.addAchievements({ gameId: '1', achievementIds: ['5'], action: 'lock' });
  await api.addAchievements({ gameId: '2', achievementIds: ['201'] });
  const hook = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  return { api, ...hook };
}

it.each(['unlock', 'lock'] as const)(
  'bulk %s removes only opposite requests for that game and keeps saved dates',
  async (action) => {
    const { api, result } = await setup();
    const original = result.current.queue!;
    const other = result.current.queues.find((queue) => queue.game.id === '2');
    const same = original.items.filter((item) => (item.action ?? 'unlock') === action);
    const ids = action === 'unlock' ? ['4'] : ['7'];
    const apply = vi.spyOn(api, 'apply');
    await act(async () => {
      expect(await result.current.queueAll(ids, action)).toBe(true);
    });
    const items = result.current.queue!.items;
    expect(items.every((item) => (item.action ?? 'unlock') === action)).toBe(true);
    expect(items.slice(0, same.length)).toEqual(same);
    expect(items.at(-1)?.achievement_id).toBe(ids[0]);
    expect(result.current.queues.find((queue) => queue.game.id === '2')).toBe(other);
    expect(result.current.game?.id).toBe('1');
    expect(apply).not.toHaveBeenCalled();
  },
);

it('removes opposite requests without adding anything when all eligible targets are already queued', async () => {
  const { api, result } = await setup();
  const adding = vi.spyOn(api, 'addAchievements');
  await act(async () => {
    expect(await result.current.queueAll([], 'unlock')).toBe(true);
  });
  expect(result.current.queue!.items.map((item) => item.achievement_id)).toEqual(['1', '2', '3']);
  expect(adding).not.toHaveBeenCalled();
});

it('blocks overlapping edits until the whole bulk change is saved and invalidates the preview', async () => {
  const { api, result } = await setup();
  act(() => result.current.prepareApply('1'));
  await waitFor(() => expect(result.current.preview).not.toBeNull());
  await waitFor(() => expect(result.current.busy).toBe(false));
  const remove = api.removeAchievements.bind(api);
  const pending = deferred<void>();
  const removing = vi.spyOn(api, 'removeAchievements').mockImplementation(async (input) => {
    await pending.promise;
    return remove(input);
  });
  const adding = vi.spyOn(api, 'addAchievements');
  let saving!: Promise<boolean>;
  act(() => {
    saving = result.current.queueAll(['4'], 'unlock');
  });
  expect(result.current.preview).toBeNull();
  expect(result.current.busy).toBe(true);
  await act(async () => {
    expect(await result.current.queueAll(['7'], 'lock')).toBe(false);
    expect(await result.current.clearQueue('1')).toBe(false);
    result.current.add(['6']);
  });
  expect(removing).toHaveBeenCalledTimes(1);
  expect(adding).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve();
    expect(await saving).toBe(true);
  });
  expect(adding).toHaveBeenCalledExactlyOnceWith({
    gameId: '1',
    achievementIds: ['4'],
    action: 'unlock',
  });
  expect(result.current.busy).toBe(false);
});

it.each(['remove', 'add'] as const)(
  'reloads the saved queue after a failed bulk %s without applying or retrying',
  async (stage) => {
    const { api, result } = await setup();
    const adding = vi.spyOn(api, 'addAchievements');
    const removing = vi.spyOn(api, 'removeAchievements');
    const apply = vi.spyOn(api, 'apply');
    const failure = new Error('Bulk queue save failed.');
    if (stage === 'remove') removing.mockRejectedValueOnce(failure);
    else adding.mockRejectedValueOnce(failure);
    await act(async () => {
      expect(await result.current.queueAll(['4'], 'unlock')).toBe(false);
    });
    expect(result.current.error?.message).toBe(failure.message);
    expect(result.current.queues).toEqual(await act(() => api.listQueues()));
    expect(removing).toHaveBeenCalledTimes(1);
    expect(adding).toHaveBeenCalledTimes(stage === 'remove' ? 0 : 1);
    expect(apply).not.toHaveBeenCalled();
  },
);

it('stops before adding when removal finds a different account', async () => {
  const { api, result } = await setup();
  const adding = vi.spyOn(api, 'addAchievements');
  vi.spyOn(api, 'removeAchievements').mockRejectedValueOnce(
    Object.assign(new Error('Account changed.'), { code: 'ACCOUNT_CHANGED' }),
  );
  const initial = await api.initialize();
  vi.spyOn(api, 'initialize').mockResolvedValue({
    ...initial,
    auth: { authenticated: true, user_id: OTHER_USER },
  });
  await act(async () => {
    expect(await result.current.queueAll(['4'], 'unlock')).toBe(false);
  });
  expect(adding).not.toHaveBeenCalled();
  expect(result.current.queues).toEqual([]);
  expect(result.current.error?.code).toBe('ACCOUNT_CHANGED');
});

it('does not add after a pending removal completes for an unmounted workspace', async () => {
  const { api, result, unmount } = await setup();
  const pending = deferred<Queue>();
  const saved = { ...result.current.queue!, items: [] };
  vi.spyOn(api, 'removeAchievements').mockReturnValueOnce(pending.promise);
  const adding = vi.spyOn(api, 'addAchievements');
  let saving!: Promise<boolean>;
  act(() => {
    saving = result.current.queueAll(['4'], 'unlock');
  });
  unmount();
  pending.resolve(saved);
  expect(await saving).toBe(false);
  expect(adding).not.toHaveBeenCalled();
});
