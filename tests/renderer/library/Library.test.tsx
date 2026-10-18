// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Library } from '../../../src/renderer/features/library/Library';
import type { ComponentProps } from 'react';
import type { Game } from '../../../src/shared/api';
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
const games: Game[] = [
  { id: '1', title: 'Cyberpunk 2077', image: 'https://images.gog-statics.com/demo-image.jpg' },
  {
    id: '2',
    title: 'A very long game title that stays available in its complete hover tooltip',
    image: null,
  },
];
function library(overrides: Partial<ComponentProps<typeof Library>> = {}) {
  const onSelect = vi.fn();
  const props: ComponentProps<typeof Library> = {
    games,
    gameId: '1',
    signedIn: true,
    userId: 'account-a',
    loaded: true,
    busy: false,
    demo: false,
    onSelect,
    onRefresh: vi.fn(),
    onResize: vi.fn(),
    ...overrides,
  };
  const view = render(<Library {...props} />);
  return { onSelect, props, ...view };
}
it('retains compact cover artwork and exposes complete game titles and selection', async () => {
  const user = userEvent.setup();
  const { onSelect, container } = library();
  expect(container.querySelector('.game-row img')).toBeInTheDocument();
  expect(container.querySelector('.game-completion')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cyberpunk 2077' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const longGame = screen.getByRole('button', { name: games[1]!.title });
  expect(longGame).toHaveAttribute('title', games[1]!.title);
  await user.click(longGame);
  expect(onSelect).toHaveBeenCalledWith(games[1]);
});
it('clears search with an accessible X and returns focus to the search field', async () => {
  const user = userEvent.setup();
  library();
  const search = screen.getByRole('textbox', { name: 'Search your library' });
  await user.type(search, 'cyber');
  expect(screen.queryByRole('button', { name: games[1]!.title })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear library search' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(screen.getByRole('button', { name: games[1]!.title })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Clear library search' })).not.toBeInTheDocument();
});

it('keeps the search and refresh controls in place while refreshing the library', async () => {
  const user = userEvent.setup();
  const { container, props, rerender } = library();
  const search = screen.getByRole('textbox', { name: 'Search your library' });
  const refresh = screen.getByRole('button', { name: 'Refresh library' });
  const refreshIcon = refresh.querySelector('svg');
  await user.type(search, 'cyber');
  rerender(<Library {...props} loading />);
  expect(screen.getByRole('textbox', { name: 'Search your library' })).toBe(search);
  expect(search).toHaveValue('cyber');
  expect(screen.getByRole('button', { name: 'Refresh library' })).toBe(refresh);
  expect(refresh.querySelector('svg')).toBe(refreshIcon);
  expect(refreshIcon).toHaveClass('spinner');
  expect(refresh).toBeDisabled();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Loading games…');
  expect(container.querySelector('.library-skeleton')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cyberpunk 2077' })).not.toBeInTheDocument();
  expect(screen.queryByText('No GOG games found.')).not.toBeInTheDocument();
  rerender(<Library {...props} loading={false} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(refreshIcon).not.toHaveClass('spinner');
  expect(screen.getByRole('button', { name: 'Cyberpunk 2077' })).toBeVisible();
  expect(screen.queryByRole('button', { name: games[1]!.title })).not.toBeInTheDocument();
});
it('shows local loading placeholders before treating a loaded empty library as empty', () => {
  const { props, rerender } = library({ games: [], loaded: false, loading: true });
  expect(screen.getByRole('status')).toHaveTextContent('Loading games…');
  expect(screen.queryByText('Library could not be loaded.')).not.toBeInTheDocument();
  expect(screen.queryByText('No GOG games found.')).not.toBeInTheDocument();
  rerender(<Library {...props} loaded loading={false} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('No GOG games found.')).toBeVisible();
});

it('leaves the signed-out library blank without a repeated sign-in prompt', () => {
  const { container } = library({ signedIn: false, games: [], loaded: false });
  expect(container.querySelector('.library-list')).toBeEmptyDOMElement();
  expect(screen.getByRole('textbox', { name: 'Search your library' })).toBeDisabled();
});

it('pins without selecting a game, keeps stable group order and searches both groups', async () => {
  const user = userEvent.setup();
  const orderedGames = [
    { id: '1', title: 'Game A' },
    { id: '2', title: 'Game B' },
    { id: '3', title: 'Game C' },
    { id: '4', title: 'Game D' },
  ];
  const { container, onSelect } = library({ games: orderedGames });
  const titles = () =>
    [...container.querySelectorAll('.game-title')].map((node) => node.textContent);
  await user.click(screen.getByRole('button', { name: 'Pin Game D' }));
  await user.click(screen.getByRole('button', { name: 'Pin Game B' }));
  expect(titles()).toEqual(['Game B', 'Game D', 'Game A', 'Game C']);
  expect(onSelect).not.toHaveBeenCalled();
  const pin = screen.getByRole('button', { name: 'Unpin Game B' });
  expect(pin).toHaveAttribute('aria-pressed', 'true');
  expect(pin).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Game A' })).toHaveAttribute('aria-pressed', 'true');
  const search = screen.getByRole('textbox', { name: 'Search your library' });
  await user.type(search, 'Game');
  expect(titles()).toEqual(['Game B', 'Game D', 'Game A', 'Game C']);
  await user.clear(search);
  await user.type(search, 'Game C');
  expect(titles()).toEqual(['Game C']);
  await user.click(screen.getByRole('button', { name: 'Clear library search' }));
  await user.click(screen.getByRole('button', { name: 'Unpin Game B' }));
  expect(titles()).toEqual(['Game D', 'Game A', 'Game B', 'Game C']);
  expect(screen.getByRole('button', { name: 'Pin Game B' })).toHaveFocus();
});

it('keeps pin preferences through a library refresh and scopes them to the current account', async () => {
  const user = userEvent.setup();
  const { props, rerender } = library();
  await user.click(screen.getByRole('button', { name: `Pin ${games[1]!.title}` }));
  rerender(<Library {...props} loading />);
  rerender(<Library {...props} games={[...games]} />);
  expect(screen.getByRole('button', { name: `Unpin ${games[1]!.title}` })).toBeVisible();
  rerender(<Library {...props} userId="account-b" />);
  expect(screen.getByRole('button', { name: `Pin ${games[1]!.title}` })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  rerender(<Library {...props} signedIn={false} />);
  rerender(<Library {...props} />);
  expect(screen.getByRole('button', { name: `Unpin ${games[1]!.title}` })).toBeVisible();
});

it('keeps keyboard selection focus while achievement reads are busy', async () => {
  const user = userEvent.setup();
  const { props, rerender, onSelect } = library();
  const selected = screen.getByRole('button', { name: 'Cyberpunk 2077' });
  selected.focus();
  rerender(<Library {...props} busy />);
  expect(selected).toHaveFocus();
  expect(selected).toHaveAttribute('aria-disabled', 'true');
  await user.keyboard('{Enter}');
  expect(onSelect).not.toHaveBeenCalled();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Pin Cyberpunk 2077' })).toHaveFocus();
  await user.keyboard(' ');
  expect(screen.getByRole('button', { name: 'Unpin Cyberpunk 2077' })).toHaveFocus();
});
