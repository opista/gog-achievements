// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueDateModal } from '../../../src/renderer/features/queue/QueueDateModal';
import type { QueueItem } from '../../../src/shared/api';

const item: QueueItem = {
  achievement_id: '1',
  key: 'THE_WORLD',
  name: 'The World',
  unlocked_at: '2020-07-01T12:34:56Z',
};
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z')));
afterEach(cleanup);

function modal(zone = 'UTC', value = item) {
  const onSave = vi.fn<(iso: string) => Promise<boolean>>().mockResolvedValue(true);
  const onClose = vi.fn();
  const props = {
    item: value,
    description: 'An earned achievement.',
    zone,
    busy: false,
    onSave,
    onClose,
  };
  const view = render(<QueueDateModal {...props} />);
  const input = screen.getByLabelText(`Unlock date for ${value.name}`) as HTMLInputElement;
  return { ...view, props, onSave, onClose, input };
}

it('opens one native second-precision date field with the saved instant and description', () => {
  const { input, onSave } = modal();
  expect(screen.getByRole('dialog', { name: 'Edit unlock date' })).toBeVisible();
  expect(screen.getByText('The World')).toBeVisible();
  expect(screen.getByText('An earned achievement.')).toBeVisible();
  expect(input).toHaveAttribute('type', 'datetime-local');
  expect(input).toHaveAttribute('step', '1');
  expect(input).toHaveValue('2020-07-01T12:34:56');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Save date' })).toBeDisabled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

it('keeps edits local through blur and Enter until Save date is explicitly selected', async () => {
  const user = userEvent.setup();
  const { input, onSave, onClose } = modal();
  await user.click(input);
  fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
  fireEvent.blur(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSave).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save date' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('2020-08-02T13:14:15Z');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('normalizes minute-only native values and preserves the saved instant on zone changes', async () => {
  const user = userEvent.setup();
  const { input, props, rerender, onSave } = modal();
  fireEvent.change(input, { target: { value: '2020-08-02T13:14' } });
  await user.click(screen.getByRole('button', { name: 'Save date' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('2020-08-02T13:14:00Z');
  rerender(<QueueDateModal {...props} zone="Europe/London" />);
  expect(screen.getByLabelText('Unlock date for The World')).toHaveValue('2020-07-01T13:34:56');
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('uses the time at the button click and saves it at second precision', async () => {
  const user = userEvent.setup();
  const { onSave, onClose } = modal();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-14T20:22:33.987Z'));
  await user.click(screen.getByRole('button', { name: 'Use current time' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('2026-10-14T20:22:33Z');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each(['Cancel', 'Escape'] as const)(
  '%s discards a changed date without a write',
  async (action) => {
    const user = userEvent.setup();
    const { input, onSave, onClose } = modal();
    await user.click(input);
    fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
    if (action === 'Cancel') await user.click(screen.getByRole('button', { name: 'Cancel' }));
    else await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  },
);

it('blocks incomplete, future and nonexistent wall times without changing the saved date', () => {
  const { input, onSave } = modal('Europe/London');
  for (const [value, message] of [
    ['', /valid date and time/],
    ['2040-08-02T13:14:15', /future/],
    ['2026-03-29T01:30:00', /does not exist/],
  ] as const) {
    fireEvent.change(input, { target: { value } });
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save date' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use current time' })).toBeEnabled();
  }
  expect(onSave).not.toHaveBeenCalled();
});

it.each([
  ['3600', '2026-10-25T00:30:15Z'],
  ['0', '2026-10-25T01:30:15Z'],
])(
  'requires explicit UTC offset %s and Save date for a repeated wall time',
  async (offset, iso) => {
    const user = userEvent.setup();
    const { input, onSave } = modal('Europe/London');
    fireEvent.change(input, { target: { value: '2026-10-25T01:30:15' } });
    expect(screen.getByRole('status')).toHaveTextContent(/occurs twice/);
    const select = screen.getByRole('combobox', { name: 'Repeated time for The World' });
    expect(screen.getByRole('option', { name: 'First time (UTC+01:00)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Second time (UTC+00:00)' })).toBeInTheDocument();
    expect(select).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save date' })).toBeDisabled();
    await user.selectOptions(select, offset);
    expect(onSave).not.toHaveBeenCalled();
    expect(select).toHaveValue(offset);
    await user.click(screen.getByRole('button', { name: 'Save date' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith(iso);
  },
);

it('keeps a saved ambiguous instant without guessing an offset for a new edit', () => {
  const saved = { ...item, unlocked_at: '2026-10-25T01:30:00Z' };
  const { input, onSave } = modal('Europe/London', saved);
  fireEvent.change(input, { target: { value: '2026-10-25T01:30' } });
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save date' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '2026-10-25T01:30:01' } });
  expect(screen.getByRole('combobox')).toHaveValue('');
  expect(onSave).not.toHaveBeenCalled();
});

it.each(['false', 'rejected'] as const)(
  'keeps a %s save available for explicit retry',
  async (failure) => {
    const user = userEvent.setup();
    const { input, onSave, onClose } = modal();
    if (failure === 'false') onSave.mockResolvedValueOnce(false);
    else onSave.mockRejectedValueOnce(new Error('Fixture save failure'));
    fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
    await user.click(screen.getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not be saved/));
    expect(input).toHaveValue('2020-08-02T13:14:15');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save date' }));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

it('serializes a pending save and prevents cancellation until it completes', async () => {
  const user = userEvent.setup();
  const { input, onSave, onClose } = modal();
  let finish!: (saved: boolean) => void;
  onSave.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
  const save = screen.getByRole('button', { name: 'Save date' });
  await user.click(save);
  fireEvent.click(save);
  await user.keyboard('{Escape}');
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  expect(input).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saving date');
  await act(async () => finish(true));
  expect(onClose).toHaveBeenCalledTimes(1);
});
