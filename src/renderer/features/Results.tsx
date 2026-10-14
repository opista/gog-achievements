import { useMemo } from 'react';
import { CircleAlert, History, Info } from 'lucide-react';
import type { ApplyResult, OperationRecord } from '../../shared/api';
import { formatTimestamp } from '../date-time';
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
                <th>Requested</th>
                <th>Confirmed</th>
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
    </section>
  );
}
interface HistoryUnlock {
  key: string;
  name: string;
  game: string;
  unlockedAt: string;
  time: number;
  differentDate: boolean;
}
interface HistoryAttention {
  key: string;
  name: string;
  game?: string;
  status: string;
  timestamp: string;
  dateLabel: 'Requested' | 'Attempted';
}
function historyRows(records: OperationRecord[]): {
  unlocks: HistoryUnlock[];
  attention: HistoryAttention[];
} {
  const unlocks = new Map<string, HistoryUnlock>();
  const attention: HistoryAttention[] = [];
  const attempts = records.toSorted(
    (left, right) => Date.parse(right.started_at) - Date.parse(left.started_at),
  );
  for (const record of attempts) {
    const report = record.report;
    if (record.state !== 'complete' || !report) {
      attention.push({
        key: `${record.id}:unknown`,
        name: record.game_title,
        status: record.state === 'running' ? 'Operation interrupted' : 'Outcome unknown',
        timestamp: record.started_at,
        dateLabel: 'Attempted',
      });
      continue;
    }
    if (report.dry_run) continue;
    for (const item of report.results) {
      if (item.status === 'skipped_already_unlocked') continue;
      const time = item.actual_unlocked_at ? Date.parse(item.actual_unlocked_at) : Number.NaN;
      const restored = item.status === 'restored' || item.status === 'restored_with_different_date';
      if (restored && Number.isFinite(time) && item.actual_unlocked_at) {
        const key = `${report.game.id}:${item.achievement_id}:${time}`;
        if (!unlocks.has(key))
          unlocks.set(key, {
            key,
            name: item.name,
            game: report.game.title,
            unlockedAt: item.actual_unlocked_at,
            time,
            differentDate: item.status === 'restored_with_different_date',
          });
      } else {
        attention.push({
          key: `${record.id}:${item.achievement_id}`,
          name: item.name,
          game: report.game.title,
          status: restored ? 'Unlock date unavailable' : STATUS_LABELS[item.status],
          timestamp: item.requested_unlocked_at,
          dateLabel: 'Requested',
        });
      }
    }
  }
  return {
    unlocks: [...unlocks.values()].sort((left, right) => right.time - left.time),
    attention,
  };
}
export function HistoryView({
  records,
  zone,
  loading = false,
}: {
  records: OperationRecord[];
  zone: string;
  loading?: boolean;
}) {
  const { unlocks, attention } = useMemo(() => historyRows(records), [records]);
  return (
    <section className="history-view">
      <h2>Unlock history</h2>
      {loading ? (
        <div className="history-skeleton" role="status" aria-label="Loading unlock history">
          <span className="sr-only">Loading unlock history…</span>
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row} aria-hidden="true">
              <span className="skeleton-text" />
            </div>
          ))}
        </div>
      ) : unlocks.length === 0 && attention.length === 0 ? (
        <div className="empty-state">
          <History size={34} />
          <p>No unlock history yet.</p>
        </div>
      ) : (
        <>
          {unlocks.length > 0 ? (
            <ul className="history-unlocks" aria-label="Unlocked achievements">
              {unlocks.map((entry) => (
                <li className="history-unlock-row" key={entry.key}>
                  <div className="history-entry-copy">
                    <strong>{entry.name}</strong>
                    <span>{entry.game}</span>
                    {entry.differentDate ? <small>Unlocked with a different date</small> : null}
                  </div>
                  <time className="history-unlock-date" dateTime={entry.unlockedAt}>
                    {formatTimestamp(entry.unlockedAt, zone)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No confirmed unlocks yet.</p>
          )}
          {attention.length > 0 ? (
            <section className="history-attention" aria-label="Needs attention">
              <h3>Needs attention</h3>
              <ul className="history-attention-list" aria-label="Results needing attention">
                {attention.map((entry) => (
                  <li className="history-attention-row" key={entry.key}>
                    <div className="history-entry-copy">
                      <strong>{entry.name}</strong>
                      {entry.game ? <span>{entry.game}</span> : null}
                      <small>{entry.status}</small>
                    </div>
                    <span className="history-unlock-date">
                      {entry.dateLabel}{' '}
                      <time dateTime={entry.timestamp}>
                        {formatTimestamp(entry.timestamp, zone)}
                      </time>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
