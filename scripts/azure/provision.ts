import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProvisionArgs, UsageError } from './lib/args.js';
import { AzError, realAz } from './lib/az.js';
import { updateEnvFile } from './lib/env-file.js';
import { runProvision, type ProvisionResult } from './lib/provision-flow.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function print(result: ProvisionResult): void {
  result.messages.forEach((line) => console.log(line));
  if (result.status === 'models-listed' || result.status === 'no-candidate') {
    result.candidates.slice(0, 10).forEach((candidate, index) => {
      const quota =
        candidate.quotaAvailable === null
          ? 'quota unknown'
          : `${candidate.quotaAvailable}K quota free`;
      console.log(
        `${index + 1}. ${candidate.modelName} ${candidate.modelVersion} · ${candidate.sku} · ${candidate.region} · ${candidate.capacity}K TPM · ${quota}`,
      );
    });
  }
}

async function main(): Promise<number> {
  const args = parseProvisionArgs(process.argv.slice(2));
  const result = await runProvision(args, {
    az: realAz,
    now: () => new Date(),
    repoRoot,
    writeParameters: async (content) => {
      const directory = await mkdtemp(join(tmpdir(), 'swarm-azure-'));
      const path = join(directory, 'parameters.json');
      await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
      return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
    },
    updateEnv: (updates) => updateEnvFile(join(repoRoot, '.env'), updates),
  });
  print(result);
  if (result.status === 'failed') return 1;
  return result.status.startsWith('blocked') ||
    result.status === 'not-logged-in' ||
    result.status === 'no-candidate'
    ? 2
    : 0;
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
