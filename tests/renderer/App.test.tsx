// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import type { OperationState } from '../../src/shared/api';
import { App } from '../../src/renderer/App';
import { createDemoApi, type DemoDesktopApi, type DemoScenario } from '../../src/shared/demo-api';
afterEach(cleanup);
async function ready() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'History' })).toBeEnabled());
}
async function connected(scenario: DemoScenario = 'complete') {
  const api = createDemoApi({ delayMs: 0, scenario });
  const user = userEvent.setup();
  render(<App api={api} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in to GOG' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Sign in to GOG' }));
  await ready();
  return { api, user };
}
async function confirm(
  api: DemoDesktopApi,
  user: ReturnType<typeof userEvent.setup>,
  game = 'Cyberpunk 2077',
) {
  const apply = vi.spyOn(api, 'apply');
  await user.click(screen.getByRole('button', { name: `Apply changes for ${game}` }));
  await screen.findByRole('dialog');
  expect(apply).not.toHaveBeenCalled();
  return apply;
}
describe('desktop restoration flow', () => {
  it('shows My account with its ID only in the menu', async () => {
    const { user } = await connected();
    await user.click(screen.getByText('My account', { exact: true }));
    expect(screen.getByText('Account ID: 123456789')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(
      screen.queryByText("Signing out also removes the CLI's saved login."),
    ).not.toBeInTheDocument();
  });
  it('protects existing unlocks and removes bulk dates and Queued filter', async () => {
    const { user } = await connected();
    expect(
      screen.queryByRole('checkbox', { name: 'Select Full Body Conversion' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set date for selected' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Queued' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview changes' })).not.toBeInTheDocument();
    expect(screen.queryByText('A sample hidden achievement')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(
      screen.getByRole('checkbox', { name: 'Select A sample hidden achievement' }),
    ).toBeEnabled();
  });
  it('checks automatically and never writes before final confirmation', async () => {
    const { api, user } = await connected();
    const apply = await confirm(api, user);
    const dialog = screen.getByRole('dialog', { name: 'Apply 3 achievements?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply changes for Cyberpunk 2077' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Apply 3 achievements' }));
    await screen.findByRole('heading', { name: 'Results confirmed' });
    await ready();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Queue is clear. Results are saved in history.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Apply changes for Cyberpunk 2077' }),
    ).not.toBeInTheDocument();
  });
  it('edits one date inline without applying and blocks future dates', async () => {
    const { api, user } = await connected();
    const apply = vi.spyOn(api, 'apply');
    const setDates = vi.spyOn(api, 'setDates');
    await user.selectOptions(screen.getByLabelText('Time zone', { exact: true }), 'UTC');
    const date = screen.getByLabelText('Unlock date for The World');
    fireEvent.change(date, { target: { value: '2099-01-01T13:14:15' } });
    fireEvent.blur(date);
    expect(screen.getByText('Unlock dates must not be in the future.')).toBeVisible();
    expect(setDates).not.toHaveBeenCalled();
    fireEvent.change(date, { target: { value: '2020-02-02T13:14:15' } });
    fireEvent.keyDown(date, { key: 'Enter' });
    await waitFor(() =>
      expect(setDates).toHaveBeenCalledWith({
        gameId: '1',
        dates: { '1': '2020-02-02T13:14:15Z' },
      }),
    );
    await ready();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText('Draft saved')).toBeVisible();
  });
  it.each(['partial', 'unknown'] as const)(
    'keeps %s outcomes without automatic retries',
    async (scenario) => {
      const { api, user } = await connected(scenario);
      const apply = await confirm(api, user);
      await user.click(screen.getByRole('button', { name: 'Apply 3 achievements' }));
      await screen.findByRole('heading', {
        name: scenario === 'partial' ? 'Results need attention' : 'Outcome unknown',
      });
      await ready();
      if (scenario === 'partial') {
        expect(screen.getByText('Unlocked with a different date')).toBeVisible();
        expect(screen.getByText('Outcome uncertain')).toBeVisible();
        expect(screen.queryByLabelText('Unlock date for The World')).not.toBeInTheDocument();
      }
      expect(screen.getByLabelText('Unlock date for Frequent Flyer')).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Check current state' }));
      await ready();
      await user.click(screen.getByRole('button', { name: 'History' }));
      await ready();
      expect(screen.getByRole('button', { name: 'View report' })).toBeEnabled();
      expect(screen.getByLabelText('Unlock date for Frequent Flyer')).toBeEnabled();
      expect(apply).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps all game groups visible and applies only the chosen group', async () => {
    const { api, user } = await connected();
    await user.click(screen.getByRole('button', { name: 'The Witcher 3: Wild Hunt' }));
    await ready();
    await user.click(screen.getByRole('checkbox', { name: 'Select Passed the Trial' }));
    await user.click(screen.getByRole('button', { name: 'Add selected' }));
    await ready();
    expect(screen.getByLabelText('Queue for Cyberpunk 2077')).toBeVisible();
    expect(screen.getByLabelText('Queue for The Witcher 3: Wild Hunt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cyberpunk 2077' }));
    await ready();
    const apply = await confirm(api, user, 'The Witcher 3: Wild Hunt');
    await user.click(screen.getByRole('button', { name: 'Apply 1 achievements' }));
    await screen.findByRole('heading', { name: 'Results confirmed' });
    await ready();
    expect(screen.getByLabelText('Queue for Cyberpunk 2077')).toBeVisible();
    expect(screen.queryByLabelText('Queue for The Witcher 3: Wild Hunt')).not.toBeInTheDocument();
    expect((await api.getQueue('1'))?.items).toHaveLength(3);
    expect((await api.history({}))[0]?.game_id).toBe('2');
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('shows history across games and permits queue edits there', async () => {
    const api = createDemoApi({ delayMs: 0 });
    await api.login();
    await api.apply({ previewToken: (await api.preview({ gameId: '1' })).token });
    await api.addAchievements({ gameId: '2', achievementIds: ['201'] });
    await api.apply({ previewToken: (await api.preview({ gameId: '2' })).token });
    await api.addAchievements({ gameId: '2', achievementIds: ['204'] });
    const user = userEvent.setup();
    render(<App api={api} />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await ready();
    expect(screen.getAllByRole('button', { name: 'View report' })).toHaveLength(2);
    expect(screen.getByLabelText('Unlock date for Card Collector')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Remove Card Collector from queue' }));
    await ready();
    expect(screen.getByRole('heading', { name: 'Operation history' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'View report' })).toHaveLength(2);
  });
  it('supports an empty library without stale games or apply controls', async () => {
    await connected('empty');
    expect(screen.getByRole('heading', { name: 'No GOG games found' })).toBeVisible();
    expect(screen.queryByText('Cyberpunk 2077')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Apply changes for/ })).not.toBeInTheDocument();
  });
  it('initializes once under StrictMode', async () => {
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
  it('adds and removes entries without applying', async () => {
    const { api, user } = await connected();
    const apply = vi.spyOn(api, 'apply');
    await user.click(screen.getByRole('checkbox', { name: 'Select Legend of The Afterlife' }));
    await user.click(screen.getByRole('button', { name: 'Add selected' }));
    await ready();
    await user.click(
      screen.getByRole('button', { name: 'Remove Legend of The Afterlife from queue' }),
    );
    await ready();
    expect(
      screen.queryByLabelText('Unlock date for Legend of The Afterlife'),
    ).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
  it('blocks reads while a previous writer survives and checks auth after it exits', async () => {
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
    await ready();
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(listGames).toHaveBeenCalledTimes(1);
  });
});
