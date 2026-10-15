// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '../../src/renderer/components/Dialog';

afterEach(cleanup);

function TestDialog({ busy, onClose }: { busy: boolean; onClose(): void }) {
  return (
    <>
      <button>Outside dialog</button>
      <Dialog
        title="Test dialog"
        busy={busy}
        onClose={onClose}
        footer={
          <>
            <button data-initial-focus disabled={busy}>
              Cancel
            </button>
            <button disabled={busy}>Save</button>
          </>
        }
      >
        <p>Dialog content</p>
      </Dialog>
    </>
  );
}

it('wraps keyboard focus between the first and last dialog controls', async () => {
  const user = userEvent.setup();
  render(<TestDialog busy={false} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  screen.getByRole('button', { name: 'Save' }).focus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Close Test dialog' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
});

it('keeps focus inside while saving disables every control', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const { rerender } = render(<TestDialog busy={false} onClose={onClose} />);
  screen.getByRole('button', { name: 'Save' }).focus();
  rerender(<TestDialog busy onClose={onClose} />);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveFocus();
  await user.tab();
  expect(dialog).toHaveFocus();
  await user.tab({ shift: true });
  expect(dialog).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
  rerender(<TestDialog busy={false} onClose={onClose} />);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Close Test dialog' })).toHaveFocus();
});

it('focuses the dialog when it opens without an enabled control', async () => {
  const user = userEvent.setup();
  render(<TestDialog busy onClose={vi.fn()} />);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveFocus();
  await user.tab({ shift: true });
  expect(dialog).toHaveFocus();
});
