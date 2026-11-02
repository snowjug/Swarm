import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../cx';
import './Disclosure.css';

/**
 * Something that is there for the person who wants it and out of the way for the one who does not: a
 * method, a source, a table. The panel opens by growing, not by appearing, so the page does not jump.
 * The content stays in the document when closed (`inert`), so printing and find-in-page still reach it.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  className,
  tone = 'quiet',
  heading,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  tone?: 'quiet' | 'strong';
  /** Makes the button the name of a section: it is put inside a heading of this level. */
  heading?: 2 | 3 | 4 | 5;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const id = useId();
  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const button = (
    <button
      type="button"
      className="sw-disc__head"
      aria-expanded={open}
      aria-controls={id}
      onClick={toggle}
    >
      <span className="sw-disc__summary">{summary}</span>
      <ChevronDown className="sw-disc__chevron" size={18} aria-hidden="true" />
    </button>
  );
  const Heading = heading ? (`h${heading}` as const) : null;
  return (
    <div className={cx('sw-disc', `sw-disc--${tone}`, open && 'is-open', className)}>
      {Heading ? <Heading className="sw-disc__heading">{button}</Heading> : button}
      <div className="sw-disc__panel" id={id} inert={!open} data-open={open}>
        <div className="sw-disc__inner">{children}</div>
      </div>
    </div>
  );
}
