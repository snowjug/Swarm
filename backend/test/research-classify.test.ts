import { describe, expect, it } from 'vitest';
import { parse } from 'tldts';
import { classifySource } from '../src/research/crawler/classify.js';
import {
  ACADEMIC_SUFFIXES,
  GOVERNMENT_SUFFIXES,
} from '../src/research/crawler/reputable-domains.js';
import {
  cleanAddress,
  dedupeKey,
  registrableDomain,
  sameSite,
  trapOf,
} from '../src/research/crawler/urls.js';

const context = { namedDomains: new Set(['example-ferry.com']) };

describe('what kind of source a page is, judged from its address', () => {
  const table: [address: string, category: string, authority: string, basis: string][] = [
    ['https://www.sec.gov/news/press', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.gov.uk/guidance/ferries', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.ons.gov.uk/', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.service.gouv.fr/', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.canada.gc.ca/', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.who.int/', 'government-regulatory', 'high', 'government-domain'],
    ['https://commission.europa.eu/', 'government-regulatory', 'high', 'intergovernmental-body'],
    ['https://www.oecd.org/economy', 'government-regulatory', 'high', 'intergovernmental-body'],
    ['https://www.mod.go.jp/', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.gov.au/', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.irs.gov/', 'government-regulatory', 'high', 'government-domain'],
    ['https://harbour-authority.example.org/', 'unclassified', 'unknown', 'none'],
    ['https://www.ox.ac.uk/research', 'research-publication', 'medium', 'university-domain'],
    ['https://web.mit.edu/', 'research-publication', 'medium', 'university-domain'],
    ['https://www.unimelb.edu.au/', 'research-publication', 'medium', 'university-domain'],
    ['https://www.u-tokyo.ac.jp/', 'research-publication', 'medium', 'university-domain'],
    ['https://www.nature.com/articles/x', 'research-publication', 'high', 'research-publisher'],
    ['https://pubmed.ncbi.nlm.nih.gov/123/', 'research-publication', 'high', 'research-publisher'],
    ['https://arxiv.org/abs/2401.00001', 'research-publication', 'medium', 'preprint-server'],
    ['https://docs.python.org/3/', 'official-documentation', 'medium', 'documentation-list'],
    [
      'https://developer.mozilla.org/en-US/',
      'official-documentation',
      'medium',
      'documentation-list',
    ],
    ['https://example.com/docs/intro', 'unclassified', 'unknown', 'none'],
    ['https://docs.example.org/', 'unclassified', 'unknown', 'none'],
    ['https://example-ferry.com/', 'primary', 'high', 'named-site'],
    ['https://docs.example-ferry.com/', 'official-documentation', 'high', 'documentation-host'],
    ['https://support.example-ferry.com/', 'official-documentation', 'high', 'documentation-host'],
    ['https://www.example-ferry.com/fares', 'primary', 'high', 'named-site'],
    [
      'https://example-ferry.com/docs/booking',
      'official-documentation',
      'high',
      'documentation-path',
    ],
    ['https://newsroom.example-ferry.com/', 'official-statement', 'high', 'official-statement'],
    ['https://example-ferry.com/press/2026', 'official-statement', 'high', 'official-statement'],
    [
      'https://example-ferry.com/blog/new-boat',
      'official-statement',
      'medium',
      'official-statement',
    ],
    ['https://www.reuters.com/world/uk/story', 'credible-reporting', 'medium', 'reporting-list'],
    ['https://www.bbc.co.uk/news/x', 'credible-reporting', 'medium', 'reporting-list'],
    ['https://www.reddit.com/r/ferries/', 'community', 'low', 'community-site'],
    ['https://stackoverflow.com/questions/1', 'community', 'low', 'community-site'],
    ['https://forum.example.com/t/1', 'community', 'low', 'forum-address'],
    ['https://example.edu/forum/thread/1', 'community', 'low', 'forum-address'],
    ['https://example-ferry.com/community/hello', 'community', 'low', 'forum-address'],
    ['https://someone.github.io/notes', 'unclassified', 'unknown', 'none'],
    ['https://random.example.org/', 'unclassified', 'unknown', 'none'],
    ['https://example.org/news/story', 'unclassified', 'unknown', 'none'],
    ['not an address', 'unclassified', 'unknown', 'none'],
  ];

  it.each(table)('%s is %s, %s authority, by %s', (address, category, authority, basis) => {
    expect(classifySource(address, context)).toEqual({ category, authority, basis });
  });

  it('puts a site that is not named below one that is, and never marks an unknown site higher than low from its own address', () => {
    const rank = { high: 3, medium: 2, low: 1, unknown: 0 } as const;
    const named = classifySource('https://example-ferry.com/', context);
    const unnamed = classifySource('https://example-ferry.com/', { namedDomains: new Set() });
    expect(rank[named.authority]).toBeGreaterThan(rank[unnamed.authority]);
    expect(unnamed.category).toBe('unclassified');
  });

  it('is decided by the site, not by what a path or a query says, so that a page cannot name itself an authority', () => {
    for (const address of [
      'https://random.example.org/gov/official/ministry/regulator',
      'https://random.example.org/?site=www.sec.gov',
      'https://random.example.org/#gov.uk',
      'https://sec.gov.random.example.org/',
      'https://www.sec.gov.evil.example.org/',
    ]) {
      const found = classifySource(address, context);
      expect(found.category, address).not.toBe('government-regulatory');
      expect(found.authority, address).not.toBe('high');
    }
  });

  it('ranks an address that only looks like a university, a publisher or a newspaper as nothing', () => {
    for (const address of [
      'https://nature.com.example.org/',
      'https://www.reuters.com.example.net/',
      'https://xn--nature-9ra.com/',
      'https://mit.edu.example.org/',
    ]) {
      expect(classifySource(address, context).basis, address).not.toBe('research-publisher');
      expect(classifySource(address, context).authority, address).not.toBe('high');
    }
  });
});

describe('names that anyone can get', () => {
  const nothing = { category: 'unclassified', authority: 'unknown', basis: 'none' };

  it.each([
    // a service or an open registry sells names under what looks like a government or a university
    'https://evil.go.dyndns.org/',
    'https://evil.gv.vc/',
    'https://evil.go.biz.ng/',
    'https://evil.gv.uy/',
    'https://shop.go.it/',
    'https://evil.edu.eu.org/',
    'https://evil.gov.edu.eu.org/',
    // words that vouch for nothing in a name that is not on a list and that nobody named
    'https://authority.evil.com/',
    'https://port-authority.evil.com/',
    'https://regulator.evil.com/',
    'https://ministry-of-ferries.evil.com/',
    'https://docs.evil.com/',
    'https://support.evil.com/',
    'https://developer.evil.com/guide',
    'https://evil.com/docs/guide',
    'https://evil.com/support/guide',
    'https://gov.evil.com/',
    'https://evil.com/gov/official',
    'https://evil-gov.com/',
    'https://gov-uk.com/',
    'https://edu.evil.com/',
    'https://university.evil.com/',
    // a list entry or a suffix, further left than where a registry puts it
    'https://gov.uk.evil.com/',
    'https://ac.uk.evil.com/',
    'https://docs.python.org.evil.com/',
    'https://evil.com/docs.python.org/',
    'https://nodejs.org.evil.com/',
    'https://evil.com/?next=https://www.sec.gov/',
  ])('%s is unclassified and unknown', (address) => {
    expect(classifySource(address, context)).toEqual(nothing);
  });

  it('is unclassified and unknown, however an address is spelled, when a person has not named the site', () => {
    for (const address of [
      'https://EVIL.GO.DYNDNS.ORG/',
      'https://evil.go.dyndns.org./',
      'https://evil.go.dyndns.org:8443/x',
      'https://user@evil.gv.vc/',
      'https://xn--evil-9ra.gv.uy/',
    ]) {
      expect(classifySource(address, context), address).toEqual(nothing);
    }
  });

  it('is a site a person named only when they named it: the words in a name never make it one, and naming it makes it theirs and no more', () => {
    const named = { namedDomains: new Set(['evil.com', 'evil.go.dyndns.org']) };
    expect(classifySource('https://docs.evil.com/', named)).toEqual({
      category: 'official-documentation',
      authority: 'high',
      basis: 'documentation-host',
    });
    expect(classifySource('https://evil.go.dyndns.org/', named)).toEqual({
      category: 'primary',
      authority: 'high',
      basis: 'named-site',
    });
    expect(classifySource('https://other.go.dyndns.org/', named)).toEqual(nothing);
    expect(classifySource('https://docs.other.com/', named)).toEqual(nothing);
  });

  it.each([
    ['https://www.sec.gov/x', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.gov.uk/x', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.ons.gov.uk/x', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.service-public.gouv.fr/x', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.meti.go.jp/x', 'government-regulatory', 'high', 'government-domain'],
    ['https://www.europarl.europa.eu/x', 'government-regulatory', 'high', 'intergovernmental-body'],
    ['https://www.ox.ac.uk/x', 'research-publication', 'medium', 'university-domain'],
    ['https://www.stanford.edu/x', 'research-publication', 'medium', 'university-domain'],
    ['https://docs.python.org/x', 'official-documentation', 'medium', 'documentation-list'],
  ])('%s is still %s, %s, by %s', (address, category, authority, basis) => {
    expect(classifySource(address, context)).toEqual({ category, authority, basis });
  });

  it('lists only suffixes that a registry puts in the public part of the list, so that a suffix a service sells names under cannot be on it', () => {
    for (const suffix of [...GOVERNMENT_SUFFIXES, ...ACADEMIC_SUFFIXES]) {
      const found = parse(`example.${suffix}`, { allowPrivateDomains: true });
      expect({ suffix, publicSuffix: found.publicSuffix, icann: found.isIcann }, suffix).toEqual({
        suffix,
        publicSuffix: suffix,
        icann: true,
      });
    }
  });
});

describe('what the page says about itself', () => {
  it('can mark a page as discussion, which no site makes it, and as scholarly when nothing else is known', () => {
    expect(
      classifySource('https://example.edu/page', context, {
        schemaTypes: ['DiscussionForumPosting'],
        citationMeta: false,
      }),
    ).toEqual({ category: 'community', authority: 'low', basis: 'discussion-markup' });
    expect(
      classifySource('https://random.example.org/p', context, {
        schemaTypes: [],
        citationMeta: true,
      }),
    ).toEqual({
      category: 'research-publication',
      authority: 'unknown',
      basis: 'scholarly-markup',
    });
  });

  it('cannot raise a page above what its site is, and cannot make a named or government site anything else', () => {
    const scholarly = { schemaTypes: ['ScholarlyArticle'], citationMeta: true };
    expect(classifySource('https://www.sec.gov/x', context, scholarly).basis).toBe(
      'government-domain',
    );
    expect(classifySource('https://example-ferry.com/x', context, scholarly).basis).toBe(
      'named-site',
    );
    expect(classifySource('https://www.reddit.com/r/x', context, scholarly).category).toBe(
      'community',
    );
  });
});

describe('which site an address belongs to', () => {
  it.each([
    ['www.example.co.uk', 'example.co.uk'],
    ['docs.example.co.uk', 'example.co.uk'],
    ['a.b.c.example.com', 'example.com'],
    ['EXAMPLE.com.', 'example.com'],
    ['one.github.io', 'one.github.io'],
    ['two.github.io', 'two.github.io'],
    ['blog.one.github.io', 'one.github.io'],
    ['localhost', 'localhost'],
    ['10.0.0.1', '10.0.0.1'],
    ['[::1]', '::1'],
  ])('%s is of %s', (host, domain) => {
    expect(registrableDomain(host)).toBe(domain);
  });

  it('says two addresses are of one site only when their registrable domains are the same', () => {
    expect(sameSite('https://www.example.co.uk/a', 'https://docs.example.co.uk/b')).toBe(true);
    expect(sameSite('https://one.github.io/', 'https://two.github.io/')).toBe(false);
    expect(sameSite('https://example.com/', 'https://example.com.evil.net/')).toBe(false);
    expect(sameSite('not an address', 'https://example.com/')).toBe(false);
  });
});

describe('addresses that are one page', () => {
  it('are called the same when they differ in scheme, case of the host, a default port, a fragment, tracking, order of parameters, a trailing slash, an index file, doubled slashes or a session', () => {
    const same = [
      'https://a.example.com/story?id=7&b=2',
      'http://a.example.com/story?id=7&b=2',
      'https://A.Example.COM/story/?b=2&id=7&utm_source=feed#comments',
      'https://a.example.com:443/story/index.html?id=7&b=2&fbclid=abc',
      'https://a.example.com//story?b=2&id=7&gclid=x',
      'https://a.example.com/story;jsessionid=ABC123?id=7&b=2',
      'https://a.example.com/story?PHPSESSID=abc&id=7&b=2',
    ];
    const keys = new Set(same.map(dedupeKey));
    expect([...keys]).toEqual(['a.example.com/story?b=2&id=7']);
    expect(dedupeKey('https://a.example.com/a%7Eb')).toBe(dedupeKey('https://a.example.com/a~b'));
    expect(dedupeKey('https://a.example.com/a%2fb')).toBe(dedupeKey('https://a.example.com/a%2Fb'));
    expect(dedupeKey('https://a.example.com/')).toBe(dedupeKey('https://a.example.com'));
  });

  it('are called different when the page could be different', () => {
    const distinct = [
      'https://a.example.com/story',
      'https://a.example.com/Story',
      'https://a.example.com/story?id=7',
      'https://a.example.com/story?id=8',
      'https://a.example.com:8443/story',
      'https://b.example.com/story',
      'https://a.example.com/story/2',
      'https://a.example.com/a%2Fb',
      'https://a.example.com/a/b',
    ];
    expect(new Set(distinct.map(dedupeKey)).size).toBe(distinct.length);
  });

  it('gives an address to fetch without a fragment or tracking, with the rest as the page wrote it, and only for web addresses', () => {
    expect(cleanAddress('https://a.example.com/p?id=7&utm_source=x&b=2#top')).toBe(
      'https://a.example.com/p?id=7&b=2',
    );
    expect(cleanAddress('HTTPS://A.Example.com:443/p')).toBe('https://a.example.com/p');
    for (const address of [
      'javascript:alert(1)',
      'mailto:a@example.com',
      'data:text/html,hi',
      'ftp://a.example.com/',
      'file:///etc/passwd',
      '//a.example.com/p',
      'not an address',
    ]) {
      expect(cleanAddress(address), address).toBeNull();
    }
  });
});

describe('addresses that lead nowhere new', () => {
  const skipped: [address: string, reason: string][] = [
    ['https://a.example.com/login', 'account-or-basket'],
    ['https://a.example.com/users/sign-in', 'account-or-basket'],
    ['https://a.example.com/cart/add', 'account-or-basket'],
    ['https://a.example.com/checkout', 'account-or-basket'],
    ['https://a.example.com/wp-admin/', 'account-or-basket'],
    ['https://a.example.com/account/settings', 'account-or-basket'],
    ['https://a.example.com/feed/', 'feed-or-share'],
    ['https://a.example.com/news.rss', 'feed-or-share'],
    ['https://a.example.com/share?u=x', 'feed-or-share'],
    ['https://a.example.com/post?replytocom=5', 'feed-or-share'],
    ['https://a.example.com/search?q=tram', 'search'],
    ['https://a.example.com/products?s=tram', 'search'],
    ['https://a.example.com/calendar/2026/03', 'calendar'],
    ['https://a.example.com/events/?month=2026-04', 'calendar'],
    ['https://a.example.com/archive/2026/03', 'calendar'],
    ['https://a.example.com/news/page/9/', 'paging'],
    ['https://a.example.com/news?page=12', 'paging'],
    ['https://a.example.com/docs/a/b/a/b/a/b', 'repeating-path'],
    ['https://a.example.com/x/y/z/x/y/z', 'repeating-path'],
    ['https://a.example.com/files/report.zip', 'file-type'],
    ['https://a.example.com/files/report.pdf', 'file-type'],
    ['https://a.example.com/img/hero.PNG', 'file-type'],
    ['https://a.example.com/app.js', 'file-type'],
    ['https://a.example.com/data.xml', 'file-type'],
    ['https://a.example.com/s1/s2/s3/s4/s5/s6/s7/s8/s9/s10/s11/s12/s13', 'long-path'],
    ['not an address', 'invalid'],
  ];

  it.each(skipped)('leaves out %s (%s)', (address, reason) => {
    expect(trapOf(address)).toMatchObject({ skip: true, reason });
  });

  const kept: string[] = [
    'https://a.example.com/',
    'https://a.example.com/fees/ferry-fees',
    'https://a.example.com/2026/03/15/post-title',
    'https://a.example.com/news/page/1/',
    'https://a.example.com/results/2026',
    'https://a.example.com/find-a-ferry',
    'https://a.example.com/oauth-explained',
    'https://a.example.com/sharing-economy-report',
    'https://a.example.com/searching-for-answers',
    'https://a.example.com/p?id=7&view=full',
  ];

  it.each(kept)('does not leave out %s, which is a page', (address) => {
    expect(trapOf(address).skip).toBe(false);
  });

  it('ranks lower, without leaving out, a second page of a listing, a sorted listing, an archive and an address with many parameters', () => {
    expect(trapOf('https://a.example.com/fees')).toMatchObject({ skip: false, penalty: 0 });
    expect(trapOf('https://a.example.com/news/page/2/')).toMatchObject({
      skip: false,
      reason: 'paging',
    });
    expect(trapOf('https://a.example.com/list?sort=price')).toMatchObject({
      skip: false,
      reason: 'filtering',
    });
    expect(trapOf('https://a.example.com/tag/ferry')).toMatchObject({
      skip: false,
      reason: 'archive',
    });
    expect(trapOf('https://a.example.com/p?a=1&b=2&c=3&d=4&e=5')).toMatchObject({
      skip: false,
      reason: 'many-parameters',
    });
    for (const address of [
      'https://a.example.com/news/page/2/',
      'https://a.example.com/list?sort=price',
      'https://a.example.com/tag/ferry',
    ]) {
      expect(trapOf(address).penalty).toBeGreaterThan(0);
    }
  });

  it('reads a PDF only when there is somewhere safe to read it', () => {
    expect(trapOf('https://a.example.com/report.pdf', false).skip).toBe(true);
    expect(trapOf('https://a.example.com/report.pdf', true).skip).toBe(false);
  });
});
