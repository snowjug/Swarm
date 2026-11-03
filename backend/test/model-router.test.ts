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

  it('takes the role’s own answer budget when the task asks for none, or for what is not a count', () => {
    for (const asked of [Number.NaN, 0, -5, 0.5]) {
      expect(
        router.route({ role: 'critic', contextChars: 1, maxTokens: asked }).maxTokens,
        String(asked),
      ).toBe(3_000);
    }
    expect(router.route({ role: 'critic', contextChars: 1, maxTokens: 700.9 }).maxTokens).toBe(700);
    expect(
      router.route({ role: 'critic', contextChars: 1, maxTokens: Number.POSITIVE_INFINITY })
        .maxTokens,
    ).toBe(MAX_OUTPUT_TOKENS);
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

  it('holds every task to the zone the operator set: a task may name that zone, never another', () => {
    const pinned = createRouter(
      routing({
        FOUNDRY_DATA_ZONE: 'eu',
        FOUNDRY_DEPLOYMENT_FALLBACK: 'us-dep',
        ...profiles({ 'general-dep': { dataZone: 'eu' }, 'us-dep': { dataZone: 'us' } }),
      }),
    );
    expect(pinned.route({ role: 'actor', contextChars: 1 })).toMatchObject({
      deployment: 'general-dep',
      dataZone: 'eu',
      fallbackDeployment: null,
    });
    for (const same of ['eu', 'EU', 'Eu']) {
      expect(pinned.route({ role: 'actor', contextChars: 1, dataZone: same })).toMatchObject({
        deployment: 'general-dep',
        dataZone: 'eu',
        fallbackDeployment: null,
      });
    }
    // A deployment declared in the other zone is configured, and still does not serve a task that asks
    // for it: the task does not replace the operator's zone. Nor does a blank zone lift it.
    for (const other of ['us', 'US', 'apac', '', ' eu']) {
      expect(
        () => pinned.route({ role: 'actor', contextChars: 1, dataZone: other }),
        other,
      ).toThrowError(
        expect.objectContaining({
          code: 'MODEL_ROUTE_UNAVAILABLE',
          statusCode: 503,
          message: expect.stringContaining('other than the one this server is held to'),
        }),
      );
    }
    expect(() =>
      createRouter(routing({ FOUNDRY_DATA_ZONE: 'eu' })).route({ role: 'actor', contextChars: 1 }),
    ).toThrow('data zone');
  });

  it('lets a task name a zone of its own when the operator set none', () => {
    const open = createRouter(
      routing({
        FOUNDRY_DEPLOYMENT_FALLBACK: 'us-dep',
        ...profiles({ 'general-dep': { dataZone: 'eu' }, 'us-dep': { dataZone: 'us' } }),
      }),
    );
    expect(open.route({ role: 'actor', contextChars: 1, dataZone: 'us' })).toMatchObject({
      deployment: 'us-dep',
      dataZone: 'us',
      fallbackDeployment: null,
    });
    expect(open.route({ role: 'actor', contextChars: 1, dataZone: 'eu' }).deployment).toBe(
      'general-dep',
    );
    expect(open.route({ role: 'actor', contextChars: 1 })).toMatchObject({
      deployment: 'general-dep',
      dataZone: null,
    });
    // A blank zone is a zone no deployment declares: it serves nothing.
    expect(() => open.route({ role: 'actor', contextChars: 1, dataZone: '' })).toThrow('data zone');
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

  it('is not passed by a ceiling that is not a number, or one below zero', () => {
    for (const ceiling of [Number.NaN, -1]) {
      expect(() =>
        router.route({ role: 'extraction', contextChars: 100, costCeilingUsd: ceiling }),
      ).toThrow('cost ceiling');
    }
  });
});

describe('a cost ceiling is held to what the call will be sent with', () => {
  // A reasoning deployment is given room to think on top of the answer, and that room is paid for: a
  // critic that is asked for 1,000 tokens is sent 5,000, which at $60 per million of output is $0.30,
  // not $0.06.
  const only = routing({
    AI_MODEL: 'deep-dep',
    ...profiles({ 'deep-dep': { reasoning: true } }),
    ...prices([['deep-dep', 10, 60]]),
  });
  const request = { role: 'critic', contextChars: 3_000, maxTokens: 1_000 } as const;

  it('prices the room a reasoning deployment is given to think in, not the answer alone', () => {
    const router = createRouter(only);
    // 1,000 tokens in at $10 per million are $0.01, and 5,000 out at $60 are $0.30: $0.31 in all. The
    // answer alone would have made it $0.07, which a ceiling of $0.07 used to let through.
    expect(() => router.route({ ...request, costCeilingUsd: 0.07 })).toThrow('cost ceiling');
    expect(() => router.route({ ...request, costCeilingUsd: 0.3099 })).toThrow('cost ceiling');
    expect(router.route({ ...request, costCeilingUsd: 0.31 })).toMatchObject({
      deployment: 'deep-dep',
      reasoningEffort: 'high',
      maxTokens: 5_000,
    });
  });

  it('chooses a cheaper candidate when the reasoning one is over the ceiling', () => {
    const router = createRouter(
      routing({
        FOUNDRY_DEPLOYMENT_CRITIC: 'deep-dep',
        FOUNDRY_DEPLOYMENT_FALLBACK: 'cheap-dep',
        ...profiles({ 'deep-dep': { reasoning: true } }),
        ...prices([
          ['deep-dep', 10, 60],
          ['cheap-dep', 1, 4],
        ]),
      }),
    );
    expect(router.route({ ...request, costCeilingUsd: 0.07 })).toMatchObject({
      deployment: 'cheap-dep',
      reasoningEffort: null,
      maxTokens: 1_000,
      fallbackDeployment: null,
    });
    expect(router.route({ ...request, costCeilingUsd: 0.5 })).toMatchObject({
      deployment: 'deep-dep',
      fallbackDeployment: 'cheap-dep',
    });
  });

  it('prices a deployment that does not reason on the answer alone', () => {
    const plain = createRouter(
      routing({ AI_MODEL: 'plain-dep', ...prices([['plain-dep', 10, 60]]) }),
    );
    // (1,000 x $10 + 1,000 x $60) per million is $0.07, with no room for thinking.
    expect(plain.route({ ...request, costCeilingUsd: 0.07 })).toMatchObject({
      deployment: 'plain-dep',
      reasoningEffort: null,
      maxTokens: 1_000,
    });
    expect(() => plain.route({ ...request, costCeilingUsd: 0.069 })).toThrow('cost ceiling');
  });

  // What is checked is what is sent: the tokens the route carries are the tokens the ceiling is held to,
  // for each effort, with and without a need to reason or a short wait, and at the cap. The tokens sent
  // are worked out by hand in the table: the answer asked for plus the room for the effort (500, 1,000,
  // 2,000 or 4,000), never more than 16,000.
  it.each([
    ['critic', false, undefined, 1_000, 5_000],
    ['critic', true, undefined, 1_000, 5_000],
    ['critic', true, 10_000, 1_000, 2_000],
    ['extraction', false, undefined, 1_000, 2_000],
    ['extraction', true, undefined, 1_000, 3_000],
    ['research-planner', false, undefined, undefined, 4_000],
    ['actor', false, undefined, undefined, 3_500],
    ['synthesis', false, undefined, 15_500, 16_000],
  ] as const)(
    '%s, reasoning %s, wait %s, answer %s: %i tokens are sent, and priced',
    (role, requiresReasoning, latencyBudgetMs, maxTokens, sent) => {
      const router = createRouter(only);
      const asked = { role, contextChars: 3_000, requiresReasoning, latencyBudgetMs, maxTokens };
      // By hand: 1,000 tokens in at $10 per million, and what is sent out at $60 per million.
      const worst = (1_000 * 10 + sent * 60) / 1_000_000;
      expect(router.route({ ...asked, costCeilingUsd: worst }).maxTokens).toBe(sent);
      expect(() => router.route({ ...asked, costCeilingUsd: worst * 0.999 })).toThrow(
        'cost ceiling',
      );
    },
  );
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
  const price = new Map<string, readonly [number, number]>([
    ['general-dep', [1, 4]],
    ['critic-dep', [30, 120]],
    ['spare-dep', [0.5, 2]],
  ]);
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
