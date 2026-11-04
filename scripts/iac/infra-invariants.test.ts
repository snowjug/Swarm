import { beforeAll, describe, expect, it } from 'vitest';
import { PARAM_FILES, build, evaluate, findBicep, type BicepCli, type Json } from './bicep.mjs';

/**
 * Invariants of the Azure templates, asserted on what Bicep compiles (the ARM template) and on what it
 * evaluates offline (`bicep snapshot`: the resources a deployment of each parameter file WOULD create).
 * They need the Bicep CLI (scripts/iac/bicep.lock.json). Without it they are skipped with a visible
 * reason, except in CI, where a missing CLI fails the run: a gate that quietly stops running is not one.
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

function resourcesOf(template: Json | undefined): Obj[] {
  return templates(template).flatMap((one) => {
    const resources = one.resources;
    return objects(
      Array.isArray(resources) ? resources : isObj(resources) ? Object.values(resources) : [],
    );
  });
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

/** The built-in role definitions the application identity may hold, and why each is there. */
const ALLOWED_ROLES = new Map([
  ['7f951dda-4ed3-4680-a7ca-43fe172d538d', 'AcrPull: pull the image, scoped to the registry'],
  [
    '3913510d-42f4-4e42-8a64-420c390055eb',
    'Monitoring Metrics Publisher: send telemetry, scoped to the component',
  ],
  [
    '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd',
    'Cognitive Services OpenAI User: call the model, scoped to the account',
  ],
  [
    '4633458b-17de-408a-b874-0445c86b69e6',
    'Key Vault Secrets User: read secret values, scoped to the vault',
  ],
]);

/** Roles that would make the identity more than a caller of four named services. Listed so a mistake names itself. */
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

const IMAGE = `crexample.azurecr.io/swarm@sha256:${'0'.repeat(64)}`;
const SUBSCRIPTION = '/subscriptions/00000000-0000-0000-0000-000000000000';

const bicep: BicepCli | null = findBicep();
const strictRun = process.env.CI === 'true';
// `npm run test:postgres` runs the whole suite against PostgreSQL. These tests touch no database, and CI
// runs them in their own job (and in the quality job), so the PostgreSQL run leaves them out.
const postgresRun = Boolean(process.env.SWARM_TEST_DATABASE);

describe('the Bicep CLI', () => {
  it.skipIf(!strictRun || postgresRun)(
    'is installed in CI: a gate that cannot run must fail, not pass',
    () => {
      expect(bicep, 'Install it with: node scripts/iac/install-bicep.mjs').not.toBeNull();
    },
  );
  it.skipIf(!bicep || !strictRun || postgresRun)('is the pinned version in CI', () => {
    expect(bicep?.pinned).toBe(true);
  });
});

