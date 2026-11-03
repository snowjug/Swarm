import { UrlFailure } from '../../src/ingest/url/failure.js';
import { robotsOrigin, type FetchedPage } from '../../src/ingest/url/fetcher.js';
import { validateUrl, type UrlPolicy } from '../../src/ingest/url/policy.js';
import { parseRobots } from '../../src/ingest/url/robots.js';
import { RESEARCH_ROBOTS_TOKEN } from '../../src/research/crawler/identity.js';
import type {
  CrawlDeps,
  CrawlEvent,
  CrawlInput,
  CrawlResult,
  CrawlTuning,
  PageFetcher,
  PageFetchRequest,
} from '../../src/research/crawler/types.js';
import { crawl } from '../../src/research/crawler/crawl.js';
import { sleep } from '../../src/research/crawler/deps.js';
import { DEFAULT_RESEARCH_BUDGET, type ResearchBudget } from '../../../shared/research.js';
import { prose, sitePage } from './research-pages.js';

export const A = 'https://a.example.com';
export const B = 'https://b.example.org';

export type Link = NonNullable<Parameters<typeof sitePage>[0]['links']>[number];

/** A page of the fixture site with its own prose, linking to `links`. */
export const htmlPage = (title: string, seed: number, links: Link[] = [], head = ''): Reply => ({
  type: 'text/html',
  body: sitePage({ title, paragraphs: prose(seed), links, head }),
});

/** A number that is the same for a host and different from every other host's, to give its pages prose of their own. */
const hostNumber = (host: string): number =>
  [...host].reduce((number, character) => (number * 31 + character.charCodeAt(0)) % 90_000, 7);

/** A start page that links to `count` pages, `/p0` to `/p{count - 1}`, each with prose of its own. */
export function fan(count: number, host = A, paragraphs = 3): Record<string, Route> {
  const base = host === A ? 0 : 1_000 * (hostNumber(host) + 1);
  const routes: Record<string, Route> = {
    [`${host}/`]: htmlPage(
      'Home',
      base + 1,
      Array.from({ length: count }, (_, index): Link => [`/p${index}`, `Page ${index}`]),
    ),
  };
  for (let index = 0; index < count; index += 1) {
    routes[`${host}/p${index}`] = {
      type: 'text/html',
      body: sitePage({
        title: `P${index}`,
        paragraphs: prose(base + 100 + index, paragraphs),
      }),
    };
  }
  return routes;
}

export const seedOf = (
  url: string,
  discoveredBy: CrawlInput['seeds'][number]['discoveredBy'] = 'user-url',
): CrawlInput['seeds'][number] => ({ url, discoveredBy });

interface Timer {
  at: number;
  seq: number;
  fire: () => void;
}

/**
 * Time that moves only when a test lets it: `sleep` waits for it, and `drive` lets it pass when
 * everything else has stopped to wait. Nothing here reads the real clock, so a crawl that is run on it
 * does the same things at the same moments however busy the machine is.
 */
export class VirtualClock {
  private time: number;
  private timers: Timer[] = [];
  private order = 0;
  /** Every wait that was asked for, in order. */
  readonly sleeps: number[] = [];

  constructor(start = 1_800_000_000_000) {
    this.time = start;
  }

  readonly now = (): number => this.time;

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(signal.reason);
    this.sleeps.push(ms);
    return new Promise<void>((resolve, reject) => {
      const timer: Timer = {
        at: this.time + Math.max(0, ms),
        seq: this.order++,
        fire: () => {
          signal.removeEventListener('abort', gone);
          resolve();
        },
      };
      const gone = (): void => {
        this.timers = this.timers.filter((other) => other !== timer);
        reject(signal.reason);
      };
      signal.addEventListener('abort', gone, { once: true });
      this.timers.push(timer);
    });
  };

  /** Moves time to the next wait and ends it. False when nothing is waiting. */
  tick(): boolean {
    if (this.timers.length === 0) return false;
    this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = this.timers.shift() as Timer;
    this.time = Math.max(this.time, next.at);
    next.fire();
    return true;
  }

  advance(ms: number): void {
    this.time += ms;
  }

  get waiting(): number {
    return this.timers.length;
  }
}

const hop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Runs `work` to its end, letting virtual time pass whenever it has nothing else to do. */
export async function drive<T>(clock: VirtualClock, work: Promise<T>): Promise<T> {
  let settled = false;
  work.then(
    () => (settled = true),
    () => (settled = true),
  );
  let idle = 0;
  while (!settled) {
    await hop();
    if (settled) break;
    if (clock.tick()) idle = 0;
    else if ((idle += 1) > 300)
      throw new Error('The work is waiting for something that never comes.');
  }
  return work;
}

export interface Reply {
  status?: number;
  type?: string;
  body?: string | Buffer;
  headers?: Record<string, string>;
  /** A redirect to this address. */
  to?: string;
  /** A failure instead of an answer. */
  fail?: UrlFailure;
  /** Time the answer takes, in virtual milliseconds. */
  delayMs?: number;
  /** Never answers, until the request is stopped. */
  hang?: boolean;
}

