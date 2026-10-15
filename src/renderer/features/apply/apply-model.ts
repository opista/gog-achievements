import type { ApplyResult } from '../../../shared/api';
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

export function resultsNeedAttention(result: ApplyResult): boolean {
  return (
    !result.report ||
    result.state === 'unknown' ||
    result.report.results.some(
      (row) =>
        !['restored', 'skipped_already_unlocked', 'locked', 'skipped_already_locked'].includes(
          row.status,
        ),
    )
  );
}
