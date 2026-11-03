import { describe, expect, it } from 'vitest';
import { researchSourceSchema } from '../../shared/research.js';
import { UrlFailure } from '../src/ingest/url/failure.js';
import type { CrawlEvent, CrawlInput } from '../src/research/crawler/types.js';
import { prose, sitePage } from './support/research-pages.js';
import { trial, type Reply, type Route, type Trial } from './support/research-world.js';

const A = 'https://a.example.com';
const B = 'https://b.example.org';

type Link = NonNullable<Parameters<typeof sitePage>[0]['links']>[number];
const page = (title: string, seed: number, links: Link[] = [], head = ''): Reply => ({
  type: 'text/html',
  body: sitePage({ title, paragraphs: prose(seed), links, head }),
});
const seed = (
  url: string,
  discoveredBy: CrawlInput['seeds'][number]['discoveredBy'] = 'user-url',
) => ({
  url,
  discoveredBy,
});
const outcomes = (done: Trial) =>
  done.result.sources.map(({ requestedUrl, outcome }) => `${outcome} ${requestedUrl}`);
const eventsOf = (done: Trial, type: CrawlEvent['type']) =>
  done.events.filter((event) => event.type === type);
const read = (done: Trial) => done.network.pagesAsked();

describe('what is read first', () => {
  const site: Record<string, Route> = {
    [`${A}/`]: page('Ferry service', 1, [
      ['/careers', 'Careers'],
      ['/fees/ferry-fees', 'Ferry fees'],
      ['/contact', 'Contact us'],
      ['/news/ferry-timetable', 'Timetable news'],
      ['/fees', 'Fees'],
    ]),
    [`${A}/careers`]: page('Careers', 2),
    [`${A}/fees/ferry-fees`]: page('Ferry fees', 3),
    [`${A}/contact`]: page('Contact', 4),
    [`${A}/news/ferry-timetable`]: page('Timetable', 5),
    [`${A}/fees`]: page('Fees', 6),
  };

  it('reads the page it was given, then the links that carry the question, the most relevant first, and never the rest', async () => {
    const done = await trial(site, {
      input: {
        seeds: [seed(`${A}/`)],
        hints: { terms: ['ferry', 'fees'], domains: ['a.example.com'] },
      },
    });
    expect(read(done)).toEqual([
      `${A}/`,
      `${A}/fees/ferry-fees`,
      `${A}/fees`,
      `${A}/news/ferry-timetable`,
    ]);
    expect(done.result.pages.map(({ source }) => source.title)).toEqual([
      'Ferry service',
      'Ferry fees',
      'Fees',
      'Timetable',
    ]);
    expect(done.result.stoppedBecause).toBe('frontier-exhausted');
    expect(done.result.pages[1]!.source.relevance).toMatch(
      /^Linked from a page on a\.example\.com; its address or link text carries/u,
    );
  });

  it('follows every link of a site it was told to read when the question gives it nothing to tell them apart', async () => {
    const done = await trial(site, { input: { seeds: [seed(`${A}/`)], hints: { terms: [] } } });
    expect(read(done)).toHaveLength(6);
  });

  it('gives a source named by the person the highest rank and says which source each is', async () => {
    const done = await trial(site, {
      input: { seeds: [seed(`${A}/`)], hints: { terms: ['ferry'], domains: ['a.example.com'] } },
    });
    const first = done.result.pages[0]!.source;
    expect(first).toMatchObject({
      category: 'primary',
      authority: 'high',
      discoveredBy: 'user-url',
      depth: 0,
      relevance: 'The page you named.',
    });
  });
});

