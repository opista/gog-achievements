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
} = {}) {
  const checkForUpdates = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const onLogout = vi.fn();
  let state: CliUpdateState = {
    supported,
    automatic: supported,
    currentVersion,
    bundledVersion: '0.5.1',
    status: 'idle',
    message: 'The CLI is up to date.',
  };
  const getCliUpdateState = vi.fn(async () => state);
  const setAutomaticCliUpdates = vi.fn(async ({ enabled }: { enabled: boolean }) => {
    state = { ...state, automatic: enabled };
    return state;
  });
  const useBundledCli = vi.fn(async () => {
    state = {
      ...state,
      automatic: false,
      pendingVersion: '0.5.1',
      status: 'ready',
      message: 'The bundled CLI 0.5.1 will be used next time you open the app.',
    };
    return state;
  });
  const user = userEvent.setup();
  render(
    <>
      <button>Before account</button>
      <AccountMenu
        api={{ checkForUpdates, getCliUpdateState, setAutomaticCliUpdates, useBundledCli }}
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
    setAutomaticCliUpdates,
    useBundledCli,
  };
}

it('offers an app update check without GOG sign-in', async () => {
  const { user, checkForUpdates } = await menu();
  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Account ID/)).not.toBeInTheDocument();
  expect(screen.getByText('App 0.1.0')).toBeVisible();
  expect(screen.getByText('CLI 0.5.1')).toBeVisible();
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

it('closes on Escape and returns focus to the account button', async () => {
  const { user } = await menu();
  const summary = screen.getByLabelText('Account menu');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Check for updates…' })).toHaveFocus();
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
  await user.tab();
  expect(screen.getByRole('button', { name: 'After account' })).toHaveFocus();
  expect(screen.getByLabelText('Account menu').closest('details')).not.toHaveAttribute('open');
});

it('explains and persists automatic component updates without requiring sign-in', async () => {
  const { user, setAutomaticCliUpdates } = await menu();
  const toggle = screen.getByRole('checkbox', { name: 'Automatic component updates' });
  expect(toggle).toBeChecked();
  expect(toggle).toHaveAccessibleDescription(
    'The app automatically updates the tools it uses to connect to GOG.',
  );
  await user.click(toggle);
  expect(setAutomaticCliUpdates).toHaveBeenCalledExactlyOnceWith({ enabled: false });
  expect(toggle).not.toBeChecked();
});

it('keeps the saved setting when a preference write fails', async () => {
  const { user, setAutomaticCliUpdates } = await menu();
  setAutomaticCliUpdates.mockRejectedValueOnce(new Error('Update settings could not be saved.'));
  const toggle = screen.getByRole('checkbox', { name: 'Automatic component updates' });
  await user.click(toggle);
  expect(toggle).toBeChecked();
  expect(screen.getByRole('alert')).toHaveTextContent('Update settings could not be saved.');
});

it('offers a fallback for a downloaded CLI and reports that restart is required', async () => {
  const { user, useBundledCli } = await menu({ currentVersion: '0.6.0' });
  await user.click(screen.getByRole('button', { name: 'Use bundled version next launch' }));
  expect(useBundledCli).toHaveBeenCalledExactlyOnceWith();
  expect(screen.getByRole('status')).toHaveTextContent('will be used next time you open the app');
  expect(screen.getByText('CLI 0.6.0')).toBeVisible();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it('disables the setting in source and demo builds', async () => {
  await menu({ supported: false });
  expect(screen.getByRole('checkbox', { name: 'Automatic component updates' })).toBeDisabled();
});

it('closes after sign-out and keeps focus on the account button', async () => {
  const { user, onLogout } = await menu({ authenticated: true });
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(onLogout).toHaveBeenCalledOnce();
  const summary = screen.getByLabelText('Account menu');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(summary).toHaveFocus();
});
