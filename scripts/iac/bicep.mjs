// Everything the IaC checks share: finding the pinned Bicep CLI, running it, reading what it says, and
// evaluating a parameter file offline (`bicep snapshot`) into the resources a deployment WOULD create.
// Nothing here reaches Azure or the network: Bicep compiles and evaluates the templates locally.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCK = JSON.parse(
  readFileSync(join(REPO_ROOT, 'scripts/iac/bicep.lock.json'), 'utf8'),
);

/** Every template the repository ships. Each is built and linted on its own as well as through main.bicep. */
export const TEMPLATES = [
  'infra/main.bicep',
  'infra/modules/ai-services.bicep',
  'infra/pilot/main.bicep',
  'infra/pilot/modules/ai-access.bicep',
  'infra/pilot/modules/alerts.bicep',
  'infra/pilot/modules/appinsights-access.bicep',
  'infra/pilot/modules/budget.bicep',
  'infra/pilot/modules/container-app.bicep',
  'infra/pilot/modules/environment-existing.bicep',
  'infra/pilot/modules/environment-new.bicep',
  'infra/pilot/modules/key-vault.bicep',
  'infra/pilot/modules/monitoring.bicep',
  'infra/pilot/modules/network.bicep',
  'infra/pilot/modules/postgres.bicep',
  'infra/pilot/modules/registry.bicep',
  'infra/public/main.bicep',
  'infra/public/modules/action-groups.bicep',
  'infra/public/modules/alerts.bicep',
  'infra/public/modules/container-app.bicep',
  'infra/public/modules/guards.bicep',
  'infra/public/modules/identity.bicep',
  'infra/public/modules/model-deployment.bicep',
];

export const PARAM_FILES = {
  pilot: 'infra/pilot/main.bicepparam',
  'production-shaped': 'infra/pilot/production-shaped.bicepparam',
};

/**
 * The values a parameter file reads from the environment, made up. They are not real identifiers (the
 * all-zero subscription and tenant cannot exist) and not secrets, and they only let the files compile.
 */
export const PLACEHOLDER_SUBSCRIPTION = '00000000-0000-0000-0000-000000000000';
export const PLACEHOLDER_TENANT = '00000000-0000-0000-0000-0000000000aa';
export const PLACEHOLDER_ENV = {
  SWARM_AI_ACCOUNT_RESOURCE_ID: `/subscriptions/${PLACEHOLDER_SUBSCRIPTION}/resourceGroups/rg-example/providers/Microsoft.CognitiveServices/accounts/ai-example`,
  SWARM_AUTH_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
  SWARM_ALERT_EMAIL: 'owner@example.invalid',
  // Required with no default: an app that exists must never be reset to the placeholder by a forgotten value.
  SERVICE_SWARM_RESOURCE_EXISTS: 'false',
};

/** Variables the parameter files read; removed from the caller's environment so a real value never leaks into a check. */
const PARAMETER_VARIABLES = /^(SWARM_|AZURE_ENV_NAME$|SERVICE_SWARM_)/u;

const EXECUTABLE = process.platform === 'win32' ? 'bicep.exe' : 'bicep';

/** Looks, in order, at BICEP_PATH, the PATH, `az bicep install`'s folder and ~/.local/bin. */
export function findBicep(env = process.env) {
  const candidates = [];
  if (env.BICEP_PATH) candidates.push(env.BICEP_PATH);
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (dir) candidates.push(join(dir, EXECUTABLE));
  }
  candidates.push(
    join(homedir(), '.azure', 'bin', EXECUTABLE),
    join(homedir(), '.local', 'bin', EXECUTABLE),
  );
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const result = spawnSync(path, ['--version'], { encoding: 'utf8', env });
    if (result.status === 0) {
      const version = /(\d+\.\d+\.\d+)/u.exec(result.stdout)?.[1] ?? null;
      return { path, version, pinned: version === LOCK.version };
    }
  }
  return null;
}

