// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import type { OperationState } from '../../src/shared/api';
import { App } from '../../src/renderer/App';
import { createDemoApi, type DemoDesktopApi, type DemoScenario } from '../../src/shared/demo-api';

afterEach(cleanup);
async function connected(scenario: DemoScenario = 'complete') {
  const api = createDemoApi({ delayMs: 0, scenario });
  const user = userEvent.setup();
  render(<App api={api} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in to GOG' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Sign in to GOG' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeEnabled(),
  );
  return { api, user };
}
async function previewAndConfirm(api: DemoDesktopApi, user: ReturnType<typeof userEvent.setup>) {
  const apply = vi.spyOn(api, 'apply');
  await user.click(screen.getByRole('button', { name: 'Preview changes' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue to apply' })).toBeEnabled(),
  );
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Continue to apply' }));
  return apply;
}

describe('desktop restoration flow', () => {
  it('keeps account ID in its menu and removes the shared-login warning', async () => {
    const { user } = await connected();
    expect(screen.getByText('GOG account', { exact: true })).toBeVisible();
    expect(
      screen.queryByText("Signing out also removes the CLI's saved login."),
    ).not.toBeInTheDocument();
    await user.click(screen.getByText('GOG account', { exact: true }));
    expect(screen.getByText('Account ID: 123456789')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
  it('starts signed out with explicit demo data and protects existing unlocks', async () => {
    const { user } = await connected();
    expect(screen.getByText('DEMO DATA')).toBeVisible();
    expect(
      screen.queryByRole('checkbox', { name: 'Select Full Body Conversion' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    expect(screen.queryByText('A sample hidden achievement')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByRole('heading', { name: 'A sample hidden achievement' })).toBeVisible();
    expect(
      screen.getByRole('checkbox', { name: 'Select A sample hidden achievement' }),
    ).toBeEnabled();
  });
  it('never writes on preview or dismissed final confirmation', async () => {
    const { api, user } = await connected();
    const apply = await previewAndConfirm(api, user);
    const dialog = screen.getByRole('dialog', { name: 'Apply 3 achievements?' });
    expect(within(dialog).getByRole('button', { name: 'Back to preview' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue to apply' }));
    await user.click(screen.getByRole('button', { name: 'Apply 3 achievements' }));
    await screen.findByRole('heading', { name: 'Results confirmed' });
    expect(apply).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'History' })).toBeEnabled());
    expect(screen.getByText('Queue is clear. Results are saved in history.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back to achievements' }));
    expect(
      screen.queryByRole('button', { name: 'Edit date for The World' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled();
  });
  it('date editing saves the queue without applying and prevents future dates', async () => {
    const { api, user } = await connected();
    const apply = vi.spyOn(api, 'apply');
    const setDates = vi.spyOn(api, 'setDates');
    await user.click(screen.getByRole('button', { name: 'Edit date for The World' }));
    const dialog = screen.getByRole('dialog', { name: 'Queue dates' });
    const date = within(dialog).getByLabelText('Unlock date for The World');
    await user.clear(date);
    await user.type(date, '2099-01-01');
    expect(within(dialog).getByRole('button', { name: 'Save dates' })).toBeDisabled();
    await user.clear(date);
    await user.type(date, '2026-10-09');
    await user.click(within(dialog).getByRole('button', { name: 'Save dates' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(setDates).toHaveBeenCalledWith({ gameId: '1', dates: { '1': '2026-10-09T17:30:00Z' } });
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText('Draft saved')).toBeVisible();
  });
  it('reports partial outcomes without automatic retries or editable existing dates', async () => {
    const { api, user } = await connected('partial');
    const apply = await previewAndConfirm(api, user);
    await user.click(screen.getByRole('button', { name: 'Apply 3 achievements' }));
    await screen.findByRole('heading', { name: 'Results need attention' });
    expect(screen.getByText('Unlocked with a different date')).toBeVisible();
    expect(screen.getByText('Outcome uncertain')).toBeVisible();
    expect(screen.getByText('Not attempted')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review queue' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Review queue' }));
    expect(
      screen.queryByRole('button', { name: 'Edit date for The World' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit date for Frequent Flyer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('preserves unknown outcomes and exposes only read-only recovery/history actions', async () => {
    const { api, user } = await connected('unknown');
    const apply = await previewAndConfirm(api, user);
    await user.click(screen.getByRole('button', { name: 'Apply 3 achievements' }));
    await screen.findByRole('heading', { name: 'Outcome unknown' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check current state' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Check current state' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'History' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(
      screen.getByText('Saved reports are read-only. They cannot undo an unlock.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'View report' })).toBeEnabled();
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('supports an empty library without presenting stale sample games', async () => {
    const api = createDemoApi({ delayMs: 0, scenario: 'empty' });
    const user = userEvent.setup();
    render(<App api={api} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in to GOG' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Sign in to GOG' }));
    await waitFor(() =>
      expect(screen.getAllByText('No GOG games found.').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('Cyberpunk 2077')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled();
  });
  it('initializes once under StrictMode and supports normal sign-in', async () => {
    const api = createDemoApi({ delayMs: 0 });
    const initialize = vi.spyOn(api, 'initialize');
    render(
      <StrictMode>
        <App api={api} />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in to GOG' })).toBeEnabled(),
    );
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it('adds and removes queue entries without starting a write', async () => {
    const { api, user } = await connected();
    const apply = vi.spyOn(api, 'apply');
    await user.click(screen.getByRole('checkbox', { name: 'Select Legend of The Afterlife' }));
    await user.click(screen.getByRole('button', { name: 'Add selected' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove Legend of The Afterlife from queue' }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole('button', { name: 'Remove Legend of The Afterlife from queue' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove Legend of The Afterlife from queue' }),
      ).not.toBeInTheDocument(),
    );
    expect(apply).not.toHaveBeenCalled();
  });
  it('invalidates a reviewed queue after an edit and traps dialog focus', async () => {
    const { user } = await connected();
    await user.click(screen.getByRole('button', { name: 'Preview changes' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Back to queue' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Back to queue' }));
    await user.click(screen.getByRole('button', { name: 'Edit date for The World' }));
    const dialog = screen.getByRole('dialog', { name: 'Queue dates' });
    within(dialog).getByRole('button', { name: 'Save dates' }).focus();
    await user.keyboard('{Tab}');
    expect(within(dialog).getByRole('button', { name: 'Close Queue dates' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Save dates' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Queue changed — preview again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  });
  it('blocks reads while a previous writer survives and rechecks auth when it exits', async () => {
    const fixture = createDemoApi({ delayMs: 0 });
    await fixture.login();
    const initialize = vi
      .fn()
      .mockResolvedValueOnce({
        version: '0.1.0',
        cliVersion: '0.3.0',
        auth: { authenticated: false },
        operation: { kind: 'recovery', gameId: '1' },
      })
      .mockResolvedValue({
        version: '0.1.0',
        cliVersion: '0.3.0',
        auth: { authenticated: true, user_id: '123456789' },
        operation: { kind: 'idle' },
      });
    let listener: ((state: OperationState) => void) | undefined;
    const listGames = vi.spyOn(fixture, 'listGames');
    const api = {
      ...fixture,
      isDemo: false,
      initialize,
      onOperation: (next: (state: OperationState) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'Checking an interrupted operation…' });
    expect(listGames).not.toHaveBeenCalled();
    await act(async () => listener?.({ kind: 'idle' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview changes' })).toBeEnabled(),
    );
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(listGames).toHaveBeenCalledTimes(1);
  });
});
