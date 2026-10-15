// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DesktopApi, Queue } from '../../../src/shared/api';
import { AccountChangedError } from '../../../src/renderer/features/account/account-errors';
import { useQueues } from '../../../src/renderer/features/queue/use-queues';
import { achievement, DATE, deferred, game, OTHER_USER, queue, USER } from './fixtures';

afterEach(cleanup);

function setup() {
  const api = {
    listQueues: vi.fn<DesktopApi['listQueues']>().mockResolvedValue([queue(), queue('2')]),
    getQueue: vi.fn<DesktopApi['getQueue']>().mockImplementation(async (id) => queue(id)),
    addAchievements: vi
      .fn<DesktopApi['addAchievements']>()
      .mockImplementation(async ({ gameId }) => queue(gameId)),
    removeAchievements: vi
      .fn<DesktopApi['removeAchievements']>()
      .mockImplementation(async ({ gameId }) => queue(gameId)),
    setDates: vi
      .fn<DesktopApi['setDates']>()
      .mockImplementation(async ({ gameId }) => queue(gameId)),
  };
  const assertOwner = vi.fn((owner: string) => {
    if (owner !== USER) throw new AccountChangedError();
  });
  const hook = renderHook(({ api }) => useQueues(api, assertOwner), { initialProps: { api } });
  return { ...hook, api, assertOwner };
}

const addition = () => ({
  gameId: '1',
  achievementIds: ['2'],
  game: game(),
  userId: USER,
  achievements: [achievement('1'), achievement('2')],
});

it('loads saved queues on request, checks every owner and distinguishes an empty load from no data', async () => {
  const { result, api, assertOwner } = setup();
  expect(result.current.queues).toEqual([]);
  expect(result.current.loaded).toBe(false);
  expect(api.listQueues).not.toHaveBeenCalled();
  await act(() => result.current.load());
  expect(result.current.queues).toEqual([queue(), queue('2')]);
  expect(result.current.forGame('2')).toEqual(queue('2'));
  expect(assertOwner.mock.calls).toEqual([[USER], [USER]]);
  api.listQueues.mockResolvedValueOnce([]);
  await act(() => result.current.load());
  expect(result.current.queues).toEqual([]);
  expect(result.current.loaded).toBe(true);
  expect(result.current.forGame()).toBeNull();
});

it('refreshes or clears one game while keeping the other saved queue', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  const other = result.current.forGame('2');
  const changed = { ...queue(), items: [] };
  api.getQueue.mockResolvedValueOnce(changed).mockResolvedValueOnce(null);
  await act(() => result.current.sync('1'));
  expect(result.current.forGame('1')).toEqual(changed);
  expect(result.current.forGame('2')).toBe(other);
  await act(() => result.current.sync('1'));
  expect(result.current.forGame('1')).toBeNull();
  expect(result.current.forGame('2')).toBe(other);
  expect(api.getQueue.mock.calls).toEqual([['1'], ['1']]);
});

it('rejects a mixed-account list before publishing any of its rows', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  api.listQueues.mockResolvedValueOnce([{ ...queue(), items: [] }, queue('2', OTHER_USER)]);
  await act(async () => {
    await expect(result.current.load()).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  });
  expect(result.current.queues).toEqual([queue(), queue('2')]);
});

it('keeps readable queues when a fresh load fails', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  const failure = new Error('Local drafts unavailable');
  api.listQueues.mockRejectedValueOnce(failure);
  await act(async () => {
    await expect(result.current.load()).rejects.toBe(failure);
  });
  expect(result.current.queues).toEqual([queue(), queue('2')]);
  expect(result.current.loaded).toBe(true);
});

it('ignores an older list that finishes after a newer load', async () => {
  const { result, api, assertOwner } = setup();
  const earlier = deferred<Queue[]>();
  const later = deferred<Queue[]>();
  api.listQueues.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
  const first = result.current.load();
  const second = result.current.load();
  await act(async () => {
    later.resolve([queue('2')]);
    await second;
    earlier.resolve([queue('1', OTHER_USER)]);
    await first;
  });
  expect(result.current.queues).toEqual([queue('2')]);
  expect(assertOwner).toHaveBeenCalledExactlyOnceWith(USER);
});

