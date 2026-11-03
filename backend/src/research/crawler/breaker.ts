interface HostRecord {
  failures: number;
  openedAt: number | null;
  /** The one request that is let through after the cooldown is in flight. */
  probing: boolean;
}

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerAnswer {
  allowed: boolean;
  state: BreakerState;
  /** While it is open: how long until one request is let through. */
  reopensInMs: number;
}

/**
 * Leaves a host alone after it has failed several times in a row, so that a site that is down is not
 * asked again and again. After a cooldown, one request is let through: if it succeeds the host is
 * trusted again, and if it fails the cooldown starts over.
 */
export class Breakers {
  private readonly hosts = new Map<string, HostRecord>();

  constructor(
    private readonly now: () => number,
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  private record(host: string): HostRecord {
    let found = this.hosts.get(host);
    if (!found) {
      found = { failures: 0, openedAt: null, probing: false };
      this.hosts.set(host, found);
    }
    return found;
  }

  /** Whether a request to the host may be made now. The first to ask after the cooldown is the probe. */
  check(host: string): BreakerAnswer {
    const record = this.record(host);
    if (record.openedAt === null) return { allowed: true, state: 'closed', reopensInMs: 0 };
    const left = record.openedAt + this.cooldownMs - this.now();
    if (left > 0) return { allowed: false, state: 'open', reopensInMs: left };
    if (record.probing) return { allowed: false, state: 'half-open', reopensInMs: 0 };
    record.probing = true;
    return { allowed: true, state: 'half-open', reopensInMs: 0 };
  }

  success(host: string): void {
    const record = this.record(host);
    record.failures = 0;
    record.openedAt = null;
    record.probing = false;
  }

  /** A request that said nothing about the host's health, such as one a rule refused: it was not a probe's answer either way. */
  neutral(host: string): void {
    this.record(host).probing = false;
  }

  /** Counts a failure; true when it is the one that opened the breaker (or opened it again). */
  failure(host: string): { opened: boolean; failures: number; reopensInMs: number } {
    const record = this.record(host);
    record.failures += 1;
    const wasHalfOpen = record.openedAt !== null;
    if (wasHalfOpen || record.failures >= this.threshold) {
      record.openedAt = this.now();
      record.probing = false;
      return { opened: true, failures: record.failures, reopensInMs: this.cooldownMs };
    }
    return { opened: false, failures: record.failures, reopensInMs: 0 };
  }
}
