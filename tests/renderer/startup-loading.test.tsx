// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { createDemoApi } from '../../src/shared/demo-api';
import type { AchievementsData, OperationRecord } from '../../src/shared/api';

afterEach(cleanup);
const WITCHER = 'The Witcher 3: Wild Hunt';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture() {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  await api.addAchievements({ gameId: '2', achievementIds: ['201'] });
  return api;
}

async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Queue unlock for Legend of The Afterlife' }),
    ).toBeEnabled(),
  );
}

it.each(['startup', 'sign-in'] as const)(
  'makes the saved queue and selected game usable at %s without optional reads',
  async (entry) => {
    const api = await fixture();
    const otherData = await api.listAchievements('2');
    if (entry === 'sign-in') await api.logout();
    const other = deferred<AchievementsData>();
    const history = vi.spyOn(api, 'history').mockImplementation(() => new Promise(() => {}));
    const list = api.listAchievements.bind(api);
    const achievements = vi
      .spyOn(api, 'listAchievements')
      .mockImplementation((id) => (id === '2' ? other.promise : list(id)));
    const apply = vi.spyOn(api, 'apply');
    const user = userEvent.setup();
    render(<App api={api} />);
    if (entry === 'sign-in') {
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Sign in with GOG' })).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Sign in with GOG' }));
    }
    await ready();
    expect(history).not.toHaveBeenCalled();
    expect(achievements).toHaveBeenCalledExactlyOnceWith('1');
    const queue = screen.getByRole('region', { name: `Queue for ${WITCHER}` });
    expect(within(queue).getByText('Passed the Trial')).toBeVisible();
    expect(within(queue).getByText('Description not loaded.')).toBeVisible();
    expect(
      within(queue).getByRole('button', { name: 'Edit date for Passed the Trial' }),
    ).toBeEnabled();
    expect(
      within(queue).getByRole('button', { name: `Review changes for ${WITCHER}` }),
    ).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Refresh library' }));
    await ready();
    expect(history).not.toHaveBeenCalled();
    expect(achievements).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: WITCHER }));
    await screen.findByText('Loading achievements…');
    expect(achievements).toHaveBeenLastCalledWith('2');
    expect(within(queue).getByText('Passed the Trial')).toBeVisible();
    otherData.achievements[0]!.description = 'Loaded only when this game is selected.';
    await act(async () => other.resolve(otherData));
    await waitFor(() => expect(screen.getByRole('button', { name: 'History' })).toBeEnabled());
    expect(within(queue).getByText('Loaded only when this game is selected.')).toBeVisible();
    expect(history).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  },
);

it('keeps history failures in History and retries without reloading the library', async () => {
  const api = await fixture();
  const request = deferred<OperationRecord[]>();
  const history = vi.spyOn(api, 'history').mockImplementationOnce(() => request.promise);
  const library = vi.spyOn(api, 'listGames');
  const user = userEvent.setup();
  render(<App api={api} />);
  await ready();
  await user.click(screen.getByRole('button', { name: 'History' }));
  expect(screen.getByRole('status', { name: 'Loading achievement history' })).toBeVisible();
  expect(screen.queryByText('No achievement history yet.')).not.toBeInTheDocument();
  // A requested history read still uses the shared foreground operation guard.
  expect(screen.getByRole('button', { name: `Review changes for ${WITCHER}` })).toBeDisabled();
  await act(async () => request.reject(new Error('History disk read failed.')));
  const main = screen.getByRole('region', { name: 'Game achievements' });
  const alert = within(main).getByRole('alert');
  expect(alert).toHaveTextContent('History disk read failed.');
  expect(screen.queryByText('No achievement history yet.')).not.toBeInTheDocument();
  expect(document.querySelector('.app-shell > .error-banner')).toBeNull();
  expect(screen.getByRole('button', { name: `Review changes for ${WITCHER}` })).toBeEnabled();
  await user.click(within(alert).getByRole('button', { name: /Retry|Reload/ }));
  await screen.findByText('No achievement history yet.');
  expect(history).toHaveBeenCalledTimes(2);
  expect(library).toHaveBeenCalledTimes(1);
});

it.each(['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'])(
  'routes a history %s failure through account recovery',
  async (code) => {
    const api = await fixture();
    const user = userEvent.setup();
    render(<App api={api} />);
    await ready();
    const initial = await api.initialize();
    const session = vi.spyOn(api, 'initialize').mockResolvedValue({
      ...initial,
      auth: { authenticated: true, user_id: '987654321' },
    });
    vi.spyOn(api, 'history').mockRejectedValueOnce(
      Object.assign(new Error('Account changed.'), { code }),
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(session).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).toHaveTextContent('Account changed.');
    expect(
      screen.queryByRole('region', { name: 'Queue for Cyberpunk 2077' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('The World')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Achievement history' })).not.toBeInTheDocument();
  },
);

it('offers sign-in for a history authentication failure', async () => {
  const api = await fixture();
  const user = userEvent.setup();
  render(<App api={api} />);
  await ready();
  vi.spyOn(api, 'history').mockRejectedValueOnce(
    Object.assign(new Error('Sign in again.'), { code: 'AUTH_REQUIRED' }),
  );
  await user.click(screen.getByRole('button', { name: 'History' }));
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('button', { name: 'Sign in to GOG' })).toBeEnabled();
});

it('finishes apply refreshes without reading history or unselected game details', async () => {
  const api = await fixture();
  const history = vi.spyOn(api, 'history').mockRejectedValue(new Error('History unavailable.'));
  const achievements = vi.spyOn(api, 'listAchievements');
  const user = userEvent.setup();
  render(<App api={api} />);
  await ready();
  await user.click(screen.getByRole('button', { name: `Review changes for ${WITCHER}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Apply changes to 1 achievement?' });
  await user.click(within(dialog).getByRole('button', { name: 'Apply changes' }));
  await screen.findByRole('heading', { name: 'Changes applied' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled());
  expect(history).not.toHaveBeenCalled();
  expect(achievements).toHaveBeenCalledExactlyOnceWith('1');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
