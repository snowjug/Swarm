import { z } from 'zod';
import { MAX_BUDGET_LIMIT } from '../../../shared/budget.js';
import type { ProviderName } from '../../../shared/types.js';
import type { PriceEntry } from './cost.js';
import { MODEL_ROLES, type ModelRole } from './task.js';

/** What a deployment name may look like: it is sent as `model`, and it labels metrics and logs. */
export const DEPLOYMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PRICE_PATTERN = /^[A-Za-z0-9._*-]{1,128}$/u;
const ZONE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/u;

export type Environment = Record<string, string | undefined>;

/** What the operator says about one deployment. Nothing here is learned from the network. */
export interface DeploymentProfile {
  /** Takes `reasoning_effort` and refuses `temperature`. */
  reasoning: boolean;
  /** The data zone it is provisioned in, as the operator names zones. Null: not declared. */
  dataZone: string | null;
  /** The most characters of instructions and data it is configured to take. Null: no limit stated. */
  maxContextChars: number | null;
  latency: 'fast' | 'standard' | 'slow';
  /** False when it is known not to take strict structured outputs. */
  structuredOutputs: boolean;
}

export interface RoutingConfig {
  /** True when DEPLOYMENT_MODE says production. It tightens what may be configured. */
  production: boolean;
  /** The deployment every role without its own uses (AI_MODEL). */
  defaultDeployment: string | null;
  roles: Readonly<Partial<Record<ModelRole, string>>>;
  /** Preferred when a task needs reasoning and its role's deployment is not a reasoning one. */
  reasoningDeployment: string | null;
  /** Tried once, in place of the chosen deployment, when that one is missing, throttled or down. */
  fallbackDeployment: string | null;
  /** When set, every task is served only from a deployment declared in this data zone. */
  dataZone: string | null;
  profiles: Readonly<Record<string, DeploymentProfile>>;
  prices: readonly PriceEntry[];
  /** The allowance each operation gets unless its caller gives it another. 0 is no limit. */
  operationBudget: { tokens: number; usd: number };
  cache: { mode: 'off' | 'tenant'; maxEntries: number; ttlMs: number };
  /** `redacted`: spans may carry the size and a hash of a prompt and reply; never the text. */
  traceContent: 'off' | 'redacted';
  /** The provider's per-request time limit, which a task's latency budget can only shorten. */
  timeoutMs: number;
}

/** The variable that names the deployment of a role: FOUNDRY_DEPLOYMENT_RESEARCH_PLANNER and so on. */
export const roleVariable = (role: ModelRole): string =>
  `FOUNDRY_DEPLOYMENT_${role.toUpperCase().replaceAll('-', '_')}`;

export const deploymentIsProduction = (environment: Environment): boolean =>
  environment.DEPLOYMENT_MODE?.trim().toLowerCase() === 'production';

/** The same wording `loadConfig` uses, and never a value: a setting may hold a secret. */
function invalid(...names: string[]): never {
  throw new Error(`Invalid server configuration: ${names.join(', ')}.`);
}

const text = (environment: Environment, name: string): string | null => {
  const value = environment[name]?.trim();
  return value ? value : null;
};

function deployment(environment: Environment, name: string): string | null {
  const value = text(environment, name);
  if (value === null) return null;
  if (!DEPLOYMENT_NAME.test(value)) invalid(name);
  return value;
}

function integer(environment: Environment, name: string, fallback: number, max: number): number {
  const value = text(environment, name);
  if (value === null) return fallback;
  if (!/^\d{1,12}$/u.test(value) || Number(value) > max) invalid(name);
  return Number(value);
}

function json(environment: Environment, name: string, limit: number): unknown {
  const value = text(environment, name);
  if (value === null) return undefined;
  if (value.length > limit) invalid(name);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalid(name);
  }
}

const profileSchema = z
  .object({
    reasoning: z.boolean().optional(),
    dataZone: z.string().regex(ZONE_NAME).optional(),
    maxContextChars: z.int().min(1_000).max(4_000_000).optional(),
    latency: z.enum(['fast', 'standard', 'slow']).optional(),
    structuredOutputs: z.boolean().optional(),
  })
  .strict();

const profilesSchema = z.record(z.string().regex(DEPLOYMENT_NAME), profileSchema);

const priceSchema = z
  .array(
    z
      .object({
        deployment: z.string().regex(PRICE_PATTERN),
        inputPerMillionUsd: z.number().min(0).max(10_000),
        outputPerMillionUsd: z.number().min(0).max(10_000),
      })
      .strict(),
  )
  .max(64);

