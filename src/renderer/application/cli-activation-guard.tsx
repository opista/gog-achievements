import { createContext, useContext, useLayoutEffect } from 'react';
import type { DesktopApi } from '../../shared/api';

type GuardApi = Pick<DesktopApi, 'setCliActivationBlocked'>;
const guards = new WeakMap<GuardApi, { holds: Set<symbol>; changes: Promise<void> }>();
export const CliActivationContext = createContext<GuardApi | null>(null);

/** A shared lease covers whole UI workflows, including gaps between IPC commands. */
export async function holdCliActivation(api: GuardApi): Promise<() => void> {
  let state = guards.get(api);
  if (!state) {
    state = { holds: new Set(), changes: Promise.resolve() };
    guards.set(api, state);
  }
  const guard = state;
  const token = Symbol();
  const send = () => {
    const blocked = guard.holds.size > 0;
    const pending = guard.changes.then(() => api.setCliActivationBlocked({ blocked }));
    guard.changes = pending.catch(() => {});
    return pending;
  };
  guard.holds.add(token);
  const release = () => {
    if (guard.holds.delete(token)) void send().catch(() => {});
  };
  try {
    await send();
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

export function useCliDialogGuard(): void {
  const api = useContext(CliActivationContext);
  useLayoutEffect(() => {
    if (!api) return;
    let closed = false;
    let release: (() => void) | undefined;
    void holdCliActivation(api)
      .then((done) => {
        if (closed) done();
        else release = done;
      })
      .catch(() => {});
    return () => {
      closed = true;
      release?.();
    };
  }, [api]);
}
