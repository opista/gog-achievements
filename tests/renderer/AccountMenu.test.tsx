// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from '../../src/renderer/components/AccountMenu';

afterEach(cleanup);

async function menu({ busy = false } = {}) {
  const checkForUpdates = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <AccountMenu
      api={{ checkForUpdates }}
      auth={{ authenticated: false }}
      versions={{ app: '0.1.0', cli: '0.3.0' }}
      busy={busy}
      onLogout={vi.fn()}
    />,
  );
  await user.click(screen.getByLabelText('Account menu'));
  return { user, checkForUpdates };
}

it('offers an app update check without GOG sign-in', async () => {
  const { user, checkForUpdates } = await menu();
  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Account ID/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Check for updates…' }));
  expect(checkForUpdates).toHaveBeenCalledExactlyOnceWith();
});

it('shows progress in the menu and blocks repeated clicks until the check finishes', async () => {
  const { user, checkForUpdates } = await menu();
  let finish!: () => void;
  checkForUpdates.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  await user.click(screen.getByRole('button', { name: 'Check for updates…' }));
  const checking = screen.getByRole('button', { name: 'Checking…' });
  expect(checking).toBeDisabled();
  expect(checking).toHaveAttribute('aria-busy', 'true');
  await user.click(checking);
  expect(checkForUpdates).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Check for updates…' })).toBeEnabled();
});

it('keeps an update failure inside the menu and permits a clean retry', async () => {
  const { user, checkForUpdates } = await menu();
  checkForUpdates.mockRejectedValueOnce(new Error('Updates could not be checked. Try again.'));
  await user.click(screen.getByRole('button', { name: 'Check for updates…' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Updates could not be checked. Try again.');
  expect(screen.getByRole('alert').closest('.account-popover')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Check for updates…' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(checkForUpdates).toHaveBeenCalledTimes(2);
});

it('waits for active workspace operations before offering a check', async () => {
  const { user, checkForUpdates } = await menu({ busy: true });
  await user.click(screen.getByRole('button', { name: 'Check for updates…' }));
  expect(checkForUpdates).not.toHaveBeenCalled();
});
