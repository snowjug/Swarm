import { describe, expect, it } from 'vitest';
import { TaskCache, fingerprint, type CacheScope } from '../src/models/cache.js';

// The cache stores a validated answer under a key that names its tenant, and it forgets by size and
// by time. It never holds a prompt, and nothing in it is shared between tenants.

const scope = (extra: Partial<CacheScope> = {}): CacheScope => ({
  tenantId: 'tenant-a',
  role: 'extraction',
  taskName: 'extract.v1',
  schemaVersion: 's1',
  deployment: 'dep-1',
  ...extra,
});
const input = fingerprint('Instructions.', { text: 'a passage' })!;

describe('tenant isolation', () => {
  it('never gives one tenant what another stored, with every other part of the key the same', () => {
    const cache = new TaskCache();
    expect(cache.set(scope(), input, { items: ['secret of A'] })).toBe(true);
    expect(cache.get(scope(), input)).toEqual({ items: ['secret of A'] });
    expect(cache.get(scope({ tenantId: 'tenant-b' }), input)).toBeUndefined();
    expect(cache.get(scope({ tenantId: 'tenant-a ' }), input)).toBeUndefined();
    expect(cache.get(scope({ tenantId: 'TENANT-A' }), input)).toBeUndefined();
    // A tenant that is only a prefix, or a suffix, of another's is not that tenant.
    cache.set(scope({ tenantId: 'tenant-a-extra' }), input, { items: ['other'] });
    expect(cache.get(scope(), input)).toEqual({ items: ['secret of A'] });
  });

  it('refuses to store or find anything without a tenant, or with one that is not a plain id', () => {
    const cache = new TaskCache();
    expect(cache.set(scope({ tenantId: '' }), input, { a: 1 })).toBe(false);
    expect(cache.set(scope({ tenantId: 'x'.repeat(201) }), input, { a: 1 })).toBe(false);
    expect(cache.get(scope({ tenantId: '' }), input)).toBeUndefined();
    expect(cache.stats().entries).toBe(0);
  });

  it('cannot be confused by a tenant whose id looks like the rest of a key', () => {
    const cache = new TaskCache();
    cache.set(scope({ tenantId: 'a","extraction' }), input, { who: 'one' });
    cache.set(scope({ tenantId: 'a' }), input, { who: 'two' });
    expect(cache.get(scope({ tenantId: 'a' }), input)).toEqual({ who: 'two' });
    expect(cache.get(scope({ tenantId: 'a","extraction' }), input)).toEqual({ who: 'one' });
  });

  it('forgets one tenant without touching another', () => {
    const cache = new TaskCache();
    cache.set(scope(), input, { v: 1 });
    cache.set(scope({ tenantId: 'tenant-b' }), input, { v: 2 });
    cache.clear('tenant-a');
    expect(cache.get(scope(), input)).toBeUndefined();
    expect(cache.get(scope({ tenantId: 'tenant-b' }), input)).toEqual({ v: 2 });
    cache.clear();
    expect(cache.stats().entries).toBe(0);
  });
});

