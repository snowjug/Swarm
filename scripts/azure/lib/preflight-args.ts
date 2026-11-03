import { parseArgs } from 'node:util';
import { UsageError } from './args.js';
import type { PreflightOptions } from './preflight.js';
import { PROFILES, type Profile } from './cost-plan.js';
import { isGuid } from './subscription.js';

const REGION = /^[a-z0-9]{3,30}$/u;

export interface PreflightCliOptions extends PreflightOptions {
  json: boolean;
}

export function parsePreflightArgs(argv: readonly string[]): PreflightCliOptions {
  let values;
  try {
    values = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        subscription: { type: 'string' },
        region: { type: 'string', default: 'centralindia' },
        'fallback-region': { type: 'string', default: 'eastus2' },
        profile: { type: 'string', default: 'pilot' },
        offline: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        'show-ids': { type: 'boolean', default: false },
      },
    }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Invalid arguments.');
  }
  const subscription = values.subscription;
  if (subscription !== undefined && !isGuid(subscription)) {
    throw new UsageError('--subscription must be a subscription id (guid).');
  }
  const region = values.region ?? 'centralindia';
  const fallbackRegion = values['fallback-region'] ?? 'eastus2';
  for (const [flag, value] of [
    ['--region', region],
    ['--fallback-region', fallbackRegion],
  ] as const) {
    if (!REGION.test(value))
      throw new UsageError(`${flag} must be an Azure region name such as centralindia.`);
  }
  const profile = values.profile ?? 'pilot';
  if (!Object.hasOwn(PROFILES, profile)) {
    throw new UsageError(`--profile must be one of: ${Object.keys(PROFILES).join(', ')}.`);
  }
  return {
    subscription,
    region,
    fallbackRegion,
    profile: profile as Profile,
    offline: values.offline ?? false,
    json: values.json ?? false,
    showIds: values['show-ids'] ?? false,
  };
}
