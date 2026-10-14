// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  const queue = screen.getByRole('complementary', { name: 'Achievement queue' });
  expect(within(queue).getByText('The World')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply changes for Cyberpunk 2077' })).toBeEnabled();
  expect(screen.queryByText('Loading queue…')).not.toBeInTheDocument();
  expect(screen.queryByText('Queue could not be loaded.')).not.toBeInTheDocument();
});
it('separates pending and failed game reads from an empty achievement list and recovers on retry', async () => {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  const request = deferred<AchievementsData>();
  vi.spyOn(api, 'listAchievements').mockImplementationOnce(() => request.promise);
  const user = userEvent.setup();
  render(<App api={api} />);
  await screen.findByText('Loading achievements…');
  expect(screen.getAllByText('Loading achievements…')).toHaveLength(1);
  expect(screen.getByText('Loading achievements…').closest('.achievement-skeleton')).not.toBeNull();
  expect(screen.queryByText('No achievements available for this game.')).not.toBeInTheDocument();
  expect(screen.queryByText('Loading queue…')).not.toBeInTheDocument();
  expect(screen.getByText('3 achievements · 1 game')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply changes for Cyberpunk 2077' })).toBeDisabled();
  await act(async () => request.reject(new Error('Achievement request failed.')));
  await screen.findByText('Game data could not be loaded.');
  expect(screen.queryByText('No achievements available for this game.')).not.toBeInTheDocument();
  expect(screen.queryByText('Queue could not be loaded.')).not.toBeInTheDocument();
  expect(screen.getByText('3 achievements · 1 game')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry game data' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Apply changes for Cyberpunk 2077' })).toBeEnabled(),
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
  expect(
    screen.queryByRole('button', { name: 'Apply changes for Cyberpunk 2077' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('0 achievements · 0 games')).toBeVisible();
});

async function connected(otherGame = false) {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  if (otherGame) await api.addAchievements({ gameId: '2', achievementIds: ['201'] });
  const games = await api.listGames();
  const achievements = await api.listAchievements('1');
  const user = userEvent.setup();
  const rendered = render(<App api={api} />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Add Legend of The Afterlife to queue' }),
    ).toBeEnabled(),
  );
  return { api, user, games, achievements, ...rendered };
}

it('keeps main achievements stable while refreshing only the library skeleton', async () => {
  const { api, user, games, container } = await connected();
  const request = deferred<GamesData>();
  const listAchievements = vi.spyOn(api, 'listAchievements');
  vi.spyOn(api, 'listGames').mockImplementationOnce(() => request.promise);
  const main = screen.getByRole('region', { name: 'Game achievements' });
  const heading = within(main).getByRole('heading', { name: 'Cyberpunk 2077', level: 2 });
  const rows = [...main.querySelectorAll('.achievement-row')];
  await user.click(screen.getByRole('button', { name: 'Refresh library' }));
  expect(container.querySelector('.library-skeleton')).not.toBeNull();
  expect(main.querySelector('.achievement-skeleton')).toBeNull();
  expect(within(main).getByRole('heading', { name: 'Cyberpunk 2077', level: 2 })).toBe(heading);
  expect([...main.querySelectorAll('.achievement-row')]).toEqual(rows);
  expect(container.querySelector('.loading-line')).toBeNull();
  expect(listAchievements).not.toHaveBeenCalled();
  await act(async () => request.resolve(games));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh library' })).toBeEnabled(),
  );
  expect(container.querySelector('.library-skeleton')).toBeNull();
  expect(listAchievements).not.toHaveBeenCalled();
});

it('uses a local achievement skeleton on refresh while keeping library and queue content', async () => {
  const { api, user, achievements, container } = await connected();
  const request = deferred<AchievementsData>();
  vi.spyOn(api, 'listAchievements').mockImplementationOnce(() => request.promise);
  const library = screen.getByRole('complementary', { name: 'Game library' });
  const queue = screen.getByRole('complementary', { name: 'Achievement queue' });
  const gameRows = [...library.querySelectorAll('.game-row')];
  await user.click(screen.getAllByRole('button', { name: 'Refresh achievements' })[0]!);
  expect(screen.getAllByText('Loading achievements…')).toHaveLength(1);
  expect(container.querySelector('.achievement-skeleton')).not.toBeNull();
  expect(container.querySelector('.library-skeleton')).toBeNull();
  expect([...library.querySelectorAll('.game-row')]).toEqual(gameRows);
  expect(within(queue).getByText('The World')).toBeVisible();
  expect(container.querySelector('.loading-line')).toBeNull();
  const next = structuredClone(achievements);
  next.achievements[0]!.description = 'Refreshed sample description.';
  await act(async () => request.resolve(next));
  expect(await screen.findAllByText('Refreshed sample description.')).toHaveLength(2);
  expect(container.querySelector('.achievement-skeleton')).toBeNull();
});

