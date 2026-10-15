import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, FileText, LoaderCircle, X } from 'lucide-react';
import type { Achievement, Queue } from '../../../shared/api';
import { Art } from '../../components/Art';
import { PaneResize } from '../../components/PaneResize';
import { formatTimestamp, localTimeOccurrence } from '../../date-time';
import { QueueDateModal } from './QueueDateModal';
import { queueGroups, type QueueAction } from './queue-model';
interface Props {
  signedIn: boolean;
  queues: Queue[];
  loaded: boolean;
  busy: boolean;
  action: QueueAction | null;
  previewGameId: string | null;
  applyStatus: 'idle' | 'applying' | 'recovery';
  achievementFor(gameId: string, achievementId: string): Achievement | undefined;
  onRefresh(): void;
  onRemove(gameId: string, ids: string[]): void;
  onSaveDates(gameId: string, dates: Record<string, string>): Promise<boolean>;
  onPrepareApply(gameId: string): void;
  zone: string;
  demo: boolean;
  width?: number;
  onResize(width: number): void;
}
export function QueuePane(props: Props) {
  return props.signedIn ? <SignedInQueuePane {...props} /> : null;
}

function SignedInQueuePane({
  queues,
  loaded,
  busy,
  action,
  previewGameId,
  applyStatus,
  achievementFor,
  onRefresh,
  onRemove,
  onSaveDates,
  onPrepareApply,
  zone,
  demo,
  width,
  onResize,
}: Props) {
  const [editing, setEditing] = useState<{
    gameId: string;
    userId: string;
    achievementId: string;
  } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const removalFocus = useRef<string[] | null>(null);
  const groups = queueGroups(queues);
  const editingItem = queues
    .find((queue) => queue.game.id === editing?.gameId && queue.user_id === editing.userId)
    ?.items.find((item) => item.achievement_id === editing?.achievementId);
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const removeOrder = groups.flatMap((group) =>
    group.items.map((item) => `${group.game.id}:${item.achievement_id}`),
  );
  useEffect(() => {
    if (busy || !removalFocus.current) return;
    const target = removalFocus.current
      .map((key) => removeButtons.current.get(key))
      .find((button) => button && !button.disabled);
    (target ?? headingRef.current)?.focus();
    removalFocus.current = null;
  }, [busy, queues]);
  return (
    <aside className="queue-pane" aria-label="Achievement queue">
      <PaneResize pane="Queue" width={width} min={336} max={504} onResize={onResize} />
      <div className="queue-header">
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            Queue
          </h2>
          <p className="muted">
            {total} achievement{total === 1 ? '' : 's'} · {groups.length} game
            {groups.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <div className="queue-body">
        {!loaded && busy ? (
          <div className="queue-skeleton" role="status" aria-label="Loading queue">
            <span className="sr-only">Loading queue…</span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="queue-row skeleton-row" aria-hidden="true">
                <span className="skeleton-text" />
              </div>
            ))}
          </div>
        ) : !loaded ? (
          <div className="empty-state">
            <p>Queue could not be loaded.</p>
            <button onClick={onRefresh}>Retry queue</button>
          </div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <FileText size={34} />
            <p>Queue is empty.</p>
            <p>Use + beside an achievement to add it here.</p>
          </div>
        ) : (
          groups.map((group) => {
            const saving = action?.gameId === group.game.id;
            const checking = previewGameId === group.game.id;
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
                    const achievement = achievementFor(group.game.id, item.achievement_id);
                    const description = achievement?.description || 'No description available.';
                    const savedDate = [
                      formatTimestamp(item.unlocked_at, zone),
                      localTimeOccurrence(item.unlocked_at, zone),
                    ]
                      .filter(Boolean)
                      .join(' · ');
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
                            disabled={busy}
                            onClick={() =>
                              setEditing({
                                gameId: group.game.id,
                                userId: group.user_id,
                                achievementId: item.achievement_id,
                              })
                            }
                          >
                            <CalendarDays size={18} />
                          </button>
                          <button
                            ref={(element) => {
                              const key = `${group.game.id}:${item.achievement_id}`;
                              if (element) removeButtons.current.set(key, element);
                              else removeButtons.current.delete(key);
                            }}
                            className="icon-button"
                            aria-label={`Remove ${item.name} from queue`}
                            title={`Remove ${item.name} from queue`}
                            disabled={busy}
                            onClick={(event) => {
                              if (event.detail === 0) {
                                const key = `${group.game.id}:${item.achievement_id}`;
                                const index = removeOrder.indexOf(key);
                                removalFocus.current = [
                                  key,
                                  ...removeOrder.slice(index + 1),
                                  ...removeOrder.slice(0, index).reverse(),
                                ];
                              }
                              onRemove(group.game.id, [item.achievement_id]);
                            }}
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
                  disabled={busy}
                  onClick={() => onPrepareApply(group.game.id)}
                >
                  {checking ? <LoaderCircle className="spinner" size={18} /> : <Check size={18} />}
                  {checking ? 'Checking changes…' : 'Apply changes'}
                </button>
                {saving ? (
                  <p className="queue-progress" role="status">
                    <LoaderCircle className="spinner" size={16} />
                    Saving queue…
                  </p>
                ) : null}
              </section>
            );
          })
        )}
        {applyStatus !== 'idle' ? (
          <p className="info-note" role="status">
            <LoaderCircle className="spinner" size={20} />
            <span>
              {applyStatus === 'recovery'
                ? 'Checking previous changes. Please keep the app open.'
                : 'Applying changes. Keep the app open until the result is available.'}
            </span>
          </p>
        ) : null}
      </div>
      {editing && editingItem ? (
        <QueueDateModal
          item={editingItem}
          description={achievementFor(editing.gameId, editing.achievementId)?.description}
          zone={zone}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(iso) => onSaveDates(editing.gameId, { [editing.achievementId]: iso })}
        />
      ) : null}
    </aside>
  );
}
