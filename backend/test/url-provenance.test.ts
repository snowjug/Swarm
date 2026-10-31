import { describe, expect, it } from 'vitest';
import { sourceProvenanceSchema } from '../../shared/scenario.js';
import {
  buildProvenance,
  FetchRegistry,
  isSecretParameter,
  redactUrl,
  sha256,
} from '../src/ingest/url/provenance.js';

describe('keeping an address without its secrets', () => {
  it.each([
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'Token',
    'key',
    'api_key',
    'api-key',
    'apikey',
    'ApiKey',
    'x-api-key',
    'subscription-key',
    'client_secret',
    'secret',
    'password',
    'passwd',
    'pwd',
    'pass',
    'auth',
    'authorization',
    'oauth_token',
    'sig',
    'signature',
    'X-Goog-Signature',
    'session',
    'sessionid',
    'session_id',
    'sid',
    'code',
    'jwt',
    'otp',
    'credential',
    'bearer',
    'x-amz-signature',
    'X-Amz-Credential',
    'X-Amz-Security-Token',
    'x-amz-date',
    'x-amz-expires',
    'x-amz-anything',
  ])('treats %s as a secret', (name) => expect(isSecretParameter(name)).toBe(true));

  it.each(['q', 'page', 'sort', 'utm_source', 'id', 'lang', 'author', 'zipcode', 'v', 'category'])(
    'keeps %s',
    (name) => expect(isSecretParameter(name)).toBe(false),
  );

  it('replaces only the value of a secret parameter, and keeps the rest exactly as it was', () => {
    expect(
      redactUrl('https://example.com/a/b?q=cats%20and+dogs&token=abc123&page=2&api_key=K&x=#frag'),
    ).toBe(
      'https://example.com/a/b?q=cats%20and+dogs&token=[redacted]&page=2&api_key=[redacted]&x=',
    );
    expect(redactUrl('https://example.com/?X-Amz-Signature=deadbeef&X-Amz-Date=20260101')).toBe(
      'https://example.com/?X-Amz-Signature=[redacted]&X-Amz-Date=[redacted]',
    );
    expect(redactUrl('https://example.com/?%74oken=abc&Sig=1&flag')).toBe(
      'https://example.com/?%74oken=[redacted]&Sig=[redacted]&flag',
    );
    expect(redactUrl('https://example.com/?password')).toBe(
      'https://example.com/?password=[redacted]',
    );
  });

  it('drops the fragment, and leaves an address without a query alone', () => {
    expect(redactUrl('https://example.com/page#access_token=secret')).toBe(
      'https://example.com/page',
    );
    expect(redactUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('keeps no secret in a value however the name is spelled or encoded', () => {
    const leaked = 'zq-canary-7421-VALUE';
    for (const name of ['token', 'TOKEN', '%74oken', 'to%6Ben', 'access%5Ftoken', 'api%2Dkey']) {
      expect(redactUrl(`https://example.com/?${name}=${leaked}&a=b`), name).not.toContain(leaked);
    }
  });

  it('never returns more than the stored contract allows: it drops the query rather than cut it', () => {
    const long = `https://example.com/p?${'a=b&'.repeat(20)}${'t=1&'.repeat(240)}token=${'x'.repeat(900)}`;
    const redacted = redactUrl(long);
    expect(redacted.length).toBeLessThanOrEqual(2_048);
    expect(redacted).not.toContain('xxxx');
  });
});

describe('what the server says about a page it fetched', () => {
  const page = {
    url: 'https://example.com/product?id=7&token=abc#top',
    finalUrl: 'https://www.example.com/product?id=7&token=abc&session=zzz',
    contentType: 'text/html',
    text: 'Title: A product\n\nA description of a product that is long enough.',
    title: 'A product',
    retrievedAt: new Date('2026-10-31T09:00:00.000Z'),
  };

  it('records the address, the final address, the time, the type, a hash of the text, and that it was fetched', () => {
    const provenance = buildProvenance(page);
    expect(provenance).toEqual({
      kind: 'url',
      url: 'https://example.com/product?id=7&token=[redacted]',
      finalUrl: 'https://www.example.com/product?id=7&token=[redacted]&session=[redacted]',
      retrievedAt: '2026-10-31T09:00:00.000Z',
      contentType: 'text/html',
      sha256: sha256(page.text),
      title: 'A product',
      fetchedByServer: true,
    });
    expect(sourceProvenanceSchema.safeParse(provenance).success).toBe(true);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('leaves out a title that is empty, and cuts one that is too long', () => {
    expect(buildProvenance({ ...page, title: null })).not.toHaveProperty('title');
    expect(buildProvenance({ ...page, title: 'x'.repeat(500) }).title).toHaveLength(300);
  });
});

describe('who may say a document was fetched by the server', () => {
  const fetched = (text: string) =>
    buildProvenance({
      url: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      contentType: 'text/plain',
      text,
      title: null,
    });
  const claim = (content: string, provenance: unknown) => [{ name: 'a.txt', content, provenance }];

  it('keeps provenance for the exact text the server recorded for the same person, and uses its copy', () => {
    const registry = new FetchRegistry();
    const recorded = fetched('The page text.');
    registry.record('t\nalice', recorded);
    const documents = claim('  The page text.  ', {
      ...recorded,
      title: 'A title the client made up',
      finalUrl: 'https://elsewhere.example/',
    });
    registry.attest('t\nalice', documents);
    expect(documents[0]!.provenance).toEqual(recorded);
  });

  it('turns a claim the server never made into pasted text', () => {
    const registry = new FetchRegistry();
    const forged = {
      kind: 'url',
      url: 'https://example.com/a',
      sha256: sha256('Text the client wrote.'),
      fetchedByServer: true,
    };
    const documents = [
      ...claim('Text the client wrote.', forged),
      ...claim('Text the client wrote.', { kind: 'upload', fetchedByServer: true }),
      ...claim('Text the client wrote.', { kind: 'url', url: 'https://example.com/a' }),
    ];
    registry.attest('t\nalice', documents);
    for (const document of documents) expect(document.provenance).toEqual({ kind: 'paste' });
  });

  it('turns it into pasted text for another person, another workspace, or edited text', () => {
    const registry = new FetchRegistry();
    const recorded = fetched('The page text.');
    registry.record('t\nalice', recorded);
    for (const [scope, content] of [
      ['t\nbob', 'The page text.'],
      ['u\nalice', 'The page text.'],
      ['t\nalice', 'The page text. And more.'],
    ] as const) {
      const documents = claim(content, recorded);
      registry.attest(scope, documents);
      expect(documents[0]!.provenance, `${scope} ${content}`).toEqual({ kind: 'paste' });
    }
  });

  it('leaves other provenance, and a document with none, as it is', () => {
    const registry = new FetchRegistry();
    const documents = [
      ...claim('One.', { kind: 'upload' }),
      ...claim('Two.', { kind: 'sample', title: 'Example' }),
      ...claim('Three.', { kind: 'historical', asOf: '2024-01-01', fetchedByServer: false }),
      { name: 'b.txt', content: 'Four.' },
    ];
    const before = structuredClone(documents);
    registry.attest('t\nalice', documents);
    expect(documents).toEqual(before);
  });

  it('copes with a body that is not what it should be', () => {
    const registry = new FetchRegistry();
    for (const documents of [
      undefined,
      null,
      'text',
      7,
      {},
      [null, 1, 'x', [], { provenance: 'url' }],
    ]) {
      expect(() => registry.attest('t\nalice', documents)).not.toThrow();
    }
    const odd = [
      { content: 7, provenance: { kind: 'url' } },
      { provenance: { fetchedByServer: true } },
    ];
    registry.attest('t\nalice', odd);
    expect(odd.map((document) => document.provenance)).toEqual([
      { kind: 'paste' },
      { kind: 'paste' },
    ]);
  });

  it('forgets a page after an hour, and when it holds too many', () => {
    let now = 1_000_000;
    const registry = new FetchRegistry(3_600_000, 3, () => now);
    const first = fetched('first');
    registry.record('s', first);
    now += 3_599_999;
    expect(registry.vouched('s', sha256('first'))).toEqual(first);
    now += 2;
    expect(registry.vouched('s', sha256('first'))).toBeUndefined();

    for (const text of ['a', 'b', 'c', 'd']) registry.record('s', fetched(text));
    expect(registry.vouched('s', sha256('a'))).toBeUndefined();
    for (const text of ['b', 'c', 'd']) expect(registry.vouched('s', sha256(text))).toBeDefined();
  });

  it('records nothing for provenance without a hash', () => {
    const registry = new FetchRegistry();
    registry.record('s', { kind: 'url', fetchedByServer: true });
    expect(registry.vouched('s', sha256(''))).toBeUndefined();
  });
});
