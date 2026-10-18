// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ApplyResult, PreviewResult } from '../../../src/shared/api';
import { AccountChangedError } from '../../../src/renderer/features/account/account-errors';
import { useApply } from '../../../src/renderer/features/apply/use-apply';
import { applied, deferred, preview } from './fixtures';

afterEach(cleanup);
function setup() {
  const api = {
    cancelPreview: vi.fn(async () => {}),
    preview: vi.fn(async () => preview()),
    apply: vi.fn(async () => applied()),
  };
  const dependencies = {
    assertOwner: vi.fn((userId: string) => {
      if (userId !== '123456789') throw new AccountChangedError();
    }),
    run: vi.fn(async (_label: string, _target: 'preview' | 'apply', task: () => Promise<void>) =>
      task(),
    ),
    onView: vi.fn(),
    refreshAfterApply: vi.fn(async (_gameId: string, _isCurrent: () => boolean) => {}),
  };
  const hook = renderHook(({ api }) => useApply(api, dependencies), { initialProps: { api } });
  return { api, dependencies, ...hook };
}

it('previews without writing and checks ownership before showing confirmation', async () => {
  const { api, dependencies, result } = setup();
  const pending = deferred<PreviewResult>();
  api.preview.mockReturnValueOnce(pending.promise);
  let task!: Promise<void>;
  act(() => {
    task = result.current.prepare('1');
  });
  expect(result.current.previewGameId).toBe('1');
  await act(async () => {
    pending.resolve(preview());
    await task;
  });
  expect(result.current.preview).toEqual(preview());
  expect(result.current.previewGameId).toBeNull();
  expect(dependencies.assertOwner).toHaveBeenCalledWith('123456789');
  expect(api.apply).not.toHaveBeenCalled();
});

it('sends the reviewed token once even when confirmation is clicked repeatedly', async () => {
  const { api, dependencies, result } = setup();
  api.preview.mockResolvedValueOnce(preview('2'));
  const pending = deferred<ApplyResult>();
  api.apply.mockReturnValueOnce(pending.promise);
  await act(() => result.current.prepare('2'));
  let task!: Promise<void>;
  act(() => {
    task = result.current.apply();
    void result.current.apply();
    void result.current.prepare('1');
  });
  expect(result.current.preview).toBeNull();
  expect(result.current.resultGame?.id).toBe('2');
  expect(dependencies.onView).toHaveBeenCalledExactlyOnceWith('applying');
  expect(api.apply).toHaveBeenCalledExactlyOnceWith({ previewToken: 'reviewed-2' });
  await act(async () => {
    pending.resolve(applied('2'));
    await task;
  });
  await act(() => result.current.apply());
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(api.preview).toHaveBeenCalledTimes(1);
  expect(result.current.result).toEqual(applied('2'));
  expect(dependencies.refreshAfterApply).toHaveBeenCalledWith('2', expect.any(Function));
  expect(dependencies.onView).toHaveBeenLastCalledWith('results');
});

it('requires a live confirmation and preserves it if the shared action lock refuses a write', async () => {
  const { api, dependencies, result } = setup();
  await act(() => result.current.apply());
  await act(() => result.current.prepare('1'));
  dependencies.run.mockImplementationOnce(async () => {});
  await act(() => result.current.apply());
  expect(result.current.preview).toEqual(preview());
  expect(dependencies.onView).not.toHaveBeenCalled();
  act(() => result.current.invalidate());
  await act(() => result.current.apply());
  expect(api.apply).not.toHaveBeenCalled();
});

it('does not publish a pending preview if the shared action lock refuses it', async () => {
  const { api, dependencies, result } = setup();
  dependencies.run.mockImplementationOnce(async () => {});
  await act(() => result.current.prepare('1'));
  expect(result.current.previewGameId).toBeNull();
  expect(api.preview).not.toHaveBeenCalled();
});

it('keeps an uncertain outcome without retrying after a transport failure', async () => {
  const { api, dependencies, result } = setup();
  api.apply.mockRejectedValueOnce(new Error('Connection lost.'));
  await act(() => result.current.prepare('1'));
  await act(() => result.current.apply());
  await act(() => result.current.apply());
  expect(result.current.result).toMatchObject({
    state: 'unknown',
    report: null,
    error: { code: 'UNKNOWN_OUTCOME', message: 'Connection lost.' },
  });
  expect(api.apply).toHaveBeenCalledTimes(1);
  expect(dependencies.refreshAfterApply).toHaveBeenCalledTimes(1);
});

it.each(['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'])(
  'passes %s to account recovery instead of treating it as an unknown write',
  async (code) => {
    const { api, dependencies, result } = setup();
    const failure = Object.assign(new Error('Account changed.'), { code });
    api.apply.mockRejectedValueOnce(failure);
    await act(() => result.current.prepare('1'));
    await act(async () => {
      await expect(result.current.apply()).rejects.toBe(failure);
    });
    expect(result.current.result).toBeNull();
    expect(dependencies.refreshAfterApply).not.toHaveBeenCalled();
  },
);

