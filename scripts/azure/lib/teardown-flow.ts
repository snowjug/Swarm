import type { TeardownArgs } from './args.js';
import { AzError, type AzClient } from './az.js';
import { assessSubscription, type SubscriptionInfo } from './subscription.js';

const PROJECT_TAG = 'swarm-lab';

export type TeardownStatus = 'blocked' | 'nothing-to-delete' | 'needs-confirmation' | 'deleted';

export interface TeardownResult {
  status: TeardownStatus;
  messages: string[];
}

interface AccountRow {
  name: string;
  location: string;
  tags?: Record<string, string> | null;
}

/**
 * Deletes only what this project created. A resource group is removed whole only when it carries
 * the project tag; otherwise just the tagged accounts inside it are removed.
 */
export async function runTeardown(args: TeardownArgs, az: AzClient): Promise<TeardownResult> {
  const messages: string[] = [];
  const say = (line: string) => messages.push(line);

  const subscription = await az.json<SubscriptionInfo>([
    'account',
    'show',
    '--subscription',
    args.subscription,
  ]);
  const assessment = assessSubscription(subscription, { allowProductionNames: false });
  if (!assessment.ok) {
    assessment.problems.forEach((problem) => say(`BLOCKED: ${problem}`));
    return { status: 'blocked', messages };
  }

  let group: { tags?: Record<string, string> | null };
  try {
    group = await az.json([
      'group',
      'show',
      '--subscription',
      args.subscription,
      '--name',
      args.resourceGroup,
    ]);
  } catch (error) {
    if (error instanceof AzError) {
      say(`Resource group "${args.resourceGroup}" was not found or is not visible.`);
      return { status: 'nothing-to-delete', messages };
    }
    throw error;
  }

  const accounts = await az.json<AccountRow[]>([
    'cognitiveservices',
    'account',
    'list',
    '--subscription',
    args.subscription,
    '--resource-group',
    args.resourceGroup,
    '--query',
    '[].{name:name,location:location,tags:tags}',
  ]);
  const owned = accounts.filter((account) => account.tags?.app === PROJECT_TAG);
  const wholeGroup = group.tags?.app === PROJECT_TAG;

  if (!wholeGroup && owned.length === 0) {
    say(
      `BLOCKED: nothing in "${args.resourceGroup}" is tagged app=${PROJECT_TAG}, so nothing was touched.`,
    );
    return { status: 'blocked', messages };
  }
  say(
    wholeGroup
      ? `Will delete resource group "${args.resourceGroup}" (tagged app=${PROJECT_TAG}) and purge ${owned.length} account(s).`
      : `Will delete ${owned.length} tagged account(s) in "${args.resourceGroup}" and keep the group.`,
  );
  if (!args.yes) {
    say('Nothing was deleted. Re-run with --yes to proceed.');
    return { status: 'needs-confirmation', messages };
  }

  if (wholeGroup) {
    await az.text([
      'group',
      'delete',
      '--subscription',
      args.subscription,
      '--name',
      args.resourceGroup,
      '--yes',
    ]);
  } else {
    for (const account of owned) {
      await az.text([
        'cognitiveservices',
        'account',
        'delete',
        '--subscription',
        args.subscription,
        '--resource-group',
        args.resourceGroup,
        '--name',
        account.name,
      ]);
    }
  }
  // Deleted accounts stay soft-deleted for days and block re-creating the same name until purged.
  for (const account of owned) {
    try {
      await az.text([
        'cognitiveservices',
        'account',
        'purge',
        '--subscription',
        args.subscription,
        '--resource-group',
        args.resourceGroup,
        '--name',
        account.name,
        '--location',
        account.location,
      ]);
      say(`Purged ${account.name}.`);
    } catch {
      say(
        `Could not purge ${account.name}; it will be purged automatically when its retention ends.`,
      );
    }
  }
  say('Done.');
  return { status: 'deleted', messages };
}