export function runBicep(bicep, args, options = {}) {
  const result = spawnSync(bicep.path, args, {
    encoding: 'utf8',
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const DIAGNOSTIC =
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\) : (?<level>Error|Warning|Info) (?<code>[\w-]+): (?<message>.*?)(?: \[https?:\/\/\S+\])?$/u;

/** Bicep prints `<file>(line,col) : <Level> <code>: <message> [link]`; any other line it prints is kept as an error. */
export function parseDiagnostics(text) {
  const found = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const match = DIAGNOSTIC.exec(line);
    if (match?.groups) {
      const { file, line: row, column, level, code, message } = match.groups;
      found.push({ file, line: Number(row), column: Number(column), level, code, message });
    } else {
      found.push({
        file: '',
        line: 0,
        column: 0,
        level: 'Error',
        code: 'unparsed',
        message: line.trim(),
      });
    }
  }
  return found;
}

/** The environment a check runs with: the caller's, minus parameter variables, plus the placeholders and `extra`. */
export function checkEnvironment(extra = {}, base = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && !PARAMETER_VARIABLES.test(name)) env[name] = value;
  }
  return { ...env, ...PLACEHOLDER_ENV, ...extra };
}

/** Compiles a template. `json` is the ARM template; every warning or error is in `diagnostics`. */
export function build(bicep, file) {
  const result = runBicep(bicep, ['build', '--stdout', file]);
  const json = result.status === 0 ? JSON.parse(result.stdout) : null;
  return { status: result.status, json, diagnostics: parseDiagnostics(result.stderr) };
}

/** Runs the linter. Rules and their levels are in infra/bicepconfig.json. */
export function lint(bicep, file) {
  const result = runBicep(bicep, ['lint', file]);
  return {
    status: result.status,
    diagnostics: parseDiagnostics(`${result.stdout}\n${result.stderr}`),
  };
}

/** Compiles a parameter file, which needs the placeholder environment. */
export function buildParams(bicep, file, extraEnv = {}) {
  const result = runBicep(bicep, ['build-params', '--stdout', file], {
    env: checkEnvironment(extraEnv),
  });
  const parameters =
    result.status === 0 ? JSON.parse(JSON.parse(result.stdout).parametersJson).parameters : null;
  return { status: result.status, parameters, diagnostics: parseDiagnostics(result.stderr) };
}

/**
 * The same parameter file with some of its environment unset (by default all of it): a required value
 * must make it fail, and `names` leaves out exactly the ones to test.
 */
export function buildParamsWithoutEnvironment(bicep, file, names = Object.keys(PLACEHOLDER_ENV)) {
  const env = checkEnvironment();
  for (const name of names) delete env[name];
  const result = runBicep(bicep, ['build-params', '--stdout', file], { env });
  return { status: result.status, diagnostics: parseDiagnostics(result.stderr) };
}

/**
 * What a deployment of this parameter file would create, evaluated offline by `bicep snapshot`: every
 * condition decided, every module expanded, every expression that does not need Azure resolved. A value
 * that only Azure can know (a resource's runtime property) is left as its `[reference(...)]` expression.
 *
 * `bicep snapshot` writes next to the parameter file, so the template folder is copied into a work
 * folder of its own first: the repository is never touched and two runs cannot meet.
 */
let runCounter = 0;
export function evaluate(bicep, paramFile, extraEnv = {}) {
  const buildRoot = join(REPO_ROOT, 'infra', '.build');
  mkdirSync(buildRoot, { recursive: true });
  runCounter += 1;
  const work = join(buildRoot, `run-${process.pid}-${runCounter}`);
  try {
    cpSync(join(REPO_ROOT, 'infra', 'pilot'), join(work, 'pilot'), { recursive: true });
    const name = (paramFile.split('/').pop() ?? '').replace(/\.bicepparam$/u, '');
    const result = runBicep(
      bicep,
      [
        'snapshot',
        join(work, 'pilot', `${name}.bicepparam`),
        '--mode',
        'overwrite',
        '--tenant-id',
        PLACEHOLDER_TENANT,
        '--subscription-id',
        PLACEHOLDER_SUBSCRIPTION,
        '--resource-group',
        'rg-example',
        '--location',
        'centralindia',
      ],
      { env: checkEnvironment(extraEnv), cwd: work },
    );
    const snapshotPath = join(work, 'pilot', `${name}.snapshot.json`);
    if (result.status !== 0 || !existsSync(snapshotPath)) {
      return {
        status: result.status || 1,
        snapshot: null,
        diagnostics: parseDiagnostics(`${result.stdout}\n${result.stderr}`),
      };
    }
    return { status: 0, snapshot: JSON.parse(readFileSync(snapshotPath, 'utf8')), diagnostics: [] };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
