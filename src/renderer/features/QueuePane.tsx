import { CalendarDays, Check, Eye, FileText, Info, LoaderCircle, X } from 'lucide-react';
import type { Workspace } from '../use-workspace';
import { Art } from '../components/Art';
import { PaneResize } from '../components/PaneResize';
import { formatTimestamp, zoneLabel, TIME_ZONES } from '../date-time';
import { CloseGameNote } from './Review';
import { resultsNeedAttention } from './Results';
interface Props {
  workspace: Workspace;
  zone: string;
  demo: boolean;
  selected: Set<string>;
  onToggle(id: string): void;
  onDate(ids: string[]): void;
  onZone(value: string): void;
  onConfirm(): void;
  width?: number;
  onResize(width: number): void;
}
export function QueuePane({
  workspace: w,
  zone,
  demo,
  selected,
  onToggle,
  onDate,
  onZone,
  onConfirm,
  width,
  onResize,
}: Props) {
  const items = w.queue?.items ?? [];
  const pending = w.preview?.report.results.filter((item) => item.status === 'pending') ?? [];
  const resultView = w.view === 'results' && w.result;
  const activeApply =
    w.view === 'applying' || w.operation.kind === 'apply' || w.operation.kind === 'recovery';
  const review = w.view === 'preview';
  const readonly = review || activeApply || Boolean(resultView) || w.view === 'history';
  const lockedIds = new Set(w.achievements.filter((item) => !item.unlocked).map((item) => item.id));
  const selectedLocked = [...selected].filter(
    (id) => lockedIds.has(id) && items.some((item) => item.achievement_id === id),
  );
  return (
    <aside className="queue-pane" aria-label="Achievement queue">
      <PaneResize pane="Queue" width={width} min={336} max={504} onResize={onResize} />
      <div className="queue-header">
        <div>
          <h2>
            {activeApply
              ? 'Applying changes…'
              : resultView
                ? resultsNeedAttention(resultView)
                  ? 'Needs attention'
                  : 'Apply complete'
                : review
                  ? 'Reviewed queue'
                  : 'Queue'}
          </h2>
          {w.achievementsLoaded ? (
            <p className="muted">
              {review
                ? `${pending.length} achievements to restore`
                : `${items.length} ${resultView ? 'remaining' : 'achievements'}`}
            </p>
          ) : null}
        </div>
        {!readonly ? (
          <button
            disabled={w.busy || selectedLocked.length === 0}
            onClick={() => onDate(selectedLocked)}
          >
            <CalendarDays size={18} />
            Set date for selected
          </button>
        ) : null}
      </div>
      <div className="queue-body">
        {!w.auth.authenticated ? (
          <div className="empty-state">
            <FileText size={34} />
            <p>Choose achievements after sign-in.</p>
          </div>
        ) : !w.game ? (
          <div className="empty-state">
            <FileText size={34} />
            <p>Choose a game to load its queue.</p>
          </div>
        ) : !w.achievementsLoaded ? (
          <div className="empty-state" role="status">
            <FileText size={34} />
            <p>{w.busy ? 'Loading queue…' : 'Queue could not be loaded.'}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <FileText size={34} />
            <p>
              {resultView
                ? 'Queue is clear. Results are saved in history.'
                : 'Select achievements you have already earned.'}
            </p>
          </div>
        ) : (
          <div className="queue-items">
            {items.map((item) => (
              <div
                className={`queue-row ${readonly ? 'queue-readonly' : ''}`}
                key={item.achievement_id}
              >
                {!readonly ? (
                  <input
                    type="checkbox"
                    aria-label={`Select queue row ${item.name}`}
                    checked={selected.has(item.achievement_id)}
                    disabled={w.busy || !lockedIds.has(item.achievement_id)}
                    onChange={() => onToggle(item.achievement_id)}
                  />
                ) : null}
                <Art
                  name={item.name}
                  kind="achievement"
                  image={
                    w.achievements.find((entry) => entry.id === item.achievement_id)?.image_locked
                  }
                  demo={demo}
                />
                <div className="queue-row-content">
                  <strong>{item.name}</strong>
                  {!readonly ? (
                    <button
                      className="queue-date"
                      disabled={w.busy || !lockedIds.has(item.achievement_id)}
                      aria-label={`Edit date for ${item.name}`}
                      onClick={() => onDate([item.achievement_id])}
                    >
                      <CalendarDays size={17} />
                      {formatTimestamp(item.unlocked_at, zone, false)}
                    </button>
                  ) : (
                    <span className="muted queue-readonly-date">
                      {formatTimestamp(item.unlocked_at, zone, true)}
                    </span>
                  )}
                </div>
                {!readonly ? (
                  <button
                    className="icon-button"
                    aria-label={`Remove ${item.name} from queue`}
                    disabled={w.busy}
                    onClick={() => w.remove([item.achievement_id])}
                  >
                    <X size={19} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {review && w.game ? (
          <>
            <p className="muted">Existing unlocks keep their dates.</p>
            <CloseGameNote title={w.game.title} />
            <p className="muted">No changes have been sent.</p>
          </>
        ) : null}
        {activeApply ? (
          <p className="info-note">
            <LoaderCircle className="spinner" size={22} />
            <span>
              Keep the app open until the result is available. This operation cannot be cancelled.
            </span>
          </p>
        ) : null}
      </div>
      <div className="queue-actions">
        <label className="zone-control">
          Time zone
          <select
            value={zone}
            onChange={(event) => onZone(event.target.value)}
            disabled={activeApply}
          >
            {[...new Set([zone, ...TIME_ZONES])].map((value) => (
              <option value={value} key={value}>
                {zoneLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {resultView ? (
          <>
            <button className="primary" disabled={w.busy} onClick={() => w.setView('browse')}>
              {resultsNeedAttention(resultView) ? 'Review queue' : 'Back to achievements'}
            </button>
            <button disabled={w.busy} onClick={() => w.refreshAchievements(true)}>
              {resultsNeedAttention(resultView) ? 'Check current state' : 'Refresh achievements'}
            </button>
            <p className="saved-state">
              <FileText size={16} />
              Report retained
            </p>
          </>
        ) : review ? (
          <>
            <button disabled={w.busy} onClick={() => w.setView('browse')}>
              Back to queue
            </button>
            <button
              className="primary"
              disabled={w.busy || pending.length === 0}
              onClick={onConfirm}
            >
              Continue to apply
            </button>
            {pending.length === 0 ? <p className="muted">Nothing needs restoration.</p> : null}
          </>
        ) : activeApply ? (
          <button className="primary" disabled>
            <LoaderCircle className="spinner" size={18} />
            Applying changes…
          </button>
        ) : w.view === 'history' ? (
          <button onClick={() => w.setView('browse')} disabled={w.busy}>
            Back to achievements
          </button>
        ) : (
          <>
            <button
              className="primary"
              disabled={w.busy || items.length === 0 || !w.auth.authenticated}
              onClick={w.createPreview}
            >
              <Eye size={20} />
              Preview changes
            </button>
            <button disabled title="Preview changes to enable Apply">
              <Check size={18} />
              Apply changes
            </button>
            <p className="action-hint">
              {w.previewStale
                ? 'Queue changed — preview again.'
                : 'Preview changes to enable Apply.'}
            </p>
            {w.saved ? (
              <p className="saved-state" role="status">
                <Check size={16} />
                Draft saved
              </p>
            ) : null}
          </>
        )}
        {w.error && w.auth.authenticated ? (
          <p className="field-error">
            <Info size={16} />
            The last request did not complete. Your report or draft is kept.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
