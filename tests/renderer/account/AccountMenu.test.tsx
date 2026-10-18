// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from '../../../src/renderer/features/account/AccountMenu';
import type { CliUpdateState } from '../../../src/shared/cli-updates';

afterEach(cleanup);

async function menu({
  busy = false,
  authenticated = false,
  currentVersion = '0.5.1',
  supported = true,
  status = 'idle' as CliUpdateState['status'],
  pendingVersion = undefined as string | undefined,
  message = 'The CLI is up to date.',
} = {}) {
  const checkForUpdates = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const onLogout = vi.fn();
  const state: CliUpdateState = {
    supported,
    currentVersion,
    bundledVersion: '0.5.1',
    status,
    pendingVersion,
    message,
  };
  const getCliUpdateState = vi.fn(async () => state);
  const user = userEvent.setup();
  render(
    <>
      <button>Before account</button>
      <AccountMenu
        api={{ checkForUpdates, getCliUpdateState }}
        auth={{ authenticated, user_id: authenticated ? '1' : undefined }}
        versions={{ app: '0.1.0', cli: '0.3.0' }}
        busy={busy}
        onLogout={onLogout}
      />
      <button>After account</button>
    </>,
  );
  await user.click(screen.getByLabelText('Account menu'));
  await waitFor(() => expect(getCliUpdateState).toHaveBeenCalled());
  return {
    user,
    checkForUpdates,
    onLogout,
    getCliUpdateState,
    state,
  };
}

it('offers an app update check without GOG sign-in', async () => {
  const { user, checkForUpdates } = await menu();
  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Account ID/)).not.toBeInTheDocument();
  expect(screen.getByText('App 0.1.0')).toBeVisible();
  expect(screen.getByText('CLI 0.5.1')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(checkForUpdates).toHaveBeenCalledExactlyOnceWith();
});

it('shows progress in the menu and blocks repeated clicks until the check finishes', async () => {
  const { user, checkForUpdates } = await menu();
  let finish!: () => void;
  checkForUpdates.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  await user.click(screen.getByRole('button', { name: 'Check for updates' }));
  const checking = screen.getByRole('button', { name: 'Checking…' });
  expect(checking).toBeDisabled();
  expect(checking).toHaveAttribute('aria-busy', 'true');
  await user.click(checking);
  expect(checkForUpdates).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});

it('keeps an update failure inside the menu and permits a clean retry', async () => {
  const { user, checkForUpdates } = await menu();
  checkForUpdates.mockRejectedValueOnce(new Error('Updates could not be checked. Try again.'));
  await user.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Updates could not be checked. Try again.');
  expect(screen.getByRole('alert').closest('.account-popover')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(checkForUpdates).toHaveBeenCalledTimes(2);
});

it('waits for active workspace operations before offering a check', async () => {
  const { user, checkForUpdates } = await menu({ busy: true });
  await user.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(checkForUpdates).not.toHaveBeenCalled();
});

it('closes on Escape and returns focus to the account button', async () => {
  const { user } = await menu();
  const summary = screen.getByLabelText('Account menu');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Check for updates' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(summary).toHaveFocus();
});

it('closes after an outside click without taking focus from the clicked control', async () => {
  const { user } = await menu();
  const outside = screen.getByRole('button', { name: 'After account' });
  await user.click(outside);
  expect(screen.getByLabelText('Account menu').closest('details')).not.toHaveAttribute('open');
  expect(outside).toHaveFocus();
});

it('closes when keyboard focus moves outside the menu', async () => {
  const { user } = await menu();
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After account' })).toHaveFocus();
  expect(screen.getByLabelText('Account menu').closest('details')).not.toHaveAttribute('open');
});

it('shows the active CLI version without update settings or a progress indicator while idle', async () => {
  await menu();
  expect(screen.getByText('CLI 0.5.1')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /bundled/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it.each(['checking', 'downloading'] as const)(
  'shows an accessible spinner beside the current version while %s in the background',
  async (status) => {
    const message = status === 'checking' ? 'Checking for CLI updates…' : 'Downloading CLI 0.6.0…';
    await menu({ status, message });
    const progress = screen.getByRole('status');
    expect(progress).toHaveTextContent(message);
    expect(progress.querySelector('.spinner')).not.toBeNull();
    expect(progress.parentElement).toContainElement(screen.getByText('CLI 0.5.1'));
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  },
);

it('reports pending activation beside the version without changing the running CLI label', async () => {
  await menu({ status: 'ready', pendingVersion: '0.6.0' });
  expect(screen.getByText('CLI 0.5.1')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('0.6.0 ready · next launch');
  expect(screen.queryByText('CLI 0.6.0')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')?.querySelector('.spinner')).toBeNull();
});

it('refreshes background progress only while the menu is open', async () => {
  const { user, getCliUpdateState, state } = await menu();
  getCliUpdateState.mockResolvedValue({ ...state, status: 'downloading', message: 'Downloading…' });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Downloading…'), {
    timeout: 3000,
  });
  await user.keyboard('{Escape}');
  getCliUpdateState.mockClear();
  await act(() => new Promise((resolve) => setTimeout(resolve, 2100)));
  expect(getCliUpdateState).not.toHaveBeenCalled();
});

it.each(['fallback', 'unavailable'] as const)(
  'shows %s details without blocking the menu',
  async (status) => {
    const message = 'The current version will stay in use.';
    await menu({ status, message });
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  },
);

it('shows the CLI version in source and demo builds without an update setting', async () => {
  await menu({ supported: false });
  expect(screen.getByText('CLI 0.5.1')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('closes after sign-out and keeps focus on the account button', async () => {
  const { user, onLogout } = await menu({ authenticated: true });
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(onLogout).toHaveBeenCalledOnce();
  const summary = screen.getByLabelText('Account menu');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(summary).toHaveFocus();
});