it.each(['response', 'error'] as const)(
  'ignores a selected-game %s after selection changes',
  async (outcome) => {
    const { result, api, assertOwner } = setup();
    const pending = deferred<Queue | null>();
    api.getQueue.mockReturnValueOnce(pending.promise);
    let selected = true;
    const syncing = result.current.sync('1', () => selected);
    selected = false;
    await act(async () => {
      if (outcome === 'response') pending.resolve(queue('1', OTHER_USER));
      else pending.reject(new AccountChangedError());
      await syncing;
    });
    expect(result.current.queues).toEqual([]);
    expect(assertOwner).not.toHaveBeenCalled();
  },
);

it.each(['response', 'error'] as const)(
  'does not restore cleared account data after a late list %s',
  async (outcome) => {
    const { result, api, assertOwner } = setup();
    await act(() => result.current.load());
    assertOwner.mockClear();
    const pending = deferred<Queue[]>();
    api.listQueues.mockReturnValueOnce(pending.promise);
    const loading = result.current.load();
    act(() => result.current.clear());
    await act(async () => {
      if (outcome === 'response') pending.resolve([queue('1', OTHER_USER)]);
      else pending.reject(new AccountChangedError());
      await loading;
    });
    expect(result.current.queues).toEqual([]);
    expect(result.current.loaded).toBe(false);
    expect(assertOwner).not.toHaveBeenCalled();
  },
);

it.each(['API replacement', 'unmount'] as const)(
  'ignores pending reads after %s',
  async (change) => {
    const { result, api, assertOwner, rerender, unmount } = setup();
    const pending = deferred<Queue | null>();
    api.getQueue.mockReturnValueOnce(pending.promise);
    const syncing = result.current.sync('1');
    if (change === 'unmount') unmount();
    else rerender({ api: { ...api } });
    await act(async () => {
      pending.resolve(queue('1', OTHER_USER));
      await syncing;
    });
    expect(assertOwner).not.toHaveBeenCalled();
  },
);

it('shows a provisional add until the saved response arrives and preserves other games', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  const other = result.current.forGame('2');
  const pending = deferred<Queue>();
  api.addAchievements.mockReturnValueOnce(pending.promise);
  let saving!: Promise<boolean>;
  act(() => {
    saving = result.current.add(addition());
  });
  expect(result.current.action).toEqual({ kind: 'add', gameId: '1' });
  expect(result.current.forGame('1')?.items.map((item) => item.achievement_id)).toEqual(['1', '2']);
  expect(result.current.forGame('2')).toBe(other);
  const confirmed = { ...result.current.forGame('1')!, updated_at: DATE };
  await act(async () => {
    pending.resolve(confirmed);
    expect(await saving).toBe(true);
  });
  expect(result.current.forGame('1')).toBe(confirmed);
  expect(result.current.action).toBeNull();
  expect(api.addAchievements).toHaveBeenCalledExactlyOnceWith({
    gameId: '1',
    achievementIds: ['2'],
  });
});

it('saves through the API when optional provisional metadata is unavailable', async () => {
  const { result, api } = setup();
  await act(() => result.current.add({ ...addition(), game: undefined }));
  expect(api.addAchievements).toHaveBeenCalledTimes(1);
  expect(result.current.forGame('1')).toEqual(queue());
});

it('blocks a second save before React renders and allows another after completion', async () => {
  const { result, api } = setup();
  const pending = deferred<Queue>();
  api.removeAchievements.mockReturnValueOnce(pending.promise);
  let removing!: Promise<boolean>;
  act(() => {
    removing = result.current.remove('1', ['1']);
  });
  expect(await result.current.saveDates('2', { '1': DATE })).toBe(false);
  expect(api.setDates).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(queue());
    await removing;
  });
  await act(() => result.current.saveDates('2', { '1': DATE }));
  expect(api.setDates).toHaveBeenCalledExactlyOnceWith({ gameId: '2', dates: { '1': DATE } });
});

