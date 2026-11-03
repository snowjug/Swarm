import { AzError, sanitizeAzOutput, type AzClient } from './az.js';
import {
  buildCostPlan,
  PROFILES,
  renderCostPlan,
  type CostPlan,
  type PriceSnapshot,
  type Profile,
} from './cost-plan.js';
import { isNoSession, MutationRefused, readOnlyAz } from './readonly-az.js';

/**
 * The pre-flight: what the Azure subscription already has, what a provisioning run would need, and what it
 * would cost. It is READ-ONLY (every `az` call goes through readonly-az.ts, which refuses anything else),
 * it needs only a signed-in `az`, and it degrades honestly: whatever it cannot read is reported as
 * unknown, never guessed. With no Azure session at all it still renders the cost plan and says so.
 *
 * Provisioning itself is never started from here. It needs an owner: an authenticated `az` session or a
 * service principal / managed identity with the roles listed in docs/production/azure-preflight.md.
 */

export type FindingStatus = 'ok' | 'attention' | 'blocked' | 'unknown';

export interface Finding {
  id: string;
  title: string;
  status: FindingStatus;
  details: string[];
}

export interface ReuseCandidate {
  kind:
    'foundry' | 'postgres' | 'registry' | 'keyvault' | 'workspace' | 'appinsights' | 'environment';
  name: string;
  resourceGroup: string;
  location: string;
  id: string;
  note: string;
}

export interface PreflightOptions {
  /** Subscription to inspect; empty uses the active one and says so. */
  subscription: string | undefined;
  region: string;
  fallbackRegion: string;
  profile: Profile;
  /** Skip every `az` call: only the cost plan. */
  offline: boolean;
  /** Print full identifiers instead of masking GUIDs. */
  showIds: boolean;
}

export interface PreflightReport {
  mode: 'inspected' | 'offline';
  generatedOn: string;
  options: PreflightOptions;
  findings: Finding[];
  reuse: ReuseCandidate[];
  costPlans: CostPlan[];
  /** The `az` commands that ran, in order. All of them reads. */
  azCalls: string[];
  owner: string[];
}

export interface PreflightDeps {
  az: AzClient;
  now: () => Date;
  snapshot: PriceSnapshot;
  /** Files under a repository folder, relative to the repository root. */
  listRepoFiles: (folder: string) => string[];
}

/** Namespaces the templates deploy resources of. */
export const REQUIRED_PROVIDERS = [
  'Microsoft.App',
  'Microsoft.OperationalInsights',
  'Microsoft.ContainerRegistry',
  'Microsoft.DBforPostgreSQL',
  'Microsoft.Insights',
  'Microsoft.ManagedIdentity',
  'Microsoft.KeyVault',
  'Microsoft.Consumption',
  'Microsoft.Network',
  'Microsoft.CognitiveServices',
] as const;

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const ROLES_THAT_ASSIGN = new Set([
  'Owner',
  'User Access Administrator',
  'Role Based Access Control Administrator',
]);

export function mask(text: string, showIds: boolean): string {
  return showIds ? text : text.replace(GUID, (guid) => `${guid.slice(0, 8)}…`);
}

type Rows = Record<string, unknown>[];

const asText = (value: unknown, fallback = '?'): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;
const asRows = (value: unknown): Rows =>
  Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    : [];

function reason(error: unknown): string {
  return error instanceof AzError ? sanitizeAzOutput(error.message, 240) : 'the call failed';
}

