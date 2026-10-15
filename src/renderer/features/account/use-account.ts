import { useEffect, useRef, useState } from 'react';
import type { AuthStatus, DesktopApi, InitializeResult } from '../../../shared/api';
import { AccountChangedError, isAccountMismatch } from './account-errors';

type AccountApi = Pick<DesktopApi, 'initialize' | 'login' | 'logout'>;

export function useAccount(api: AccountApi, clearAccountData: () => void) {
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false });
  const [versions, setVersions] = useState({ app: '', cli: '' });
  const current = useRef<AuthStatus>({ authenticated: false });
  const initialization = useRef<{ api: AccountApi; promise: Promise<InitializeResult> } | null>(
    null,
  );
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [api],
  );

  function accept(status: AuthStatus): void {
    if (status.user_id !== current.current.user_id || !status.authenticated) clearAccountData();
    current.current = status;
    setAuth(status);
  }

  function invalidate(): void {
    generation.current += 1;
    initialization.current = null;
    clearAccountData();
    current.current = { authenticated: false };
    setAuth(current.current);
  }

  function assertOwner(userId: string): void {
    if (!current.current.authenticated || userId !== current.current.user_id) {
      invalidate();
      throw new AccountChangedError();
    }
  }

  async function bootstrap(): Promise<InitializeResult | null> {
    const stamp = generation.current;
    if (initialization.current?.api !== api)
      initialization.current = { api, promise: api.initialize() };
    const initial = await initialization.current.promise;
    if (stamp !== generation.current) return null;
    accept(initial.auth);
    setVersions({ app: initial.version, cli: initial.cliVersion });
    return initial;
  }

  async function refresh(): Promise<InitializeResult | null> {
    const stamp = ++generation.current;
    initialization.current = { api, promise: api.initialize() };
    const initial = await initialization.current.promise;
    if (stamp !== generation.current) return null;
    accept(initial.auth);
    return initial;
  }

  async function changeAuth(task: () => Promise<AuthStatus>): Promise<AuthStatus | null> {
    const stamp = ++generation.current;
    initialization.current = null;
    const status = await task();
    if (stamp !== generation.current) return null;
    accept(status);
    return status;
  }

  async function reconcileOwner(userId: string): Promise<boolean> {
    if (userId !== current.current.user_id) {
      invalidate();
      if (!(await refresh())) return false;
    }
    assertOwner(userId);
    return true;
  }

  async function recover(failure: unknown): Promise<void> {
    if (!isAccountMismatch(failure)) return;
    invalidate();
    try {
      await refresh();
    } catch {
      // Keep account data cleared when the session cannot be checked.
    }
  }

  return {
    auth,
    versions,
    bootstrap,
    refresh,
    reconcileOwner,
    recover,
    assertOwner,
    login: () => changeAuth(() => api.login()),
    logout: () => changeAuth(() => api.logout()),
    current: () => ({ ...current.current }),
  };
}
