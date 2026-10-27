import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import type { AccountKind } from './models.js';
import { isGuid } from './subscription.js';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function parseStrict<const T extends ParseArgsOptionsConfig>(argv: readonly string[], options: T) {
  try {
    return parseArgs({ args: [...argv], strict: true, allowPositionals: false, options }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Invalid arguments.');
  }
}

/** Common regions with Azure OpenAI capacity, nearest-to-US-West first. Override with --regions. */
export const DEFAULT_REGIONS = [
  'eastus2',
  'westus3',
  'swedencentral',
  'eastus',
  'northcentralus',
  'southcentralus',
  'westus',
  'uksouth',
  'francecentral',
  'canadaeast',
] as const;

export interface ProvisionArgs {
  subscription: string;
  environment: string;
  regions: string[];
  models: string[] | undefined;
  capacity: number;
  kind: AccountKind;
  resourceGroup: string | undefined;
  deploymentName: string;
  pick: number;
  principalId: string | undefined;
  principalType: 'User' | 'Group' | 'ServicePrincipal';
  preflightOnly: boolean;
  listModels: boolean;
  whatIf: boolean;
  yes: boolean;
  skipRoleAssignment: boolean;
  skipEnvFile: boolean;
  allowProductionName: boolean;
  allowNonEmptyResourceGroup: boolean;
  allowPreview: boolean;
  allowLegacy: boolean;
}

const ENVIRONMENT = /^[a-z0-9][a-z0-9-]{2,19}$/;
const REGION = /^[a-z0-9]{3,30}$/;
const MODEL = /^[a-z0-9][a-z0-9.-]{1,63}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/;

function list(value: string | undefined, pattern: RegExp, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (items.length === 0 || items.some((item) => !pattern.test(item))) {
    throw new UsageError(`--${label} must be a comma-separated list of valid names.`);
  }
  return items;
}

export function parseProvisionArgs(argv: readonly string[]): ProvisionArgs {
  const values = parseStrict(argv, {
    subscription: { type: 'string' },
    environment: { type: 'string', default: 'swarm-dev' },
    regions: { type: 'string' },
    models: { type: 'string' },
    capacity: { type: 'string', default: '50' },
    kind: { type: 'string', default: 'AIServices' },
    'resource-group': { type: 'string' },
    'deployment-name': { type: 'string', default: 'swarm-chat' },
    pick: { type: 'string', default: '1' },
    'principal-id': { type: 'string' },
    'principal-type': { type: 'string', default: 'User' },
    'preflight-only': { type: 'boolean', default: false },
    'list-models': { type: 'boolean', default: false },
    'what-if': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'skip-role-assignment': { type: 'boolean', default: false },
    'skip-env-file': { type: 'boolean', default: false },
    'allow-production-name': { type: 'boolean', default: false },
    'allow-non-empty-resource-group': { type: 'boolean', default: false },
    'allow-preview': { type: 'boolean', default: false },
    'allow-legacy': { type: 'boolean', default: false },
  });

  // Never fall back to the CLI's default subscription: the target must be a deliberate choice.
  if (!values.subscription || !isGuid(values.subscription)) {
    throw new UsageError(
      '--subscription <guid> is required. The default subscription is never used implicitly.',
    );
  }
  const environment = values.environment ?? 'swarm-dev';
  if (!ENVIRONMENT.test(environment)) {
    throw new UsageError('--environment must be 3-20 lowercase letters, digits or hyphens.');
  }
  const capacity = Number(values.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    throw new UsageError(
      '--capacity must be a whole number from 1 to 100 (thousands of tokens per minute).',
    );
  }
  const pick = Number(values.pick);
  if (!Number.isInteger(pick) || pick < 1 || pick > 20)
    throw new UsageError('--pick must be a whole number from 1 to 20.');
  if (values.kind !== 'AIServices' && values.kind !== 'OpenAI') {
    throw new UsageError('--kind must be AIServices or OpenAI.');
  }
  const resourceGroup = values['resource-group'];
  if (resourceGroup !== undefined && !NAME.test(resourceGroup))
    throw new UsageError('--resource-group is not a valid name.');
  const deploymentName = values['deployment-name'] ?? 'swarm-chat';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(deploymentName))
    throw new UsageError('--deployment-name is not a valid name.');
  const principalId = values['principal-id'];
  if (principalId !== undefined && !isGuid(principalId))
    throw new UsageError('--principal-id must be an Entra object id (guid).');
  const principalType = values['principal-type'];
  if (
    principalType !== 'User' &&
    principalType !== 'Group' &&
    principalType !== 'ServicePrincipal'
  ) {
    throw new UsageError('--principal-type must be User, Group or ServicePrincipal.');
  }

  return {
    subscription: values.subscription,
    environment,
    regions: list(values.regions, REGION, 'regions') ?? [...DEFAULT_REGIONS],
    models: list(values.models, MODEL, 'models'),
    capacity,
    kind: values.kind,
    resourceGroup,
    deploymentName,
    pick,
    principalId,
    principalType,
    preflightOnly: values['preflight-only'] ?? false,
    listModels: values['list-models'] ?? false,
    whatIf: values['what-if'] ?? false,
    yes: values.yes ?? false,
    skipRoleAssignment: values['skip-role-assignment'] ?? false,
    skipEnvFile: values['skip-env-file'] ?? false,
    allowProductionName: values['allow-production-name'] ?? false,
    allowNonEmptyResourceGroup: values['allow-non-empty-resource-group'] ?? false,
    allowPreview: values['allow-preview'] ?? false,
    allowLegacy: values['allow-legacy'] ?? false,
  };
}