it('edits exact UTC dates in one game and keeps the other queue unchanged', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  const other = result.current.forGame('2');
  const changed = queue();
  changed.items[0]!.unlocked_at = '2020-02-02T18:14:15Z';
  api.setDates.mockResolvedValueOnce(changed);
  await act(() => result.current.saveDates('1', { '1': '2020-02-02T18:14:15Z' }));
  expect(api.setDates).toHaveBeenCalledExactlyOnceWith({
    gameId: '1',
    dates: { '1': '2020-02-02T18:14:15Z' },
  });
  expect(result.current.forGame('1')?.items[0]?.unlocked_at).toBe('2020-02-02T18:14:15Z');
  expect(result.current.forGame('2')).toBe(other);
  expect(api.addAchievements).not.toHaveBeenCalled();
});

it('reloads saved queues after a failed add and reports the original failure', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  const failure = new Error('Save failed');
  api.addAchievements.mockRejectedValueOnce(failure);
  const durable = { ...queue(), items: [] };
  api.listQueues.mockResolvedValueOnce([durable, queue('2')]);
  await act(async () => {
    await expect(result.current.add(addition())).rejects.toBe(failure);
  });
  expect(result.current.forGame('1')).toEqual(durable);
  expect(result.current.action).toBeNull();
  expect(api.listQueues).toHaveBeenCalledTimes(2);
});

it.each(['existing', 'new'] as const)(
  'rolls back a provisional %s queue if save and reload both fail',
  async (kind) => {
    const { result, api } = setup();
    api.listQueues.mockResolvedValueOnce(kind === 'existing' ? [queue()] : []);
    await act(() => result.current.load());
    const previous = result.current.forGame('1');
    const failure = new Error('Save failed');
    api.addAchievements.mockRejectedValueOnce(failure);
    api.listQueues.mockRejectedValueOnce(new Error('Reload failed'));
    await act(async () => {
      await expect(result.current.add(addition())).rejects.toBe(failure);
    });
    expect(result.current.forGame('1')).toBe(previous);
    expect(result.current.loaded).toBe(true);
    expect(result.current.action).toBeNull();
  },
);

it.each(['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'])(
  'leaves %s failures to account recovery without another queue read',
  async (code) => {
    const { result, api } = setup();
    const failure = Object.assign(new Error('Account changed'), { code });
    api.removeAchievements.mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(result.current.remove('1', ['1'])).rejects.toBe(failure);
    });
    expect(api.listQueues).not.toHaveBeenCalled();
    expect(result.current.action).toBeNull();
  },
);

it('rejects a saved response owned by another account', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  api.removeAchievements.mockResolvedValueOnce(queue('1', OTHER_USER));
  await act(async () => {
    await expect(result.current.remove('1', ['1'])).rejects.toMatchObject({
      code: 'ACCOUNT_CHANGED',
    });
  });
  expect(result.current.queues).toEqual([queue(), queue('2')]);
  expect(result.current.action).toBeNull();
});

it('surfaces a foreign-account reload instead of restoring the prior account snapshot', async () => {
  const { result, api } = setup();
  api.addAchievements.mockRejectedValueOnce(new Error('Save failed'));
  api.listQueues.mockResolvedValueOnce([queue('1', OTHER_USER)]);
  await act(async () => {
    await expect(result.current.add(addition())).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  });
  expect(result.current.queues.some((value) => value.user_id === OTHER_USER)).toBe(false);
  expect(result.current.action).toBeNull();
});

it.each(['response', 'error'] as const)(
  'ignores a late save %s after account data is cleared',
  async (outcome) => {
    const { result, api, assertOwner } = setup();
    const pending = deferred<Queue>();
    api.removeAchievements.mockReturnValueOnce(pending.promise);
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.remove('1', ['1']);
    });
    act(() => result.current.clear());
    await act(async () => {
      if (outcome === 'response') pending.resolve(queue('1', OTHER_USER));
      else pending.reject(new AccountChangedError());
      expect(await saving).toBe(false);
    });
    expect(result.current.queues).toEqual([]);
    expect(result.current.action).toBeNull();
    expect(assertOwner).not.toHaveBeenCalled();
    expect(api.listQueues).not.toHaveBeenCalled();
  },
);

