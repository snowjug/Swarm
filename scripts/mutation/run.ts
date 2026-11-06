/**
 * Mutation checks for the security rules.
 *
 * Each entry in mutants.json weakens or removes one rule (a role check, a tenant check, the nonce of
 * a sign-in, an expiry) in the working copy of one source file, runs the tests that are meant to
 * guard it, and puts the file back. A mutation that no test notices is reported as SURVIVED and the
 * run fails: it means a rule could be deleted without anyone being told.
 *
 *   npm run mutation:security                     every mutation (about half an hour)
 *   npm run mutation:security -- --area=sign-in   one rule set: membership, sign-in, storage, jobs, telemetry, studio, analyst, budget, access, lab or public
 *   npm run mutation:security -- --only=M3,S8     named mutations
 *   npm run mutation:security -- --list           what would run; this only reads, and changes nothing anywhere
 *
 * It edits files in place and restores them afterwards, including after Ctrl+C. If the process is
 * killed outright, the next run in the same clone restores whatever it left behind before doing
 * anything else, but only a file that is still as the killed run left it, and only from a backup that
 * run made. What a run puts aside is kept under the scratch folder in a folder of its own for the clone
 * (see lib/backups.ts), so that another clone sharing the scratch folder is never touched, and one run
 * at a time may use a clone.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { MutationRun, unmatchedBackups } from './lib/backups.js';
import { applyMutant, loadMutants, ROOT, type Mutant } from './lib/mutants.js';

const TIME_LIMIT_MS = 10 * 60_000;

interface Options {
  list: boolean;
  only: Set<string> | null;
  area: string | null;
}

function parseArguments(argv: string[]): Options {
  const options: Options = { list: false, only: null, area: null };
  for (const argument of argv) {
    if (argument === '--list') options.list = true;
    else if (argument.startsWith('--only=')) {
      options.only = new Set(argument.slice('--only='.length).split(',').filter(Boolean));
    } else if (argument.startsWith('--area=')) options.area = argument.slice('--area='.length);
    else throw new Error(`Unknown option ${argument}. See the top of scripts/mutation/run.ts.`);
  }
  return options;
}
interface Outcome {
  kind: 'killed' | 'survived' | 'error';
  detail: string;
}

function runTests(tests: string[]): Promise<Outcome> {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      [
        resolve(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        ...tests,
        '--bail=1',
        '--maxWorkers=2',
      ],
      { cwd: ROOT, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
    );
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill(), TIME_LIMIT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const failed = /Tests\s+(\d+) failed/u.exec(output)?.[1];
      const first = /^\s*(?:×|FAIL)\s+(.{0,150})/mu.exec(output)?.[1]?.trim() ?? '';
      if (code === 0) done({ kind: 'survived', detail: '' });
      else if (failed) done({ kind: 'killed', detail: first });
      else done({ kind: 'error', detail: `the tests did not run to a result (exit ${code})` });
    });
  });
}

/** What undoes the mutation that is in the working copy now, for a signal that arrives while it is. */
let undo: (() => void) | null = null;

async function check(run: MutationRun, mutant: Mutant): Promise<Outcome> {
  const path = resolve(ROOT, mutant.file);
  const original = readFileSync(path);
  const mutated = applyMutant(original.toString('utf8'), mutant);
  const restore = () => {
    writeFileSync(path, original);
    run.forget(mutant.file);
  };
  // What is put aside, and what it is to be changed to, is on record before the file changes.
  run.record(mutant.file, original, mutated);
  undo = restore;
  try {
    writeFileSync(path, mutated);
    return await runTests(mutant.tests);
  } finally {
    undo = null;
    restore();
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const selected = loadMutants().filter(
    (mutant) =>
      (!options.only || options.only.has(mutant.id)) &&
      (!options.area || mutant.area === options.area),
  );
  if (selected.length === 0) throw new Error('No mutation matches.');
  if (options.list) {
    // Listing only reads: it takes no lock, puts nothing back and makes nothing.
    for (const mutant of selected)
      console.log(`${mutant.id.padEnd(4)} ${mutant.area.padEnd(10)} ${mutant.claim}`);
    return;
  }
  const scratch = tmpdir();
  const run = MutationRun.start({ root: ROOT, scratch });
  const older = unmatchedBackups(scratch);
  if (older.length > 0) {
    console.warn(
      `Ignored ${older.length} backup(s) in ${scratch} that an older version of this script left without saying which clone they were for.`,
    );
  }
  const onSignal = () => {
    undo?.();
    run.release();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const problems: string[] = [];
  let killed = 0;
  try {
    for (const mutant of selected) {
      let outcome: Outcome;
      try {
        outcome = await check(run, mutant);
      } catch (error) {
        outcome = { kind: 'error', detail: error instanceof Error ? error.message : String(error) };
      }
      const label = outcome.kind.toUpperCase().padEnd(8);
      console.log(
        `${mutant.id.padEnd(4)} ${label} ${mutant.claim}${outcome.detail ? `\n       ${outcome.detail}` : ''}`,
      );
      if (outcome.kind === 'killed') killed++;
      else problems.push(`${mutant.id} ${outcome.kind}: ${mutant.claim}`);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    run.release();
  }
  console.log(`\n${killed} of ${selected.length} mutations were caught by a failing test.`);
  if (problems.length > 0) {
    console.error(`\nNot caught:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
