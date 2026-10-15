// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { OperationState } from '../../../src/shared/api';
import { useOperation } from '../../../src/renderer/application/use-operation';

afterEach(cleanup);
function source() {
  let listener!: (state: OperationState) => void;
  const unsubscribe = vi.fn();
  return {
    onOperation: vi.fn((next: typeof listener) => {
      listener = next;
      return unsubscribe;
    }),
    emit: (state: OperationState) => listener(state),
    unsubscribe,
  };
}
function setup() {
  const api = source();
  const dependencies = { canRecover: vi.fn(() => true), onRecovered: vi.fn() };
  const hook = renderHook(({ api, dependencies }) => useOperation(api, dependencies), {
    initialProps: { api, dependencies },
  });
  return { api, dependencies, ...hook };
}

it('uses the startup snapshot only when no newer operation event has arrived', () => {
  const { api, result } = setup();
  const checkpoint = result.current.checkpoint();
  act(() => {
    result.current.restore({ kind: 'recovery', gameId: '1' }, checkpoint);
  });
  expect(result.current.operation.kind).toBe('recovery');
  act(() => api.emit({ kind: 'apply', gameId: '2' }));
  act(() => {
    result.current.restore({ kind: 'idle' }, checkpoint);
  });
  expect(result.current.operation).toEqual({ kind: 'apply', gameId: '2' });
  expect(result.current.current()).toEqual(result.current.operation);
});

it('defers one recovery read until the shared action and backend operation are idle', () => {
  const { api, dependencies, result } = setup();
  dependencies.canRecover.mockReturnValue(false);
  act(() => {
    api.emit({ kind: 'recovery', gameId: '2' });
    api.emit({ kind: 'idle' });
    api.emit({ kind: 'idle' });
  });
  expect(result.current.needsRecovery()).toBe(true);
  expect(dependencies.onRecovered).not.toHaveBeenCalled();
  dependencies.canRecover.mockReturnValue(true);
  act(() => {
    api.emit({ kind: 'read' });
    result.current.flushRecovery();
  });
  expect(dependencies.onRecovered).not.toHaveBeenCalled();
  act(() => {
    api.emit({ kind: 'idle' });
    result.current.flushRecovery();
  });
  expect(dependencies.onRecovered).toHaveBeenCalledExactlyOnceWith('2');
  expect(result.current.needsRecovery()).toBe(false);
});

it('rechecks a recovery that ended before its startup snapshot arrived', () => {
  const { api, dependencies, result } = setup();
  const checkpoint = result.current.checkpoint();
  act(() => api.emit({ kind: 'idle' }));
  act(() => {
    result.current.restore({ kind: 'recovery', gameId: '1' }, checkpoint);
  });
  expect(result.current.operation.kind).toBe('idle');
  expect(result.current.needsRecovery()).toBe(true);
  act(() => result.current.flushRecovery());
  expect(dependencies.onRecovered).toHaveBeenCalledExactlyOnceWith('1');
});

it.each(['login', 'read', 'apply'] as const)(
  'does not schedule recovery after %s completes',
  (kind) => {
    const { api, dependencies } = setup();
    act(() => {
      api.emit({ kind });
      api.emit({ kind: 'idle' });
    });
    expect(dependencies.onRecovered).not.toHaveBeenCalled();
  },
);

it('uses the latest recovery callback and discards pending work and events from a replaced API', () => {
  const { api, dependencies, result, rerender, unmount } = setup();
  dependencies.canRecover.mockReturnValue(false);
  act(() => {
    api.emit({ kind: 'recovery' });
    api.emit({ kind: 'idle' });
  });
  const nextDependencies = { canRecover: vi.fn(() => true), onRecovered: vi.fn() };
  rerender({ api, dependencies: nextDependencies });
  act(() => result.current.flushRecovery());
  expect(nextDependencies.onRecovered).toHaveBeenCalledTimes(1);
  expect(dependencies.onRecovered).not.toHaveBeenCalled();
  nextDependencies.canRecover.mockReturnValue(false);
  act(() => {
    api.emit({ kind: 'recovery' });
    api.emit({ kind: 'idle' });
  });
  const nextApi = source();
  rerender({ api: nextApi, dependencies: nextDependencies });
  expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  nextDependencies.canRecover.mockReturnValue(true);
  act(() => {
    api.emit({ kind: 'recovery' });
    result.current.flushRecovery();
  });
  expect(result.current.operation.kind).toBe('idle');
  expect(result.current.needsRecovery()).toBe(false);
  expect(nextDependencies.onRecovered).toHaveBeenCalledTimes(1);
  unmount();
  expect(nextApi.unsubscribe).toHaveBeenCalledTimes(1);
  nextApi.emit({ kind: 'recovery' });
  nextApi.emit({ kind: 'idle' });
  expect(nextDependencies.onRecovered).toHaveBeenCalledTimes(1);
});

it('keeps one active subscription under StrictMode effect replay', () => {
  const api = source();
  const dependencies = { canRecover: () => true, onRecovered: vi.fn() };
  const { unmount } = renderHook(() => useOperation(api, dependencies), { wrapper: StrictMode });
  expect(api.onOperation).toHaveBeenCalledTimes(2);
  expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  act(() => {
    api.emit({ kind: 'recovery', gameId: '1' });
    api.emit({ kind: 'idle' });
  });
  expect(dependencies.onRecovered).toHaveBeenCalledExactlyOnceWith('1');
  unmount();
  expect(api.unsubscribe).toHaveBeenCalledTimes(2);
});
