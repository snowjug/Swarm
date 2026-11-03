import { metrics, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';
import {
  FETCH_ERROR_CLASSES,
  QUARANTINE_REASONS,
  RESEARCH_MODES,
  RESEARCH_STOP_REASONS,
  SOURCE_CATEGORIES,
  type FetchErrorClass,
  type QuarantineReason,
  type ResearchMode,
  type ResearchStopReason,
  type SourceCategory,
} from '../../../shared/research.js';
import { APP_VERSION } from '../../../shared/types.js';
import { safeAttributes } from './attributes.js';

/**
 * What the product tells its operators about how its work goes, as counts and durations, and nothing
 * about what the work was about. Every recorder below takes enumerations and numbers only: an
 * address, a host name, a question, a passage or a person has no parameter to go in, and an
 * enumeration that is not one of the known values is recorded as `other`, so that a mistake in a
 * caller cannot put free text into a metric. Names pass through `attributes.ts` as well.
 *
 * With telemetry off (no meter provider registered) every recorder does nothing and costs nothing.
 * Estimated model cost is not here: it belongs to `swarm.model.*`.
 *
 * Research (`swarm.research.*`)
 *   researchRun({ outcome, mode, stopReason })  runs: started, completed, cancelled, failed or blocked,
 *                                               by mode and (when it ended) why it stopped
 *   researchPages({ count, mode })              pages fetched
 *   crawlDuration({ durationMs, mode, stopReason })   how long a run's crawl took (histogram, ms)
 *   fetchFailure(errorClass, count)             fetches that failed, by FETCH_ERROR_CLASSES
 *   safetyBlock(reason, count)                  requests a deterministic rule refused, by reason
 *   quarantine(reason, count)                   pages set aside, by QUARANTINE_REASONS
 *   sourcesUsed(category, count)                sources that became evidence, by category
 *   evidencePassages(count, mode)               passages indexed as evidence
 * Actors (`swarm.actors.*`)
 *   actorProposal({ origin, proposed, valid, issues })   proposals (by model, rules or fallback), how
 *                                               many actors were proposed and how many were valid, and
 *                                               the validation issues by code
 * Constraints (`swarm.constraints.*`)
 *   constraintProposal({ origin, count })       proposals, and how many constraints they held
 *   constraintGate(status)                      where the approval gate stands, by GATE_STATUSES
 * Simulation, report and cancellation
 *   simulationDuration({ durationMs, outcome }) `swarm.sim.duration` (histogram, ms)
 *   reportDuration({ durationMs, outcome })     `swarm.report.duration` (histogram, ms)
 *   cancellation(scope)                         `swarm.cancellations`: a person stopped work, by scope
 * Deployment
 *   observeDeployment(source)                   `swarm.deployment.info`: 1, with the mode, the version
 *                                               and the build; returns the function that stops it
 */

const SCOPE = 'swarm-lab';
const OTHER = 'other';

export const RESEARCH_OUTCOMES = [
  'started',
  'completed',
  'cancelled',
  'failed',
  'blocked',
] as const;
export type ResearchOutcome = (typeof RESEARCH_OUTCOMES)[number];

/** Why a deterministic rule refused a request: the address, the scheme, the port, the site's own rules. */
export const SAFETY_BLOCK_REASONS = [
  'private-address',
  'loopback-address',
  'link-local-address',
  'metadata-address',
  'reserved-address',
  'invalid-address',
  'internal-name',
  'blocked-scheme',
  'blocked-port',
  'credentials-in-url',
  'not-on-allow-list',
  'robots-disallowed',
  'redirect-refused',
  'https-downgrade',
  'prompt-injection',
] as const;
export type SafetyBlockReason = (typeof SAFETY_BLOCK_REASONS)[number];

/** Where a proposal came from: the model and it passed, the rules by design, or the rules after the model failed. */
export const PROPOSAL_ORIGINS = ['model', 'rules', 'fallback'] as const;
export type ProposalOrigin = (typeof PROPOSAL_ORIGINS)[number];

export const WORK_OUTCOMES = ['completed', 'failed', 'cancelled'] as const;
export type WorkOutcome = (typeof WORK_OUTCOMES)[number];

/**
 * Where the approval gate of a proposal can stand. A closed list on purpose: a status that is not on it
 * is recorded as `other`, so a gate that is given free text records nothing of it. Add a status here
 * when the gate gains one.
 */
export const GATE_STATUSES = [
  'not-started',
  'proposed',
  'pending-approval',
  'approved',
  'edited',
  'rejected',
  'blocked',
  'stale',
  'superseded',
  'skipped',
] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

/** The modes a deployment has; `deployment.ts` passes its own, which TypeScript holds to this list. */
const DEPLOYMENT_MODES = ['local', 'pilot', 'production'] as const;

export const CANCEL_SCOPES = [
  'research',
  'simulation',
  'analysis',
  'report',
  'critique',
  'actors',
  'constraints',
] as const;
export type CancelScope = (typeof CANCEL_SCOPES)[number];

/** The most distinct validation codes one proposal reports, so that a flood of codes cannot widen a metric. */
const MAX_ISSUE_CODES = 20;
const MAX_COUNT = 1_000_000;

/** What the address classifier says about an address, as a reason a person on call can read. */
export function safetyReasonOfAddress(reason: string): SafetyBlockReason {
  switch (reason) {
    case 'loopback':
      return 'loopback-address';
    case 'link-local':
      return 'link-local-address';
    case 'private-network':
    case 'unique-local':
    case 'site-local':
    case 'shared-address-space':
      return 'private-address';
    case 'invalid-address':
      return 'invalid-address';
    default:
      return 'reserved-address';
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | typeof OTHER {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : OTHER;
}

/**
 * An issue code is a constant of the validating code: capital letters, digits and underscores, as
 * ACTOR_ROLE_UNKNOWN. Anything else (a sentence, a name, an address) is recorded as `other`.
 */
const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/u;
const COMMIT = /^[0-9a-f]{7,40}$/u;
const code = (value: unknown): string =>
  typeof value === 'string' && value.length <= 48 && CODE.test(value) ? value : OTHER;

const whole = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_COUNT, Math.max(0, Math.trunc(value)))
    : 0;
const milliseconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

interface DeploymentInfo {
  mode: (typeof DEPLOYMENT_MODES)[number];
  version: string;
  sha: string | null;
}

interface Instruments {
  runs: Counter;
  pages: Counter;
  crawl: Histogram;
  fetchFailures: Counter;
  safetyBlocks: Counter;
  quarantines: Counter;
  sourcesUsed: Counter;
  passages: Counter;
  actorProposals: Counter;
  actorsProposed: Counter;
  actorsValid: Counter;
  actorIssues: Counter;
  constraintProposals: Counter;
  constraintsProposed: Counter;
  constraintGate: Counter;
  simulation: Histogram;
  report: Histogram;
  cancellations: Counter;
  deployment: ObservableGauge;
}

const deployments = new Set<() => DeploymentInfo>();

function createInstruments(): Instruments {
  const meter = metrics.getMeter(SCOPE, APP_VERSION);
  const deployment = meter.createObservableGauge('swarm.deployment.info', {
    description: '1 for the deployment this process is: its mode, version and build',
  });
  deployment.addCallback((result) => {
    for (const source of deployments) {
      const info = source();
      result.observe(
        1,
        safeAttributes({
          'swarm.deployment.mode': oneOf(info.mode, DEPLOYMENT_MODES),
          'swarm.build.version': VERSION.test(info.version) ? info.version : OTHER,
          // Twelve characters name a commit and stay clear of the redaction of long key-like runs.
          'swarm.build.sha': info.sha && COMMIT.test(info.sha) ? info.sha.slice(0, 12) : 'unknown',
        }),
      );
    }
  });
  return {
    runs: meter.createCounter('swarm.research.runs', {
      description: 'Research runs, by outcome, mode and the reason a finished run stopped',
    }),
    pages: meter.createCounter('swarm.research.pages', {
      description: 'Pages fetched by research',
    }),
    crawl: meter.createHistogram('swarm.research.crawl.duration', {
      description: 'How long a research crawl took',
      unit: 'ms',
    }),
    fetchFailures: meter.createCounter('swarm.research.fetch.failures', {
      description: 'Fetches that failed, by failure class',
    }),
    safetyBlocks: meter.createCounter('swarm.research.safety.blocks', {
      description: 'Requests a deterministic safety rule refused, by reason',
    }),
    quarantines: meter.createCounter('swarm.research.quarantines', {
      description: 'Pages set aside instead of read as evidence, by reason',
    }),
    sourcesUsed: meter.createCounter('swarm.research.sources.used', {
      description: 'Sources that became evidence, by category',
    }),
    passages: meter.createCounter('swarm.research.evidence.passages', {
      description: 'Passages indexed as evidence',
    }),
    actorProposals: meter.createCounter('swarm.actors.proposals', {
      description: 'Actor proposals, by origin: model, rules or fallback',
    }),
    actorsProposed: meter.createCounter('swarm.actors.proposed', {
      description: 'Actors proposed, by origin',
    }),
    actorsValid: meter.createCounter('swarm.actors.valid', {
      description: 'Proposed actors that passed validation, by origin',
    }),
    actorIssues: meter.createCounter('swarm.actors.issues', {
      description: 'Validation issues found in actor proposals, by code',
    }),
    constraintProposals: meter.createCounter('swarm.constraints.proposals', {
      description: 'Constraint proposals, by origin',
    }),
    constraintsProposed: meter.createCounter('swarm.constraints.proposed', {
      description: 'Constraints proposed, by origin',
    }),
    constraintGate: meter.createCounter('swarm.constraints.gate', {
      description: 'Where the constraint approval gate stood, by status',
    }),
    simulation: meter.createHistogram('swarm.sim.duration', {
      description: 'How long a simulation took, by outcome',
      unit: 'ms',
    }),
    report: meter.createHistogram('swarm.report.duration', {
      description: 'How long generating a report took, by outcome',
      unit: 'ms',
    }),
    cancellations: meter.createCounter('swarm.cancellations', {
      description: 'Work a person stopped, by scope',
    }),
    deployment,
  };
}

// As in `signals.ts`: instruments belong to the meter provider that existed when they were made, and
// are made again if it is replaced (a test does), and not otherwise.
const cache = new WeakMap<object, Instruments>();
function instruments(): Instruments {
  const provider = metrics.getMeterProvider();
  let found = cache.get(provider);
  if (!found) {
    found = createInstruments();
    cache.set(provider, found);
  }
  return found;
}

const stopReasonOf = (value: unknown): ResearchStopReason | typeof OTHER =>
  oneOf(value, RESEARCH_STOP_REASONS);

export const productSignals = {
  researchRun(input: {
    outcome: ResearchOutcome;
    mode: ResearchMode;
    stopReason?: ResearchStopReason | null;
  }): void {
    const outcome = oneOf(input.outcome, RESEARCH_OUTCOMES);
    instruments().runs.add(
      1,
      safeAttributes({
        'swarm.research.outcome': outcome,
        'swarm.research.mode': oneOf(input.mode, RESEARCH_MODES),
        ...(input.stopReason && outcome !== 'started'
          ? { 'swarm.research.stop_reason': stopReasonOf(input.stopReason) }
          : {}),
      }),
    );
  },

  researchPages(input: { count: number; mode: ResearchMode }): void {
    const count = whole(input.count);
    if (count > 0) {
      instruments().pages.add(
        count,
        safeAttributes({ 'swarm.research.mode': oneOf(input.mode, RESEARCH_MODES) }),
      );
    }
  },

  crawlDuration(input: {
    durationMs: number;
    mode: ResearchMode;
    stopReason?: ResearchStopReason | null;
  }): void {
    const duration = milliseconds(input.durationMs);
    if (duration === null) return;
    instruments().crawl.record(
      duration,
      safeAttributes({
        'swarm.research.mode': oneOf(input.mode, RESEARCH_MODES),
        ...(input.stopReason
          ? { 'swarm.research.stop_reason': stopReasonOf(input.stopReason) }
          : {}),
      }),
    );
  },

  fetchFailure(errorClass: FetchErrorClass, count = 1): void {
    const times = whole(count);
    if (times > 0) {
      instruments().fetchFailures.add(
        times,
        safeAttributes({ 'swarm.fetch.error_class': oneOf(errorClass, FETCH_ERROR_CLASSES) }),
      );
    }
  },

  safetyBlock(reason: SafetyBlockReason, count = 1): void {
    const times = whole(count);
    if (times > 0) {
      instruments().safetyBlocks.add(
        times,
        safeAttributes({ 'swarm.safety.reason': oneOf(reason, SAFETY_BLOCK_REASONS) }),
      );
    }
  },

  quarantine(reason: QuarantineReason, count = 1): void {
    const times = whole(count);
    if (times > 0) {
      instruments().quarantines.add(
        times,
        safeAttributes({ 'swarm.quarantine.reason': oneOf(reason, QUARANTINE_REASONS) }),
      );
    }
  },

  sourcesUsed(category: SourceCategory, count = 1): void {
    const times = whole(count);
    if (times > 0) {
      instruments().sourcesUsed.add(
        times,
        safeAttributes({ 'swarm.source.category': oneOf(category, SOURCE_CATEGORIES) }),
      );
    }
  },

  evidencePassages(count: number, mode?: ResearchMode): void {
    const times = whole(count);
    if (times > 0) {
      instruments().passages.add(
        times,
        safeAttributes(mode ? { 'swarm.research.mode': oneOf(mode, RESEARCH_MODES) } : {}),
      );
    }
  },

  actorProposal(input: {
    origin: ProposalOrigin;
    proposed: number;
    valid: number;
    issues?: Readonly<Record<string, number>>;
  }): void {
    const set = instruments();
    const origin = safeAttributes({
      'swarm.proposal.origin': oneOf(input.origin, PROPOSAL_ORIGINS),
    });
    set.actorProposals.add(1, origin);
    const proposed = whole(input.proposed);
    // Never more valid than proposed, whatever a caller counted.
    const valid = Math.min(whole(input.valid), proposed);
    if (proposed > 0) set.actorsProposed.add(proposed, origin);
    if (valid > 0) set.actorsValid.add(valid, origin);
    const reported = new Map<string, number>();
    for (const [issue, times] of Object.entries(input.issues ?? {}).slice(0, MAX_ISSUE_CODES)) {
      const name = code(issue);
      reported.set(name, (reported.get(name) ?? 0) + whole(times));
    }
    for (const [issue, times] of reported) {
      if (times > 0) set.actorIssues.add(times, safeAttributes({ 'swarm.issue.code': issue }));
    }
  },

  constraintProposal(input: { origin: ProposalOrigin; count: number }): void {
    const set = instruments();
    const origin = safeAttributes({
      'swarm.proposal.origin': oneOf(input.origin, PROPOSAL_ORIGINS),
    });
    set.constraintProposals.add(1, origin);
    const count = whole(input.count);
    if (count > 0) set.constraintsProposed.add(count, origin);
  },

  constraintGate(status: GateStatus): void {
    instruments().constraintGate.add(
      1,
      safeAttributes({ 'swarm.gate.status': oneOf(status, GATE_STATUSES) }),
    );
  },

  simulationDuration(input: { durationMs: number; outcome: WorkOutcome }): void {
    const duration = milliseconds(input.durationMs);
    if (duration === null) return;
    instruments().simulation.record(
      duration,
      safeAttributes({ 'swarm.sim.outcome': oneOf(input.outcome, WORK_OUTCOMES) }),
    );
  },

  reportDuration(input: { durationMs: number; outcome: WorkOutcome }): void {
    const duration = milliseconds(input.durationMs);
    if (duration === null) return;
    instruments().report.record(
      duration,
      safeAttributes({ 'swarm.report.outcome': oneOf(input.outcome, WORK_OUTCOMES) }),
    );
  },

  cancellation(scope: CancelScope): void {
    instruments().cancellations.add(
      1,
      safeAttributes({ 'swarm.cancel.scope': oneOf(scope, CANCEL_SCOPES) }),
    );
  },
};

/**
 * Starts reporting `swarm.deployment.info` for this process, reading `source` each time the gauge is
 * collected. Returns the function that stops it, so that an application that is closed is not asked
 * for again.
 */
export function observeDeployment(source: () => DeploymentInfo): () => void {
  instruments();
  deployments.add(source);
  return () => {
    deployments.delete(source);
  };
}
