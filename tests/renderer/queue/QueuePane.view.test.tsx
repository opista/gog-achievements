// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';
import type { Queue } from '../../../src/shared/api';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueuePane } from '../../../src/renderer/features/queue/QueuePane';
import { achievement, DATE, OTHER_USER, queue } from './fixtures';

afterEach(cleanup);

function props() {
  return {
    signedIn: true,
    queues: [queue(), queue('2')],
    loaded: true,
    busy: false,
    action: null,
    previewGameId: null,
    applyStatus: 'idle',
    achievementFor: () => achievement('1'),
    onRefresh: vi.fn(),
    onRemove: vi.fn(),
    onSaveDates: vi.fn().mockResolvedValue(true),
    onPrepareApply: vi.fn(),
    zone: 'America/New_York',
    demo: true,
    onResize: vi.fn(),
  } satisfies ComponentProps<typeof QueuePane>;
}

it('renders no queue or account data when signed out', () => {
  const { container } = render(<QueuePane {...props()} signedIn={false} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows loading, retry and empty states through its view inputs', async () => {
  const input = props();
  const { rerender } = render(<QueuePane {...input} loaded={false} busy />);
  expect(screen.getByRole('status', { name: 'Loading queue' })).toBeVisible();
  expect(screen.queryByText('Queue is empty.')).not.toBeInTheDocument();
  rerender(<QueuePane {...input} loaded={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Retry queue' }));
  expect(input.onRefresh).toHaveBeenCalledTimes(1);
  rerender(<QueuePane {...input} queues={[]} />);
  expect(screen.getByText('Queue is empty.')).toBeVisible();
  expect(screen.getByText('Use the buttons beside achievements to add them here.')).toBeVisible();
});

it('sends remove and preview actions for the chosen game without a workspace or API', async () => {
  const input = props();
  render(<QueuePane {...input} />);
  const second = screen.getByRole('region', { name: 'Queue for Sample game 2' });
  await userEvent.click(
    within(second).getByRole('button', { name: 'Remove Achievement 1 from queue' }),
  );
  expect(input.onRemove).toHaveBeenCalledExactlyOnceWith('2', ['1']);
  await userEvent.click(
    within(second).getByRole('button', { name: 'Review changes for Sample game 2' }),
  );
  expect(input.onPrepareApply).toHaveBeenCalledExactlyOnceWith('2');
  expect(screen.getByText('2 achievements · 2 games')).toBeVisible();
});

it('groups saved actions and keeps keyboard removal in the visible group order', async () => {
  const input = props();
  const mixed: Queue = {
    ...queue(),
    items: [
      {
        achievement_id: '1',
        key: 'key-1',
        name: 'Re-lock one',
        action: 'lock',
        previous_unlocked_at: DATE,
      },
      {
        achievement_id: '2',
        key: 'key-2',
        name: 'Unlock two',
        action: 'unlock',
        unlocked_at: DATE,
      },
      {
        achievement_id: '3',
        key: 'key-3',
        name: 'Re-lock three',
        action: 'lock',
        previous_unlocked_at: DATE,
      },
      { achievement_id: '4', key: 'key-4', name: 'Legacy unlock four', unlocked_at: DATE },
    ],
  };
  const { rerender } = render(<QueuePane {...input} queues={[mixed]} />);
  const unlocks = screen.getByRole('region', { name: 'Unlock requests for Sample game 1' });
  const relocks = screen.getByRole('region', { name: 'Re-lock requests for Sample game 1' });
  expect(within(unlocks).getAllByRole('button', { name: /^Edit date/ })).toHaveLength(2);
  expect(within(relocks).queryByRole('button', { name: /^Edit date/ })).not.toBeInTheDocument();
  expect(
    screen
      .getAllByRole('button', { name: /^Remove/ })
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual([
    'Remove Unlock two from queue',
    'Remove Legacy unlock four from queue',
    'Remove Re-lock one from queue',
    'Remove Re-lock three from queue',
  ]);
  screen.getByRole('button', { name: 'Remove Unlock two from queue' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(input.onRemove).toHaveBeenCalledExactlyOnceWith('1', ['2']);
  rerender(
    <QueuePane
      {...input}
      queues={[{ ...mixed, items: mixed.items.filter((item) => item.achievement_id !== '2') }]}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Remove Legacy unlock four from queue' }),
  ).toHaveFocus();
});

it('saves the modal date for its queue without requesting an apply', async () => {
  const input = props();
  render(<QueuePane {...input} />);
  const second = screen.getByRole('region', { name: 'Queue for Sample game 2' });
  await userEvent.click(
    within(second).getByRole('button', { name: 'Edit date for Achievement 1' }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Edit unlock date' });
  fireEvent.change(within(dialog).getByLabelText('Unlock date for Achievement 1'), {
    target: { value: '2020-03-03T10:11:12' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save date' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(input.onSaveDates).toHaveBeenCalledExactlyOnceWith('2', { '1': '2020-03-03T15:11:12Z' });
  expect(input.onPrepareApply).not.toHaveBeenCalled();
});

it.each(['cleared', 'another owner'] as const)(
  'hides an open date editor when its queue is %s',
  async (change) => {
    const input = props();
    const { rerender } = render(<QueuePane {...input} />);
    const first = screen.getByRole('region', { name: 'Queue for Sample game 1' });
    await userEvent.click(
      within(first).getByRole('button', { name: 'Edit date for Achievement 1' }),
    );
    expect(screen.getByRole('dialog', { name: 'Edit unlock date' })).toBeVisible();
    rerender(
      <QueuePane {...input} queues={change === 'cleared' ? [] : [queue('1', OTHER_USER)]} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input.onSaveDates).not.toHaveBeenCalled();
  },
);

it.each([
  ['applying', 'Applying changes. Keep the app open until the result is available.'],
  ['recovery', 'Checking previous changes. Please keep the app open.'],
] as const)('shows the %s state while queue controls are locked', (status, message) => {
  render(<QueuePane {...props()} applyStatus={status} busy />);
  expect(screen.getByText(message)).toBeVisible();
  for (const button of screen.getAllByRole('button', { name: /^(Edit date|Remove|Apply changes)/ }))
    expect(button).toBeDisabled();
});
