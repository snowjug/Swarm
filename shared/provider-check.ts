import type { CheckStage, DeploymentCheck, ProviderCheck } from './types.js';

/**
 * How a connection check is read, in one place for the page, the scripts and the tests, so that none of
 * them can call a working connection a failed one, or a check that confirmed three of four things a pass.
 */
export const CHECK_STAGES = [
  'reachable',
  'authenticated',
  'deploymentFound',
  'structuredOutput',
] as const;
export type CheckStageName = (typeof CHECK_STAGES)[number];

export const CHECK_STAGE_LABELS: Record<CheckStageName, string> = {
  reachable: 'Reachable',
  authenticated: 'Authenticated',
  deploymentFound: 'Deployment found',
  structuredOutput: 'Structured output',
};

export interface CheckProblem {
  deployment: string | null;
  stage: CheckStageName;
  state: 'failed' | 'unknown';
  detail: string | null;
}

function stageOf(check: DeploymentCheck, stage: CheckStageName): CheckStage {
  return check[stage];
}

/** The first stage of the check that is not confirmed, a failure before an unknown, or null if all four are. */
export function firstProblem(deployments: readonly DeploymentCheck[]): CheckProblem | null {
  for (const wanted of ['failed', 'unknown'] as const) {
    for (const stage of CHECK_STAGES) {
      for (const deployment of deployments) {
        const found = stageOf(deployment, stage);
        if (found.state === wanted) {
          return { deployment: deployment.deployment, stage, state: wanted, detail: found.detail };
        }
      }
    }
  }
  return null;
}

export type CheckVerdict =
  /** All four stages confirmed. */
  | 'verified'
  /** The provider is reached, signed in to and has the deployment, but what it returns is not the JSON asked for. */
  | 'structured-failed'
  /** One of the first three is not confirmed: the provider cannot be used as configured. */
  | 'not-connected'
  /** The connection is confirmed and nothing failed, but structured output could not be tested (a throttled provider, for one). */
  | 'unconfirmed';

/**
 * The connection is the first three things, and it is confirmed or it is not: there is no half of it. The
 * page's chip is read from this too, so "connected" and "the check failed" cannot be said of the same check.
 */
export function checkVerdict(check: ProviderCheck): CheckVerdict {
  if (check.ok) return 'verified';
  if (!check.connected) return 'not-connected';
  const structured = check.deployments.some((one) => one.structuredOutput.state === 'failed');
  return structured ? 'structured-failed' : 'unconfirmed';
}

const where = (problem: CheckProblem): string =>
  problem.deployment ? `Deployment “${problem.deployment}”: ` : '';

/** A detail is a phrase, and is put inside brackets, so it does not end a sentence of its own. */
const phrase = (detail: string): string => detail.replace(/[.\s]+$/u, '');

const clause = (problem: CheckProblem): string =>
  `${CHECK_STAGE_LABELS[problem.stage].toLowerCase()}${problem.detail ? ` (${phrase(problem.detail)})` : ''}`;

/** What a person is told first, by what the check found. A working connection is never called failed. */
export const VERDICT_TITLES: Record<CheckVerdict, string> = {
  verified: 'Connection verified',
  'structured-failed': 'Connected, but structured output is not working',
  'not-connected': 'Connection check failed',
  unconfirmed: 'Connected, but the check could not confirm everything',
};

/** The thing that was not confirmed, as a sentence: which deployment, which of the four, and what was found. */
export function problemText(problem: CheckProblem): string {
  return `${where(problem)}${clause(problem)}.`;
}

/**
 * What a check found, as one sentence that says which of the four things it is about. A connection that
 * works is never called failed, and a check that could not confirm something says so.
 */
export function checkSentence(check: ProviderCheck): string {
  const verdict = checkVerdict(check);
  const problem = firstProblem(check.deployments);
  if (verdict === 'verified' || !problem) {
    return 'Connection verified: the provider was reached, took the credentials, has the deployment and returned the structured JSON it was asked for.';
  }
  return `${VERDICT_TITLES[verdict]}${verdict === 'not-connected' ? ': ' : '. '}${problemText(problem)}`;
}

/**
 * Why a check does not confirm all four things, for a script that must not go on without them; null when
 * it does, and null when there is no check to read (a server of an earlier build, which said only
 * whether the call worked).
 */
export function checkProblem(check: ProviderCheck | null | undefined): string | null {
  if (!check || check.ok) return null;
  return checkSentence(check);
}
