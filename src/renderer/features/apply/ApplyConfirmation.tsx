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
            Apply {countLabel}
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
        <p>All queued achievements are already unlocked. Existing dates are kept.</p>
      ) : (
        <>
          <h4 className="confirmation-list-heading">Achievements to unlock</h4>
          <ul className="confirmation-rows" aria-label="Achievements to unlock">
            {pending.map((item) => {
              const achievement = achievementFor(report.game.id, item.achievement_id);
              const description = achievement?.description || 'No description available.';
              const occurrence = localTimeOccurrence(item.requested_unlocked_at, zone);
              return (
                <li className="confirmation-row" key={item.achievement_id}>
                  <Art
                    name={item.name}
                    kind="achievement"
                    image={achievement?.image_locked}
                    demo={demo}
                  />
                  <div className="confirmation-copy">
                    <strong>{item.name}</strong>
                    <p className="queue-description" title={description}>
                      {description}
                    </p>
                  </div>
                  <div className="confirmation-date">
                    <time dateTime={item.requested_unlocked_at}>
                      {formatTimestamp(item.requested_unlocked_at, zone)}
                    </time>
                    {occurrence ? <small>{occurrence}</small> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {report.results.length > pending.length && pending.length > 0 ? (
        <p className="confirmation-kept">Already unlocked achievements keep their dates.</p>
      ) : null}
    </Dialog>
  );
}
