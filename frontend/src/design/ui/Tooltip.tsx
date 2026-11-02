import type { ReactElement, ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import './Tooltip.css';

/** One provider near the root: the first tooltip waits a moment, the ones after it are immediate. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={380} skipDelayDuration={260}>
      {children}
    </RadixTooltip.Provider>
  );
}

/**
 * A short label for a control. It repeats what the control is named, or adds a one-line hint; it never
 * holds the only copy of anything a person needs, because touch has no hover.
 */
export function Tooltip({
  label,
  children,
  shortcut,
  side = 'top',
  align = 'center',
}: {
  label: ReactNode;
  children: ReactElement;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          className="sw-tip sw-glass sw-glass--overlay"
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
        >
          <span>{label}</span>
          {shortcut && <kbd className="sw-kbd">{shortcut}</kbd>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
