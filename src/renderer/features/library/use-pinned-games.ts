import { useMemo, useSyncExternalStore } from 'react';

interface Pins {
  ids: ReadonlySet<string>;
  error: string | null;
}

function pinStore(key: string | null) {
  function read(): Pins {
    if (!key) return { ids: new Set(), error: null };
    try {
      const stored = window.localStorage.getItem(key);
      const ids: unknown = stored === null ? [] : JSON.parse(stored);
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.length === 0))
        throw new Error('Invalid pinned game IDs');
      return { ids: new Set(ids as string[]), error: null };
    } catch {
      return { ids: new Set(), error: 'Pinned games could not be loaded on this device.' };
    }
  }

  let snapshot = read();
  const listeners = new Set<() => void>();
  function publish(next: Pins): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function onStorage(event: StorageEvent): void {
    if (event.key === key || event.key === null) publish(read());
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1 && key) window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener('storage', onStorage);
      };
    },
    toggle(gameId: string): void {
      if (!key) return;
      const ids = new Set(snapshot.ids);
      if (ids.has(gameId)) ids.delete(gameId);
      else ids.add(gameId);
      let error: string | null = null;
      try {
        window.localStorage.setItem(key, JSON.stringify([...ids]));
      } catch {
        error = 'Pinned games could not be saved. Changes will be lost when you restart.';
      }
      publish({ ids, error });
    },
  };
}

export function usePinnedGames(userId: string | undefined, demo: boolean) {
  // Keep account preferences outside the CLI credential and queue stores.
  const key = userId
    ? `gog-achievements${demo ? '-demo' : ''}:pinned-games:v1:${encodeURIComponent(userId)}`
    : null;
  const store = useMemo(() => pinStore(key), [key]);
  const pins = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { pinnedIds: pins.ids, pinError: pins.error, togglePin: store.toggle };
}
