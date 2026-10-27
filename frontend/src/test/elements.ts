import { Children, cloneElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

interface ElementProps {
  children?: ReactNode;
  onClick?: () => void;
}

/** Expands hook-free function components, so a static element tree can be searched for its buttons. */
export function expandElements(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expandElements);
  if (!isValidElement<ElementProps>(node)) return node;
  if (typeof node.type === 'function') {
    return expandElements((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  const children = Children.toArray(node.props.children).map(expandElements);
  return cloneElement(node, undefined, ...children);
}

export function findButtons(node: ReactNode): ReactElement<ElementProps>[] {
  const found: ReactElement<ElementProps>[] = [];
  const visit = (value: ReactNode) =>
    Children.forEach(value, (child) => {
      if (!isValidElement<ElementProps>(child)) return;
      if (child.type === 'button') found.push(child);
      visit(child.props.children);
    });
  visit(node);
  return found;
}
