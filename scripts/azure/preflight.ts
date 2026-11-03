import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './lib/args.js';
import { AzError, realAz } from './lib/az.js';
import { loadPriceSnapshot } from './lib/cost-plan.js';
import { parsePreflightArgs } from './lib/preflight-args.js';
import { MutationRefused } from './lib/readonly-az.js';
import { renderReport, runPreflight } from './lib/preflight.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function listRepoFiles(folder: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.build' || entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(repoRoot, path).split('\\').join('/'));
    }
  };
  try {
    walk(join(repoRoot, folder));
  } catch {
    return [];
  }
  return found;
}

async function main(): Promise<number> {
  const options = parsePreflightArgs(process.argv.slice(2));
  const report = await runPreflight(options, {
    az: realAz,
    now: () => new Date(),
    snapshot: loadPriceSnapshot(),
    listRepoFiles,
  });
  console.log(options.json ? JSON.stringify(report, null, 2) : renderReport(report).join('\n'));
  // 0: inspected and nothing blocks; 2: something blocks, or there was no session to inspect with.
  const blocked = report.findings.some((finding) => finding.status === 'blocked');
  return blocked || (report.mode === 'offline' && !options.offline) ? 2 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof UsageError || error instanceof AzError || error instanceof MutationRefused
        ? error.message
        : 'Unexpected failure. Run again with the same arguments to retry.',
    );
    process.exitCode = 1;
  },
);
