import { createHash } from 'node:crypto';
import type { Candidate } from './models.js';

export interface InferencePrincipal {
  principalId: string;
  principalType: 'User' | 'Group' | 'ServicePrincipal';
}

export type DeploymentScope = 'subscription' | 'resource-group';

export interface DeploymentRequest {
  environment: string;
  candidate: Candidate;
  deploymentName: string;
  principals: readonly InferencePrincipal[];
  /** Needed only at resource-group scope, where the template cannot derive a unique name. */
  accountName?: string;
}

/** Deterministic, so re-running the same environment updates one account instead of creating more. */
export function accountNameFor(
  subscriptionId: string,
  resourceGroup: string,
  environment: string,
): string {
  const digest = createHash('sha256')
    .update(`${subscriptionId}/${resourceGroup}/${environment}`)
    .digest('hex');
  return `ai-${environment}-${digest.slice(0, 10)}`.slice(0, 64);
}

export function buildParameters(
  request: DeploymentRequest,
  scope: DeploymentScope,
): Record<string, { value: unknown }> {
  const { candidate } = request;
  const shared = {
    accountKind: { value: candidate.kind },
    deploymentName: { value: request.deploymentName },
    modelName: { value: candidate.modelName },
    modelVersion: { value: candidate.modelVersion },
    deploymentSku: { value: candidate.sku },
    deploymentCapacity: { value: candidate.capacity },
    inferenceUsers: { value: request.principals },
  };
  if (scope === 'resource-group') {
    if (!request.accountName) throw new Error('accountName is required at resource-group scope.');
    return {
      ...shared,
      accountName: { value: request.accountName },
      location: { value: candidate.region },
      // The subscription template tags everything; here the tag is what lets teardown find the account.
      tags: { value: { app: 'swarm-lab', environment: request.environment, managedBy: 'bicep' } },
    };
  }
  return {
    ...shared,
    environmentName: { value: request.environment },
    location: { value: candidate.region },
  };
}

export function toParametersFile(parameters: Record<string, { value: unknown }>): string {
  return JSON.stringify(
    {
      $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
      contentVersion: '1.0.0.0',
      parameters,
    },
    null,
    2,
  );
}

export interface DeploymentOutputs {
  accountName: string;
  endpoint: string;
  deployment: string;
  resourceGroup: string | undefined;
  location: string | undefined;
}

/**
 * ARM rewrites the capitalization of output names (AZURE_OPENAI_ENDPOINT comes back as
 * azurE_OPENAI_ENDPOINT), so names are matched case-insensitively.
 */
function text(outputs: Record<string, unknown>, ...names: string[]): string | undefined {
  const byLowerName = new Map(
    Object.entries(outputs).map(([key, entry]) => [key.toLowerCase(), entry]),
  );
  for (const name of names) {
    const entry = byLowerName.get(name.toLowerCase());
    const value =
      entry && typeof entry === 'object' && 'value' in entry
        ? (entry as { value: unknown }).value
        : undefined;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** Accepts both the subscription template (UPPER_SNAKE) and the module (camelCase) output names. */
export function parseOutputs(raw: unknown): DeploymentOutputs {
  if (!raw || typeof raw !== 'object') throw new Error('The deployment returned no outputs.');
  const outputs = raw as Record<string, unknown>;
  const accountName = text(outputs, 'AZURE_AI_ACCOUNT_NAME', 'accountName');
  const endpoint = text(outputs, 'AZURE_OPENAI_ENDPOINT', 'openAiEndpoint');
  const deployment = text(outputs, 'AZURE_OPENAI_DEPLOYMENT', 'deploymentName');
  if (!accountName || !endpoint || !deployment) {
    throw new Error('The deployment outputs are missing the account, endpoint or deployment name.');
  }
  return {
    accountName,
    endpoint,
    deployment,
    resourceGroup: text(outputs, 'AZURE_RESOURCE_GROUP'),
    location: text(outputs, 'AZURE_LOCATION'),
  };
}

export type FailureKind =
  'quota' | 'model-unavailable' | 'policy' | 'authorization' | 'name-conflict' | 'other';

const FAILURES: ReadonlyArray<[FailureKind, RegExp, string]> = [
  [
    'quota',
    /InsufficientQuota|quota/i,
    'The region has no quota for this model. Re-run to rank another region, or request quota.',
  ],
  [
    'model-unavailable',
    /SkuNotSupported|ModelNotSupported|DeploymentModelNotSupported|ServiceModelDeprecated|not available in|not supported in/i,
    'The model, version or SKU is not available here. Re-run with --pick 2 or another --regions list.',
  ],
  [
    'policy',
    /RequestDisallowedByPolicy|disallowed by policy/i,
    'An Azure Policy blocked the deployment. The message names the policy; ask its owner for an exemption or change the setting it names.',
  ],
  [
    'authorization',
    /AuthorizationFailed|does not have authorization|RoleAssignmentUpdateNotPermitted|PrincipalNotFound|Forbidden/i,
    'Your account lacks permission for this step. Role assignment needs Role Based Access Control Administrator or Owner; use --skip-role-assignment if an administrator will assign the role.',
  ],
  [
    'name-conflict',
    /FlagMustBeSetForRestore|soft.?delet|CustomDomainInUse|SubdomainAlreadyExists|already exists/i,
    'A deleted account with this name is still soft-deleted. Run the teardown script (it purges) or pick another --environment.',
  ],
];

export function classifyDeploymentFailure(message: string): { kind: FailureKind; hint: string } {
  for (const [kind, pattern, hint] of FAILURES) {
    if (pattern.test(message)) return { kind, hint };
  }
  return { kind: 'other', hint: 'See the message above. Nothing was written to .env.' };
}
