import type { PauseGate } from './crawler/types.js';

/**
 * The pause of one run, held in this process: a gate the crawl waits at between fetches. While it is
 * closed the run waits and the job that carries it keeps its lease (the orchestrator renews that on its
 * own clock), so a pause costs no work and loses none. It is bounded: when the pause has lasted `limitMs`
 * the gate opens by itself and `expired` is set, and the run ends with what it has read, so that a
 * person who walked away does not keep the one worker of this process for ever.
 */
export class PauseControl implements PauseGate {
  private paused = false;
  private readonly waiting = new Set<() => void>();
  private timer: NodeJS.Timeout | null = null;
  /** The pause lasted as long as it may, and ended by itself. */
  expired = false;

  get closed(): boolean {
    return this.paused;
  }

  pause(limitMs: number, onExpire: () => void): void {
    if (this.paused || this.expired) return;
    this.paused = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.expired = true;
      this.open();
      onExpire();
    }, limitMs);
    this.timer.unref();
  }

  resume(): void {
    if (this.paused) this.open();
  }

  /** Lets go of the timer and of anyone waiting, for a run that has ended. */
  dispose(): void {
    this.open();
  }

  private open(): void {
    this.paused = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const wake of this.waiting) wake();
    this.waiting.clear();
  }

  waitIfPaused(signal: AbortSignal): Promise<void> {
    if (!this.paused) return Promise.resolve();
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<void>((resolve, reject) => {
      const wake = (): void => {
        signal.removeEventListener('abort', gone);
        resolve();
      };
      const gone = (): void => {
        this.waiting.delete(wake);
        reject(signal.reason);
      };
      this.waiting.add(wake);
      signal.addEventListener('abort', gone, { once: true });
    });
  }
}