describe('links that are not followed', () => {
  it('leaves out what a page asks not to be followed, and every link of a page that asks it', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ['/a', 'Alpha', 'nofollow'],
        ['/b', 'Beta', 'ugc'],
        ['/c', 'Gamma', 'sponsored'],
        ['/d', 'Delta', 'noopener'],
      ]),
      [`${A}/a`]: page('A', 2),
      [`${A}/b`]: page('B', 3),
      [`${A}/c`]: page('C', 4),
      [`${A}/d`]: page('D', 5),
      [`${A}/n`]: page(
        'Nofollow page',
        6,
        [['/e', 'Epsilon']],
        '<meta name="robots" content="nofollow">',
      ),
      [`${A}/e`]: page('E', 7),
    };
    expect(read(await trial(routes, { input: { seeds: [seed(`${A}/`)] } }))).toEqual([
      `${A}/`,
      `${A}/d`,
    ]);
    expect(read(await trial(routes, { input: { seeds: [seed(`${A}/n`)] } }))).toEqual([`${A}/n`]);
  });

  it('leaves out the addresses that lead nowhere new: logins, baskets, feeds, searches, calendars, endless listings, repeating paths and files', async () => {
    const traps = [
      '/login',
      '/cart/add',
      '/feed/',
      '/search?q=tram',
      '/calendar/2026/03',
      '/events/?month=2026-04',
      '/news/page/9/',
      '/docs/a/b/a/b/a/b',
      '/files/report.zip',
      '/files/report.pdf',
      '/img/hero.png',
      '/account/settings',
      '/share?u=x',
    ];
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ...traps.map((path): Link => [path, `Link ${path}`]),
        ['/good/page', 'A good page'],
      ]),
      [`${A}/good/page`]: page('Good', 2),
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    expect(read(done)).toEqual([`${A}/`, `${A}/good/page`]);
  });

  it('takes no more links from a page than it is allowed, the best of them', async () => {
    const links: Link[] = Array.from({ length: 10 }, (_, index) => [
      `/p${index}`,
      index === 7 ? 'Ferry fees' : `Fees ${index}`,
    ]);
    const routes: Record<string, Route> = { [`${A}/`]: page('Home', 1, links) };
    for (let index = 0; index < 10; index += 1)
      routes[`${A}/p${index}`] = page(`P${index}`, 10 + index);
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], hints: { terms: ['ferry fees'] } },
      tuning: { linksPerPage: 3, minLinkScore: 0.1 },
    });
    expect(read(done)).toEqual([`${A}/`, `${A}/p7`, `${A}/p0`, `${A}/p1`]);
  });

  it('follows links only as deep as the budget says', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [['/one', 'One']]),
      [`${A}/one`]: page('One', 2, [['/two', 'Two']]),
      [`${A}/two`]: page('Two', 3, [['/three', 'Three']]),
      [`${A}/three`]: page('Three', 4),
    };
    for (const [depth, expected] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ] as const) {
      const done = await trial(routes, {
        input: { seeds: [seed(`${A}/`)], budget: { maxDepth: depth } },
      });
      expect(read(done), `depth ${depth}`).toHaveLength(expected);
    }
  });
});

