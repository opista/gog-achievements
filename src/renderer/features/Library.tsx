import { useDeferredValue, useState } from 'react';
import { Gamepad2, RefreshCw, Search } from 'lucide-react';
import type { Game } from '../../shared/api';
import { Art } from '../components/Art';
import { PaneResize } from '../components/PaneResize';
export function Library({
  games,
  gameId,
  signedIn,
  loaded,
  busy,
  demo,
  onSelect,
  onRefresh,
  width,
  onResize,
}: {
  games: Game[];
  gameId?: string;
  signedIn: boolean;
  loaded: boolean;
  busy: boolean;
  demo: boolean;
  onSelect(game: Game): void;
  onRefresh(): void;
  width?: number;
  onResize(width: number): void;
}) {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const filtered = games.filter((game) => game.title.toLocaleLowerCase().includes(query));
  return (
    <aside className="library-pane" aria-label="Game library">
      <PaneResize pane="Library" width={width} min={216} max={320} onResize={onResize} />
      <div className="library-heading">
        <h2>Your Library</h2>
        <button
          className="icon-button"
          aria-label="Refresh library"
          disabled={!signedIn || busy}
          onClick={onRefresh}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <label className="search-field">
        <Search size={18} />
        <input
          aria-label="Search your library"
          placeholder="Search your library…"
          value={search}
          disabled={!signedIn}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="library-list">
        {!signedIn ? (
          <div className="library-placeholder">
            <Gamepad2 size={34} />
            <p>Sign in to load your games.</p>
          </div>
        ) : !loaded ? (
          <div className="library-placeholder" role="status">
            <p>{busy ? 'Loading games…' : 'Library could not be loaded.'}</p>
            {!busy ? <button onClick={onRefresh}>Retry library</button> : null}
          </div>
        ) : filtered.length > 0 ? (
          filtered.map((game) => (
            <button
              key={game.id}
              className={`game-row ${game.id === gameId ? 'selected' : ''}`}
              disabled={busy}
              aria-pressed={game.id === gameId}
              onClick={() => onSelect(game)}
            >
              <Art image={game.image} name={game.title} demo={demo} />
              <span>{game.title}</span>
            </button>
          ))
        ) : (
          <div className="library-placeholder">
            <p>{query ? 'No games match your search.' : 'No GOG games found.'}</p>
            <button disabled={busy} onClick={query ? () => setSearch('') : onRefresh}>
              {query ? 'Clear search' : 'Refresh library'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