export async function runPreflight(
  options: PreflightOptions,
  deps: PreflightDeps,
): Promise<PreflightReport> {
  const az = readOnlyAz(deps.az);
  const findings: Finding[] = [];
  const reuse: ReuseCandidate[] = [];
  const say = (text: string) => mask(text, options.showIds);
  const costPlans = [options.region, options.fallbackRegion]
    .filter((region, index, all) => all.indexOf(region) === index)
    .map((region) => buildCostPlan(deps.snapshot, { region, profile: options.profile }));

  const finish = (mode: PreflightReport['mode']): PreflightReport => ({
    mode,
    generatedOn: deps.now().toISOString().slice(0, 10),
    options,
    findings,
    reuse,
    costPlans,
    azCalls: az.calls.map((call) => call.join(' ')),
    owner: ownerActions(),
  });

  const add = (id: string, title: string, status: FindingStatus, details: string[]) =>
    findings.push({ id, title, status, details: details.map(say) });

  /** One check that may fail without ending the run: an unreadable fact is "unknown", not an error. */
  let sessionLost = false;
  const check = async (id: string, title: string, work: () => Promise<void>) => {
    if (sessionLost) return;
    try {
      await work();
    } catch (error) {
      if (error instanceof MutationRefused) throw error;
      if (isNoSession(error)) {
        sessionLost = true;
        add('azure-session-ended', 'Azure session ended', 'blocked', [
          `The session ended during the inspection (at "${title}"). The checks after it did not run. Sign in again with \`az login\` and re-run.`,
        ]);
        return;
      }
      add(id, title, 'unknown', [`Could not read this: ${reason(error)}`]);
    }
  };

  add('repository', 'Bicep in this repository', ...repositoryFinding(deps.listRepoFiles));

  if (options.offline) {
    add('azure-session', 'Azure session', 'unknown', [
      'Offline mode (--offline): no Azure call was made, so nothing about the subscription was inspected.',
    ]);
    return finish('offline');
  }

  let subscriptionId = options.subscription;
  try {
    const account = await az.json<Record<string, unknown>>([
      'account',
      'show',
      ...(options.subscription ? ['--subscription', options.subscription] : []),
    ]);
    subscriptionId = asText(account.id, options.subscription ?? '');
    const user = (account.user ?? {}) as Record<string, unknown>;
    const enabled = String(account.state ?? '').toLowerCase() === 'enabled';
    add('azure-session', 'Azure session', enabled ? 'ok' : 'blocked', [
      `Signed in as a ${asText(user.type, 'principal')} (${asText(user.name)}).`,
      `Subscription "${asText(account.name)}" (${subscriptionId}), state ${asText(account.state)}${options.subscription ? '' : ' - the ACTIVE default, not one you chose: pass --subscription to be certain'}.`,
      `Tenant ${asText(account.tenantId)}.`,
    ]);
  } catch (error) {
    if (isNoSession(error)) {
      add('azure-session', 'Azure session', 'blocked', [
        'No usable Azure session: `az` is not installed or not signed in. Nothing was inspected.',
        'Provisioning needs an owner: run `az login`, or give a service principal or managed identity the roles listed in docs/production/azure-preflight.md.',
      ]);
      return finish('offline');
    }
    throw error;
  }
  const sub = subscriptionId ?? '';

  await check('offer', 'Subscription offer, spending limit and credit', async () => {
    const policy = await az.json<Record<string, unknown>>([
      'rest',
      '--method',
      'get',
      '--url',
      `https://management.azure.com/subscriptions/${sub}?api-version=2022-12-01`,
    ]);
    const policies = (policy.subscriptionPolicies ?? {}) as Record<string, unknown>;
    const quota = asText(policies.quotaId);
    const limit = asText(policies.spendingLimit);
    const details = [
      `Offer quota id ${quota}${/MSDN|DevTest/iu.test(quota) ? ' (a Visual Studio / dev-test offer)' : ''}.`,
      limit === 'On'
        ? 'Spending limit is ON: Azure disables resources when the monthly credit is used up. That is a hard stop, and a disabled database or app is an outage.'
        : limit === 'Off'
          ? 'Spending limit is OFF: spending continues past the credit and is billed to whatever payment method the subscription has.'
          : `Spending limit state: ${limit}.`,
    ];
    let status: FindingStatus = limit === 'On' ? 'attention' : 'ok';
    try {
      const budgets = asRows(await az.json<unknown>(['consumption', 'budget', 'list']));
      if (budgets.length === 0) details.push('No budget is defined on the subscription.');
      for (const budget of budgets) {
        const spend = (budget.currentSpend ?? {}) as Record<string, unknown>;
        details.push(
          `Budget "${asText(budget.name)}": ${String(budget.amount ?? '?')} per ${asText(budget.timeGrain)}; month to date ${String(spend.amount ?? 'not reported')} ${asText(spend.unit, '')}. A budget alerts; it does not stop spending.`,
        );
      }
    } catch (error) {
      details.push(`Budgets could not be read: ${reason(error)}`);
      status = status === 'attention' ? status : 'unknown';
    }
    details.push(
      'The remaining Visual Studio credit and the real spend so far CANNOT be read from here: no `az` command is known to return the credit balance of this kind of subscription, and this session may not have billing rights. Read them in the Azure portal (Cost Management + Billing, Credits) before approving anything.',
    );
    add('offer', 'Subscription offer, spending limit and credit', status, details);
  });

  await check('resource-groups', 'Resource groups', async () => {
    const groups = asRows(
      await az.json<unknown>([
        'group',
        'list',
        '--query',
        '[].{name:name,location:location,tags:tags}',
      ]),
    );
    const tagged = groups.filter(
      (group) => (group.tags as Record<string, unknown> | null)?.app === 'swarm-lab',
    );
    add('resource-groups', 'Resource groups', 'ok', [
      `${groups.length} resource group(s); ${tagged.length} tagged app=swarm-lab: ${tagged.map((group) => `${asText(group.name)} (${asText(group.location)})`).join(', ') || 'none'}.`,
      'Deploy into a NEW group dedicated to the pilot, so that deleting it removes the pilot and nothing else.',
    ]);
  });

  await check('foundry', 'Foundry / Azure OpenAI accounts and deployments', async () => {
    const accounts = asRows(
      await az.json<unknown>([
        'cognitiveservices',
        'account',
        'list',
        '--query',
        '[?kind==`AIServices` || kind==`OpenAI`].{name:name,kind:kind,location:location,resourceGroup:resourceGroup,id:id,localAuthDisabled:properties.disableLocalAuth}',
      ]),
    );
    const details: string[] = [];
    for (const account of accounts) {
      const name = asText(account.name);
      const group = asText(account.resourceGroup);
      reuse.push({
        kind: 'foundry',
        name,
        resourceGroup: group,
        location: asText(account.location),
        id: asText(account.id),
        note: `SWARM_AI_ACCOUNT_RESOURCE_ID; keys ${account.localAuthDisabled === true ? 'disabled (Entra only)' : 'not disabled'}`,
      });
      let deployments = 'deployments could not be listed';
      try {
        const rows = asRows(
          await az.json<unknown>([
            'cognitiveservices',
            'account',
            'deployment',
            'list',
            '--name',
            name,
            '--resource-group',
            group,
            '--query',
            '[].{name:name,model:properties.model.name,version:properties.model.version,sku:sku.name,capacity:sku.capacity}',
          ]),
        );
        deployments = rows.length
          ? rows
              .map(
                (row) =>
                  `${asText(row.name)} = ${asText(row.model)} ${asText(row.version)} (${asText(row.sku)}, capacity ${asText(String(row.capacity))})`,
              )
              .join('; ')
          : 'no deployment';
      } catch (error) {
        deployments = `deployments could not be listed: ${reason(error)}`;
      }
      details.push(
        `${name} (${asText(account.kind)}, ${asText(account.location)}, group ${group}): ${deployments}.`,
      );
    }
    add(
      'foundry',
      'Foundry / Azure OpenAI accounts and deployments',
      accounts.length === 0 ? 'attention' : 'ok',
      accounts.length === 0
        ? [
            'No Foundry or Azure OpenAI account is visible. The template REFERENCES an existing account (aiAccountResourceId) and never creates one: create it with `npm run azure:provision` first.',
          ]
        : details,
    );
  });

  await check('quota', `Model quota in ${options.region}`, async () => {
    const usages = asRows(
      await az.json<unknown>([
        'cognitiveservices',
        'usage',
        'list',
        '--location',
        options.region,
        '--query',
        '[].{name:name.value,current:currentValue,limit:limit}',
      ]),
    );
    const interesting = usages
      .filter((usage) => /OpenAI|AIServices|gpt/iu.test(String(usage.name)))
      .slice(0, 8);
    add('quota', `Model quota in ${options.region}`, 'ok', [
      interesting.length
        ? `${interesting.map((usage) => `${asText(usage.name)} ${asText(String(usage.current))}/${asText(String(usage.limit))}`).join('; ')}.`
        : `No model quota line is listed for ${options.region}: the model stays where the existing account is.`,
      'The pilot makes no new deployment, so this only matters if the model is moved.',
    ]);
  });

  await check('providers', 'Resource providers registered', async () => {
    const registered = new Set(
      asRows(
        await az.json<unknown>([
          'provider',
          'list',
          '--query',
          '[?registrationState==`Registered`].{namespace:namespace}',
        ]),
      ).map((row) => String(row.namespace).toLowerCase()),
    );
    const missing = REQUIRED_PROVIDERS.filter((name) => !registered.has(name.toLowerCase()));
    add(
      'providers',
      'Resource providers registered',
      missing.length ? 'attention' : 'ok',
      missing.length
        ? [
            `Not registered: ${missing.join(', ')}. Registering one changes the subscription (an owner action): az provider register --namespace <name>.`,
          ]
        : [`All ${REQUIRED_PROVIDERS.length} namespaces the templates use are registered.`],
    );
  });

  for (const region of [options.region, options.fallbackRegion].filter(
    (r, i, all) => all.indexOf(r) === i,
  )) {
    await check(`region-${region}`, `Region ${region}`, async () => {
      const locations = asRows(
        await az.json<unknown>([
          'account',
          'list-locations',
          '--query',
          `[?name=='${region}'].{name:name,displayName:displayName}`,
        ]),
      );
      const display = asText(locations[0]?.displayName, region);
      const details = [`${region} is "${display}".`];
      let status: FindingStatus = locations.length ? 'ok' : 'attention';
      if (!locations.length) details.push('The subscription does not list this region.');
      const app = await az.json<unknown>([
        'provider',
        'show',
        '--namespace',
        'Microsoft.App',
        '--query',
        "resourceTypes[?resourceType=='managedEnvironments'].locations | [0]",
      ]);
      const appRegions = Array.isArray(app) ? app.map(String) : [];
      const offered = appRegions.some((name) => name.toLowerCase() === display.toLowerCase());
      details.push(
        `Container Apps environments: ${offered ? 'offered' : appRegions.length ? 'NOT listed for this region' : 'could not be determined'}.`,
      );
      if (appRegions.length && !offered) status = 'attention';
      try {
        const skus = await az.json<unknown>([
          'postgres',
          'flexible-server',
          'list-skus',
          '--location',
          region,
        ]);
        const wanted = profileSku(options.profile);
        const found = findNamed(skus, wanted);
        details.push(
          found
            ? `PostgreSQL ${wanted}: offered (${found}).`
            : `PostgreSQL ${wanted}: NOT in the list for ${region}. Some subscriptions are refused Burstable servers in a region ("region restricted"); pick the fallback region or ask for the restriction to be lifted.`,
        );
        if (!found) status = 'attention';
      } catch (error) {
        details.push(`PostgreSQL SKUs could not be listed: ${reason(error)}`);
      }
      add(`region-${region}`, `Region ${region}`, status, details);
    });
  }

  await check('entra', 'Who is signed in, and may they provision', async () => {
    const me =
      (await az.json<Record<string, unknown>>([
        'ad',
        'signed-in-user',
        'show',
        '--query',
        '{id:id,userPrincipalName:userPrincipalName,userType:userType}',
      ])) ?? {};
    const objectId = asText(me.id, '');
    const details = [
      `Signed-in user ${asText(me.userPrincipalName)} (${asText(me.userType)}), object id ${objectId || 'unknown'}.`,
    ];
    let status: FindingStatus = 'unknown';
    if (objectId) {
      const assignments = asRows(
        await az.json<unknown>([
          'role',
          'assignment',
          'list',
          '--assignee',
          objectId,
          '--all',
          '--include-inherited',
          '--query',
          '[].{role:roleDefinitionName,scope:scope}',
        ]),
      );
      const atSubscription = assignments
        .filter((row) => String(row.scope).toLowerCase() === `/subscriptions/${sub}`.toLowerCase())
        .map((row) => asText(row.role));
      const roles = new Set(assignments.map((row) => asText(row.role)));
      const canAssign = [...roles].some((role) => ROLES_THAT_ASSIGN.has(role));
      const canCreate = roles.has('Owner') || roles.has('Contributor');
      details.push(
        `Roles at the subscription: ${atSubscription.join(', ') || 'none'}; ${assignments.length} assignment(s) in all.`,
      );
      status = canAssign && canCreate ? 'ok' : 'attention';
      details.push(
        canAssign && canCreate
          ? 'Enough on paper to create the resources and the four role assignments: Contributor-level plus a role that can assign roles. Scope matters: it must reach the new resource group and the AI account.'
          : 'Not enough on paper. Deploying needs Contributor AND a role that can assign roles (Owner, User Access Administrator or Role Based Access Control Administrator) on the new resource group, and one that can assign a role on the AI account. Without it the role assignments fail and the app cannot call anything.',
      );
    }
    try {
      const authorization = await az.json<Record<string, unknown>>([
        'rest',
        '--method',
        'get',
        '--url',
        'https://graph.microsoft.com/v1.0/policies/authorizationPolicy',
      ]);
      const defaults = (authorization.defaultUserRolePermissions ?? {}) as Record<string, unknown>;
      details.push(
        defaults.allowedToCreateApps === true
          ? 'Users may register applications in this tenant.'
          : 'Users may NOT register applications: the Entra app registration needs the Application Administrator role or an administrator.',
      );
    } catch {
      details.push(
        'Whether this person may register an Entra application could not be read (it needs a Graph permission). It is found out by trying: `az ad app create`.',
      );
    }
    add('entra', 'Who is signed in, and may they provision', status, details);
  });

  await check('postgres-existing', 'Existing PostgreSQL servers', async () => {
    const servers = asRows(
      await az.json<unknown>([
        'postgres',
        'flexible-server',
        'list',
        '--query',
        '[].{name:name,resourceGroup:resourceGroup,location:location,sku:sku.name,tier:sku.tier,version:version,state:state,entra:authConfig.activeDirectoryAuth,password:authConfig.passwordAuth,id:id}',
      ]),
    );
    for (const server of servers) {
      reuse.push({
        kind: 'postgres',
        name: asText(server.name),
        resourceGroup: asText(server.resourceGroup),
        location: asText(server.location),
        id: asText(server.id),
        note: `SWARM_EXISTING_POSTGRES_SERVER_ID; ${asText(server.sku)} ${asText(server.tier)}, version ${asText(server.version)}, Entra ${asText(server.entra)}, password ${asText(server.password)}; the template adds only a database to it`,
      });
    }
    add('postgres-existing', 'Existing PostgreSQL servers', 'ok', [
      servers.length
        ? `${servers.length} flexible server(s): ${servers.map((server) => `${asText(server.name)} (${asText(server.sku)}, ${asText(server.location)}, ${asText(server.state)})`).join('; ')}. Reusing one saves about the server's whole price; the template then only adds a database, and an administrator of that server must create the application's database role.`
        : 'No flexible server exists: the template would create one.',
    ]);
  });

  await check('registry-existing', 'Existing container registries', async () => {
    const registries = asRows(
      await az.json<unknown>([
        'acr',
        'list',
        '--query',
        '[].{name:name,resourceGroup:resourceGroup,location:location,sku:sku.name,admin:adminUserEnabled,id:id}',
      ]),
    );
    for (const registry of registries) {
      reuse.push({
        kind: 'registry',
        name: asText(registry.name),
        resourceGroup: asText(registry.resourceGroup),
        location: asText(registry.location),
        id: asText(registry.id),
        note: `SWARM_EXISTING_REGISTRY_ID; ${asText(registry.sku)}, admin user ${registry.admin === true ? 'ON (turn it off)' : 'off'}`,
      });
    }
    add('registry-existing', 'Existing container registries', 'ok', [
      registries.length
        ? registries
            .map(
              (registry) =>
                `${asText(registry.name)} (${asText(registry.sku)}, ${asText(registry.location)})`,
            )
            .join('; ')
        : 'None: the template would create a Basic registry.',
    ]);
  });

  await check(
    'hosting-existing',
    'Existing Container Apps environments, Key Vaults and Log Analytics workspaces',
    async () => {
      const details: string[] = [];
      const environments = asRows(
        await az.json<unknown>([
          'containerapp',
          'env',
          'list',
          '--query',
          '[].{name:name,resourceGroup:resourceGroup,location:location,id:id}',
        ]),
      );
      environments.forEach((environment) =>
        reuse.push({
          kind: 'environment',
          name: asText(environment.name),
          resourceGroup: asText(environment.resourceGroup),
          location: asText(environment.location),
          id: asText(environment.id),
          note: 'SWARM_EXISTING_CONTAINER_APPS_ENVIRONMENT_ID; must be a workload-profiles environment',
        }),
      );
      details.push(
        `Container Apps environments: ${environments.map((environment) => asText(environment.name)).join(', ') || 'none'}.`,
      );
      const vaults = asRows(
        await az.json<unknown>([
          'keyvault',
          'list',
          '--query',
          '[].{name:name,resourceGroup:resourceGroup,location:location,id:id}',
        ]),
      );
      vaults.forEach((vault) =>
        reuse.push({
          kind: 'keyvault',
          name: asText(vault.name),
          resourceGroup: asText(vault.resourceGroup),
          location: asText(vault.location),
          id: asText(vault.id),
          note: 'SWARM_EXISTING_KEYVAULT_ID; must use Azure RBAC authorization',
        }),
      );
      details.push(
        `Key Vaults: ${vaults.map((vault) => asText(vault.name)).join(', ') || 'none'}.`,
      );
      const workspaces = asRows(
        await az.json<unknown>([
          'monitor',
          'log-analytics',
          'workspace',
          'list',
          '--query',
          '[].{name:name,resourceGroup:resourceGroup,location:location,id:id}',
        ]),
      );
      workspaces.forEach((workspace) =>
        reuse.push({
          kind: 'workspace',
          name: asText(workspace.name),
          resourceGroup: asText(workspace.resourceGroup),
          location: asText(workspace.location),
          id: asText(workspace.id),
          note: 'SWARM_EXISTING_WORKSPACE_ID',
        }),
      );
      details.push(
        `Log Analytics workspaces: ${workspaces.map((workspace) => asText(workspace.name)).join(', ') || 'none'}.`,
      );
      const components = asRows(
        await az.json<unknown>([
          'resource',
          'list',
          '--resource-type',
          'Microsoft.Insights/components',
          '--query',
          '[].{name:name,resourceGroup:resourceGroup,location:location,id:id}',
        ]),
      );
      components.forEach((component) =>
        reuse.push({
          kind: 'appinsights',
          name: asText(component.name),
          resourceGroup: asText(component.resourceGroup),
          location: asText(component.location),
          id: asText(component.id),
          note: 'SWARM_EXISTING_APPINSIGHTS_ID; local authentication must be disabled',
        }),
      );
      details.push(
        `Application Insights components: ${components.map((component) => asText(component.name)).join(', ') || 'none'}.`,
      );
      add(
        'hosting-existing',
        'Existing Container Apps environments, Key Vaults and Log Analytics workspaces',
        'ok',
        details,
      );
    },
  );

  await check('vm', 'The development VM', async () => {
    const machines = asRows(
      await az.json<unknown>([
        'vm',
        'list',
        '--show-details',
        '--query',
        '[].{name:name,size:hardwareProfile.vmSize,power:powerState,location:location,resourceGroup:resourceGroup}',
      ]),
    );
    const dev = machines.find((machine) => asText(machine.name) === 'swarm-dev');
    const cost = costPlans[0]?.vm;
    add(
      'vm',
      'The development VM',
      dev && String(dev.power).includes('running') ? 'attention' : 'ok',
      [
        dev
          ? `swarm-dev is ${asText(dev.power)} (${asText(dev.size)}, ${asText(dev.location)}). Running 24x7 it costs ${cost ? `US$${cost.monthlyUsd} (INR ${cost.monthlyInr.toLocaleString('en-US')})` : 'a lot'} a month at the Linux/base list rate; a deallocated VM costs nothing for compute.`
          : `A VM named swarm-dev was not found (${machines.length} VM(s) visible).`,
      ],
    );
  });

  await check('policy', 'Azure Policy that could block a deployment', async () => {
    const assignments = asRows(
      await az.json<unknown>([
        'policy',
        'assignment',
        'list',
        '--query',
        '[].{name:displayName,enforcement:enforcementMode}',
      ]),
    );
    const risky = assignments.filter((row) =>
      /location|region|sku|tag|public|network/iu.test(String(row.name)),
    );
    add('policy', 'Azure Policy that could block a deployment', risky.length ? 'attention' : 'ok', [
      risky.length
        ? `Assignments that may restrict a deployment: ${risky.map((row) => asText(row.name)).join('; ')}.`
        : `${assignments.length} assignment(s); none by name restricts location, SKU, tags or networking.`,
    ]);
  });

  return finish('inspected');
}

