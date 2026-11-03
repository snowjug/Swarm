import { AppError } from '../errors.js';
import type { ReasoningEffort } from './call.js';
import { estimateTokens, worstCaseCostUsd } from './cost.js';
import { profileOf, type DeploymentProfile, type RoutingConfig } from './routing-config.js';
import { MODEL_ROLES, type ModelRole } from './task.js';

/**
 * Chooses a deployment and the parameters of a call from configuration alone: no network, no
 * randomness, no learning. The same request and the same configuration always give the same route,
 * so a route can be explained, tested in a table, and trusted not to change under a running job.
 *
 * What decides it, in this order:
 *
 *  1. Task type (`role`): which deployment the operator named for it (FOUNDRY_DEPLOYMENT_<ROLE>),
 *     else the default (AI_MODEL). One deployment serving every role is the zero-config default.
 *  2. Availability: a deployment the caller says is not available is not chosen.
 *  3. Privacy / data zone: when a zone is required (by the task, else FOUNDRY_DATA_ZONE), only a
 *     deployment declared in that zone may serve it. One that declares none is never assumed to.
 *  4. Context size: a deployment configured with a smaller context than the request is not chosen.
 *  5. Cost ceiling: with a ceiling, a deployment must have a price and the call's worst case must
 *     fit under it; an unpriced deployment is refused rather than guessed.
 *  6. Reasoning need: a task that needs reasoning prefers a reasoning deployment. It is a preference:
 *     with none configured the task still runs.
 *  7. Latency budget: a tight budget prefers a deployment declared fast, and lowers the reasoning
 *     effort, the time limit and the retries.
 *  8. Schema needs: strict structured output is asked for unless the deployment is declared not to
 *     take it. (Whether it really does is learned by the client, from the provider's own refusal.)
 *
 * It does not use a preview model router: every deployment it can return is one the operator named.
 */
export interface RouteRequest {
  role: ModelRole;
  /** Characters of the instructions and the data about to be sent. */
  contextChars: number;
  requiresReasoning?: boolean;
  latencyBudgetMs?: number;
  costCeilingUsd?: number;
  dataZone?: string;
  /** The answer wanted, in tokens. The route adds room for reasoning where the deployment reasons. */
  maxTokens?: number;
  /** The deployments that may be used right now. Absent: every configured deployment. */
  available?: ReadonlySet<string> | readonly string[];
}

export interface Route {
  role: ModelRole;
  deployment: string;
  /** Set for a deployment that takes a temperature, null for one that reasons. */
  temperature: number | null;
  /** Set for a reasoning deployment, null otherwise. */
  reasoningEffort: ReasoningEffort | null;
  maxTokens: number;
  timeoutMs: number;
  retry: { transient: number; throttle: number };
  strictSchema: boolean;
  /** The next deployment that could serve the same request, to be tried once if this one fails. */
  fallbackDeployment: string | null;
  /** The data zone the route was held to, when there was one. */
  dataZone: string | null;
  estimatedInputTokens: number;
  /** Short codes saying why, for a log or a test. */
  because: readonly string[];
}

export interface Router {
  route(request: RouteRequest): Route;
  /** Every deployment the configuration names, in the order the router would prefer them for a role. */
  deployments(role?: ModelRole): readonly string[];
}

const ROLE_PARAMETERS: Record<
  ModelRole,
  { temperature: number; effort: ReasoningEffort; maxTokens: number }
> = {
  'research-planner': { temperature: 0.2, effort: 'medium', maxTokens: 2_000 },
  extraction: { temperature: 0, effort: 'low', maxTokens: 4_000 },
  actor: { temperature: 0.5, effort: 'low', maxTokens: 2_500 },
  scenario: { temperature: 0.3, effort: 'medium', maxTokens: 3_000 },
  critic: { temperature: 0.2, effort: 'high', maxTokens: 3_000 },
  synthesis: { temperature: 0.3, effort: 'medium', maxTokens: 4_000 },
};

const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];
/** Tokens a reasoning deployment may spend thinking before it writes the answer, by effort. */
const REASONING_HEADROOM: Record<ReasoningEffort, number> = {
  minimal: 500,
  low: 1_000,
  medium: 2_000,
  high: 4_000,
};
/** The most an output budget may be: what the client also stops a truncation retry at. */
export const MAX_OUTPUT_TOKENS = 16_000;
const TIGHT_LATENCY_MS = 20_000;
const MODERATE_LATENCY_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;

const unavailable = (message: string): AppError =>
  new AppError(503, 'MODEL_ROUTE_UNAVAILABLE', message);