it.each(['preview', 'apply'] as const)(
  'rejects foreign %s reports before publishing them',
  async (method) => {
    const { api, dependencies, result } = setup();
    if (method === 'apply') await act(() => result.current.prepare('1'));
    const foreign = method === 'preview' ? preview() : applied();
    foreign.report!.user_id = '987654321';
    if (method === 'preview') api.preview.mockResolvedValueOnce(foreign as PreviewResult);
    else api.apply.mockResolvedValueOnce(foreign as ApplyResult);
    // The real account guard clears feature state before throwing. The error must still escape.
    dependencies.assertOwner.mockImplementationOnce(() => {
      result.current.clear();
      throw new AccountChangedError();
    });
    await act(async () => {
      await expect(
        method === 'preview' ? result.current.prepare('1') : result.current.apply(),
      ).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    });
    expect(result.current.preview).toBeNull();
    expect(result.current.result).toBeNull();
    expect(dependencies.refreshAfterApply).not.toHaveBeenCalled();
  },
);

it('retains the confirmed report when a later refresh fails', async () => {
  const { dependencies, result } = setup();
  dependencies.refreshAfterApply.mockRejectedValueOnce(new Error('Refresh failed.'));
  await act(() => result.current.prepare('1'));
  await act(async () => {
    await expect(result.current.apply()).rejects.toThrow('Refresh failed.');
  });
  expect(result.current.result).toEqual(applied());
  expect(dependencies.onView).toHaveBeenLastCalledWith('results');
  act(() => result.current.invalidate());
  expect(result.current.result).toEqual(applied());
  act(() => result.current.clear());
  expect(result.current.result).toBeNull();
  expect(result.current.resultGame).toBeNull();
});

it.each(['resolve', 'reject'] as const)(
  'discards a cancelled preview that later %ss',
  async (settle) => {
    const { api, dependencies, result } = setup();
    const pending = deferred<PreviewResult>();
    api.preview.mockReturnValueOnce(pending.promise);
    let task!: Promise<void>;
    act(() => {
      task = result.current.prepare('1');
    });
    act(() => result.current.invalidate());
    await act(async () => {
      if (settle === 'resolve') pending.resolve(preview());
      else pending.reject(new Error('Late error.'));
      await task;
    });
    expect(result.current.preview).toBeNull();
    expect(result.current.previewGameId).toBeNull();
    expect(dependencies.assertOwner).not.toHaveBeenCalled();
  },
);

it.each(['clear', 'replace', 'unmount'] as const)(
  'discards late apply responses after %s',
  async (change) => {
    const { api, dependencies, result, rerender, unmount } = setup();
    const pending = deferred<ApplyResult>();
    api.apply.mockReturnValueOnce(pending.promise);
    await act(() => result.current.prepare('1'));
    dependencies.assertOwner.mockClear();
    let task!: Promise<void>;
    act(() => {
      task = result.current.apply();
    });
    if (change === 'clear') act(() => result.current.clear());
    else if (change === 'replace') rerender({ api: { ...api } });
    else unmount();
    await act(async () => {
      pending.resolve(applied());
      await task;
    });
    expect(dependencies.assertOwner).not.toHaveBeenCalled();
    expect(dependencies.onView).toHaveBeenCalledExactlyOnceWith('applying');
    expect(dependencies.refreshAfterApply).not.toHaveBeenCalled();
    if (change !== 'unmount') expect(result.current.result).toBeNull();
  },
);

it('keeps the new preview task locked when an obsolete write rejects', async () => {
  const { api, dependencies, result, rerender } = setup();
  const oldWrite = deferred<ApplyResult>();
  api.apply.mockReturnValueOnce(oldWrite.promise);
  await act(() => result.current.prepare('1'));
  let oldTask!: Promise<void>;
  act(() => {
    oldTask = result.current.apply();
  });
  const newRead = deferred<PreviewResult>();
  const nextApi = { ...api, preview: vi.fn().mockReturnValue(newRead.promise) };
  rerender({ api: nextApi });
  expect(result.current.resultGame).toBeNull();
  let nextTask!: Promise<void>;
  act(() => {
    nextTask = result.current.prepare('2');
  });
  await act(async () => {
    oldWrite.reject(new Error('Old failure.'));
    await oldTask;
  });
  await act(() => result.current.prepare('1'));
  expect(nextApi.preview).toHaveBeenCalledTimes(1);
  expect(result.current.previewGameId).toBe('2');
  await act(async () => {
    newRead.resolve(preview('2'));
    await nextTask;
  });
  expect(result.current.preview?.report.game.id).toBe('2');
  expect(dependencies.refreshAfterApply).not.toHaveBeenCalled();
});
