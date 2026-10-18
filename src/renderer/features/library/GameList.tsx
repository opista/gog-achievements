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
  onTogglePin(gameId: string): void;
  onSelect(game: Game): void;
}

type Control = 'select' | 'pin';

interface RowProps extends Omit<Props, 'games'> {
  game: Game;
  index?: number;
  onFocus?(): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>, control: Control): void;
}

function GameRow({
  game,
  gameId,
  busy,
  demo,
  onSelect,
  pinnedIds,
  canPin,
  onTogglePin,
  index,
  onFocus,
  onKeyDown,
}: RowProps) {
  const pinButton = useRef<HTMLButtonElement>(null);
  const restorePinFocus = useRef(false);
  const pinned = pinnedIds.has(game.id);
  const pinLabel = `${pinned ? 'Unpin' : 'Pin'} ${game.title}`;
  useLayoutEffect(() => {
    // DOM moves can drop focus even though the row keeps its stable game key.
    if (!restorePinFocus.current) return;
    restorePinFocus.current = false;
    pinButton.current?.focus({ preventScroll: true });
    pinButton.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
  return (
    <div className={`game-list-row ${game.id === gameId ? 'selected' : ''}`}>
      <button
        className={`game-row ${game.id === gameId ? 'selected' : ''}`}
        data-game-index={index}
        data-game-control="select"
        title={game.title}
        aria-disabled={busy}
        aria-pressed={game.id === gameId}
        onClick={() => {
          if (!busy) onSelect(game);
        }}
        onFocus={onFocus}
        onKeyDown={(event) => onKeyDown?.(event, 'select')}
      >
        <Art image={game.image} name={game.title} demo={demo} />
        <span className="game-title">{game.title}</span>
      </button>
      <button
        ref={pinButton}
        className="game-pin icon-button"
        data-game-index={index}
        data-game-control="pin"
        aria-label={pinLabel}
        title={pinLabel}
        aria-pressed={pinned}
        disabled={!canPin}
        onClick={(event) => {
          restorePinFocus.current = document.activeElement === event.currentTarget;
          onTogglePin(game.id);
        }}
        onFocus={onFocus}
        onKeyDown={(event) => onKeyDown?.(event, 'pin')}
      >
        <Pin size={15} aria-hidden="true" fill={pinned ? 'currentColor' : 'none'} />
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

function VirtualGameList({ games, ...rowProps }: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const horizontal = useSyncExternalStore(subscribeToLayout, isHorizontal);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFocus = useRef<{ index: number; control: Control } | null>(null);
  const previousLayout = useRef(horizontal);
  const previousGames = useRef(games);
  const focusedIndex = useMemo(
    () => games.findIndex((game) => game.id === focusedId),
    [games, focusedId],
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
    if (previousLayout.current === horizontal) return;
    previousLayout.current = horizontal;
    virtualizer.measure();
    const selectedIndex = games.findIndex((game) => game.id === rowProps.gameId);
    virtualizer.scrollToIndex(Math.max(0, focusedIndex >= 0 ? focusedIndex : selectedIndex));
  }, [horizontal, virtualizer, games, rowProps.gameId, focusedIndex]);

  useLayoutEffect(() => {
    if (previousGames.current === games) return;
    previousGames.current = games;
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
  }, [games, focusedIndex, virtualizer]);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const button = canvas.current?.querySelector<HTMLButtonElement>(
      `[data-game-index="${pendingFocus.current.index}"][data-game-control="${pendingFocus.current.control}"]`,
    );
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });

  function moveFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    control: Control,
  ): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let target: number;
    let targetControl = control;
    if (event.key === 'Tab') {
      // Use native Tab within each row; bridge only the virtual row boundaries.
      if ((!event.shiftKey && control === 'select') || (event.shiftKey && control === 'pin'))
        return;
      target = index + (event.shiftKey ? -1 : 1);
      targetControl = event.shiftKey ? 'pin' : 'select';
    } else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = games.length - 1;
    else if (event.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) target = index + 1;
    else if (event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) target = index - 1;
    else return;
    if (target < 0 || target >= games.length) return;
    event.preventDefault();
    pendingFocus.current = { index: target, control: targetControl };
    setFocusedId(games[target]!.id);
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
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
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
            index={item.index}
            onFocus={() => setFocusedId(games[item.index]!.id)}
            onKeyDown={(event, control) => moveFocus(event, item.index, control)}
          />
        </div>
      ))}
    </div>
  );
}

export function GameList(props: Props) {
  if (props.games.length > VIRTUAL_THRESHOLD) return <VirtualGameList {...props} />;
  return props.games.map((game, index) => (
    <GameRow {...props} key={game.id} game={game} index={index} />
  ));
}
