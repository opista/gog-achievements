import { useRef, useState } from 'react';
import { Eye, Plus, RefreshCw } from 'lucide-react';
import type { Achievement } from '../../shared/api';
import { Art } from '../components/Art';
import { formatDate, formatTimestamp } from '../date-time';
import { AchievementSkeleton } from './AchievementSkeleton';

type Filter = 'All' | 'Unlocked' | 'Locked';
interface Props {
  achievements: Achievement[];
  queued: Set<string>;
  busy: boolean;
  loading?: boolean;
  demo: boolean;
  zone: string;
  onAdd(ids: string[]): void;
  onRefresh(): void;
}
function group(item: Achievement): number {
  return item.unlocked ? 2 : item.hidden ? 1 : 0;
}
function unlockTime(item: Achievement): number {
  const time = item.unlocked_at ? Date.parse(item.unlocked_at) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}
function compareAchievements(left: Achievement, right: Achievement): number {
  const groupDifference = group(left) - group(right);
  if (groupDifference || !left.unlocked) return groupDifference;
  const leftTime = unlockTime(left);
  const rightTime = unlockTime(right);
  return leftTime === rightTime ? 0 : leftTime > rightTime ? -1 : 1;
}

export function Achievements({
  achievements,
  queued,
  busy,
  loading = false,
  demo,
  zone,
  onAdd,
  onRefresh,
}: Props) {
  const controlsBlocked = busy || loading;
  const [filter, setFilter] = useState<Filter>('All');
  const [revealed, setRevealed] = useState(new Set<string>());
  const revealTarget = useRef<string | null>(null);
  const filtered = achievements
    .toSorted(compareAchievements)
    .filter(
      (item) =>
        filter === 'All' ||
        (filter === 'Unlocked' && item.unlocked) ||
        (filter === 'Locked' && !item.unlocked),
    );
  function reveal(id: string) {
    revealTarget.current = id;
    setRevealed((previous) => new Set(previous).add(id));
  }

  return (
    <section className="achievement-section">
      <div className="achievement-toolbar">
        <div className="filter-group" aria-label="Achievement filters">
          {(['All', 'Unlocked', 'Locked'] as const).map((value) => (
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
          className="icon-button mobile-refresh"
          disabled={controlsBlocked}
          aria-label="Refresh achievements"
          onClick={onRefresh}
        >
          <RefreshCw size={18} className={loading ? 'spinner' : undefined} />
        </button>
      </div>
      <div className="achievement-column-labels">
        <span>Achievement</span>
        <span>Status</span>
      </div>
      <div className="achievement-list">
        {loading ? (
          <AchievementSkeleton />
        ) : (
          filtered.map((item) => {
            const concealed = item.hidden && !item.unlocked && !revealed.has(item.id);
            const name = concealed ? 'Hidden achievement' : item.name;
            const isQueued = queued.has(item.id);
            return (
              <article
                className={`achievement-row ${item.unlocked ? 'read-only' : ''}`}
                key={item.id}
                aria-label={name}
              >
                <div className="achievement-main">
                  <Art
                    name={name}
                    kind="achievement"
                    image={
                      concealed ? null : item.unlocked ? item.image_unlocked : item.image_locked
                    }
                    demo={demo}
                  />
                  <div className="achievement-copy">
                    <h3
                      className="achievement-name"
                      tabIndex={-1}
                      ref={(element) => {
                        if (element && revealTarget.current === item.id && isQueued) {
                          element.focus();
                          revealTarget.current = null;
                        }
                      }}
                    >
                      {name}
                    </h3>
                    {!concealed ? (
                      <p className="achievement-description">
                        {item.description || 'No description available.'}
                      </p>
                    ) : null}
                  </div>
                  <div className="achievement-status">
                    {!item.unlocked && !concealed && !isQueued ? (
                      <button
                        className="icon-button achievement-add"
                        aria-label={`Add ${name} to queue`}
                        title={`Add ${name} to queue`}
                        disabled={controlsBlocked}
                        onClick={() => onAdd([item.id])}
                        ref={(element) => {
                          if (element && revealTarget.current === item.id && !element.disabled) {
                            element.focus();
                            revealTarget.current = null;
                          }
                        }}
                      >
                        <Plus size={19} />
                      </button>
                    ) : null}
                    {concealed ? (
                      <button disabled={controlsBlocked} onClick={() => reveal(item.id)}>
                        <Eye size={16} />
                        Reveal
                      </button>
                    ) : item.unlocked ? (
                      <span
                        className="status ready"
                        title={`Existing unlock: ${formatTimestamp(item.unlocked_at, zone)}. This date is read-only.`}
                      >
                        Unlocked {item.unlocked_at ? formatDate(item.unlocked_at, zone) : ''}
                      </span>
                    ) : (
                      <span className={`status ${isQueued ? 'queued' : 'neutral'}`}>
                        {isQueued ? 'Queued' : 'Locked'}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
        {!loading && filtered.length === 0 ? (
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