it('shows selected achievements in the queue before persistence resolves', async () => {
  const { api, user } = await connected();
  const request = deferred<void>();
  const original = api.addAchievements.bind(api);
  const save = vi.spyOn(api, 'addAchievements').mockImplementationOnce(async (input) => {
    await request.promise;
    return original(input);
  });
  const apply = vi.spyOn(api, 'apply');
  await user.click(screen.getByRole('button', { name: 'Add Legend of The Afterlife to queue' }));
  const queue = screen.getByRole('complementary', { name: 'Achievement queue' });
  expect(within(queue).getByText('Legend of The Afterlife')).toBeVisible();
  expect(within(queue).getByRole('status')).toHaveTextContent('Saving draft…');
  expect(
    within(queue).getByRole('button', { name: 'Remove Legend of The Afterlife from queue' }),
  ).toBeDisabled();
  expect(save).toHaveBeenCalledWith({ gameId: '1', achievementIds: ['4'] });
  await act(async () => request.resolve(undefined));
  await waitFor(() =>
    expect(
      within(queue).getByRole('button', { name: 'Remove Legend of The Afterlife from queue' }),
    ).toBeEnabled(),
  );
  expect(screen.getByText('Draft saved')).toBeVisible();
  expect(apply).not.toHaveBeenCalled();
});

it('rolls back provisional additions when both persistence and draft reload fail, preserving other groups', async () => {
  const { api, user } = await connected(true);
  const request = deferred<never>();
  vi.spyOn(api, 'addAchievements').mockImplementationOnce(() => request.promise);
  vi.spyOn(api, 'listQueues').mockRejectedValueOnce(new Error('Draft reload failed.'));
  await user.click(screen.getByRole('button', { name: 'Add Legend of The Afterlife to queue' }));
  const queue = screen.getByRole('complementary', { name: 'Achievement queue' });
  expect(within(queue).getByText('Legend of The Afterlife')).toBeVisible();
  await act(async () => request.reject(new Error('Draft save failed.')));
  await waitFor(() =>
    expect(within(queue).queryByText('Legend of The Afterlife')).not.toBeInTheDocument(),
  );
  expect(within(queue).getByText('The World')).toBeVisible();
  expect(within(queue).getByText('Passed the Trial')).toBeVisible();
  expect(screen.getByText('4 achievements · 2 games')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Draft save failed.');
  expect(screen.queryByText('Draft saved')).not.toBeInTheDocument();
});

it('ends queue loading with a local retry when both the initial library and saved drafts fail', async () => {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  vi.spyOn(api, 'listGames').mockRejectedValue(new Error('Library request failed.'));
  const queues = vi
    .spyOn(api, 'listQueues')
    .mockRejectedValueOnce(new Error('Draft request failed.'));
  const user = userEvent.setup();
  render(<App api={api} />);
  await screen.findByText('Queue could not be loaded.');
  expect(screen.queryByText('Loading queue…')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Library request failed.');
  expect(screen.getByRole('button', { name: 'Retry queue' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Retry queue' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Apply changes for Cyberpunk 2077' })).toBeEnabled(),
  );
  expect(queues).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Queue could not be loaded.')).not.toBeInTheDocument();
  expect(screen.queryByText('Loading queue…')).not.toBeInTheDocument();
});

it('does not call a populated library empty while its saved queues load', async () => {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  const queues = await api.listQueues();
  const request = deferred<typeof queues>();
  const read = vi.spyOn(api, 'listQueues').mockImplementationOnce(() => request.promise);
  render(<App api={api} />);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('No GOG games found')).not.toBeInTheDocument();
  expect(screen.getByText('Choose a game')).toBeVisible();
  await act(async () => request.resolve(queues));
  await waitFor(() => expect(screen.getByRole('button', { name: 'History' })).toBeEnabled());
});
