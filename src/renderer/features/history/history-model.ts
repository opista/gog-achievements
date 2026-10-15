import type { AchievementAction, OperationRecord } from '../../../shared/api';
import { STATUS_LABELS } from '../../presentation/report-status';

interface HistoryChange {
  key: string;
  name: string;
  game: string;
  action: AchievementAction;
  timestamp: string;
  time: number;
  differentDate: boolean;
}
interface HistoryAttention {
  key: string;
  name: string;
  game?: string;
  status: string;
  timestamp: string;
  dateLabel: 'Requested' | 'Attempted' | 'Previous unlock';
}
export function buildHistoryRows(records: OperationRecord[]): {
  changes: HistoryChange[];
  attention: HistoryAttention[];
} {
  const changes: HistoryChange[] = [];
  const unlocks = new Set<string>();
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
      if (item.status === 'skipped_already_unlocked' || item.status === 'skipped_already_locked')
        continue;
      if (item.action === 'lock' && item.status === 'locked' && item.actual_unlocked_at === null) {
        const timestamp = record.finished_at ?? record.started_at;
        changes.push({
          key: `lock:${record.id}:${item.achievement_id}`,
          name: item.name,
          game: report.game.title,
          action: 'lock',
          timestamp,
          time: Date.parse(timestamp),
          differentDate: false,
        });
        continue;
      }
      const time = item.actual_unlocked_at ? Date.parse(item.actual_unlocked_at) : Number.NaN;
      const restored = item.status === 'restored' || item.status === 'restored_with_different_date';
      if (restored && Number.isFinite(time) && item.actual_unlocked_at) {
        const key = `${report.game.id}:${item.achievement_id}:${time}`;
        if (!unlocks.has(key)) {
          unlocks.add(key);
          changes.push({
            key: `unlock:${key}`,
            name: item.name,
            game: report.game.title,
            action: 'unlock',
            timestamp: item.actual_unlocked_at,
            time,
            differentDate: item.status === 'restored_with_different_date',
          });
        }
      } else {
        attention.push({
          key: `${record.id}:${item.achievement_id}`,
          name: item.name,
          game: report.game.title,
          status: restored
            ? 'Unlock date unavailable'
            : `${item.action === 'lock' ? 'Lock: ' : ''}${STATUS_LABELS[item.status]}`,
          timestamp:
            item.action === 'lock' ? item.previous_unlocked_at : item.requested_unlocked_at,
          dateLabel: item.action === 'lock' ? 'Previous unlock' : 'Requested',
        });
      }
    }
  }
  return {
    changes: changes.sort((left, right) => right.time - left.time),
    attention,
  };
}
