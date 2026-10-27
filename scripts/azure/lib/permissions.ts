export interface PermissionBlock {
  actions?: readonly string[];
  notActions?: readonly string[];
}

/** The control-plane actions a provisioning run needs. Data-plane inference is checked separately. */
export const SUBSCRIPTION_SCOPE_ACTIONS = [
  'Microsoft.Resources/subscriptions/resourceGroups/write',
  'Microsoft.Resources/deployments/write',
  'Microsoft.CognitiveServices/accounts/write',
  'Microsoft.CognitiveServices/accounts/deployments/write',
  'Microsoft.Authorization/roleAssignments/write',
] as const;

export const RESOURCE_GROUP_SCOPE_ACTIONS = SUBSCRIPTION_SCOPE_ACTIONS.filter(
  (action) => !action.includes('resourceGroups/write'),
);

function matches(pattern: string, action: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 'i').test(action);
}

/**
 * ARM semantics: a role grants an action when one of its `actions` matches and none of its own
 * `notActions` matches. Separate role assignments are unioned.
 */
export function actionAllowed(blocks: readonly PermissionBlock[], action: string): boolean {
  return blocks.some(
    (block) =>
      (block.actions ?? []).some((pattern) => matches(pattern, action)) &&
      !(block.notActions ?? []).some((pattern) => matches(pattern, action)),
  );
}

export interface PermissionReport {
  allowed: string[];
  missing: string[];
  ok: boolean;
}

export function evaluatePermissions(
  blocks: readonly PermissionBlock[],
  required: readonly string[],
): PermissionReport {
  const allowed = required.filter((action) => actionAllowed(blocks, action));
  const missing = required.filter((action) => !allowed.includes(action));
  return { allowed, missing, ok: missing.length === 0 };
}
