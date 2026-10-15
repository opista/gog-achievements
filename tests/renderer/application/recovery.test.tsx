// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  DesktopApi,
  GamesData,
  InitializeResult,
  OperationState,
} from '../../../src/shared/api';
import { createDemoApi } from '../../../src/shared/demo-api';
import { useWorkspace } from '../../../src/renderer/use-workspace';

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture() {
  const demo = createDemoApi({ delayMs: 0 });
  await demo.login();
  let listener!: (state: OperationState) => void;
  const api: DesktopApi = {
    ...demo,
    onOperation: (next) => {
      listener = next;
      return () => {};
    },
  };
  const initial = await api.initialize();
  return { api, initial, emit: (state: OperationState) => listener(state) };
}

it('rechecks the session when recovery ends before a slow startup snapshot arrives', async () => {
  const { api, initial, emit } = await fixture();
  const startup = deferred<InitializeResult>();
  const initialize = vi.spyOn(api, 'initialize').mockReturnValueOnce(startup.promise);
  const listGames = vi.spyOn(api, 'listGames');
  const { result } = renderHook(() => useWorkspace(api));
  act(() => emit({ kind: 'idle' }));
  await act(async () => {
    startup.resolve({ ...initial, operation: { kind: 'recovery', gameId: '1' } });
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(initialize).toHaveBeenCalledTimes(2);
  expect(listGames).toHaveBeenCalledTimes(1);
  expect(result.current.view).toBe('browse');
  expect(result.current.game?.id).toBe('1');
});

it('waits for an active read before processing one completed recovery', async () => {
  const { api, emit } = await fixture();
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.busy).toBe(false));
  const games = await api.listGames();
  const read = deferred<GamesData>();
  const listGames = vi.spyOn(api, 'listGames').mockReturnValueOnce(read.promise);
  const initialize = vi.spyOn(api, 'initialize');
  act(() => result.current.refreshLibrary());
  act(() => {
    emit({ kind: 'recovery', gameId: '2' });
    emit({ kind: 'idle' });
    emit({ kind: 'idle' });
  });
  expect(initialize).not.toHaveBeenCalled();
  await act(async () => {
    read.resolve(games);
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(listGames).toHaveBeenCalledTimes(2);
  expect(result.current.game?.id).toBe('2');
});

it('returns to sign-in when recovery finds no saved session', async () => {
  const { api, initial, emit } = await fixture();
  const initialize = vi
    .spyOn(api, 'initialize')
    .mockResolvedValueOnce({ ...initial, operation: { kind: 'recovery', gameId: '1' } })
    .mockResolvedValueOnce({ ...initial, auth: { authenticated: false } });
  const listGames = vi.spyOn(api, 'listGames');
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.operation.kind).toBe('recovery'));
  act(() => emit({ kind: 'idle' }));
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(initialize).toHaveBeenCalledTimes(2);
  expect(listGames).not.toHaveBeenCalled();
  expect(result.current.auth.authenticated).toBe(false);
  expect(result.current.games).toEqual([]);
  expect(result.current.view).toBe('browse');
});

it.each(['initialize', 'listGames'] as const)(
  'leaves progress and reports a failed recovery %s read',
  async (method) => {
    const { api, initial, emit } = await fixture();
    vi.spyOn(api, 'initialize').mockResolvedValueOnce({
      ...initial,
      operation: { kind: 'recovery', gameId: '1' },
    });
    const { result } = renderHook(() => useWorkspace(api));
    await waitFor(() => expect(result.current.operation.kind).toBe('recovery'));
    vi.spyOn(api, method).mockRejectedValueOnce(new Error('Recovery read failed.'));
    act(() => emit({ kind: 'idle' }));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error?.message).toBe('Recovery read failed.');
    expect(result.current.view).toBe('browse');
    expect(result.current.operation.kind).toBe('idle');
  },
);

it('does not let an obsolete action unlock a replacement API startup or report its error', async () => {
  const { api } = await fixture();
  const { result, rerender } = renderHook(({ api }) => useWorkspace(api), {
    initialProps: { api },
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  const read = deferred<GamesData>();
  vi.spyOn(api, 'listGames').mockReturnValueOnce(read.promise);
  act(() => result.current.refreshLibrary());
  const next = await fixture();
  const startup = deferred<InitializeResult>();
  vi.spyOn(next.api, 'initialize').mockReturnValueOnce(startup.promise);
  const login = vi.spyOn(next.api, 'login');
  rerender({ api: next.api });
  await act(async () => {
    read.reject(new Error('Obsolete failure.'));
  });
  expect(result.current.busy).toBe(true);
  expect(result.current.error).toBeNull();
  act(() => result.current.login());
  expect(login).not.toHaveBeenCalled();
  await act(async () => {
    startup.resolve(next.initial);
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.error).toBeNull();
});
