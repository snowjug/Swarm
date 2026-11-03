import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './lib/args.js';
import { AzError, realAz } from './lib/az.js';
import { parseDrillArgs } from './lib/drill-args.js';
import { fileDrillStore, runDrill } from './lib/drill-flow.js';
import { fetchSmoke, formatSmokeSummary, runPilotSmoke } from './lib/pilot-smoke.js';
import { Refusal } from './lib/release-flow.js';
import { checkReadyOn } from './lib/release-http.js';

/**
 * The rollback drill: release a copy of what serves, shift traffic to it, roll back, and measure. Dry run
 * by default; a live run needs --execute and --confirm-resource-group <name>, and is refused when CI=true.
 * It has NOT been run against Azure: see docs/production/release-process.md for the steps and pass criteria.
 *
 * Exit codes: 0 every criterion passed (or a dry run); 1 a criterion failed or the drill stopped, so read
 * the record; 2 refused or misused before anything was changed.
 */

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SMOKE_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;

async function main(): Promise<number> {
  const args = parseDrillArgs(process.argv.slice(2));
  process.chdir(repoRoot);
  const result = await runDrill(args, {
    az: realAz,
    store: fileDrillStore(resolve(repoRoot, args.recordDir)),
    smoke: async (baseUrl) => {
      const report = await runPilotSmoke(fetchSmoke(baseUrl, SMOKE_TIMEOUT_MS), {
        baseUrl,
        log: () => undefined,
      });
      console.log(formatSmokeSummary(report));
      return report;
    },
    health: (host) => checkReadyOn(host, HEALTH_TIMEOUT_MS),
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
    log: (line) => console.log(line),
    ci: process.env.CI,
  });
  return result.exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(
        `${error.message}\nUsage: npm run azure:rollback-drill -- --subscription <guid> --resource-group <name> --app <name> [--cold] [--execute --confirm-resource-group <name>]\nSee docs/production/release-process.md.`,
      );
      process.exitCode = 2;
    } else if (error instanceof Refusal) {
      console.error(`Refused: ${error.message}`);
      process.exitCode = 2;
    } else if (error instanceof AzError && error.code === 'AZ_NOT_FOUND') {
      console.error(`${error.message}\nNothing was changed.`);
      process.exitCode = 2;
    } else if (error instanceof AzError) {
      console.error(
        `An Azure CLI command failed: ${error.message}\nIf this happened after a step ran, the app may be partly changed: check it with "npm run azure:release -- status" and read the latest record in .azure/drills/.`,
      );
      process.exitCode = 1;
    } else {
      console.error(
        'Unexpected failure. The app may be partly changed: check it with "npm run azure:release -- status".',
      );
      process.exitCode = 1;
    }
  },
);