export type Route = Reply | ((call: number, url: string) => Reply);

export interface Call {
  url: string;
  host: string;
  purpose: 'robots' | 'page';
  /** When the request was let go, in virtual time. */
  at: number;
  /** How many requests were open at that moment, and to the same host. */
  open: number;
  openToHost: number;
}

/**
 * A network of pages that answers from a table, with the behaviour of the real fetcher that the crawler
 * depends on: the address policy, robots.txt (once for each origin, kept in the crawl's cache),
 * redirects offered to the caller, and a request held before it goes out. Pages are reached at
 * `https://host/path`; a path that is not in the table is answered by the route named `*` when there
 * is one, and is a 404 when there is not.
 */
export class FakeNetwork implements PageFetcher {
  readonly policy: UrlPolicy;
  readonly calls: Call[] = [];
  private readonly counts = new Map<string, number>();
  private open = 0;
  private readonly openByHost = new Map<string, number>();
  maxOpen = 0;
  maxOpenToHost = 0;

  /** How many requests are open now. */
  get inFlight(): number {
    return this.open;
  }

  constructor(
    private readonly clock: VirtualClock,
    private readonly routes: Record<string, Route>,
    options: { allowedPorts?: readonly number[] } = {},
  ) {
    this.policy = options.allowedPorts ? { allowedPorts: options.allowedPorts } : {};
  }

  /** How many times an address was asked for. */
  asked(url: string): number {
    return this.counts.get(url) ?? 0;
  }

  pagesAsked(): string[] {
    return this.calls.filter((call) => call.purpose === 'page').map((call) => call.url);
  }

  private reply(url: string): Reply {
    const route = this.routes[url] ?? this.routes['*'];
    const count = (this.counts.get(url) ?? 0) + 1;
    this.counts.set(url, count);
    if (route === undefined) return { status: 404, type: 'text/plain', body: 'not found' };
    return typeof route === 'function' ? route(count, url) : route;
  }

  private async request(
    url: string,
    purpose: 'robots' | 'page',
    request: PageFetchRequest,
  ): Promise<Reply> {
    const host = new URL(url).hostname;
    const release = await request.hooks.beforeRequest?.({ host, purpose }, request.signal);
    this.open += 1;
    this.openByHost.set(host, (this.openByHost.get(host) ?? 0) + 1);
    const openToHost = this.openByHost.get(host) ?? 0;
    this.maxOpen = Math.max(this.maxOpen, this.open);
    this.maxOpenToHost = Math.max(this.maxOpenToHost, openToHost);
    this.calls.push({ url, host, purpose, at: this.clock.now(), open: this.open, openToHost });
    try {
      const reply = this.reply(url);
      if (reply.hang) {
        await new Promise<never>((_resolve, reject) => {
          if (request.signal.aborted) reject(request.signal.reason);
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          });
        });
      }
      if (reply.delayMs) await this.clock.sleep(reply.delayMs, request.signal);
      if (reply.fail) throw reply.fail;
      return reply;
    } finally {
      this.open -= 1;
      this.openByHost.set(host, (this.openByHost.get(host) ?? 1) - 1);
      release?.();
    }
  }

  async fetch(request: PageFetchRequest): Promise<FetchedPage> {
    request.signal.throwIfAborted();
    let target = validateUrl(request.url, { ...this.policy, httpsOnly: !request.allowHttp });
    for (let redirects = 0; ; redirects += 1) {
      const origin = robotsOrigin(target);
      const cached = request.robots.has(origin);
      let known = request.robots.get(origin);
      if (known === undefined) {
        const robotsUrl = new URL('/robots.txt', target.href).href;
        try {
          const answer = await this.request(robotsUrl, 'robots', request);
          const status = answer.status ?? 200;
          if (status >= 500) known = 'unavailable';
          else if (status >= 400) known = 'absent';
          else known = parseRobots(String(answer.body ?? ''), RESEARCH_ROBOTS_TOKEN);
        } catch (error) {
          if (request.signal.aborted || !(error instanceof UrlFailure)) throw error;
          request.robots.set(origin, 'unavailable');
          throw new UrlFailure(error.code, error.message, { ...error.detail, stage: 'robots' });
        }
        request.robots.set(origin, known);
      }
      if (known === 'unavailable') {
        request.hooks.onRobots?.({ origin, url: target.href, decision: 'unavailable', cached });
        throw new UrlFailure('robots-unavailable', 'robots.txt could not be read.', {
          stage: 'robots',
        });
      }
      if (known !== 'absent' && !known.allows(target.path)) {
        request.hooks.onRobots?.({ origin, url: target.href, decision: 'disallowed', cached });
        throw new UrlFailure('robots', 'robots.txt disallows it.');
      }
      request.hooks.onRobots?.({
        origin,
        url: target.href,
        decision: known === 'absent' ? 'absent' : 'allowed',
        cached,
      });

      const reply = await this.request(target.href, 'page', request);
      if (reply.to !== undefined) {
        if (redirects >= request.maxRedirects)
          throw new UrlFailure('redirects', 'Too many redirects.');
        const next = validateUrl(new URL(reply.to, target.href).href, {
          ...this.policy,
          httpsOnly: !request.allowHttp,
        });
        const turnedDown = request.hooks.onRedirect?.({
          from: target.href,
          to: next.href,
          status: reply.status ?? 302,
          purpose: 'page',
        });
        if (typeof turnedDown === 'string') {
          throw new UrlFailure('blocked', 'A redirect was turned down.', {
            refusal: 'caller',
            redirected: true,
          });
        }
        target = next;
        continue;
      }
      const status = reply.status ?? 200;
      if (status < 200 || status > 299) {
        throw new UrlFailure('status', `The site answered ${status}.`, {
          status,
          ...(reply.headers?.['retry-after'] ? { retryAfter: reply.headers['retry-after'] } : {}),
        });
      }
      const body = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body ?? '', 'utf8');
      if (body.length > request.maxBytes) throw new UrlFailure('size', 'Too large.');
      const type = reply.type ?? 'text/html';
      return {
        url: request.url,
        finalUrl: target.href,
        status,
        contentType: type,
        text: body.toString('utf8'),
        body,
        headers: reply.headers ?? {},
        bytes: body.length,
        redirects,
        robots: known === 'absent' ? 'absent' : 'allowed',
      };
    }
  }
}

