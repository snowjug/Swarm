import { describe, expect, it } from 'vitest';
import { UrlFailure } from '../src/ingest/url/failure.js';
import type { CrawlEvent } from '../src/research/crawler/types.js';
import { prose, sitePage } from './support/research-pages.js';
import {
  A,
  B,
  htmlPage,
  seedOf as seed,
  trial,
  type Link,
  type Reply,
  type Route,
  type Trial,
} from './support/research-world.js';

const C = 'https://c.example.net';
const CANARY = 'quokka-zebra-7731';
const TITLE_CANARY = 'Quokka Almanac';
const LINK_CANARY = 'zebra-link-text-4412';
const KEY = 'SUPERSECRET123456';

/** The fields each kind of event may carry, besides the trace id and the time. A field that is not here is not allowed. */
const FIELDS: Record<CrawlEvent['type'], readonly string[]> = {
  'fetch-start': ['url', 'host', 'depth', 'attempt'],
  'fetch-ok': ['url', 'finalUrl', 'status', 'contentType', 'bytes', 'redirects'],
  'fetch-blocked': ['url', 'errorClass', 'reason', 'resolved'],
  'fetch-failed': ['url', 'errorClass', 'status', 'attempt'],
  retry: ['url', 'attempt', 'delayMs', 'errorClass'],
  'robots-decision': ['origin', 'url', 'decision', 'cached', 'crawlDelayMs'],
  redirect: ['from', 'to', 'status', 'hop'],
  quarantine: ['url', 'reason'],
  duplicate: ['url', 'of', 'by'],
  'circuit-open': ['host', 'failures', 'reopensInMs', 'url'],
  skipped: ['url', 'reason'],
  'budget-stop': ['reason'],
};

