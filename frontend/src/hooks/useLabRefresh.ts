import { useEffect, useRef } from 'react';
import type { ConsoleStep } from '../../../shared/guided';

/** How often the project is read again while a comparison runs. The panel showing it reads faster. */
export const LAB_POLL_MS = 4_000;

/** Calls `read` every `intervalMs` until the function it returns is called. */
export function startLabPolling(read: () => void, intervalMs: number = LAB_POLL_MS): () => void {
  const timer = setInterval(read, intervalMs);
  return () => clearInterval(timer);
}

/**
 * Keeps what the stage shows of the lab's progress up to date, through the page's own way of reading
 * the project again. It reads once when a stage that shows the lab's result is opened, so that what
 * the Report or the Simulation stage offers is what the server holds now, and every few seconds while
 * `polling` is true, which ends by itself when the comparison does.
 */
export function useLabRefresh({
  step,
  enabled,
  polling,
  refresh,
}: {
  step: ConsoleStep;
  /** Only projects that have a guided record have progress to read. */
  enabled: boolean;
  polling: boolean;
  refresh: () => void;
}): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  // The project was read when the page opened, so only a change of stage reads it again.
  const opened = useRef(step);
  useEffect(() => {
    if (opened.current === step) return;
    opened.current = step;
    if (enabled && (step === 'simulation' || step === 'report')) latest.current();
  }, [step, enabled]);

  useEffect(() => {
    if (!enabled || !polling) return;
    return startLabPolling(() => latest.current());
  }, [enabled, polling]);
}