export const budget = (changes: Partial<ResearchBudget> = {}): ResearchBudget => ({
  ...DEFAULT_RESEARCH_BUDGET,
  perDomainDelayMs: 250,
  ...changes,
});

export interface Trial {
  result: CrawlResult;
  events: CrawlEvent[];
  network: FakeNetwork;
  clock: VirtualClock;
}

export interface TrialOptions {
  input: Omit<CrawlInput, 'signal' | 'budget' | 'hints' | 'sameSiteOnly'> & {
    budget?: Partial<ResearchBudget>;
    hints?: CrawlInput['hints'];
    sameSiteOnly?: boolean;
    signal?: AbortSignal;
  };
  tuning?: Partial<CrawlTuning>;
  random?: () => number;
  deps?: Partial<CrawlDeps>;
  allowedPorts?: readonly number[];
  /** A clock the test made, when it needs to give it to something it passes in. */
  clock?: VirtualClock;
}

export interface Failed {
  error: unknown;
  events: CrawlEvent[];
  network: FakeNetwork;
  clock: VirtualClock;
}

function prepare(routes: Record<string, Route>, options: TrialOptions) {
  const clock = options.clock ?? new VirtualClock();
  const network = new FakeNetwork(
    clock,
    routes,
    options.allowedPorts ? { allowedPorts: options.allowedPorts } : {},
  );
  const events: CrawlEvent[] = [];
  const { budget: changes, hints, sameSiteOnly, signal, ...rest } = options.input;
  const input: CrawlInput = {
    ...rest,
    budget: budget(changes),
    hints: hints ?? { terms: [] },
    sameSiteOnly: sameSiteOnly ?? false,
    signal: signal ?? new AbortController().signal,
  };
  const deps: CrawlDeps = {
    fetcher: network,
    now: clock.now,
    sleep: clock.sleep,
    random: options.random ?? (() => 0.5),
    onEvent: (event) => events.push(event),
    traceId: 'trace-test',
    ...(options.tuning ? { tuning: options.tuning } : {}),
    ...options.deps,
    // Parsing neither gives up its turn nor is cut by the real clock, so that no virtual time passes in the middle of it.
    extractLimits: {
      sliceMs: Number.POSITIVE_INFINITY,
      maxParseMs: Number.POSITIVE_INFINITY,
      ...options.deps?.extractLimits,
    },
  };
  return { clock, network, events, input, deps };
}

/** Runs a crawl over a table of pages on a clock of its own, and returns what it did. */
export async function trial(routes: Record<string, Route>, options: TrialOptions): Promise<Trial> {
  const { clock, network, events, input, deps } = prepare(routes, options);
  const result = await drive(clock, crawl(input, deps));
  return { result, events, network, clock };
}

/** As `trial`, on the real clock and without driving time, for work that takes real time (the PDF reader's worker). */
export async function realTrial(
  routes: Record<string, Route>,
  options: TrialOptions,
): Promise<Trial> {
  const { clock, network, events, input, deps } = prepare(routes, options);
  const result = await crawl(input, {
    ...deps,
    now: options.deps?.now ?? (() => Date.now()),
    sleep: options.deps?.sleep ?? sleep,
  });
  return { result, events, network, clock };
}

/** As `trial`, for a crawl that is expected to throw: what it threw, and what was left of the world. */
export async function failedTrial(
  routes: Record<string, Route>,
  options: TrialOptions,
): Promise<Failed> {
  const { clock, network, events, input, deps } = prepare(routes, options);
  try {
    await drive(clock, crawl(input, deps));
  } catch (error) {
    return { error, events, network, clock };
  }
  throw new Error('The crawl was expected to throw.');
}
