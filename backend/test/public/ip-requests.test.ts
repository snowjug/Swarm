import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadPublicConfig } from '../../src/public/config.js';
import { testConfig } from '../fixtures.js';
import { publicApp, type PublicHarness } from '../support/public-idp.js';

/**
 * What one address may ask of the site in a minute, on every route with no limit of its own: the page's own files and the
 * reads among them. 120 is the pilot's, and the public edition's default; a public deployment may raise it, so that a room
 * of people behind one address is not answered with 429 for the files of the page.
 */

const open: PublicHarness[] = [];
const pilots: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((made) => made.close()));
  await Promise.all(pilots.splice(0).map(({ app }) => app.close()));
});

/** A route with no limit of its own that answers without a session, so only the general limit applies to it. */
const URL_READ = '/api/health/live';

async function inPublic(environment: Record<string, string> = {}) {
  const made = await publicApp({ RATE_LIMIT_SCALE: '1', ...environment });
  open.push(made);
  return (address: string) =>
    made.app.inject({ method: 'GET', url: URL_READ, remoteAddress: address });
}

async function codes(
  ask: (address: string) => Promise<{ statusCode: number }>,
  times: number,
  address: string,
) {
  const found: number[] = [];
  for (let i = 0; i < times; i++) found.push((await ask(address)).statusCode);
  return found;
}

describe('the general limit on one address', () => {
  it('is 120 a minute when a public deployment says nothing, and the next is refused in the shape every refusal has', async () => {
    const ask = await inPublic();
    const first = await codes(ask, 120, '203.0.113.50');
    expect(first).not.toContain(429);
    const refused = await ask('203.0.113.50');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('is what PUBLIC_IP_REQUESTS_PER_MINUTE says, and each address has its own count', async () => {
    const ask = await inPublic({ PUBLIC_IP_REQUESTS_PER_MINUTE: '300' });
    const first = await codes(ask, 300, '203.0.113.51');
    expect(first).not.toContain(429);
    expect((await ask('203.0.113.51')).statusCode).toBe(429);
    // A second address in the same room is not counted with the first.
    expect((await ask('203.0.113.52')).statusCode).toBe(200);
  });

  it('is still multiplied by the rate limit scale, which a hosted deployment may not raise', async () => {
    const ask = await inPublic({ PUBLIC_IP_REQUESTS_PER_MINUTE: '30', RATE_LIMIT_SCALE: '2' });
    expect(await codes(ask, 60, '203.0.113.53')).not.toContain(429);
    expect((await ask('203.0.113.53')).statusCode).toBe(429);
  });

  it('is unchanged in the pilot, which has no such setting', async () => {
    const made = await buildApp({ config: testConfig({ RATE_LIMIT_SCALE: '1' }) });
    pilots.push(made);
    const ask = () => made.app.inject({ method: 'GET', url: URL_READ });
    expect(await codes(ask, 120, '')).not.toContain(429);
    expect((await ask()).statusCode).toBe(429);
  });

  it('takes 30 to 1,200 a minute and nothing else', () => {
    const base = { PUBLIC_BASE_URL: 'https://swarm.example.com', PUBLIC_PEPPER: 'p'.repeat(40) };
    const read = (value?: string) =>
      loadPublicConfig({
        ...base,
        PUBLIC_GUEST_MODE: 'true',
        ...(value === undefined ? {} : { PUBLIC_IP_REQUESTS_PER_MINUTE: value }),
      }).ipRequestsPerMinute;
    expect(read()).toBe(120);
    expect(read('')).toBe(120);
    expect(read('30')).toBe(30);
    expect(read('600')).toBe(600);
    expect(read('1200')).toBe(1_200);
    for (const bad of ['29', '1201', '0', '-5', '1.5', 'many']) {
      expect(() => read(bad), bad).toThrow(/Invalid server configuration/u);
    }
  });
});
