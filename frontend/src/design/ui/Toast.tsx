import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '../cx';
import { SPRING } from '../motion';
import { IconButton } from './IconButton';
import { DismissContext, ToastContext, type ToastInput, type ToastTone } from './toast-context';
import './Toast.css';

interface ToastItem extends ToastInput {
  id: number;
  tone: ToastTone;
}

const ICONS = { info: Info, success: CheckCircle2, error: AlertTriangle } as const;

/** Short messages that say what just happened and, where it failed, what can be done about it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((all) => all.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = next.current++;
      const tone = input.tone ?? 'info';
      setItems((all) => [...all.slice(-3), { ...input, id, tone }]);
      const duration = input.duration ?? (tone === 'error' ? 0 : 5200);
      if (duration > 0)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      <DismissContext.Provider value={dismiss}>
        {children}
        <div
          className="sw-toasts"
          role="region"
          aria-label="Notifications"
          aria-live="polite"
          aria-atomic="false"
        >
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const Icon = ICONS[item.tone];
              return (
                <m.div
                  key={item.id}
                  layout
                  role={item.tone === 'error' ? 'alert' : 'status'}
                  className={cx('sw-toast sw-glass sw-glass--overlay', `sw-toast--${item.tone}`)}
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
                  transition={SPRING.snappy}
                >
                  <Icon className="sw-toast__icon" size={18} aria-hidden="true" />
                  <div className="sw-toast__text">
                    <strong>{item.title}</strong>
                    {item.description && <span>{item.description}</span>}
                  </div>
                  {item.action && (
                    <button
                      type="button"
                      className="sw-toast__action"
                      onClick={() => {
                        item.action?.onPress();
                        dismiss(item.id);
                      }}
                    >
                      {item.action.label}
                    </button>
                  )}
                  <IconButton
                    label="Dismiss"
                    size="sm"
                    tooltip={false}
                    onClick={() => dismiss(item.id)}
                  >
                    <X size={15} aria-hidden="true" />
                  </IconButton>
                </m.div>
              );
            })}
          </AnimatePresence>
        </div>
      </DismissContext.Provider>
    </ToastContext.Provider>
  );
}
