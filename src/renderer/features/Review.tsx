import { CalendarDays, Globe2, Info } from 'lucide-react';
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
export function PreviewRows({ report, zone }: { report: Report; zone: string }) {
  return (
    <div className="preview-list">
      {report.results.map((item) => (
        <article className="preview-row" key={item.achievement_id}>
          <div className="preview-row-heading">
            <h3>{item.name}</h3>
            <span className={`status ${item.status === 'pending' ? 'ready' : 'neutral'}`}>
              {item.status === 'pending' ? 'Ready to restore' : 'Already unlocked'}
            </span>
          </div>
          <ExactDate
            iso={item.status === 'pending' ? item.requested_unlocked_at : item.actual_unlocked_at}
            zone={zone}
          />
          {item.status === 'skipped_already_unlocked' ? (
            <p className="muted">Existing unlock and date will be kept.</p>
          ) : null}
        </article>
      ))}
    </div>
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
            Back to preview
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
export function CloseGameNote({ title }: { title: string }) {
  return (
    <p className="info-note">
      <Info size={20} />
      <span>Close {title} before applying.</span>
    </p>
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
