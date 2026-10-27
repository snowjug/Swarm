import { join } from 'node:path';
import type { ProvisionArgs } from './args.js';
import { AzError, type AzClient } from './az.js';
import {
  accountNameFor,
  buildParameters,
  classifyDeploymentFailure,
  parseOutputs,
  toParametersFile,
  type DeploymentOutputs,
  type DeploymentScope,
  type InferencePrincipal,
} from './deployment.js';
import {
  rankCandidates,
  type Candidate,
  type CatalogModel,
  type RegionCatalog,
  type UsageRecord,
} from './models.js';
import {
  evaluatePermissions,
  RESOURCE_GROUP_SCOPE_ACTIONS,
  SUBSCRIPTION_SCOPE_ACTIONS,
  type PermissionBlock,
} from './permissions.js';
import { assessSubscription, isGuid, type SubscriptionInfo } from './subscription.js';

const ARM = 'https://management.azure.com';
const CATALOG_API = '2024-10-01';
const PERMISSIONS_API = '2022-04-01';
const PROJECT_TAG = 'swarm-lab';

export type ProvisionStatus =
  | 'not-logged-in'
  | 'blocked-subscription'
  | 'blocked-permissions'
  | 'blocked-resource-group'
  | 'blocked-principal'
  | 'preflight-ok'
  | 'models-listed'
  | 'no-candidate'
  | 'previewed'
  | 'needs-confirmation'
  | 'deployed'
  | 'failed';

export interface ProvisionResult {
  status: ProvisionStatus;
  messages: string[];
  candidates: Candidate[];
  outputs?: DeploymentOutputs;
  envKeys: string[];
}

export interface ProvisionDeps {
  az: AzClient;
  now: () => Date;
  repoRoot: string;
  writeParameters: (content: string) => Promise<{ path: string; cleanup: () => Promise<void> }>;
  updateEnv: (updates: Record<string, string>) => Promise<string[]>;
}

interface Page<T> {
  value?: T[];
  nextLink?: string;
}

async function collect<T>(az: AzClient, firstUrl: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 0; url && page < 50; page += 1) {
    const body: Page<T> = await az.json<Page<T>>(['rest', '--method', 'get', '--url', url]);
    items.push(...(body.value ?? []));
    // Only follow links that stay on the Azure Resource Manager host.
    url = body.nextLink?.startsWith(`${ARM}/`) ? body.nextLink : undefined;
  }
  return items;
}

async function loadCatalog(
  az: AzClient,
  subscription: string,
  region: string,
): Promise<RegionCatalog> {
  const base = `${ARM}/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/locations/${region}`;
  const [models, usage] = await Promise.all([
    collect<CatalogModel>(az, `${base}/models?api-version=${CATALOG_API}`),
    collect<UsageRecord>(az, `${base}/usages?api-version=${CATALOG_API}`),
  ]);
  return { region, models, usage };
}