it('keeps the new save active when an earlier account save finishes', async () => {
  const { result, api } = setup();
  const old = deferred<Queue>();
  const fresh = deferred<Queue>();
  api.removeAchievements.mockReturnValueOnce(old.promise);
  api.setDates.mockReturnValueOnce(fresh.promise);
  let removing!: Promise<boolean>;
  let dating!: Promise<boolean>;
  act(() => {
    removing = result.current.remove('1', ['1']);
  });
  act(() => result.current.clear());
  act(() => {
    dating = result.current.saveDates('2', { '1': DATE });
  });
  await act(async () => {
    old.resolve(queue('1', OTHER_USER));
    await removing;
  });
  expect(result.current.action).toEqual({ kind: 'date', gameId: '2' });
  await act(async () => {
    fresh.resolve(queue('2'));
    expect(await dating).toBe(true);
  });
  expect(result.current.queues).toEqual([queue('2')]);
  expect(result.current.action).toBeNull();
});

it('does not overwrite a completed save with a list started before the save', async () => {
  const { result, api } = setup();
  const pending = deferred<Queue[]>();
  api.listQueues.mockReturnValueOnce(pending.promise);
  const loading = result.current.load();
  const durable = { ...queue(), items: [] };
  api.removeAchievements.mockResolvedValueOnce(durable);
  await act(() => result.current.remove('1', ['1']));
  await act(async () => {
    pending.resolve([queue()]);
    await loading;
  });
  expect(result.current.queues).toEqual([durable]);
});

it('keeps provisional rows when a read finishes during their save', async () => {
  const { result, api } = setup();
  await act(() => result.current.load());
  const pending = deferred<Queue>();
  api.addAchievements.mockReturnValueOnce(pending.promise);
  let saving!: Promise<boolean>;
  act(() => {
    saving = result.current.add(addition());
  });
  await act(() => result.current.load());
  expect(result.current.forGame('1')?.items.map((item) => item.achievement_id)).toEqual(['1', '2']);
  await act(async () => {
    pending.resolve(queue());
    await saving;
  });
});

it('does not restore an old queue when a failed-save reload finishes after clear', async () => {
  const { result, api } = setup();
  const reloading = deferred<Queue[]>();
  api.addAchievements.mockRejectedValueOnce(new Error('Save failed'));
  api.listQueues.mockReturnValueOnce(reloading.promise);
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = result.current.add(addition());
  });
  expect(api.listQueues).toHaveBeenCalledTimes(1);
  act(() => result.current.clear());
  await act(async () => {
    reloading.resolve([queue('1', OTHER_USER)]);
    expect(await saving).toBe(false);
  });
  expect(result.current.queues).toEqual([]);
  expect(result.current.loaded).toBe(false);
});

it('allows a save through a replacement API while the old save is still pending', async () => {
  const { result, api, rerender, assertOwner } = setup();
  const old = deferred<Queue>();
  api.removeAchievements.mockReturnValueOnce(old.promise);
  let removing!: Promise<boolean>;
  act(() => {
    removing = result.current.remove('1', ['1']);
  });
  const nextApi = {
    ...api,
    setDates: vi.fn<DesktopApi['setDates']>().mockResolvedValue(queue('2')),
  };
  rerender({ api: nextApi });
  await act(() => result.current.saveDates('2', { '1': DATE }));
  await act(async () => {
    old.resolve(queue('1', OTHER_USER));
    expect(await removing).toBe(false);
  });
  expect(result.current.queues).toEqual([queue('2')]);
  expect(result.current.action).toBeNull();
  expect(nextApi.setDates).toHaveBeenCalledTimes(1);
  expect(assertOwner).toHaveBeenCalledExactlyOnceWith(USER);
});

it.each(['response', 'error'] as const)(
  'ignores a pending save %s after unmount',
  async (outcome) => {
    const { result, api, assertOwner, unmount } = setup();
    const pending = deferred<Queue>();
    api.removeAchievements.mockReturnValueOnce(pending.promise);
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.remove('1', ['1']);
    });
    unmount();
    await act(async () => {
      if (outcome === 'response') pending.resolve(queue('1', OTHER_USER));
      else pending.reject(new AccountChangedError());
      expect(await saving).toBe(false);
    });
    expect(assertOwner).not.toHaveBeenCalled();
    expect(api.listQueues).not.toHaveBeenCalled();
  },
);
