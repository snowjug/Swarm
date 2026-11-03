import { safeAddress } from './source.js';
import type { CrawlEvent, CrawlEventBody } from './types.js';

/** The fields of an event that hold an address. Every one is cleaned on the way out. */
const ADDRESS_FIELDS = ['url', 'finalUrl', 'from', 'to', 'of', 'origin'] as const;

/**
 * Stamps what the crawler reports with the trace id and the time, and cleans every address in it:
 * no user name or password, no fragment, no secret-looking query value. The events are built from fixed
 * words, numbers and addresses only, so nothing a page said can reach them; this is the one place that
 * says so.
 */
export class Reporter {
  constructor(
    private readonly sink: (event: CrawlEvent) => void,
    private readonly traceId: string,
    private readonly now: () => number,
  ) {}

  emit(body: CrawlEventBody): void {
    const clean: Record<string, unknown> = { ...body };
    for (const field of ADDRESS_FIELDS) {
      const value = clean[field];
      if (typeof value === 'string') clean[field] = safeAddress(value);
    }
    try {
      this.sink({ ...(clean as CrawlEventBody), traceId: this.traceId, at: this.now() });
    } catch {
      // A listener that fails must not stop the crawl it is listening to.
    }
  }
}
