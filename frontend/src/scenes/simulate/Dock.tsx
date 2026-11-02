import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ChevronUp } from 'lucide-react';
import { cx } from '../../design/cx';
import './dock.css';

/**
 * The card kept beside the picture on a wide screen: a column of its own that is as tall as what it holds and scrolls only
 * where the screen is too short for that.
 */
export function SideCard({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside className={cx('sw-side sw-glass sw-glass--overlay', className)} aria-label={label}>
      <div className="sw-side__scroll">{children}</div>
    </aside>
  );
}

export interface DockProps {
  /** A narrow screen: the details are a fold that opens above one line, instead of a column beside the picture. */
  compact: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  /** What the one line says, with the fold closed. */
  peek: ReactNode;
  /** A line that stays in view while the fold is closed. */
  glance?: ReactNode;
  /** The details, which open above the line. */
  fold?: ReactNode;
  /** Chosen in the picture: the fold opens by itself when this changes to a value, since what was chosen is what it is for. */
  opensWith?: string | null;
  /** Below the line: the controls of the stage. */
  children?: ReactNode;
  dockRef?: (element: HTMLDivElement | null) => void;
}

/**
 * The bottom of the stage. One surface holds everything that floats there, so that the picture is not under a stack of
 * pills: on a wide screen a line on what is happening and the controls of playback; on a narrow one the same, with the
 * details of the round opening upward from the line that says what it is about.
 */
export function Dock({
  compact,
  open,
  onOpenChange,
  label,
  peek,
  glance,
  fold,
  opensWith,
  children,
  dockRef,
}: DockProps) {
  const body = useId();
  const change = useRef(onOpenChange);
  useEffect(() => {
    change.current = onOpenChange;
  });
  useEffect(() => {
    if (opensWith) change.current(true);
  }, [opensWith]);
  const folded = compact && fold !== undefined;
  return (
    <div
      ref={dockRef}
      className={cx('sw-sim-dock', compact && 'sw-sim-dock--compact', folded && open && 'is-open')}
    >
      <section className="sw-sim-dock__card sw-glass sw-glass--overlay" aria-label={label}>
        {folded && (
          <>
            <div className="sw-sim-dock__fold" id={body} inert={!open || undefined}>
              <div className="sw-sim-dock__scroll">
                <div className="sw-sim-dock__body">{fold}</div>
              </div>
            </div>
            <button
              type="button"
              className="sw-sim-dock__toggle"
              aria-expanded={open}
              aria-controls={body}
              onClick={() => onOpenChange(!open)}
            >
              <span className="sw-sim-dock__peek">{peek}</span>
              <span className="sw-sim-dock__chev" aria-hidden="true">
                <ChevronUp size={18} />
              </span>
            </button>
            {!open && glance && <div className="sw-sim-dock__glance">{glance}</div>}
          </>
        )}
        {children}
      </section>
    </div>
  );
}
