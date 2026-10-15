import type { Queue, Report } from '../../shared/api';
import { DesktopError } from '../errors';
export function validateReport(report: Report, queue: Queue, dryRun: boolean): void {
  const rowsMatch =
    report.results.length === queue.items.length &&
    report.results.every(
      (row, index) =>
        row.achievement_id === queue.items[index]?.achievement_id &&
        Date.parse(row.requested_unlocked_at) === Date.parse(queue.items[index]!.unlocked_at),
    );
  if (
    report.dry_run !== dryRun ||
    report.user_id !== queue.user_id ||
    report.game.id !== queue.game.id ||
    report.game.client_id !== queue.game.client_id ||
    !rowsMatch
  )
    throw new DesktopError(
      'INVALID_REPORT',
      'Could not confirm these changes. Refresh achievements before trying again.',
    );
}
