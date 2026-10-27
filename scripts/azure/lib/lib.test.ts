import { describe, expect, it } from 'vitest';
import { parseProvisionArgs, parseTeardownArgs, UsageError } from './args.js';
import { classifyAzFailure, resolveAzLauncher, sanitizeAzOutput } from './az.js';
import {
  accountNameFor,
  buildParameters,
  classifyDeploymentFailure,
  parseOutputs,
  toParametersFile,
} from './deployment.js';
import { mergeEnv } from './env-file.js';
import type { Candidate } from './models.js';
import {
  evaluatePermissions,
  RESOURCE_GROUP_SCOPE_ACTIONS,
  SUBSCRIPTION_SCOPE_ACTIONS,
  type PermissionBlock,
} from './permissions.js';
import { assessSubscription } from './subscription.js';

const SUB = '11111111-2222-3333-4444-555555555555';
const PRINCIPAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const owner: PermissionBlock = { actions: ['*'], notActions: [] };
const contributor: PermissionBlock = {
  actions: ['*'],
  notActions: [
    'Microsoft.Authorization/*/Delete',
    'Microsoft.Authorization/*/Write',
    'Microsoft.Authorization/elevateAccess/Action',
  ],
};
const reader: PermissionBlock = { actions: ['*/read'], notActions: [] };
const rbacAdmin: PermissionBlock = {
  actions: [
    'Microsoft.Authorization/roleAssignments/write',
    'Microsoft.Authorization/roleAssignments/delete',
  ],
};

describe('evaluatePermissions', () => {
  it('allows everything for Owner', () => {
    expect(evaluatePermissions([owner], SUBSCRIPTION_SCOPE_ACTIONS).ok).toBe(true);
  });

  it('denies role assignment for Contributor alone, because notActions apply within a role', () => {
    const report = evaluatePermissions([contributor], SUBSCRIPTION_SCOPE_ACTIONS);
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['Microsoft.Authorization/roleAssignments/write']);
  });

  it('unions separate role assignments', () => {
    expect(evaluatePermissions([contributor, rbacAdmin], SUBSCRIPTION_SCOPE_ACTIONS).ok).toBe(true);
  });

  it('does not let one role notAction cancel another role action', () => {
    expect(
      evaluatePermissions([{ actions: ['*'], notActions: ['*'] }, owner], ['Anything/write']).ok,
    ).toBe(true);
  });

  it('denies a read-only account every write', () => {
    const report = evaluatePermissions([reader], SUBSCRIPTION_SCOPE_ACTIONS);
    expect(report.allowed).toEqual([]);
    expect(report.missing).toHaveLength(SUBSCRIPTION_SCOPE_ACTIONS.length);
  });

  it('denies when no permission blocks are returned at all', () => {
    expect(evaluatePermissions([], SUBSCRIPTION_SCOPE_ACTIONS).ok).toBe(false);
  });

  it('matches wildcards in the middle and is case-insensitive', () => {
    expect(
      evaluatePermissions(
        [{ actions: ['microsoft.cognitiveservices/*'] }],
        ['Microsoft.CognitiveServices/accounts/deployments/write'],
      ).ok,
    ).toBe(true);
  });

  it('does not need resource group creation at resource-group scope', () => {
    expect(
      RESOURCE_GROUP_SCOPE_ACTIONS.some((action) => action.includes('resourceGroups/write')),
    ).toBe(false);
  });

  it('treats regex metacharacters in a pattern literally', () => {
    expect(
      evaluatePermissions([{ actions: ['Microsoft.Resources/(x)+'] }], ['Microsoft.Resources/x'])
        .ok,
    ).toBe(false);
  });
});

describe('assessSubscription', () => {
  const sub = (name: string, state = 'Enabled') => ({ id: SUB, name, state });

  it.each([
    'MSFT-Provisioning-01[Prod]',
    'EngThrive-PROD-MSIT',
    'Liquid - Production',
    'Sky_ConfigGuard_Prod',
    'SFDA-TelemetryInsights-PROD',
  ])('refuses production-looking name %s', (name) => {
    expect(assessSubscription(sub(name)).ok).toBe(false);
  });

  it.each(['Deployments NonProd', 'Productivity Lab', 'Atharv Dev', 'AISC-DEV-02'])(
    'accepts %s',
    (name) => {
      expect(assessSubscription(sub(name)).ok).toBe(true);
    },
  );

  it('allows a production-looking name only by explicit exception', () => {
    expect(assessSubscription(sub('Contoso Prod'), { allowProductionNames: true }).ok).toBe(true);
  });

  it('refuses disabled subscriptions', () => {
    expect(assessSubscription(sub('Atharv Dev', 'Disabled')).problems[0]).toContain('Disabled');
  });
});

