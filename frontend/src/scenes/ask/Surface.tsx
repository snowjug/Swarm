import type { ReactElement, ReactNode } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetTrigger,
} from '../../design/ui';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * Where a small menu of the composer opens: beside the button that opened it, and, on a phone, from the foot of
 * the screen as a sheet that is the width of the screen, where a thumb reaches it and nothing is under the bar.
 * Both are a dialog named `title`, and both give focus back to `trigger` when they close.
 */
export function Surface({
  title,
  trigger,
  open,
  onOpenChange,
  width,
  children,
}: {
  title: string;
  trigger: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** How wide the popover is on a larger screen. */
  width: string;
  children: ReactNode;
}) {
  const phone = useMediaQuery('(max-width: 40rem)');
  if (phone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent title={title} width="sm">
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent width={width} align="start" aria-label={title}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
