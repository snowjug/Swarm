/** What a server allows to be read at once, for everyone together. */
export interface FetchLimits {
  /** Pages read at the same moment. */
  maxActive: number;
  /** Requests that may wait for one of those places. A request beyond that is refused at once. */
  maxQueued: number;
  /** How long a request may wait before it is refused too. */
  maxWaitMs: number;
}

/** A request got no place: the line was full, it waited too long, or the person left while it waited. */
export class FetchBusy extends Error {
  constructor(readonly reason: 'queue-full' | 'wait-expired' | 'abandoned') {
    super('Too many page fetches are running.');
    this.name = 'FetchBusy';
  }
}

/**
 * Keeps the number of pages read at once, by every caller together, below what a server can carry. Each
 * read holds a connection and up to its size in memory for as long as the site takes to answer, and the
 * limit on one caller's requests does not bound what many callers do. A request that finds every place
 * taken waits in line, first come first served, for a short time, and is refused when the line is full
 * or the time is up. It says nothing about what was asked for.
 */
export class FetchLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limits: FetchLimits) {}

  /** How many reads are running, and how many requests are waiting for one. */
  get load(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiting.length };
  }

  /**
   * Runs `work` when a place is free and gives the place back however `work` ends: with an answer, with
   * an error, or after the person who asked has gone. `abandoned` takes a request out of the line.
   */
  async run<T>(work: () => Promise<T>, abandoned?: AbortSignal): Promise<T> {
    const release = await this.acquire(abandoned);
    try {
      return await work();
    } finally {
      release();
    }
  }

  /** A place, and the function that gives it back; calling that more than once gives back one place. */
  acquire(abandoned?: AbortSignal): Promise<() => void> {
    if (abandoned?.aborted) return Promise.reject(new FetchBusy('abandoned'));
    if (this.active < this.limits.maxActive) {
      this.active += 1;
      return Promise.resolve(this.release());
    }
    if (this.waiting.length >= this.limits.maxQueued) {
      return Promise.reject(new FetchBusy('queue-full'));
    }
    return new Promise((resolve, reject) => {
      const leave = (reason: 'wait-expired' | 'abandoned') => () => {
        const at = this.waiting.indexOf(turn);
        if (at >= 0) this.waiting.splice(at, 1);
        clearTimeout(timer);
        abandoned?.removeEventListener('abort', gone);
        reject(new FetchBusy(reason));
      };
      const expired = leave('wait-expired');
      const gone = leave('abandoned');
      // The place a read gives back is handed to the first in line without being counted as free.
      const turn = () => {
        clearTimeout(timer);
        abandoned?.removeEventListener('abort', gone);
        resolve(this.release());
      };
      const timer = setTimeout(expired, this.limits.maxWaitMs);
      timer.unref();
      abandoned?.addEventListener('abort', gone, { once: true });
      this.waiting.push(turn);
    });
  }

  private release(): () => void {
    let given = false;
    return () => {
      if (given) return;
      given = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    };
  }
}
