// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ApplyResult, ReportItem } from '../../../src/shared/api';
import { Results } from '../../../src/renderer/features/apply/Results';
import { summarizeApplyResult } from '../../../src/renderer/features/apply/apply-model';
import { formatTimestamp } from '../../../src/renderer/date-time';

afterEach(cleanup);
const date = '2020-01-01T12:34:56Z';
const unlock: ReportItem = {
  achievement_id: '1',
  name: 'Unlocked target',
  requested_unlocked_at: date,
  previous_unlocked_at: null,
  actual_unlocked_at: date,
  status: 'restored',
};
const lock: ReportItem = {
  achievement_id: '2',
  name: 'Lock target',
  action: 'lock',
  requested_unlocked_at: null,
  previous_unlocked_at: date,
  actual_unlocked_at: null,
  status: 'locked',
};
function result(results: ReportItem[], complete = true): ApplyResult {
  return {
    operationId: 'sample',
    state: 'complete',
    report: {
      dry_run: false,
      complete,
      user_id: '123456789',
      game: { id: '1', title: 'Game', client_id: '100001' },
      results,
    },
  };
}
it('shows compact action counts without repeating successful rows or dates', () => {
  const input = result([unlock, lock]);
  render(<Results result={input} zone="UTC" />);
  expect(summarizeApplyResult(input).title).toBe('Changes applied');
  expect(screen.getByText('1 unlocked')).toBeVisible();
  expect(screen.getByText('1 locked')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('Unlocked target')).not.toBeInTheDocument();
  expect(screen.queryByText(formatTimestamp(date, 'UTC'))).not.toBeInTheDocument();
});
it('does not count an uncertain lock as successful just because its date is absent', () => {
  const input = result(
    [lock, { ...lock, achievement_id: '3', name: 'Uncertain lock', status: 'unconfirmed' }],
    false,
  );
  render(<Results result={input} zone="UTC" />);
  expect(summarizeApplyResult(input).title).toBe('Changes need attention');
  expect(screen.getByText('1 locked')).toBeVisible();
  expect(screen.getByText('1 needs attention')).toBeVisible();
  expect(screen.getByText('Outcome uncertain')).toBeVisible();
  expect(screen.getByText('Lock not confirmed')).toBeVisible();
});
it('distinguishes already correct achievements from new changes without implying their dates changed', () => {
  const input = result([
    { ...unlock, status: 'skipped_already_unlocked', actual_unlocked_at: '2019-01-01T00:00:00Z' },
    { ...lock, status: 'skipped_already_locked' },
  ]);
  render(<Results result={input} zone="UTC" />);
  expect(summarizeApplyResult(input).title).toBe('No changes needed');
  expect(screen.getByText('1 already unlocked')).toBeVisible();
  expect(screen.getByText('1 already locked')).toBeVisible();
  expect(screen.queryByText('1 unlocked', { exact: true })).not.toBeInTheDocument();
});
it.each(['unknown', 'preview', 'missing date', 'incomplete'] as const)(
  'does not claim success for %s results',
  (kind) => {
    const input = result([unlock]);
    if (kind === 'unknown') {
      input.state = 'unknown';
      input.report = null;
    }
    if (kind === 'preview') input.report!.dry_run = true;
    if (kind === 'missing date') input.report!.results = [{ ...unlock, actual_unlocked_at: null }];
    if (kind === 'incomplete') input.report!.complete = false;
    const summary = summarizeApplyResult(input);
    expect(summary.attention).toBe(true);
    expect(summary.title).not.toBe('Changes applied');
    if (kind !== 'incomplete') expect(summary.unlocked).toBe(0);
  },
);
it('shows requested and saved dates only when the unlock date differs', () => {
  const actual = '2020-01-01T12:36:56Z';
  const input = result([
    { ...unlock, status: 'restored_with_different_date', actual_unlocked_at: actual },
  ]);
  render(<Results result={input} zone="Europe/London" />);
  expect(summarizeApplyResult(input).attention).toBe(true);
  expect(screen.getByText('1 unlocked')).toBeVisible();
  expect(screen.getByText('Unlocked with a different date')).toBeVisible();
  expect(screen.getByText(formatTimestamp(date, 'Europe/London'))).toBeVisible();
  expect(screen.getByText(formatTimestamp(actual, 'Europe/London'))).toBeVisible();
  expect(screen.queryByText('1 needs attention')).not.toBeInTheDocument();
});
it('keeps uncertain outcome feedback and failed items free of internal error codes', () => {
  const input = result(
    [
      {
        ...unlock,
        status: 'failed',
        actual_unlocked_at: null,
        error_code: 'API_INTERNAL_WRITE_REJECTED',
      },
    ],
    false,
  );
  render(<Results result={input} zone="UTC" />);
  expect(screen.getByText('Request failed')).toBeVisible();
  expect(screen.getByText('Unlock not confirmed')).toBeVisible();
  expect(screen.queryByText('API_INTERNAL_WRITE_REJECTED')).not.toBeInTheDocument();
});
