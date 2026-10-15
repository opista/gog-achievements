import { useEffect, useRef, useState } from 'react';
import type { ApplyResult, DesktopApi, PreviewResult, QueueGame } from '../../../shared/api';
import { isAccountMismatch } from '../account/account-errors';
import { unknownApplyResult } from './apply-model';

type ApplyApi = Pick<DesktopApi, 'preview' | 'apply'>;
interface ApplyDependencies {
  assertOwner(userId: string): void;
  run(label: string, target: 'preview' | 'apply', task: () => Promise<void>): Promise<void>;
  onView(view: 'applying' | 'results'): void;
  refreshAfterApply(gameId: string, isCurrent: () => boolean): Promise<void>;
}
interface ApplyState {
  preview: PreviewResult | null;
  previewGameId: string | null;
  result: ApplyResult | null;
  resultGame: QueueGame | null;
}
const EMPTY: ApplyState = {
  preview: null,
  previewGameId: null,
  result: null,
  resultGame: null,
};

export function useApply(
  api: ApplyApi,
  { assertOwner, run, onView, refreshAfterApply }: ApplyDependencies,
) {
  const [state, setState] = useState({ ...EMPTY, api });
  const currentPreview = useRef<{ api: ApplyApi; value: PreviewResult } | null>(null);
  const generation = useRef(0);
  const previewRevision = useRef(0);
  const pending = useRef<{ stamp: number } | null>(null);

  useEffect(
    () => () => {
      generation.current += 1;
      currentPreview.current = null;
    },
    [api],
  );

  function update(value: Partial<ApplyState>): void {
    setState((previous) => ({
      ...(previous.api === api ? previous : { ...EMPTY, api }),
      ...value,
    }));
  }

  function isCurrent(stamp: number): boolean {
    return stamp === generation.current;
  }

  function isPending(): boolean {
    return pending.current?.stamp === generation.current;
  }

  function invalidate(): void {
    previewRevision.current += 1;
    currentPreview.current = null;
    update({ preview: null, previewGameId: null });
  }

  function clear(): void {
    generation.current += 1;
    previewRevision.current += 1;
    currentPreview.current = null;
    update(EMPTY);
  }

  async function prepare(gameId: string): Promise<void> {
    if (isPending()) return;
    await run('Checking changes…', 'preview', async () => {
      if (isPending()) return;
      const task = { stamp: generation.current };
      pending.current = task;
      const revision = ++previewRevision.current;
      currentPreview.current = null;
      update({ preview: null, previewGameId: gameId });
      try {
        let value: PreviewResult;
        try {
          value = await api.preview({ gameId });
        } catch (failure) {
          if (!isCurrent(task.stamp) || revision !== previewRevision.current) return;
          throw failure;
        }
        if (!isCurrent(task.stamp) || revision !== previewRevision.current) return;
        assertOwner(value.report.user_id);
        currentPreview.current = { api, value };
        update({ preview: value });
      } finally {
        if (pending.current === task) pending.current = null;
        if (isCurrent(task.stamp) && revision === previewRevision.current)
          update({ previewGameId: null });
      }
    });
  }

  async function apply(): Promise<void> {
    const confirmation = currentPreview.current;
    if (!confirmation || confirmation.api !== api || isPending()) return;
    await run('Applying changes…', 'apply', async () => {
      if (currentPreview.current !== confirmation || isPending()) return;
      const task = { stamp: generation.current };
      pending.current = task;
      const { token, report } = confirmation.value;
      // Consume the reviewed token before the write can be sent a second time.
      currentPreview.current = null;
      previewRevision.current += 1;
      update({ preview: null, previewGameId: null, result: null, resultGame: report.game });
      onView('applying');
      try {
        let value: ApplyResult;
        try {
          value = await api.apply({ previewToken: token });
        } catch (failure) {
          if (!isCurrent(task.stamp)) return;
          if (isAccountMismatch(failure)) throw failure;
          value = unknownApplyResult(failure);
        }
        if (!isCurrent(task.stamp)) return;
        if (value.report) assertOwner(value.report.user_id);
        update({ result: value });
        onView('results');
        await refreshAfterApply(report.game.id, () => isCurrent(task.stamp));
      } finally {
        if (pending.current === task) pending.current = null;
      }
    });
  }

  const visible = state.api === api ? state : EMPTY;
  return {
    preview: visible.preview,
    previewGameId: visible.previewGameId,
    result: visible.result,
    resultGame: visible.resultGame,
    prepare,
    apply,
    invalidate,
    clear,
  };
}
