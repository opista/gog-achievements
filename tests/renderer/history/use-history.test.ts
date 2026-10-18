// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DesktopApi, OperationRecord } from '../../../src/shared/api';
import { useHistory } from '../../../src/renderer/features/history/use-history';

afterEach(cleanup);

const USER = '123456789';

function record(id: string, userId = USER): OperationRecord {
  return {
    id,
    user_id: userId,
    game_id: '1',
    game_title: 'Sample game',
    state: 'unknown',
    started_at: '2026-10-14T10:00:00Z',
    finished_at: '2026-10-14T10:01:00Z',
    report: null,
  };
}

function deferred() {
  let resolve!: (records: OperationRecord[]) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<OperationRecord[]>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it('loads account history through the read API and checks every record owner', async () => {
  const values = [record('first'), record('second')];
  const api = { history: vi.fn<DesktopApi['history']>().mockResolvedValue(values) };
  const assertOwner = vi.fn<(userId: string) => void>();
  const { result } = renderHook(() => useHistory(api, assertOwner));

  expect(result.current.records).toEqual([]);
  expect(result.current.loaded).toBe(false);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
  expect(api.history).not.toHaveBeenCalled();
  await act(() => result.current.load());

  expect(api.history).toHaveBeenCalledExactlyOnceWith({});
  expect(assertOwner.mock.calls).toEqual([[USER], [USER]]);
  expect(result.current.records).toEqual(values);
  expect(result.current.loaded).toBe(true);
  expect(result.current.loading).toBe(false);
  act(() => result.current.clear());
  expect(result.current.records).toEqual([]);
  expect(result.current.loaded).toBe(false);
  expect(api.history).toHaveBeenCalledTimes(1);
});

it('rejects a mixed-account response before publishing any rows', async () => {
  const previous = [record('previous')];
  const mismatch = Object.assign(new Error('Account changed'), { code: 'ACCOUNT_CHANGED' });
  const api = { history: vi.fn<DesktopApi['history']>().mockResolvedValue(previous) };
  const assertOwner = (userId: string) => {
    if (userId !== USER) throw mismatch;
  };
  const { result } = renderHook(() => useHistory(api, assertOwner));
  await act(() => result.current.load());
  api.history.mockResolvedValue([record('current'), record('foreign', '987654321')]);

  await act(async () => {
    await expect(result.current.load()).rejects.toBe(mismatch);
  });

  expect(result.current.records).toEqual(previous);
});

it('does not restore account rows when a pending read finishes after clear', async () => {
  const pending = deferred();
  const api = { history: vi.fn<DesktopApi['history']>().mockReturnValue(pending.promise) };
  const assertOwner = vi.fn<(userId: string) => void>();
  const { result } = renderHook(() => useHistory(api, assertOwner));
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.load();
  });

  act(() => result.current.clear());
  await act(async () => {
    pending.resolve([record('old-account')]);
    await loading;
  });

  expect(result.current.records).toEqual([]);
  expect(assertOwner).not.toHaveBeenCalled();
});

it('keeps the latest read when requests finish out of order', async () => {
  const earlier = deferred();
  const later = deferred();
  const api = {
    history: vi
      .fn<DesktopApi['history']>()
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(later.promise),
  };
  const assertOwner = vi.fn<(userId: string) => void>();
  const { result } = renderHook(() => useHistory(api, assertOwner));
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.load();
    second = result.current.load();
  });
  await act(async () => {
    later.resolve([record('latest')]);
    await second;
    earlier.resolve([record('stale', '987654321')]);
    await first;
  });

  expect(result.current.records).toEqual([record('latest')]);
  expect(assertOwner).toHaveBeenCalledExactlyOnceWith(USER);
});

it('ignores a pending response from a replaced API', async () => {
  const pending = deferred();
  const firstApi = { history: vi.fn<DesktopApi['history']>().mockReturnValue(pending.promise) };
  const nextApi = { history: vi.fn<DesktopApi['history']>().mockResolvedValue([record('next')]) };
  const assertOwner = vi.fn<(userId: string) => void>();
  const { result, rerender } = renderHook(({ api }) => useHistory(api, assertOwner), {
    initialProps: { api: firstApi },
  });
  let oldRead!: Promise<void>;
  act(() => {
    oldRead = result.current.load();
  });
  rerender({ api: nextApi });
  await act(() => result.current.load());
  await act(async () => {
    pending.resolve([record('stale', '987654321')]);
    await oldRead;
  });

  expect(result.current.records).toEqual([record('next')]);
  expect(assertOwner).toHaveBeenCalledExactlyOnceWith(USER);
});

it('does not validate or publish responses after unmount', async () => {
  const pending = deferred();
  const api = { history: vi.fn<DesktopApi['history']>().mockReturnValue(pending.promise) };
  const assertOwner = vi.fn<(userId: string) => void>();
  const { result, unmount } = renderHook(() => useHistory(api, assertOwner));
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.load();
  });
  unmount();
  await act(async () => {
    pending.resolve([record('stale')]);
    await loading;
  });

  expect(assertOwner).not.toHaveBeenCalled();
});

