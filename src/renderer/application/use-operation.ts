import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { DesktopApi, OperationState, CliRuntimeInfo } from '../../shared/api';

type OperationApi = Pick<DesktopApi, 'onOperation'>;
interface OperationDependencies {
  canRecover(): boolean;
  onRecovered(gameId?: string): void;
  onCli?(info: CliRuntimeInfo): void;
}
const IDLE: OperationState = { kind: 'idle' };

export function useOperation(api: OperationApi, dependencies: OperationDependencies) {
  const [observed, setObserved] = useState({ api, state: IDLE });
  const latest = useRef({ api, state: IDLE });
  const revision = useRef(0);
  const recovery = useRef<{ api: OperationApi; gameId?: string } | null>(null);
  const callbacks = useRef(dependencies);
  callbacks.current = dependencies;

  function current(): OperationState {
    return latest.current.api === api ? latest.current.state : IDLE;
  }

  function publish(state: OperationState): void {
    latest.current = { api, state };
    setObserved({ api, state });
  }

  function needsRecovery(): boolean {
    return recovery.current?.api === api;
  }

  function flushRecovery(): void {
    const request = recovery.current;
    if (
      !request ||
      request.api !== api ||
      current().kind !== 'idle' ||
      !callbacks.current.canRecover()
    )
      return;
    recovery.current = null;
    callbacks.current.onRecovered(request.gameId);
  }

  function restore(state: OperationState, checkpoint: number): OperationState {
    if (checkpoint === revision.current) publish(state);
    else if (state.kind === 'recovery' && current().kind === 'idle' && !needsRecovery())
      recovery.current = { api, gameId: state.gameId };
    return current();
  }

  const observe = useEffectEvent((state: OperationState) => {
    if (state.cli) callbacks.current.onCli?.(state.cli);
    const previous = current();
    revision.current += 1;
    publish(state);
    if (previous.kind === 'recovery' && state.kind === 'idle')
      recovery.current = { api, gameId: previous.gameId };
    flushRecovery();
  });

  useEffect(() => {
    let mounted = true;
    const unsubscribe = api.onOperation((state) => {
      if (mounted) observe(state);
    });
    return () => {
      mounted = false;
      revision.current += 1;
      if (recovery.current?.api === api) recovery.current = null;
      unsubscribe();
    };
  }, [api]);

  return {
    operation: observed.api === api ? observed.state : IDLE,
    current,
    checkpoint: () => revision.current,
    restore,
    needsRecovery,
    flushRecovery,
  };
}
