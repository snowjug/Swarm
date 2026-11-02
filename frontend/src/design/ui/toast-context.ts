import { createContext, useContext } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** A way forward: retry, undo, open. Pressing it dismisses the toast. */
  action?: { label: string; onPress: () => void };
  /** Milliseconds before it leaves by itself; errors stay until dismissed. */
  duration?: number;
}

export const ToastContext = createContext<((toast: ToastInput) => number) | null>(null);
export const DismissContext = createContext<((id: number) => void) | null>(null);

export function useToast(): (toast: ToastInput) => number {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast needs a ToastProvider above it.');
  return push;
}

export function useDismissToast(): (id: number) => void {
  const dismiss = useContext(DismissContext);
  if (!dismiss) throw new Error('useDismissToast needs a ToastProvider above it.');
  return dismiss;
}
