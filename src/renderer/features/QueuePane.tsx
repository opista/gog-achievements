import { Check, FileText, Info, LoaderCircle, X } from 'lucide-react';
import type { Workspace } from '../use-workspace';
import { Art } from '../components/Art';
import { PaneResize } from '../components/PaneResize';
import { TIME_ZONES, zoneLabel } from '../date-time';
import { QueueDatePicker } from './QueueDatePicker';
interface Props {
  workspace: Workspace;
  zone: string;
  demo: boolean;
  onZone(value: string): void;
  width?: number;
  onResize(width: number): void;
}
export function QueuePane({ workspace: w, zone, demo, onZone, width, onResize }: Props) {
  const groups = w.queues
    .filter((item) => item.items.length > 0)
    .toSorted(
      (left, right) =>
        left.game.title.localeCompare(right.game.title) ||
        left.game.id.localeCompare(right.game.id),
    );
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const activeApply =
    w.view === 'applying' || w.operation.kind === 'apply' || w.operation.kind === 'recovery';
  return (
    <aside className="queue-pane" aria-label="Achievement queue">
      <PaneResize pane="Queue" width={width} min={336} max={504} onResize={onResize} />
      <div className="queue-header">
        <div>
          <h2>Queue</h2>
          <p className="muted">
            {total} achievements · {groups.length} games
          </p>
        </div>
      </div>
      <div className="queue-body">
        {!w.auth.authenticated ? (
          <div className="empty-state">
            <FileText size={34} />
            <p>Choose achievements after sign-in.</p>
          </div>
        ) : !w.queuesLoaded && w.busy ? (
          <div className="queue-skeleton" role="status" aria-label="Loading queue">
            <span className="sr-only">Loading queue…</span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="queue-row skeleton-row" aria-hidden="true">
                <span className="skeleton-text" />
              </div>
            ))}
          </div>
        ) : !w.queuesLoaded ? (
          <div className="empty-state">
            <p>Queue could not be loaded.</p>
            <button onClick={w.refreshQueues}>Retry queue</button>
          </div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <FileText size={34} />
            <p>
              {w.result
                ? 'Queue is clear. Results are saved in history.'
                : 'Select achievements you have already earned.'}
            </p>
          </div>
        ) : (
          groups.map((group) => {
            const saving = w.queueAction?.gameId === group.game.id;
            const checking = w.previewGameId === group.game.id;
            return (
              <section
                className="queue-game-group"
                aria-label={`Queue for ${group.game.title}`}
                key={group.game.id}
              >
                <div className="queue-game-heading">
                  <h3 title={group.game.title}>{group.game.title}</h3>
                  <span className="muted">{group.items.length}</span>
                </div>
                <div className="queue-items">
                  {group.items.map((item) => (
                    <div className="queue-row" key={item.achievement_id}>
                      <Art
                        name={item.name}
                        kind="achievement"
                        image={
                          group.game.id === w.game?.id
                            ? w.achievements.find((entry) => entry.id === item.achievement_id)
                                ?.image_locked
                            : null
                        }
                        demo={demo}
                      />
                      <div className="queue-row-content">
                        <strong>{item.name}</strong>
                        <QueueDatePicker
                          key={`${group.game.id}:${item.achievement_id}:${zone}:${item.unlocked_at}`}
                          item={item}
                          zone={zone}
                          busy={w.busy}
                          onSave={(iso) =>
                            w.saveDates(group.game.id, { [item.achievement_id]: iso })
                          }
                        />
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${item.name} from queue`}
                        disabled={w.busy}
                        onClick={() => w.remove(group.game.id, [item.achievement_id])}
                      >
                        <X size={19} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="primary queue-group-apply"
                  aria-label={`Apply changes for ${group.game.title}`}
                  disabled={w.busy}
                  onClick={() => w.prepareApply(group.game.id)}
                >
                  {checking ? <LoaderCircle className="spinner" size={18} /> : <Check size={18} />}
                  {checking ? 'Checking changes…' : 'Apply changes'}
                </button>
                {saving ? (
                  <p className="queue-progress" role="status">
                    <LoaderCircle className="spinner" size={16} />
                    Saving draft…
                  </p>
                ) : null}
              </section>
            );
          })
        )}
        {activeApply ? (
          <p className="info-note" role="status">
            <LoaderCircle className="spinner" size={20} />
            <span>Applying changes. Keep the app open until the result is available.</span>
          </p>
        ) : null}
      </div>
      <div className="queue-actions">
        <label className="zone-control">
          Time zone
          <select value={zone} onChange={(event) => onZone(event.target.value)} disabled={w.busy}>
            {[...new Set([zone, ...TIME_ZONES])].map((value) => (
              <option value={value} key={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <small className="muted">{zoneLabel(zone)}</small>
        {w.saved ? (
          <p className="saved-state" role="status">
            <Check size={16} />
            Draft saved
          </p>
        ) : null}
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
