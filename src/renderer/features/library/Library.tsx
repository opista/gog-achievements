import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import type { Game } from '../../../shared/api';
import { PaneResize } from '../../components/PaneResize';
import { GameList } from './GameList';
import { filterGames, pinnedGamesFirst } from './library-model';
import { usePinnedGames } from './use-pinned-games';

interface Props {
  games: Game[];
  gameId?: string;
  signedIn: boolean;
  userId?: string;
  loaded: boolean;
  loading?: boolean;
  busy: boolean;
  demo: boolean;
  onSelect(game: Game): void;
  onRefresh(): void;
  width?: number;
  onResize(width: number): void;
}

export function Library({
  games,
  gameId,
  signedIn,
  userId,
  loaded,
  loading = false,
  busy,
  demo,
  onSelect,
  onRefresh,
  width,
  onResize,
}: Props) {
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const query = useDeferredValue(search.trim());
  const { pinnedIds, pinError, togglePin } = usePinnedGames(signedIn ? userId : undefined, demo);
  const filtered = useMemo(
    () => pinnedGamesFirst(filterGames(games, query), pinnedIds),
    [games, query, pinnedIds],
  );
  useLayoutEffect(() => {
    if (!list.current) return;
    list.current.scrollTop = 0;
    list.current.scrollLeft = 0;
  }, [query]);
  function clearSearch() {
    setSearch('');
    searchInput.current?.focus();
  }

  return (
    <aside className="library-pane" aria-label="Game library">
      <PaneResize pane="Library" width={width} min={216} max={320} onResize={onResize} />
      <div className="library-heading">
        <h2>Your Library</h2>
        <button
          className="icon-button"
          aria-label="Refresh library"
          disabled={!signedIn || busy || loading}
          onClick={onRefresh}
        >
          <RefreshCw size={18} className={loading ? 'spinner' : undefined} />
        </button>
      </div>
      <div className="search-field">
        <Search size={18} aria-hidden="true" />
        <input
          ref={searchInput}
          aria-label="Search your library"
          placeholder="Search your library…"
          value={search}
          disabled={!signedIn}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search ? (
          <button
            className="icon-button search-clear"
            aria-label="Clear library search"
            title="Clear search"
            onClick={clearSearch}
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
      {pinError ? (
        <p className="library-pin-error" role="status">
          {pinError}
        </p>
      ) : null}
      <div className="library-list" ref={list}>
        {!signedIn ? null : loading ? (
          <div className="library-skeleton">
            <p className="sr-only" role="status">
              Loading games…
            </p>
            <div aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="library-skeleton-row" key={index}>
                  <span className="skeleton-block library-skeleton-cover" />
                  <span className="skeleton-block library-skeleton-title" />
                </div>
              ))}
            </div>
          </div>
        ) : !loaded ? (
          <div className="library-placeholder" role="status">
            <p>{busy ? 'Loading games…' : 'Library could not be loaded.'}</p>
            {!busy ? <button onClick={onRefresh}>Retry library</button> : null}
          </div>
        ) : filtered.length > 0 ? (
          <GameList
            key={query}
            games={filtered}
            gameId={gameId}
            busy={busy}
            demo={demo}
            onSelect={onSelect}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            canPin={Boolean(userId)}
          />
        ) : (
          <div className="library-placeholder">
            <p>{query ? 'No games match your search.' : 'No GOG games found.'}</p>
            <button disabled={busy} onClick={query ? clearSearch : onRefresh}>
              {query ? 'Clear search' : 'Refresh library'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
