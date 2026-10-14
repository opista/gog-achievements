import { CircleAlert, History, Info } from 'lucide-react';
import type { ApplyResult, OperationRecord } from '../../shared/api';
import { formatTimestamp, zoneLabel } from '../date-time';
import { ExactDate, STATUS_LABELS } from './Review';
export function resultsNeedAttention(result: ApplyResult): boolean {
  return (
    !result.report ||
    result.state === 'unknown' ||
    result.report.results.some(
      (row) => !['restored', 'skipped_already_unlocked'].includes(row.status),
    )
  );
}
export function Results({ result, zone }: { result: ApplyResult; zone: string }) {
  const unknown = result.state === 'unknown' || !result.report;
  const attention = resultsNeedAttention(result);
  const hasSkipped = result.report?.results.some(
    (item) => item.status === 'skipped_already_unlocked',
  );
  return (
    <section className="results">
      <h2>
        {unknown ? 'Outcome unknown' : attention ? 'Results need attention' : 'Results confirmed'}
      </h2>
      <p className="muted">
        {unknown
          ? 'The operation ended without a confirmed report. Check current state before another attempt.'
          : attention
            ? 'Review each result. No further changes will be sent automatically.'
            : hasSkipped
              ? 'Restorations confirmed. Existing unlocks kept their dates.'
              : 'All requested unlocks and dates were confirmed.'}
      </p>
      {result.error ? (
        <p className="info-note">
          <CircleAlert size={20} />
          <span>{result.error.message}</span>
        </p>
      ) : null}
      {result.report ? (
        <div className="result-table-wrap">
          <table className="result-table">
            <thead>
              <tr>
                <th>Achievement</th>
                <th>Requested (local time)</th>
                <th>Confirmed (local time)</th>
              </tr>
            </thead>
            <tbody>
              {result.report.results.map((item) => (
                <tr key={item.achievement_id}>
                  <th scope="row">
                    <strong>{item.name}</strong>
                    <span
                      className={`status ${['restored', 'skipped_already_unlocked'].includes(item.status) ? 'ready' : 'attention'}`}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                    {item.error_code ? <small>{item.error_code}</small> : null}
                  </th>
                  <td>
                    <ExactDate iso={item.requested_unlocked_at} zone={zone} />
                  </td>
                  <td>
                    <ExactDate iso={item.actual_unlocked_at} zone={zone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="info-note">
          <Info size={20} />
          <span>
            A live refresh shows current achievement state. It cannot prove which operation caused
            an unlock.
          </span>
        </p>
      )}
      <p className="muted">Display zone: {zoneLabel(zone)}</p>
    </section>
  );
}
export function HistoryView({
  records,
  zone,
  onView,
  loading = false,
}: {
  records: OperationRecord[];
  zone: string;
  onView(record: OperationRecord): void;
  loading?: boolean;
}) {
  return (
    <section className="history-view">
      <h2>Operation history</h2>
      <p className="muted">Saved reports are read-only. They cannot undo an unlock.</p>
      {loading ? (
        <div className="history-skeleton" role="status" aria-label="Loading operation history">
          <span className="sr-only">Loading operation history…</span>
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row} aria-hidden="true">
              <span className="skeleton-text" />
            </div>
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <History size={34} />
          <p>No saved operations yet.</p>
        </div>
      ) : (
        <ul className="history-list">
          {records.map((record) => (
            <li key={record.id}>
              <div>
                <strong>{record.game_title}</strong>
                <span>{formatTimestamp(record.started_at, zone)}</span>
                <span className="status neutral">
                  {record.state === 'unknown'
                    ? 'Outcome unknown'
                    : record.state === 'running'
                      ? 'Operation interrupted'
                      : record.report?.complete
                        ? 'Completed'
                        : 'Needs attention'}
                </span>
              </div>
              <button onClick={() => onView(record)}>View report</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
