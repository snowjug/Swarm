import { describe, expect, it } from 'vitest';
import { parseProvisionArgs, parseTeardownArgs } from './args.js';
import { AzError, type AzClient } from './az.js';
import type { CatalogModel, UsageRecord } from './models.js';
import { runProvision, type ProvisionDeps } from './provision-flow.js';
import { runTeardown } from './teardown-flow.js';

const SUB = '11111111-2222-3333-4444-555555555555';
const PRINCIPAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW = new Date('2026-06-01T12:00:00Z');

type Reply = unknown | Error | ((args: readonly string[]) => unknown);
interface Route {
  match: (args: readonly string[]) => boolean;
  reply: Reply;
}

function fakeAz(routes: Route[]) {
  const calls: string[][] = [];
  const respond = async (args: readonly string[]): Promise<unknown> => {
    calls.push([...args]);
    const route = routes.find((candidate) => candidate.match(args));
    if (!route) throw new AzError('AZ_FAILED', `unexpected az call: ${args.slice(0, 3).join(' ')}`);
    if (route.reply instanceof Error) throw route.reply;
    return typeof route.reply === 'function' ? route.reply(args) : route.reply;
  };
  const az: AzClient = {
    json: async <T>(args: readonly string[]) => (await respond(args)) as T,
    text: async (args) => String(await respond(args)),
  };
  return { az, calls };
}

const has =
  (...parts: string[]) =>
  (args: readonly string[]) =>
    parts.every((part) => args.some((arg) => arg.includes(part)));

const model: CatalogModel = {
  kind: 'AIServices',
  model: {
    format: 'OpenAI',
    name: 'gpt-4.1-mini',
    version: '2025-04-14',
    isDefaultVersion: true,
    lifecycleStatus: 'GenerallyAvailable',
    capabilities: { chatCompletion: 'true' },
    skus: [
      {
        name: 'Standard',
        usageName: 'OpenAI.Standard.gpt-4.1-mini',
        capacity: { minimum: 1, maximum: 1000 },
      },
    ],
  },
};
const usage: UsageRecord = {
  name: { value: 'OpenAI.Standard.gpt-4.1-mini' },
  limit: 100,
  currentValue: 0,
};

const owner = { value: [{ actions: ['*'], notActions: [] }] };
const contributor = {
  value: [
    {
      actions: ['*'],
      notActions: ['Microsoft.Authorization/*/Write', 'Microsoft.Authorization/*/Delete'],
    },
  ],
};
const reader = { value: [{ actions: ['*/read'], notActions: [] }] };

const outputs = {
  AZURE_AI_ACCOUNT_NAME: { value: 'ai-swarm-dev-abc' },
  AZURE_OPENAI_ENDPOINT: { value: 'https://ai-swarm-dev-abc.openai.azure.com/' },
  AZURE_OPENAI_DEPLOYMENT: { value: 'swarm-chat' },
  AZURE_RESOURCE_GROUP: { value: 'rg-swarm-dev' },
};

function standardRoutes(overrides: Route[] = [], permissions: unknown = owner): Route[] {
  return [
    ...overrides,
    {
      match: (args) =>
        args[0] === 'account' && args[1] === 'show' && !args.includes('--subscription'),
      reply: { user: { name: 'dev@contoso.example' } },
    },
    {
      match: has('account', 'show', '--subscription'),
      reply: { id: SUB, name: 'Atharv Dev Sandbox', state: 'Enabled' },
    },
    { match: has('Microsoft.Authorization/permissions'), reply: permissions },
    { match: has('signed-in-user'), reply: `${PRINCIPAL}\n` },
    { match: has('locations/eastus2/models'), reply: { value: [model] } },
    { match: has('locations/eastus2/usages'), reply: { value: [usage] } },
    {
      match: has('what-if'),
      reply: {
        changes: [
          { changeType: 'Create', resourceId: '/subscriptions/x/resourceGroups/rg-swarm-dev' },
        ],
      },
    },
    { match: has('deployment', 'create'), reply: outputs },
  ];
}

function harness(az: AzClient) {
  const state = {
    parameters: [] as string[],
    cleaned: 0,
    env: undefined as Record<string, string> | undefined,
  };
  const deps: ProvisionDeps = {
    az,
    now: () => NOW,
    repoRoot: 'C:\\repo',
    writeParameters: async (content) => {
      state.parameters.push(content);
      return {
        path: 'C:\\tmp\\parameters.json',
        cleanup: async () => {
          state.cleaned += 1;
        },
      };
    },
    updateEnv: async (updates) => {
      state.env = updates;
      return Object.keys(updates);
    },
  };
  return { deps, state };
}

