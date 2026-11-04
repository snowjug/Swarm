/** The two things the limiter needs of time: what it is, and a way to wait for it to pass. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

interface HostState {
  busy: boolean;
  /** When the last request to the host ended. */
  endedAt: number | null;
  waiting: (() => void)[];
}

/**
 * Spaces requests out and keeps them from piling onto one site: one request at a time to a host, and
 * at least `delayFor(host)` between the end of one and the start of the next. The fetcher asks it for
 * leave before every request it makes (a site's robots.txt, its page, and each page a redirect leads
 * to), so the rule holds for every request and not only for the page that was asked for.
 */
export class HostGate {
  private readonly hosts = new Map<string, HostState>();

  constructor(
    private readonly clock: Clock,
    private readonly delayFor: (host: string) => number,
  ) {}

  private state(host: string): HostState {
    let found = this.hosts.get(host);
    if (!found) {
      found = { busy: false, endedAt: null, waiting: [] };
      this.hosts.set(host, found);
    }
    return found;
  }

  /**
   * How long from `at` until the host has waited long enough since its last request ended. A clock that was
   * put back says that request ended in the future: it ended no later than `at`, and the host is not made to
   * wait for however far the clock was put back as well as for the delay.
   */
  private waitFor(host: string, state: HostState, at: number): number {
    if (state.endedAt === null) return 0;
    if (state.endedAt > at) state.endedAt = at;
    return Math.max(0, state.endedAt + this.delayFor(host) - at);
  }

  /**
   * How long until a request to the host could start: 0 when it could now, Infinity while one is running.
   * `at` is the reading of the clock the caller is deciding by: a caller that decides several things in one
   * pass gives every one of them the same, so that they cannot disagree about whether a host is ready.
   */
  readyIn(host: string, at: number = this.clock.now()): number {
    const state = this.hosts.get(host);
    if (!state) return 0;
    return state.busy ? Number.POSITIVE_INFINITY : this.waitFor(host, state, at);
  }

  /**
   * Gives back a place that a request still holds after its fetch has ended. A fetcher gives its place
   * back as it goes; this is for one that does not, so that a host is never held for ever. True when a
   * place was held.
   */
  settle(host: string): boolean {
    const state = this.hosts.get(host);
    if (!state?.busy) return false;
    state.busy = false;
    state.endedAt = this.clock.now();
    state.waiting.shift()?.();
    return true;
  }

  /** Resolves, with the function that gives the place back, when a request to the host may start. */
  async acquire(host: string, signal: AbortSignal): Promise<() => void> {
    const state = this.state(host);
    for (;;) {
      signal.throwIfAborted();
      if (state.busy) {
        await new Promise<void>((resolve, reject) => {
          const turn = (): void => {
            signal.removeEventListener('abort', gone);
            resolve();
          };
          const gone = (): void => {
            const at = state.waiting.indexOf(turn);
            if (at >= 0) state.waiting.splice(at, 1);
            reject(signal.reason);
          };
          state.waiting.push(turn);
          signal.addEventListener('abort', gone, { once: true });
        });
        continue;
      }
      // The clock is read again after every wait: a wait that ends early (a timer can, by the clock that is
      // read here) is waited out, and one that ends late costs nothing more.
      const wait = this.waitFor(host, state, this.clock.now());
      if (wait > 0) {
        await this.clock.sleep(wait, signal);
        continue;
      }
      break;
    }
    state.busy = true;
    let given = false;
    return () => {
      if (given) return;
      given = true;
      state.busy = false;
      state.endedAt = this.clock.now();
      state.waiting.shift()?.();
    };
  }
}