export function createRouter(routing: RoutingConfig): Router {
  const configured = (role: ModelRole): string[] => {
    const wanted = [
      routing.roles[role] ?? routing.defaultDeployment,
      routing.defaultDeployment,
      routing.reasoningDeployment,
      routing.fallbackDeployment,
    ];
    return [...new Set(wanted.filter((name): name is string => !!name))];
  };

  const route = (request: RouteRequest): Route => {
    const because: string[] = [];
    const candidates = configured(request.role);
    if (candidates.length === 0)
      throw unavailable('No model deployment is configured for this task.');

    const available = request.available ? new Set(request.available) : null;
    const zone = request.dataZone?.toLowerCase() ?? routing.dataZone;
    const parameters = ROLE_PARAMETERS[request.role];
    const estimatedInputTokens = estimateTokens(request.contextChars);
    const wanted = Math.min(MAX_OUTPUT_TOKENS, request.maxTokens ?? parameters.maxTokens);
    const refusals = new Set<string>();

    const eligible = candidates.filter((name) => {
      const profile = profileOf(routing, name);
      if (available && !available.has(name)) {
        refusals.add('availability');
        return false;
      }
      if (zone && profile.dataZone !== zone) {
        refusals.add('zone');
        return false;
      }
      if (profile.maxContextChars !== null && request.contextChars > profile.maxContextChars) {
        refusals.add('context');
        return false;
      }
      if (request.costCeilingUsd !== undefined) {
        const worst = worstCaseCostUsd(estimatedInputTokens, wanted, name, routing.prices);
        if (worst === null || worst > request.costCeilingUsd) {
          refusals.add('cost');
          return false;
        }
      }
      return true;
    });
    if (eligible.length === 0) {
      const reason = [...refusals][0];
      throw unavailable(
        reason === 'availability'
          ? 'Every deployment that could serve this task is unavailable right now.'
          : reason === 'zone'
            ? 'No deployment is declared in the data zone this task requires.'
            : reason === 'context'
              ? 'This task is larger than any configured deployment takes.'
              : 'No deployment can serve this task within its cost ceiling.',
      );
    }

    const tight =
      request.latencyBudgetMs !== undefined && request.latencyBudgetMs < TIGHT_LATENCY_MS;
    const rank = (name: string): number => {
      const profile = profileOf(routing, name);
      let score = 0;
      if (request.requiresReasoning && !profile.reasoning) score += 2;
      if (tight && profile.latency !== 'fast') score += 1;
      return score;
    };
    // A stable sort: ties keep the order of preference of the configuration.
    const ordered = eligible
      .map((name, index) => ({ name, index, score: rank(name) }))
      .sort((left, right) => left.score - right.score || left.index - right.index)
      .map((entry) => entry.name);
    const chosen = ordered[0];
    if (!chosen) throw unavailable('No model deployment is configured for this task.');
    const profile = profileOf(routing, chosen);

    if (chosen === (routing.roles[request.role] ?? routing.defaultDeployment)) {
      because.push(routing.roles[request.role] ? 'role-deployment' : 'default-deployment');
    }
    if (request.requiresReasoning) {
      because.push(profile.reasoning ? 'reasoning-deployment' : 'reasoning-unavailable');
    }
    if (zone) because.push('data-zone');
    if (tight) because.push(profile.latency === 'fast' ? 'fast-deployment' : 'latency-tight');
    if (request.costCeilingUsd !== undefined) because.push('under-cost-ceiling');

    return {
      role: request.role,
      deployment: chosen,
      ...sampling(profile, parameters, request, tight, wanted),
      timeoutMs: timeoutFor(routing.timeoutMs, request.latencyBudgetMs),
      retry: retriesFor(request.latencyBudgetMs),
      strictSchema: profile.structuredOutputs,
      fallbackDeployment: ordered.find((name) => name !== chosen) ?? null,
      dataZone: zone ?? null,
      estimatedInputTokens,
      because,
    };
  };

  return {
    route,
    deployments: (role) =>
      role ? configured(role) : [...new Set(MODEL_ROLES.flatMap((name) => configured(name)))],
  };
}

function sampling(
  profile: DeploymentProfile,
  parameters: { temperature: number; effort: ReasoningEffort; maxTokens: number },
  request: RouteRequest,
  tight: boolean,
  wanted: number,
): Pick<Route, 'temperature' | 'reasoningEffort' | 'maxTokens'> {
  if (!profile.reasoning) {
    return { temperature: parameters.temperature, reasoningEffort: null, maxTokens: wanted };
  }
  let level = EFFORTS.indexOf(parameters.effort);
  if (request.requiresReasoning) level += 1;
  if (tight) level = Math.min(level, EFFORTS.indexOf('low'));
  const effort = EFFORTS[Math.min(EFFORTS.length - 1, Math.max(0, level))] ?? 'medium';
  return {
    temperature: null,
    reasoningEffort: effort,
    maxTokens: Math.min(MAX_OUTPUT_TOKENS, wanted + REASONING_HEADROOM[effort]),
  };
}

const timeoutFor = (providerMs: number, latencyBudgetMs: number | undefined): number =>
  latencyBudgetMs === undefined
    ? providerMs
    : Math.max(MIN_TIMEOUT_MS, Math.min(providerMs, Math.floor(latencyBudgetMs)));

function retriesFor(latencyBudgetMs: number | undefined): { transient: number; throttle: number } {
  if (latencyBudgetMs === undefined) return { transient: 2, throttle: 5 };
  if (latencyBudgetMs < TIGHT_LATENCY_MS) return { transient: 1, throttle: 1 };
  if (latencyBudgetMs < MODERATE_LATENCY_MS) return { transient: 1, throttle: 3 };
  return { transient: 2, throttle: 5 };
}
