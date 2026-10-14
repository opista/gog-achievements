import { useState } from 'react';
import { ChevronDown, Eye, Plus, RefreshCw } from 'lucide-react';
import type { Achievement } from '../../shared/api';
import { Art } from '../components/Art';
import { formatTimestamp } from '../date-time';
type Filter = 'All' | 'Unlocked' | 'Locked' | 'Queued';
export function Achievements({
  achievements,
  queued,
  busy,
  demo,
  zone,
  onAdd,
  onRefresh,
}: {
  achievements: Achievement[];
  queued: Set<string>;
  busy: boolean;
  demo: boolean;
  zone: string;
  onAdd(ids: string[]): void;
  onRefresh(): void;
}) {
  const [filter, setFilter] = useState<Filter>('All');
  const [selected, setSelected] = useState(new Set<string>());
  const [revealed, setRevealed] = useState(new Set<string>());
  const [details, setDetails] = useState(new Set<string>());
  const filtered = achievements.filter(
    (item) =>
      filter === 'All' ||
      (filter === 'Unlocked' && item.unlocked) ||
      (filter === 'Locked' && !item.unlocked) ||
      (filter === 'Queued' && queued.has(item.id)),
  );
  const additions = [...selected].filter(
    (id) => !queued.has(id) && !achievements.find((item) => item.id === id)?.unlocked,
  );
  function toggle(setter: typeof setSelected, id: string) {
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <section className="achievement-section">
      <div className="achievement-toolbar">
        <div className="filter-group" aria-label="Achievement filters">
          {(['All', 'Unlocked', 'Locked', 'Queued'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <button
          disabled={busy || additions.length === 0}
          onClick={() => {
            onAdd(additions);
            setSelected(new Set());
          }}
        >
          <Plus size={18} />
          Add selected
        </button>
        <button
          className="icon-button mobile-refresh"
          disabled={busy}
          aria-label="Refresh achievements"
          onClick={onRefresh}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="achievement-column-labels">
        <span>Achievement</span>
        <span>Status</span>
      </div>
      <div className="achievement-list">
        {filtered.map((item) => {
          const concealed = item.hidden && !item.unlocked && !revealed.has(item.id);
          const name = concealed ? 'Hidden achievement' : item.name;
          const isQueued = queued.has(item.id);
          return (
            <article
              className={`achievement-row ${item.unlocked ? 'read-only' : ''}`}
              key={item.id}
            >
              <div className="achievement-main">
                <input
                  type="checkbox"
                  aria-label={`Select ${name}`}
                  checked={isQueued || selected.has(item.id)}
                  disabled={busy || item.unlocked || isQueued || concealed}
                  onChange={() => toggle(setSelected, item.id)}
                />
                <Art
                  name={name}
                  kind="achievement"
                  image={concealed ? null : item.unlocked ? item.image_unlocked : item.image_locked}
                  demo={demo}
                />
                <button
                  className="achievement-name"
                  aria-label={`Details for ${name}`}
                  disabled={concealed}
                  aria-expanded={details.has(item.id)}
                  onClick={() => toggle(setDetails, item.id)}
                >
                  {name}
                  {!concealed ? <ChevronDown size={14} /> : null}
                </button>
                <div className="achievement-status">
                  {concealed ? (
                    <button disabled={busy} onClick={() => toggle(setRevealed, item.id)}>
                      <Eye size={16} />
                      Reveal
                    </button>
                  ) : item.unlocked ? (
                    <span className="status ready">
                      Unlocked{' '}
                      {item.unlocked_at
                        ? formatTimestamp(item.unlocked_at, zone, false)
                            .split(' ')
                            .slice(0, 3)
                            .join(' ')
                        : ''}
                    </span>
                  ) : (
                    <span className={`status ${isQueued ? 'queued' : 'neutral'}`}>
                      {isQueued ? 'Queued' : 'Locked'}
                    </span>
                  )}
                </div>
              </div>
              {details.has(item.id) && !concealed ? (
                <div className="achievement-details">
                  <p>{item.description || 'No description available.'}</p>
                  {item.unlocked ? (
                    <p className="muted">
                      Existing unlock: {formatTimestamp(item.unlocked_at, zone)}. This date is
                      read-only.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>
              {achievements.length === 0
                ? 'No achievements available for this game.'
                : 'No achievements match this filter.'}
            </p>
            {filter !== 'All' ? (
              <button onClick={() => setFilter('All')}>Clear filters</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