describe('what makes an entry the same entry', () => {
  it.each([
    ['role', { role: 'critic' as const }],
    ['task name', { taskName: 'extract.v2' }],
    ['schema version', { schemaVersion: 's2' }],
    ['deployment', { deployment: 'dep-2' }],
  ])('a different %s is a different entry', (_part, change) => {
    const cache = new TaskCache();
    cache.set(scope(), input, { v: 1 });
    expect(cache.get(scope(change), input)).toBeUndefined();
    expect(
      cache.get(scope(), fingerprint('Instructions.', { text: 'another passage' })!),
    ).toBeUndefined();
    expect(
      cache.get(scope(), fingerprint('Other instructions.', { text: 'a passage' })!),
    ).toBeUndefined();
  });

  it('hashes the same content to the same value however the object was built', () => {
    expect(fingerprint('i', { b: 1, a: [1, { y: 2, x: 1 }] })).toBe(
      fingerprint('i', { a: [1, { x: 1, y: 2 }], b: 1 }),
    );
    expect(fingerprint('i', { a: 1, b: undefined })).toBe(fingerprint('i', { a: 1 }));
    expect(fingerprint('i', [1, 2])).not.toBe(fingerprint('i', [2, 1]));
    expect(fingerprint('i', { a: '1' })).not.toBe(fingerprint('i', { a: 1 }));
    expect(fingerprint('i', 'x')).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('does not hash what is not plain JSON, so that two different inputs cannot share a key', () => {
    expect(fingerprint('i', { m: new Map([[1, 2]]) })).toBeNull();
    expect(fingerprint('i', { f: () => 1 })).toBeNull();
    expect(fingerprint('i', { d: new Date() })).toBeNull();
    expect(fingerprint('i', { n: Number.NaN })).toBeNull();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(fingerprint('i', cycle)).toBeNull();
  });

  it('keeps the hash and the answer, never the prompt', () => {
    const cache = new TaskCache();
    cache.set(scope(), fingerprint('SECRET-INSTRUCTIONS', { text: 'SECRET-PASSAGE' })!, {
      ok: true,
    });
    expect(
      JSON.stringify([...(cache as unknown as { entries: Map<string, unknown> }).entries]),
    ).not.toMatch(/SECRET/u);
  });
});

describe('what it keeps, and for how long', () => {
  it('forgets an entry when its time is up', () => {
    let now = 1_000;
    const cache = new TaskCache({ ttlMs: 500, now: () => now });
    cache.set(scope(), input, { v: 1 });
    now += 499;
    expect(cache.get(scope(), input)).toEqual({ v: 1 });
    now += 2;
    expect(cache.get(scope(), input)).toBeUndefined();
    expect(cache.stats().entries).toBe(0);
  });

  it('drops the entry used longest ago when it holds more than it may', () => {
    const cache = new TaskCache({ maxEntries: 3 });
    const key = (n: number) => fingerprint('i', { n })!;
    for (const n of [1, 2, 3]) cache.set(scope(), key(n), { n });
    expect(cache.get(scope(), key(1))).toEqual({ n: 1 });
    cache.set(scope(), key(4), { n: 4 });
    expect(cache.get(scope(), key(2))).toBeUndefined();
    expect([1, 3, 4].map((n) => cache.get(scope(), key(n)))).toEqual([
      { n: 1 },
      { n: 3 },
      { n: 4 },
    ]);
    expect(cache.stats()).toMatchObject({ entries: 3, evictions: 1 });
  });

  it('is bounded in bytes, for an entry and in all', () => {
    const cache = new TaskCache({ maxEntryBytes: 1_000, maxBytes: 3_000, maxEntries: 100 });
    expect(cache.set(scope(), input, { text: 'x'.repeat(2_000) })).toBe(false);
    for (let n = 0; n < 10; n += 1)
      cache.set(scope(), fingerprint('i', { n })!, { text: 'x'.repeat(700) });
    const stats = cache.stats();
    expect(stats.bytes).toBeLessThanOrEqual(3_000);
    expect(stats.entries).toBeLessThan(10);
    expect(stats.evictions).toBeGreaterThan(0);
  });

  it('gives a copy, so that a caller who changes an answer does not change the next caller’s', () => {
    const cache = new TaskCache();
    const stored = { list: ['a'], nested: { n: 1 } };
    cache.set(scope(), input, stored);
    stored.list.push('changed after storing');
    const first = cache.get(scope(), input) as typeof stored;
    expect(first.list).toEqual(['a']);
    first.list.push('changed after reading');
    expect(cache.get(scope(), input)).toEqual({ list: ['a'], nested: { n: 1 } });
  });

  it('does not store what cannot be read back as plain JSON', () => {
    const cache = new TaskCache();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(cache.set(scope(), input, cycle)).toBe(false);
    expect(cache.set(scope(), input, undefined)).toBe(false);
    expect(cache.set(scope(), input, 10n)).toBe(false);
  });

  it('counts what it was asked for and could and could not give', () => {
    const cache = new TaskCache();
    cache.set(scope(), input, { v: 1 });
    cache.get(scope(), input);
    cache.get(scope({ tenantId: 'other' }), input);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('forgets one entry on request: an answer that no longer passes its checks is not offered again', () => {
    const cache = new TaskCache();
    cache.set(scope(), input, { v: 1 });
    cache.delete(scope(), input);
    expect(cache.get(scope(), input)).toBeUndefined();
  });
});
