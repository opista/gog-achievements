import { useRef, useState } from 'react';
import { Eye, LockKeyhole, Plus, RefreshCw } from 'lucide-react';
import type { Achievement, AchievementAction } from '../../../shared/api';
import { Art } from '../../components/Art';
import { formatDate, formatTimestamp } from '../../date-time';
import { AchievementSkeleton } from './AchievementSkeleton';

import {
  ACHIEVEMENT_FILTERS,
  visibleAchievements,
  type AchievementFilter,
} from './achievement-model';
interface Props {
  achievements: Achievement[];
  queued: Set<string>;
  busy: boolean;
  loading?: boolean;
  demo: boolean;
  zone: string;
  supportsLocking?: boolean;
  onAdd(ids: string[], action?: AchievementAction): void;
  onRefresh(): void;
}
export function Achievements({
  achievements,
  queued,
  busy,
  loading = false,
  demo,
  zone,
  supportsLocking = false,
  onAdd,
  onRefresh,
}: Props) {
  const controlsBlocked = busy || loading;
  const [filter, setFilter] = useState<AchievementFilter>('All');
  const [revealed, setRevealed] = useState(new Set<string>());
  const focusTarget = useRef<string | null>(null);
  const filtered = visibleAchievements(achievements, filter);
  function reveal(id: string) {
    focusTarget.current = id;
    setRevealed((previous) => new Set(previous).add(id));
  }

  return (
    <section className="achievement-section">
      <div className="achievement-toolbar">
        <div className="filter-group" aria-label="Achievement filters">
          {ACHIEVEMENT_FILTERS.map((value) => (
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
              <article className="achievement-row" key={item.id} aria-label={name}>
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
                        if (element && focusTarget.current === item.id && isQueued) {
                          element.focus();
                          focusTarget.current = null;
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
                    {!concealed && !isQueued && (!item.unlocked || supportsLocking) ? (
                      <button
                        className="icon-button achievement-add"
                        aria-label={
                          item.unlocked ? `Queue lock for ${name}` : `Add ${name} to queue`
                        }
                        title={
                          item.unlocked ? `Queue lock for ${name}` : `Queue unlock for ${name}`
                        }
                        disabled={controlsBlocked}
                        onClick={(event) => {
                          if (event.detail === 0) focusTarget.current = item.id;
                          if (item.unlocked) onAdd([item.id], 'lock');
                          else onAdd([item.id]);
                        }}
                        ref={(element) => {
                          if (element && focusTarget.current === item.id && !element.disabled) {
                            element.focus();
                            focusTarget.current = null;
                          }
                        }}
                      >
                        {item.unlocked ? <LockKeyhole size={19} /> : <Plus size={19} />}
                      </button>
                    ) : null}
                    {concealed ? (
                      <button disabled={controlsBlocked} onClick={() => reveal(item.id)}>
                        <Eye size={16} />
                        Reveal
                      </button>
                    ) : isQueued ? (
                      <span className="status queued">Queued</span>
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