function profileSku(profile: Profile): string {
  return PROFILES[profile].postgres.meter.includes('b1ms') ? 'Standard_B1ms' : 'Standard_D2ds_v5';
}

/** Finds an object whose `name` is the SKU anywhere in a nested `az` answer, whatever shape this CLI version returns. */
function findNamed(value: unknown, name: string): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNamed(item, name);
      if (found) return found;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.name === name) {
      return (
        [
          record.tier ? `tier ${String(record.tier)}` : '',
          Array.isArray(record.supportedZones) ? `zones ${record.supportedZones.join(',')}` : '',
        ]
          .filter(Boolean)
          .join(', ') || 'listed'
      );
    }
    for (const child of Object.values(record)) {
      const found = findNamed(child, name);
      if (found) return found;
    }
  }
  return '';
}

function repositoryFinding(list: (folder: string) => string[]): [FindingStatus, string[]] {
  const files = list('infra');
  const templates = files.filter((file) => file.endsWith('.bicep'));
  const params = files.filter((file) => file.endsWith('.bicepparam'));
  if (templates.length === 0)
    return [
      'attention',
      ['No Bicep file was found under infra/. Run this from the repository root.'],
    ];
  return [
    'ok',
    [
      `${templates.length} template(s) and ${params.length} parameter file(s) under infra/: the pilot (infra/pilot/main.bicep, main.bicepparam), the production-shaped profile and the Foundry account (infra/main.bicep).`,
      'They compile, lint and evaluate offline (`npm run iac:validate`). The pilot templates have never been deployed, so Azure has not accepted them yet (infra/main.bicep, the Foundry account, was deployed once to a development subscription).',
    ],
  ];
}

