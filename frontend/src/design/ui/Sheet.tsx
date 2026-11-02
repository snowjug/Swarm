import { useRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { useReturnFocus } from '../useReturnFocus';
import { IconButton } from './IconButton';
import './Sheet.css';

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

/**
 * A panel that slides in from the right (from the bottom on a phone) over a dimmed page, for something
 * that deserves the whole height: a history, a person's detail, an evidence passage. The page behind is
 * inert while it is open; Escape or a press on the dimmed part closes it and focus returns to what opened it.
 */
export function SheetContent({
  title,
  description,
  eyebrow,
  children,
  footer,
  width = 'md',
  className,
  onOpenAutoFocus,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus();
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="sw-scrim" />
      <RadixDialog.Content
        ref={(node) => {
          content.current = node;
          returnFocus.remember(node);
        }}
        className={cx('sw-sheet sw-glass sw-glass--overlay', `sw-sheet--${width}`, className)}
        tabIndex={-1}
        // Focus lands on the sheet itself, not on its close button: a tooltip opens on a focused button and takes the
        // first Escape, and a sheet must close on the first.
        onOpenAutoFocus={(event) => {
          if (onOpenAutoFocus) return onOpenAutoFocus(event);
          event.preventDefault();
          content.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={returnFocus.restore}
        {...(description ? null : { 'aria-describedby': undefined })}
      >
        <div className="sw-sheet__head">
          <div className="sw-sheet__titles">
            {eyebrow && <div className="sw-eyebrow">{eyebrow}</div>}
            <RadixDialog.Title className="sw-sheet__title">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="sw-sheet__desc">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close asChild>
            <IconButton label="Close" size="md">
              <X size={18} aria-hidden="true" />
            </IconButton>
          </RadixDialog.Close>
        </div>
        <div className="sw-sheet__body">{children}</div>
        {footer && <div className="sw-sheet__foot">{footer}</div>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