describe('mergeEnv', () => {
  const updates = {
    AI_PROVIDER: 'azure',
    AI_MODEL: 'swarm-chat',
    AZURE_OPENAI_ENDPOINT: 'https://ai-swarm-dev-abc123.openai.azure.com/',
    AZURE_OPENAI_AUTH: 'entra',
  };

  it('replaces in place, appends missing keys and keeps unrelated lines and comments', () => {
    const { content, changed } = mergeEnv(
      '# my notes\nDATA_DIR=C:\\data\nAI_PROVIDER=none\n',
      updates,
    );
    expect(content).toBe(
      [
        '# my notes',
        'DATA_DIR=C:\\data',
        'AI_PROVIDER=azure',
        'AI_MODEL=swarm-chat',
        'AZURE_OPENAI_ENDPOINT=https://ai-swarm-dev-abc123.openai.azure.com/',
        'AZURE_OPENAI_AUTH=entra',
        '',
      ].join('\n'),
    );
    expect(changed).toEqual([
      'AI_PROVIDER',
      'AI_MODEL',
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_AUTH',
    ]);
  });

  it('is idempotent and preserves CRLF line endings', () => {
    const first = mergeEnv('A=1\r\n', updates).content;
    expect(first.includes('\r\n')).toBe(true);
    expect(first.replace(/\r\n/g, '')).not.toContain('\n');
    expect(mergeEnv(first, updates).content).toBe(first);
  });

  it('creates content from an empty file', () => {
    expect(mergeEnv('', { AI_PROVIDER: 'azure' }).content).toBe('AI_PROVIDER=azure\n');
  });

  it.each(['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY', 'AZURE_CLIENT_SECRET', 'PATH', '__proto__'])(
    'refuses to write %s',
    (key) => {
      expect(() => mergeEnv('', { [key]: 'x' })).toThrow(/not an allowed/);
    },
  );

  it.each([
    ['AI_PROVIDER', 'openai'],
    ['AI_PROVIDER', 'azure\nAZURE_OPENAI_API_KEY=stolen'],
    ['AZURE_OPENAI_ENDPOINT', 'http://x.openai.azure.com/'],
    ['AZURE_OPENAI_ENDPOINT', 'https://evil.example.com/'],
    ['AZURE_OPENAI_ENDPOINT', 'https://x.openai.azure.com.evil.example/'],
    ['AZURE_OPENAI_AUTH', 'key'],
    ['AI_MODEL', 'a b'],
    ['AI_MODEL', ''],
  ])('refuses %s=%s', (key, value) => {
    expect(() => mergeEnv('', { [key]: value })).toThrow(/unexpected format/);
  });
});

