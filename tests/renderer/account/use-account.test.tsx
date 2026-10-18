// @vitest-environment jsdom
import { StrictMode, useEffect, useEffectEvent } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { AuthStatus, DesktopApi, InitializeResult } from '../../../src/shared/api';
import { useAccount } from '../../../src/renderer/features/account/use-account';

afterEach(cleanup);

const USER = '123456789';
const OTHER_USER = '987654321';
const signedIn = (userId = USER): AuthStatus => ({ authenticated: true, user_id: userId });
const initial = (userId = USER): InitializeResult => ({
  version: '0.1.0',
  cliVersion: '0.3.0',
  auth: signedIn(userId),
  operation: { kind: 'idle' },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function dependencies() {
  return {
    api: {
      initialize: vi.fn<DesktopApi['initialize']>().mockResolvedValue(initial()),
      login: vi.fn<DesktopApi['login']>().mockResolvedValue(signedIn()),
      logout: vi.fn<DesktopApi['logout']>().mockResolvedValue({ authenticated: false }),
    },
    clearAccountData: vi.fn(),
  };
}

function account() {
  const { api, clearAccountData } = dependencies();
  const hook = renderHook(({ api }) => useAccount(api, clearAccountData), {
    initialProps: { api },
  });
  return { ...hook, api, clearAccountData };
}

it('accepts new CLI features without clearing account data or accepting stale initialization flags', async () => {
  const { api, result, clearAccountData } = account();
  const pending = deferred<InitializeResult>();
  api.initialize.mockReturnValueOnce(pending.promise);
  let starting!: Promise<InitializeResult | null>;
  act(() => {
    starting = result.current.bootstrap();
  });
  act(() =>
    result.current.acceptCli({ version: '0.6.0', supportsLocking: true, supportsExporting: true }),
  );
  await act(async () => {
    pending.resolve(initial());
    await starting;
  });
  expect(result.current.versions).toEqual({ app: '0.1.0', cli: '0.6.0' });
  expect(result.current.supportsExporting).toBe(true);
  expect(result.current.auth).toEqual(signedIn());
  clearAccountData.mockClear();
  act(() =>
    result.current.acceptCli({ version: '0.7.0', supportsLocking: true, supportsExporting: true }),
  );
  expect(clearAccountData).not.toHaveBeenCalled();
  expect(result.current.versions.cli).toBe('0.7.0');
});

it('checks one saved session across StrictMode effect replay and exposes app versions', async () => {
  const { api, clearAccountData } = dependencies();
  const { result } = renderHook(
    () => {
      const value = useAccount(api, clearAccountData);
      const bootstrap = useEffectEvent(() => value.bootstrap());
      useEffect(() => {
        void bootstrap();
      }, []);
      return value;
    },
    { wrapper: StrictMode },
  );
  await waitFor(() => expect(result.current.auth).toEqual(signedIn()));
  expect(result.current.versions).toEqual({ app: '0.1.0', cli: '0.3.0' });
  expect(api.initialize).toHaveBeenCalledTimes(1);
  expect(clearAccountData).toHaveBeenCalledTimes(1);
});

it('keeps matching account data and clears it for a changed account or sign-out', async () => {
  const { api, result, clearAccountData } = account();
  await act(() => result.current.bootstrap());
  clearAccountData.mockClear();
  await act(() => result.current.refresh());
  expect(clearAccountData).not.toHaveBeenCalled();
  api.login.mockResolvedValueOnce(signedIn(OTHER_USER));
  await act(() => result.current.login());
  expect(result.current.current()).toEqual(signedIn(OTHER_USER));
  expect(result.current.auth).toEqual(signedIn(OTHER_USER));
  expect(clearAccountData).toHaveBeenCalledTimes(1);
  await act(() => result.current.logout());
  expect(result.current.auth).toEqual({ authenticated: false });
  expect(clearAccountData).toHaveBeenCalledTimes(2);
});

it.each([USER, OTHER_USER])(
  'rejects reads without a matching signed-in owner: %s',
  async (owner) => {
    const { result, clearAccountData } = account();
    if (owner === OTHER_USER) await act(() => result.current.bootstrap());
    clearAccountData.mockClear();
    act(() => {
      expect(() => result.current.assertOwner(owner)).toThrow('The GOG account changed.');
    });
    expect(result.current.auth).toEqual({ authenticated: false });
    expect(result.current.current()).toEqual({ authenticated: false });
    expect(clearAccountData).toHaveBeenCalledTimes(1);
  },
);

it('allows reads for the current authenticated owner without refreshing the session', async () => {
  const { result, api, clearAccountData } = account();
  await act(() => result.current.bootstrap());
  clearAccountData.mockClear();
  expect(() => result.current.assertOwner(USER)).not.toThrow();
  expect(api.initialize).toHaveBeenCalledTimes(1);
  expect(clearAccountData).not.toHaveBeenCalled();
});

it('clears old data before rechecking a different library owner', async () => {
  const { result, api, clearAccountData } = account();
  await act(() => result.current.bootstrap());
  clearAccountData.mockClear();
  const pending = deferred<InitializeResult>();
  api.initialize.mockReturnValueOnce(pending.promise);
  let checking!: Promise<boolean>;
  act(() => {
    checking = result.current.reconcileOwner(OTHER_USER);
  });
  expect(result.current.auth).toEqual({ authenticated: false });
  expect(clearAccountData).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(initial(OTHER_USER));
    expect(await checking).toBe(true);
  });
  expect(result.current.auth).toEqual(signedIn(OTHER_USER));
});

