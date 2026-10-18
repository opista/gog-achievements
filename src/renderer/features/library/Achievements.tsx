import { useRef, useState } from 'react';
import { CalendarDays, Check, Download, Eye, RefreshCw, Search, X } from 'lucide-react';
import type { Achievement, AchievementAction, ExportInput } from '../../../shared/api';
import { Art } from '../../components/Art';
import { achievementActionName, AchievementActionIcon } from '../../components/AchievementAction';
import { formatDate, formatTimestamp } from '../../date-time';
import { AchievementSkeleton } from './AchievementSkeleton';

import {
  ACHIEVEMENT_FILTERS,
  ACHIEVEMENT_SORTS,
  isAchievementConcealed,
  visibleAchievements,
  type AchievementFilter,
  type AchievementSort,
} from './achievement-model';
interface Props {
  achievements: Achievement[];
  queued: ReadonlyMap<string, AchievementAction>;
  busy: boolean;
  loading?: boolean;
  demo: boolean;
  zone: string;
  supportsLocking?: boolean;
  supportsExporting?: boolean;
  onExport?(filters: Omit<ExportInput, 'gameId'>): void;
  onAdd(ids: string[], action?: AchievementAction): void;
  onQueueAll(ids: string[], action: AchievementAction): void;
  onRemove(ids: string[]): void;
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
  supportsExporting = false,
  onExport,
  onAdd,
  onQueueAll,
  onRemove,
  onRefresh,
}: Props) {
  const controlsBlocked = busy || loading;
  const [filter, setFilter] = useState<AchievementFilter>('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AchievementSort>('Locked first');
  const [revealed, setRevealed] = useState(new Set<string>());
  const searchInput = useRef<HTMLInputElement>(null);
  const focusTarget = useRef<string | null>(null);
  const filtered = visibleAchievements(achievements, filter, { search, sort, revealed, queued });
  const available = filtered.filter((item) => !isAchievementConcealed(item, revealed));
  const unlockIds = available
    .filter((item) => !item.unlocked && queued.get(item.id) !== 'unlock')
    .map((item) => item.id);
  const lockIds = available
    .filter((item) => item.unlocked && item.unlocked_at !== null && queued.get(item.id) !== 'lock')
    .map((item) => item.id);
  const queuedActions = new Set(queued.values());
  function reveal(id: string) {
    focusTarget.current = id;
    setRevealed((previous) => new Set(previous).add(id));
  }

  return (
    <section className="achievement-section">
      <div className="achievement-search-controls">
        <div className="search-field">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            aria-label="Search achievements"
            placeholder="Search achievements…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              className="icon-button search-clear"
              aria-label="Clear achievement search"
              onClick={() => {
                setSearch('');
                searchInput.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <label className="achievement-sort">
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as AchievementSort)}>
            {ACHIEVEMENT_SORTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        <div className="achievement-bulk-actions" role="group" aria-label="Queue achievements">
          {filter !== 'Unlocked' ? (
            <button
              className="achievement-action-button achievement-action-unlock"
              title="Queue all matching revealed locked achievements and remove lock requests for this game"
              disabled={controlsBlocked || (unlockIds.length === 0 && !queuedActions.has('lock'))}
              onClick={() => onQueueAll(unlockIds, 'unlock')}
            >
              <AchievementActionIcon action="unlock" />
              Unlock all
            </button>
          ) : null}
          {supportsLocking && filter !== 'Locked' ? (
            <button
              className="achievement-action-button achievement-action-lock"
              title="Queue all matching unlocked achievements and remove unlock requests for this game"
              disabled={controlsBlocked || (lockIds.length === 0 && !queuedActions.has('unlock'))}
              onClick={() => onQueueAll(lockIds, 'lock')}
            >
              <AchievementActionIcon action="lock" />
              Lock all
            </button>
          ) : null}
        </div>
        <button
          className="achievement-action-button"
          disabled={controlsBlocked || (!demo && !supportsExporting)}
          title={
            demo
              ? 'CSV export is available in the desktop app.'
              : supportsExporting
                ? 'Export the current filters. Includes hidden achievement details.'
                : 'CSV export needs an app with a newer bundled CLI.'
          }
          onClick={() =>
            onExport?.({ search, status: filter.toLowerCase() as ExportInput['status'] })
          }
        >
          <Download size={16} aria-hidden="true" />
          Export CSV
        </button>
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
        <span>Action</span>
      </div>
      <div className="achievement-list">
        {loading ? (
          <AchievementSkeleton />
        ) : (
          filtered.map((item) => {
            const concealed = isAchievementConcealed(item, revealed);
            const name = concealed ? 'Hidden achievement' : item.name;
            const queuedAction = queued.get(item.id);
            const isQueued = queuedAction !== undefined;
            const action = item.unlocked ? 'lock' : 'unlock';
            const actionName = achievementActionName(queuedAction ?? action);
            const buttonLabel = isQueued
              ? `Undo queued ${actionName.toLowerCase()} for ${name}`
              : `Queue ${actionName.toLowerCase()} for ${name}`;
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
                    <div className="achievement-title">
                      {!concealed ? (
                        <span
                          className={`achievement-state-icon achievement-action-${item.unlocked ? 'unlock' : 'lock'}`}
                          role="img"
                          aria-label={item.unlocked ? 'Unlocked' : 'Locked'}
                          title={item.unlocked ? 'Unlocked' : 'Locked'}
                        >
                          <AchievementActionIcon
                            action={item.unlocked ? 'unlock' : 'lock'}
                            size={14}
                          />
                        </span>
                      ) : null}
                      <h3
                        className="achievement-name"
                        tabIndex={-1}
                        ref={(element) => {
                          if (
                            element &&
                            focusTarget.current === item.id &&
                            !concealed &&
                            !isQueued &&
                            item.unlocked &&
                            !supportsLocking
                          ) {
                            element.focus();
                            focusTarget.current = null;
                          }
                        }}
                      >
                        {name}
                      </h3>
                    </div>
                    {!concealed ? (
                      <p className="achievement-description">
                        {item.description || 'No description available.'}
                      </p>
                    ) : null}
                    {!concealed && item.unlocked && item.unlocked_at ? (
                      <p
                        className="achievement-unlock-date"
                        title={`Unlocked: ${formatTimestamp(item.unlocked_at, zone)}. This date is read-only.`}
                      >
                        <CalendarDays size={12} aria-hidden="true" />
                        <span className="sr-only">Unlocked on </span>
                        <time dateTime={item.unlocked_at}>
                          {formatDate(item.unlocked_at, zone)}
                        </time>
                      </p>
                    ) : null}
                  </div>
                  <div className="achievement-status">
                    {!concealed && (isQueued || !item.unlocked || supportsLocking) ? (
                      <button
                        className={`achievement-action-button achievement-action-${isQueued ? 'queued' : action}`}
                        aria-label={buttonLabel}
                        title={buttonLabel}
                        disabled={controlsBlocked}
                        onClick={(event) => {
                          if (event.detail === 0) focusTarget.current = item.id;
                          if (isQueued) onRemove([item.id]);
                          else if (item.unlocked) onAdd([item.id], 'lock');
                          else onAdd([item.id]);
                        }}
                        ref={(element) => {
                          if (element && focusTarget.current === item.id && !element.disabled) {
                            element.focus();
                            focusTarget.current = null;
                          }
                        }}
                      >
                        {isQueued ? (
                          <Check size={16} aria-hidden="true" />
                        ) : (
                          <AchievementActionIcon action={action} />
                        )}
                        <span>{isQueued ? 'Queued' : actionName}</span>
                      </button>
                    ) : null}
                    {concealed ? (
                      <button disabled={controlsBlocked} onClick={() => reveal(item.id)}>
                        <Eye size={16} />
                        Reveal
                      </button>
                    ) : null}
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
                : 'No achievements match your search and filters.'}
            </p>
            {filter !== 'All' || search ? (
              <button
                onClick={() => {
                  setFilter('All');
                  setSearch('');
                  searchInput.current?.focus();
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
