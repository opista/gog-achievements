import { TriangleAlert } from 'lucide-react';
import type { Achievement, Report } from '../../../shared/api';
import { formatTimestamp, localTimeOccurrence } from '../../date-time';
import { Dialog } from '../../components/Dialog';
import { Art } from '../../components/Art';
export function ApplyConfirmation({
  report,
  zone,
  busy,
  demo,
  achievementFor,
  onClose,
  onApply,
}: {
  report: Report;
  zone: string;
  busy: boolean;
  demo: boolean;
  achievementFor(gameId: string, achievementId: string): Achievement | undefined;
  onClose(): void;
  onApply(): void;
}) {
  const pending = report.results.filter((item) => item.status === 'pending');
  const countLabel = `${pending.length} achievement${pending.length === 1 ? '' : 's'}`;
  const locks = pending.filter((item) => item.action === 'lock').length;
  const unlocks = pending.length - locks;
  const describe = (count: number) => `${count} achievement${count === 1 ? '' : 's'}`;
  const actionLabel = [
    unlocks ? `Unlock ${describe(unlocks)}` : '',
    locks ? `lock ${describe(locks)}` : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const buttonLabel = actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1);
  const listLabel =
    locks === 0
      ? 'Achievements to unlock'
      : unlocks === 0
        ? 'Achievements to lock'
        : 'Achievements to change';
  return (
    <Dialog
      title={`Apply ${countLabel}?`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button data-initial-focus disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || pending.length === 0} onClick={onApply}>
            {buttonLabel || 'Apply changes'}
          </button>
        </>
      }
    >
      <p className="confirmation-warning" role="note" aria-label="Before applying">
        <TriangleAlert size={20} aria-hidden="true" />
        <span>Close the game before applying.</span>
      </p>
      <h3 className="confirmation-game">{report.game.title}</h3>
      {pending.length === 0 ? (
        <p>All queued achievements already have the requested state.</p>
      ) : (
        <>
          <h4 className="confirmation-list-heading">{listLabel}</h4>
          <ul className="confirmation-rows" aria-label={listLabel}>
            {pending.map((item) => {
              const achievement = achievementFor(report.game.id, item.achievement_id);
              const description = achievement?.description || 'No description available.';
              const locking = item.action === 'lock';
              const date = locking ? item.previous_unlocked_at : item.requested_unlocked_at;
              const occurrence = localTimeOccurrence(date, zone);
              return (
                <li className="confirmation-row" key={item.achievement_id}>
                  <Art
                    name={item.name}
                    kind="achievement"
                    image={locking ? achievement?.image_unlocked : achievement?.image_locked}
                    demo={demo}
                  />
                  <div className="confirmation-copy">
                    <strong>{item.name}</strong>
                    <span className={`queue-action-label ${locking ? 'lock' : ''}`}>
                      {locking ? 'Lock' : 'Unlock'}
                    </span>
                    <p className="queue-description" title={description}>
                      {description}
                    </p>
                  </div>
                  <div className="confirmation-date">
                    <small>{locking ? 'Previous unlock' : 'Unlock date'}</small>
                    <time dateTime={date}>{formatTimestamp(date, zone)}</time>
                    {occurrence ? <small>{occurrence}</small> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {report.results.length > pending.length && pending.length > 0 ? (
        <p className="confirmation-kept">
          Achievements already in the requested state will be skipped.
        </p>
      ) : null}
    </Dialog>
  );
}
