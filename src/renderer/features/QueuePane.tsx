import { useMemo, useState } from 'react';
import { CalendarDays, Check, FileText, Info, LoaderCircle, X } from 'lucide-react';
import type { QueueItem } from '../../shared/api';
import type { Workspace } from '../use-workspace';
import { Art } from '../components/Art';
import { PaneResize } from '../components/PaneResize';
import { TIME_ZONES, formatTimestamp, timeZoneOptions, zoneLabel } from '../date-time';
import { QueueDateModal } from './QueueDateModal';
interface Props {
  workspace: Workspace;
  zone: string;
  demo: boolean;
  onZone(value: string): void;
  width?: number;
  onResize(width: number): void;
}
export function QueuePane(props: Props) {
  return props.workspace.auth.authenticated ? <SignedInQueuePane {...props} /> : null;
}

function SignedInQueuePane({ workspace: w, zone, demo, onZone, width, onResize }: Props) {
  const [editing, setEditing] = useState<{ gameId: string; item: QueueItem } | null>(null);
  const zones = useMemo(() => timeZoneOptions([...new Set([zone, ...TIME_ZONES])]), [zone]);
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
            {total} achievement{total === 1 ? '' : 's'} · {groups.length} game
            {groups.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <div className="queue-body">
        {!w.queuesLoaded && w.busy ? (
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
            <p>Queue is empty.</p>
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
                  {group.items.map((item) => {
                    const achievement = w.achievementFor(group.game.id, item.achievement_id);
                    const description = achievement?.description || 'No description available.';
                    const savedDate = `${formatTimestamp(item.unlocked_at, zone)} · ${zoneLabel(zone, item.unlocked_at).replaceAll('_', ' ')}`;
                    return (
                      <div className="queue-row" key={item.achievement_id}>
                        <Art
                          name={item.name}
                          kind="achievement"
                          image={achievement?.image_locked}
                          demo={demo}
                        />
                        <div className="queue-row-content">
                          <strong title={item.name}>{item.name}</strong>
                          <p className="queue-description" title={description}>
                            {description}
                          </p>
                        </div>
                        <div className="queue-row-controls">
                          <button
                            className="icon-button"
                            aria-label={`Edit date for ${item.name}`}
                            title={savedDate}
                            disabled={w.busy}
                            onClick={() => setEditing({ gameId: group.game.id, item })}
                          >
                            <CalendarDays size={18} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Remove ${item.name} from queue`}
                            disabled={w.busy}
                            onClick={() => w.remove(group.game.id, [item.achievement_id])}
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
            {zones.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
      {editing ? (
        <QueueDateModal
          item={editing.item}
          description={w.achievementFor(editing.gameId, editing.item.achievement_id)?.description}
          zone={zone}
          busy={w.busy}
          onClose={() => setEditing(null)}
          onSave={(iso) => w.saveDates(editing.gameId, { [editing.item.achievement_id]: iso })}
        />
      ) : null}
    </aside>
  );
}
