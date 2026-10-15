// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Achievement, Report, ReportItem, UnlockReportItem } from '../../../src/shared/api';
import { ApplyDialog } from '../../../src/renderer/features/apply/ApplyDialog';
import { formatTimestamp } from '../../../src/renderer/date-time';

afterEach(cleanup);

function row(overrides: Partial<UnlockReportItem> = {}): UnlockReportItem {
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
    <ApplyDialog
      report={report}
      achievementFor={achievementFor}
      zone={zone}
      demo={false}
      busy={busy}
      onClose={onClose}
      onApply={onApply}
      onHistory={vi.fn()}
      onCheckCurrentState={vi.fn()}
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
  const dialog = screen.getByRole('dialog', { name: 'Apply changes to 2 achievements?' });
  expect(within(dialog).getByRole('heading', { name: 'The Witcher 3: Wild Hunt' })).toBeVisible();
  expect(within(dialog).queryByText('GOG account 123456789')).not.toBeInTheDocument();
  expect(within(dialog).getByRole('note', { name: 'Before applying' })).toHaveTextContent(
    'Close the game before applying.',
  );
  expect(within(dialog).queryByText('Unlock dates · local time')).not.toBeInTheDocument();
  const entries = within(
    within(dialog).getByRole('list', { name: 'Achievements to unlock' }),
  ).getAllByRole('listitem');
  expect(entries).toHaveLength(2);
  expect(within(entries[0]!).getByText('Passed the Trial')).toBeVisible();
  expect(within(entries[0]!).getByText('Complete the Trial of the Grasses.')).toBeVisible();
  expect(
    within(entries[0]!).getByText(formatTimestamp('2026-10-10T17:30:00Z', 'Europe/London')),
  ).toHaveAttribute('datetime', '2026-10-10T17:30:00Z');
  expect(entries[0]?.querySelector('img')).toHaveAttribute(
    'src',
    'https://images.gog-statics.com/trial.jpg',
  );
  expect(
    within(entries[1]!).getByText(formatTimestamp('2026-01-12T18:15:42Z', 'Europe/London')),
  ).toBeVisible();
  expect(within(dialog).queryByText(/Europe\/London|UTC[+-]/)).not.toBeInTheDocument();
  expect(within(entries[1]!).getByText('No description available.')).toBeVisible();
  expect(within(dialog).queryByText('Existing unlock')).not.toBeInTheDocument();
  expect(
    within(dialog).getByText('Achievements already in the requested state will be skipped.'),
  ).toBeVisible();
  expect(achievementFor).toHaveBeenCalledWith('2', '201');
  expect(onApply).not.toHaveBeenCalled();
});

it('keeps Cancel as the initial focus and closes without applying', async () => {
  const user = userEvent.setup();
  const { onClose, onApply } = confirmation();
  expect(screen.getByRole('dialog', { name: 'Apply changes to 1 achievement?' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledExactlyOnceWith();
  expect(onApply).not.toHaveBeenCalled();
});

it('submits only after the apply button is clicked', async () => {
  const user = userEvent.setup();
  const { onApply, onClose } = confirmation([row(), row({ achievement_id: '202' })]);
  expect(onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Apply changes' }));
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
    screen.getByText('All queued achievements already have the requested state.'),
  ).toBeVisible();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
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
  expect(
    within(entries[0]!).getByText(formatTimestamp('2020-11-01T05:30:00Z', 'America/New_York')),
  ).toHaveAttribute('datetime', '2020-11-01T05:30:00Z');
  expect(within(entries[0]!).getByText('First occurrence')).toBeVisible();
  expect(
    within(entries[1]!).getByText(formatTimestamp('2020-11-01T05:30:00Z', 'America/New_York')),
  ).toHaveAttribute('datetime', '2020-11-01T06:30:00Z');
  expect(within(entries[1]!).getByText('Second occurrence')).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByText(/UTC[+-]|America\/New_York/)).not.toBeInTheDocument();
});
it.each([false, true])(
  'shows each lock action without its previous date and uses a fixed apply label (mixed: %s)',
  (mixed) => {
    const lock: ReportItem = {
      achievement_id: '205',
      name: 'Earned achievement',
      action: 'lock',
      requested_unlocked_at: null,
      previous_unlocked_at: '2020-01-01T12:34:56+0000',
      actual_unlocked_at: '2020-01-01T12:34:56+0000',
      status: 'pending',
    };
    const { onApply } = confirmation(mixed ? [row(), lock] : [lock]);
    expect(
      screen.getByRole('list', {
        name: mixed ? 'Achievements to change' : 'Achievements to lock',
      }),
    ).toBeVisible();
    expect(screen.getByText('Lock', { exact: true })).toBeVisible();
    expect(screen.queryByText('Previous unlock', { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByText(formatTimestamp(lock.previous_unlocked_at, 'Europe/London')),
    ).not.toBeInTheDocument();
    expect(lock.previous_unlocked_at).toBe('2020-01-01T12:34:56+0000');
    expect(
      screen.getByRole('button', {
        name: 'Apply changes',
      }),
    ).toBeEnabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  },
);

it('keeps one dialog across review, progress and completion, with safe focus at each step', async () => {
  const report: Report = {
    dry_run: true,
    complete: true,
    user_id: '123456789',
    game: { id: '1', title: 'Cyberpunk 2077', client_id: '100001' },
    results: [row()],
  };
  const onClose = vi.fn();
  const onApply = vi.fn();
  const input = {
    report,
    zone: 'UTC',
    demo: true,
    busy: false,
    achievementFor: () => undefined,
    onClose,
    onApply,
    onHistory: vi.fn(),
    onCheckCurrentState: vi.fn(),
  };
  const { rerender } = render(<ApplyDialog {...input} />);
  const modal = screen.getByRole('dialog');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(onApply).toHaveBeenCalledTimes(1);
  rerender(<ApplyDialog {...input} report={null} applying busy gameTitle="Cyberpunk 2077" />);
  expect(screen.getByRole('dialog', { name: 'Applying changes…' })).toBe(modal);
  expect(modal).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
  const result = {
    operationId: 'sample',
    state: 'complete' as const,
    report: {
      ...report,
      dry_run: false,
      results: [row({ status: 'restored', actual_unlocked_at: row().requested_unlocked_at })],
    },
  };
  rerender(<ApplyDialog {...input} report={null} result={result} busy />);
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  rerender(<ApplyDialog {...input} report={null} result={result} />);
  expect(screen.getByRole('dialog', { name: 'Changes applied' })).toBe(modal);
  expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  expect(screen.getByText('1 unlocked')).toBeVisible();
  await userEvent.keyboard('{Enter}');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenCalledTimes(1);
});