it('rejects a library owner when the fresh session still belongs to another account', async () => {
  const { result } = account();
  await act(() => result.current.bootstrap());
  await act(async () => {
    await expect(result.current.reconcileOwner(OTHER_USER)).rejects.toMatchObject({
      code: 'ACCOUNT_CHANGED',
    });
  });
  expect(result.current.auth).toEqual({ authenticated: false });
});

it.each(['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'])(
  'recovers %s through a fresh session check while keeping failed checks signed out',
  async (code) => {
    const { result, api, clearAccountData } = account();
    await act(() => result.current.bootstrap());
    clearAccountData.mockClear();
    api.initialize.mockRejectedValueOnce(new Error('Session unavailable'));
    await act(() => result.current.recover(Object.assign(new Error('Account changed'), { code })));
    expect(result.current.auth).toEqual({ authenticated: false });
    expect(clearAccountData).toHaveBeenCalledTimes(1);
    expect(api.initialize).toHaveBeenCalledTimes(2);
  },
);

it('keeps the session for unrelated read errors', async () => {
  const { result, api, clearAccountData } = account();
  await act(() => result.current.bootstrap());
  clearAccountData.mockClear();
  await act(() => result.current.recover(new Error('Network read failed')));
  expect(result.current.auth).toEqual(signedIn());
  expect(api.initialize).toHaveBeenCalledTimes(1);
  expect(clearAccountData).not.toHaveBeenCalled();
});

it('does not restore a pending sign-in after a later sign-out', async () => {
  const { result, api } = account();
  const pending = deferred<AuthStatus>();
  api.login.mockReturnValueOnce(pending.promise);
  const login = result.current.login();
  await act(() => result.current.logout());
  await act(async () => {
    pending.resolve(signedIn());
    expect(await login).toBeNull();
  });
  expect(result.current.auth).toEqual({ authenticated: false });
});

it('does not reuse a cached signed-in bootstrap after sign-out', async () => {
  const { result, api } = account();
  await act(() => result.current.bootstrap());
  await act(() => result.current.logout());
  api.initialize.mockResolvedValueOnce({ ...initial(), auth: { authenticated: false } });
  await act(() => result.current.bootstrap());
  expect(result.current.auth).toEqual({ authenticated: false });
  expect(api.initialize).toHaveBeenCalledTimes(2);
});

it('reuses the refreshed session rather than an older bootstrap snapshot', async () => {
  const { result, api } = account();
  await act(() => result.current.bootstrap());
  api.initialize.mockResolvedValueOnce(initial(OTHER_USER));
  await act(() => result.current.refresh());
  await act(() => result.current.bootstrap());
  expect(result.current.auth).toEqual(signedIn(OTHER_USER));
  expect(api.initialize).toHaveBeenCalledTimes(2);
});

it('ignores an old bootstrap response after a fresh session check', async () => {
  const { result, api } = account();
  const pending = deferred<InitializeResult>();
  api.initialize.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(initial(OTHER_USER));
  const bootstrap = result.current.bootstrap();
  await act(() => result.current.refresh());
  await act(async () => {
    pending.resolve(initial());
    expect(await bootstrap).toBeNull();
  });
  expect(result.current.auth).toEqual(signedIn(OTHER_USER));
});

it.each(['API replacement', 'unmount'])('ignores pending auth after %s', async (change) => {
  const { result, api, clearAccountData, rerender, unmount } = account();
  const pending = deferred<AuthStatus>();
  api.login.mockReturnValueOnce(pending.promise);
  const login = result.current.login();
  if (change === 'unmount') unmount();
  else rerender({ api: { ...api } });
  await act(async () => {
    pending.resolve(signedIn());
    expect(await login).toBeNull();
  });
  expect(clearAccountData).not.toHaveBeenCalled();
});

it('uses the replacement API for bootstrap instead of the old cached session', async () => {
  const { result, api, rerender } = account();
  await act(() => result.current.bootstrap());
  const nextApi = {
    ...api,
    initialize: vi.fn<DesktopApi['initialize']>().mockResolvedValue(initial(OTHER_USER)),
  };
  rerender({ api: nextApi });
  await act(() => result.current.bootstrap());
  expect(result.current.auth).toEqual(signedIn(OTHER_USER));
  expect(api.initialize).toHaveBeenCalledTimes(1);
  expect(nextApi.initialize).toHaveBeenCalledTimes(1);
});

it('propagates sign-out errors without claiming the session was removed', async () => {
  const { result, api, clearAccountData } = account();
  await act(() => result.current.bootstrap());
  clearAccountData.mockClear();
  const failure = new Error('Credential store unavailable');
  api.logout.mockRejectedValueOnce(failure);
  await act(async () => {
    await expect(result.current.logout()).rejects.toBe(failure);
  });
  expect(result.current.auth).toEqual(signedIn());
  expect(clearAccountData).not.toHaveBeenCalled();
});