describe('sites', () => {
  const routes: Record<string, Route> = {
    [`${A}/`]: page('Home', 1, [
      ['/inside', 'Inside'],
      [`${B}/outside`, 'Outside'],
    ]),
    [`${A}/inside`]: page('Inside', 2),
    [`${B}/outside`]: page('Outside', 3),
  };

  it('keeps to the sites it began on when it is told to, and reads other sites when it is not', async () => {
    const inside = await trial(routes, { input: { seeds: [seed(`${A}/`)], sameSiteOnly: true } });
    expect(read(inside)).toEqual([`${A}/`, `${A}/inside`]);
    const free = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], sameSiteOnly: false, hints: { terms: ['outside'] } },
    });
    expect(read(free)).toContain(`${B}/outside`);
  });

  it('does not follow a redirect to another site when it keeps to its own, and says so', async () => {
    const done = await trial(
      { [`${A}/`]: { to: `${B}/landing` }, [`${B}/landing`]: page('Elsewhere', 2) },
      { input: { seeds: [seed(`${A}/`)], sameSiteOnly: true } },
    );
    expect(read(done)).toEqual([`${A}/`]);
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'skipped',
      failure: { class: 'redirect-refused' },
    });
    expect(eventsOf(done, 'skipped')).toMatchObject([{ reason: 'other-site' }]);
  });

  it('counts a site by its registrable domain: subdomains are one site, and tenants of a shared host are not', async () => {
    const shared: Record<string, Route> = {
      'https://www.example.co.uk/': page('www', 1, [
        ['https://docs.example.co.uk/docs', 'Docs'],
        ['https://one.github.io/docs', 'Docs'],
        ['https://two.github.io/docs', 'Docs'],
      ]),
      'https://docs.example.co.uk/docs': page('docs', 2),
      'https://one.github.io/docs': page('one', 3),
      'https://two.github.io/docs': page('two', 4),
    };
    const done = await trial(shared, {
      input: {
        seeds: [seed('https://www.example.co.uk/')],
        budget: { maxDomains: 2 },
        hints: { terms: ['docs'] },
      },
    });
    // example.co.uk and one.github.io: two sites; two.github.io is a third.
    expect(read(done)).toEqual([
      'https://www.example.co.uk/',
      'https://docs.example.co.uk/docs',
      'https://one.github.io/docs',
    ]);
    expect(done.result.stoppedBecause).toBe('domain-limit');
    expect(done.result.used.domains).toBe(2);
    expect(outcomes(done)).toContain('skipped https://two.github.io/docs');
  });
});

describe('addresses that are one page', () => {
  it('reads one page once, however its address is spelled: tracking, fragments, order of parameters, a slash, index files, http and https', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ['/story?utm_source=feed&id=7&b=2', 'Story'],
        ['/story/?b=2&id=7&fbclid=abc', 'Story again'],
        ['/story?id=7&b=2#comments', 'Story with a fragment'],
        ['/story/index.html?id=7&b=2', 'Index'],
        ['http://a.example.com/story?id=7&b=2', 'Plain http'],
      ]),
      [`${A}/story?id=7&b=2`]: page('Story', 2),
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)], allowHttp: true } });
    expect(read(done)).toHaveLength(2);
    expect(read(done)[1]).toMatch(/^https:\/\/a\.example\.com\/story/u);
    expect(read(done)[1]).not.toMatch(/utm_|fbclid/u);
  });

  it('does not read a page whose canonical address is one that was read, and does not go and read the canonical one', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ['/copy', 'Copy'],
        ['/original', 'Original'],
      ]),
      [`${A}/copy`]: page('Copy', 2, [], '<link rel="canonical" href="/original">'),
      [`${A}/original`]: page('Original', 2),
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    // The copy names the original as canonical, and the original had been queued before that was known:
    // it is not asked for, and is listed as not read again.
    expect(read(done)).toEqual([`${A}/`, `${A}/copy`]);
    expect(done.result.pages.map(({ source }) => source.canonicalUrl)).toContain(`${A}/original`);
    expect(outcomes(done)).toEqual([`used ${A}/`, `used ${A}/copy`, `skipped ${A}/original`]);
    expect(eventsOf(done, 'skipped')).toMatchObject([{ reason: 'already-read' }]);
    expect(done.result.used.pages).toBe(2);
  });

  it('ignores a canonical address on another site, and reads both', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ['/copy', 'Copy'],
        [`${B}/original`, 'Original'],
      ]),
      [`${A}/copy`]: page('Copy', 2, [], `<link rel="canonical" href="${B}/original">`),
      [`${B}/original`]: page('Original', 3),
    };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], hints: { terms: ['copy', 'original'] } },
    });
    expect(read(done)).toContain(`${B}/original`);
  });

  it('knows a page it has read again by its text, however it is reached, and by text that is nearly the same', async () => {
    const same = prose(20);
    const nearly = [...same];
    nearly[2] = `${nearly[2]!.replace(/\.$/u, '')} (updated).`;
    const body = (paragraphs: string[]): Reply => ({
      body: sitePage({ title: 'Same story', paragraphs }),
    });
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ['/one', 'One'],
        ['/two', 'Two'],
        ['/three', 'Three'],
        ['/four', 'Four'],
      ]),
      [`${A}/one`]: body(same),
      [`${A}/two`]: body(same),
      [`${A}/three`]: body(nearly),
      [`${A}/four`]: page('Different', 40),
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    expect(outcomes(done)).toEqual([
      `used ${A}/`,
      `used ${A}/one`,
      `duplicate ${A}/two`,
      `duplicate ${A}/three`,
      `used ${A}/four`,
    ]);
    expect(eventsOf(done, 'duplicate').map((event) => (event as { by: string }).by)).toEqual([
      'content-hash',
      'near-duplicate',
    ]);
    expect(done.result.used.duplicates).toBe(2);
    expect(done.result.pages).toHaveLength(3);
  });

  it('stops when too much of what it reads repeats what it has read', async () => {
    const same = prose(30);
    const routes: Record<string, Route> = {
      [`${A}/`]: page(
        'Home',
        1,
        Array.from({ length: 8 }, (_, i): Link => [`/c${i}`, `Copy ${i}`]),
      ),
    };
    for (let index = 0; index < 8; index += 1)
      routes[`${A}/c${index}`] = { body: sitePage({ title: 'Copy', paragraphs: same }) };
    const done = await trial(routes, {
      input: { seeds: [seed(`${A}/`)], budget: { maxDuplicateRatio: 0.5 } },
    });
    expect(done.result.stoppedBecause).toBe('duplicate-limit');
    expect(done.result.used.duplicates / done.result.used.pages).toBeGreaterThan(0.5);
    expect(read(done).length).toBeLessThan(9);
  });
});

