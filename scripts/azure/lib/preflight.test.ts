import { describe, expect, it } from 'vitest';
import { AzError } from './az.js';
import { loadPriceSnapshot } from './cost-plan.js';
import { fakeAz, has, words, type Route } from './fixtures/fake-az.js';
import { parsePreflightArgs } from './preflight-args.js';
import {
  renderReport,
  runPreflight,
  type PreflightOptions,
  type PreflightReport,
} from './preflight.js';
import { isReadOnly } from './readonly-az.js';
import { UsageError } from './args.js';

const SUB = '11111111-2222-3333-4444-555555555555';
const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OID = '99999999-8888-7777-6666-555555555555';
const ACCOUNT_ID = `/subscriptions/${SUB}/resourceGroups/rg-swarm-dev/providers/Microsoft.CognitiveServices/accounts/ai-swarm-dev-abc`;
const OPTIONS: PreflightOptions = {
  subscription: SUB,
  region: 'centralindia',
  fallbackRegion: 'eastus2',
  profile: 'pilot',
  offline: false,
  showIds: false,
};

/** A subscription the way the owner described it: a Visual Studio credit subscription with a dev VM. */
function world(
  overrides: Route[] = [],
  roles: unknown = [{ role: 'Owner', scope: `/subscriptions/${SUB}` }],
): Route[] {
  return [
    ...overrides,
    {
      match: words('account', 'show'),
      reply: {
        id: SUB,
        name: 'Visual Studio Enterprise',
        state: 'Enabled',
        tenantId: TENANT,
        user: { name: 'owner@example.invalid', type: 'user' },
      },
    },
    {
      match: has('subscriptions/', 'api-version=2022-12-01'),
      reply: { subscriptionPolicies: { quotaId: 'MSDN_2014-09-01', spendingLimit: 'On' } },
    },
    {
      match: words('consumption', 'budget', 'list'),
      reply: [
        {
          name: 'dev-alert',
          amount: 5000,
          timeGrain: 'Monthly',
          currentSpend: { amount: 1234.5, unit: 'INR' },
        },
      ],
    },
    {
      match: words('group', 'list'),
      reply: [
        { name: 'rg-swarm-dev', location: 'eastus2', tags: { app: 'swarm-lab' } },
        { name: 'rg-other', location: 'centralindia', tags: null },
      ],
    },
    {
      match: words('cognitiveservices', 'account', 'list'),
      reply: [
        {
          name: 'ai-swarm-dev-abc',
          kind: 'AIServices',
          location: 'eastus2',
          resourceGroup: 'rg-swarm-dev',
          id: ACCOUNT_ID,
          localAuthDisabled: true,
        },
      ],
    },
    {
      match: words('cognitiveservices', 'account', 'deployment', 'list'),
      reply: [
        {
          name: 'swarm-chat',
          model: 'gpt-4.1-mini',
          version: '2025-04-14',
          sku: 'GlobalStandard',
          capacity: 100,
        },
      ],
    },
    {
      match: words('cognitiveservices', 'usage', 'list'),
      reply: [{ name: 'OpenAI.GlobalStandard.gpt-4.1-mini', current: 100, limit: 250 }],
    },
    {
      match: words('provider', 'list'),
      reply: [
        'Microsoft.App',
        'Microsoft.OperationalInsights',
        'Microsoft.ContainerRegistry',
        'Microsoft.DBforPostgreSQL',
        'Microsoft.Insights',
        'Microsoft.ManagedIdentity',
        'Microsoft.Network',
        'Microsoft.CognitiveServices',
      ].map((namespace) => ({ namespace })),
    },
    {
      match: (args) => words('account', 'list-locations')(args) && has('centralindia')(args),
      reply: [{ name: 'centralindia', displayName: 'Central India' }],
    },
    {
      match: (args) => words('account', 'list-locations')(args) && has('eastus2')(args),
      reply: [{ name: 'eastus2', displayName: 'East US 2' }],
    },
    { match: words('provider', 'show'), reply: ['Central India', 'East US 2'] },
    {
      match: (args) =>
        words('postgres', 'flexible-server', 'list-skus')(args) && has('centralindia')(args),
      reply: [{ name: 'Standard_B1ms', tier: 'Burstable', supportedZones: ['1', '2'] }],
    },
    {
      match: (args) =>
        words('postgres', 'flexible-server', 'list-skus')(args) && has('eastus2')(args),
      reply: [],
    },
    {
      match: words('ad', 'signed-in-user', 'show'),
      reply: { id: OID, userPrincipalName: 'owner@example.invalid', userType: 'Member' },
    },
    { match: words('role', 'assignment', 'list'), reply: roles },
    {
      match: has('graph.microsoft.com'),
      reply: { defaultUserRolePermissions: { allowedToCreateApps: true } },
    },
    {
      match: words('postgres', 'flexible-server', 'list'),
      reply: [
        {
          name: 'psql-shared',
          resourceGroup: 'rg-data',
          location: 'centralindia',
          sku: 'Standard_B1ms',
          tier: 'Burstable',
          version: '16',
          state: 'Ready',
          entra: 'Enabled',
          password: 'Disabled',
          id: `/subscriptions/${SUB}/resourceGroups/rg-data/providers/Microsoft.DBforPostgreSQL/flexibleServers/psql-shared`,
        },
      ],
    },
    {
      match: words('acr', 'list'),
      reply: [
        {
          name: 'crshared',
          resourceGroup: 'rg-shared',
          location: 'centralindia',
          sku: 'Basic',
          admin: false,
          id: `/subscriptions/${SUB}/resourceGroups/rg-shared/providers/Microsoft.ContainerRegistry/registries/crshared`,
        },
      ],
    },
    { match: words('containerapp', 'env', 'list'), reply: [] },
    { match: words('keyvault', 'list'), reply: [] },
    { match: words('monitor', 'log-analytics', 'workspace', 'list'), reply: [] },
    { match: words('resource', 'list'), reply: [] },
    {
      match: words('vm', 'list'),
      reply: [
        {
          name: 'swarm-dev',
          size: 'Standard_D4as_v5',
          power: 'VM running',
          location: 'centralindia',
          resourceGroup: 'rg-dev',
        },
      ],
    },
    {
      match: words('policy', 'assignment', 'list'),
      reply: [{ name: 'Allowed locations', enforcement: 'Default' }],
    },
  ];
}

