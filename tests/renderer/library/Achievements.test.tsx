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
  const props = {
    achievements: input,
    queued,
    busy: false,
    demo: false,
    zone: 'UTC',
    onAdd,
    onRefresh: vi.fn(),
    ...overrides,
  };
  return { onAdd, props, ...render(<Achievements {...props} />) };
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
it('adds one achievement directly without checkboxes or a bulk action', async () => {
  const user = userEvent.setup();
  const { onAdd } = show();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add selected' })).not.toBeInTheDocument();
  const add = screen.getByRole('button', { name: 'Queue unlock for Locked A' });
  expect(add).toHaveAttribute('title', 'Queue unlock for Locked A');
  await user.click(add);
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(['locked-a']);
});
it('omits actions for queued and unlocked rows and blocks saves during other work', () => {
  const { props, rerender } = show(new Map([['locked-b', 'unlock']]));
  expect(
    screen.queryByRole('button', { name: 'Queue unlock for Locked B' }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('article', { name: 'Locked B' })).getByText('Unlock queued'),
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
  expect(screen.getByRole('heading', { name: 'Newest unlock' })).toHaveFocus();
  expect(screen.getByText('Lock queued')).toBeVisible();
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
    within(screen.getByRole('article', { name: 'Locked B' })).getByText('Lock queued'),
  ).toBeVisible();
  expect(
    within(screen.getByRole('article', { name: 'Newest unlock' })).getByText('Unlock queued'),
  ).toBeVisible();
  expect(
    within(screen.getByRole('article', { name: 'Locked B' })).queryByRole('button'),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('article', { name: 'Newest unlock' })).queryByRole('button'),
  ).not.toBeInTheDocument();
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
it('focuses a revealed queued title without a duplicate add action', async () => {
  const user = userEvent.setup();
  show(new Map([['secret', 'unlock']]));
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(screen.getByRole('heading', { name: 'Secret title' })).toHaveFocus();
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
  expect(screen.getByRole('heading', { name })).toHaveFocus();
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
