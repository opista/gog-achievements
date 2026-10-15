import { CircleAlert } from 'lucide-react';
import type { ApplyResult } from '../../../shared/api';
import { ExactDate } from './ExactDate';
import { resultsNeedAttention } from './apply-model';
import { STATUS_LABELS } from '../../presentation/report-status';
export function Results({ result, zone }: { result: ApplyResult; zone: string }) {
  const unknown = result.state === 'unknown' || !result.report;
  const attention = resultsNeedAttention(result);
  const hasSkipped = result.report?.results.some(
    (item) => item.status === 'skipped_already_unlocked',
  );
  return (
    <section className="results">
      <h2>
        {unknown
          ? 'Could not confirm changes'
          : attention
            ? 'Results need attention'
            : 'Results confirmed'}
      </h2>
      <p className="muted">
        {unknown
          ? 'Refresh achievements to check which achievements are unlocked before trying again.'
          : attention
            ? 'Review each result. No further changes will be sent automatically.'
            : hasSkipped
              ? 'Existing unlocks kept their dates.'
              : 'All requested unlocks and dates were confirmed.'}
      </p>
      {result.error && !unknown ? (
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
      ) : null}
    </section>
  );
}
