// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Achievements } from '../../../src/renderer/features/library/Achievements';
import { AchievementSkeleton } from '../../../src/renderer/features/library/AchievementSkeleton';
import type { ComponentProps } from 'react';
import type { Achievement, AchievementAction } from '../../../src/shared/api';
afterEach(cleanup);
function achievement(id: string, name: string, options: Partial<Achievement> = {}): Achievement {
  return {
    id,
    key: id,
    name,
    description: `${name} description`,
    unlocked: false,
    unlocked_at: null,
    hidden: false,
    image_locked: null,
    image_unlocked: null,
    rarity: null,
    ...options,
  };
}
const input = [
  achievement('old', 'Older unlock', { unlocked: true, unlocked_at: '2024-01-01T12:00:00Z' }),
  achievement('secret', 'Secret title', { hidden: true, description: 'Secret description' }),
  achievement('locked-b', 'Locked B'),
  achievement('new', 'Newest unlock', { unlocked: true, unlocked_at: '2025-01-01T12:00:00Z' }),
  achievement('locked-a', 'Locked A'),
];
function show(
  queued = new Map<string, AchievementAction>(),
  overrides: Partial<ComponentProps<typeof Achievements>> = {},
) {
  const onAdd = vi.fn();
  const onQueueAll = vi.fn();
  const onRemove = vi.fn();
  const props = {
    achievements: input,
    queued,
    busy: false,
    demo: false,
    zone: 'UTC',
    onAdd,
    onQueueAll,
    onRemove,
    onRefresh: vi.fn(),
    ...overrides,
  };
  return { onAdd, onQueueAll, onRemove, props, ...render(<Achievements {...props} />) };
}
function rowNames() {
  return screen.getAllByRole('article').map((row) => within(row).getByRole('heading').textContent);
}
it('shows descriptions and keeps locked, hidden, newest unlocked order without mutating input', () => {
  const original = input.map((item) => item.id);
  show();
  expect(rowNames()).toEqual([
    'Locked B',
    'Locked A',
    'Hidden achievement',
    'Newest unlock',
    'Older unlock',
  ]);
  expect(screen.getByText('Locked B description')).toBeVisible();
  expect(input.map((item) => item.id)).toEqual(original);
});
it('shows labelled current-state icons and retains exact unlock dates without an extra state line', () => {
  show();
  const locked = screen.getByRole('article', { name: 'Locked B' });
  const unlocked = screen.getByRole('article', { name: 'Newest unlock' });
  expect(within(locked).getByRole('img', { name: 'Locked' })).toBeVisible();
  expect(within(unlocked).getByRole('img', { name: 'Unlocked' })).toBeVisible();
  expect(within(locked).queryByText('Locked', { exact: true })).not.toBeInTheDocument();
  expect(unlocked.querySelector('time')).toHaveAttribute('datetime', '2025-01-01T12:00:00Z');
  expect(unlocked.querySelector('.achievement-unlock-date')).toHaveAttribute(
    'title',
    expect.stringContaining('read-only'),
  );
  expect(
    within(screen.getByRole('article', { name: 'Hidden achievement' })).queryByRole('img', {
      name: 'Locked',
    }),
  ).not.toBeInTheDocument();
});
it.each(['unlock', 'lock'] as const)(
  'removes a queued %s through its single action while preserving the description and focus',
  async (action) => {
    const user = userEvent.setup();
    const id = action === 'lock' ? 'new' : 'locked-a';
    const name = action === 'lock' ? 'Newest unlock' : 'Locked A';
    const actionName = action === 'lock' ? 'lock' : 'unlock';
    const { onRemove, onAdd, props, rerender } = show(new Map([[id, action]]), {
      supportsLocking: true,
    });
    const row = screen.getByRole('article', { name });
    expect(within(row).getByText(`${name} description`)).toBeVisible();
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    const undo = within(row).getByRole('button', { name: `Undo queued ${actionName} for ${name}` });
    undo.focus();
    await user.keyboard('{Enter}');
    expect(onRemove).toHaveBeenCalledExactlyOnceWith([id]);
    expect(onAdd).not.toHaveBeenCalled();
    rerender(<Achievements {...props} queued={new Map()} />);
    expect(screen.getByRole('button', { name: `Queue ${actionName} for ${name}` })).toHaveFocus();
    rerender(<Achievements {...props} busy />);
    expect(
      screen.getByRole('button', { name: `Undo queued ${actionName} for ${name}` }),
    ).toBeDisabled();
  },
);
it('adds one achievement directly without checkbox selection', async () => {
  const user = userEvent.setup();
  const { onAdd } = show();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add selected' })).not.toBeInTheDocument();
  const add = screen.getByRole('button', { name: 'Queue unlock for Locked A' });
  expect(add).toHaveAttribute('title', 'Queue unlock for Locked A');
  await user.click(add);
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(['locked-a']);
});
it('keeps queued unlocks and concealed details when requesting all eligible unlocks', async () => {
  const user = userEvent.setup();
  const { onQueueAll, onRemove, props, rerender } = show(new Map([['locked-b', 'unlock']]));
  const unlockAll = screen.getByRole('button', { name: 'Unlock all' });
  await user.click(unlockAll);
  expect(onQueueAll).toHaveBeenCalledExactlyOnceWith(['locked-a'], 'unlock');
  expect(onRemove).not.toHaveBeenCalled();
  expect(screen.queryByText('Secret title')).not.toBeInTheDocument();
  rerender(
    <Achievements
      {...props}
      queued={
        new Map([
          ['locked-b', 'unlock'],
          ['locked-a', 'unlock'],
        ])
      }
    />,
  );
  expect(unlockAll).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(unlockAll).toBeEnabled();
  await user.click(unlockAll);
  expect(onQueueAll).toHaveBeenLastCalledWith(['secret'], 'unlock');
});
it('includes eligible locks with opposite saved requests and revealed hidden unlocks', async () => {
  const user = userEvent.setup();
  const { onQueueAll } = show(new Map([['new', 'unlock']]), {
    supportsLocking: true,
    achievements: [
      ...input,
      achievement('hidden-unlocked', 'Revealed secret', {
        hidden: true,
        unlocked: true,
        unlocked_at: '2023-01-01T12:00:00Z',
      }),
      achievement('missing-date', 'Unknown date', { unlocked: true }),
    ],
  });
  await user.click(screen.getByRole('button', { name: 'Lock all' }));
  expect(onQueueAll).toHaveBeenCalledExactlyOnceWith(['new', 'old', 'hidden-unlocked'], 'lock');
});
it.each(['unlock', 'lock'] as const)(
  'allows bulk %s to remove opposite requests when there are no new eligible achievements',
  async (action) => {
    const { onQueueAll } = show(
      new Map([['outside-list', action === 'unlock' ? 'lock' : 'unlock']]),
      {
        achievements: [],
        supportsLocking: true,
      },
    );
    const name = action === 'unlock' ? 'Unlock all' : 'Lock all';
    const button = screen.getByRole('button', { name });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onQueueAll).toHaveBeenCalledExactlyOnceWith([], action);
  },
);
it('shows bulk actions for the active filter and hides unsupported locks', async () => {
  const user = userEvent.setup();
  const { props, rerender } = show(new Map(), { supportsLocking: true });
  expect(screen.getByRole('button', { name: 'Unlock all' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Lock all' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Locked' }));
  expect(screen.getByRole('button', { name: 'Unlock all' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Lock all' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Unlocked' }));
  expect(screen.getByRole('button', { name: 'Lock all' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Unlock all' })).not.toBeInTheDocument();
  rerender(<Achievements {...props} supportsLocking={false} />);
  expect(screen.queryByRole('button', { name: 'Lock all' })).not.toBeInTheDocument();
});
it.each(['busy', 'loading'] as const)('blocks bulk queue edits while %s', async (state) => {
  const user = userEvent.setup();
  const { onAdd, onQueueAll } = show(new Map(), { supportsLocking: true, [state]: true });
  for (const name of ['Unlock all', 'Lock all']) {
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    await user.click(button);
  }
  expect(onAdd).not.toHaveBeenCalled();
  expect(onQueueAll).not.toHaveBeenCalled();
});
it('shows one queued action and blocks saves during other work', () => {
  const { props, rerender } = show(new Map([['locked-b', 'unlock']]));
  expect(
    screen.queryByRole('button', { name: 'Queue unlock for Locked B' }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('article', { name: 'Locked B' })).getByText('Queued'),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Queue unlock for Newest unlock' }),
  ).not.toBeInTheDocument();
  rerender(<Achievements {...props} busy />);
  expect(screen.getByRole('button', { name: 'Queue unlock for Locked A' })).toBeDisabled();
});
it('queues an explicit lock only when supported and preserves keyboard focus', async () => {
  const user = userEvent.setup();
  const { onAdd, props, rerender } = show(new Map(), { supportsLocking: true });
  const lock = screen.getByRole('button', { name: 'Queue lock for Newest unlock' });
  lock.focus();
  await user.keyboard('{Enter}');
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(['new'], 'lock');
  rerender(<Achievements {...props} queued={new Map([['new', 'lock']])} />);
  expect(
    screen.queryByRole('button', { name: 'Queue lock for Newest unlock' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Undo queued lock for Newest unlock' })).toHaveFocus();
  expect(screen.getByText('Queued')).toBeVisible();
  rerender(<Achievements {...props} busy />);
  expect(screen.getByRole('button', { name: 'Queue lock for Newest unlock' })).toBeDisabled();
  rerender(<Achievements {...props} supportsLocking={false} />);
  expect(screen.queryByRole('button', { name: /Queue lock/ })).not.toBeInTheDocument();
});
it('labels queued actions from the saved request after the live state changes', () => {
  show(
    new Map([
      ['locked-b', 'lock'],
      ['new', 'unlock'],
    ]),
    { supportsLocking: true },
  );
  expect(
    within(screen.getByRole('article', { name: 'Locked B' })).getByRole('button', {
      name: 'Undo queued lock for Locked B',
    }),
  ).toBeVisible();
  expect(
    within(screen.getByRole('article', { name: 'Newest unlock' })).getByRole('button', {
      name: 'Undo queued unlock for Newest unlock',
    }),
  ).toBeVisible();
  expect(
    within(screen.getByRole('article', { name: 'Locked B' })).getAllByRole('button'),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole('article', { name: 'Newest unlock' })).getAllByRole('button'),
  ).toHaveLength(1);
});
it('conceals hidden information and focuses the direct add action after reveal', async () => {
  const user = userEvent.setup();
  show();
  expect(screen.queryByText('Secret title')).not.toBeInTheDocument();
  expect(screen.queryByText('Secret description')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(screen.getByText('Secret description')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Queue unlock for Secret title' })).toHaveFocus();
});
it('focuses the queued action after revealing a hidden achievement', async () => {
  const user = userEvent.setup();
  show(new Map([['secret', 'unlock']]));
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(screen.getByRole('button', { name: 'Undo queued unlock for Secret title' })).toHaveFocus();
  expect(
    screen.queryByRole('button', { name: 'Queue unlock for Secret title' }),
  ).not.toBeInTheDocument();
});

it.each([
  ['Locked B', 'locked-b', false],
  ['Secret title', 'secret', true],
] as const)('keeps keyboard focus on %s after it is queued', async (name, id, hidden) => {
  const user = userEvent.setup();
  const { onAdd, props, rerender } = show();
  if (hidden) await user.click(screen.getByRole('button', { name: 'Reveal' }));
  screen.getByRole('button', { name: `Queue unlock for ${name}` }).focus();
  await user.keyboard('{Enter}');
  expect(onAdd).toHaveBeenCalledExactlyOnceWith([id]);
  rerender(<Achievements {...props} queued={new Map([[id, 'unlock']])} />);
  expect(screen.getByRole('button', { name: `Undo queued unlock for ${name}` })).toHaveFocus();
});
it('keeps filters and refresh stable while skeleton rows load', async () => {
  const user = userEvent.setup();
  const { props, rerender } = show();
  const locked = screen.getByRole('button', { name: 'Locked' });
  await user.click(locked);
  const refresh = screen.getByRole('button', { name: 'Refresh achievements' });
  rerender(<Achievements {...props} loading />);
  expect(screen.getByRole('button', { name: 'Locked' })).toBe(locked);
  expect(locked).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Refresh achievements' })).toBe(refresh);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  rerender(<Achievements {...props} />);
  expect(rowNames()).toEqual(['Locked B', 'Locked A', 'Hidden achievement']);
});
it('keeps unlocked filtering read-only and newest first', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Unlocked' }));
  expect(rowNames()).toEqual(['Newest unlock', 'Older unlock']);
  expect(screen.queryByRole('button', { name: /Queue unlock for .*/ })).not.toBeInTheDocument();
});
it('announces skeleton status without placeholder controls', () => {
  const { container } = render(<AchievementSkeleton />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(container.querySelector('.skeleton-content')).toHaveAttribute('aria-hidden', 'true');
});

it('combines case-insensitive name and description searches with filters and every sort', async () => {
  const user = userEvent.setup();
  const { onAdd, onQueueAll, onRemove } = show();
  const search = screen.getByRole('textbox', { name: 'Search achievements' });
  const sort = screen.getByRole('combobox', { name: 'Sort achievements' });
  await user.type(search, '  LOCKED  ');
  expect(rowNames()).toEqual(['Locked B', 'Locked A']);
  await user.selectOptions(sort, 'A–Z');
  expect(rowNames()).toEqual(['Locked A', 'Locked B']);
  await user.clear(search);
  await user.type(search, '  UNLOCK  ');
  await user.click(screen.getByRole('button', { name: 'Unlocked' }));
  expect(rowNames()).toEqual(['Newest unlock', 'Older unlock']);
  await user.clear(search);
  await user.type(search, '  OLDER UNLOCK DESCRIPTION  ');
  for (const value of ['Default', 'A–Z', 'Newest unlocked', 'Queued first']) {
    await user.selectOptions(sort, value);
    expect(rowNames()).toEqual(['Older unlock']);
  }
  expect(onAdd).not.toHaveBeenCalled();
  expect(onQueueAll).not.toHaveBeenCalled();
  expect(onRemove).not.toHaveBeenCalled();
});

it('hides concealed search text until revealed and sorts on the visible name', async () => {
  const user = userEvent.setup();
  const { onQueueAll } = show();
  const search = screen.getByRole('textbox', { name: 'Search achievements' });
  const sort = screen.getByRole('combobox', { name: 'Sort achievements' });
  await user.selectOptions(sort, 'A–Z');
  expect(rowNames()[0]).toBe('Hidden achievement');
  for (const query of ['Secret title', 'Secret description']) {
    await user.clear(search);
    await user.type(search, query);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  }
  await user.click(screen.getByRole('button', { name: 'Clear achievement search' }));
  expect(search).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(rowNames().at(-1)).toBe('Secret title');
  await user.type(search, '  SECRET DESCRIPTION  ');
  expect(rowNames()).toEqual(['Secret title']);
  await user.click(screen.getByRole('button', { name: 'Unlock all' }));
  expect(onQueueAll).toHaveBeenCalledExactlyOnceWith(['secret'], 'unlock');
});

it('keeps search, sort and keyboard focus as queued rows move between groups', async () => {
  const user = userEvent.setup();
  const saved = new Map<string, AchievementAction>([['old', 'lock']]);
  const { onAdd, onRemove, props, rerender } = show(saved, { supportsLocking: true });
  const search = screen.getByRole('textbox', { name: 'Search achievements' });
  const sort = screen.getByRole('combobox', { name: 'Sort achievements' });
  await user.type(search, 'locked');
  await user.click(screen.getByRole('button', { name: 'Locked' }));
  await user.selectOptions(sort, 'Queued first');
  expect(rowNames()).toEqual(['Locked B', 'Locked A']);
  screen.getByRole('button', { name: 'Queue unlock for Locked A' }).focus();
  await user.keyboard('{Enter}');
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(['locked-a']);
  rerender(<Achievements {...props} queued={new Map([...saved, ['locked-a', 'unlock']])} />);
  expect(rowNames()).toEqual(['Locked A', 'Locked B']);
  expect(screen.getByRole('button', { name: 'Undo queued unlock for Locked A' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(['locked-a']);
  rerender(<Achievements {...props} />);
  expect(rowNames()).toEqual(['Locked B', 'Locked A']);
  expect(screen.getByRole('button', { name: 'Queue unlock for Locked A' })).toHaveFocus();
  expect(search).toHaveValue('locked');
  expect(sort).toHaveValue('Queued first');
  await user.click(screen.getByRole('button', { name: 'Clear achievement search' }));
  await user.click(screen.getByRole('button', { name: 'All' }));
  expect(rowNames()[0]).toBe('Older unlock');
  expect(screen.getByRole('button', { name: 'Undo queued lock for Older unlock' })).toBeVisible();
  expect([...saved]).toEqual([['old', 'lock']]);
});

it.each([
  ['unlock', 'Locked', '  LOCKED A DESCRIPTION  ', 'locked-a'],
  ['lock', 'Unlocked', '  NEWEST UNLOCK DESCRIPTION  ', 'new'],
] as const)(
  'bulk %s uses only eligible search and filter results',
  async (action, filter, query, id) => {
    const user = userEvent.setup();
    const { onQueueAll, props, rerender } = show(
      new Map([
        ['locked-b', 'unlock'],
        ['old', 'lock'],
      ]),
      { supportsLocking: true },
    );
    await user.type(screen.getByRole('textbox', { name: 'Search achievements' }), query);
    await user.click(screen.getByRole('button', { name: filter }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort achievements' }), 'A–Z');
    const button = screen.getByRole('button', {
      name: action === 'unlock' ? 'Unlock all' : 'Lock all',
    });
    await user.click(button);
    expect(onQueueAll).toHaveBeenCalledExactlyOnceWith([id], action);
    rerender(<Achievements {...props} queued={new Map([[id, action]])} />);
    expect(button).toBeDisabled();
    rerender(
      <Achievements
        {...props}
        queued={
          new Map([
            [id, action],
            ['outside-search', action === 'unlock' ? 'lock' : 'unlock'],
          ])
        }
      />,
    );
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onQueueAll).toHaveBeenLastCalledWith([], action);
  },
);

it('clears search and status together from an empty result without resetting sort', async () => {
  const user = userEvent.setup();
  show();
  const search = screen.getByRole('textbox', { name: 'Search achievements' });
  const sort = screen.getByRole('combobox', { name: 'Sort achievements' });
  await user.selectOptions(sort, 'A–Z');
  await user.click(screen.getByRole('button', { name: 'Locked' }));
  await user.type(search, 'no matching achievement');
  expect(screen.getByText('No achievements match this search and filter.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(sort).toHaveValue('A–Z');
  expect(rowNames()).toHaveLength(input.length);
});

it('keeps search and sort controls stable across loading and disables queue edits', async () => {
  const user = userEvent.setup();
  const { props, rerender } = show();
  const search = screen.getByRole('textbox', { name: 'Search achievements' });
  const sort = screen.getByRole('combobox', { name: 'Sort achievements' });
  await user.type(search, 'Locked');
  await user.selectOptions(sort, 'A–Z');
  rerender(<Achievements {...props} loading />);
  expect(screen.getByRole('textbox', { name: 'Search achievements' })).toBe(search);
  expect(screen.getByRole('combobox', { name: 'Sort achievements' })).toBe(sort);
  expect(search).toHaveValue('Locked');
  expect(sort).toHaveValue('A–Z');
  expect(screen.getByRole('button', { name: 'Unlock all' })).toBeDisabled();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  rerender(<Achievements {...props} busy />);
  expect(rowNames()).toEqual(['Locked A', 'Locked B']);
  expect(screen.getByRole('button', { name: 'Queue unlock for Locked A' })).toBeDisabled();
});