const args = (...extra: string[]) =>
  parseProvisionArgs(['--subscription', SUB, '--regions', 'eastus2', ...extra]);
const created = (calls: string[][]) => calls.filter((call) => call.includes('create'));

describe('runProvision safety gates', () => {
  it('stops when the CLI is signed out and touches nothing else', async () => {
    const { az, calls } = fakeAz([
      { match: () => true, reply: new AzError('AZ_NOT_LOGGED_IN', "Please run 'az login'") },
    ]);
    const result = await runProvision(args(), harness(az).deps);
    expect(result.status).toBe('not-logged-in');
    expect(calls).toHaveLength(1);
  });

  it('refuses a production-looking subscription before reading permissions or deploying', async () => {
    const { az, calls } = fakeAz(
      standardRoutes([
        {
          match: has('account', 'show', '--subscription'),
          reply: { id: SUB, name: 'Liquid - Production', state: 'Enabled' },
        },
      ]),
    );
    const result = await runProvision(args('--yes'), harness(az).deps);
    expect(result.status).toBe('blocked-subscription');
    expect(calls.some((call) => call.some((part) => part.includes('permissions')))).toBe(false);
    expect(created(calls)).toHaveLength(0);
  });

  it('blocks a read-only account, explains what is needed, and never queries models or deploys', async () => {
    const { az, calls } = fakeAz(standardRoutes([], reader));
    const { deps, state } = harness(az);
    const result = await runProvision(args('--yes'), deps);
    expect(result.status).toBe('blocked-permissions');
    expect(result.messages.join('\n')).toContain('Missing:');
    expect(result.messages.join('\n')).toContain('Role Based Access Control Administrator');
    expect(calls.some((call) => call.some((part) => part.includes('/models')))).toBe(false);
    expect(created(calls)).toHaveLength(0);
    expect(state.env).toBeUndefined();
  });

  it('blocks Contributor-only accounts unless role assignment is skipped', async () => {
    const blocked = await runProvision(
      args('--yes'),
      harness(fakeAz(standardRoutes([], contributor)).az).deps,
    );
    expect(blocked.status).toBe('blocked-permissions');
    expect(blocked.messages.join(' ')).toContain('roleAssignments/write');

    const { az } = fakeAz(standardRoutes([], contributor));
    const skipped = await runProvision(args('--yes', '--skip-role-assignment'), harness(az).deps);
    expect(skipped.status).toBe('deployed');
  });

  it('treats an unreadable permissions endpoint as no permission', async () => {
    const { az } = fakeAz(
      standardRoutes([
        {
          match: has('Microsoft.Authorization/permissions'),
          reply: new AzError('AZ_FAILED', 'Forbidden'),
        },
      ]),
    );
    expect((await runProvision(args('--yes'), harness(az).deps)).status).toBe(
      'blocked-permissions',
    );
  });

  it('reports a preflight-only success without selecting a model', async () => {
    const { az, calls } = fakeAz(standardRoutes());
    const result = await runProvision(args('--preflight-only'), harness(az).deps);
    expect(result.status).toBe('preflight-ok');
    expect(calls.some((call) => call.some((part) => part.includes('/models')))).toBe(false);
  });

  it('lists ranked candidates without deploying', async () => {
    const { az, calls } = fakeAz(standardRoutes());
    const result = await runProvision(args('--list-models'), harness(az).deps);
    expect(result.status).toBe('models-listed');
    expect(result.candidates[0]).toMatchObject({
      modelName: 'gpt-4.1-mini',
      region: 'eastus2',
      sku: 'Standard',
    });
    expect(created(calls)).toHaveLength(0);
  });

  it('previews with --what-if and does not deploy or write .env', async () => {
    const { az, calls } = fakeAz(standardRoutes());
    const { deps, state } = harness(az);
    const result = await runProvision(args('--what-if', '--yes'), deps);
    expect(result.status).toBe('previewed');
    expect(created(calls)).toHaveLength(0);
    expect(state.env).toBeUndefined();
    expect(state.cleaned).toBe(1);
  });

  it('does nothing without --yes, even when everything else passes', async () => {
    const { az, calls } = fakeAz(standardRoutes());
    const { deps, state } = harness(az);
    const result = await runProvision(args(), deps);
    expect(result.status).toBe('needs-confirmation');
    expect(created(calls)).toHaveLength(0);
    expect(state.env).toBeUndefined();
  });

  it('reports no candidate with reasons instead of guessing', async () => {
    const { az, calls } = fakeAz(
      standardRoutes([
        { match: has('locations/eastus2/usages'), reply: { value: [{ ...usage, limit: 0 }] } },
      ]),
    );
    const result = await runProvision(args('--yes'), harness(az).deps);
    expect(result.status).toBe('no-candidate');
    expect(result.messages.join('\n')).toContain('no quota available');
    expect(created(calls)).toHaveLength(0);
  });

  it('does not follow pagination links that leave Azure Resource Manager', async () => {
    const { az, calls } = fakeAz(
      standardRoutes([
        {
          match: has('locations/eastus2/models'),
          reply: { value: [model], nextLink: 'https://evil.example.com/steal?token=1' },
        },
      ]),
    );
    await runProvision(args('--list-models'), harness(az).deps);
    expect(calls.some((call) => call.some((part) => part.includes('evil.example.com')))).toBe(
      false,
    );
  });

  it('refuses a resource group that already holds foreign resources', async () => {
    const { az, calls } = fakeAz(
      standardRoutes([
        { match: has('resource', 'list'), reply: [{ name: 'someone-elses-vm', tags: null }] },
      ]),
    );
    const result = await runProvision(
      args('--yes', '--resource-group', 'rg-shared'),
      harness(az).deps,
    );
    expect(result.status).toBe('blocked-resource-group');
    expect(created(calls)).toHaveLength(0);
  });

  it('refuses to proceed when the caller identity cannot be determined', async () => {
    const { az } = fakeAz(
      standardRoutes([
        { match: has('signed-in-user'), reply: new AzError('AZ_FAILED', 'Graph denied') },
      ]),
    );
    const result = await runProvision(args('--yes'), harness(az).deps);
    expect(result.status).toBe('blocked-principal');
  });
});