describe('parseProvisionArgs', () => {
  it('requires an explicit subscription guid and never defaults one', () => {
    expect(() => parseProvisionArgs([])).toThrow(UsageError);
    expect(() => parseProvisionArgs(['--subscription', 'MSFT-ClientCAB-1'])).toThrow(/guid/);
  });

  it('applies safe defaults: nothing is applied without --yes', () => {
    const args = parseProvisionArgs(['--subscription', SUB]);
    expect(args).toMatchObject({
      yes: false,
      whatIf: false,
      capacity: 50,
      environment: 'swarm-dev',
      kind: 'AIServices',
      pick: 1,
      skipRoleAssignment: false,
      allowProductionName: false,
    });
    expect(args.regions[0]).toBe('eastus2');
  });

  it('turns unknown flags and bad values into usage errors, not stack traces', () => {
    expect(() => parseProvisionArgs(['--subscription', SUB, '--nope'])).toThrow(UsageError);
    expect(() => parseProvisionArgs(['--subscription', SUB, '--capacity', '1000'])).toThrow(
      /1 to 100/,
    );
    expect(() => parseProvisionArgs(['--subscription', SUB, '--capacity', 'abc'])).toThrow(
      UsageError,
    );
    expect(() => parseProvisionArgs(['--subscription', SUB, '--environment', 'Bad Name'])).toThrow(
      UsageError,
    );
    expect(() => parseProvisionArgs(['--subscription', SUB, '--regions', 'east us'])).toThrow(
      UsageError,
    );
    expect(() => parseProvisionArgs(['--subscription', SUB, '--principal-id', 'me'])).toThrow(
      UsageError,
    );
    expect(() => parseProvisionArgs(['--subscription', SUB, '--kind', 'Other'])).toThrow(
      UsageError,
    );
    expect(() => parseProvisionArgs(['--subscription', SUB, '--resource-group', '../x'])).toThrow(
      UsageError,
    );
  });

  it('parses lists and flags', () => {
    const args = parseProvisionArgs([
      '--subscription',
      SUB,
      '--regions',
      'westus3, EastUS2',
      '--models',
      'gpt-4o-mini',
      '--yes',
      '--what-if',
      '--resource-group',
      'rg-swarm',
    ]);
    expect(args).toMatchObject({
      regions: ['westus3', 'eastus2'],
      models: ['gpt-4o-mini'],
      yes: true,
      whatIf: true,
      resourceGroup: 'rg-swarm',
    });
  });

  it('parses teardown arguments strictly', () => {
    expect(() => parseTeardownArgs(['--subscription', SUB])).toThrow(/resource-group/);
    expect(parseTeardownArgs(['--subscription', SUB, '--resource-group', 'rg-x'])).toEqual({
      subscription: SUB,
      resourceGroup: 'rg-x',
      yes: false,
    });
  });
});