const deps = (routes: Route[]) => {
  const { az, calls } = fakeAz(routes);
  return {
    calls,
    deps: {
      az,
      now: () => new Date('2026-11-03T10:00:00Z'),
      snapshot: loadPriceSnapshot(),
      listRepoFiles: () => [
        'infra/main.bicep',
        'infra/pilot/main.bicep',
        'infra/pilot/main.bicepparam',
        'infra/pilot/production-shaped.bicepparam',
      ],
    },
  };
};

const finding = (report: PreflightReport, id: string) =>
  report.findings.find((one) => one.id === id);

describe('runPreflight', () => {
  it('reads the subscription, the credit situation, what exists and what is allowed, and changes nothing', async () => {
    const { deps: d, calls } = deps(world());
    const report = await runPreflight(OPTIONS, d);

    expect(report.mode).toBe('inspected');
    expect(calls.length).toBeGreaterThan(15);
    for (const call of calls) expect(isReadOnly(call), call.join(' ')).toBe(true);
    expect(calls.flat().join(' ')).not.toMatch(
      /\b(create|delete|update|set|register|install|start|stop|deallocate|restore)\b/u,
    );
    expect(report.azCalls).toHaveLength(calls.length);

    const offer = finding(report, 'offer');
    expect(offer?.status).toBe('attention');
    expect(offer?.details.join(' ')).toContain('Visual Studio / dev-test offer');
    expect(offer?.details.join(' ')).toContain('Spending limit is ON');
    expect(offer?.details.join(' ')).toContain('month to date 1234.5 INR');
    // The honest part: the balance is not readable, and the report says so rather than guessing.
    expect(offer?.details.join(' ')).toContain('CANNOT be read');

    expect(finding(report, 'foundry')?.details.join(' ')).toContain(
      'swarm-chat = gpt-4.1-mini 2025-04-14 (GlobalStandard, capacity 100)',
    );
    expect(finding(report, 'resource-groups')?.details.join(' ')).toContain(
      'rg-swarm-dev (eastus2)',
    );
    expect(finding(report, 'entra')?.status).toBe('ok');
    expect(finding(report, 'repository')?.status).toBe('ok');
  });

  it('offers the existing Foundry account, PostgreSQL server and registry for reuse, with their IDs', async () => {
    const { deps: d } = deps(world());
    const report = await runPreflight({ ...OPTIONS, showIds: true }, d);
    const kinds = report.reuse.map((item) => `${item.kind}:${item.name}`);
    expect(kinds).toEqual([
      'foundry:ai-swarm-dev-abc',
      'postgres:psql-shared',
      'registry:crshared',
    ]);
    expect(report.reuse[0]?.id).toBe(ACCOUNT_ID);
    expect(report.reuse[1]?.note).toContain('SWARM_EXISTING_POSTGRES_SERVER_ID');
    expect(report.reuse[1]?.note).toContain('only a database');
  });

  it('flags what would stop a deployment: missing providers, a restricted region, too few rights, a running VM', async () => {
    const { deps: d } = deps(world([], [{ role: 'Contributor', scope: `/subscriptions/${SUB}` }]));
    const report = await runPreflight(OPTIONS, d);

    expect(finding(report, 'providers')?.status).toBe('attention');
    expect(finding(report, 'providers')?.details.join(' ')).toMatch(
      /Microsoft\.KeyVault, Microsoft\.Consumption/u,
    );
    expect(finding(report, 'region-centralindia')?.status).toBe('ok');
    expect(finding(report, 'region-centralindia')?.details.join(' ')).toContain(
      'Standard_B1ms: offered (tier Burstable, zones 1,2)',
    );
    expect(finding(report, 'region-eastus2')?.status).toBe('attention');
    expect(finding(report, 'region-eastus2')?.details.join(' ')).toContain('NOT in the list');
    expect(finding(report, 'entra')?.status).toBe('attention');
    expect(finding(report, 'entra')?.details.join(' ')).toContain('role that can assign roles');
    expect(finding(report, 'vm')?.status).toBe('attention');
    expect(finding(report, 'vm')?.details.join(' ')).toContain('US$81.03');
  });

  it('masks identifiers unless asked, in the text a person reads', async () => {
    const { deps: d } = deps(world());
    const report = await runPreflight(OPTIONS, d);
    const text = renderReport(report).join('\n');
    expect(text).not.toContain(SUB);
    expect(text).not.toContain(TENANT);
    expect(text).toContain('11111111…');
    const shown = renderReport(
      await runPreflight({ ...OPTIONS, showIds: true }, deps(world()).deps),
    ).join('\n');
    expect(shown).toContain(SUB);
  });

  it('renders the cost plan for the region and the fallback beside what it found', async () => {
    const report = await runPreflight(OPTIONS, deps(world()).deps);
    expect(report.costPlans.map((plan) => plan.region)).toEqual(['centralindia', 'eastus2']);
    const text = renderReport(report).join('\n');
    expect(text).toContain('Cost plan: profile pilot, region centralindia');
    expect(text).toContain('PROVISIONING NEEDS AN OWNER');
  });

  it('reports a fact it cannot read as unknown and goes on', async () => {
    const { deps: d } = deps(
      world([{ match: words('keyvault', 'list'), reply: new AzError('AZ_FAILED', 'Forbidden') }]),
    );
    const report = await runPreflight(OPTIONS, d);
    const hosting = finding(report, 'hosting-existing');
    expect(hosting?.status).toBe('unknown');
    expect(hosting?.details.join(' ')).toContain('Could not read this');
    expect(finding(report, 'vm')).toBeDefined();
    expect(finding(report, 'policy')).toBeDefined();
  });

  it('stops politely when nobody is signed in, and still gives the cost plan and the owner steps', async () => {
    const { deps: d, calls } = deps([
      { match: () => true, reply: new AzError('AZ_NOT_LOGGED_IN', 'Please run az login') },
    ]);
    const report = await runPreflight(OPTIONS, d);
    expect(report.mode).toBe('offline');
    expect(finding(report, 'azure-session')?.status).toBe('blocked');
    expect(calls).toHaveLength(1);
    expect(report.costPlans).toHaveLength(2);
    expect(report.owner.join(' ')).toContain('PROVISIONING NEEDS AN OWNER');
  });

  it('treats a missing Azure CLI the same way', async () => {
    const { deps: d } = deps([
      { match: () => true, reply: new AzError('AZ_NOT_FOUND', 'Azure CLI was not found') },
    ]);
    const report = await runPreflight(OPTIONS, d);
    expect(report.mode).toBe('offline');
    expect(finding(report, 'azure-session')?.status).toBe('blocked');
  });

  it('says so when the session ends half way, and runs nothing after it', async () => {
    let answered = 0;
    const { deps: d } = deps(
      world([
        {
          match: words('group', 'list'),
          reply: () => {
            answered += 1;
            throw new AzError('AZ_NOT_LOGGED_IN', 'AADSTS70043 the token expired');
          },
        },
      ]),
    );
    const report = await runPreflight(OPTIONS, d);
    expect(answered).toBe(1);
    expect(finding(report, 'azure-session-ended')?.status).toBe('blocked');
    expect(finding(report, 'azure-session-ended')?.details.join(' ')).toContain('Resource groups');
    expect(report.findings.some((one) => one.id === 'foundry')).toBe(false);
  });

  it('makes no Azure call at all with --offline', async () => {
    const { deps: d, calls } = deps(world());
    const report = await runPreflight({ ...OPTIONS, offline: true }, d);
    expect(calls).toEqual([]);
    expect(report.mode).toBe('offline');
    expect(report.costPlans).toHaveLength(2);
  });
});

describe('parsePreflightArgs', () => {
  it('defaults to the pilot in Central India with East US 2 as the fallback', () => {
    expect(parsePreflightArgs([])).toMatchObject({
      region: 'centralindia',
      fallbackRegion: 'eastus2',
      profile: 'pilot',
      offline: false,
      json: false,
      showIds: false,
    });
  });

  it('rejects a malformed subscription, region or profile, and any option it does not know', () => {
    expect(() => parsePreflightArgs(['--subscription', 'not-a-guid'])).toThrow(UsageError);
    expect(() => parsePreflightArgs(['--region', 'Central India'])).toThrow(UsageError);
    expect(() => parsePreflightArgs(['--profile', 'production'])).toThrow(UsageError);
    expect(() => parsePreflightArgs(['--yes'])).toThrow(UsageError);
    expect(() => parsePreflightArgs(['--apply'])).toThrow(UsageError);
  });
});