describe('runProvision deployment', () => {
  it('deploys at subscription scope with an explicit subscription and writes only non-secret settings', async () => {
    const { az, calls } = fakeAz(standardRoutes());
    const { deps, state } = harness(az);
    const result = await runProvision(args('--yes'), deps);

    expect(result.status).toBe('deployed');
    const [create] = created(calls);
    expect(create).toBeDefined();
    expect(create?.slice(0, 3)).toEqual(['deployment', 'sub', 'create']);
    expect(create?.[create.indexOf('--subscription') + 1]).toBe(SUB);
    expect(create?.[create.indexOf('--template-file') + 1]).toMatch(/infra[\\/]main\.bicep$/);

    const parameters = JSON.parse(state.parameters[0] ?? '{}').parameters;
    expect(parameters.inferenceUsers.value).toEqual([
      { principalId: PRINCIPAL, principalType: 'User' },
    ]);
    expect(parameters.modelName.value).toBe('gpt-4.1-mini');

    expect(state.env).toEqual({
      AI_PROVIDER: 'azure',
      AI_MODEL: 'swarm-chat',
      AZURE_OPENAI_ENDPOINT: 'https://ai-swarm-dev-abc.openai.azure.com/',
      AZURE_OPENAI_AUTH: 'entra',
    });
    expect(JSON.stringify(state.env)).not.toMatch(/key|secret|token|password/i);
    expect(state.cleaned).toBe(1);
  });

  it('uses the resource-group template for an existing empty group', async () => {
    const { az, calls } = fakeAz(standardRoutes([{ match: has('resource', 'list'), reply: [] }]));
    const { deps, state } = harness(az);
    const result = await runProvision(args('--yes', '--resource-group', 'rg-empty'), deps);
    expect(result.status).toBe('deployed');
    const [create] = created(calls);
    expect(create?.slice(0, 3)).toEqual(['deployment', 'group', 'create']);
    expect(create?.[create.indexOf('--template-file') + 1]).toMatch(
      /modules[\\/]ai-services\.bicep$/,
    );
    const parameters = JSON.parse(state.parameters[0] ?? '{}').parameters;
    expect(parameters.accountName.value).toMatch(/^ai-swarm-dev-[0-9a-f]{10}$/);
    expect(parameters.tags.value.app).toBe('swarm-lab');
  });

  it('skips the .env update when asked', async () => {
    const { az } = fakeAz(standardRoutes());
    const { deps, state } = harness(az);
    const result = await runProvision(args('--yes', '--skip-env-file'), deps);
    expect(result.status).toBe('deployed');
    expect(state.env).toBeUndefined();
  });

  it('reports a classified failure, cleans up, and leaves .env untouched', async () => {
    const { az } = fakeAz(
      standardRoutes([
        {
          match: has('deployment', 'create'),
          reply: new AzError(
            'AZ_FAILED',
            '(InsufficientQuota) This operation require 10 new capacity in quota',
          ),
        },
      ]),
    );
    const { deps, state } = harness(az);
    const result = await runProvision(args('--yes'), deps);
    expect(result.status).toBe('failed');
    expect(result.messages.join('\n')).toContain('FAILED (quota)');
    expect(state.env).toBeUndefined();
    expect(state.cleaned).toBe(1);
  });

  it('never prints or stores secret-shaped data in its messages', async () => {
    const { az } = fakeAz(standardRoutes());
    const result = await runProvision(args('--yes'), harness(az).deps);
    expect(result.messages.join('\n')).not.toMatch(
      /eyJ[\w-]{10,}\.|bearer\s+\S{8,}|(api[-_ ]?key|password|client[-_ ]?secret|access[-_ ]?token)\s*[:=]/i,
    );
  });
});

