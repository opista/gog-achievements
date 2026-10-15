import type { ReportItem } from '../../shared/api';

export const STATUS_LABELS: Record<ReportItem['status'], string> = {
  pending: 'Ready to restore',
  restored: 'Confirmed',
  skipped_already_unlocked: 'Already unlocked',
  restored_with_different_date: 'Unlocked with a different date',
  failed: 'Request failed',
  unconfirmed: 'Outcome uncertain',
  not_attempted: 'Not attempted',
};
