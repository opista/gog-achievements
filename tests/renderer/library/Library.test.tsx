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
  localStorage.clear();
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
    userId: '123456789',
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

it('pins without selecting, keeps each group in library order, and searches both groups', async () => {
  const user = userEvent.setup();
  const values = [
    { id: '10', title: 'Alpha game' },
    { id: '90071992547409931234', title: 'Beta game' },
    { id: '30', title: 'Gamma game' },
    { id: '40', title: 'Delta game' },
  ];
  const { container, onSelect, props, rerender } = library({ games: values, gameId: '10' });
  const order = () => [...container.querySelectorAll('.game-title')].map((row) => row.textContent);
  await user.click(screen.getByRole('button', { name: 'Pin Delta game' }));
  await user.click(screen.getByRole('button', { name: 'Pin Beta game' }));
  expect(order()).toEqual(['Beta game', 'Delta game', 'Alpha game', 'Gamma game']);
  const unpin = screen.getByRole('button', { name: 'Unpin Beta game' });
  expect(unpin).toHaveAttribute('aria-pressed', 'true');
  expect(unpin).toHaveFocus();
  expect(unpin.closest('button')?.parentElement?.tagName).toBe('DIV');
  expect(screen.getByRole('button', { name: 'Alpha game' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(onSelect).not.toHaveBeenCalled();
  await user.type(screen.getByRole('textbox', { name: 'Search your library' }), 'game');
  expect(order()).toEqual(['Beta game', 'Delta game', 'Alpha game', 'Gamma game']);
  await user.click(screen.getByRole('button', { name: 'Unpin Beta game' }));
  expect(order()).toEqual(['Delta game', 'Alpha game', 'Beta game', 'Gamma game']);
  rerender(<Library {...props} games={values.slice(0, 3)} />);
  rerender(<Library {...props} games={values} />);
  expect(order()).toEqual(['Delta game', 'Alpha game', 'Beta game', 'Gamma game']);
  expect(onSelect).not.toHaveBeenCalled();
});

it('keeps pin and selection controls keyboard accessible, including while game data loads', async () => {
  const user = userEvent.setup();
  const { onSelect, props, rerender } = library();
  const first = screen.getByRole('button', { name: games[0]!.title });
  first.focus();
  await user.tab();
  const pin = screen.getByRole('button', { name: `Pin ${games[0]!.title}` });
  expect(pin).toHaveFocus();
  await user.keyboard(' ');
  expect(pin).toHaveAttribute('aria-pressed', 'true');
  expect(pin).toHaveFocus();
  rerender(<Library {...props} busy />);
  expect(pin).toHaveFocus();
  await user.tab({ shift: true });
  expect(first).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onSelect).not.toHaveBeenCalled();
  expect(first).toHaveAttribute('aria-disabled', 'true');
});

it('switches account pins immediately and keeps saved pins after sign-out and sign-in', async () => {
  const user = userEvent.setup();
  const { props, rerender } = library();
  await user.click(screen.getByRole('button', { name: `Pin ${games[1]!.title}` }));
  rerender(<Library {...props} userId="987654321" />);
  expect(screen.getByRole('button', { name: `Pin ${games[1]!.title}` })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  rerender(<Library {...props} signedIn={false} />);
  expect(screen.queryByRole('button', { name: /^Unpin / })).not.toBeInTheDocument();
  rerender(<Library {...props} />);
  expect(screen.getByRole('button', { name: `Unpin ${games[1]!.title}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