/**
 * Everything about how a model is chosen, budgeted, cached and observed. Nothing here is read from
 * the network, and a bad value is named by its variable and never repeated.
 */
export function loadRouting(
  environment: Environment,
  provider: { name: ProviderName; model: string; timeoutMs: number },
): RoutingConfig {
  const production = deploymentIsProduction(environment);
  const foundry = provider.name === 'foundry';

  const roles: Partial<Record<ModelRole, string>> = {};
  if (foundry) {
    for (const role of MODEL_ROLES) {
      const chosen = deployment(environment, roleVariable(role));
      if (chosen) roles[role] = chosen;
    }
  }
  const reasoningDeployment = foundry
    ? deployment(environment, 'FOUNDRY_DEPLOYMENT_REASONING')
    : null;
  const fallbackDeployment = foundry
    ? deployment(environment, 'FOUNDRY_DEPLOYMENT_FALLBACK')
    : null;

  const zone = foundry ? text(environment, 'FOUNDRY_DATA_ZONE')?.toLowerCase() : null;
  if (zone && !ZONE_NAME.test(zone)) invalid('FOUNDRY_DATA_ZONE');

  const profiles: Record<string, DeploymentProfile> = {};
  if (foundry) {
    const raw = json(environment, 'FOUNDRY_DEPLOYMENT_PROFILES', 8_000);
    if (raw !== undefined) {
      const parsed = profilesSchema.safeParse(raw);
      if (!parsed.success || Object.keys(parsed.data).length > 16) {
        invalid('FOUNDRY_DEPLOYMENT_PROFILES');
      } else {
        for (const [name, profile] of Object.entries(parsed.data)) {
          profiles[name] = {
            reasoning: profile.reasoning ?? name === reasoningDeployment,
            dataZone: profile.dataZone ?? null,
            maxContextChars: profile.maxContextChars ?? null,
            latency: profile.latency ?? 'standard',
            structuredOutputs: profile.structuredOutputs ?? true,
          };
        }
      }
    }
  }

  const rawPrices = json(environment, 'MODEL_PRICES', 8_000);
  let prices: PriceEntry[] = [];
  if (rawPrices !== undefined) {
    const parsed = priceSchema.safeParse(rawPrices);
    if (!parsed.success) invalid('MODEL_PRICES');
    else prices = parsed.data;
  }

  const tokens = integer(environment, 'MODEL_OPERATION_TOKEN_LIMIT', 0, MAX_BUDGET_LIMIT);
  const usdText = text(environment, 'MODEL_OPERATION_COST_LIMIT_USD');
  const usd = usdText === null ? 0 : Number(usdText);
  if (!Number.isFinite(usd) || usd < 0 || usd > 10_000) invalid('MODEL_OPERATION_COST_LIMIT_USD');
  if (usd > 0 && prices.length === 0) {
    throw new Error(
      'MODEL_OPERATION_COST_LIMIT_USD needs MODEL_PRICES: a cost limit is never enforced from a guessed price.',
    );
  }

  const cacheMode = text(environment, 'MODEL_CACHE') ?? 'off';
  if (cacheMode !== 'off' && cacheMode !== 'tenant') invalid('MODEL_CACHE');
  const traceContent = text(environment, 'TELEMETRY_TRACE_CONTENT') ?? 'off';
  if (traceContent !== 'off' && traceContent !== 'redacted') invalid('TELEMETRY_TRACE_CONTENT');

  const maxEntries = integer(environment, 'MODEL_CACHE_MAX_ENTRIES', 256, 10_000);
  const ttlSeconds = integer(environment, 'MODEL_CACHE_TTL_SECONDS', 900, 86_400);
  if (maxEntries < 1) invalid('MODEL_CACHE_MAX_ENTRIES');
  if (ttlSeconds < 1) invalid('MODEL_CACHE_TTL_SECONDS');

  return {
    production,
    defaultDeployment: provider.model || null,
    roles,
    reasoningDeployment,
    fallbackDeployment,
    dataZone: zone ?? null,
    profiles,
    prices,
    operationBudget: { tokens, usd },
    cache: { mode: cacheMode, maxEntries, ttlMs: ttlSeconds * 1_000 },
    traceContent,
    timeoutMs: provider.timeoutMs,
  };
}

/** The profile of a deployment: what the operator declared, or the neutral default. */
export function profileOf(routing: RoutingConfig, name: string): DeploymentProfile {
  return (
    routing.profiles[name] ?? {
      reasoning: name === routing.reasoningDeployment,
      dataZone: null,
      maxContextChars: null,
      latency: 'standard',
      structuredOutputs: true,
    }
  );
}
