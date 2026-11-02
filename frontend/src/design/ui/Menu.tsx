import type { ComponentProps, ReactNode } from 'react';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cx } from '../cx';
import { handingBackSoon } from '../useReturnFocus';
import './Menu.css';

export const Menu = function Menu(props: ComponentProps<typeof RadixMenu.Root>) {
  // Not modal: a modal menu hides the page from assistive technology while its controls stay in the tab order,
  // and takes the scrollbar away, which shifts the page. A press outside still closes it.
  return <RadixMenu.Root modal={false} {...props} />;
};
export const MenuTrigger = RadixMenu.Trigger;
export const MenuRadioGroup = RadixMenu.RadioGroup;

export function MenuContent({
  children,
  className,
  onCloseAutoFocus,
  ...rest
}: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={10}
        collisionPadding={12}
        {...rest}
        onCloseAutoFocus={(event) => {
          // The menu gives focus back to its button next: the tooltip of that button is not for a person who chose.
          handingBackSoon();
          onCloseAutoFocus?.(event);
        }}
        className={cx('sw-menu sw-glass sw-glass--overlay', className)}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export function MenuItem({
  icon,
  shortcut,
  tone,
  children,
  className,
  ...rest
}: ComponentProps<typeof RadixMenu.Item> & {
  icon?: ReactNode;
  shortcut?: string;
  tone?: 'danger';
}) {
  return (
    <RadixMenu.Item
      {...rest}
      className={cx('sw-menu__item', tone === 'danger' && 'is-danger', className)}
    >
      <span className="sw-menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sw-menu__text">{children}</span>
      {shortcut && <kbd className="sw-kbd">{shortcut}</kbd>}
    </RadixMenu.Item>
  );
}

export function MenuRadioItem({
  icon,
  children,
  className,
  ...rest
}: ComponentProps<typeof RadixMenu.RadioItem> & { icon?: ReactNode }) {
  return (
    <RadixMenu.RadioItem {...rest} className={cx('sw-menu__item', className)}>
      <span className="sw-menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sw-menu__text">{children}</span>
      <RadixMenu.ItemIndicator className="sw-menu__check">
        <Check size={15} aria-hidden="true" />
      </RadixMenu.ItemIndicator>
    </RadixMenu.RadioItem>
  );
}

export function MenuCheckboxItem({
  icon,
  children,
  className,
  ...rest
}: ComponentProps<typeof RadixMenu.CheckboxItem> & { icon?: ReactNode }) {
  return (
    <RadixMenu.CheckboxItem {...rest} className={cx('sw-menu__item', className)}>
      <span className="sw-menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sw-menu__text">{children}</span>
      <RadixMenu.ItemIndicator className="sw-menu__check">
        <Check size={15} aria-hidden="true" />
      </RadixMenu.ItemIndicator>
    </RadixMenu.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RadixMenu.Label className="sw-menu__label sw-eyebrow">{children}</RadixMenu.Label>;
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="sw-menu__sep" />;
}
