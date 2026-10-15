import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, Queue } from '../../../shared/api';
import { isAccountMismatch } from '../account/account-errors';
import { optimisticAddition, type QueueAction, type QueueAddition } from './queue-model';

type QueueApi = Pick<
  DesktopApi,
  'listQueues' | 'getQueue' | 'addAchievements' | 'removeAchievements' | 'setDates'
>;

export function useQueues(api: QueueApi, assertOwner: (userId: string) => void) {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [action, setAction] = useState<QueueAction | null>(null);
  const current = useRef<Queue[]>([]);
  const generation = useRef(0);
  const readRevision = useRef(0);
  const saving = useRef<number | null>(null);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [api],
  );

  function publish(values: Queue[]): void {
    current.current = values;
    setQueues(values);
  }

  function replace(gameId: string, value: Queue | null): void {
    if (value) assertOwner(value.user_id);
    readRevision.current += 1;
    publish([
      ...current.current.filter((queue) => queue.game.id !== gameId),
      ...(value ? [value] : []),
    ]);
  }

  function acceptAll(values: Queue[]): void {
    for (const value of values) assertOwner(value.user_id);
    readRevision.current += 1;
    publish(values);
    setLoaded(true);
  }

  function clear(): void {
    generation.current += 1;
    saving.current = null;
    publish([]);
    setLoaded(false);
    setAction(null);
  }

  function isCurrent(stamp: number): boolean {
    return stamp === generation.current;
  }

  function isReadCurrent(stamp: number, revision: number): boolean {
    return isCurrent(stamp) && revision === readRevision.current && saving.current !== stamp;
  }

  async function load(): Promise<Queue[]> {
    const stamp = generation.current;
    const revision = ++readRevision.current;
    let values: Queue[];
    try {
      values = await api.listQueues();
    } catch (failure) {
      if (!isReadCurrent(stamp, revision)) return [];
      throw failure;
    }
    if (!isReadCurrent(stamp, revision)) return [];
    acceptAll(values);
    return values;
  }

  async function sync(gameId: string, selectionIsCurrent = () => true): Promise<void> {
    const stamp = generation.current;
    const revision = ++readRevision.current;
    let value: Queue | null;
    try {
      value = await api.getQueue(gameId);
    } catch (failure) {
      if (!isReadCurrent(stamp, revision) || !selectionIsCurrent()) return;
      throw failure;
    }
    if (isReadCurrent(stamp, revision) && selectionIsCurrent()) replace(gameId, value);
  }

  function forGame(gameId?: string): Queue | null {
    return current.current.find((queue) => queue.game.id === gameId) ?? null;
  }

  async function restore(stamp: number, gameId: string, previous: Queue | null, rollback: boolean) {
    let values: Queue[];
    try {
      values = await api.listQueues();
    } catch (failure) {
      if (!isCurrent(stamp)) return;
      if (isAccountMismatch(failure)) throw failure;
      // Remove provisional rows when both save and reload fail.
      if (rollback) replace(gameId, previous);
      return;
    }
    if (isCurrent(stamp)) acceptAll(values);
  }

  async function mutate(
    kind: QueueAction['kind'],
    gameId: string,
    task: () => Promise<Queue>,
    optimistic?: Queue,
  ): Promise<boolean> {
    const stamp = generation.current;
    if (saving.current === stamp) return false;
    saving.current = stamp;
    readRevision.current += 1;
    const previous = forGame(gameId);
    setAction({ kind, gameId });
    try {
      if (optimistic) replace(gameId, optimistic);
      let value: Queue;
      try {
        value = await task();
      } catch (failure) {
        if (!isCurrent(stamp)) return false;
        if (!isAccountMismatch(failure))
          await restore(stamp, gameId, previous, Boolean(optimistic));
        if (!isCurrent(stamp)) return false;
        throw failure;
      }
      if (!isCurrent(stamp)) return false;
      replace(gameId, value);
      return true;
    } finally {
      if (isCurrent(stamp)) {
        saving.current = null;
        setAction(null);
      }
    }
  }

  function add(input: QueueAddition): Promise<boolean> {
    const { gameId, achievementIds, action } = input;
    const optimistic = optimisticAddition(forGame(gameId), input, new Date().toISOString());
    return mutate(
      'add',
      gameId,
      () => api.addAchievements({ gameId, achievementIds, ...(action ? { action } : {}) }),
      optimistic,
    );
  }

  return {
    queues,
    loaded,
    action,
    load,
    sync,
    clear,
    forGame,
    add,
    remove: (gameId: string, achievementIds: string[]) =>
      mutate('remove', gameId, () => api.removeAchievements({ gameId, achievementIds })),
    saveDates: (gameId: string, dates: Record<string, string>) =>
      mutate('date', gameId, () => api.setDates({ gameId, dates })),
  };
}
