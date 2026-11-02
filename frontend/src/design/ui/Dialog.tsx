import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { cx } from '../cx';
import { useReturnFocus } from '../useReturnFocus';
import './Sheet.css';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/** A small centred question that needs an answer before anything else (a confirmation, a name). */
export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  tone,
  onOpenAutoFocus,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  tone?: 'danger';
  /** Where focus goes when it opens: by default the first control, which for a question should be the safe answer. */
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const returnFocus = useReturnFocus();
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="sw-scrim sw-scrim--dialog" />
      <RadixDialog.Content
        ref={returnFocus.remember}
        className={cx(
          'sw-dialog sw-glass sw-glass--overlay',
          tone === 'danger' && 'is-danger',
          className,
        )}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={returnFocus.restore}
        {...(description ? null : { 'aria-describedby': undefined })}
      >
        <RadixDialog.Title className="sw-dialog__title">{title}</RadixDialog.Title>
        {description ? (
          <RadixDialog.Description className="sw-dialog__desc">
            {description}
          </RadixDialog.Description>
        ) : null}
        {children && <div className="sw-dialog__body">{children}</div>}
        {footer && <div className="sw-dialog__foot">{footer}</div>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
