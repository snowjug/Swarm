export interface SubscriptionInfo {
  id: string;
  name: string;
  state: string;
}

export interface SubscriptionAssessment {
  ok: boolean;
  problems: string[];
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "NonProd" must pass while "-PROD-", "[Prod]" and "_Prod" must not.
const PRODUCTION_NAME = /(^|[^a-z0-9])(prod|production|prd)([^a-z0-9]|$)/i;

export function isGuid(value: string): boolean {
  return GUID.test(value);
}

/**
 * Safety net, not the primary control: the operator must name the subscription explicitly, and
 * this refuses disabled subscriptions and names that look like production.
 */
export function assessSubscription(
  subscription: SubscriptionInfo,
  options: { allowProductionNames?: boolean } = {},
): SubscriptionAssessment {
  const problems: string[] = [];
  if (subscription.state.toLowerCase() !== 'enabled') {
    problems.push(`Subscription state is "${subscription.state}", not Enabled.`);
  }
  if (!options.allowProductionNames && PRODUCTION_NAME.test(subscription.name)) {
    problems.push(
      `Subscription name "${subscription.name}" looks like production. Pick a development subscription, or pass --allow-production-name if this is a deliberate exception.`,
    );
  }
  return { ok: problems.length === 0, problems };
}
