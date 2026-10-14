import { CalendarDays, Globe2 } from 'lucide-react';
import type { Report, ReportItem } from '../../shared/api';
import { formatTimestamp, zoneLabel } from '../date-time';
import { Dialog } from '../components/Dialog';
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
  onClose,
  onApply,
}: {
  report: Report;
  zone: string;
  busy: boolean;
  onClose(): void;
  onApply(): void;
}) {
  const pending = report.results.filter((item) => item.status === 'pending');
  return (
    <Dialog
      title={`Apply ${pending.length} achievements?`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button data-initial-focus disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || pending.length === 0} onClick={onApply}>
            Apply {pending.length} achievements
          </button>
        </>
      }
    >
      <div className="confirmation-account">
        <h3>{report.game.title}</h3>
        <p>GOG account {report.user_id}</p>
      </div>
      <p>Close the game before applying.</p>
      {pending.length === 0 ? (
        <p>All queued achievements are already unlocked. Existing dates are kept.</p>
      ) : null}
      {report.results.length > pending.length && pending.length > 0 ? (
        <p className="muted">Already unlocked achievements keep their dates.</p>
      ) : null}
      <div className="confirmation-rows">
        {pending.map((item) => (
          <div key={item.achievement_id}>
            <strong>{item.name}</strong>
            <ExactDate iso={item.requested_unlocked_at} zone={zone} />
          </div>
        ))}
      </div>
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
