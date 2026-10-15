// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueuePane } from '../../src/renderer/features/QueuePane';
import { formatTimestamp } from '../../src/renderer/date-time';
import { useWorkspace } from '../../src/renderer/use-workspace';
import { createDemoApi, type DemoDesktopApi } from '../../src/shared/demo-api';

afterEach(cleanup);

function QueueHarness({
  api,
  missingDetails = false,
}: {
  api: DemoDesktopApi;
  missingDetails?: boolean;
}) {
  const workspace = useWorkspace(api);
  const zone = 'America/New_York';
  return (
    <QueuePane
      workspace={{
        ...workspace,
        achievementFor: missingDetails ? () => undefined : workspace.achievementFor,
      }}
      zone={zone}
      demo
      onResize={() => {}}
    />
  );
}

async function connected({ witcher = false, missingDetails = false, singleCyber = false } = {}) {
  const api = createDemoApi({ delayMs: 0 });
  await api.login();
  if (singleCyber) await api.removeAchievements({ gameId: '1', achievementIds: ['2', '3'] });
  if (witcher) await api.addAchievements({ gameId: '2', achievementIds: ['201'] });
  const list = api.listAchievements.bind(api);
  api.listAchievements = async (gameId) => {
    const data = await list(gameId);
    for (const item of data.achievements)
      item.description = `${data.game.title}: description ${item.id}.`;
    return data;
  };
  const view = render(<QueueHarness api={api} missingDetails={missingDetails} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit date for The World' })).toBeEnabled(),
  );
  return { ...view, api, user: userEvent.setup() };
}

