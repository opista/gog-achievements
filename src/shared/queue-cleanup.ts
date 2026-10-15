import type { Queue, QueueItem, Report, ReportItem } from './api';

export function isConfirmedUnlock(
  item: Pick<ReportItem, 'status' | 'actual_unlocked_at'>,
): boolean {
  return (
    item.actual_unlocked_at !== null &&
    ['restored', 'skipped_already_unlocked', 'restored_with_different_date'].includes(item.status)
  );
}

export function isConfirmedChange(item: ReportItem): boolean {
  return item.action === 'lock'
    ? item.actual_unlocked_at === null && ['locked', 'skipped_already_locked'].includes(item.status)
    : isConfirmedUnlock(item);
}

export function reportMatchesRequest(result: ReportItem, request: QueueItem): boolean {
  if (result.achievement_id !== request.achievement_id) return false;
  return request.action === 'lock'
    ? result.action === 'lock' &&
        Date.parse(result.previous_unlocked_at) === Date.parse(request.previous_unlocked_at)
    : result.action !== 'lock' &&
        Date.parse(result.requested_unlocked_at) === Date.parse(request.unlocked_at);
}

export function sameQueueRequest(left: QueueItem, right: QueueItem): boolean {
  return (
    left.achievement_id === right.achievement_id &&
    left.key === right.key &&
    (left.action === 'lock'
      ? right.action === 'lock' &&
        Date.parse(left.previous_unlocked_at) === Date.parse(right.previous_unlocked_at)
      : right.action !== 'lock' && Date.parse(left.unlocked_at) === Date.parse(right.unlocked_at))
  );
}

/** Remove confirmed requests only when they still match the reviewed request. */
export function remainingQueueItems(draft: Queue, reviewed: Queue, report: Report): QueueItem[] {
  if (
    report.dry_run ||
    report.user_id !== reviewed.user_id ||
    report.game.id !== reviewed.game.id ||
    report.game.client_id !== reviewed.game.client_id
  )
    return [...draft.items];
  const requests = new Map(reviewed.items.map((item) => [item.achievement_id, item]));
  const confirmed = new Map(
    report.results.filter(isConfirmedChange).map((item) => [item.achievement_id, item]),
  );
  return draft.items.filter((item) => {
    const request = requests.get(item.achievement_id);
    const result = confirmed.get(item.achievement_id);
    return (
      !request ||
      !result ||
      !sameQueueRequest(item, request) ||
      !reportMatchesRequest(result, request)
    );
  });
}
