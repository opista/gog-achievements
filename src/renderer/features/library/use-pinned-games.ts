import { useMemo, useSyncExternalStore } from 'react';

const PREFIX = 'gog-achievements.library-pins:v1:';
const SAVE_ERROR = 'Game pins could not be saved. Try again.';

interface Pins {
  ids: ReadonlySet<string>;
  error: string | null;
}

// Preferences contain only string game IDs. Each account has its own key, outside
// the credential, queue and achievement stores. Refreshes never prune saved IDs.
function pinPreferences(userId: string | undefined) {
  const key = userId ? PREFIX + encodeURIComponent(userId) : null;
  const listeners = new Set<() => void>();

  function read(): Pins {
    try {
      const raw = key ? window.localStorage.getItem(key) : null;
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (
          typeof value === 'object' &&
          value !== null &&
          'version' in value &&
          value.version === 1 &&
          'gameIds' in value &&
          Array.isArray(value.gameIds) &&
          value.gameIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
        )
          return { ids: new Set<string>(value.gameIds), error: null };
      }
      return { ids: new Set<string>(), error: null };
    } catch {
      return { ids: new Set<string>(), error: 'Saved game pins could not be read.' };
    }
  }

  let snapshot = read();
  function publish(next: Pins): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function onStorage(event: StorageEvent): void {
    if (event.storageArea === window.localStorage && (event.key === key || event.key === null))
      publish(read());
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) window.removeEventListener('storage', onStorage);
      };
    },
    toggle(gameId: string) {
      if (!key || !gameId) return;
      const ids = new Set(snapshot.ids);
      if (ids.has(gameId)) ids.delete(gameId);
      else ids.add(gameId);
      try {
        window.localStorage.setItem(key, JSON.stringify({ version: 1, gameIds: [...ids] }));
        publish({ ids, error: null });
      } catch {
        // Keep the last saved state so a failed write is never shown as durable.
        publish({ ...snapshot, error: SAVE_ERROR });
      }
    },
  };
}

export function usePinnedGames(userId: string | undefined) {
  const preferences = useMemo(() => pinPreferences(userId), [userId]);
  const pins = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot);
  return { ...pins, toggle: preferences.toggle };
}
