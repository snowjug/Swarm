import { UsageError } from './lib/args.js';
import {
  fetchSmoke,
  formatSmokeSummary,
  parseSmokeArgs,
  PILOT_CHECKS,
  runPilotSmoke,
} from './lib/pilot-smoke.js';

/** A healthy app answers in milliseconds; a replica that was scaled to zero needs several seconds to start. */
const REQUEST_TIMEOUT_MS = 30_000;

async function main(): Promise<number> {
  const { baseUrl } = parseSmokeArgs(process.argv.slice(2));
  console.log(
    `Smoke-testing ${baseUrl}: ${PILOT_CHECKS.length} checks from four read-only requests. No credential is sent, and no cookie or token is printed.\n`,
  );
  const report = await runPilotSmoke(fetchSmoke(baseUrl, REQUEST_TIMEOUT_MS), {
    baseUrl,
    log: (line) => console.log(line),
  });
  console.log(`\n${formatSmokeSummary(report)}`);
  return report.passed ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof UsageError
        ? error.message
        : 'Unexpected failure. Run again with the same address to retry.',
    );
    process.exitCode = 2;
  },
);
