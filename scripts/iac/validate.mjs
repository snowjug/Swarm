// Offline validation of every Bicep template and parameter file: compile, lint, and evaluate what a
// deployment would create. It never reaches Azure or the network.
//
//   npm run iac:validate              runs when the Bicep CLI is found, and says plainly that it skipped when not
//   CI=true npm run iac:validate      (or --strict) a missing or unpinned Bicep CLI is a failure, never a skip
//   npm run iac:validate -- --json    the same checks as one JSON document (the CI summary reads it)
//
// The pinned CLI version and its checksums are in scripts/iac/bicep.lock.json; scripts/iac/install-bicep.mjs
// installs it. The invariants of the compiled templates are asserted by scripts/iac/infra-invariants.test.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  PARAM_FILES,
  TEMPLATES,
  build,
  buildParams,
  buildParamsWithoutEnvironment,
  evaluate,
  findBicep,
  lint,
  LOCK,
} from './bicep.mjs';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict') || process.env.CI === 'true';
const asJson = args.has('--json');

const checks = [];
const record = (name, status, detail = '') => {
  checks.push({ name, status, detail });
  if (!asJson) {
    const label = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', warn: 'WARN' }[status];
    console.log(
      `${label}  ${name}${detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`,
    );
  }
};

const describeDiagnostics = (diagnostics) =>
  diagnostics
    .filter((item) => item.level !== 'Info')
    .map(
      (item) =>
        `${item.file}(${item.line},${item.column}) ${item.level} ${item.code}: ${item.message}`,
    )
    .join('\n');

function finish(code) {
  const failed = checks.filter((check) => check.status === 'fail').length;
  const skipped = checks.filter((check) => check.status === 'skip').length;
  if (asJson) {
    console.log(JSON.stringify({ strict, bicep: bicepSummary, failed, skipped, checks }, null, 2));
  } else {
    console.log(
      code === 0
        ? skipped > 0
          ? `\nRESULT: SKIPPED. ${skipped} check(s) did not run: the Bicep CLI was not found, and this is not CI.`
          : `\nRESULT: PASSED. ${checks.length} checks.`
        : `\nRESULT: FAILED. ${failed} of ${checks.length} checks failed.`,
    );
  }
  process.exit(code);
}

const bicep = findBicep();
const bicepSummary = bicep ? { version: bicep.version, pinned: bicep.pinned } : null;

if (!bicep) {
  const how = `Install Bicep ${LOCK.version} with: node scripts/iac/install-bicep.mjs`;
  if (strict) {
    record(
      'Bicep CLI is installed',
      'fail',
      `Not found, and a strict run (CI=true or --strict) does not skip. ${how}`,
    );
    finish(1);
  }
  record('Bicep CLI is installed', 'skip', `Not found: every template check is skipped. ${how}`);
  finish(0);
}

record('Bicep CLI is installed', 'pass', `${bicep.path} (version ${bicep.version})`);
if (!bicep.pinned) {
  record(
    `Bicep CLI is the pinned version ${LOCK.version}`,
    strict ? 'fail' : 'warn',
    `Found ${bicep.version}. Diagnostics and evaluation differ between versions, so a result under another version is not the result CI sees.`,
  );
} else {
  const asset = LOCK.assets[`${process.platform}-${process.arch}`];
  if (asset) {
    const actual = createHash('sha256').update(readFileSync(bicep.path)).digest('hex');
    record(
      'Bicep CLI binary matches the pinned SHA-256',
      actual === asset.sha256 ? 'pass' : strict ? 'fail' : 'warn',
      actual === asset.sha256
        ? ''
        : `Expected ${asset.sha256} for ${asset.file}, got ${actual}. Reinstall with: node scripts/iac/install-bicep.mjs`,
    );
  }
}

for (const file of TEMPLATES) {
  const built = build(bicep, file);
  const problems = describeDiagnostics(built.diagnostics);
  record(`bicep build ${file}`, built.status === 0 && !problems ? 'pass' : 'fail', problems);
  const linted = lint(bicep, file);
  const lintProblems = describeDiagnostics(linted.diagnostics);
  record(
    `bicep lint ${file}`,
    linted.status === 0 && !lintProblems ? 'pass' : 'fail',
    lintProblems,
  );
}

for (const [profile, file] of Object.entries(PARAM_FILES)) {
  const compiled = buildParams(bicep, file);
  const problems = describeDiagnostics(compiled.diagnostics);
  record(
    `bicep build-params ${file} (placeholder environment)`,
    compiled.status === 0 && !problems ? 'pass' : 'fail',
    problems,
  );

  const bare = buildParamsWithoutEnvironment(bicep, file);
  record(
    `${profile}: an unset required value stops the deployment before anything is created`,
    bare.status !== 0 ? 'pass' : 'fail',
    bare.status !== 0
      ? ''
      : 'The parameter file compiled with its required environment variables unset.',
  );

  const evaluated = evaluate(bicep, file);
  const snapshotProblems = evaluated.snapshot ? (evaluated.snapshot.diagnostics ?? []) : [];
  const resources = evaluated.snapshot ? evaluated.snapshot.predictedResources.length : 0;
  record(
    `${profile}: bicep snapshot evaluates the deployment offline`,
    evaluated.status === 0 && snapshotProblems.length === 0 ? 'pass' : 'fail',
    evaluated.status !== 0
      ? describeDiagnostics(evaluated.diagnostics)
      : snapshotProblems.length > 0
        ? snapshotProblems.map((problem) => JSON.stringify(problem)).join('\n')
        : `${resources} resources predicted`,
  );
}

finish(checks.some((check) => check.status === 'fail') ? 1 : 0);
