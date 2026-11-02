import type { ReactNode } from 'react';
import { useId } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { m } from 'motion/react';
import { cx } from '../cx';
import { SPRING } from '../motion';
import './Tabs.css';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

/**
 * Views of one thing (the Story, Live and Network views of a run). It is a real tablist: arrows move
 * between the tabs, the panel is labelled by its tab. An underline glides to the current tab.
 * Pass the panels as children, each a `TabPanel` with the value of its tab.
 */
export function Tabs<T extends string>({
  value,
  onValueChange,
  tabs,
  label,
  children,
  className,
  listClassName,
  variant = 'line',
}: {
  value: T;
  onValueChange: (value: T) => void;
  tabs: readonly TabItem<T>[];
  label: string;
  children?: ReactNode;
  className?: string;
  listClassName?: string;
  variant?: 'line' | 'pill';
}) {
  const id = useId();
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={className}
    >
      <RadixTabs.List
        aria-label={label}
        className={cx('sw-tabs', `sw-tabs--${variant}`, listClassName)}
      >
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className="sw-tab"
          >
            {tab.value === value && (
              <m.span
                layoutId={`${id}-mark`}
                className="sw-tab__mark"
                transition={SPRING.snappy}
                aria-hidden="true"
              />
            )}
            <span className="sw-tab__content">
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && <span className="sw-tab__count num">{tab.count}</span>}
            </span>
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export const TabPanel = RadixTabs.Content;
