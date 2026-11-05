import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './lib/args.js';
import { AzError, realAz } from './lib/az.js';
import { fetchSmoke, formatSmokeSummary, runPilotSmoke } from './lib/pilot-smoke.js';
import { parseReleaseArgs } from './lib/release-args.js';
import { runReleaseAction } from './lib/release-actions.js';
import { Refusal, type GitPort } from './lib/release-flow.js';
import { checkReadyOn } from './lib/release-http.js';
import { fileRecordStore } from './lib/release-record.js';

/**
 * Release, promote, roll back, finalize or inspect the hosted pilot. Dry run by default: it reads Azure
 * and prints the exact commands. A live run needs --execute and --confirm-resource-group <name>, and is
 * refused when CI=true. See docs/production/release-process.md. Nothing here has run against Azure.
 *
 * Exit codes: 0 done (or a dry run); 1 a step failed or the release was rolled back, so read the output
 * and the record; 2 refused or misused before anything was changed.
 */

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SMOKE_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 15_000;

function git(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['-C', repoRoot, ...args],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolvePromise(stdout)),
    );
  });
}

const gitPort: GitPort = {
  head: async () => (await git(['rev-parse', 'HEAD'])).trim(),
  isClean: async () => (await git(['status', '--porcelain'])).trim() === '',
  show: (sha, path) => git(['show', `${sha}:${path}`]),
};

async function main(): Promise<number> {
  const args = parseReleaseArgs(process.argv.slice(2));
  // The image build uploads the working tree as the build context, and records are written relative to it.
  process.chdir(repoRoot);
  const result = await runReleaseAction(args, {
    az: realAz,
    git: gitPort,
    store: fileRecordStore(resolve(repoRoot, args.recordDir)),
    smoke: async (baseUrl) => {
      console.log(`Smoke-testing ${baseUrl} (four read-only requests, no credential sent).`);
      const report = await runPilotSmoke(fetchSmoke(baseUrl, SMOKE_TIMEOUT_MS), {
        baseUrl,
        log: (line) => console.log(line),
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
        `${error.message}\nUsage: npm run azure:release -- <status|check|build|release|record|promote|rollback|finalize> --subscription <guid> --resource-group <name> --app <name> [--registry <name>] [--execute --confirm-resource-group <name>]\nrecord also needs --commit <sha> --revision <name> --digest sha256:<hex> [--previous <revision>]. See docs/production/release-process.md.`,
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
        `An Azure CLI command failed: ${error.message}\nIf this happened after a step ran, the app may be partly changed. Run "status" and read the latest record in .azure/releases/ before doing anything else.`,
      );
      process.exitCode = 1;
    } else {
      console.error(
        'Unexpected failure. The app may be partly changed: run "status" and read the latest record in .azure/releases/.',
      );
      process.exitCode = 1;
    }
  },
);
