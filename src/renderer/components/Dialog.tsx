import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose(): void;
  busy?: boolean;
  wide?: boolean;
}
const FOCUSABLE =
  'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href],[tabindex="0"]';
export function Dialog({ title, children, footer, onClose, busy = false, wide = false }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target =
      ref.current?.querySelector<HTMLElement>('[data-initial-focus]') ??
      ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            closeRef.current();
          }
          if (event.key !== 'Tab') return;
          const controls = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            aria-label={`Close ${title}`}
            disabled={busy}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">{footer}</div>
      </div>
    </div>
  );
}