describe('Azure CLI helpers', () => {
  it('runs the bundled python directly on Windows, never a shell', () => {
    const exists = (path: string) =>
      ['C:\\az\\bin\\az.cmd', 'C:\\az\\python.exe'].includes(path.replace(/\//g, '\\'));
    const launcher = resolveAzLauncher({ Path: 'C:\\Windows;C:\\az\\bin' }, 'win32', exists);
    expect(launcher.command.replace(/\//g, '\\')).toBe('C:\\az\\python.exe');
    expect(launcher.prefix).toEqual(['-IBm', 'azure.cli']);
  });

  it('fails clearly when the Azure CLI cannot be found', () => {
    expect(() => resolveAzLauncher({ Path: 'C:\\Windows' }, 'win32', () => false)).toThrow(
      /Azure CLI was not found/,
    );
  });

  it('uses az directly on other platforms', () => {
    expect(resolveAzLauncher({}, 'linux')).toEqual({ command: 'az', prefix: [] });
  });

  it('redacts tokens, bearer values, secret fields and SAS signatures from output', () => {
    // Assembled at runtime so no token-shaped literal sits in the repository.
    const jwt = [
      'eyJhbGciOiJSUzI1NiJ9',
      'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      'c2lnbmF0dXJlMTIzNDU2',
    ].join('.');
    const text = sanitizeAzOutput(
      `failed with ${jwt}; Authorization: Bearer abcdefghijklmnop1234; {"accessToken": "supersecretvalue", "primaryKey":"k1"} https://x.blob.core.windows.net/c?sig=abc%2Fdef&se=1`,
    );
    expect(text).not.toContain(jwt);
    expect(text).not.toContain('supersecretvalue');
    expect(text).not.toContain('abcdefghijklmnop1234');
    expect(text).not.toContain('abc%2Fdef');
    expect(text).toContain('[redacted');
  });

  it('truncates long output and strips control characters', () => {
    const text = sanitizeAzOutput(`a\u0007b${'x'.repeat(2000)}`, 50);
    expect(text.length).toBeLessThanOrEqual(51);
    expect(text).not.toContain('\u0007');
  });

  it('recognises a signed-out CLI', () => {
    expect(classifyAzFailure("ERROR: Please run 'az login' to setup account.")).toBe(
      'AZ_NOT_LOGGED_IN',
    );
    expect(classifyAzFailure('AADSTS70043: The refresh token has expired')).toBe(
      'AZ_NOT_LOGGED_IN',
    );
    expect(classifyAzFailure('ERROR: something else')).toBe('AZ_FAILED');
  });
});

describe('deployment helpers', () => {
  const candidate: Candidate = {
    region: 'eastus2',
    kind: 'AIServices',
    modelName: 'gpt-4.1-mini',
    modelVersion: '2025-04-14',
    sku: 'Standard',
    capacity: 10,
    quotaAvailable: 50,
    retiresOn: null,
    notes: [],
  };
  const request = {
    environment: 'swarm-dev',
    candidate,
    deploymentName: 'swarm-chat',
    principals: [{ principalId: PRINCIPAL, principalType: 'User' as const }],
  };

  it('derives a stable, bounded, valid account name', () => {
    const name = accountNameFor(SUB, 'rg-swarm', 'swarm-dev');
    expect(name).toBe(accountNameFor(SUB, 'rg-swarm', 'swarm-dev'));
    expect(name).not.toBe(accountNameFor(SUB, 'rg-other', 'swarm-dev'));
    expect(name).toMatch(/^ai-swarm-dev-[0-9a-f]{10}$/);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it('builds subscription-scope parameters without any secret-shaped field', () => {
    const parameters = buildParameters(request, 'subscription');
    expect(parameters).toMatchObject({
      environmentName: { value: 'swarm-dev' },
      location: { value: 'eastus2' },
      modelName: { value: 'gpt-4.1-mini' },
      deploymentSku: { value: 'Standard' },
      deploymentCapacity: { value: 10 },
      inferenceUsers: { value: [{ principalId: PRINCIPAL, principalType: 'User' }] },
    });
    expect(JSON.stringify(parameters)).not.toMatch(/key|secret|password|token/i);
  });

  it('adds the project tag and an explicit account name at resource-group scope', () => {
    const parameters = buildParameters({ ...request, accountName: 'ai-x' }, 'resource-group');
    expect(parameters.accountName).toEqual({ value: 'ai-x' });
    expect(parameters.tags).toEqual({ value: expect.objectContaining({ app: 'swarm-lab' }) });
    expect(() => buildParameters(request, 'resource-group')).toThrow(/accountName/);
  });

  it('serialises a standard ARM parameters file', () => {
    const file = JSON.parse(toParametersFile(buildParameters(request, 'subscription')));
    expect(file.contentVersion).toBe('1.0.0.0');
    expect(file.$schema).toContain('deploymentParameters.json');
  });

  it('reads both output naming schemes and rejects incomplete outputs', () => {
    const endpoint = 'https://ai-x.openai.azure.com/';
    expect(
      parseOutputs({
        AZURE_AI_ACCOUNT_NAME: { type: 'String', value: 'ai-x' },
        AZURE_OPENAI_ENDPOINT: { type: 'String', value: endpoint },
        AZURE_OPENAI_DEPLOYMENT: { type: 'String', value: 'swarm-chat' },
        AZURE_RESOURCE_GROUP: { type: 'String', value: 'rg-swarm-dev' },
      }),
    ).toMatchObject({
      accountName: 'ai-x',
      endpoint,
      deployment: 'swarm-chat',
      resourceGroup: 'rg-swarm-dev',
    });
    expect(
      parseOutputs({
        accountName: { value: 'ai-x' },
        openAiEndpoint: { value: endpoint },
        deploymentName: { value: 'swarm-chat' },
      }).deployment,
    ).toBe('swarm-chat');
    expect(() => parseOutputs({ accountName: { value: 'ai-x' } })).toThrow(/missing/);
    expect(() => parseOutputs(null)).toThrow(/no outputs/);
  });

  it.each([
    ['(InsufficientQuota) This operation require 10 new capacity in quota', 'quota'],
    ['(SkuNotSupported) The model is not supported in this region', 'model-unavailable'],
    ['(RequestDisallowedByPolicy) Resource was disallowed by policy', 'policy'],
    ['(AuthorizationFailed) The client does not have authorization', 'authorization'],
    ['(FlagMustBeSetForRestore) soft-deleted account', 'name-conflict'],
    ['something unexpected', 'other'],
  ])('classifies "%s" as %s', (message, kind) => {
    expect(classifyDeploymentFailure(message).kind).toBe(kind);
  });
});