function scenario(): { routes: Record<string, Route>; seeds: ReturnType<typeof seed>[] } {
  const sameText = prose(40);
  const links: Link[] = [
    ['/ok', 'OK page'],
    [`/ok?api_key=${KEY}&id=3`, 'OK with a key'],
    ['/old', 'Old address'],
    ['/dup1', 'Duplicate one'],
    ['/dup2', 'Duplicate two'],
    ['/gone', 'Gone'],
    ['/flaky', 'Flaky'],
    ['/empty', 'Empty'],
    ['/private/x', 'Private'],
    [`${C}/bad1`, 'Bad one'],
    [`${C}/bad2`, 'Bad two'],
    [`${B}/outside`, 'Outside'],
    ['/fake', LINK_CANARY],
    ['https://user:pw@a.example.com/cred', 'Credentials'],
  ];
  const routes: Record<string, Route> = {
    [`${A}/`]: {
      type: 'text/html',
      body: sitePage({
        title: TITLE_CANARY,
        paragraphs: [`${CANARY} is what this page is about.`, ...prose(1)],
        links,
      }),
    },
    [`${A}/ok`]: htmlPage('OK', 2),
    [`${A}/ok?api_key=${KEY}&id=3`]: htmlPage('OK with a key', 3),
    [`${A}/old`]: { to: `${A}/new` },
    [`${A}/new`]: htmlPage('New', 4),
    [`${A}/dup1`]: { body: sitePage({ title: 'Same', paragraphs: sameText }) },
    [`${A}/dup2`]: { body: sitePage({ title: 'Same', paragraphs: sameText }) },
    [`${A}/flaky`]: (call): Reply =>
      call === 1 ? { fail: new UrlFailure('timeout', 'slow') } : htmlPage('Flaky', 5),
    [`${A}/empty`]: { body: '<html><body><p>Hi</p></body></html>' },
    [`${A}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' },
    [`${C}/bad1`]: { fail: new UrlFailure('network', 'closed', { reason: 'closed' }) },
    [`${C}/bad2`]: { fail: new UrlFailure('network', 'closed', { reason: 'closed' }) },
    [`${B}/outside`]: htmlPage('Outside', 6),
  };
  return { routes, seeds: [seed(`${A}/`)] };
}

async function everything(): Promise<Trial> {
  const { routes, seeds } = scenario();
  return trial(routes, {
    input: {
      seeds,
      budget: { maxDomains: 2, maxFailedRequests: 20, maxDuplicateRatio: 1, maxPages: 30 },
      hints: { terms: [], domains: ['c.example.net', 'b.example.org'] },
    },
    tuning: { maxRetries: 1, breakerThreshold: 2 },
  });
}

describe('the audit events', () => {
  it('report every kind of thing that happens, and nothing that is not one of them', async () => {
    const done = await everything();
    const seen = new Set(done.events.map((event) => event.type));
    expect([...seen].sort()).toEqual(Object.keys(FIELDS).sort());
  });

  it('carry only the fields that are listed for them, so that no text of a page or of a site can be in one', async () => {
    const done = await everything();
    for (const event of done.events) {
      const allowed = new Set(['type', 'traceId', 'at', ...FIELDS[event.type]]);
      for (const key of Object.keys(event)) {
        expect(allowed.has(key), `${event.type} carries ${key}`).toBe(true);
      }
    }
  });

  it('name the run, say when from the clock they were given, and keep to the order things happened in', async () => {
    const done = await everything();
    expect(done.events.length).toBeGreaterThan(20);
    for (const event of done.events) {
      expect(event.traceId).toBe('trace-test');
      expect(Number.isInteger(event.at)).toBe(true);
    }
    const times = done.events.map((event) => event.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(done.events.at(-1)).toMatchObject({ type: 'budget-stop' });
    expect(done.events.filter((event) => event.type === 'budget-stop')).toHaveLength(1);
  });

  it('hold no text of a page, no title, no link text, no secret from an address and no user name or password', async () => {
    const done = await everything();
    const log = JSON.stringify(done.events);
    for (const secret of [CANARY, TITLE_CANARY, LINK_CANARY, KEY, 'user:pw', 'pw@']) {
      expect(log, secret).not.toContain(secret);
    }
    expect(log).toContain('api_key=[redacted]');
  });

  it('are the same in a second run on the same pages with the same numbers', async () => {
    const first = await everything();
    const second = await everything();
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(JSON.stringify(second.result.sources)).toBe(JSON.stringify(first.result.sources));
  });

  it('report an IP address that is not public as turned away before anything was asked for', async () => {
    const done = await trial(
      {},
      {
        input: {
          seeds: [
            seed('https://127.0.0.1/'),
            seed('https://10.0.0.5/admin'),
            seed('https://[::1]/'),
            seed('https://[fd00:ec2::254]/'),
            seed('https://100.100.100.200/'),
          ],
        },
      },
    );
    const blocked = done.events.filter((event) => event.type === 'fetch-blocked');
    expect(blocked).toHaveLength(5);
    for (const event of blocked) expect(event).toMatchObject({ errorClass: 'blocked-address' });
    expect(done.network.calls).toHaveLength(0);
    expect(done.result.stoppedBecause).toBe('safety-block');
  });

  it('do not stop a crawl when what listens for them fails', async () => {
    const done = await trial(scenario().routes, {
      input: { seeds: [seed(`${A}/`)] },
      deps: {
        onEvent: () => {
          throw new Error('the listener failed');
        },
      },
    });
    expect(done.result.pages.length).toBeGreaterThan(1);
  });
});

describe('the records of what was tried', () => {
  it('say why a page was read in words the crawler chose, never in a site’s own', async () => {
    const done = await everything();
    for (const source of done.result.sources) {
      expect(source.relevance).not.toContain(LINK_CANARY);
      expect(source.relevance).not.toContain(CANARY);
      expect(source.relevance).toMatch(
        /^(?:The page you named\.|A page on the site you named\.|Linked from a page on [\w.-]+\.)$/u,
      );
    }
  });

  it('keep no secret from an address, and no user name or password', async () => {
    const done = await everything();
    const kept = JSON.stringify(done.result.sources);
    expect(kept).not.toContain(KEY);
    expect(kept).not.toContain('user:pw');
    expect(kept).toContain('api_key=[redacted]');
  });

  it('carry the messages that a person is shown in the product’s plain words', async () => {
    const done = await everything();
    for (const source of done.result.sources) {
      for (const text of [source.failure?.message, source.quarantine?.detail]) {
        if (text === undefined) continue;
        expect(text.length).toBeGreaterThan(10);
        expect(text).toMatch(/[.]$/u);
      }
    }
  });
});
