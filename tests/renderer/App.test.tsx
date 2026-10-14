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
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Sign in with GOG' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Sign in with GOG' }));
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
  it('shows an icon account menu with the ID inside', async () => {
    const { user } = await connected();
    await user.click(screen.getByLabelText('Account menu'));
    expect(screen.queryByText('My account')).not.toBeInTheDocument();
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
      screen.getByRole('button', { name: 'Add A sample hidden achievement to queue' }),
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
    expect(screen.getByText('Queue is empty.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Apply changes for Cyberpunk 2077' }),
    ).not.toBeInTheDocument();
  });
  it('edits one date in a compact dialog without applying', async () => {
    const { api, user } = await connected();
    const apply = vi.spyOn(api, 'apply');
    const setDates = vi.spyOn(api, 'setDates');
    await user.selectOptions(screen.getByLabelText('Time zone', { exact: true }), 'UTC');
    await user.click(screen.getByRole('button', { name: 'Edit date for The World' }));
    const dialog = screen.getByRole('dialog');
    const date = within(dialog).getByLabelText('Unlock date for The World');
    fireEvent.change(date, { target: { value: '2020-02-02T13:14:15' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save date' }));
    await ready();
    expect(setDates).toHaveBeenCalledWith({ gameId: '1', dates: { '1': '2020-02-02T13:14:15Z' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
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
        expect(
          screen.queryByRole('button', { name: 'Edit date for The World' }),
        ).not.toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'Edit date for Frequent Flyer' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Check current state' }));
      await ready();
      await user.click(screen.getByRole('button', { name: 'History' }));
      await ready();
      expect(screen.queryByRole('button', { name: 'View report' })).not.toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Results needing attention' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Edit date for Frequent Flyer' })).toBeEnabled();
      expect(apply).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps all game groups visible and applies only the chosen group', async () => {
    const { api, user } = await connected();
    await user.click(screen.getByRole('button', { name: 'The Witcher 3: Wild Hunt' }));
    await ready();
    await user.click(screen.getByRole('button', { name: 'Add Passed the Trial to queue' }));
    await ready();
    expect(screen.getByLabelText('Queue for Cyberpunk 2077')).toBeVisible();
    expect(screen.getByLabelText('Queue for The Witcher 3: Wild Hunt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cyberpunk 2077' }));
    await ready();
    const apply = await confirm(api, user, 'The Witcher 3: Wild Hunt');
    await user.click(screen.getByRole('button', { name: 'Apply 1 achievement' }));
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
    expect(
      within(screen.getByRole('list', { name: 'Unlocked achievements' })).getAllByRole('listitem'),
    ).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Edit date for Card Collector' })).toBeEnabled();
    expect(
      within(screen.getByLabelText('Queue for The Witcher 3: Wild Hunt')).getByText(
        'Sample achievement description. This is demo data, not a real game requirement.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back to achievements' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Card Collector from queue' }));
    await ready();
    expect(screen.getByRole('heading', { name: 'Achievement history' })).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Unlocked achievements' })).getAllByRole('listitem'),
    ).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Cyberpunk 2077' }));
    await ready();
    expect(screen.getByRole('heading', { name: 'Cyberpunk 2077' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Achievement history' })).not.toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Sign in with GOG' })).toBeEnabled(),
    );
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it('adds and removes entries without applying', async () => {
    const { api, user } = await connected();
    const apply = vi.spyOn(api, 'apply');
    await user.click(screen.getByRole('button', { name: 'Add Legend of The Afterlife to queue' }));
    await ready();
    await user.click(
      screen.getByRole('button', { name: 'Remove Legend of The Afterlife from queue' }),
    );
    await ready();
    expect(
      screen.queryByRole('button', { name: 'Edit date for Legend of The Afterlife' }),
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

it('uses one sign-in action and hides the queue and time zone while signed out', async () => {
  const api = createDemoApi({ delayMs: 0 });
  render(<App api={api} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Sign in with GOG' })).toBeEnabled(),
  );
  expect(screen.getByRole('heading', { name: 'Your GOG achievements' })).toBeVisible();
  expect(
    screen.queryByRole('complementary', { name: 'Achievement queue' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Time zone')).not.toBeInTheDocument();
  expect(screen.queryByText('Sign in to load your games.')).not.toBeInTheDocument();
  expect(screen.queryByText('Sign-in opens in a GOG window.')).not.toBeInTheDocument();
});