describe('runTeardown', () => {
  const owned = { tags: { app: 'swarm-lab' } };
  const accounts = [{ name: 'ai-swarm-dev-abc', location: 'eastus2', tags: { app: 'swarm-lab' } }];
  const base = (group: unknown, list: unknown = accounts): Route[] => [
    {
      match: has('account', 'show'),
      reply: { id: SUB, name: 'Atharv Dev Sandbox', state: 'Enabled' },
    },
    { match: has('group', 'show'), reply: group },
    { match: has('cognitiveservices', 'account', 'list'), reply: list },
    { match: () => true, reply: '' },
  ];
  const teardownArgs = (...extra: string[]) =>
    parseTeardownArgs(['--subscription', SUB, '--resource-group', 'rg-swarm-dev', ...extra]);
  const deletions = (calls: string[][]) => calls.filter((call) => call.includes('delete'));

  it('asks for confirmation and deletes nothing without --yes', async () => {
    const { az, calls } = fakeAz(base(owned));
    const result = await runTeardown(teardownArgs(), az);
    expect(result.status).toBe('needs-confirmation');
    expect(deletions(calls)).toHaveLength(0);
  });

  it('deletes a project-tagged group, then purges the soft-deleted account', async () => {
    const { az, calls } = fakeAz(base(owned));
    const result = await runTeardown(teardownArgs('--yes'), az);
    expect(result.status).toBe('deleted');
    expect(deletions(calls).map((call) => call.slice(0, 2).join(' '))).toEqual(['group delete']);
    expect(calls.some((call) => call.includes('purge'))).toBe(true);
  });

  it('refuses to touch a group with nothing tagged as this project', async () => {
    const { az, calls } = fakeAz(
      base({ tags: null }, [{ name: 'other', location: 'eastus2', tags: null }]),
    );
    const result = await runTeardown(teardownArgs('--yes'), az);
    expect(result.status).toBe('blocked');
    expect(deletions(calls)).toHaveLength(0);
  });

  it('deletes only the tagged account in an untagged group and keeps the group', async () => {
    const { az, calls } = fakeAz(
      base({ tags: null }, [
        ...accounts,
        { name: 'someone-elses-account', location: 'eastus2', tags: null },
      ]),
    );
    const result = await runTeardown(teardownArgs('--yes'), az);
    expect(result.status).toBe('deleted');
    const removed = deletions(calls);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('ai-swarm-dev-abc');
    expect(removed[0]?.slice(0, 2)).toEqual(['cognitiveservices', 'account']);
  });

  it('refuses production-looking subscriptions', async () => {
    const { az, calls } = fakeAz([
      {
        match: has('account', 'show'),
        reply: { id: SUB, name: 'Sky_ConfigGuard_Prod', state: 'Enabled' },
      },
      { match: () => true, reply: '' },
    ]);
    const result = await runTeardown(teardownArgs('--yes'), az);
    expect(result.status).toBe('blocked');
    expect(deletions(calls)).toHaveLength(0);
  });
});
