// The offline checks of infra/public (the public edition): what bicep.mjs does for infra/pilot, for a template at SUBSCRIPTION scope that
// reuses the pilot's modules by reference. Nothing here reaches Azure or the network; `bicep snapshot` evaluates the deployment locally.
//
// bicep.mjs is left as it is for the pilot: its evaluate() copies infra/pilot only and names a resource group, and its declarations
// (bicep.d.mts) are the pilot's. The templates themselves are listed in TEMPLATES there, so the existing build, lint and duplicate checks
// run on them.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLACEHOLDER_SUBSCRIPTION,
  PLACEHOLDER_TENANT,
  REPO_ROOT,
  checkEnvironment,
  parseDiagnostics,
  runBicep,
} from './bicep.mjs';

export const PUBLIC_PARAM_FILE = 'infra/public/main.bicepparam';

/**
 * The values the public parameter file reads from the environment, made up. None is a real identifier or a secret: the account is in a
 * group that cannot exist, the key is a placeholder of the length the template requires, and the all-zero subscription cannot exist.
 * Every variable has the SWARM_PUBLIC_ prefix, which bicep.mjs removes from the caller's environment, so a real value never leaks in.
 */
export const PUBLIC_PLACEHOLDER_ENV = {
  SWARM_PUBLIC_DEPLOY_APP: 'true',
  SWARM_PUBLIC_AI_ACCOUNT_RESOURCE_ID: `/subscriptions/${PLACEHOLDER_SUBSCRIPTION}/resourceGroups/rg-example-ai/providers/Microsoft.CognitiveServices/accounts/ai-example`,
  SWARM_PUBLIC_AI_DEPLOYMENT_NAME: 'swarm-free',
  SWARM_PUBLIC_MODEL_INPUT_PRICE_USD: '0.40',
  SWARM_PUBLIC_MODEL_OUTPUT_PRICE_USD: '1.60',
  SWARM_PUBLIC_GOOGLE_CLIENT_ID: 'example-google-client-id.invalid',
  SWARM_PUBLIC_GITHUB_CLIENT_ID: 'example-github-client-id',
  SWARM_PUBLIC_CONTAINER_IMAGE: `crexample.azurecr.io/swarm@sha256:${'0'.repeat(64)}`,
  SWARM_PUBLIC_OPS_KEY: 'placeholder-ops-key-not-a-secret-0000',
  SWARM_PUBLIC_OPS_KEY_SHA256: '0'.repeat(64),
  SWARM_PUBLIC_ALERT_EMAIL: 'owner@example.invalid',
  SWARM_PUBLIC_BUDGET_AMOUNT: '100',
  SWARM_PUBLIC_BUDGET_CURRENCY: 'USD',
};

/** What only the container app needs: the first deployment has no app, so it needs no provider and no image. */
const ONLY_WITH_THE_APP = [
  'SWARM_PUBLIC_GOOGLE_CLIENT_ID',
  'SWARM_PUBLIC_GITHUB_CLIENT_ID',
  'SWARM_PUBLIC_CONTAINER_IMAGE',
];

/** The first deployment: no app. */
export const PUBLIC_FOUNDATION_ENV = {
  ...Object.fromEntries(
    Object.entries(PUBLIC_PLACEHOLDER_ENV).filter(([name]) => !ONLY_WITH_THE_APP.includes(name)),
  ),
  SWARM_PUBLIC_DEPLOY_APP: 'false',
};

/** Every variable whose absence must stop a deployment before anything is created: no default, or an empty value the template refuses. */
export const PUBLIC_REQUIRED_VARIABLES = [
  'SWARM_PUBLIC_DEPLOY_APP',
  'SWARM_PUBLIC_AI_ACCOUNT_RESOURCE_ID',
  'SWARM_PUBLIC_AI_DEPLOYMENT_NAME',
  'SWARM_PUBLIC_MODEL_INPUT_PRICE_USD',
  'SWARM_PUBLIC_MODEL_OUTPUT_PRICE_USD',
  'SWARM_PUBLIC_OPS_KEY',
  'SWARM_PUBLIC_OPS_KEY_SHA256',
  'SWARM_PUBLIC_ALERT_EMAIL',
  'SWARM_PUBLIC_BUDGET_AMOUNT',
  'SWARM_PUBLIC_BUDGET_CURRENCY',
];

/** Compiles the parameter file with exactly `env` (and nothing else of the SWARM_ family), optionally with one variable left out. */
export function buildPublicParams(bicep, env, without = []) {
  const environment = checkEnvironment(env);
  for (const name of without) delete environment[name];
  const result = runBicep(bicep, ['build-params', '--stdout', PUBLIC_PARAM_FILE], {
    env: environment,
  });
  const parameters =
    result.status === 0 ? JSON.parse(JSON.parse(result.stdout).parametersJson).parameters : null;
  return { status: result.status, parameters, diagnostics: parseDiagnostics(result.stderr) };
}

let runCounter = 0;

/**
 * What a deployment of the public parameter file WOULD create, evaluated offline by `bicep snapshot` (see bicep.mjs, evaluate): the same
 * work, for a template at subscription scope. It needs infra/pilot as well as infra/public, because the template uses the pilot's modules
 * by relative path, so both are copied into a work folder of their own and the repository is never touched.
 *
 * A deployment that a check in modules/guards.bicep refuses does not produce a snapshot: `status` is not 0 and `diagnostics` holds
 * Azure Resource Manager's message, which names the check.
 */
export function evaluatePublic(bicep, env, without = []) {
  const buildRoot = join(REPO_ROOT, 'infra', '.build');
  mkdirSync(buildRoot, { recursive: true });
  runCounter += 1;
  const work = join(buildRoot, `public-${process.pid}-${runCounter}`);
  try {
    cpSync(join(REPO_ROOT, 'infra', 'pilot'), join(work, 'pilot'), { recursive: true });
    cpSync(join(REPO_ROOT, 'infra', 'public'), join(work, 'public'), { recursive: true });
    const environment = checkEnvironment(env);
    for (const name of without) delete environment[name];
    const result = runBicep(
      bicep,
      [
        'snapshot',
        join(work, 'public', 'main.bicepparam'),
        '--mode',
        'overwrite',
        '--tenant-id',
        PLACEHOLDER_TENANT,
        '--subscription-id',
        PLACEHOLDER_SUBSCRIPTION,
        '--location',
        'centralindia',
      ],
      { env: environment, cwd: work },
    );
    const snapshotPath = join(work, 'public', 'main.snapshot.json');
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