function ownerActions(): string[] {
  return [
    'PROVISIONING NEEDS AN OWNER. This script stops here on purpose.',
    '1. Sign in: `az login` (or use a service principal / managed identity) as a principal that is Contributor AND User Access Administrator (or Owner) on the new resource group, and may assign a role on the AI account.',
    '2. Create the resource group and the Entra app registration (docs/azure/pilot-plan.md), then set the SWARM_* variables, including SWARM_ALERT_EMAIL.',
    '3. `az deployment group what-if`, read it, then `az deployment group create` with infra/pilot/main.bicepparam. Nothing has been deployed before: expect to fix what Azure says.',
    '4. Check the portal for the real credit balance and set the budget before the resources exist.',
  ];
}

const MARK: Record<FindingStatus, string> = {
  ok: 'OK       ',
  attention: 'ATTENTION',
  blocked: 'BLOCKED  ',
  unknown: 'UNKNOWN  ',
};

export function renderReport(report: PreflightReport): string[] {
  const out: string[] = [];
  out.push(
    `Pre-flight (${report.mode}) on ${report.generatedOn}. READ-ONLY: ${report.azCalls.length} read command(s) attempted; nothing was created, changed or deleted.`,
  );
  out.push('');
  for (const finding of report.findings) {
    out.push(`[${MARK[finding.status]}] ${finding.title}`);
    finding.details.forEach((line) => out.push(`    ${line}`));
  }
  if (report.reuse.length > 0) {
    out.push('');
    out.push(
      'Existing resources the template can reuse instead of duplicating (pass the ID as the variable named):',
    );
    for (const item of report.reuse) {
      out.push(
        `  - ${item.kind} ${item.name} (${item.location}, group ${item.resourceGroup}): ${item.note}`,
      );
      out.push(`      ${mask(item.id, report.options.showIds)}`);
    }
  }
  out.push('');
  for (const plan of report.costPlans) {
    renderCostPlan(plan).forEach((line) => out.push(line));
    out.push('');
  }
  report.owner.forEach((line) => out.push(line));
  return out;
}
