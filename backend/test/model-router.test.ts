import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createRouter, MAX_OUTPUT_TOKENS } from '../src/models/router.js';
import type { RoutingConfig } from '../src/models/routing-config.js';
import { MODEL_ROLES } from '../src/models/task.js';

// The router is configuration and arithmetic: the same request and the same settings always give the
// same route, and every deployment it can return is one the operator named.

const environment = {
  AI_PROVIDER: 'foundry',
  AI_MODEL: 'general-dep',
  FOUNDRY_ENDPOINT: 'https://swarm-test.openai.azure.com',
};

const routing = (extra: Record<string, string> = {}): RoutingConfig =>
  loadConfig({ ...environment, ...extra }).routing;

const profiles = (value: Record<string, unknown>) => ({
  FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify(value),
});
const prices = (value: Array<[string, number, number]>) => ({
  MODEL_PRICES: JSON.stringify(
    value.map(([deployment, inputPerMillionUsd, outputPerMillionUsd]) => ({
      deployment,
      inputPerMillionUsd,
      outputPerMillionUsd,
    })),
  ),
});

const SIZES = [500, 8_000, 40_000];

describe('the zero-config default: one deployment serves every role', () => {
  const router = createRouter(routing());

  it.each(MODEL_ROLES.flatMap((role) => SIZES.map((size) => [role, size] as const)))(
    '%s with %i characters goes to the default deployment',
    (role, contextChars) => {
      const route = router.route({ role, contextChars });
      expect(route).toMatchObject({
        role,
        deployment: 'general-dep',
        reasoningEffort: null,
        strictSchema: true,
        fallbackDeployment: null,
        dataZone: null,
        timeoutMs: 120_000,
        retry: { transient: 2, throttle: 5 },
      });
      expect(route.temperature).toBeGreaterThanOrEqual(0);
      expect(route.temperature).toBeLessThanOrEqual(1);
      expect(route.maxTokens).toBeGreaterThan(0);
      expect(route.maxTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
      expect(route.estimatedInputTokens).toBe(Math.ceil(contextChars / 3));
    },
  );

  it('asks extraction for the least variation and takes the answer budget from the task when it says one', () => {
    expect(router.route({ role: 'extraction', contextChars: 100 }).temperature).toBe(0);
    expect(router.route({ role: 'extraction', contextChars: 100 }).temperature).toBeLessThanOrEqual(
      router.route({ role: 'actor', contextChars: 100 }).temperature ?? 0,
    );
    expect(router.route({ role: 'critic', contextChars: 100, maxTokens: 700 }).maxTokens).toBe(700);
    expect(router.route({ role: 'critic', contextChars: 100, maxTokens: 900_000 }).maxTokens).toBe(
      MAX_OUTPUT_TOKENS,
    );
  });

  it('gives the same route for the same request, and leaves the configuration alone', () => {
    const settings = routing({ FOUNDRY_DEPLOYMENT_ACTOR: 'actor-dep' });
    const before = JSON.stringify(settings);
    const request = { role: 'actor', contextChars: 1_234, requiresReasoning: true } as const;
    const first = createRouter(settings).route(request);
    expect(createRouter(settings).route(request)).toEqual(first);
    expect(router.route(request)).toEqual(router.route(request));
    expect(JSON.stringify(settings)).toBe(before);
  });
});

describe('a deployment for each role', () => {
  const settings = routing({
    FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
    FOUNDRY_DEPLOYMENT_CRITIC: 'critic-dep',
    FOUNDRY_DEPLOYMENT_FALLBACK: 'spare-dep',
  });
  const router = createRouter(settings);

  it.each([
    ['extraction', 'extract-dep'],
    ['critic', 'critic-dep'],
    ['actor', 'general-dep'],
    ['scenario', 'general-dep'],
    ['synthesis', 'general-dep'],
    ['research-planner', 'general-dep'],
  ] as const)('%s uses %s', (role, deployment) => {
    expect(router.route({ role, contextChars: 1_000 }).deployment).toBe(deployment);
  });

  it('names the next deployment as the one to try if this one fails, once', () => {
    expect(router.route({ role: 'extraction', contextChars: 1 })).toMatchObject({
      deployment: 'extract-dep',
      fallbackDeployment: 'general-dep',
    });
    expect(router.route({ role: 'actor', contextChars: 1 })).toMatchObject({
      deployment: 'general-dep',
      fallbackDeployment: 'spare-dep',
    });
  });

  it('only ever returns a deployment that was configured', () => {
    const named = new Set(['general-dep', 'extract-dep', 'critic-dep', 'spare-dep']);
    for (const role of MODEL_ROLES) {
      for (const size of SIZES) {
        const route = router.route({ role, contextChars: size });
        expect(named.has(route.deployment)).toBe(true);
        if (route.fallbackDeployment) expect(named.has(route.fallbackDeployment)).toBe(true);
      }
    }
    expect([...router.deployments()].sort()).toEqual([...named].sort());
  });
});

describe('a task that needs reasoning', () => {
  const settings = routing({
    FOUNDRY_DEPLOYMENT_REASONING: 'deep-dep',
    ...profiles({ 'deep-dep': { reasoning: true } }),
  });
  const router = createRouter(settings);

  it('prefers the reasoning deployment, and gives it an effort instead of a temperature', () => {
    const route = router.route({ role: 'critic', contextChars: 1_000, requiresReasoning: true });
    expect(route).toMatchObject({ deployment: 'deep-dep', temperature: null });
    expect(route.reasoningEffort).toBe('high');
    expect(route.because).toContain('reasoning-deployment');
    expect(route.fallbackDeployment).toBe('general-dep');
  });

  it('does not use it when reasoning is not needed', () => {
    expect(router.route({ role: 'critic', contextChars: 1_000 })).toMatchObject({
      deployment: 'general-dep',
      reasoningEffort: null,
    });
  });

  it('raises the effort a level, lowers it for a short wait, and leaves room for the thinking', () => {
    const plain = router.route({ role: 'extraction', contextChars: 1, requiresReasoning: true });
    expect(plain.reasoningEffort).toBe('medium');
    expect(plain.maxTokens).toBeGreaterThan(4_000);
    const hurried = router.route({
      role: 'critic',
      contextChars: 1,
      requiresReasoning: true,
      latencyBudgetMs: 10_000,
    });
    expect(hurried.reasoningEffort).toBe('low');
    expect(
      router.route({
        role: 'synthesis',
        contextChars: 1,
        requiresReasoning: true,
        maxTokens: 15_500,
      }).maxTokens,
    ).toBe(MAX_OUTPUT_TOKENS);
  });

  it('is only a preference: with no reasoning deployment the task still runs', () => {
    const route = createRouter(routing()).route({
      role: 'critic',
      contextChars: 1_000,
      requiresReasoning: true,
    });
    expect(route.deployment).toBe('general-dep');
    expect(route.because).toContain('reasoning-unavailable');
    expect(route.temperature).not.toBeNull();
  });

  it('keeps a role’s own deployment when that is itself a reasoning one', () => {
    const own = createRouter(
      routing({
        FOUNDRY_DEPLOYMENT_CRITIC: 'critic-deep',
        FOUNDRY_DEPLOYMENT_REASONING: 'deep-dep',
        ...profiles({ 'critic-deep': { reasoning: true }, 'deep-dep': { reasoning: true } }),
      }),
    );
    expect(own.route({ role: 'critic', contextChars: 1, requiresReasoning: true }).deployment).toBe(
      'critic-deep',
    );
  });
});

describe('what a deployment is declared to take', () => {
  it('passes over a deployment whose context is smaller than the request, and says so when none fits', () => {
    const router = createRouter(
      routing({
        FOUNDRY_DEPLOYMENT_EXTRACTION: 'small-dep',
        ...profiles({
          'small-dep': { maxContextChars: 10_000 },
          'general-dep': { maxContextChars: 60_000 },
        }),
      }),
    );
    expect(router.route({ role: 'extraction', contextChars: 9_000 }).deployment).toBe('small-dep');
    expect(router.route({ role: 'extraction', contextChars: 20_000 }).deployment).toBe(
      'general-dep',
    );
    expect(() => router.route({ role: 'extraction', contextChars: 90_000 })).toThrowError(
      expect.objectContaining({ code: 'MODEL_ROUTE_UNAVAILABLE', statusCode: 503 }),
    );
  });

  it('asks for strict structured output unless the deployment is declared not to take it', () => {
    const router = createRouter(
      routing({ ...profiles({ 'general-dep': { structuredOutputs: false } }) }),
    );
    expect(router.route({ role: 'actor', contextChars: 1 }).strictSchema).toBe(false);
  });
});

describe('the data zone', () => {
  const zoned = routing({
    FOUNDRY_DEPLOYMENT_SYNTHESIS: 'eu-dep',
    FOUNDRY_DEPLOYMENT_FALLBACK: 'us-dep',
    ...profiles({ 'eu-dep': { dataZone: 'eu' }, 'us-dep': { dataZone: 'us' } }),
  });
  const router = createRouter(zoned);

  it('holds a task that needs a zone to the deployments declared in it', () => {
    const route = router.route({ role: 'synthesis', contextChars: 100, dataZone: 'eu' });
    expect(route).toMatchObject({ deployment: 'eu-dep', dataZone: 'eu', fallbackDeployment: null });
    expect(router.route({ role: 'synthesis', contextChars: 100, dataZone: 'US' }).deployment).toBe(
      'us-dep',
    );
  });

  it('never assumes a deployment is in a zone it did not declare', () => {
    expect(() => router.route({ role: 'actor', contextChars: 100, dataZone: 'eu' })).toThrowError(
      expect.objectContaining({
        code: 'MODEL_ROUTE_UNAVAILABLE',
        message: expect.stringContaining('data zone'),
      }),
    );
    expect(() => router.route({ role: 'synthesis', contextChars: 1, dataZone: 'apac' })).toThrow(
      'data zone',
    );
  });

  it('holds every task to the configured zone, and lets a task name its own', () => {
    const policy = createRouter(
      routing({
        FOUNDRY_DATA_ZONE: 'eu',
        FOUNDRY_DEPLOYMENT_FALLBACK: 'us-dep',
        ...profiles({ 'general-dep': { dataZone: 'eu' }, 'us-dep': { dataZone: 'us' } }),
      }),
    );
    expect(policy.route({ role: 'actor', contextChars: 1 })).toMatchObject({
      deployment: 'general-dep',
      dataZone: 'eu',
      fallbackDeployment: null,
    });
    expect(policy.route({ role: 'actor', contextChars: 1, dataZone: 'us' }).deployment).toBe(
      'us-dep',
    );
    expect(() =>
      createRouter(routing({ FOUNDRY_DATA_ZONE: 'eu' })).route({ role: 'actor', contextChars: 1 }),
    ).toThrow('data zone');
  });
});

describe('a cost ceiling', () => {
  const router = createRouter(
    routing({
      FOUNDRY_DEPLOYMENT_EXTRACTION: 'cheap-dep',
      ...prices([
        ['cheap-dep', 1, 2],
        ['general-dep', 10, 40],
      ]),
    }),
  );
  // 3,000 characters is 1,000 tokens in, and the answer budget is 2,000 tokens out.
  const request = { role: 'extraction', contextChars: 3_000, maxTokens: 2_000 } as const;

  it('lets through a deployment whose worst case fits, and not one whose worst case does not', () => {
    // cheap: 1,000 x $1/M + 2,000 x $2/M = $0.005. general: 1,000 x $10/M + 2,000 x $40/M = $0.09.
    expect(router.route({ ...request, costCeilingUsd: 0.01 }).deployment).toBe('cheap-dep');
    expect(router.route({ ...request, costCeilingUsd: 0.005 }).deployment).toBe('cheap-dep');
    expect(router.route({ ...request, costCeilingUsd: 0.5 }).fallbackDeployment).toBe(
      'general-dep',
    );
    expect(router.route({ ...request, costCeilingUsd: 0.01 }).fallbackDeployment).toBeNull();
    expect(() => router.route({ ...request, costCeilingUsd: 0.001 })).toThrow('cost ceiling');
  });

  it('refuses a deployment that has no price, rather than guessing one', () => {
    const unpriced = createRouter(routing({ ...prices([['cheap-dep', 1, 2]]) }));
    expect(() => unpriced.route({ role: 'actor', contextChars: 100, costCeilingUsd: 100 })).toThrow(
      'cost ceiling',
    );
    expect(createRouter(routing()).route({ role: 'actor', contextChars: 100 }).deployment).toBe(
      'general-dep',
    );
  });
});

describe('availability and the wait a person will give', () => {
  const settings = routing({
    FOUNDRY_DEPLOYMENT_ACTOR: 'actor-dep',
    FOUNDRY_DEPLOYMENT_FALLBACK: 'quick-dep',
    ...profiles({ 'quick-dep': { latency: 'fast' } }),
  });
  const router = createRouter(settings);

  it('does not choose a deployment that is not available, and says so when none is', () => {
    expect(
      router.route({ role: 'actor', contextChars: 1, available: ['general-dep', 'quick-dep'] })
        .deployment,
    ).toBe('general-dep');
    expect(
      router.route({ role: 'actor', contextChars: 1, available: new Set(['quick-dep']) })
        .deployment,
    ).toBe('quick-dep');
    expect(() => router.route({ role: 'actor', contextChars: 1, available: [] })).toThrow(
      'unavailable',
    );
  });

  it('prefers a fast deployment, and shortens the time limit and the retries, for a short wait', () => {
    expect(router.route({ role: 'actor', contextChars: 1 }).deployment).toBe('actor-dep');
    const hurried = router.route({ role: 'actor', contextChars: 1, latencyBudgetMs: 8_000 });
    expect(hurried).toMatchObject({
      deployment: 'quick-dep',
      timeoutMs: 8_000,
      retry: { transient: 1, throttle: 1 },
    });
    expect(router.route({ role: 'actor', contextChars: 1, latencyBudgetMs: 40_000 })).toMatchObject(
      { deployment: 'actor-dep', timeoutMs: 40_000, retry: { transient: 1, throttle: 3 } },
    );
    expect(router.route({ role: 'actor', contextChars: 1, latencyBudgetMs: 10 }).timeoutMs).toBe(
      1_000,
    );
    expect(
      router.route({ role: 'actor', contextChars: 1, latencyBudgetMs: 9_999_999 }).timeoutMs,
    ).toBe(120_000);
  });
});

describe('no deployment at all', () => {
  it('is not a route: nothing is guessed', () => {
    const none = createRouter(
      loadConfig({ AI_PROVIDER: 'foundry', FOUNDRY_ENDPOINT: environment.FOUNDRY_ENDPOINT })
        .routing,
    );
    expect(() => none.route({ role: 'actor', contextChars: 1 })).toThrowError(
      expect.objectContaining({ code: 'MODEL_ROUTE_UNAVAILABLE' }),
    );
  });
});

// Every combination of role, size, ceiling and zone, against an oracle written the other way round:
// the router filters a list of candidates in steps, this asks of each deployment, on its own, whether it
// may serve the request, and takes the first that may.
describe('every role, size, ceiling and zone', () => {
  const settings = routing({
    FOUNDRY_DEPLOYMENT_EXTRACTION: 'extract-dep',
    FOUNDRY_DEPLOYMENT_CRITIC: 'critic-dep',
    FOUNDRY_DEPLOYMENT_FALLBACK: 'spare-dep',
    ...profiles({
      'general-dep': { dataZone: 'eu' },
      'extract-dep': { dataZone: 'eu', maxContextChars: 20_000 },
      'critic-dep': { dataZone: 'us' },
      'spare-dep': { dataZone: 'us', maxContextChars: 60_000 },
    }),
    ...prices([
      ['general-dep', 1, 4],
      ['critic-dep', 30, 120],
      ['spare-dep', 0.5, 2],
    ]),
  });
  const router = createRouter(settings);
  const price = new Map([
    ['general-dep', [1, 4]],
    ['critic-dep', [30, 120]],
    ['spare-dep', [0.5, 2]],
  ] as const);
  const zone = new Map([
    ['general-dep', 'eu'],
    ['extract-dep', 'eu'],
    ['critic-dep', 'us'],
    ['spare-dep', 'us'],
  ]);
  const limit = new Map([
    ['extract-dep', 20_000],
    ['spare-dep', 60_000],
  ]);
  const own: Record<string, string> = { extraction: 'extract-dep', critic: 'critic-dep' };

  const oracle = (
    role: string,
    chars: number,
    ceiling: number | undefined,
    wanted: string | undefined,
  ): string[] => {
    const order = [...new Set([own[role] ?? 'general-dep', 'general-dep', 'spare-dep'])];
    return order.filter((name) => {
      if (wanted !== undefined && zone.get(name) !== wanted) return false;
      if ((limit.get(name) ?? Infinity) < chars) return false;
      if (ceiling === undefined) return true;
      const rate = price.get(name);
      if (!rate) return false;
      const worst = (Math.ceil(chars / 3) * rate[0] + 1_000 * rate[1]) / 1_000_000;
      return worst <= ceiling;
    });
  };

  const cases = MODEL_ROLES.flatMap((role) =>
    [500, 30_000, 70_000].flatMap((chars) =>
      [undefined, 0.0001, 0.01, 1].flatMap((ceiling) =>
        [undefined, 'eu', 'us', 'apac'].map((wanted) => ({ role, chars, ceiling, wanted })),
      ),
    ),
  );

  it('agrees with the oracle in all of its cases', () => {
    expect(cases).toHaveLength(6 * 3 * 4 * 4);
    let routed = 0;
    let refused = 0;
    for (const { role, chars, ceiling, wanted } of cases) {
      const expected = oracle(role, chars, ceiling, wanted);
      const request = {
        role,
        contextChars: chars,
        maxTokens: 1_000,
        costCeilingUsd: ceiling,
        dataZone: wanted,
      };
      const label = JSON.stringify({ role, chars, ceiling, wanted });
      if (expected.length === 0) {
        refused += 1;
        expect(() => router.route(request), label).toThrowError(
          expect.objectContaining({ code: 'MODEL_ROUTE_UNAVAILABLE' }),
        );
      } else {
        routed += 1;
        const route = router.route(request);
        expect([route.deployment, route.fallbackDeployment], label).toEqual([
          expected[0],
          expected[1] ?? null,
        ]);
      }
    }
    // The table has both kinds of case in it, so that neither half of the agreement is empty.
    expect(routed).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(50);
  });
});
