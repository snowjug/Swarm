import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, build, findBicep, type BicepCli, type Json } from './bicep.mjs';
import {
  describeDuplicates,
  findDuplicateDeclarations,
  findDuplicatePredictions,
} from './duplicates.mjs';
import {
  PUBLIC_FOUNDATION_ENV,
  PUBLIC_GUEST_ENV,
  PUBLIC_PARAM_FILE,
  PUBLIC_PLACEHOLDER_ENV,
  PUBLIC_REQUIRED_VARIABLES,
  buildPublicParams,
  evaluatePublic,
} from './public.mjs';

/**
 * Invariants of the PUBLIC EDITION's template (infra/public), asserted on what Bicep compiles (the ARM template) and on what it
 * evaluates offline (`bicep snapshot`: the resources a deployment of each profile WOULD create). The pilot's own invariants are in
 * infra-invariants.test.ts and are not touched. They need the Bicep CLI (scripts/iac/bicep.lock.json) and are skipped with a visible
 * reason without it, except in CI, where the pilot's file already fails a run that cannot find it.
 *
 * What this cannot show: that Azure accepts any of it. Nothing here has been deployed.
 */

type Obj = { [key: string]: Json };
const isObj = (value: Json | undefined): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function get(value: Json | undefined, ...path: (string | number)[]): Json | undefined {
  let current: Json | undefined = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isObj(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

const list = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : []);
const objects = (value: Json | undefined): Obj[] => list(value).filter(isObj);

/** A compiled template, and the template of every module nested in it. */
function templates(template: Json | undefined, found: Obj[] = []): Obj[] {
  if (!isObj(template)) return found;
  found.push(template);
  const resources = template.resources;
  const items = Array.isArray(resources)
    ? resources
    : isObj(resources)
      ? Object.values(resources)
      : [];
  for (const resource of items) {
    const nested = get(resource, 'properties', 'template');
    if (nested) templates(nested, found);
  }
  return found;
}

/** The resources one template declares itself, not those of the modules nested in it. */
function ownResourcesOf(template: Obj): Obj[] {
  const resources = template.resources;
  return objects(
    Array.isArray(resources) ? resources : isObj(resources) ? Object.values(resources) : [],
  );
}

function resourcesOf(template: Json | undefined): Obj[] {
  return templates(template).flatMap(ownResourcesOf);
}

function strings(value: Json | undefined, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, found));
  else if (isObj(value)) Object.values(value).forEach((item) => strings(item, found));
  return found;
}

const predicted = (snapshot: Json | undefined): Obj[] =>
  objects(get(snapshot, 'predictedResources'));
const ofType = (resources: Obj[], type: string): Obj[] =>
  resources.filter((one) => one.type === type);

/** The environment variables of the one container app of a snapshot, by name. `secretRef` entries have no value. */
function environmentOf(snapshot: Json): Obj[] {
  const [app] = ofType(predicted(snapshot), 'Microsoft.App/containerApps');
  return objects(get(app, 'properties', 'template', 'containers', 0, 'env'));
}
const valuesOf = (snapshot: Json): Record<string, string> =>
  Object.fromEntries(
    environmentOf(snapshot)
      .filter((entry) => typeof entry.value === 'string')
      .map((entry) => [String(entry.name), String(entry.value)]),
  );

/** The built-in role definitions the application identity may hold, and why each is there. */
const ALLOWED_ROLES = new Map([
  ['7f951dda-4ed3-4680-a7ca-43fe172d538d', 'AcrPull'],
  ['3913510d-42f4-4e42-8a64-420c390055eb', 'Monitoring Metrics Publisher'],
  ['5e0bd9bd-7b93-4f28-af87-19fc36ad61bd', 'Cognitive Services OpenAI User'],
  ['4633458b-17de-408a-b874-0445c86b69e6', 'Key Vault Secrets User'],
]);
const FORBIDDEN_ROLES = new Map([
  ['8e3af657-a8ff-443c-a75c-2fe8c4bcb635', 'Owner'],
  ['b24988ac-6180-42a0-ab88-20f7382dd24c', 'Contributor'],
  ['18d7d88d-d35e-4fb5-a5c3-7773c20a72d9', 'User Access Administrator'],
  ['f58310d9-a9f6-439a-9e8d-f62e7b41a168', 'Role Based Access Control Administrator'],
  ['00482a5a-887f-4fb3-b363-3b7fe8e74483', 'Key Vault Administrator'],
  ['b86a8fe4-44ce-4948-aee5-eccb2c155cd7', 'Key Vault Secrets Officer'],
  ['a97b65f3-24c7-4388-baec-2e87135dc908', 'Cognitive Services User'],
  ['a001fd3d-188f-4b5d-821b-7da978bf7442', 'Cognitive Services Contributor'],
]);

const SECRET_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ['storage account key', /AccountKey=/iu],
  ['shared access key', /SharedAccessKey=/iu],
  ['SAS signature', /[?&]sig=[A-Za-z0-9%+/=]{16,}/u],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./u],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  [
    'assigned secret',
    /\b(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}["']/iu,
  ],
  ['password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/iu],
];

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

// What scripts/secret-scan.mjs reports in source text. Its `assigned secret` also matches the bare word `secret` followed by a
// colon and a quoted string of 16 or more characters, so the NAME of a vault secret written that way is a finding there even
// though it is not a value: the template calls the property `secretName` for that reason.
const SOURCE_SCAN: ReadonlyArray<[string, RegExp]> = [
  [
    'assigned secret',
    /\b(?:api[_-]?key|client[_-]?secret|password|secret)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}["']/iu,
  ],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/u],
  ['Azure SAS signature', /[?&]sig=[A-Za-z0-9%+/=]{20,}/u],
];

/** Resource types that carry no tags of their own. Every other predicted resource must be tagged. */
const UNTAGGED_TYPES = new Set([
  'Microsoft.Authorization/roleAssignments',
  'Microsoft.Consumption/budgets',
  'Microsoft.Insights/diagnosticSettings',
  'Microsoft.DBforPostgreSQL/flexibleServers/databases',
  'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules',
  'Microsoft.DBforPostgreSQL/flexibleServers/configurations',
  'Microsoft.DBforPostgreSQL/flexibleServers/administrators',
]);

const SUBSCRIPTION = '/subscriptions/00000000-0000-0000-0000-000000000000';
const OTHER_SUBSCRIPTION = '/subscriptions/11111111-1111-1111-1111-111111111111';
const PLACEHOLDER_KEY = PUBLIC_PLACEHOLDER_ENV.SWARM_PUBLIC_OPS_KEY ?? '';
/** A SHA-256, which is not a secret: only the hash of the owner's key is ever given to the template. */
const OWNER_KEY_SHA256 = '0123456789abcdef'.repeat(4);

/** The same document, with everything an operator may set, set. */
const EVERYTHING = {
  ...PUBLIC_PLACEHOLDER_ENV,
  SWARM_PUBLIC_BASE_URL: 'https://swarm.example.com',
  SWARM_PUBLIC_CUSTOM_DOMAIN: 'swarm.example.com',
  SWARM_PUBLIC_CUSTOM_DOMAIN_CERTIFICATE_ID: `${SUBSCRIPTION}/resourceGroups/rg-swarm-public/providers/Microsoft.App/managedEnvironments/cae-swarm-public/managedCertificates/mc-swarm`,
  SWARM_PUBLIC_ADMIN_EMAILS: 'owner@example.invalid',
  SWARM_PUBLIC_BLOCKED_EMAIL_DOMAINS: 'mail.example.invalid',
  SWARM_PUBLIC_TURNSTILE_SITE_KEY: 'example-turnstile-site-key',
  SWARM_PUBLIC_FREE_ROLE_MAX_OUTPUT_TOKENS: '{"extraction":1500}',
  SWARM_PUBLIC_MIN_REPLICAS: '0',
  SWARM_PUBLIC_CPU: '1',
  SWARM_PUBLIC_INGRESS_ALLOWED_CIDRS: '203.0.113.7/32,198.51.100.0/24',
  SWARM_PUBLIC_SOURCE_URL: 'https://example.invalid/swarm',
  SWARM_PUBLIC_BUILD_SHA: '7'.repeat(40),
  SWARM_PUBLIC_FREE_GLOBAL_DAILY_COST_USD: '2.50',
  SWARM_PUBLIC_FREE_USER_DAILY_TOKENS: '30000',
  SWARM_PUBLIC_SIGNUPS_PER_IP_PER_DAY: '3',
  SWARM_PUBLIC_SIGNUPS_PER_HOUR: '30',
  SWARM_PUBLIC_SESSION_IDLE_MINUTES: '20',
  SWARM_PUBLIC_SESSION_ABSOLUTE_HOURS: '6',
  SWARM_PUBLIC_GUEST_MODE: 'true',
  SWARM_PUBLIC_GUESTS_PER_IP_PER_HOUR: '7',
  SWARM_PUBLIC_GUESTS_PER_HOUR: '150',
  SWARM_PUBLIC_GUEST_RETENTION_HOURS: '12',
  SWARM_PUBLIC_FREE_GUEST_DAILY_TOKENS: '50000',
  SWARM_PUBLIC_FREE_GUEST_DAILY_CALLS: '30',
  SWARM_PUBLIC_FREE_GUEST_LIFETIME_TOKENS: '150000',
  SWARM_PUBLIC_FREE_GUEST_CONCURRENT_RUNS: '1',
  SWARM_PUBLIC_FREE_GUEST_CONCURRENT_CALLS: '2',
  SWARM_PUBLIC_FREE_GUEST_TOKENS_PER_RUN: '12000',
  // In capitals on purpose: the application reads only lower case, so the template lower-cases it.
  SWARM_PUBLIC_OWNER_KEY_SHA256: OWNER_KEY_SHA256.toUpperCase(),
  SWARM_PUBLIC_ADDITIONAL_ALERT_EMAILS: 'second@example.invalid',
};

