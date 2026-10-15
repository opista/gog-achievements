// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueuePane } from '../../../src/renderer/features/queue/QueuePane';
import { achievement, OTHER_USER, queue } from './fixtures';

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
  expect(screen.getByText('Use + beside an achievement to add it here.')).toBeVisible();
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
    within(second).getByRole('button', { name: 'Apply changes for Sample game 2' }),
  );
  expect(input.onPrepareApply).toHaveBeenCalledExactlyOnceWith('2');
  expect(screen.getByText('2 achievements · 2 games')).toBeVisible();
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
