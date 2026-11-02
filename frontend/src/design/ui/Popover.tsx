import { useCallback, useLayoutEffect, useState, type ComponentProps, type ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { cx } from '../cx';
import './Popover.css';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

/**
 * A surface that opens beside what opened it: glass, a scale-in from the point it grew from, closed by
 * Escape or a press outside. Focus moves into it and comes back to the trigger. It is a dialog, so it needs a
 * name: the one it is given (`aria-label`, `aria-labelledby`), or else the name of the control that opened it.
 */
export function PopoverContent({
  children,
  className,
  width,
  ref: forwarded,
  ...rest
}: ComponentProps<typeof RadixPopover.Content> & { children: ReactNode; width?: string }) {
  const named = Boolean(rest['aria-label'] || rest['aria-labelledby']);
  // The content is put on the page a moment after this is first drawn (the portal), so it is the element, when it
  // arrives, that the name is looked for with, and not the first draw.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [opener, setOpener] = useState<string | undefined>();
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      setNode(element);
      if (typeof forwarded === 'function') forwarded(element);
      else if (forwarded) forwarded.current = element;
    },
    [forwarded],
  );
  useLayoutEffect(() => {
    if (named || !node?.id) return;
    const trigger = document.querySelector(`[aria-controls="${CSS.escape(node.id)}"]`);
    const name = trigger?.getAttribute('aria-label') ?? trigger?.textContent;
    setOpener(name?.trim() || undefined);
  }, [named, node]);
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={10}
        collisionPadding={12}
        {...rest}
        ref={attach}
        aria-label={rest['aria-label'] ?? (named ? undefined : (opener ?? 'Details'))}
        className={cx('sw-popover sw-glass sw-glass--overlay', className)}
        style={{ ...(width ? { width } : null), ...rest.style }}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