export interface TeardownArgs {
  subscription: string;
  resourceGroup: string;
  yes: boolean;
}

export function parseTeardownArgs(argv: readonly string[]): TeardownArgs {
  const values = parseStrict(argv, {
    subscription: { type: 'string' },
    'resource-group': { type: 'string' },
    yes: { type: 'boolean', default: false },
  });
  if (!values.subscription || !isGuid(values.subscription))
    throw new UsageError('--subscription <guid> is required.');
  const resourceGroup = values['resource-group'];
  if (!resourceGroup || !NAME.test(resourceGroup))
    throw new UsageError('--resource-group <name> is required.');
  return { subscription: values.subscription, resourceGroup, yes: values.yes ?? false };
}

export const VERIFY_PROVIDERS = ['azure', 'openai', 'ollama'] as const;
export const VERIFY_AUTH_MODES = ['entra', 'api-key', 'none'] as const;

export interface VerifyArgs {
  baseUrl: string;
  expectProvider: (typeof VERIFY_PROVIDERS)[number];
  /** null: do not check how the server authenticates. */
  expectAuth: (typeof VERIFY_AUTH_MODES)[number] | null;
  agents: number;
  rounds: number;
  /** False: no hidden instruction is placed in the source, and the injection check is skipped. */
  probe: boolean;
  stepTimeoutMinutes: number;
  json: boolean;
}

function wholeNumber(value: string | undefined, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new UsageError(`--${label} must be a whole number from ${min} to ${max}.`);
  }
  return parsed;
}

export function parseVerifyArgs(argv: readonly string[]): VerifyArgs {
  const values = parseStrict(argv, {
    'base-url': { type: 'string', default: 'http://127.0.0.1:3001' },
    'expect-provider': { type: 'string', default: 'azure' },
    'expect-auth': { type: 'string' },
    agents: { type: 'string', default: '4' },
    rounds: { type: 'string', default: '3' },
    'step-timeout-minutes': { type: 'string', default: '15' },
    'no-probe': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  });

  let url: URL;
  try {
    url = new URL(values['base-url'] ?? '');
  } catch {
    throw new UsageError('--base-url must be an http(s) URL such as http://127.0.0.1:3001.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new UsageError('--base-url must be an http(s) URL without embedded credentials.');
  }
  const expectProvider = VERIFY_PROVIDERS.find((name) => name === values['expect-provider']);
  if (!expectProvider) {
    throw new UsageError(`--expect-provider must be one of: ${VERIFY_PROVIDERS.join(', ')}.`);
  }
  const requestedAuth = values['expect-auth'];
  const expectAuth = requestedAuth
    ? (VERIFY_AUTH_MODES.find((mode) => mode === requestedAuth) ?? null)
    : expectProvider === 'azure'
      ? 'entra'
      : null;
  if (requestedAuth && expectAuth === null) {
    throw new UsageError(`--expect-auth must be one of: ${VERIFY_AUTH_MODES.join(', ')}.`);
  }
  return {
    baseUrl: url.origin,
    expectProvider,
    expectAuth,
    // Model-assisted runs allow 4-10 proxies and 3-10 rounds; the branch needs at least 3 rounds.
    agents: wholeNumber(values.agents, 'agents', 4, 10),
    rounds: wholeNumber(values.rounds, 'rounds', 3, 10),
    probe: !values['no-probe'],
    stepTimeoutMinutes: wholeNumber(values['step-timeout-minutes'], 'step-timeout-minutes', 1, 60),
    json: values.json ?? false,
  };
}