it('hides the whole queue, counts and time zone when signed out', async () => {
  const api = createDemoApi({ delayMs: 0 });
  const initialized = vi.spyOn(api, 'initialize');
  const { container } = render(<QueueHarness api={api} />);
  await waitFor(() => expect(initialized).toHaveBeenCalledTimes(1));
  expect(container).toBeEmptyDOMElement();
  expect(
    screen.queryByRole('complementary', { name: 'Achievement queue' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Time zone')).not.toBeInTheDocument();
});

it('shows cached game descriptions beside calendar and remove controls without inline date inputs', async () => {
  await connected({ witcher: true });
  const cyber = screen.getByRole('region', { name: 'Queue for Cyberpunk 2077' });
  const witcher = screen.getByRole('region', { name: 'Queue for The Witcher 3: Wild Hunt' });
  expect(within(cyber).getByText('The World')).toBeVisible();
  expect(within(cyber).getByText('Cyberpunk 2077: description 1.')).toHaveAttribute(
    'title',
    'Cyberpunk 2077: description 1.',
  );
  expect(within(witcher).getByText('The Witcher 3: Wild Hunt: description 201.')).toBeVisible();
  const calendar = within(cyber).getByRole('button', { name: 'Edit date for The World' });
  expect(calendar).toHaveAttribute(
    'title',
    formatTimestamp('2026-10-10T17:30:00Z', 'America/New_York'),
  );
  expect(within(cyber).getByRole('button', { name: 'Remove The World from queue' })).toBeEnabled();
  expect(screen.queryByLabelText('Unlock date for The World')).not.toBeInTheDocument();
});

it('uses an explicit description fallback until cached achievement details exist', async () => {
  await connected({ missingDetails: true });
  expect(screen.getAllByText('No description available.')).toHaveLength(3);
});

it('uses local dates without a time zone control', async () => {
  const { user } = await connected();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByText('Time zone')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit date for The World' }));
  expect(screen.getByLabelText('Unlock date for The World')).toHaveValue('2026-10-10T13:30');
  expect(screen.queryByText('America/New_York')).not.toBeInTheDocument();
});

it('opens and cancels one queued date without writing it', async () => {
  const { user, api } = await connected();
  const save = vi.spyOn(api, 'setDates');
  await user.click(screen.getByRole('button', { name: 'Edit date for The World' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit unlock date' });
  expect(within(dialog).getByText('The World')).toBeVisible();
  expect(within(dialog).getByText('Cyberpunk 2077: description 1.')).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('saves a modal date to its game only and leaves the other queue unchanged', async () => {
  const { user, api } = await connected({ witcher: true });
  const save = vi.spyOn(api, 'setDates');
  const cyberDate = screen
    .getByRole('button', { name: 'Edit date for The World' })
    .getAttribute('title');
  await user.click(screen.getByRole('button', { name: 'Edit date for Passed the Trial' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit unlock date' });
  const input = within(dialog).getByLabelText('Unlock date for Passed the Trial');
  // Native date fields use change events; jsdom has no platform picker UI.
  fireEvent.change(input, { target: { value: '2020-02-02T13:14:15' } });
  await user.click(within(dialog).getByRole('button', { name: 'Save date' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledExactlyOnceWith({
    gameId: '2',
    dates: { '201': '2020-02-02T18:14:15Z' },
  });
  expect(screen.getByRole('button', { name: 'Edit date for The World' })).toHaveAttribute(
    'title',
    cyberDate,
  );
  expect(
    screen.getByRole('region', { name: 'Queue for Cyberpunk 2077' }).querySelectorAll('.queue-row'),
  ).toHaveLength(3);
});

it('keeps Apply scoped to one game and waits for the separate final confirmation', async () => {
  const { user, api } = await connected({ witcher: true });
  const preview = vi.spyOn(api, 'preview');
  const apply = vi.spyOn(api, 'apply');
  const button = screen.getByRole('button', { name: 'Apply changes for The Witcher 3: Wild Hunt' });
  await user.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  expect(preview).toHaveBeenCalledExactlyOnceWith({ gameId: '2' });
  expect(apply).not.toHaveBeenCalled();
});

it.each(['before', 'after'] as const)(
  'shows a generic empty queue %s a saved apply',
  async (stage) => {
    const api = createDemoApi({ delayMs: 0 });
    await api.login();
    if (stage === 'after')
      await api.apply({ previewToken: (await api.preview({ gameId: '1' })).token });
    else await api.removeAchievements({ gameId: '1', achievementIds: ['1', '2', '3'] });
    render(<QueueHarness api={api} />);
    expect(await screen.findByText('Queue is empty.')).toBeVisible();
    expect(screen.getByText('Use + beside an achievement to add it here.')).toBeVisible();
    expect(screen.queryByText(/Results are saved in history/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Apply changes for/ })).not.toBeInTheDocument();
  },
);

it('keeps keyboard focus on the next remove action after removing an achievement', async () => {
  const { user, api } = await connected();
  const remove = vi.spyOn(api, 'removeAchievements');
  screen.getByRole('button', { name: 'Remove The World from queue' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Remove Frequent Flyer from queue' })).toHaveFocus(),
  );
  expect(remove).toHaveBeenCalledExactlyOnceWith({ gameId: '1', achievementIds: ['1'] });
});

it('continues to the next game after removing the final achievement in a group', async () => {
  const { user } = await connected({ singleCyber: true, witcher: true });
  screen.getByRole('button', { name: 'Remove The World from queue' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Remove Passed the Trial from queue' }),
    ).toHaveFocus(),
  );
  expect(
    screen.queryByRole('region', { name: 'Queue for Cyberpunk 2077' }),
  ).not.toBeInTheDocument();
});

it('focuses the queue heading after removing its final achievement', async () => {
  const { user } = await connected({ singleCyber: true });
  screen.getByRole('button', { name: 'Remove The World from queue' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Queue' })).toHaveFocus());
  expect(screen.getByText('Use + beside an achievement to add it here.')).toBeVisible();
});

it('restores focus to the original remove action when removal fails', async () => {
  const { user, api } = await connected();
  vi.spyOn(api, 'removeAchievements').mockRejectedValueOnce(new Error('Fixture failure'));
  const remove = screen.getByRole('button', { name: 'Remove The World from queue' });
  remove.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(remove).toBeEnabled());
  expect(remove).toHaveFocus();
  expect(screen.queryByText('Your queue and results are kept.')).not.toBeInTheDocument();
});
