import { useRef } from 'react';
interface Props {
  pane: 'Library' | 'Queue';
  width: number | undefined;
  min: number;
  max: number;
  onResize(width: number): void;
}
export function PaneResize({ pane, width, min, max, onResize }: Props) {
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const direction = pane === 'Library' ? 1 : -1;
  function clamp(value: number): number {
    return Math.min(max, Math.max(min, value));
  }
  return (
    <div
      className={`pane-resizer pane-resizer-${pane.toLowerCase()}`}
      role="separator"
      aria-label={`Resize ${pane.toLowerCase()} pane`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width ?? min}
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          event.key !== 'ArrowLeft' &&
          event.key !== 'ArrowRight' &&
          event.key !== 'Home' &&
          event.key !== 'End'
        )
          return;
        event.preventDefault();
        const actual =
          event.currentTarget.parentElement?.getBoundingClientRect().width ?? width ?? min;
        onResize(
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : clamp(actual + (event.key === 'ArrowRight' ? 16 : -16) * direction),
        );
      }}
      onPointerDown={(event) => {
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          width: event.currentTarget.parentElement?.getBoundingClientRect().width ?? min,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || event.pointerId !== drag.current.pointer) return;
        onResize(clamp(drag.current.width + (event.clientX - drag.current.x) * direction));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}
