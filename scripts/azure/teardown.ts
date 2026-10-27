import { parseTeardownArgs, UsageError } from './lib/args.js';
import { AzError, realAz } from './lib/az.js';
import { runTeardown } from './lib/teardown-flow.js';

async function main(): Promise<number> {
  const result = await runTeardown(parseTeardownArgs(process.argv.slice(2)), realAz);
  result.messages.forEach((line) => console.log(line));
  return result.status === 'blocked' ? 2 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof UsageError || error instanceof AzError
        ? error.message
        : 'Unexpected failure. Run again with the same arguments to retry.',
    );
    process.exitCode = 1;
  },
);
