import { parseVerifyArgs, UsageError } from './lib/args.js';
import { fetchHttp } from './lib/verify-http.js';
import { formatReport, runLiveVerification } from './lib/verify-flow.js';

/** A real model can take a while to answer a follow-up; a stalled request must still end. */
const REQUEST_TIMEOUT_MS = 180_000;
const POLL_MS = 1_500;

async function main(): Promise<number> {
  const args = parseVerifyArgs(process.argv.slice(2));
  if (!args.json) {
    const auth = args.expectAuth ? ` using ${args.expectAuth} authentication` : '';
    const probe = args.probe ? '' : ' Hidden-instruction probe disabled (--no-probe).';
    console.log(
      `Verifying ${args.baseUrl} with ${args.agents} proxies over ${args.rounds} rounds, expecting provider ${args.expectProvider}${auth}.${probe}\n`,
    );
  }
  const report = await runLiveVerification(fetchHttp(args.baseUrl, REQUEST_TIMEOUT_MS), {
    expectProvider: args.expectProvider,
    expectAuth: args.expectAuth,
    agents: args.agents,
    rounds: args.rounds,
    probe: args.probe,
    stepTimeoutMs: args.stepTimeoutMinutes * 60_000,
    pollMs: POLL_MS,
    log: args.json ? undefined : (line) => console.log(line),
  });
  console.log(args.json ? JSON.stringify(report, null, 2) : `\n${formatReport(report)}`);
  return report.verified ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof UsageError
        ? error.message
        : 'Unexpected failure. Run again with the same arguments to retry.',
    );
    process.exitCode = 2;
  },
);