it('preserves readable history and propagates read errors to the workspace', async () => {
  const values = [record('saved')];
  const failure = new Error('History is unavailable');
  const api = { history: vi.fn<DesktopApi['history']>().mockResolvedValueOnce(values) };
  const { result } = renderHook(() => useHistory(api, vi.fn()));
  await act(() => result.current.load());
  api.history.mockRejectedValueOnce(failure);

  await act(async () => {
    await expect(result.current.load()).rejects.toBe(failure);
  });

  expect(result.current.records).toEqual(values);
  expect(result.current.loaded).toBe(true);
  expect(result.current.loading).toBe(false);
  expect(result.current.error?.message).toBe('History is unavailable');
});

it('keeps cached rows readable while a retry runs and clears its earlier error', async () => {
  const values = [record('saved')];
  const pending = deferred();
  const api = {
    history: vi
      .fn<DesktopApi['history']>()
      .mockResolvedValueOnce(values)
      .mockRejectedValueOnce(new Error('History is unavailable'))
      .mockReturnValueOnce(pending.promise),
  };
  const { result } = renderHook(() => useHistory(api, vi.fn()));
  await act(() => result.current.load());
  await act(async () => {
    await expect(result.current.load()).rejects.toThrow('History is unavailable');
  });
  let loading!: Promise<void>;
  act(() => {
    loading = result.current.load();
  });
  expect(result.current.records).toEqual(values);
  expect(result.current.loaded).toBe(true);
  expect(result.current.loading).toBe(true);
  expect(result.current.error).toBeNull();
  await act(async () => {
    pending.resolve([]);
    await loading;
  });
  expect(result.current.records).toEqual([]);
  expect(result.current.loaded).toBe(true);
  expect(result.current.loading).toBe(false);
});

it('does not mark a failed first read as an empty history and resets its error on clear', async () => {
  const api = { history: vi.fn<DesktopApi['history']>().mockRejectedValue('unknown failure') };
  const { result } = renderHook(() => useHistory(api, vi.fn()));
  await act(async () => {
    await expect(result.current.load()).rejects.toBe('unknown failure');
  });
  expect(result.current.loaded).toBe(false);
  expect(result.current.loading).toBe(false);
  expect(result.current.error?.message).toBe('The operation could not be completed.');
  act(() => result.current.clear());
  expect(result.current.records).toEqual([]);
  expect(result.current.error).toBeNull();
});

it.each(['clear', 'replace', 'unmount', 'newer read'] as const)(
  'ignores an obsolete failure after %s without unlocking a newer read',
  async (change) => {
    const obsolete = deferred();
    const latest = deferred();
    const api = {
      history: vi
        .fn<DesktopApi['history']>()
        .mockReturnValueOnce(obsolete.promise)
        .mockReturnValueOnce(latest.promise),
    };
    const nextApi = { history: vi.fn<DesktopApi['history']>().mockReturnValue(latest.promise) };
    const { result, rerender, unmount } = renderHook(({ api }) => useHistory(api, vi.fn()), {
      initialProps: { api },
    });
    let oldRead!: Promise<void>;
    act(() => {
      oldRead = result.current.load();
    });
    let newRead: Promise<void> | undefined;
    if (change === 'replace') rerender({ api: nextApi });
    else if (change === 'clear') act(() => result.current.clear());
    else if (change === 'unmount') unmount();
    if (change === 'replace' || change === 'newer read')
      act(() => {
        newRead = result.current.load();
      });
    await act(async () => {
      obsolete.reject(new Error('Obsolete failure'));
      await expect(oldRead).resolves.toBeUndefined();
    });
    expect(result.current.error).toBeNull();
    if (newRead) {
      expect(result.current.loading).toBe(true);
      await act(async () => {
        latest.resolve([record('latest')]);
        await newRead;
      });
      expect(result.current.records).toEqual([record('latest')]);
    }
  },
);

it.each(['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH', 'AUTH_REQUIRED', 'INVALID_CREDENTIALS'])(
  'leaves %s to the workspace session recovery without a duplicate scoped error',
  async (code) => {
    const failure = Object.assign(new Error('Check the session.'), { code });
    const api = { history: vi.fn<DesktopApi['history']>().mockRejectedValue(failure) };
    const { result } = renderHook(() => useHistory(api, vi.fn()));
    await act(async () => {
      await expect(result.current.load()).rejects.toBe(failure);
    });
    expect(result.current.loaded).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  },
);

it('propagates an owner mismatch even when validation clears this feature', async () => {
  const failure = Object.assign(new Error('Account changed'), { code: 'ACCOUNT_CHANGED' });
  const api = { history: vi.fn<DesktopApi['history']>().mockResolvedValue([record('foreign')]) };
  let clear = () => {};
  const { result } = renderHook(() =>
    useHistory(api, () => {
      clear();
      throw failure;
    }),
  );
  clear = result.current.clear;
  await act(async () => {
    await expect(result.current.load()).rejects.toBe(failure);
  });
  expect(result.current.records).toEqual([]);
  expect(result.current.loaded).toBe(false);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
});