describe.skipIf(!bicep || postgresRun)(
  'infrastructure invariants (compiled and evaluated with Bicep, offline)',
  () => {
    let main: Json;
    let pilot: Json;
    let release: Json;
    let searching: Json;
    let production: Json;
    let existing: Json;

    beforeAll(() => {
      const cli = bicep as BicepCli;
      const built = build(cli, 'infra/pilot/main.bicep');
      expect(built.diagnostics).toEqual([]);
      main = built.json as Json;

      const run = (profile: keyof typeof PARAM_FILES, env: Record<string, string> = {}): Json => {
        const result = evaluate(cli, PARAM_FILES[profile], env);
        expect(result.diagnostics).toEqual([]);
        return result.snapshot as Json;
      };
      pilot = run('pilot');
      production = run('production-shaped');
      release = run('pilot', {
        SWARM_CONTAINER_IMAGE: IMAGE,
        SWARM_REVISION_SUFFIX: 'r-abc123',
        SWARM_TRAFFIC_MODE: 'split',
        SWARM_PREVIOUS_REVISION: 'ca-swarm-pilot--r-old999',
        SWARM_NEW_REVISION_TRAFFIC_PERCENT: '10',
        SWARM_KEYVAULT_SECRET_REFERENCES: JSON.stringify([
          { envName: 'AUTH_ENTRA_CLIENT_SECRET', secretName: 'swarm-client-secret' },
        ]),
      });
      searching = run('pilot', {
        SWARM_RESEARCH_SEARCH_PROVIDER: 'brave',
        SWARM_KEYVAULT_SECRET_REFERENCES: JSON.stringify([
          { envName: 'RESEARCH_SEARCH_API_KEY', secretName: 'swarm-search-key' },
        ]),
      });
      existing = run('pilot', {
        SWARM_EXISTING_WORKSPACE_ID: `${SUBSCRIPTION}/resourceGroups/rg-shared/providers/Microsoft.OperationalInsights/workspaces/log-shared`,
        SWARM_EXISTING_APPINSIGHTS_ID: `${SUBSCRIPTION}/resourceGroups/rg-shared/providers/Microsoft.Insights/components/appi-shared`,
        SWARM_EXISTING_REGISTRY_ID: `${SUBSCRIPTION}/resourceGroups/rg-shared/providers/Microsoft.ContainerRegistry/registries/crshared`,
        SWARM_EXISTING_POSTGRES_SERVER_ID: `${SUBSCRIPTION}/resourceGroups/rg-data/providers/Microsoft.DBforPostgreSQL/flexibleServers/psql-shared`,
        SWARM_EXISTING_KEYVAULT_ID: `${SUBSCRIPTION}/resourceGroups/rg-shared/providers/Microsoft.KeyVault/vaults/kv-shared`,
        SWARM_EXISTING_CONTAINER_APPS_ENVIRONMENT_ID: `${SUBSCRIPTION}/resourceGroups/rg-shared/providers/Microsoft.App/managedEnvironments/cae-shared`,
      });
    }, 240_000);

    describe('the database', () => {
      it('is Entra-only: password authentication is off and no administrator password exists', () => {
        for (const snapshot of [pilot, production]) {
          const [server] = ofType(predicted(snapshot), 'Microsoft.DBforPostgreSQL/flexibleServers');
          expect(get(server, 'properties', 'authConfig', 'passwordAuth')).toBe('Disabled');
          expect(get(server, 'properties', 'authConfig', 'activeDirectoryAuth')).toBe('Enabled');
          expect(JSON.stringify(server)).not.toMatch(/administratorLogin/iu);
        }
        const parameterNames = templates(main).flatMap((one) =>
          Object.keys(isObj(one.parameters) ? one.parameters : {}),
        );
        expect(parameterNames.filter((name) => /password|credential/iu.test(name))).toEqual([]);
      });

      it('sets the environment the hosted-start guard requires, so the app is never refused by its own template', () => {
        const names = (snapshot: Json): Record<string, unknown> =>
          Object.fromEntries(
            objects(
              get(
                ofType(predicted(snapshot), 'Microsoft.App/containerApps')[0],
                'properties',
                'template',
                'containers',
                0,
                'env',
              ),
            ).map((entry) => [String(entry.name), entry.value]),
          );
        const piloted = names(pilot);
        expect(piloted.DEPLOYMENT_MODE).toBe('pilot');
        expect(names(production).DEPLOYMENT_MODE).toBe('production');
        expect(String(names(production).DEPLOYMENT_LABEL).length).toBeGreaterThan(0);
        for (const snapshot of [piloted, names(production)]) {
          expect(snapshot).toMatchObject({
            AUTH_MODE: 'entra',
            DATABASE_AUTH: 'entra',
            AI_PROVIDER: 'foundry',
            FOUNDRY_AUTH: 'entra',
            TRUST_PROXY: '1',
            RATE_LIMIT_SCALE: '1',
            LOG_LEVEL: 'info',
          });
          for (const required of [
            'ALLOWED_HOSTS',
            'ALLOWED_ORIGINS',
            'AUTH_ENTRA_TENANT_ID',
            'AUTH_ENTRA_AUDIENCE',
            'AUTH_ENTRA_CLIENT_ID',
            'AUTH_ENTRA_REDIRECT_URI',
            'APPLICATIONINSIGHTS_CONNECTION_STRING',
            'FOUNDRY_ENDPOINT',
          ]) {
            expect(snapshot, required).toHaveProperty(required);
          }
          // No model key and no test seam can be in a hosted template.
          expect(
            Object.keys(snapshot).filter((name) => /API_KEY|^SWARM_TEST_|_TEST_/u.test(name)),
          ).toEqual([]);
        }
      });

      it('requires TLS from the server and from the connection string', () => {
        for (const snapshot of [pilot, production]) {
          const [secureTransport] = ofType(
            predicted(snapshot),
            'Microsoft.DBforPostgreSQL/flexibleServers/configurations',
          );
          expect(String(get(secureTransport, 'name'))).toContain('require_secure_transport');
          expect(get(secureTransport, 'properties', 'value')).toBe('ON');
        }
        const [app] = ofType(predicted(release), 'Microsoft.App/containerApps');
        const url = objects(get(app, 'properties', 'template', 'containers', 0, 'env')).find(
          (entry) => entry.name === 'DATABASE_URL',
        );
        // The host is only known to Azure, so the value is still an expression: what matters is its shape, a
        // user name and no password slot, the standard port, and sslmode=require.
        expect(String(url?.value)).toContain("'postgres://{0}@{1}:5432/{2}?sslmode=require'");
      });

      it('keeps a restore window, and the production shape adds HA, geo-redundant backups and private access', () => {
        const [piloted] = ofType(predicted(pilot), 'Microsoft.DBforPostgreSQL/flexibleServers');
        expect(
          Number(get(piloted, 'properties', 'backup', 'backupRetentionDays')),
        ).toBeGreaterThanOrEqual(7);
        expect(get(piloted, 'properties', 'maintenanceWindow', 'customWindow')).toBe('Enabled');

        const [shaped] = ofType(predicted(production), 'Microsoft.DBforPostgreSQL/flexibleServers');
        expect(get(shaped, 'properties', 'backup', 'geoRedundantBackup')).toBe('Enabled');
        expect(get(shaped, 'properties', 'backup', 'backupRetentionDays')).toBe(35);
        expect(get(shaped, 'properties', 'highAvailability', 'mode')).toBe('ZoneRedundant');
        expect(get(shaped, 'properties', 'network', 'publicNetworkAccess')).toBe('Disabled');
        expect(
          ofType(predicted(production), 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules'),
        ).toEqual([]);
        expect(
          ofType(predicted(pilot), 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules'),
        ).toHaveLength(1);
      });
    });

    describe('secrets', () => {
      it('has no secret literal anywhere in the compiled templates', () => {
        const all = strings(main);
        const hits = all.flatMap((text) =>
          SECRET_SHAPES.filter(([, shape]) => shape.test(text)).map(([name]) => name),
        );
        expect(hits).toEqual([]);
      });

      it('has no secure parameter with a default and no output that could carry a secret', () => {
        for (const one of templates(main)) {
          for (const [name, parameter] of Object.entries(
            isObj(one.parameters) ? one.parameters : {},
          )) {
            if (isObj(parameter) && /^secure/iu.test(String(parameter.type))) {
              expect(parameter, `${name} is secure and must have no default`).not.toHaveProperty(
                'defaultValue',
              );
            }
          }
          for (const [name, output] of Object.entries(isObj(one.outputs) ? one.outputs : {})) {
            const expression = JSON.stringify(get(output, 'value'));
            expect(expression, `output ${name}`).not.toMatch(
              /\blist(?:Keys|Secrets|AccountSas|ServiceSas|ConnectionStrings|Credentials)\b/iu,
            );
            // The one allowed: the Application Insights connection string, which names the component and is
            // useless without an Entra token because the component has local authentication disabled.
            if (name !== 'appInsightsConnectionString') {
              expect(name, `output ${name}`).not.toMatch(
                /password|secret|token|credential|apikey|accesskey|primarykey|secondarykey|sharedkey|connectionstring/iu,
              );
            }
          }
        }
        const components = resourcesOf(main).filter(
          (one) => one.type === 'Microsoft.Insights/components',
        );
        expect(components).toHaveLength(1);
        expect(get(components[0], 'properties', 'DisableLocalAuth')).toBe(true);
      });

      it('reads the workspace key only to wire logs, inside the environment resource', () => {
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
        const unknown = [...guids].filter(
          (guid) => !ALLOWED_ROLES.has(guid) && !FORBIDDEN_ROLES.has(guid),
        );
        expect(unknown).toEqual([]);
      });

      it('keeps a Key Vault secret as a reference: no value, a vault URL and the identity', () => {
        const [app] = ofType(predicted(release), 'Microsoft.App/containerApps');
        const secrets = objects(get(app, 'properties', 'configuration', 'secrets'));
        expect(secrets).toHaveLength(1);
        for (const secret of secrets) {
          expect(secret).not.toHaveProperty('value');
          expect(String(secret.keyVaultUrl)).toMatch(/secrets\/.*swarm-client-secret/u);
          expect(String(secret.identity)).toContain('userAssignedIdentities/id-swarm-pilot');
        }
        const env = objects(get(app, 'properties', 'template', 'containers', 0, 'env'));
        expect(env.find((entry) => entry.name === 'AUTH_ENTRA_CLIENT_SECRET')).toEqual({
          name: 'AUTH_ENTRA_CLIENT_SECRET',
          secretRef: 'auth-entra-client-secret',
        });
        // The application refuses a client secret and a client assertion together.
        expect(env.find((entry) => entry.name === 'AUTH_ENTRA_CLIENT_ASSERTION')).toBeUndefined();
        expect(ofType(predicted(release), 'Microsoft.KeyVault/vaults')).toHaveLength(1);
      });

      it('has no search unless it is chosen, and keeps the key of one as a Key Vault reference and never as a value', () => {
        const environment = (snapshot: Json): Obj[] =>
          objects(
            get(
              ofType(predicted(snapshot), 'Microsoft.App/containerApps')[0],
              'properties',
              'template',
              'containers',
              0,
              'env',
            ),
          );
        const named = (snapshot: Json, name: string) =>
          environment(snapshot).filter((entry) => entry.name === name);
        for (const snapshot of [pilot, production]) {
          expect(named(snapshot, 'RESEARCH_SEARCH_PROVIDER')).toEqual([
            { name: 'RESEARCH_SEARCH_PROVIDER', value: 'none' },
          ]);
          expect(
            environment(snapshot).filter((entry) =>
              /^RESEARCH_SEARCH_(API_KEY|ENDPOINT)$/u.test(String(entry.name)),
            ),
          ).toEqual([]);
        }
        expect(named(searching, 'RESEARCH_SEARCH_PROVIDER')).toEqual([
          { name: 'RESEARCH_SEARCH_PROVIDER', value: 'brave' },
        ]);
        expect(named(searching, 'RESEARCH_SEARCH_API_KEY')).toEqual([
          { name: 'RESEARCH_SEARCH_API_KEY', secretRef: 'research-search-api-key' },
        ]);
        const [app] = ofType(predicted(searching), 'Microsoft.App/containerApps');
        const secrets = objects(get(app, 'properties', 'configuration', 'secrets'));
        expect(secrets).toHaveLength(1);
        for (const secret of secrets) {
          expect(secret).not.toHaveProperty('value');
          expect(String(secret.keyVaultUrl)).toMatch(/secrets\/.*swarm-search-key/u);
        }
        // The address of a provider is a test seam: a template has no way to set it, so a key goes nowhere else.
        expect(
          environment(searching).filter((entry) => entry.name === 'RESEARCH_SEARCH_ENDPOINT'),
        ).toEqual([]);
      });

      it('has no Key Vault secret resource and no public blob storage', () => {
        const types = resourcesOf(main).map((one) => String(one.type));
        expect(
          types.filter((type) => /KeyVault\/vaults\/secrets|Storage\/storageAccounts/u.test(type)),
        ).toEqual([]);
      });

      it('creates a Key Vault with RBAC, soft delete and purge protection, and no access policies', () => {
        const [vault] = ofType(predicted(production), 'Microsoft.KeyVault/vaults');
        expect(get(vault, 'properties', 'enableRbacAuthorization')).toBe(true);
        expect(get(vault, 'properties', 'enableSoftDelete')).toBe(true);
        expect(get(vault, 'properties', 'enablePurgeProtection')).toBe(true);
        expect(vault).not.toHaveProperty(['properties', 'accessPolicies']);
        expect(ofType(predicted(pilot), 'Microsoft.KeyVault/vaults')).toEqual([]);
      });

      it('disables the registry admin user and anonymous pull', () => {
        for (const snapshot of [pilot, production]) {
          const [registry] = ofType(predicted(snapshot), 'Microsoft.ContainerRegistry/registries');
          expect(get(registry, 'properties', 'adminUserEnabled')).toBe(false);
          expect(get(registry, 'properties', 'anonymousPullEnabled')).toBe(false);
        }
      });
    });

    describe('identity', () => {
      it('gives the application identity only the four roles it needs, each on one resource', () => {
        let assignments = 0;
        for (const template of templates(main)) {
          const variables = isObj(template.variables) ? template.variables : {};
          const resources = template.resources;
          const items = Array.isArray(resources)
            ? resources
            : isObj(resources)
              ? Object.values(resources)
              : [];
          for (const assignment of objects(items).filter(
            (one) => one.type === 'Microsoft.Authorization/roleAssignments',
          )) {
            assignments += 1;
            // The role is a variable of the template that makes the assignment, or a literal.
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
            // A role assignment with no scope property is made on the resource group, which is broader than one resource.
            expect(typeof assignment.scope, 'role assignment scope').toBe('string');
            expect(String(assignment.scope)).not.toMatch(/resourceGroup\(\)/u);
          }
        }
        expect(assignments).toBeGreaterThanOrEqual(4);
      });

      it('makes the same four assignments in the predicted deployment of both profiles', () => {
        for (const snapshot of [pilot, production]) {
          const roles = ofType(predicted(snapshot), 'Microsoft.Authorization/roleAssignments').map(
            (one) =>
              String(get(one, 'properties', 'roleDefinitionId'))
                .split('/')
                .pop(),
          );
          expect(roles).toContain('7f951dda-4ed3-4680-a7ca-43fe172d538d');
          expect(roles).toContain('3913510d-42f4-4e42-8a64-420c390055eb');
          expect(roles).toContain('5e0bd9bd-7b93-4f28-af87-19fc36ad61bd');
          for (const role of roles) expect([...ALLOWED_ROLES.keys()]).toContain(role);
        }
      });
    });

    describe('the container app', () => {
      const appOf = (snapshot: Json) =>
        ofType(predicted(snapshot), 'Microsoft.App/containerApps')[0];

      it('runs in multiple-revision mode so that a release is blue/green and rollback is a traffic change', () => {
        const compiled = resourcesOf(main).find(
          (one) => one.type === 'Microsoft.App/containerApps' && !one.existing,
        );
        expect(get(compiled, 'properties', 'configuration', 'activeRevisionsMode')).toBe(
          'Multiple',
        );
        for (const snapshot of [pilot, production, release]) {
          expect(get(appOf(snapshot), 'properties', 'configuration', 'activeRevisionsMode')).toBe(
            'Multiple',
          );
        }
      });

      it('can never be scaled to zero: the job runner is embedded and stops with the replica', () => {
        const minimums = templates(main).flatMap((one) => {
          const parameter = get(one, 'parameters', 'minReplicas');
          return parameter ? [Number(get(parameter, 'minValue'))] : [];
        });
        expect(minimums.length).toBeGreaterThanOrEqual(2);
        for (const minimum of minimums) expect(minimum).toBeGreaterThanOrEqual(1);
        for (const snapshot of [pilot, production, release]) {
          expect(
            Number(get(appOf(snapshot), 'properties', 'template', 'scale', 'minReplicas')),
          ).toBeGreaterThanOrEqual(1);
        }
      });

      it('has startup, liveness and readiness probes on the health routes once a real image runs', () => {
        const probes = objects(
          get(appOf(release), 'properties', 'template', 'containers', 0, 'probes'),
        );
        expect(probes.map((probe) => probe.type)).toEqual(['Startup', 'Liveness', 'Readiness']);
        const port = get(appOf(release), 'properties', 'configuration', 'ingress', 'targetPort');
        expect(port).toBe(3001);
        for (const probe of probes) {
          expect(get(probe, 'httpGet', 'port')).toBe(port);
          expect(['/api/health/live', '/api/health/ready']).toContain(
            get(probe, 'httpGet', 'path'),
          );
        }
        expect(get(probes[2], 'httpGet', 'path')).toBe('/api/health/ready');
      });

      it('starts the placeholder image on its own port with no probe, so the first provision can succeed', () => {
        const app = appOf(pilot);
        expect(get(app, 'properties', 'template', 'containers', 0, 'image')).toContain(
          'containerapps-helloworld',
        );
        expect(get(app, 'properties', 'configuration', 'ingress', 'targetPort')).toBe(80);
        expect(get(app, 'properties', 'template', 'containers', 0, 'probes')).toEqual([]);
      });

      it('accepts HTTPS only', () => {
        for (const snapshot of [pilot, production, release]) {
          expect(
            get(appOf(snapshot), 'properties', 'configuration', 'ingress', 'allowInsecure'),
          ).toBe(false);
          expect(get(appOf(snapshot), 'properties', 'configuration', 'ingress', 'external')).toBe(
            true,
          );
        }
      });

      it('sends a release to the new revision at the share asked for and keeps the previous one warm', () => {
        const traffic = objects(
          get(appOf(release), 'properties', 'configuration', 'ingress', 'traffic'),
        );
        expect(traffic).toEqual([
          { revisionName: 'ca-swarm-pilot--r-abc123', weight: 10, label: 'green' },
          { revisionName: 'ca-swarm-pilot--r-old999', weight: 90, label: 'blue' },
        ]);
        expect(get(appOf(release), 'properties', 'template', 'revisionSuffix')).toBe('r-abc123');
        expect(get(appOf(release), 'properties', 'template', 'containers', 0, 'image')).toBe(IMAGE);
      });

      it('starts a first deployment on the newest revision', () => {
        expect(
          objects(get(appOf(pilot), 'properties', 'configuration', 'ingress', 'traffic')),
        ).toEqual([{ latestRevision: true, weight: 100 }]);
      });
    });

    describe('every resource is accounted for', () => {
      it('tags everything that can be tagged, in both profiles', () => {
        for (const snapshot of [pilot, production, existing]) {
          for (const resource of predicted(snapshot)) {
            if (UNTAGGED_TYPES.has(String(resource.type))) continue;
            const tags = get(resource, 'tags');
            expect(isObj(tags), `${String(resource.type)} ${String(resource.name)} has tags`).toBe(
              true,
            );
            expect(get(tags, 'app'), String(resource.type)).toBe('swarm-lab');
            expect(get(tags, 'managedBy'), String(resource.type)).toBe('bicep');
            expect(get(tags, 'purpose'), String(resource.type)).toBe('pilot');
            expect(get(tags, 'stage'), String(resource.type)).toBe(
              'production-candidate-controlled-pilot',
            );
          }
        }
      });

      it('creates nothing for what already exists, only the one role assignment each needs', () => {
        const types = predicted(existing).map((one) => String(one.type));
        for (const created of [
          'Microsoft.OperationalInsights/workspaces',
          'Microsoft.Insights/components',
          'Microsoft.ContainerRegistry/registries',
          'Microsoft.DBforPostgreSQL/flexibleServers',
          'Microsoft.KeyVault/vaults',
          'Microsoft.App/managedEnvironments',
        ]) {
          expect(types, created).not.toContain(created);
        }
        // The shared server only gains a database: its administrators, firewall and settings are not touched.
        expect(types.filter((type) => type.startsWith('Microsoft.DBforPostgreSQL/'))).toEqual([
          'Microsoft.DBforPostgreSQL/flexibleServers/databases',
        ]);
        expect(
          types.filter((type) => type === 'Microsoft.Authorization/roleAssignments'),
        ).toHaveLength(4);
        const [app] = ofType(predicted(existing), 'Microsoft.App/containerApps');
        expect(String(get(app, 'properties', 'environmentId'))).toContain(
          '/managedEnvironments/cae-shared',
        );
      });

      it('creates no network unless it is asked for, and then integrates the environment and the database', () => {
        expect(
          predicted(pilot).filter((one) => String(one.type).startsWith('Microsoft.Network/')),
        ).toEqual([]);
        const types = predicted(production).map((one) => String(one.type));
        for (const wanted of [
          'Microsoft.Network/virtualNetworks',
          'Microsoft.Network/privateDnsZones',
          'Microsoft.Network/natGateways',
        ]) {
          expect(types).toContain(wanted);
        }
        const [environment] = ofType(predicted(production), 'Microsoft.App/managedEnvironments');
        expect(
          String(get(environment, 'properties', 'vnetConfiguration', 'infrastructureSubnetId')),
        ).toContain('/subnets/snet-app');
        expect(get(environment, 'properties', 'zoneRedundant')).toBe(true);
        expect(
          get(
            ofType(predicted(pilot), 'Microsoft.App/managedEnvironments')[0],
            'properties',
            'vnetConfiguration',
          ),
        ).toBeNull();
      });
    });

    describe('alerts and budget', () => {
      it('e-mails the operator and routes every rule to that action group', () => {
        for (const snapshot of [pilot, production]) {
          const [group] = ofType(predicted(snapshot), 'Microsoft.Insights/actionGroups');
          const receivers = objects(get(group, 'properties', 'emailReceivers'));
          expect(receivers.length).toBeGreaterThanOrEqual(1);
          const groupId = String(get(group, 'name'));
          const rules = [
            ...ofType(predicted(snapshot), 'Microsoft.Insights/metricAlerts'),
            ...ofType(predicted(snapshot), 'Microsoft.Insights/scheduledQueryRules'),
          ];
          expect(rules.length).toBeGreaterThanOrEqual(15);
          for (const rule of rules) {
            const targets = [
              ...objects(get(rule, 'properties', 'actions')).map((action) =>
                String(action.actionGroupId),
              ),
              ...list(get(rule, 'properties', 'actions', 'actionGroups')).map(String),
            ];
            expect(targets.length, String(rule.name)).toBeGreaterThan(0);
            for (const target of targets)
              expect(target, String(rule.name)).toContain(`/actionGroups/${groupId}`);
          }
        }
      });

      it('covers the failure modes the pilot is operated against', () => {
        const names = [
          ...ofType(predicted(pilot), 'Microsoft.Insights/metricAlerts'),
          ...ofType(predicted(pilot), 'Microsoft.Insights/scheduledQueryRules'),
        ].map((rule) => String(rule.name).replace('swarm-pilot-', ''));
        for (const wanted of [
          'app-no-replicas',
          'http-5xx',
          'request-volume',
          'app-restarts',
          'db-not-alive',
          'db-connections',
          'db-storage',
          'readiness-failing',
          'latency-p95',
          'model-failures',
          'model-schema-failures',
          'crawler-safety-blocks',
          'token-spend',
          'refused-requests',
          'telemetry-missing',
        ]) {
          expect(names, wanted).toContain(wanted);
        }
      });

      it('leaves the crawler alert disabled while the application does not emit the signal it reads', () => {
        const rules = ofType(predicted(pilot), 'Microsoft.Insights/scheduledQueryRules');
        const crawler = rules.find((rule) => String(rule.name).endsWith('crawler-safety-blocks'));
        expect(get(crawler, 'properties', 'enabled')).toBe(false);
        for (const rule of rules.filter((one) => one !== crawler)) {
          expect(get(rule, 'properties', 'enabled'), String(rule.name)).toBe(true);
        }
      });

      it('notifies at 50, 80 and 100 percent of actual cost, and says it is a budget, not a cap', () => {
        const [budget] = ofType(predicted(pilot), 'Microsoft.Consumption/budgets');
        const notifications = Object.values(
          get(budget, 'properties', 'notifications') as Obj,
        ).filter(isObj);
        const actual = notifications
          .filter((one) => one.thresholdType === 'Actual')
          .map((one) => one.threshold);
        expect(actual).toEqual([50, 80, 100]);
        expect(notifications.some((one) => one.thresholdType === 'Forecasted')).toBe(true);
        for (const one of notifications) expect(list(one.contactEmails).length).toBeGreaterThan(0);
        expect(get(budget, 'properties', 'timeGrain')).toBe('Monthly');
      });
    });
  },
);
