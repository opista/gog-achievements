import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, OperationRecord } from '../../../shared/api';
import { toNotice, type Notice } from '../../presentation/error-notice';
import { isAccountMismatch } from '../account/account-errors';

type HistoryApi = Pick<DesktopApi, 'history'>;
interface HistoryState {
  records: OperationRecord[];
  loaded: boolean;
  loading: boolean;
  error: Notice | null;
}
const EMPTY: HistoryState = { records: [], loaded: false, loading: false, error: null };

export function requiresHistorySessionRecovery(failure: unknown): boolean {
  return (
    isAccountMismatch(failure) || /AUTH|LOGIN|TOKEN|CREDENTIAL/.test(toNotice(failure).code ?? '')
  );
}

export function useHistory(api: HistoryApi, assertOwner: (userId: string) => void) {
  const [state, setState] = useState({ ...EMPTY, api });
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [api],
  );

  function update(values: Partial<HistoryState>): void {
    setState((previous) => ({ ...(previous.api === api ? previous : EMPTY), api, ...values }));
  }

  async function load(): Promise<void> {
    const stamp = ++generation.current;
    update({ loading: true, error: null });
    let values: OperationRecord[];
    try {
      values = await api.history({});
    } catch (failure) {
      if (stamp !== generation.current) return;
      update({
        loading: false,
        error: requiresHistorySessionRecovery(failure) ? null : toNotice(failure),
      });
      throw failure;
    }
    if (stamp !== generation.current) return;
    try {
      for (const value of values) assertOwner(value.user_id);
    } catch (failure) {
      // Owner validation can clear this feature before it throws. The workspace
      // still needs that failure to refresh the session and clear all account data.
      if (stamp === generation.current)
        update({
          loading: false,
          error: requiresHistorySessionRecovery(failure) ? null : toNotice(failure),
        });
      throw failure;
    }
    if (stamp === generation.current)
      update({ records: values, loaded: true, loading: false, error: null });
  }

  function clear(): void {
    generation.current += 1;
    update(EMPTY);
  }

  const { records, loaded, loading, error } = state.api === api ? state : EMPTY;
  return { records, loaded, loading, error, load, clear };
}
