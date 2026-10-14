import { CalendarDays, Globe2, Info } from 'lucide-react';
import type { Achievement, Report, ReportItem } from '../../shared/api';
import { formatTimestamp, offsetLabel, timeZoneOffset, zoneLabel } from '../date-time';
import { Dialog } from '../components/Dialog';
import { Art } from '../components/Art';
export function ExactDate({ iso, zone }: { iso: string | null; zone: string }) {
  if (!iso) return <span className="muted">Not confirmed</span>;
  return (
    <span className="exact-date">
      <span>
        <CalendarDays size={16} />
        {formatTimestamp(iso, zone)} <span className="muted">({zoneLabel(zone, iso)})</span>
      </span>
      <span className="muted">
        <Globe2 size={16} />
        {formatTimestamp(iso, 'UTC')} UTC
      </span>
    </span>
  );
}
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
      <div className="confirmation-account">
        <h3>{report.game.title}</h3>
        <p>GOG account {report.user_id}</p>
      </div>
      <p className="confirmation-note">
        <Info size={18} aria-hidden="true" />
        Close the game before applying.
      </p>
      {pending.length === 0 ? (
        <p>All queued achievements are already unlocked. Existing dates are kept.</p>
      ) : (
        <>
          <div className="confirmation-list-heading">
            <h4>Achievements to unlock</h4>
            <p>Unlock dates in {zone.replaceAll('_', ' ')}</p>
          </div>
          <ul className="confirmation-rows" aria-label="Achievements to unlock">
            {pending.map((item) => {
              const achievement = achievementFor(report.game.id, item.achievement_id);
              const description = achievement?.description || 'No description available.';
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
                    <span>{offsetLabel(timeZoneOffset(zone, item.requested_unlocked_at))}</span>
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
export const STATUS_LABELS: Record<ReportItem['status'], string> = {
  pending: 'Ready to restore',
  restored: 'Confirmed',
  skipped_already_unlocked: 'Already unlocked',
  restored_with_different_date: 'Unlocked with a different date',
  failed: 'Request failed',
  unconfirmed: 'Outcome uncertain',
  not_attempted: 'Not attempted',
};
