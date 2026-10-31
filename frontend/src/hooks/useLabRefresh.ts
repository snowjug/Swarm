import { useEffect, useRef } from 'react';
import type { ConsoleStep } from '../../../shared/guided';
import type { LabWatch } from '../lib/console';

/** How often the project is read again: quickly while a comparison runs, slowly while one could be started. */
export const LAB_POLL_MS: Record<LabWatch, number> = { running: 2_000, waiting: 5_000 };

/** How long after a click in a stage the project is read again: long enough for what it asked for to be recorded. */
export const LAB_NUDGE_MS = 800;

/** Calls `read` every `intervalMs` until the function it returns is called. */
export function startLabPolling(read: () => void, intervalMs: number): () => void {
  const timer = setInterval(read, intervalMs);
  return () => clearInterval(timer);
}

/**
 * Keeps what the stage shows of the lab's progress up to date, through the page's own way of reading
 * the project again. It reads once when a stage that shows the lab's result is opened, so that what
 * the Report or the Simulation stage offers is what the server holds now; every few seconds while
 * `watch` says the record may change, which ends by itself when it has; and shortly after a click in
 * a stage that is being watched, so that what that click started is seen at once, not at the next
 * read. The returned `nudge` is for that click.
 */
export function useLabRefresh({
  step,
  enabled,
  watch,
  refresh,
}: {
  step: ConsoleStep;
  /** Only projects that have a guided record have progress to read. */
  enabled: boolean;
  watch: LabWatch | null;
  refresh: () => void;
}): { nudge: () => void } {
  const latest = useRef({ refresh, enabled, watch });
  useEffect(() => {
    latest.current = { refresh, enabled, watch };
  }, [refresh, enabled, watch]);

  // The project was read when the page opened, so only a change of stage reads it again.
  const opened = useRef(step);
  useEffect(() => {
    if (opened.current === step) return;
    opened.current = step;
    if (enabled && (step === 'simulation' || step === 'report')) latest.current.refresh();
  }, [step, enabled]);

  useEffect(() => {
    if (!enabled || watch === null) return;
    return startLabPolling(() => latest.current.refresh(), LAB_POLL_MS[watch]);
  }, [enabled, watch]);

  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);
  const nudge = (): void => {
    if (!latest.current.enabled || latest.current.watch === null) return;
    clearTimeout(pending.current);
    pending.current = setTimeout(() => latest.current.refresh(), LAB_NUDGE_MS);
  };
  return { nudge };
}