async function signedInUserId(az: AzClient): Promise<string | undefined> {
  try {
    const id = (
      await az.text(['ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv'])
    ).trim();
    return isGuid(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function describe(candidate: Candidate): string {
  return `${candidate.modelName} ${candidate.modelVersion} · ${candidate.sku} · ${candidate.capacity}K TPM · ${candidate.region}`;
}

export async function runProvision(
  args: ProvisionArgs,
  deps: ProvisionDeps,
): Promise<ProvisionResult> {
  const result: ProvisionResult = { status: 'failed', messages: [], candidates: [], envKeys: [] };
  const say = (line: string) => result.messages.push(line);
  const finish = (status: ProvisionStatus): ProvisionResult => {
    result.status = status;
    return result;
  };
  const scope: DeploymentScope = args.resourceGroup ? 'resource-group' : 'subscription';

  try {
    const signedIn = await deps.az.json<{ user?: { name?: string } }>(['account', 'show']);
    say(`Signed in as ${signedIn.user?.name ?? 'an unknown user'}.`);
  } catch (error) {
    if (error instanceof AzError && error.code === 'AZ_NOT_LOGGED_IN') {
      say('BLOCKED: not signed in to the Azure CLI. Run `az login`, then re-run this command.');
      return finish('not-logged-in');
    }
    throw error;
  }

  let subscription: SubscriptionInfo;
  try {
    subscription = await deps.az.json<SubscriptionInfo>([
      'account',
      'show',
      '--subscription',
      args.subscription,
    ]);
  } catch {
    say('BLOCKED: that subscription is not visible to the signed-in account.');
    return finish('blocked-subscription');
  }
  const assessment = assessSubscription(subscription, {
    allowProductionNames: args.allowProductionName,
  });
  if (!assessment.ok) {
    assessment.problems.forEach((problem) => say(`BLOCKED: ${problem}`));
    return finish('blocked-subscription');
  }
  say(`Target subscription: ${subscription.name}.`);

  const scopePath =
    `/subscriptions/${args.subscription}` +
    (args.resourceGroup ? `/resourceGroups/${encodeURIComponent(args.resourceGroup)}` : '');
  let blocks: PermissionBlock[] = [];
  try {
    const permissions = await deps.az.json<Page<PermissionBlock>>([
      'rest',
      '--method',
      'get',
      '--url',
      `${ARM}${scopePath}/providers/Microsoft.Authorization/permissions?api-version=${PERMISSIONS_API}`,
    ]);
    blocks = permissions.value ?? [];
  } catch {
    // A caller who cannot even read their permissions has none that matter here.
  }
  const required = (
    scope === 'subscription' ? SUBSCRIPTION_SCOPE_ACTIONS : RESOURCE_GROUP_SCOPE_ACTIONS
  ).filter((action) => !(args.skipRoleAssignment && action.includes('roleAssignments')));
  const report = evaluatePermissions(blocks, required);
  if (!report.ok) {
    say(
      `BLOCKED: this account cannot deploy at ${scope} scope. Missing: ${report.missing.join(', ')}.`,
    );
    say(
      'Needed: Contributor plus Role Based Access Control Administrator (or Owner) on a development subscription; ' +
        'or Contributor on an empty resource group, then pass --resource-group <name>. ' +
        'Add --skip-role-assignment if an administrator will grant "Cognitive Services OpenAI User" on the account.',
    );
    return finish('blocked-permissions');
  }
  say(`Permissions: all ${required.length} required actions are allowed at ${scope} scope.`);
  if (args.preflightOnly) return finish('preflight-ok');

  if (args.resourceGroup) {
    try {
      const resources = await deps.az.json<
        Array<{ name: string; tags?: Record<string, string> | null }>
      >([
        'resource',
        'list',
        '--subscription',
        args.subscription,
        '--resource-group',
        args.resourceGroup,
        '--query',
        '[].{name:name,tags:tags}',
      ]);
      const foreign = resources.filter((resource) => resource.tags?.app !== PROJECT_TAG);
      if (foreign.length > 0 && !args.allowNonEmptyResourceGroup) {
        say(
          `BLOCKED: resource group "${args.resourceGroup}" already contains ${foreign.length} resource(s) not created by this project. ` +
            'Use an empty group, or pass --allow-non-empty-resource-group if sharing it is intended.',
        );
        return finish('blocked-resource-group');
      }
    } catch {
      say(`BLOCKED: could not inspect resource group "${args.resourceGroup}".`);
      return finish('blocked-resource-group');
    }
  }

  let principals: InferencePrincipal[] = [];
  if (!args.skipRoleAssignment) {
    const principalId = args.principalId ?? (await signedInUserId(deps.az));
    if (!principalId) {
      say(
        'BLOCKED: could not read your Entra object id. Pass --principal-id <guid>, or --skip-role-assignment.',
      );
      return finish('blocked-principal');
    }
    principals = [{ principalId, principalType: args.principalType }];
  }

  const catalogs: RegionCatalog[] = [];
  for (const region of args.regions) {
    try {
      catalogs.push(await loadCatalog(deps.az, args.subscription, region));
    } catch (error) {
      say(
        `Skipped region ${region}: ${error instanceof AzError ? error.message : 'lookup failed'}`,
      );
    }
  }
  const { candidates, rejected } = rankCandidates(catalogs, {
    kind: args.kind,
    regions: args.regions,
    capacity: args.capacity,
    now: deps.now(),
    allowPreview: args.allowPreview,
    allowLegacy: args.allowLegacy,
    ...(args.models ? { modelNames: args.models } : {}),
  });
  result.candidates = candidates;
  if (candidates.length === 0) {
    say(
      `No deployable model found in ${catalogs.length} region(s). Rejections: ${rejected.length}.`,
    );
    rejected
      .slice(0, 8)
      .forEach((item) =>
        say(`  ${item.region} ${item.modelName}${item.sku ? ` ${item.sku}` : ''}: ${item.reason}`),
      );
    return finish('no-candidate');
  }
  if (args.listModels) return finish('models-listed');

  const chosen = candidates[args.pick - 1];
  if (!chosen) {
    say(`--pick ${args.pick} is out of range; ${candidates.length} candidate(s) are available.`);
    return finish('no-candidate');
  }
  say(
    `Selected: ${describe(chosen)}${chosen.notes.length ? ` (${chosen.notes.join('; ')})` : ''}.`,
  );

  const accountName = args.resourceGroup
    ? accountNameFor(args.subscription, args.resourceGroup, args.environment)
    : undefined;
  const parameters = buildParameters(
    {
      environment: args.environment,
      candidate: chosen,
      deploymentName: args.deploymentName,
      principals,
      ...(accountName ? { accountName } : {}),
    },
    scope,
  );
  const file = await deps.writeParameters(toParametersFile(parameters));
  try {
    const template =
      scope === 'subscription'
        ? join(deps.repoRoot, 'infra', 'main.bicep')
        : join(deps.repoRoot, 'infra', 'modules', 'ai-services.bicep');
    const verb = scope === 'subscription' ? ['deployment', 'sub'] : ['deployment', 'group'];
    const target =
      scope === 'subscription'
        ? ['--location', chosen.region]
        : ['--resource-group', args.resourceGroup ?? ''];
    const common = [
      '--subscription',
      args.subscription,
      '--template-file',
      template,
      '--parameters',
      `@${file.path}`,
    ];
    const stem = `swarm-${args.environment}`;

    const preview = await deps.az.json<{
      changes?: Array<{ resourceId?: string; changeType?: string }>;
    }>([...verb, 'what-if', '--name', `${stem}-whatif`, ...target, ...common, '--no-pretty-print']);
    const changes = preview.changes ?? [];
    say(`What-if: ${changes.length} change(s).`);
    changes
      .slice(0, 12)
      .forEach((change) =>
        say(
          `  ${change.changeType ?? '?'} ${(change.resourceId ?? '').split('/').slice(-2).join('/')}`,
        ),
      );
    if (args.whatIf) return finish('previewed');
    if (!args.yes) {
      say('Nothing was deployed. Re-run with --yes to apply this plan.');
      return finish('needs-confirmation');
    }

    const stamp = deps.now().toISOString().replace(/\D/g, '').slice(0, 14);
    const raw = await deps.az.json<unknown>([
      ...verb,
      'create',
      '--name',
      `${stem}-${stamp}`,
      ...target,
      ...common,
      '--query',
      'properties.outputs',
    ]);
    result.outputs = parseOutputs(raw);
    say(
      `Deployed account ${result.outputs.accountName} with deployment ${result.outputs.deployment}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The deployment failed.';
    const failure = classifyDeploymentFailure(message);
    say(`FAILED (${failure.kind}): ${message}`);
    say(failure.hint);
    return finish('failed');
  } finally {
    await file.cleanup();
  }

  if (!args.skipEnvFile) {
    result.envKeys = await deps.updateEnv({
      AI_PROVIDER: 'azure',
      AI_MODEL: result.outputs.deployment,
      AZURE_OPENAI_ENDPOINT: result.outputs.endpoint,
      AZURE_OPENAI_AUTH: 'entra',
    });
    say(`Wrote non-secret settings to .env: ${result.envKeys.join(', ')}.`);
  }
  say(
    'Role assignments can take several minutes to propagate. Then POST /api/provider/check to verify.',
  );
  return finish('deployed');
}
