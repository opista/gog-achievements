// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Achievement, Report, ReportItem } from '../../src/shared/api';
import { ApplyConfirmation } from '../../src/renderer/features/Review';

afterEach(cleanup);

function row(overrides: Partial<ReportItem> = {}): ReportItem {
  return {
    achievement_id: '201',
    name: 'Passed the Trial',
    requested_unlocked_at: '2026-10-10T17:30:00Z',
    previous_unlocked_at: null,
    actual_unlocked_at: null,
    status: 'pending',
    ...overrides,
  };
}
function confirmation(results: ReportItem[] = [row()], busy = false, zone = 'Europe/London') {
  const report: Report = {
    dry_run: true,
    complete: true,
    user_id: '123456789',
    game: { id: '2', title: 'The Witcher 3: Wild Hunt', client_id: '100002' },
    results,
  };
  const achievementFor = vi.fn((gameId: string, id: string): Achievement | undefined =>
    gameId === '2' && id === '201'
      ? {
          id,
          key: 'passed_the_trial',
          name: 'Passed the Trial',
          description: 'Complete the Trial of the Grasses.',
          hidden: false,
          unlocked: false,
          unlocked_at: null,
          image_locked: 'https://images.gog-statics.com/trial.jpg',
          image_unlocked: null,
          rarity: null,
        }
      : undefined,
  );
  const onClose = vi.fn();
  const onApply = vi.fn();
  render(
    <ApplyConfirmation
      report={report}
      achievementFor={achievementFor}
      zone={zone}
      demo={false}
      busy={busy}
      onClose={onClose}
      onApply={onApply}
    />,
  );
  return { onClose, onApply, achievementFor };
}

it('shows pending achievements with game-specific descriptions and exact local dates', () => {
  const { achievementFor, onApply } = confirmation([
    row(),
    row({
      achievement_id: '202',
      name: 'Lilac and Gooseberries',
      requested_unlocked_at: '2026-01-12T18:15:42Z',
    }),
    row({ achievement_id: '203', name: 'Existing unlock', status: 'skipped_already_unlocked' }),
  ]);
  const dialog = screen.getByRole('dialog', { name: 'Apply 2 achievements?' });
  expect(within(dialog).getByRole('heading', { name: 'The Witcher 3: Wild Hunt' })).toBeVisible();
  expect(within(dialog).getByText('GOG account 123456789')).toBeVisible();
  expect(within(dialog).getByText('Unlock dates · local time')).toBeVisible();
  const entries = within(
    within(dialog).getByRole('list', { name: 'Achievements to unlock' }),
  ).getAllByRole('listitem');
  expect(entries).toHaveLength(2);
  expect(within(entries[0]!).getByText('Passed the Trial')).toBeVisible();
  expect(within(entries[0]!).getByText('Complete the Trial of the Grasses.')).toBeVisible();
  expect(within(entries[0]!).getByText('10 Oct 2026 18:30:00')).toHaveAttribute(
    'datetime',
    '2026-10-10T17:30:00Z',
  );
  expect(entries[0]?.querySelector('img')).toHaveAttribute(
    'src',
    'https://images.gog-statics.com/trial.jpg',
  );
  expect(within(entries[1]!).getByText('12 Jan 2026 18:15:42')).toBeVisible();
  expect(within(dialog).queryByText(/Europe\/London|UTC[+-]/)).not.toBeInTheDocument();
  expect(within(entries[1]!).getByText('No description available.')).toBeVisible();
  expect(within(dialog).queryByText('Existing unlock')).not.toBeInTheDocument();
  expect(within(dialog).getByText('Already unlocked achievements keep their dates.')).toBeVisible();
  expect(achievementFor).toHaveBeenCalledWith('2', '201');
  expect(onApply).not.toHaveBeenCalled();
});

it('keeps Cancel as the initial focus and closes without applying', async () => {
  const user = userEvent.setup();
  const { onClose, onApply } = confirmation();
  expect(screen.getByRole('dialog', { name: 'Apply 1 achievement?' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply 1 achievement' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledExactlyOnceWith();
  expect(onApply).not.toHaveBeenCalled();
});

it('submits only after the apply button is clicked', async () => {
  const user = userEvent.setup();
  const { onApply, onClose } = confirmation([row(), row({ achievement_id: '202' })]);
  expect(onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Apply 2 achievements' }));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

it('blocks apply and closing while a write is active', async () => {
  const user = userEvent.setup();
  const { onClose, onApply } = confirmation([row()], true);
  for (const button of within(screen.getByRole('dialog')).getAllByRole('button'))
    expect(button).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
});

it('does not offer to apply achievements that are all already unlocked', () => {
  const { onApply } = confirmation([row({ status: 'skipped_already_unlocked' })]);
  expect(
    screen.getByText('All queued achievements are already unlocked. Existing dates are kept.'),
  ).toBeVisible();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply 0 achievements' })).toBeDisabled();
  expect(onApply).not.toHaveBeenCalled();
});

it('distinguishes repeated local times without restoring time zone settings', () => {
  confirmation(
    [
      row({ requested_unlocked_at: '2020-11-01T05:30:00Z' }),
      row({ achievement_id: '202', requested_unlocked_at: '2020-11-01T06:30:00Z' }),
    ],
    false,
    'America/New_York',
  );
  const entries = within(screen.getByRole('list', { name: 'Achievements to unlock' })).getAllByRole(
    'listitem',
  );
  expect(within(entries[0]!).getByText('01 Nov 2020 01:30:00')).toHaveAttribute(
    'datetime',
    '2020-11-01T05:30:00Z',
  );
  expect(within(entries[0]!).getByText('First occurrence')).toBeVisible();
  expect(within(entries[1]!).getByText('01 Nov 2020 01:30:00')).toHaveAttribute(
    'datetime',
    '2020-11-01T06:30:00Z',
  );
  expect(within(entries[1]!).getByText('Second occurrence')).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByText(/UTC[+-]|America\/New_York/)).not.toBeInTheDocument();
});
