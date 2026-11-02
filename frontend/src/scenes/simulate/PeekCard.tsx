import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronUp } from 'lucide-react';
import { cx } from '../../design/cx';
import './roundcard.css';

/**
 * The card the theatre keeps beside the picture. On a wide screen it is a column of its own. On a narrow one it would
 * cover the picture, so it is a single line that opens to the rest, and opens by itself when something in the picture
 * is chosen (`opensWith` changing to a value), since what was chosen is what it is for.
 */
export function PeekCard({
  compact,
  label,
  peek,
  glance,
  opensWith,
  className,
  children,
}: {
  compact: boolean;
  label: string;
  /** What the one line says, when the card is narrow. */
  peek: ReactNode;
  /** A line of the card that stays in view while it is closed. */
  glance?: ReactNode;
  opensWith?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const body = useId();
  useEffect(() => {
    if (opensWith) setOpen(true);
  }, [opensWith]);
  const closed = compact && !open;
  return (
    <aside
      className={cx(
        'sw-round sw-glass sw-glass--overlay',
        compact && 'sw-round--compact',
        !closed && 'is-open',
        className,
      )}
      aria-label={label}
    >
      {compact && (
        <>
          <button
            type="button"
            className="sw-round__toggle"
            aria-expanded={!closed}
            aria-controls={body}
            onClick={() => setOpen(closed)}
          >
            <span className="sw-round__peek">{peek}</span>
            <span className="sw-round__chev" aria-hidden="true">
              <ChevronUp size={18} />
            </span>
          </button>
          {closed && glance && <div className="sw-round__glance">{glance}</div>}
        </>
      )}
      <div className="sw-round__fold" id={body} inert={closed || undefined}>
        <div className="sw-round__scroll">{children}</div>
      </div>
    </aside>
  );
}
