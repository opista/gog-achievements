// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueDatePicker } from '../../src/renderer/features/QueueDatePicker';
import type { QueueItem } from '../../src/shared/api';

const item: QueueItem = {
  achievement_id: '1',
  key: 'THE_WORLD',
  name: 'The World',
  unlocked_at: '2020-07-01T12:34:56Z',
};
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z')));
afterEach(cleanup);

function picker(zone = 'UTC', value = item) {
  const onSave = vi.fn<(iso: string) => Promise<boolean>>().mockResolvedValue(true);
  const view = render(<QueueDatePicker item={value} zone={zone} busy={false} onSave={onSave} />);
  const input = screen.getByLabelText(`Unlock date for ${value.name}`) as HTMLInputElement;
  return { ...view, onSave, input };
}

it('uses a native second-precision field and preserves the saved instant when the zone changes', () => {
  const { input, onSave, rerender } = picker();
  expect(input).toHaveAttribute('type', 'datetime-local');
  expect(input).toHaveAttribute('step', '1');
  expect(input).toHaveValue('2020-07-01T12:34:56');
  fireEvent.change(input, { target: { value: '2020-08-01T13:20:15' } });
  rerender(<QueueDatePicker item={item} zone="Europe/London" busy={false} onSave={onSave} />);
  expect(screen.getByLabelText('Unlock date for The World')).toHaveValue('2020-07-01T13:34:56');
  expect(onSave).not.toHaveBeenCalled();
});

it('saves a changed complete date on blur without changing its seconds or resaving unchanged values', async () => {
  const user = userEvent.setup();
  const { input, onSave } = picker();
  await user.click(input);
  await user.tab();
  expect(onSave).not.toHaveBeenCalled();
  await user.click(input);
  fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
  await user.tab();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('2020-08-02T13:14:15Z');
  await user.click(input);
  await user.tab();
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('normalizes native minute-only values to explicit zero seconds', async () => {
  const { input, onSave } = picker();
  fireEvent.change(input, { target: { value: '2020-08-02T13:14' } });
  fireEvent.blur(input);
  await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith('2020-08-02T13:14:00Z'));
});

it('saves on Enter once and shows only local pending status while the field is saving', async () => {
  const user = userEvent.setup();
  const { input, onSave } = picker();
  let finish!: (saved: boolean) => void;
  onSave.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(input);
  fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
  await user.keyboard('{Enter}');
  fireEvent.blur(input);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(input).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saving');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => finish(true));
  expect(input).toBeEnabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
});

it('restores the saved value on Escape without sending the discarded edit', async () => {
  const user = userEvent.setup();
  const { input, onSave } = picker();
  await user.click(input);
  fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
  await user.keyboard('{Escape}');
  expect(input).toHaveValue('2020-07-01T12:34:56');
  await user.tab();
  expect(onSave).not.toHaveBeenCalled();
});

it('keeps incomplete, future and nonexistent wall times local with an inline error', () => {
  const { input, onSave } = picker('Europe/London');
  for (const [value, message] of [
    ['', /valid date and time/],
    ['2040-08-02T13:14:15', /future/],
    ['2026-03-29T01:30:00', /does not exist/],
  ] as const) {
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  }
  expect(onSave).not.toHaveBeenCalled();
});

it.each([
  ['3600', '2026-10-25T00:30:15Z'],
  ['0', '2026-10-25T01:30:15Z'],
])('requires the chosen UTC offset %s before saving a repeated wall time', async (offset, iso) => {
  const user = userEvent.setup();
  const { input, onSave } = picker('Europe/London');
  fireEvent.change(input, { target: { value: '2026-10-25T01:30:15' } });
  fireEvent.blur(input);
  expect(screen.getByRole('status')).toHaveTextContent(/occurs twice/);
  const select = screen.getByRole('combobox', { name: 'UTC offset for The World' });
  expect(select).toHaveValue('');
  expect(onSave).not.toHaveBeenCalled();
  await user.selectOptions(select, offset);
  await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(iso));
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
});

it('preserves an already saved ambiguous instant but never reuses its offset for a new edit', async () => {
  const user = userEvent.setup();
  const saved = { ...item, unlocked_at: '2026-10-25T01:30:15Z' };
  const { input, onSave } = picker('Europe/London', saved);
  expect(input).toHaveValue('2026-10-25T01:30:15');
  fireEvent.blur(input);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
  await user.click(input);
  fireEvent.change(input, { target: { value: '2026-10-25T01:30:16' } });
  expect(screen.getByRole('combobox')).toHaveValue('');
  await user.keyboard('{Escape}');
  expect(input).toHaveValue('2026-10-25T01:30:15');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it.each(['false', 'rejected'] as const)(
  'keeps a %s save available for explicit retry',
  async (failure) => {
    const user = userEvent.setup();
    const { input, onSave } = picker();
    if (failure === 'false') onSave.mockResolvedValueOnce(false);
    else onSave.mockRejectedValueOnce(new Error('Fixture save failure'));
    await user.click(input);
    fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not be saved/));
    expect(input).toHaveValue('2020-08-02T13:14:15');
    await user.click(input);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(onSave).toHaveBeenCalledTimes(2);
  },
);

it('prevents edits and saves while the surrounding operation is busy', () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(<QueueDatePicker item={item} zone="UTC" busy onSave={onSave} />);
  const input = screen.getByLabelText('Unlock date for The World');
  expect(input).toBeDisabled();
  fireEvent.change(input, { target: { value: '2020-08-02T13:14:15' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.blur(input);
  expect(onSave).not.toHaveBeenCalled();
});

it('recognizes an unchanged ambiguous time when the native input omits zero seconds', () => {
  const saved = { ...item, unlocked_at: '2026-10-25T01:30:00Z' };
  const { input, onSave } = picker('Europe/London', saved);
  fireEvent.change(input, { target: { value: '2026-10-25T01:30' } });
  fireEvent.blur(input);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});
