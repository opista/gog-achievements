// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Library } from '../../src/renderer/features/Library';
import type { Game } from '../../src/shared/api';
afterEach(cleanup);
const games: Game[] = [
  { id: '1', title: 'Cyberpunk 2077', image: 'https://images.gog-statics.com/demo-image.jpg' },
  {
    id: '2',
    title: 'A very long game title that stays available in its complete hover tooltip',
    image: null,
  },
];
function library() {
  const onSelect = vi.fn();
  const view = render(
    <Library
      games={games}
      gameId="1"
      signedIn
      loaded
      busy={false}
      demo={false}
      onSelect={onSelect}
      onRefresh={vi.fn()}
      onResize={vi.fn()}
    />,
  );
  return { onSelect, ...view };
}
it('retains compact cover artwork and exposes complete game titles and selection', async () => {
  const user = userEvent.setup();
  const { onSelect, container } = library();
  expect(container.querySelector('.game-row img')).toBeInTheDocument();
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