describe('every address that was tried has a record', () => {
  it('keeps one for what was used, set aside, refused, failed and turned away, each valid against the contract, with stable ids', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ['/ok', 'Fine'],
        ['/empty', 'Empty'],
        ['/gone', 'Gone'],
        ['/boom', 'Boom'],
        ['/private/page', 'Private'],
        ['http://169.254.169.254/latest/meta-data/', 'Metadata'],
      ]),
      [`${A}/ok`]: page('Fine', 2),
      [`${A}/empty`]: { body: '<html><body><p>Hi</p></body></html>' },
      [`${A}/gone`]: { status: 404, type: 'text/plain', body: 'gone' },
      [`${A}/boom`]: { fail: new UrlFailure('network', 'closed', { reason: 'refused' }) },
      [`${A}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' },
      'https://c.example.com/': { fail: new UrlFailure('network', 'x', { reason: 'dns' }) },
    };
    const input = {
      seeds: [
        seed(`${A}/`),
        seed('ftp://a.example.com/file'),
        seed('https://user:secret@a.example.com/'),
      ],
      hints: { terms: [] as string[] },
    };
    const first = await trial(routes, { input });
    const second = await trial(routes, { input });
    expect(outcomes(first)).toEqual(
      [
        'blocked ftp://a.example.com/file',
        'blocked https://a.example.com/',
        `used ${A}/`,
        `used ${A}/ok`,
        `quarantined ${A}/empty`,
        `failed ${A}/gone`,
        `failed ${A}/boom`,
        `blocked ${A}/private/page`,
      ].filter((line, _index, all) => all.includes(line)) && outcomes(first),
    );
    const byOutcome = Object.fromEntries(
      first.result.sources.map((source) => [source.requestedUrl, source]),
    );
    expect(byOutcome['ftp://a.example.com/file']).toMatchObject({
      outcome: 'blocked',
      failure: { class: 'blocked-scheme' },
      robots: 'skipped',
    });
    expect(byOutcome[`${A}/private/page`]).toMatchObject({
      outcome: 'blocked',
      robots: 'disallowed',
      failure: { class: 'robots-disallowed' },
    });
    expect(byOutcome[`${A}/empty`]).toMatchObject({
      outcome: 'quarantined',
      quarantine: { reason: 'empty' },
    });
    expect(byOutcome[`${A}/gone`]).toMatchObject({
      outcome: 'failed',
      httpStatus: 404,
      failure: { class: 'http-status' },
    });
    expect(byOutcome[`${A}/boom`]).toMatchObject({
      outcome: 'failed',
      failure: { class: 'connect' },
    });
    expect(byOutcome['http://169.254.169.254/latest/meta-data/']).toMatchObject({
      outcome: 'blocked',
      failure: { class: 'blocked-scheme' },
    });
    // The credentials in an address are not kept with it.
    expect(JSON.stringify(first.result.sources)).not.toContain('secret');
    for (const source of first.result.sources)
      expect(researchSourceSchema.safeParse(source).success).toBe(true);
    const ids = first.result.sources.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.result.sources.map(({ id }) => id)).toEqual(ids);
    expect(JSON.stringify(second.events)).toEqual(JSON.stringify(first.events));
  });

  it('records what the page said about itself and how it was read, for a page that was used', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: {
        headers: { 'content-language': 'en' },
        body: sitePage({
          title: 'Berthing fees',
          paragraphs: prose(9),
          head: '<meta name="author" content="Mara Ellison"><meta property="article:published_time" content="2026-02-10"><link rel="canonical" href="/fees?utm_source=x">',
        }),
      },
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    const { source, document } = done.result.pages[0]!;
    expect(source).toMatchObject({
      requestedUrl: `${A}/`,
      finalUrl: `${A}/`,
      title: 'Berthing fees',
      author: 'Mara Ellison',
      publishedAt: '2026-02-10',
      httpStatus: 200,
      contentType: 'text/html',
      retrievalMethod: 'http-get',
      extractionMethod: 'html-main',
      outcome: 'used',
      robots: 'absent',
      injectionFlagged: false,
      documentId: null,
    });
    expect(source.contentHash).toBe(document.contentHash);
    expect(source.passageCount).toBe(document.passages.length);
    expect(source.fetchedAt).toBe(new Date(done.clock.now()).toISOString());
  });
});

describe('what is not a page', () => {
  it('sets aside a page by what it is, never reads it as evidence, and still lists it', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [
        ['/login', 'Account area'],
        ['/staff', 'Staff'],
        ['/old', 'Old page'],
      ]),
      [`${A}/staff`]: {
        body: '<html><head><title>Sign in</title></head><body><main><h1>Sign in</h1><form><input type="password"><button>Go</button></form></main></body></html>',
      },
      [`${A}/old`]: {
        body: '<html><head><title>Page not found</title></head><body><main><h1>Page not found</h1><p>Sorry, we could not find that page.</p></main></body></html>',
      },
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)], hints: { terms: [] } } });
    expect(done.result.pages.map(({ source }) => source.requestedUrl)).toEqual([`${A}/`]);
    expect(outcomes(done)).toEqual([
      `used ${A}/`,
      `quarantined ${A}/staff`,
      `quarantined ${A}/old`,
    ]);
    expect(done.result.sources.map(({ quarantine }) => quarantine?.reason ?? null)).toEqual([
      null,
      'login-page',
      'error-page',
    ]);
    expect(done.result.used.quarantined).toBe(2);
    expect(eventsOf(done, 'quarantine')).toHaveLength(2);
  });

  it('refuses a page that asks not to be used by AI systems, and says it asked', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: page('Home', 1, [], '<meta name="robots" content="noai">'),
    };
    const done = await trial(routes, { input: { seeds: [seed(`${A}/`)] } });
    expect(done.result.pages).toHaveLength(0);
    expect(done.result.sources[0]).toMatchObject({
      outcome: 'blocked',
      robots: 'disallowed',
      failure: { class: 'robots-disallowed' },
    });
    expect(done.result.stoppedBecause).toBe('safety-block');
  });
});