/**
 * Two things that differ from the default, in one evaluation: the model account is in another subscription (its group is not in this
 * subscription's budget), and the database is a server that was made by a point-in-time restore, which the template only uses.
 */
const ELSEWHERE = {
  ...PUBLIC_PLACEHOLDER_ENV,
  SWARM_PUBLIC_AI_ACCOUNT_RESOURCE_ID: `${OTHER_SUBSCRIPTION}/resourceGroups/rg-other-ai/providers/Microsoft.CognitiveServices/accounts/ai-other`,
  SWARM_PUBLIC_EXISTING_DATABASE_SERVER_NAME: 'psql-swarm-public-restored',
};

/**
 * The configuration table of docs/public/DESIGN.md, section 3: the contract the application and the template are built to.
 * `FOO_A` / `_B` in one cell is two names, and the default is whatever the second column says between backticks.
 */
function designTable(): Map<string, string> {
  const text = readFileSync(join(REPO_ROOT, 'docs', 'public', 'DESIGN.md'), 'utf8');
  const start = text.indexOf('\n### Configuration');
  const rows = text.slice(start).split('\n').slice(1);
  const found = new Map<string, string>();
  let inTable = false;
  for (const row of rows) {
    if (!row.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = row.split('|').map((cell) => cell.trim());
    const names: string[] = [];
    for (const [, token] of (cells[1] ?? '').matchAll(/`([^`]+)`/gu)) {
      const previous = names.at(-1);
      if (token?.startsWith('_') && previous) {
        // `A_B_C` / `_D_E` is A_D_E: the suffix replaces as many trailing parts of the name before it as it has.
        const kept = previous.split('_').slice(0, -token.split('_').slice(1).length);
        names.push(`${kept.join('_')}${token}`);
      } else if (token) {
        names.push(token);
      }
    }
    // `30` / `8` in the second column is one default for each name, in order; one value is the default of all of them.
    const defaults = [...(cells[2] ?? '').matchAll(/`([^`]+)`/gu)].map((match) => String(match[1]));
    const words = (cells[2] ?? '').replaceAll('*', '');
    names.forEach((name, index) => {
      found.set(name, (defaults.length === names.length ? defaults[index] : defaults[0]) ?? words);
    });
  }
  return found;
}

/** The parameter of the template that sets each variable of the table with a value to choose. */
const PARAMETER_OF: Record<string, string> = {
  PUBLIC_SIGNUPS_ENABLED: 'signupsEnabled',
  PUBLIC_MAX_PROJECTS: 'maxProjects',
  PUBLIC_STORAGE_QUOTA_MB: 'storageQuotaMb',
  PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS: 'deletedAccountRetentionDays',
  PUBLIC_ALLOW_RESEARCH: 'allowResearch',
  PUBLIC_SIGNUPS_PER_IP_PER_DAY: 'signupsPerIpPerDay',
  PUBLIC_SIGNUPS_PER_HOUR: 'signupsPerHour',
  PUBLIC_GUEST_MODE: 'guestMode',
  PUBLIC_GUESTS_PER_IP_PER_HOUR: 'guestsPerIpPerHour',
  PUBLIC_GUESTS_PER_HOUR: 'guestsPerHour',
  PUBLIC_GUEST_RETENTION_HOURS: 'guestRetentionHours',
  AUTH_SESSION_IDLE_MINUTES: 'sessionIdleMinutes',
  AUTH_SESSION_ABSOLUTE_HOURS: 'sessionAbsoluteHours',
  FREE_TIER_ENABLED: 'freeTierEnabled',
  FREE_USER_DAILY_TOKENS: 'freeUserDailyTokens',
  FREE_USER_DAILY_CALLS: 'freeUserDailyCalls',
  FREE_USER_LIFETIME_TOKENS: 'freeUserLifetimeTokens',
  FREE_USER_CONCURRENT_RUNS: 'freeUserConcurrentRuns',
  FREE_USER_CONCURRENT_CALLS: 'freeUserConcurrentCalls',
  FREE_GLOBAL_DAILY_TOKENS: 'freeGlobalDailyTokens',
  FREE_GLOBAL_DAILY_COST_USD: 'freeGlobalDailyCostUsd',
  FREE_TOKENS_PER_RUN: 'freeTokensPerRun',
  FREE_GUEST_DAILY_TOKENS: 'freeGuestDailyTokens',
  FREE_GUEST_DAILY_CALLS: 'freeGuestDailyCalls',
  FREE_GUEST_LIFETIME_TOKENS: 'freeGuestLifetimeTokens',
  FREE_GUEST_CONCURRENT_RUNS: 'freeGuestConcurrentRuns',
  FREE_GUEST_CONCURRENT_CALLS: 'freeGuestConcurrentCalls',
  FREE_GUEST_TOKENS_PER_RUN: 'freeGuestTokensPerRun',
  BYOK_ENABLED: 'byokEnabled',
  BYOK_MAX_CONCURRENT_CALLS: 'byokMaxConcurrentCalls',
};

/** Table names the template leaves to the application's default on purpose: each is a way round a check, or a name to keep. */
const LEFT_TO_THE_APPLICATION = new Set([
  'PUBLIC_ALLOW_UNSAFE_SQLITE',
  'PUBLIC_ALLOW_REASONING_DEPLOYMENT',
  'PUBLIC_DB_RUNTIME_ROLE',
]);

/** The names that belong to the public edition, and so must be in the table. */
const PUBLIC_NAME = /^(?:PUBLIC_|FREE_|BYOK_|TURNSTILE_|AUTH_SESSION_|SWARM_EDITION$)/u;

const bicep: BicepCli | null = findBicep();
// `npm run test:postgres` runs the whole suite against PostgreSQL. These tests touch no database.
const postgresRun = Boolean(process.env.SWARM_TEST_DATABASE);

describe.skipIf(!bicep || postgresRun)(
  'public edition invariants (compiled and evaluated with Bicep, offline)',
  () => {
    let main: Json;
    let withApp: Json;
    let foundation: Json;
    let everything: Json;
    let elsewhere: Json;
    let guestOnly: Json;

    beforeAll(() => {
      const cli = bicep as BicepCli;
      const built = build(cli, 'infra/public/main.bicep');
      expect(built.diagnostics).toEqual([]);
      main = built.json as Json;

      const run = (env: Record<string, string>): Json => {
        const result = evaluatePublic(cli, env);
        expect(result.diagnostics).toEqual([]);
        return result.snapshot as Json;
      };
      withApp = run(PUBLIC_PLACEHOLDER_ENV);
      foundation = run(PUBLIC_FOUNDATION_ENV);
      everything = run(EVERYTHING);
      elsewhere = run(ELSEWHERE);
      guestOnly = run(PUBLIC_GUEST_ENV);
    }, 600_000);

    describe('a deployment of its own', () => {
      it('is a subscription-scope template that creates its own resource group, tagged as the release tooling requires', () => {
        expect(String(get(main, '$schema'))).toContain('subscriptionDeploymentTemplate');
        const [group] = ofType(predicted(withApp), 'Microsoft.Resources/resourceGroups');
        expect(get(group, 'name')).toBe('rg-swarm-public');
        // `npm run azure:release` refuses a group that is not tagged app=swarm-lab.
        expect(get(group, 'tags', 'app')).toBe('swarm-lab');
        expect(get(group, 'tags', 'purpose')).toBe('public');
      });

      it('names nothing of the pilot, and its parameter file reads no variable the pilot reads', () => {
        for (const snapshot of [withApp, foundation, everything]) {
          const names = predicted(snapshot).map((one) => String(one.name));
          expect(names.filter((name) => /pilot/iu.test(name))).toEqual([]);
        }
        const read = (path: string): string[] =>
          [
            ...readFileSync(join(REPO_ROOT, path), 'utf8').matchAll(
              /readEnvironmentVariable\('([A-Z0-9_]+)'/gu,
            ),
          ].map((match) => String(match[1]));
        const publicNames = read(PUBLIC_PARAM_FILE);
        const pilotNames = [
          ...read('infra/pilot/main.bicepparam'),
          ...read('infra/pilot/production-shaped.bicepparam'),
        ];
        expect(publicNames.length).toBeGreaterThan(30);
        expect(publicNames.filter((name) => !name.startsWith('SWARM_PUBLIC_'))).toEqual([]);
        expect(publicNames.filter((name) => pilotNames.includes(name))).toEqual([]);
      });

      it('has no resource declared twice, and predicts none twice in any profile', () => {
        expect(describeDuplicates(findDuplicateDeclarations(main, 'main.bicep'))).toBe('');
        for (const [name, snapshot] of Object.entries({
          withApp,
          foundation,
          everything,
          elsewhere,
          guestOnly,
        })) {
          expect(findDuplicatePredictions(snapshot as never), name).toEqual([]);
        }
      });

      it('tags everything that can be tagged', () => {
        for (const snapshot of [withApp, foundation, everything]) {
          for (const resource of predicted(snapshot)) {
            if (UNTAGGED_TYPES.has(String(resource.type))) continue;
            const tags = get(resource, 'tags');
            const label = `${String(resource.type)} ${String(resource.name)}`;
            expect(isObj(tags), `${label} has tags`).toBe(true);
            expect(get(tags, 'app'), label).toBe('swarm-lab');
            expect(get(tags, 'managedBy'), label).toBe('bicep');
            expect(get(tags, 'purpose'), label).toBe('public');
          }
        }
      });

      it('keeps every name inside the limits of the services and of the release tooling', () => {
        const names = (type: string) =>
          ofType(predicted(withApp), type).map((one) => String(one.name));
        expect(names('Microsoft.ContainerRegistry/registries')[0]).toMatch(/^[a-z0-9]{5,50}$/u);
        expect(names('Microsoft.KeyVault/vaults')[0]).toMatch(/^[a-z][a-z0-9-]{2,23}$/u);
        expect(names('Microsoft.DBforPostgreSQL/flexibleServers')[0]?.length).toBeLessThanOrEqual(
          63,
        );
        // scripts/azure/lib/release-args.ts
        expect(names('Microsoft.App/containerApps')[0]).toMatch(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/u);
      });
    });

    describe('what it creates, and what it only references', () => {
      it('creates no model account and no model deployment: the account is referenced, and the deployment is only read', () => {
        for (const snapshot of [withApp, foundation, everything, elsewhere]) {
          expect(
            predicted(snapshot)
              .map((one) => String(one.type))
              .filter((type) => type.startsWith('Microsoft.CognitiveServices/')),
          ).toEqual([]);
        }
        // No template and no module declares one: an `existing` resource is not emitted at all, it is only read.
        expect(
          resourcesOf(main).filter((one) =>
            String(one.type).startsWith('Microsoft.CognitiveServices/'),
          ),
        ).toEqual([]);
      });

      it('creates the foundation first and the app only when it is asked for', () => {
        const types = (snapshot: Json) => predicted(snapshot).map((one) => String(one.type));
        for (const wanted of [
          'Microsoft.Resources/resourceGroups',
          'Microsoft.ManagedIdentity/userAssignedIdentities',
          'Microsoft.KeyVault/vaults',
          'Microsoft.DBforPostgreSQL/flexibleServers',
          'Microsoft.ContainerRegistry/registries',
          'Microsoft.OperationalInsights/workspaces',
          'Microsoft.Insights/components',
          'Microsoft.App/managedEnvironments',
          'Microsoft.Consumption/budgets',
          'Microsoft.Insights/actionGroups',
        ]) {
          expect(types(foundation), wanted).toContain(wanted);
          expect(types(withApp), wanted).toContain(wanted);
        }
        expect(types(foundation)).not.toContain('Microsoft.App/containerApps');
        expect(types(foundation)).not.toContain('Microsoft.Insights/metricAlerts');
        expect(
          types(withApp).filter((type) => type === 'Microsoft.App/containerApps'),
        ).toHaveLength(1);
        expect(
          types(withApp).filter((type) => type === 'Microsoft.App/managedEnvironments'),
        ).toHaveLength(1);
        // Nothing needs a secret before the app exists: no provider, no image, no reference to anything in the vault.
        expect(JSON.stringify(predicted(foundation))).not.toMatch(/keyVaultUrl|secretRef/u);
      });

      it('asks for the app with every guard satisfied before the resource group, so that nothing is created when a check fails', () => {
        const dependsOn = (name: string) =>
          list(get(main, 'resources', name, 'dependsOn')).map(String);
        expect(dependsOn('group')).toContain('guards');
        expect(dependsOn('guards')).toContain('model');
        for (const module of [
          'identity',
          'monitoring',
          'registry',
          'keyVault',
          'database',
          'app',
        ]) {
          expect(dependsOn(module), module).toContain('group');
        }
        expect(get(main, 'resources', 'app', 'condition')).toBe("[parameters('deployApp')]");
        expect(get(main, 'resources', 'alerts', 'condition')).toBe("[parameters('deployApp')]");
        // The app waits for every role assignment it needs: it starts using the identity as soon as it runs.
        for (const module of [
          'aiAccess',
          'appInsightsAccess',
          'keyVault',
          'registry',
          'database',
        ]) {
          expect(dependsOn('app'), module).toContain(module);
        }
      });
    });

    describe('the container app', () => {
      const appOf = (snapshot: Json) =>
        ofType(predicted(snapshot), 'Microsoft.App/containerApps')[0];

      it('runs at most ONE replica, whatever is asked: a BYOK key lives in the memory of one process', () => {
        for (const snapshot of [withApp, everything, elsewhere, guestOnly]) {
          expect(get(appOf(snapshot), 'properties', 'template', 'scale', 'maxReplicas')).toBe(1);
        }
        // Not a parameter at all: nothing can raise it, from a parameter file or from the command line.
        for (const template of templates(main)) {
          const names = Object.keys(isObj(template.parameters) ? template.parameters : {});
          expect(names.filter((name) => /maxReplicas/iu.test(name))).toEqual([]);
        }
        const module = templates(main).find((one) => isObj(get(one, 'parameters', 'probeHost')));
        expect(get(module, 'variables', 'maxReplicas')).toBe(1);
      });

      it('keeps one replica running by default, and allows only 0 or 1', () => {
        expect(get(appOf(withApp), 'properties', 'template', 'scale', 'minReplicas')).toBe(1);
        expect(get(appOf(guestOnly), 'properties', 'template', 'scale', 'minReplicas')).toBe(1);
        expect(get(appOf(everything), 'properties', 'template', 'scale', 'minReplicas')).toBe(0);
        expect(get(main, 'parameters', 'minReplicas', 'defaultValue')).toBe(1);
        expect(get(main, 'parameters', 'minReplicas', 'allowedValues')).toEqual([0, 1]);
        expect(get(main, 'parameters', 'maxReplicas')).toBeUndefined();
      });

      it('accepts HTTPS only, from anywhere unless told otherwise, behind one trusted proxy', () => {
        for (const snapshot of [withApp, everything]) {
          const ingress = get(appOf(snapshot), 'properties', 'configuration', 'ingress');
          expect(get(ingress, 'allowInsecure')).toBe(false);
          expect(get(ingress, 'external')).toBe(true);
          expect(get(ingress, 'targetPort')).toBe(3001);
          expect(valuesOf(snapshot)).toMatchObject({
            TRUST_PROXY: '1',
            HOST: '0.0.0.0',
            PORT: '3001',
          });
        }
        expect(
          get(appOf(withApp), 'properties', 'configuration', 'ingress', 'ipSecurityRestrictions'),
        ).toEqual([]);
        expect(
          objects(
            get(
              appOf(everything),
              'properties',
              'configuration',
              'ingress',
              'ipSecurityRestrictions',
            ),
          ).map((rule) => rule.ipAddressRange),
        ).toEqual(['203.0.113.7/32', '198.51.100.0/24']);
      });

      it('is a single revision, so that no second process with a second job runner and no keys ever serves', () => {
        for (const snapshot of [withApp, everything]) {
          expect(get(appOf(snapshot), 'properties', 'configuration', 'activeRevisionsMode')).toBe(
            'Single',
          );
          expect(get(appOf(snapshot), 'properties', 'configuration', 'ingress')).not.toHaveProperty(
            'traffic',
          );
        }
      });

      it('caps CPU and memory: at most 1 vCPU and 2 GiB, memory twice the CPU, 0.5 vCPU and 1 GiB by default', () => {
        expect(get(appOf(withApp), 'properties', 'template', 'containers', 0, 'resources')).toEqual(
          {
            cpu: 0.5,
            memory: '1Gi',
          },
        );
        expect(
          get(appOf(everything), 'properties', 'template', 'containers', 0, 'resources'),
        ).toEqual({
          cpu: 1,
          memory: '2Gi',
        });
        expect(get(main, 'parameters', 'cpu', 'allowedValues')).toEqual(['0.25', '0.5', '1']);
      });

      it('has startup, liveness and readiness probes on the health routes, asking for the default address', () => {
        const probes = objects(
          get(appOf(withApp), 'properties', 'template', 'containers', 0, 'probes'),
        );
        expect(probes.map((probe) => probe.type)).toEqual(['Startup', 'Liveness', 'Readiness']);
        for (const probe of probes) {
          expect(get(probe, 'httpGet', 'port')).toBe(3001);
          expect(['/api/health/live', '/api/health/ready']).toContain(
            get(probe, 'httpGet', 'path'),
          );
          const [header, ...others] = objects(get(probe, 'httpGet', 'httpHeaders'));
          expect(others).toEqual([]);
          expect(header?.name).toBe('Host');
          expect(String(header?.value)).toContain("'ca-swarm-public'");
          expect(String(header?.value)).toContain('.defaultDomain');
        }
        expect(get(probes[2], 'httpGet', 'path')).toBe('/api/health/ready');
      });

      it('keeps a Key Vault secret as a reference: a vault URL and the identity, never a value, the pepper always and a provider only when it is configured', () => {
        const secretsOf = (snapshot: Json) =>
          objects(get(appOf(snapshot), 'properties', 'configuration', 'secrets'));
        expect(secretsOf(withApp).map((secret) => secret.name)).toEqual([
          'public-pepper',
          'public-google-client-secret',
          'public-github-client-secret',
        ]);
        expect(secretsOf(everything).map((secret) => secret.name)).toEqual([
          'public-pepper',
          'public-google-client-secret',
          'public-github-client-secret',
          'turnstile-secret-key',
        ]);
        for (const secret of secretsOf(everything)) {
          expect(secret).not.toHaveProperty('value');
          expect(String(secret.keyVaultUrl)).toContain("format('{0}secrets/{1}'");
          expect(String(secret.keyVaultUrl)).not.toMatch(/\bversions\b/u);
          expect(String(secret.identity)).toContain('userAssignedIdentities/id-swarm-public');
        }
        const references = environmentOf(everything).filter((entry) => 'secretRef' in entry);
        expect(references).toEqual([
          { name: 'PUBLIC_PEPPER', secretRef: 'public-pepper' },
          { name: 'PUBLIC_GOOGLE_CLIENT_SECRET', secretRef: 'public-google-client-secret' },
          { name: 'PUBLIC_GITHUB_CLIENT_SECRET', secretRef: 'public-github-client-secret' },
          { name: 'TURNSTILE_SECRET_KEY', secretRef: 'turnstile-secret-key' },
        ]);
        // No Google client ID, no Google secret: a provider is offered only when both are set. The pepper is not optional.
        const github = evaluatePublic(bicep as BicepCli, PUBLIC_PLACEHOLDER_ENV, [
          'SWARM_PUBLIC_GOOGLE_CLIENT_ID',
        ]);
        expect(github.diagnostics).toEqual([]);
        expect(
          environmentOf(github.snapshot as Json)
            .map((entry) => String(entry.name))
            .filter((name) => /GOOGLE|TURNSTILE|PEPPER/u.test(name)),
        ).toEqual(['PUBLIC_PEPPER']);
      }, 120_000);

      it('declares the custom domain when it is given, and the default address stays allowed beside it', () => {
        const [domain] = objects(
          get(appOf(everything), 'properties', 'configuration', 'ingress', 'customDomains'),
        );
        expect(get(domain, 'name')).toBe('swarm.example.com');
        expect(get(domain, 'bindingType')).toBe('SniEnabled');
        expect(String(get(domain, 'certificateId'))).toContain('/managedCertificates/');
        expect(
          get(appOf(withApp), 'properties', 'configuration', 'ingress', 'customDomains'),
        ).toEqual([]);
        const values = valuesOf(everything);
        expect(values.PUBLIC_BASE_URL).toBe('https://swarm.example.com');
        expect(values.ALLOWED_ORIGINS).toBe('https://swarm.example.com');
        // The custom host first, then the default address (an expression, known to Azure only once the environment exists).
        expect(String(values.ALLOWED_HOSTS)).toContain("format('{0},{1}', 'swarm.example.com', ");
        // Without a custom domain, the default address alone.
        const defaultOnly = String(
          environmentOf(withApp).find((one) => one.name === 'ALLOWED_HOSTS')?.value,
        );
        expect(defaultOnly).toContain('.defaultDomain');
        expect(defaultOnly).not.toContain('{0},{1}');
      });
    });

    describe('the configuration of docs/public/DESIGN.md, section 3', () => {
      it('sets SWARM_EDITION=public, in production mode, with no Microsoft Entra sign-in variable and no model key', () => {
        for (const snapshot of [withApp, everything]) {
          expect(valuesOf(snapshot)).toMatchObject({
            SWARM_EDITION: 'public',
            DEPLOYMENT_MODE: 'production',
            DATABASE_AUTH: 'entra',
            AI_PROVIDER: 'foundry',
            FOUNDRY_AUTH: 'entra',
            MODEL_CACHE: 'off',
            RATE_LIMIT_SCALE: '1',
            LOG_LEVEL: 'info',
          });
          const names = environmentOf(snapshot).map((entry) => String(entry.name));
          // The application refuses AUTH_MODE in the public edition ("does not use AUTH_MODE: leave it unset"), and none of
          // the Microsoft Entra sign-in variables applies. The two session limits are the only AUTH_ names.
          expect(names).not.toContain('AUTH_MODE');
          expect(
            names.filter(
              (name) =>
                /^AUTH_/u.test(name) &&
                !/^AUTH_SESSION_(?:IDLE_MINUTES|ABSOLUTE_HOURS)$/u.test(name),
            ),
          ).toEqual([]);
          expect(names.filter((name) => /API_KEY|^SWARM_TEST_|_TEST_/u.test(name))).toEqual([]);
          for (const required of [
            'ALLOWED_HOSTS',
            'ALLOWED_ORIGINS',
            'PUBLIC_BASE_URL',
            'DEPLOYMENT_LABEL',
            'FOUNDRY_ENDPOINT',
            'APPLICATIONINSIGHTS_CONNECTION_STRING',
            'PUBLIC_OPS_KEY_SHA256',
          ]) {
            expect(names, required).toContain(required);
          }
        }
        // The hosted-start guard of the application: a production label is required and may not call itself a pilot.
        expect(valuesOf(withApp).DEPLOYMENT_LABEL).not.toMatch(/pilot/iu);
      });

      it('sets exactly the names of the table: every public name it sets is in the table, and every name of the table is set', () => {
        const table = designTable();
        expect(table.size).toBeGreaterThan(20);
        const set = new Set(environmentOf(everything).map((entry) => String(entry.name)));
        const ours = [...set].filter((name) => PUBLIC_NAME.test(name));
        expect(ours.filter((name) => !table.has(name))).toEqual([]);
        const missing = [...table.keys()].filter(
          (name) => !LEFT_TO_THE_APPLICATION.has(name) && !set.has(name),
        );
        expect(missing).toEqual([]);
      });

      it('sets the defaults of the table, from the parameter file and from the template alone', () => {
        const table = designTable();
        const values = valuesOf(withApp);
        for (const [name, parameter] of Object.entries(PARAMETER_OF)) {
          const wanted = table.get(name);
          expect(wanted, name).toBeDefined();
          expect(values[name], name).toBe(wanted);
          expect(
            String(get(main, 'parameters', parameter, 'defaultValue')),
            `${parameter} of the template`,
          ).toBe(wanted);
        }
        // A value that was given is used, and none of them is read as a default.
        const changed = valuesOf(everything);
        expect(changed.FREE_USER_DAILY_TOKENS).toBe('30000');
        expect(changed.FREE_GLOBAL_DAILY_COST_USD).toBe('2.50');
        expect(changed.FREE_ROLE_MAX_OUTPUT_TOKENS).toBe('{"extraction":1500}');
        expect(changed.PUBLIC_ADMIN_EMAILS).toBe('owner@example.invalid');
        expect(changed).toMatchObject({
          PUBLIC_SIGNUPS_PER_IP_PER_DAY: '3',
          PUBLIC_SIGNUPS_PER_HOUR: '30',
          AUTH_SESSION_IDLE_MINUTES: '20',
          AUTH_SESSION_ABSOLUTE_HOURS: '6',
        });
      });

      it("never sets what is a way round a safety check, and no cap can be 0 but a guest's tokens and calls (the pilot reads 0 as no limit)", () => {
        for (const snapshot of [withApp, everything]) {
          const names = environmentOf(snapshot).map((entry) => String(entry.name));
          expect(names).not.toContain('FOUNDRY_DEPLOYMENT_REASONING');
          expect(names).not.toContain('PUBLIC_ALLOW_UNSAFE_SQLITE');
          expect(names).not.toContain('PUBLIC_ALLOW_REASONING_DEPLOYMENT');
          for (const [name, value] of Object.entries(valuesOf(snapshot))) {
            if (
              /^(?:FREE_(?!TIER_ENABLED|ROLE_)|BYOK_(?!ENABLED)|PROJECT_MODEL_|PUBLIC_MAX_|PUBLIC_STORAGE|PUBLIC_SIGNUPS_PER_|PUBLIC_GUESTS?_(?!MODE)|AUTH_SESSION_)/u.test(
                name,
              )
            ) {
              expect(Number(value), name).toBeGreaterThan(0);
            }
          }
        }
        expect(JSON.stringify(main)).not.toContain('FOUNDRY_DEPLOYMENT_REASONING');
        // The three per-guest caps of tokens and calls may be set to 0, and 0 then means that a guest may use none of the free tier
        // (the application reads every FREE_ cap of 0 so), never that there is no limit. Every other cap is at least 1.
        const MAY_BE_ZERO = [
          'freeGuestDailyTokens',
          'freeGuestDailyCalls',
          'freeGuestLifetimeTokens',
        ];
        for (const [parameter, definition] of Object.entries(
          isObj(get(main, 'parameters')) ? (get(main, 'parameters') as Obj) : {},
        )) {
          if (
            /^(?:free|byok|projectModel|signupsPer|guest|session)/u.test(parameter) &&
            get(definition, 'type') === 'int' &&
            !MAY_BE_ZERO.includes(parameter)
          ) {
            expect(Number(get(definition, 'minValue')), parameter).toBeGreaterThanOrEqual(1);
          }
        }
      });

      it('keeps a session inside the limits of a hosted deployment (60 idle minutes, 12 hours), by parameter and by default', () => {
        expect(get(main, 'parameters', 'sessionIdleMinutes', 'maxValue')).toBe(60);
        expect(get(main, 'parameters', 'sessionAbsoluteHours', 'maxValue')).toBe(12);
        for (const snapshot of [withApp, everything]) {
          const values = valuesOf(snapshot);
          expect(Number(values.AUTH_SESSION_IDLE_MINUTES)).toBeLessThanOrEqual(60);
          expect(Number(values.AUTH_SESSION_ABSOLUTE_HOURS)).toBeLessThanOrEqual(12);
        }
        // The application allows more retention than 365 days of a deleted account's counter: the template does not.
        expect(get(main, 'parameters', 'deletedAccountRetentionDays', 'maxValue')).toBe(365);
      });

      it('declares the free deployment as NOT reasoning, with a price, and the same name three times', () => {
        for (const snapshot of [withApp, everything]) {
          const values = valuesOf(snapshot);
          const name = values.AI_MODEL;
          expect(name).toBe('swarm-free');
          expect(JSON.parse(String(values.FOUNDRY_DEPLOYMENT_PROFILES))).toEqual({
            [String(name)]: { reasoning: false },
          });
          expect(JSON.parse(String(values.MODEL_PRICES))).toEqual([
            { deployment: name, inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
          ]);
        }
      });

      it('has no secret in the environment: the pepper and the sign-in secrets are references and the webhook key is nowhere in it', () => {
        for (const entry of environmentOf(everything)) {
          if (/SECRET|PEPPER|OPS_KEY$/u.test(String(entry.name))) {
            expect(entry, String(entry.name)).not.toHaveProperty('value');
          }
        }
        expect(JSON.stringify(environmentOf(everything))).not.toContain(PLACEHOLDER_KEY);
        expect(valuesOf(withApp).PUBLIC_OPS_KEY_SHA256).toMatch(/^[0-9a-f]{64}$/u);
      });
    });

    describe('guest mode (no sign-in)', () => {
      const appOf = (snapshot: Json) =>
        ofType(predicted(snapshot), 'Microsoft.App/containerApps')[0];

      it('deploys the app with no OAuth client at all: no client ID, no provider secret, and the pepper as the only reference', () => {
        expect(ofType(predicted(guestOnly), 'Microsoft.App/containerApps')).toHaveLength(1);
        const names = environmentOf(guestOnly).map((entry) => String(entry.name));
        expect(names.filter((name) => /GOOGLE|GITHUB|TURNSTILE/u.test(name))).toEqual([]);
        expect(environmentOf(guestOnly).filter((entry) => 'secretRef' in entry)).toEqual([
          { name: 'PUBLIC_PEPPER', secretRef: 'public-pepper' },
        ]);
        expect(
          objects(get(appOf(guestOnly), 'properties', 'configuration', 'secrets')).map(
            (secret) => secret.name,
          ),
        ).toEqual(['public-pepper']);
        expect(JSON.stringify(predicted(guestOnly))).not.toMatch(/client-secret/u);
        // Guest creation obeys the sign-ups switch, which stays a parameter of its own.
        expect(valuesOf(guestOnly).PUBLIC_SIGNUPS_ENABLED).toBe('true');
      });

      it('sets PUBLIC_GUEST_MODE to true only when the parameter says so', () => {
        expect(valuesOf(withApp).PUBLIC_GUEST_MODE).toBe('false');
        expect(valuesOf(guestOnly).PUBLIC_GUEST_MODE).toBe('true');
        expect(valuesOf(everything).PUBLIC_GUEST_MODE).toBe('true');
        // Guest mode does not switch a provider off: the pair of a client ID and its secret is as it was.
        expect(valuesOf(everything).PUBLIC_GOOGLE_CLIENT_ID).toBe(
          PUBLIC_PLACEHOLDER_ENV.SWARM_PUBLIC_GOOGLE_CLIENT_ID,
        );
      });

      it('passes the guest limits and the owner key hash on as given (the defaults are the table)', () => {
        expect(valuesOf(everything)).toMatchObject({
          PUBLIC_GUESTS_PER_IP_PER_HOUR: '7',
          PUBLIC_GUESTS_PER_HOUR: '150',
          PUBLIC_GUEST_RETENTION_HOURS: '12',
          FREE_GUEST_DAILY_TOKENS: '50000',
          FREE_GUEST_DAILY_CALLS: '30',
          FREE_GUEST_LIFETIME_TOKENS: '150000',
          FREE_GUEST_CONCURRENT_RUNS: '1',
          FREE_GUEST_CONCURRENT_CALLS: '2',
          FREE_GUEST_TOKENS_PER_RUN: '12000',
          PUBLIC_OWNER_KEY_SHA256: OWNER_KEY_SHA256,
        });
        // Left out when empty, like every optional setting. Only the hash is a parameter: the key never reaches the template.
        for (const snapshot of [withApp, guestOnly]) {
          expect(environmentOf(snapshot).map((entry) => entry.name)).not.toContain(
            'PUBLIC_OWNER_KEY_SHA256',
          );
        }
        expect(get(main, 'parameters', 'ownerKeySha256', 'defaultValue')).toBe('');
        expect(get(main, 'parameters', 'ownerKey')).toBeUndefined();
      });

      it("takes the application's default and range for every guest limit (backend/src/public/config.ts)", () => {
        const source = readFileSync(
          join(REPO_ROOT, 'backend', 'src', 'public', 'config.ts'),
          'utf8',
        );
        const application = new Map<string, number[]>();
        for (const match of source.matchAll(/\b([A-Z][A-Z0-9_]+): whole\(([^)]*)\)/gu)) {
          application.set(
            String(match[1]),
            String(match[2])
              .split(',')
              .map((part) => Number(part.trim().replaceAll('_', ''))),
          );
        }
        const limits = Object.entries(PARAMETER_OF).filter(
          ([name]) =>
            /^(?:PUBLIC_GUESTS?_|FREE_GUEST_)/u.test(name) && name !== 'PUBLIC_GUEST_MODE',
        );
        expect(limits, 'the nine guest limits of the table').toHaveLength(9);
        for (const [name, parameter] of limits) {
          const [fallback, min, max] = application.get(name) ?? [];
          expect(fallback, `${name} is read with whole() in config.ts`).toBeDefined();
          expect(get(main, 'parameters', parameter, 'defaultValue'), `${parameter} default`).toBe(
            fallback,
          );
          expect(get(main, 'parameters', parameter, 'minValue'), `${parameter} minimum`).toBe(min);
          expect(get(main, 'parameters', parameter, 'maxValue'), `${parameter} maximum`).toBe(max);
        }
      });
    });

    describe('refuses what must not be deployed, before anything is created', () => {
      const refused = (env: Record<string, string>, without: string[] = []) => {
        const result = evaluatePublic(bicep as BicepCli, env, without);
        expect(result.status, 'the deployment is refused').not.toBe(0);
        expect(result.snapshot).toBeNull();
        return result.diagnostics.map((one) => one.message).join('\n');
      };

      it('a free deployment named for a reasoning model is refused, before anything is created', () => {
        expect(
          refused({ ...PUBLIC_PLACEHOLDER_ENV, SWARM_PUBLIC_AI_DEPLOYMENT_NAME: 'gpt-5-mini' }),
        ).toContain('freeDeploymentNameIsNotAReasoningFamily');
      }, 120_000);

      it('also reads the model behind a deployment whatever it is called, so a neutral name does not hide a reasoning model', () => {
        const expression = String(
          get(
            main,
            'resources',
            'guards',
            'properties',
            'parameters',
            'freeDeploymentModelIsNotAReasoningFamily',
            'value',
          ),
        );
        expect(expression).toContain("reference('model'");
        expect(expression).toContain('modelName');
        expect(expression).toContain('isReasoningFamily');
        // An existing deployment is only read: Reader on the account is what it needs. The nested template declares no
        // resource at all, and its one output is a reference() to the deployment.
        const reader = get(main, 'resources', 'model', 'properties', 'template');
        expect(get(reader, 'resources')).toEqual([]);
        expect(JSON.stringify(get(reader, 'outputs', 'modelName', 'value'))).toContain(
          "reference(resourceId('Microsoft.CognitiveServices/accounts/deployments'",
        );
      });

      it('refuses the same names as the application does (REASONING_FAMILIES in backend/src/public/config.ts)', () => {
        const application = /const REASONING_FAMILIES = \/(.+)\/([a-z]*);/u.exec(
          readFileSync(join(REPO_ROOT, 'backend', 'src', 'public', 'config.ts'), 'utf8'),
        );
        expect(
          application,
          'REASONING_FAMILIES moved: this test reads it from the source',
        ).not.toBeNull();
        const pattern = new RegExp(String(application?.[1]), String(application?.[2]));

        // The two functions of the template, as written in it, evaluated by Bicep itself (`bicep console`), one name a line.
        const source = readFileSync(join(REPO_ROOT, 'infra', 'public', 'main.bicep'), 'utf8');
        const functions = ['paddedName', 'isReasoningFamily'].map((name) => {
          const start = source.indexOf(`func ${name}(`);
          expect(start, name).toBeGreaterThan(-1);
          return source.slice(start, source.indexOf('\n\n', start)).replace(/\s*\n\s*/gu, ' ');
        });
        const names = [
          'gpt-5',
          'gpt-5-mini',
          'GPT-5.1',
          'gpt-50',
          'x-gpt-5',
          'x_gpt-5',
          'x.gpt-5',
          'xgpt-5',
          'gpt_5',
          'gpt5',
          'o1',
          'o1-mini',
          'o2',
          'o3',
          'o3-mini',
          'O4-Mini',
          'o5',
          'o6',
          'o7',
          'o8',
          'o9',
          'o0',
          'o10',
          'o1x',
          'oo1',
          'my-o3-chat',
          'team_o4',
          'swarm.o2.x',
          'a--o1',
          'o1.',
          '.o1',
          '-o1',
          'o',
          'mini-o',
          'free-o',
          'gpt-4.1-mini',
          'gpt-4o-mini',
          'gpt-4o',
          'gpt-4',
          'gpt-35-turbo',
          'swarm-free',
          'swarm-chat',
          'proto3',
          'demo1',
          'phi-4-mini',
          'text-embedding-3-small',
        ];
        const result = spawnSync((bicep as BicepCli).path, ['console'], {
          input: `${[...functions, ...names.map((name) => `isReasoningFamily('${name}')`)].join('\n')}\n`,
          encoding: 'utf8',
          cwd: REPO_ROOT,
        });
        const answers = result.stdout.trim().split('\n');
        expect(answers, result.stderr).toHaveLength(names.length);
        names.forEach((name, index) => {
          expect(answers[index], name).toBe(String(pattern.test(name)));
        });
        // Not a vacuous test: both answers occur, and the names the documentation recommends are accepted.
        expect(answers).toContain('true');
        expect(answers).toContain('false');
        expect(pattern.test('gpt-4.1-mini')).toBe(false);
      }, 120_000);

      it('accepts the deployment the documentation recommends, gpt-4.1-mini, by name', () => {
        const result = evaluatePublic(bicep as BicepCli, {
          ...PUBLIC_PLACEHOLDER_ENV,
          SWARM_PUBLIC_AI_DEPLOYMENT_NAME: 'gpt-4.1-mini',
        });
        expect(result.diagnostics).toEqual([]);
        const values = valuesOf(result.snapshot as Json);
        expect(values.AI_MODEL).toBe('gpt-4.1-mini');
        expect(JSON.parse(String(values.FOUNDRY_DEPLOYMENT_PROFILES))).toEqual({
          'gpt-4.1-mini': { reasoning: false },
        });
      }, 120_000);

      it('the pilot, or anything named for it, is not a place to deploy to', () => {
        expect(
          refused({ ...PUBLIC_PLACEHOLDER_ENV, SWARM_PUBLIC_ENV_NAME: 'swarm-pilot' }),
        ).toContain('resourceGroupAndEnvironmentAreNotThePilots');
      }, 120_000);

      it('an app without a sign-in provider, or without an image, is not deployed; a first deployment needs neither', () => {
        expect(
          refused(PUBLIC_PLACEHOLDER_ENV, [
            'SWARM_PUBLIC_GOOGLE_CLIENT_ID',
            'SWARM_PUBLIC_GITHUB_CLIENT_ID',
          ]),
        ).toContain('atLeastOneSignInProviderIsConfigured');
        expect(refused(PUBLIC_PLACEHOLDER_ENV, ['SWARM_PUBLIC_CONTAINER_IMAGE'])).toContain(
          'containerImageIsGivenWhenTheAppIsDeployed',
        );
        expect(predicted(foundation).length).toBeGreaterThan(0);
      }, 240_000);

      it('guest mode lifts only the sign-in requirement: with it off, an app with no provider is refused again, and the image is still needed', () => {
        expect(refused({ ...PUBLIC_GUEST_ENV, SWARM_PUBLIC_GUEST_MODE: 'false' })).toContain(
          'atLeastOneSignInProviderIsConfigured',
        );
        expect(refused(PUBLIC_GUEST_ENV, ['SWARM_PUBLIC_CONTAINER_IMAGE'])).toContain(
          'containerImageIsGivenWhenTheAppIsDeployed',
        );
      }, 240_000);

      it('refuses an owner key hash that is not 64 hexadecimal characters, which the application would not start on', () => {
        for (const hash of [
          'a'.repeat(63),
          `g${'a'.repeat(63)}`,
          `${'a'.repeat(32)} ${'a'.repeat(31)}`,
        ]) {
          expect(
            refused({ ...PUBLIC_GUEST_ENV, SWARM_PUBLIC_OWNER_KEY_SHA256: hash }),
            hash,
          ).toContain('ownerKeySha256IsEmptyOrSixtyFourHexDigits');
        }
        // Too long is refused where the parameter is read, before any check.
        refused({ ...PUBLIC_GUEST_ENV, SWARM_PUBLIC_OWNER_KEY_SHA256: 'a'.repeat(65) });
      }, 240_000);

      it('refuses a public address that is not the https origin of a site, and takes one that is', () => {
        // The deployment is refused, naming the check, for one address of each kind of mistake...
        expect(
          refused({ ...PUBLIC_PLACEHOLDER_ENV, SWARM_PUBLIC_BASE_URL: 'http://swarm.example.com' }),
        ).toContain('publicBaseUrlIsAnHttpsOriginWithoutPath');

        // ...and the check itself, as written in the template, is evaluated by Bicep for many.
        const source = readFileSync(join(REPO_ROOT, 'infra', 'public', 'main.bicep'), 'utf8');
        const functions = ['idPart', 'isHttpsOrigin'].map((name) => {
          const start = source.indexOf(`func ${name}(`);
          expect(start, name).toBeGreaterThan(-1);
          return source.slice(start, source.indexOf('\n\n', start)).replace(/\s*\n\s*/gu, ' ');
        });
        const accepted = [
          'https://swarm.example.com',
          'https://a.b.c.example.org',
          'https://swarm-1.example.com',
        ];
        const refusedAddresses = [
          'http://swarm.example.com',
          'https://swarm.example.com/',
          'https://swarm.example.com/path',
          'https://Swarm.example.com',
          'https://swarm.example.com:8443',
          'https://user@swarm.example.com',
          'https://swarm.example.com?x=1',
          'https://swarm.example.com#top',
          'https://',
          'https:///x',
          'swarm.example.com',
          'ftp://swarm.example.com',
        ];
        const all = [...accepted, ...refusedAddresses];
        const result = spawnSync((bicep as BicepCli).path, ['console'], {
          input: `${[...functions, ...all.map((url) => `isHttpsOrigin('${url}')`)].join('\n')}\n`,
          encoding: 'utf8',
          cwd: REPO_ROOT,
        });
        const answers = result.stdout.trim().split('\n');
        expect(answers, result.stderr).toHaveLength(all.length);
        all.forEach((url, index) => {
          expect(answers[index], url).toBe(String(accepted.includes(url)));
        });
      }, 120_000);

      it('a custom domain needs its certificate, and must be the host of the public address', () => {
        expect(
          refused({
            ...PUBLIC_PLACEHOLDER_ENV,
            SWARM_PUBLIC_BASE_URL: 'https://swarm.example.com',
            SWARM_PUBLIC_CUSTOM_DOMAIN: 'swarm.example.com',
          }),
        ).toContain('customDomainHasACertificate');
        expect(
          refused({
            ...EVERYTHING,
            SWARM_PUBLIC_CUSTOM_DOMAIN: 'elsewhere.example.com',
          }),
        ).toContain('customDomainIsTheHostOfThePublicBaseUrl');
      }, 240_000);

      it('has a guard for each of these, and each one allows only true', () => {
        const guards = templates(main).find((one) =>
          isObj(get(one, 'parameters', 'atLeastOneSignInProviderIsConfigured')),
        );
        const names = Object.keys(get(guards, 'parameters') as Obj);
        expect(names.sort()).toEqual(
          [
            'aiAccountResourceIdIsAnAccountId',
            'atLeastOneSignInProviderIsConfigured',
            'containerImageIsGivenWhenTheAppIsDeployed',
            'customDomainHasACertificate',
            'customDomainIsTheHostOfThePublicBaseUrl',
            'freeDeploymentModelIsNotAReasoningFamily',
            'freeDeploymentNameIsNotAReasoningFamily',
            'ownerKeySha256IsEmptyOrSixtyFourHexDigits',
            'publicBaseUrlIsAnHttpsOriginWithoutPath',
            'resourceGroupAndEnvironmentAreNotThePilots',
          ].sort(),
        );
        for (const name of names)
          expect(get(guards, 'parameters', name, 'allowedValues')).toEqual([true]);
      });

      it('an image that is not from the registry of this deployment is refused when the app is made', () => {
        const module = templates(main).find((one) =>
          isObj(get(one, 'parameters', 'imageIsFromThisDeploymentsRegistry')),
        );
        expect(
          get(module, 'parameters', 'imageIsFromThisDeploymentsRegistry', 'allowedValues'),
        ).toEqual([true]);
        const expression = String(
          get(
            main,
            'resources',
            'app',
            'properties',
            'parameters',
            'imageIsFromThisDeploymentsRegistry',
            'value',
          ),
        );
        expect(expression).toContain("startsWith(parameters('containerImage')");
        expect(expression).toContain('loginServer');
      });
    });

    describe('secrets', () => {
      it('has no secret literal anywhere in the compiled templates', () => {
        const hits = strings(main).flatMap((text) =>
          SECRET_SHAPES.filter(([, shape]) => shape.test(text)).map(([name]) => name),
        );
        expect(hits).toEqual([]);
      });

      it('has nothing in its source that the repository credential scan would report', () => {
        const directory = join(REPO_ROOT, 'infra', 'public');
        const files = [
          'main.bicep',
          'main.bicepparam',
          ...readdirSync(join(directory, 'modules')).map((name) => join('modules', name)),
        ];
        const hits = files.flatMap((file) => {
          const text = readFileSync(join(directory, file), 'utf8');
          return SOURCE_SCAN.filter(([, shape]) => shape.test(text)).map(
            ([name]) => `${name}: ${file}`,
          );
        });
        expect(hits).toEqual([]);
      });

      it('has no secure parameter with a default, no output that could carry a secret, and no key listed', () => {
        let secure = 0;
        for (const one of templates(main)) {
          for (const [name, parameter] of Object.entries(
            isObj(one.parameters) ? one.parameters : {},
          )) {
            if (isObj(parameter) && /^secure/iu.test(String(parameter.type))) {
              secure += 1;
              expect(parameter, `${name} is secure and must have no default`).not.toHaveProperty(
                'defaultValue',
              );
            }
          }
          for (const [name, output] of Object.entries(isObj(one.outputs) ? one.outputs : {})) {
            // The whole output: a looped one has no `value`, only a `copy`.
            const expression = JSON.stringify(output);
            expect(expression, `output ${name}`).not.toMatch(
              /\blist(?:Keys|Secrets|AccountSas|ServiceSas|ConnectionStrings|Credentials)\b/iu,
            );
            expect(expression, `output ${name}`).not.toContain('opsKey');
            // The one allowed: the Application Insights connection string, which names the component and is useless
            // without an Entra token because the component has local authentication disabled (the pilot's monitoring module).
            if (name !== 'appInsightsConnectionString') {
              expect(name, `output ${name}`).not.toMatch(
                /password|secret|token|credential|apikey|accesskey|primarykey|secondarykey|sharedkey|connectionstring|ops_?key/iu,
              );
            }
          }
        }
        expect(secure).toBeGreaterThanOrEqual(2);
        expect(get(main, 'parameters', 'opsKey', 'type')).toBe('securestring');
        expect(get(main, 'parameters', 'opsKey', 'minLength')).toBeGreaterThanOrEqual(32);
        const components = resourcesOf(main).filter(
          (one) => one.type === 'Microsoft.Insights/components',
        );
        expect(components).toHaveLength(1);
        expect(get(components[0], 'properties', 'DisableLocalAuth')).toBe(true);
      });

      it('puts the webhook key in one place only: the web address of the action group that turns the free tier off', () => {
        const holders = resourcesOf(main).filter(
          (one) =>
            one.type !== 'Microsoft.Resources/deployments' &&
            JSON.stringify(one).includes('opsKey'),
        );
        expect(holders.map((one) => one.type)).toEqual(['Microsoft.Insights/actionGroups']);
        // The offline evaluation keeps it as a parameter reference and the placeholder is nowhere in it.
        for (const snapshot of [withApp, foundation, everything]) {
          expect(JSON.stringify(snapshot)).not.toContain(PLACEHOLDER_KEY);
        }
      });

      it('has no Key Vault secret resource, no storage account, and reads the workspace key only to wire logs', () => {
        const types = resourcesOf(main).map((one) => String(one.type));
        expect(
          types.filter((type) => /KeyVault\/vaults\/secrets|Storage\/storageAccounts/u.test(type)),
        ).toEqual([]);
        const holders = resourcesOf(main).filter(
          (one) =>
            one.type !== 'Microsoft.Resources/deployments' &&
            /\blistKeys\b/u.test(JSON.stringify(one)),
        );
        expect(holders.map((one) => one.type)).toEqual(['Microsoft.App/managedEnvironments']);
      });

      it('writes no GUID except the built-in role definitions', () => {
        const guids = new Set(
          strings(main)
            .flatMap((text) => text.match(GUID) ?? [])
            .map((guid) => guid.toLowerCase()),
        );
        expect(
          [...guids].filter((guid) => !ALLOWED_ROLES.has(guid) && !FORBIDDEN_ROLES.has(guid)),
        ).toEqual([]);
      });

      it('creates a Key Vault with RBAC, soft delete and purge protection, and no access policies', () => {
        const [vault] = ofType(predicted(withApp), 'Microsoft.KeyVault/vaults');
        expect(get(vault, 'properties', 'enableRbacAuthorization')).toBe(true);
        expect(get(vault, 'properties', 'enableSoftDelete')).toBe(true);
        expect(get(vault, 'properties', 'enablePurgeProtection')).toBe(true);
        expect(vault).not.toHaveProperty(['properties', 'accessPolicies']);
      });
    });

    describe('identity', () => {
      it('gives the application identity only the four roles it needs, each on one resource', () => {
        let assignments = 0;
        for (const template of templates(main)) {
          const variables = isObj(template.variables) ? template.variables : {};
          for (const assignment of ownResourcesOf(template).filter(
            (one) => one.type === 'Microsoft.Authorization/roleAssignments',
          )) {
            assignments += 1;
            const expression = String(get(assignment, 'properties', 'roleDefinitionId'));
            const variable = /variables\('([^']+)'\)/u.exec(expression)?.[1];
            const resolved = variable === undefined ? expression : String(variables[variable]);
            const role = resolved.match(GUID)?.[0]?.toLowerCase() ?? '';
            expect(
              FORBIDDEN_ROLES.get(role),
              `forbidden role ${FORBIDDEN_ROLES.get(role)}`,
            ).toBeUndefined();
            expect([...ALLOWED_ROLES.keys()], `unexpected role ${resolved}`).toContain(role);
            expect(get(assignment, 'properties', 'principalType')).toBe('ServicePrincipal');
            expect(typeof assignment.scope, 'role assignment scope').toBe('string');
            expect(String(assignment.scope)).not.toMatch(/resourceGroup\(\)/u);
          }
        }
        expect(assignments).toBeGreaterThanOrEqual(4);
      });

      it('makes exactly those four assignments in every profile, the model one on the account itself', () => {
        for (const snapshot of [withApp, foundation, everything, elsewhere]) {
          const roles = ofType(predicted(snapshot), 'Microsoft.Authorization/roleAssignments').map(
            (one) =>
              String(get(one, 'properties', 'roleDefinitionId'))
                .split('/')
                .pop(),
          );
          expect([...roles].sort()).toEqual([...ALLOWED_ROLES.keys()].sort());
        }
        const model = ofType(predicted(withApp), 'Microsoft.Authorization/roleAssignments').find(
          (one) =>
            String(get(one, 'properties', 'roleDefinitionId')).endsWith(
              '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd',
            ),
        );
        expect(String(model?.id)).toContain(
          '/resourceGroups/rg-example-ai/providers/Microsoft.CognitiveServices/accounts/ai-example/',
        );
        const other = ofType(predicted(elsewhere), 'Microsoft.Authorization/roleAssignments').find(
          (one) =>
            String(get(one, 'properties', 'roleDefinitionId')).endsWith(
              '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd',
            ),
        );
        expect(String(other?.id)).toContain(`${OTHER_SUBSCRIPTION}/resourceGroups/rg-other-ai/`);
      });
    });

    describe('the database', () => {
      it('is Entra-only and Burstable B1ms, requires TLS, and the application is its only administrator', () => {
        const [server] = ofType(predicted(withApp), 'Microsoft.DBforPostgreSQL/flexibleServers');
        expect(get(server, 'sku')).toEqual({ name: 'Standard_B1ms', tier: 'Burstable' });
        expect(get(server, 'properties', 'authConfig', 'passwordAuth')).toBe('Disabled');
        expect(get(server, 'properties', 'authConfig', 'activeDirectoryAuth')).toBe('Enabled');
        expect(JSON.stringify(server)).not.toMatch(/administratorLogin/iu);
        expect(
          Number(get(server, 'properties', 'backup', 'backupRetentionDays')),
        ).toBeGreaterThanOrEqual(7);
        const [secureTransport] = ofType(
          predicted(withApp),
          'Microsoft.DBforPostgreSQL/flexibleServers/configurations',
        );
        expect(get(secureTransport, 'properties', 'value')).toBe('ON');
        expect(
          ofType(predicted(withApp), 'Microsoft.DBforPostgreSQL/flexibleServers/administrators'),
        ).toHaveLength(1);
        const url = environmentOf(withApp).find((entry) => entry.name === 'DATABASE_URL');
        expect(String(url?.value)).toContain("'postgres://{0}@{1}:5432/{2}?sslmode=require'");
      });

      it('can be told to use a server that was restored, and then only adds the database to it: nothing of the server is touched', () => {
        const types = predicted(elsewhere).map((one) => String(one.type));
        expect(types.filter((type) => type.startsWith('Microsoft.DBforPostgreSQL/'))).toEqual([
          'Microsoft.DBforPostgreSQL/flexibleServers/databases',
        ]);
        const [database] = ofType(
          predicted(elsewhere),
          'Microsoft.DBforPostgreSQL/flexibleServers/databases',
        );
        expect(get(database, 'name')).toBe('psql-swarm-public-restored/swarm');
        // The default makes the server, its rule, its TLS setting and the administrator, and does not take a name.
        expect(get(main, 'parameters', 'existingDatabaseServerName', 'defaultValue')).toBe('');
        expect(types.includes('Microsoft.App/containerApps')).toBe(true);
      });
    });

    describe('the budget and the free-tier kill switch', () => {
      const budgetOf = (snapshot: Json) =>
        ofType(predicted(snapshot), 'Microsoft.Consumption/budgets')[0];
      const groupsOf = (snapshot: Json) =>
        ofType(predicted(snapshot), 'Microsoft.Insights/actionGroups');
      const notificationsOf = (snapshot: Json) =>
        Object.values(get(budgetOf(snapshot), 'properties', 'notifications') as Obj).filter(isObj);

      it('is a monthly budget with notices at 50, 80, 100 and 120 percent of actual cost, and says it is not a cap', () => {
        for (const snapshot of [withApp, foundation]) {
          expect(get(budgetOf(snapshot), 'properties', 'timeGrain')).toBe('Monthly');
          expect(get(budgetOf(snapshot), 'properties', 'amount')).toBe(100);
          const actual = notificationsOf(snapshot)
            .filter((one) => one.thresholdType === 'Actual')
            .map((one) => one.threshold);
          expect(actual).toEqual([50, 80, 100, 120]);
          expect(
            notificationsOf(snapshot).filter((one) => one.thresholdType === 'Forecasted'),
          ).toHaveLength(1);
          // Azure allows five.
          expect(notificationsOf(snapshot).length).toBeLessThanOrEqual(5);
          for (const one of notificationsOf(snapshot)) {
            expect(list(one.contactEmails).length).toBeGreaterThan(0);
            expect(list(one.contactGroups)).toHaveLength(1);
          }
        }
        // The amount is the owner's number: it has no default.
        expect(get(main, 'parameters', 'budgetAmount')).not.toHaveProperty('defaultValue');
        expect(get(main, 'parameters', 'budgetCurrencyLabel')).not.toHaveProperty('defaultValue');
        expect(String(get(main, 'parameters', 'budgetAmount', 'metadata', 'description'))).toMatch(
          /ALERTS: it does not stop spend/u,
        );
      });

      it('has an action group that e-mails AND calls the webhook that turns the free tier off, used from 100 percent', () => {
        const stop = groupsOf(withApp).find((one) => String(one.name).endsWith('-budget-stop'));
        const warn = groupsOf(withApp).find((one) => String(one.name).endsWith('-budget-warn'));
        expect(objects(get(stop, 'properties', 'emailReceivers')).length).toBeGreaterThanOrEqual(1);
        const [webhook, ...others] = objects(get(stop, 'properties', 'webhookReceivers'));
        expect(others).toEqual([]);
        const address = String(get(webhook, 'serviceUri'));
        expect(address).toContain("'https://{0}/api/ops/free-tier/off?key={1}'");
        // The default address of the app (known before the app exists), and the key as an encoded secure parameter.
        expect(address).toContain("'ca-swarm-public'");
        expect(address).toContain("uriComponent(parameters('opsKey'))");
        // A budget notice is not an Azure Monitor alert: the common alert schema does not apply to it.
        expect(get(webhook, 'useCommonAlertSchema')).toBe(false);
        // The warning group tells a person and does nothing else.
        expect(objects(get(warn, 'properties', 'emailReceivers')).length).toBeGreaterThanOrEqual(1);
        expect(get(warn, 'properties', 'webhookReceivers')).toBeUndefined();

        const byThreshold = Object.fromEntries(
          notificationsOf(withApp).map((one) => [
            `${String(one.thresholdType)}${String(one.threshold)}`,
            String(list(one.contactGroups)[0]),
          ]),
        );
        expect(byThreshold.Actual50).toContain('/actionGroups/ag-swarm-public-budget-warn');
        expect(byThreshold.Actual80).toContain('/actionGroups/ag-swarm-public-budget-warn');
        expect(byThreshold.Forecasted100).toContain('/actionGroups/ag-swarm-public-budget-warn');
        expect(byThreshold.Actual100).toContain('/actionGroups/ag-swarm-public-budget-stop');
        expect(byThreshold.Actual120).toContain('/actionGroups/ag-swarm-public-budget-stop');
      });

      it("counts this resource group and the model account's, when that is in this subscription", () => {
        const values = (snapshot: Json) =>
          get(budgetOf(snapshot), 'properties', 'filter', 'dimensions', 'values');
        expect(get(budgetOf(withApp), 'properties', 'filter', 'dimensions', 'name')).toBe(
          'ResourceGroupName',
        );
        expect(values(withApp)).toEqual(['rg-swarm-public', 'rg-example-ai']);
        expect(values(elsewhere)).toEqual(['rg-swarm-public']);
      });

      it('is made before the app, so that spend is watched from the first resource', () => {
        expect(ofType(predicted(foundation), 'Microsoft.Consumption/budgets')).toHaveLength(1);
        expect(groupsOf(foundation).map((one) => String(one.name))).toEqual([
          'ag-swarm-public-budget-warn',
          'ag-swarm-public-budget-stop',
        ]);
      });

      it('e-mails every address given, in the budget and in both groups', () => {
        const wanted = ['owner@example.invalid', 'second@example.invalid'];
        expect(
          notificationsOf(everything).every(
            (one) => list(one.contactEmails).join() === wanted.join(),
          ),
        ).toBe(true);
        for (const group of groupsOf(everything)) {
          expect(
            objects(get(group, 'properties', 'emailReceivers')).map((one) => one.emailAddress),
          ).toEqual(wanted);
        }
      });
    });

    describe('alerts', () => {
      const rulesOf = (snapshot: Json) =>
        ofType(predicted(snapshot), 'Microsoft.Insights/metricAlerts').map((rule) =>
          String(rule.name).replace('swarm-public-', ''),
        );

      it('covers errors, restarts and the database, and e-mails the operator through a group that cannot turn the free tier off', () => {
        for (const wanted of ['http-5xx', 'app-restarts', 'db-not-alive', 'db-cpu', 'db-storage']) {
          expect(rulesOf(withApp), wanted).toContain(wanted);
        }
        const groups = ofType(predicted(withApp), 'Microsoft.Insights/actionGroups');
        const ops = groups.find((one) => String(one.name).endsWith('-ops'));
        expect(get(ops, 'properties', 'webhookReceivers')).toBeUndefined();
        expect(
          objects(get(ops, 'properties', 'emailReceivers')).every(
            (one) => one.useCommonAlertSchema === true,
          ),
        ).toBe(true);
        for (const rule of ofType(predicted(withApp), 'Microsoft.Insights/metricAlerts')) {
          const targets = objects(get(rule, 'properties', 'actions')).map((action) =>
            String(action.actionGroupId),
          );
          expect(targets, String(rule.name)).toHaveLength(1);
          expect(targets[0], String(rule.name)).toContain('/actionGroups/ag-swarm-public-ops');
          expect(get(rule, 'properties', 'enabled'), String(rule.name)).toBe(true);
        }
      });

      it('does not alert on "no replica" when the app may scale to zero', () => {
        expect(rulesOf(withApp)).toContain('app-no-replicas');
        expect(rulesOf(everything)).not.toContain('app-no-replicas');
      });
    });

    describe('the parameter file', () => {
      const cli = () => bicep as BicepCli;

      it('compiles with the placeholder environment, in both phases', () => {
        for (const env of [PUBLIC_PLACEHOLDER_ENV, PUBLIC_FOUNDATION_ENV, EVERYTHING]) {
          const result = buildPublicParams(cli(), env);
          expect(result.diagnostics).toEqual([]);
          expect(result.status).toBe(0);
        }
      }, 120_000);

      it('has no default for deployApp: an unset variable stops the deployment, naming the variable', () => {
        expect(get(main, 'parameters', 'deployApp')).not.toHaveProperty('defaultValue');
        const result = buildPublicParams(cli(), PUBLIC_PLACEHOLDER_ENV, [
          'SWARM_PUBLIC_DEPLOY_APP',
        ]);
        expect(result.status).not.toBe(0);
        expect(JSON.stringify(result.diagnostics)).toContain('SWARM_PUBLIC_DEPLOY_APP');
      }, 120_000);

      it('stops the deployment before anything is created when any required value is missing', () => {
        expect(PUBLIC_REQUIRED_VARIABLES).toContain('SWARM_PUBLIC_BUDGET_AMOUNT');
        expect(PUBLIC_REQUIRED_VARIABLES).toContain('SWARM_PUBLIC_OPS_KEY');
        for (const name of PUBLIC_REQUIRED_VARIABLES) {
          const result = buildPublicParams(cli(), PUBLIC_PLACEHOLDER_ENV, [name]);
          expect(result.status, `${name} unset`).not.toBe(0);
        }
      }, 300_000);
    });
  },
);
