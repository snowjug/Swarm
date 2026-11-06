import type { DeploymentProfile, RoutingConfig } from '../../models/routing-config.js';

/**
 * How tasks are routed when the model is a person's own Gemini model. The operator's routing names the operator's
 * deployments, so it cannot be used: here there is one model, the one the person chose, and it is a thinking model, so
 * the router gives each task an effort and room to finish. No price is known, so none is claimed: a person on their own
 * key is not charged against the free tier's dollar cap, and no cost is estimated for them.
 */
const PROFILE: DeploymentProfile = {
  reasoning: true,
  dataZone: null,
  maxContextChars: null,
  latency: 'standard',
  structuredOutputs: true,
};

const MAX_REMEMBERED = 64;
const made = new Map<string, RoutingConfig>();

/** One routing per model and per operator configuration, so that what the router and cache hold is kept for it. */
export function byokRouting(model: string, base: RoutingConfig): RoutingConfig {
  const known = made.get(model);
  if (known && known.timeoutMs === base.timeoutMs && known.production === base.production)
    return known;
  const routing: RoutingConfig = {
    production: base.production,
    defaultDeployment: model,
    roles: {},
    reasoningDeployment: null,
    fallbackDeployment: null,
    dataZone: null,
    profiles: { [model]: PROFILE },
    prices: [],
    operationBudget: { tokens: base.operationBudget.tokens, usd: 0 },
    cache: { mode: 'off', maxEntries: 0, ttlMs: 0 },
    traceContent: base.traceContent,
    timeoutMs: base.timeoutMs,
  };
  made.delete(model);
  made.set(model, routing);
  while (made.size > MAX_REMEMBERED) {
    const oldest = made.keys().next().value;
    if (oldest === undefined) break;
    made.delete(oldest);
  }
  return routing;
}
