import type { Scope } from './containerapp.js';

/**
 * Where to read why a revision did not start. `az containerapp update` waits for the revision and then
 * says little; the reason is in the console log of the container (an uncaught error, a refused
 * configuration) and in the platform's system log (a probe that failed, "Deployment Progress Deadline
 * Exceeded. 0/1 replicas ready.", a container that ended with exit code 1).
 *
 * Both tables are read in Log Analytics. Their columns were read from the live pilot's workspace
 * (ContainerAppConsoleLogs_CL and ContainerAppSystemLogs_CL: ContainerAppName_s, RevisionName_s, Log_s,
 * Stream_s, Reason_s). Lines arrive a few minutes after they are written.
 */

/** A name that may go inside a KQL string and a shell command: what Azure allows in an app or revision name. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function consoleLogQuery(app: string, revision: string): string {
  return `ContainerAppConsoleLogs_CL | where ContainerAppName_s == '${app}' and RevisionName_s == '${revision}' | project TimeGenerated, Stream_s, Log_s | order by TimeGenerated desc | take 100`;
}

export function systemLogQuery(app: string, revision: string): string {
  return `ContainerAppSystemLogs_CL | where ContainerAppName_s == '${app}' and RevisionName_s == '${revision}' | project TimeGenerated, Reason_s, Log_s | order by TimeGenerated desc | take 50`;
}

/**
 * The commands that read both logs of a revision. `environmentId` is the app's `properties.environmentId`;
 * without it the workspace is looked up by name in the message instead.
 */
export function revisionLogHelp(
  scope: Scope,
  revision: string,
  environmentId: string | null = null,
): string {
  if (!SAFE_NAME.test(scope.app) || !SAFE_NAME.test(revision)) {
    return 'Read the console and system logs of the revision in Log Analytics (tables ContainerAppConsoleLogs_CL and ContainerAppSystemLogs_CL).';
  }
  const workspace = environmentId
    ? `WS=$(az containerapp env show --ids ${environmentId} --query properties.appLogsConfiguration.logAnalyticsConfiguration.customerId -o tsv)`
    : 'WS=<customer id of the Log Analytics workspace of the environment>';
  return [
    `Why ${revision} did not start is in its logs (lines arrive a few minutes after they are written):`,
    `  ${workspace}`,
    `  az monitor log-analytics query --workspace "$WS" -o table --analytics-query "${consoleLogQuery(scope.app, revision)}"`,
    `  az monitor log-analytics query --workspace "$WS" -o table --analytics-query "${systemLogQuery(scope.app, revision)}"`,
    `  or, while a replica exists: az containerapp logs show --name ${scope.app} --resource-group ${scope.resourceGroup} --subscription ${scope.subscription} --revision ${revision} --type console --tail 100`,
    'Look in the console log for "Invalid server configuration: <names>" (a refused setting such as PORT) and in the system log for ProbeFailed, ContainerTerminated and "Deployment Progress Deadline Exceeded".',
  ].join('\n');
}
