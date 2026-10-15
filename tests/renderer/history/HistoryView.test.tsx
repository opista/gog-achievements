// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { OperationRecord, ReportItem, UnlockReportItem } from '../../../src/shared/api';
import { HistoryView } from '../../../src/renderer/features/history/HistoryView';
import { formatTimestamp } from '../../../src/renderer/date-time';

afterEach(cleanup);
function row(overrides: Partial<UnlockReportItem> = {}): UnlockReportItem {
  return {
    achievement_id: '1',
    name: 'The World',
    status: 'restored',
    requested_unlocked_at: '2026-10-10T17:30:00Z',
    previous_unlocked_at: null,
    actual_unlocked_at: '2026-10-10T17:30:00Z',
    ...overrides,
  };
}
function record(
  id: string,
  rows: ReportItem[],
  options: { gameId?: string; title?: string; startedAt?: string } = {},
): OperationRecord {
  return {
    id,
    user_id: '123456789',
    game_id: options.gameId ?? '1',
    game_title: options.title ?? 'Cyberpunk 2077',
    state: 'complete',
    started_at: options.startedAt ?? '2026-10-14T10:00:00Z',
    finished_at: '2026-10-14T10:01:00Z',
    report: {
      user_id: '123456789',
      game: {
        id: options.gameId ?? '1',
        title: options.title ?? 'Cyberpunk 2077',
        client_id: '100001',
      },
      dry_run: false,
      complete: rows.every(
        (item) => item.status === 'restored' || item.status === 'skipped_already_unlocked',
      ),
      results: rows,
    },
  };
}
it('shows flat unlock rows sorted by actual unlock time with game context and local dates', () => {
  const oldest = record(
    'a',
    [row({ name: 'Old unlock', actual_unlocked_at: '2026-10-01T10:00:00Z' })],
    { startedAt: '2026-10-14T11:00:00Z' },
  );
  const newest = record(
    'b',
    [row({ name: 'Witcher unlock', actual_unlocked_at: '2026-10-12T16:00:00Z' })],
    { gameId: '2', title: 'The Witcher 3', startedAt: '2026-10-13T11:00:00Z' },
  );
  const middle = record('c', [
    row({ name: 'Middle unlock', actual_unlocked_at: '2026-10-05T12:00:00Z' }),
  ]);
  render(<HistoryView records={[oldest, newest, middle]} zone="Europe/London" />);
  expect(screen.getByRole('heading', { name: 'Achievement history' })).toBeVisible();
  const entries = within(screen.getByRole('list', { name: 'Unlocked achievements' })).getAllByRole(
    'listitem',
  );
  expect(entries.map((entry) => entry.querySelector('strong')?.textContent)).toEqual([
    'Witcher unlock',
    'Middle unlock',
    'Old unlock',
  ]);
  expect(within(entries[0]!).getByText('The Witcher 3')).toBeVisible();
  expect(
    within(entries[0]!).getByText(formatTimestamp('2026-10-12T16:00:00Z', 'Europe/London')),
  ).toHaveAttribute('datetime', '2026-10-12T16:00:00Z');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText(/cannot undo/i)).not.toBeInTheDocument();
});
it('deduplicates the same game, achievement and actual instant without merging different games or dates', () => {
  const original = record('a', [row()]);
  const equivalent = record('b', [row({ actual_unlocked_at: '2026-10-10T18:30:00+01:00' })]);
  const otherGame = record('c', [row({ name: 'Other game unlock' })], {
    gameId: '2',
    title: 'The Witcher 3',
  });
  const otherDate = record('d', [
    row({ name: 'Another recorded unlock', actual_unlocked_at: '2026-10-11T17:30:00Z' }),
  ]);
  const records = [original, equivalent, otherGame, otherDate];
  const before = structuredClone(records);
  render(<HistoryView records={records} zone="UTC" />);
  const entries = within(screen.getByRole('list', { name: 'Unlocked achievements' })).getAllByRole(
    'listitem',
  );
  expect(entries).toHaveLength(3);
  expect(within(entries[0]!).getByText('Another recorded unlock')).toBeVisible();
  expect(records).toEqual(before);
});
it('keeps partial confirmed unlocks separate from unresolved results and never claims skipped existing unlocks', () => {
  render(
    <HistoryView
      zone="UTC"
      records={[
        record('partial', [
          row({
            status: 'restored_with_different_date',
            actual_unlocked_at: '2026-10-10T17:32:00Z',
          }),
          row({ achievement_id: '2', name: 'Existing unlock', status: 'skipped_already_unlocked' }),
          row({
            achievement_id: '3',
            name: 'Failed unlock',
            status: 'failed',
            actual_unlocked_at: null,
          }),
          row({
            achievement_id: '4',
            name: 'Uncertain unlock',
            status: 'unconfirmed',
            actual_unlocked_at: '2026-10-10T17:30:00Z',
          }),
          row({
            achievement_id: '5',
            name: 'Untouched unlock',
            status: 'not_attempted',
            actual_unlocked_at: null,
          }),
        ]),
      ]}
    />,
  );
  expect(
    within(screen.getByRole('list', { name: 'Unlocked achievements' })).getAllByRole('listitem'),
  ).toHaveLength(1);
  expect(screen.getByText(formatTimestamp('2026-10-10T17:32:00Z', 'UTC'))).toBeVisible();
  expect(screen.getByText('Unlocked with a different date')).toBeVisible();
  expect(screen.queryByText('Existing unlock')).not.toBeInTheDocument();
  const attention = screen.getByRole('list', { name: 'Results needing attention' });
  expect(within(attention).getAllByRole('listitem')).toHaveLength(3);
  expect(within(attention).getByText('Request failed')).toBeVisible();
  expect(within(attention).getByText('Outcome uncertain')).toBeVisible();
  expect(within(attention).getByText('Not attempted')).toBeVisible();
  expect(
    within(attention).getAllByText(formatTimestamp('2026-10-10T17:30:00Z', 'UTC')),
  ).toHaveLength(3);
  expect(within(attention).getAllByText('Cyberpunk 2077')).toHaveLength(3);
});
it('preserves reportless unknown and interrupted attempts without inventing achievement unlocks', () => {
  const unknown = { ...record('unknown', []), state: 'unknown' as const, report: null };
  const interrupted = {
    ...record('running', [], { gameId: '2', title: 'The Witcher 3' }),
    state: 'running' as const,
    report: null,
  };
  render(<HistoryView records={[unknown, interrupted]} zone="Europe/London" />);
  expect(screen.queryByRole('list', { name: 'Unlocked achievements' })).not.toBeInTheDocument();
  expect(screen.getByText('No confirmed unlocks yet.')).toBeVisible();
  const attention = screen.getByRole('list', { name: 'Results needing attention' });
  expect(within(attention).getByText('Cyberpunk 2077')).toBeVisible();
  expect(within(attention).getByText('The Witcher 3')).toBeVisible();
  expect(within(attention).getByText('Outcome unknown')).toBeVisible();
  expect(within(attention).getByText('Operation interrupted')).toBeVisible();
  expect(
    within(attention).getAllByText(formatTimestamp('2026-10-14T10:00:00Z', 'Europe/London')),
  ).toHaveLength(2);
});
it('never infers a confirmed unlock from an unknown record or a preview, and surfaces missing actual dates', () => {
  const unknown = { ...record('unknown', [row()]), state: 'unknown' as const };
  const preview = record('preview', [row()]);
  preview.report!.dry_run = true;
  const malformed = record('missing-date', [
    row({ actual_unlocked_at: null, name: 'Date missing' }),
  ]);
  render(<HistoryView records={[unknown, preview, malformed]} zone="UTC" />);
  expect(screen.queryByRole('list', { name: 'Unlocked achievements' })).not.toBeInTheDocument();
  expect(screen.queryByText('The World')).not.toBeInTheDocument();
  expect(screen.getByText('Outcome unknown')).toBeVisible();
  expect(screen.getByText('Date missing')).toBeVisible();
  expect(screen.getByText('Unlock date unavailable')).toBeVisible();
});
it('shows a bounded loading state and an empty history without stale rows', () => {
  const view = render(<HistoryView records={[record('old', [row()])]} zone="UTC" loading />);
  expect(screen.getByRole('status', { name: 'Loading achievement history' })).toBeVisible();
  expect(screen.queryByText('The World')).not.toBeInTheDocument();
  expect(screen.queryByText('No achievement history yet.')).not.toBeInTheDocument();
  view.rerender(<HistoryView records={[]} zone="UTC" />);
  expect(screen.getByText('No achievement history yet.')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('shows confirmed locks with their previous dates, retaining uncertain null-date results for attention', () => {
  const lock: ReportItem = {
    achievement_id: '7',
    name: 'Confirmed lock',
    action: 'lock',
    requested_unlocked_at: null,
    previous_unlocked_at: '2020-01-01T12:34:56+0000',
    actual_unlocked_at: null,
    status: 'locked',
  };
  render(
    <HistoryView
      zone="UTC"
      records={[
        record('lock', [
          lock,
          { ...lock, achievement_id: '8', name: 'Uncertain lock', status: 'unconfirmed' },
          {
            ...lock,
            achievement_id: '9',
            name: 'Already locked',
            status: 'skipped_already_locked',
          },
        ]),
      ]}
    />,
  );
  expect(
    within(screen.getByRole('region', { name: 'Locked achievements' })).getByText('Confirmed lock'),
  ).toBeVisible();
  expect(screen.getByText(/Previous unlock:/)).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Needs attention' })).getByText(
      'Re-lock: Outcome uncertain',
    ),
  ).toBeVisible();
  expect(screen.queryByText('Already locked')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Unlocked achievements' })).not.toBeInTheDocument();
});
