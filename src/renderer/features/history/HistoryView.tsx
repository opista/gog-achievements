import { useMemo } from 'react';
import { History } from 'lucide-react';
import type { OperationRecord } from '../../../shared/api';
import { formatTimestamp } from '../../date-time';
import { buildHistoryRows } from './history-model';
import { AchievementActionLabel } from '../../components/AchievementAction';

export function HistoryView({
  records,
  zone,
  loading = false,
}: {
  records: OperationRecord[];
  zone: string;
  loading?: boolean;
}) {
  const { unlocks, locks, attention } = useMemo(() => buildHistoryRows(records), [records]);
  return (
    <section className="history-view">
      <h2>Achievement history</h2>
      {loading ? (
        <div className="history-skeleton" role="status" aria-label="Loading achievement history">
          <span className="sr-only">Loading achievement history…</span>
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row} aria-hidden="true">
              <span className="skeleton-text" />
            </div>
          ))}
        </div>
      ) : unlocks.length === 0 && locks.length === 0 && attention.length === 0 ? (
        <div className="empty-state">
          <History size={34} />
          <p>No achievement history yet.</p>
        </div>
      ) : (
        <>
          {locks.length > 0 ? (
            <section aria-label="Locked achievements">
              <h3>Locked achievements</h3>
              <ul className="history-unlocks">
                {locks.map((entry) => (
                  <li className="history-unlock-row" key={entry.key}>
                    <div className="history-entry-copy">
                      <strong>{entry.name}</strong>
                      <AchievementActionLabel action="lock" />
                      <span>{entry.game}</span>
                      <small>
                        Previous unlock:{' '}
                        <time dateTime={entry.previousUnlockedAt}>
                          {formatTimestamp(entry.previousUnlockedAt, zone)}
                        </time>
                      </small>
                    </div>
                    <span className="history-unlock-date">
                      Re-lock confirmed{' '}
                      <time dateTime={entry.lockedAt}>{formatTimestamp(entry.lockedAt, zone)}</time>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {unlocks.length > 0 ? (
            <ul className="history-unlocks" aria-label="Unlocked achievements">
              {unlocks.map((entry) => (
                <li className="history-unlock-row" key={entry.key}>
                  <div className="history-entry-copy">
                    <strong>{entry.name}</strong>
                    <AchievementActionLabel action="unlock" />
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
