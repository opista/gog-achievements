// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Results } from '../../../src/renderer/features/apply/Results';
import { formatTimestamp } from '../../../src/renderer/date-time';
afterEach(cleanup);
it('confirms lock status without treating every missing date as a successful lock', () => {
  const row = {
    achievement_id: '7',
    name: 'Lock target',
    action: 'lock' as const,
    requested_unlocked_at: null,
    previous_unlocked_at: '2020-01-01T12:34:56+0000',
    actual_unlocked_at: null,
    status: 'locked' as const,
  };
  const result = {
    operationId: 'mixed',
    state: 'complete' as const,
    report: {
      dry_run: false,
      complete: false,
      user_id: '123456789',
      game: { id: '1', title: 'Game', client_id: '100001' },
      results: [
        row,
        { ...row, achievement_id: '8', name: 'Uncertain lock', status: 'unconfirmed' as const },
      ],
    },
  };
  const { container } = render(<Results result={result} zone="UTC" />);
  expect(screen.getByRole('heading', { name: 'Results need attention' })).toBeVisible();
  const rows = container.querySelectorAll('tbody tr');
  expect(rows[0]?.querySelector('td:last-child')).toHaveTextContent('Locked');
  expect(rows[1]?.querySelector('td:last-child')).toHaveTextContent('Not confirmed');
  expect(screen.getByText('Outcome uncertain')).toBeVisible();
});
it('does not claim requested dates were confirmed for skipped existing unlocks', () => {
  render(
    <Results
      zone="Europe/London"
      result={{
        operationId: 'sample',
        state: 'complete',
        report: {
          dry_run: false,
          complete: true,
          user_id: '123456789',
          game: { id: '1', title: 'Cyberpunk 2077', client_id: '100001' },
          results: [
            {
              achievement_id: '1',
              name: 'The World',
              requested_unlocked_at: '2026-10-10T17:30:00Z',
              previous_unlocked_at: null,
              actual_unlocked_at: '2026-10-10T17:30:00Z',
              status: 'restored',
            },
            {
              achievement_id: '5',
              name: 'Full Body Conversion',
              requested_unlocked_at: '2026-10-10T17:30:00Z',
              previous_unlocked_at: '2026-10-04T11:00:00Z',
              actual_unlocked_at: '2026-10-04T11:00:00Z',
              status: 'skipped_already_unlocked',
            },
          ],
        },
      }}
    />,
  );
  expect(
    screen.getByText('Achievements already in the requested state were skipped.'),
  ).toBeVisible();
  expect(screen.queryByText('All requested changes were confirmed.')).not.toBeInTheDocument();
  expect(screen.getByText(formatTimestamp('2026-10-04T11:00:00Z', 'Europe/London'))).toBeVisible();
  expect(screen.getByText('Already unlocked')).toBeVisible();
});

it('keeps immediate unknown apply feedback separate from the history feed', () => {
  render(
    <Results
      zone="UTC"
      result={{
        operationId: 'unknown',
        state: 'unknown',
        report: null,
        error: { code: 'INTERRUPTED', message: 'The write ended without a confirmed report.' },
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Could not confirm changes' })).toBeVisible();
  expect(
    screen.getByText(
      'Refresh achievements to check which are locked or unlocked before trying again.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/report|operation|current state|cannot prove/i),
  ).not.toBeInTheDocument();
});

it('shows useful result statuses without exposing server error codes', () => {
  render(
    <Results
      zone="UTC"
      result={{
        operationId: 'partial',
        state: 'complete',
        error: { code: 'APPLY_INCOMPLETE', message: 'Some achievements could not be confirmed.' },
        report: {
          dry_run: false,
          complete: false,
          user_id: '123456789',
          game: { id: '1', title: 'Cyberpunk 2077', client_id: '100001' },
          results: [
            {
              achievement_id: '1',
              name: 'The World',
              requested_unlocked_at: '2026-10-10T17:30:00Z',
              previous_unlocked_at: null,
              actual_unlocked_at: null,
              status: 'failed',
              error_code: 'API_INTERNAL_WRITE_REJECTED',
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Results need attention' })).toBeVisible();
  expect(screen.getByText('The World')).toBeVisible();
  expect(screen.getByText('Request failed')).toBeVisible();
  expect(screen.getByText('Not confirmed')).toBeVisible();
  expect(screen.getByText('Some achievements could not be confirmed.')).toBeVisible();
  expect(screen.queryByText('API_INTERNAL_WRITE_REJECTED')).not.toBeInTheDocument();
});
