import type { ApplyResult, ReportItem } from '../../../shared/api';
import { isConfirmedChange } from '../../../shared/queue-cleanup';
import { toNotice } from '../../presentation/error-notice';

export function unknownApplyResult(failure: unknown): ApplyResult {
  const notice = toNotice(failure);
  return {
    operationId: '',
    state: 'unknown',
    report: null,
    error: { code: notice.code ?? 'UNKNOWN_OUTCOME', message: notice.message },
  };
}

export function summarizeApplyResult(result: ApplyResult) {
  const unknown = result.state === 'unknown' || !result.report || result.report.dry_run;
  const rows = unknown ? [] : result.report!.results;
  const confirmed = rows.filter(isConfirmedChange);
  const changed = confirmed.filter((item) => !item.status.startsWith('skipped_'));
  const unresolved = rows.filter((item) => !isConfirmedChange(item));
  const differentDates = confirmed.filter((item) => item.status === 'restored_with_different_date');
  const attention =
    unknown ||
    unresolved.length > 0 ||
    differentDates.length > 0 ||
    !result.report?.complete ||
    Boolean(result.error);
  const issues: ReportItem[] = rows.filter(
    (item) => !isConfirmedChange(item) || item.status === 'restored_with_different_date',
  );
  return {
    unknown,
    attention,
    title: unknown
      ? 'Could not confirm changes'
      : attention
        ? 'Changes need attention'
        : changed.length === 0
          ? 'No changes needed'
          : 'Changes applied',
    unlocked: changed.filter((item) => item.action !== 'lock').length,
    locked: changed.filter((item) => item.action === 'lock').length,
    alreadyUnlocked: confirmed.filter((item) => item.status === 'skipped_already_unlocked').length,
    alreadyLocked: confirmed.filter((item) => item.status === 'skipped_already_locked').length,
    unresolved: unresolved.length,
    issues,
  };
}
