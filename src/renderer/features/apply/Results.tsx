import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ApplyResult, ReportItem } from '../../../shared/api';
import { ExactDate } from './ExactDate';
import { summarizeApplyResult } from './apply-model';
import { STATUS_LABELS } from '../../presentation/report-status';
import { AchievementActionLabel } from '../../components/AchievementAction';

function issueLabel(item: ReportItem): string {
  if (item.status === 'pending') return 'Not attempted';
  if (item.status === 'restored' && !item.actual_unlocked_at) return 'Unlock date unavailable';
  if (item.status === 'locked') return 'The achievement still appears unlocked';
  if (item.status.startsWith('skipped_')) return 'Current state not confirmed';
  return STATUS_LABELS[item.status];
}

export function Results({ result, zone }: { result: ApplyResult; zone: string }) {
  const summary = summarizeApplyResult(result);
  const Icon = summary.attention ? CircleAlert : CircleCheck;
  return (
    <section className="apply-result" aria-label={summary.title}>
      <div
        className={`apply-result-summary ${summary.attention ? 'needs-attention' : 'succeeded'}`}
        role="status"
      >
        <Icon size={32} aria-hidden="true" />
        <div className="apply-result-counts">
          {summary.unknown ? (
            <p>Check the current achievement state before trying again.</p>
          ) : (
            <>
              {summary.unlocked > 0 ? (
                <AchievementActionLabel action="unlock" label={`${summary.unlocked} unlocked`} />
              ) : null}
              {summary.locked > 0 ? (
                <AchievementActionLabel action="lock" label={`${summary.locked} locked`} />
              ) : null}
              {summary.alreadyUnlocked > 0 ? (
                <AchievementActionLabel
                  action="unlock"
                  label={`${summary.alreadyUnlocked} already unlocked`}
                />
              ) : null}
              {summary.alreadyLocked > 0 ? (
                <AchievementActionLabel
                  action="lock"
                  label={`${summary.alreadyLocked} already locked`}
                />
              ) : null}
              {summary.unresolved > 0 ? (
                <span>
                  {summary.unresolved} need{summary.unresolved === 1 ? 's' : ''} attention
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
      <p className="muted">
        {summary.unknown
          ? 'The outcome is unknown. Your requests remain in the queue.'
          : summary.unresolved > 0
            ? 'Unconfirmed requests stay in the queue. No changes will be retried automatically.'
            : summary.issues.length > 0
              ? 'Review the saved unlock dates below.'
              : summary.attention
                ? 'The attempt did not finish normally. Check the current state before applying again.'
                : summary.unlocked + summary.locked === 0
                  ? 'These achievements already have the requested state.'
                  : 'Your changes are saved in History.'}
      </p>
      {result.error && !summary.unknown ? (
        <p className="info-note">{result.error.message}</p>
      ) : null}
      {summary.issues.length > 0 ? (
        <ul className="apply-result-issues" aria-label="Changes needing attention">
          {summary.issues.map((item) => (
            <li key={item.achievement_id}>
              <strong>{item.name}</strong>
              <span>{issueLabel(item)}</span>
              {item.status === 'restored_with_different_date' ? (
                <div className="apply-date-difference">
                  <div>
                    <span>Requested</span>
                    <ExactDate iso={item.requested_unlocked_at} zone={zone} />
                  </div>
                  <div>
                    <span>Saved</span>
                    <ExactDate iso={item.actual_unlocked_at} zone={zone} />
                  </div>
                </div>
              ) : (
                <AchievementActionLabel
                  action={item.action ?? 'unlock'}
                  label={item.action === 'lock' ? 'Lock not confirmed' : 'Unlock not confirmed'}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
