// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Achievements } from '../../src/renderer/features/Achievements';
import { AchievementSkeleton } from '../../src/renderer/features/AchievementSkeleton';
import type { ComponentProps } from 'react';
import type { Achievement } from '../../src/shared/api';
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
    image_locked: 'https://images.gog-statics.com/achievement.jpg',
    image_unlocked: 'https://images.gog-statics.com/achievement.jpg',
    rarity: null,
    ...options,
  };
}
const input = [
  achievement('old', 'Older unlock', { unlocked: true, unlocked_at: '2024-01-01T12:00:00Z' }),
  achievement('secret', 'Secret title', { hidden: true, description: 'Secret description' }),
  achievement('locked-b', 'Locked B'),
  achievement('unknown', 'Unknown date unlock', { unlocked: true }),
  achievement('new', 'Newest unlock', { unlocked: true, unlocked_at: '2025-01-01T12:00:00Z' }),
  achievement('locked-a', 'Locked A'),
];
function show(
  queued = new Set<string>(),
  overrides: Partial<ComponentProps<typeof Achievements>> = {},
) {
  const onAdd = vi.fn();
  const props: ComponentProps<typeof Achievements> = {
    achievements: input,
    queued,
    busy: false,
    demo: false,
    zone: 'UTC',
    onAdd,
    onRefresh: vi.fn(),
    ...overrides,
  };
  const view = render(<Achievements {...props} />);
  return { onAdd, props, ...view };
}
function rowNames(): string[] {
  return screen
    .getAllByRole('article')
    .map((row) => within(row).getByRole('heading').textContent ?? '');
}
it('shows descriptions directly and sorts locked, hidden, then newest unlocks without mutating input', () => {
  const order = input.map((item) => item.id);
  show();
  expect(rowNames()).toEqual([
    'Locked B',
    'Locked A',
    'Hidden achievement',
    'Newest unlock',
    'Older unlock',
    'Unknown date unlock',
  ]);
  expect(screen.getByText('Locked B description')).toBeVisible();
  expect(screen.getByText('Newest unlock description')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Details for/ })).not.toBeInTheDocument();
  expect(input.map((item) => item.id)).toEqual(order);
});
it('omits unlocked and concealed checkboxes, preserves reveal, and focuses its new selection', async () => {
  const user = userEvent.setup();
  const { container } = show();
  expect(screen.queryByRole('checkbox', { name: 'Select Newest unlock' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: 'Select Hidden achievement' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Secret title')).not.toBeInTheDocument();
  expect(screen.queryByText('Secret description')).not.toBeInTheDocument();
  expect(container.querySelector('.achievement-row img')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(screen.getByText('Secret description')).toBeVisible();
  const selection = screen.getByRole('checkbox', { name: 'Select Secret title' });
  expect(selection).toBeEnabled();
  expect(selection).toHaveFocus();
  expect(rowNames()).toEqual([
    'Locked B',
    'Locked A',
    'Secret title',
    'Newest unlock',
    'Older unlock',
    'Unknown date unlock',
  ]);
});
it('keeps focus on a revealed queued achievement without enabling duplicate selection', async () => {
  const user = userEvent.setup();
  show(new Set(['secret']));
  await user.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(screen.getByRole('checkbox', { name: 'Select Secret title' })).toBeDisabled();
  expect(screen.getByRole('heading', { name: 'Secret title' })).toHaveFocus();
});
it('adds only selected eligible achievements and keeps queued additions unavailable', async () => {
  const user = userEvent.setup();
  const { onAdd } = show(new Set(['locked-b']));
  expect(screen.queryByRole('button', { name: 'Queued' })).not.toBeInTheDocument();
  const queuedRow = screen.getByRole('article', { name: 'Locked B' });
  expect(within(queuedRow).getByText('Queued')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Select Locked B' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Select Locked B' })).toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: 'Select Locked A' }));
  await user.click(screen.getByRole('button', { name: 'Add selected' }));
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(['locked-a']);
  expect(screen.getByRole('button', { name: 'Add selected' })).toBeDisabled();
});
it('does not retain an eligible addition when refresh removes the selected achievement', async () => {
  const user = userEvent.setup();
  const { onAdd, rerender } = show();
  await user.click(screen.getByRole('checkbox', { name: 'Select Locked A' }));
  expect(screen.getByRole('button', { name: 'Add selected' })).toBeEnabled();
  rerender(
    <Achievements
      achievements={input.filter((item) => item.id !== 'locked-a')}
      queued={new Set()}
      busy={false}
      demo={false}
      zone="UTC"
      onAdd={onAdd}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Add selected' })).toBeDisabled();
  expect(onAdd).not.toHaveBeenCalled();
});
it('preserves descending unlock dates when filtering to unlocked achievements', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Unlocked' }));
  expect(rowNames()).toEqual(['Newest unlock', 'Older unlock', 'Unknown date unlock']);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('announces one skeleton loading state and hides placeholder rows from assistive controls', () => {
  const { container } = render(<AchievementSkeleton />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Loading achievements…');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(container.querySelector('.skeleton-content')).toHaveAttribute('aria-hidden', 'true');
});

it('keeps toolbar, filter and selection state while loading only the achievement list', async () => {
  const user = userEvent.setup();
  const { props, rerender, container } = show();
  const lockedFilter = screen.getByRole('button', { name: 'Locked' });
  const add = screen.getByRole('button', { name: 'Add selected' });
  const refresh = screen.getByRole('button', { name: 'Refresh achievements' });
  const refreshIcon = refresh.querySelector('svg');
  await user.click(lockedFilter);
  await user.click(screen.getByRole('checkbox', { name: 'Select Locked A' }));
  rerender(<Achievements {...props} loading />);
  expect(screen.getByRole('button', { name: 'Locked' })).toBe(lockedFilter);
  expect(lockedFilter).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Add selected' })).toBe(add);
  expect(add).toBeDisabled();
  expect(refresh.querySelector('svg')).toBe(refreshIcon);
  expect(refreshIcon).toHaveClass('spinner');
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Loading achievements…');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(container.querySelector('.achievement-list .achievement-skeleton')).toBeInTheDocument();
  expect(screen.queryByText('No achievements available for this game.')).not.toBeInTheDocument();
  rerender(<Achievements {...props} loading={false} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select Locked A' })).toBeChecked();
  expect(screen.queryByRole('article', { name: 'Newest unlock' })).not.toBeInTheDocument();
  expect(add).toBeEnabled();
});
it('shows a stable saving button and prevents repeated additions during an optimistic save', async () => {
  const user = userEvent.setup();
  const { props, onAdd, rerender } = show();
  await user.click(screen.getByRole('checkbox', { name: 'Select Locked A' }));
  const add = screen.getByRole('button', { name: 'Add selected' });
  await user.click(add);
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(['locked-a']);
  rerender(<Achievements {...props} queued={new Set(['locked-a'])} adding />);
  const saving = screen.getByRole('button', { name: 'Saving…' });
  expect(saving).toBe(add);
  expect(saving).toHaveClass('achievement-add-button');
  expect(saving).toHaveAttribute('aria-busy', 'true');
  expect(saving.querySelector('svg')).toHaveClass('spinner');
  expect(saving).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Select Locked A' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select Locked A' })).toBeDisabled();
  await user.click(saving);
  expect(onAdd).toHaveBeenCalledOnce();
  rerender(<Achievements {...props} queued={new Set(['locked-a'])} adding={false} />);
  expect(screen.getByRole('button', { name: 'Add selected' })).toBe(add);
  expect(add).toHaveAttribute('aria-busy', 'false');
  expect(add).toBeDisabled();
});
it('supports a specific loading label without replacing the real toolbar', () => {
  const { container } = render(<AchievementSkeleton label="Refreshing achievements…" />);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Refreshing achievements…');
  expect(container.querySelector('.skeleton-toolbar')).not.toBeInTheDocument();
});
