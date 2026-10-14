// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Results } from '../../src/renderer/features/Results';
import { formatTimestamp } from '../../src/renderer/date-time';
afterEach(cleanup);
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
    screen.getByText('Restorations confirmed. Existing unlocks kept their dates.'),
  ).toBeVisible();
  expect(
    screen.queryByText('All requested unlocks and dates were confirmed.'),
  ).not.toBeInTheDocument();
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
  expect(screen.getByRole('heading', { name: 'Outcome unknown' })).toBeVisible();
  expect(screen.getByText('The write ended without a confirmed report.')).toBeVisible();
  expect(screen.getByText(/cannot prove which operation caused an unlock/)).toBeVisible();
});
