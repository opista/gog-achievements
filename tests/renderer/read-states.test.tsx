// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { createDemoApi } from '../../src/shared/demo-api';
import type { AchievementsData, GamesData } from '../../src/shared/api';
afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
it('does not call a pending or failed initial library read an empty library', async () => {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  const request = deferred<GamesData>();
  vi.spyOn(api, 'listGames').mockImplementationOnce(() => request.promise);
  render(<App api={api} />);
  await screen.findByText('Loading games…');
  expect(screen.queryByText('No GOG games found.')).not.toBeInTheDocument();
  expect(screen.queryByText('No GOG games found')).not.toBeInTheDocument();
  await act(async () => request.reject(new Error('Library request failed.')));
  await screen.findAllByText('Library could not be loaded.');
  expect(screen.queryByText('No GOG games found.')).not.toBeInTheDocument();
  expect(screen.queryByText('No GOG games found')).not.toBeInTheDocument();
});
it('separates pending and failed game reads from an empty achievement list and recovers on retry', async () => {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  const request = deferred<AchievementsData>();
  vi.spyOn(api, 'listAchievements').mockImplementationOnce(() => request.promise);
  const user = userEvent.setup();
  render(<App api={api} />);
  await screen.findByText('Loading achievements…');
  expect(screen.queryByText('No achievements available for this game.')).not.toBeInTheDocument();
  expect(screen.getByText('Loading queue…')).toBeVisible();
  expect(screen.queryByText('0 achievements')).not.toBeInTheDocument();
  await act(async () => request.reject(new Error('Achievement request failed.')));
  await screen.findByText('Game data could not be loaded.');
  expect(screen.queryByText('No achievements available for this game.')).not.toBeInTheDocument();
  expect(screen.getByText('Queue could not be loaded.')).toBeVisible();
  expect(screen.queryByText('0 achievements')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry game data' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeEnabled(),
  );
  expect(screen.queryByText('Game data could not be loaded.')).not.toBeInTheDocument();
});
it('uses the achievement empty message only after a successful empty read', async () => {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  vi.spyOn(api, 'listAchievements').mockResolvedValue({
    user_id: '123456789',
    game: { id: '1', title: 'Cyberpunk 2077', client_id: '100001' },
    count: 0,
    achievements: [],
  });
  vi.spyOn(api, 'getQueue').mockResolvedValue(null);
  render(<App api={api} />);
  await screen.findByText('No achievements available for this game.');
  expect(screen.queryByText('Game data could not be loaded.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled();
  expect(screen.getByText('0 achievements')).toBeVisible();
});
