import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Pin } from 'lucide-react';
import type { Game } from '../../../shared/api';
import { Art } from '../../components/Art';

const VIRTUAL_THRESHOLD = 100;
const ROW_HEIGHT = 40;
const MOBILE_ROW_WIDTH = 190;
const MOBILE_GAP = 6;
const MOBILE_QUERY = '(max-width: 780px)';

interface Props {
  games: Game[];
  gameId?: string;
  busy: boolean;
  demo: boolean;
  pinnedIds: ReadonlySet<string>;
  canPin: boolean;
  onSelect(game: Game): void;
  onTogglePin(gameId: string): void;
}

type GameControl = 'select' | 'pin';
interface GameFocus {
  id: string;
  control: GameControl;
}

interface RowProps extends Pick<
  Props,
  'gameId' | 'busy' | 'demo' | 'onSelect' | 'canPin' | 'onTogglePin'
> {
  game: Game;
  pinned: boolean;
  index?: number;
  onFocus?(control: GameControl): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>, control: GameControl): void;
}

function GameRow({
  game,
  gameId,
  busy,
  demo,
  onSelect,
  onTogglePin,
  canPin,
  pinned,
  index,
  onFocus,
  onKeyDown,
}: RowProps) {
  const pin = useRef<HTMLButtonElement>(null);
  const restorePinFocus = useRef(false);
  useLayoutEffect(() => {
    if (!restorePinFocus.current) return;
    restorePinFocus.current = false;
    pin.current?.focus({ preventScroll: true });
    if (!onKeyDown) pin.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [pinned, onKeyDown]);
  return (
    <div className={`game-row ${game.id === gameId ? 'selected' : ''}`}>
      <button
        className="game-select"
        data-game-index={index}
        data-game-control="select"
        title={game.title}
        aria-disabled={busy}
        aria-pressed={game.id === gameId}
        onClick={() => {
          if (!busy) onSelect(game);
        }}
        onFocus={() => onFocus?.('select')}
        onKeyDown={(event) => onKeyDown?.(event, 'select')}
      >
        <Art image={game.image} name={game.title} demo={demo} />
        <span className="game-title">{game.title}</span>
      </button>
      <button
        ref={pin}
        className="icon-button game-pin"
        data-game-index={index}
        data-game-control="pin"
        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${game.title}`}
        title={`${pinned ? 'Unpin' : 'Pin'} ${game.title}`}
        aria-pressed={pinned}
        disabled={!canPin}
        onFocus={() => onFocus?.('pin')}
        onKeyDown={(event) => onKeyDown?.(event, 'pin')}
        onClick={() => {
          restorePinFocus.current = document.activeElement === pin.current;
          onTogglePin(game.id);
        }}
      >
        <Pin size={16} aria-hidden="true" fill={pinned ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

function subscribeToLayout(callback: () => void): () => void {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function isHorizontal(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function VirtualGameList({ games, pinnedIds, ...rowProps }: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const horizontal = useSyncExternalStore(subscribeToLayout, isHorizontal);
  const [focused, setFocused] = useState<GameFocus | null>(null);
  const pendingFocus = useRef<GameFocus | null>(null);
  const previousLayout = useRef(horizontal);
  const previousGames = useRef(games);
  const focusedIndex = useMemo(
    () => games.findIndex((game) => game.id === focused?.id),
    [games, focused?.id],
  );
  const getItemKey = useCallback((index: number) => games[index]!.id, [games]);
  // Keep the focused button mounted when a pointer scroll moves it out of view.
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
      return indexes.sort((a, b) => a - b);
    },
    [focusedIndex],
  );
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: games.length,
    getScrollElement: () => canvas.current?.parentElement ?? null,
    getItemKey,
    estimateSize: () => (horizontal ? MOBILE_ROW_WIDTH : ROW_HEIGHT),
    horizontal,
    gap: horizontal ? MOBILE_GAP : 0,
    overscan: 5,
    rangeExtractor,
  });

  useLayoutEffect(() => {
    const layoutChanged = previousLayout.current !== horizontal;
    const orderChanged = previousGames.current !== games;
    previousLayout.current = horizontal;
    previousGames.current = games;
    if (!layoutChanged && !(orderChanged && focusedIndex >= 0)) return;
    if (layoutChanged) virtualizer.measure();
    const selectedIndex = games.findIndex((game) => game.id === rowProps.gameId);
    virtualizer.scrollToIndex(Math.max(0, focusedIndex >= 0 ? focusedIndex : selectedIndex));
    if (focused) pendingFocus.current = focused;
  }, [horizontal, virtualizer, games, rowProps.gameId, focusedIndex, focused]);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const index = games.findIndex((game) => game.id === pendingFocus.current?.id);
    const button = canvas.current?.querySelector<HTMLButtonElement>(
      `[data-game-index="${index}"][data-game-control="${pendingFocus.current.control}"]`,
    );
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });

  function moveFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    control: GameControl,
  ): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let target: number;
    let nextControl = control;
    if (event.key === 'Tab') {
      if (
        rowProps.canPin &&
        ((control === 'select' && !event.shiftKey) || (control === 'pin' && event.shiftKey))
      ) {
        target = index;
      } else target = index + (event.shiftKey ? -1 : 1);
      nextControl = rowProps.canPin && event.shiftKey ? 'pin' : 'select';
      if (target === index) nextControl = control === 'select' ? 'pin' : 'select';
    } else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = games.length - 1;
    else if (event.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) target = index + 1;
    else if (event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) target = index - 1;
    else return;
    if (target < 0 || target >= games.length) return;
    event.preventDefault();
    pendingFocus.current = { id: games[target]!.id, control: nextControl };
    setFocused(pendingFocus.current);
    virtualizer.scrollToIndex(target, { align: 'auto' });
  }

  return (
    <div
      className="virtual-game-list"
      ref={canvas}
      role="list"
      aria-label="Games"
      style={
        horizontal
          ? { width: virtualizer.getTotalSize(), height: ROW_HEIGHT }
          : { height: virtualizer.getTotalSize() }
      }
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <div
          className="virtual-game-row"
          key={item.key}
          role="listitem"
          aria-posinset={item.index + 1}
          aria-setsize={games.length}
          style={
            horizontal
              ? { width: MOBILE_ROW_WIDTH, transform: `translateX(${item.start}px)` }
              : { transform: `translateY(${item.start}px)` }
          }
        >
          <GameRow
            {...rowProps}
            game={games[item.index]!}
            pinned={pinnedIds.has(games[item.index]!.id)}
            index={item.index}
            onFocus={(control) => setFocused({ id: games[item.index]!.id, control })}
            onKeyDown={(event, control) => moveFocus(event, item.index, control)}
            onTogglePin={(id) => {
              pendingFocus.current = { id, control: 'pin' };
              setFocused(pendingFocus.current);
              rowProps.onTogglePin(id);
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function GameList(props: Props) {
  if (props.games.length > VIRTUAL_THRESHOLD) return <VirtualGameList {...props} />;
  return props.games.map((game) => (
    <GameRow {...props} key={game.id} game={game} pinned={props.pinnedIds.has(game.id)} />
  ));
}
