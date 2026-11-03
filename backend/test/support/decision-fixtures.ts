import {
  analysisSchema,
  emptyResponseShares,
  type Analysis,
  type ResponseShares,
  type SensitivityRow,
} from '../../../shared/analysis.js';
import {
  COUNTERFACTUAL_LABELS,
  counterfactualSetSchema,
  type Constraint,
  type Counterfactual,
  type CounterfactualId,
  type CounterfactualSet,
} from '../../../shared/constraints.js';
import { critiqueSetSchema, type Critique, type CritiqueSet } from '../../../shared/critique.js';
import {
  FIXTURE_TIME,
  actorSetFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../../shared/lab-fixtures.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import type { Actor, StakeholderSet } from '../../../shared/stakeholders.js';
import type { BriefDocument } from '../../src/brief/evidence.js';
import { gateWorldOf } from '../../src/constraints/plan.js';
import { refreshSet } from '../../src/constraints/refresh.js';
import type { DecisionInputs } from '../../src/decision/build.js';
import { passage } from './brief-world.js';
import { constraintOf, setOf } from './constraint-fixtures.js';

/**
 * A comparison whose outcome is set by hand, so that each decision status can be reached on purpose:
 * for every option and actor, the share of simulated members ending in switch or resist (`adverse`)
 * and in go-along (`favourable`) is the number given, with the same small deterministic noise on every
 * option for a seed, so that two options that differ by more than the noise differ clearly and two
 * that do not are level.
 */

export const NOW = new Date('2026-03-01T09:00:00.000Z');
export const RUNS = 20;

type PerActor = number | Record<string, number>;

export interface OptionSpec {
  id: string;
  label: string;
  kind: 'baseline' | 'alternative';
  /** Adverse share: one number for every actor, or one for each (an actor not named gets `rest`). */
  adverse: PerActor;
  favourable?: PerActor;
  rest?: number;
  /** How much this option’s runs differ from the others’ on the same seed: 0 is none, so that a gap is exact. */
  jitter?: number;
}

const valueFor = (spec: PerActor | undefined, actorId: string, fallback: number): number =>
  typeof spec === 'number' ? spec : (spec?.[actorId] ?? fallback);

const noise = (run: number, phase = 0, jitter = 0): number =>
  (((run * 7) % 11) - 5) * 0.0012 + (((run * 5 + phase * 3) % 13) - 6) * (jitter / 6);

function sharesOf(adverse: number, favourable: number): ResponseShares {
  const rest = Math.max(0, 1 - adverse - favourable);
  return {
    ...emptyResponseShares(),
    switch: adverse * 0.5,
    resist: adverse * 0.5,
    adopt: favourable * 0.5,
    'accept-with-conditions': favourable * 0.5,
    wait: rest * 0.6,
    'adapt-defensively': rest * 0.4,
  };
}

/** The cast of the shared fixtures with a cited passage for every actor, so that the evidence reads as adequate. */
export function citedActors(): Actor[] {
  return actorSetFixture().actors.map((actor) => ({
    ...actor,
    evidence: [passage({ passageId: `P-${actor.id}` })],
  }));
}

export function controlledAnalysis(
  options: readonly OptionSpec[],
  extra: {
    runs?: number;
    sensitivity?: SensitivityRow[];
    actors?: Actor[];
    revisions?: Record<string, number> | null;
    constraints?: Analysis['constraints'];
  } = {},
): Analysis {
  const runs = extra.runs ?? RUNS;
  const actors = extra.actors ?? citedActors();
  const variants = options.map((option) => ({
    id: option.id,
    label: option.label,
    kind: option.kind,
    description: `${option.label} as a fixture.`,
    round: option.kind === 'baseline' ? 1 : 2,
    intensity: option.kind === 'baseline' ? 0 : 0.6,
    impactOverrides: {},
    traitEdits: [],
  }));
  const results = options.map((option, phase) => ({
    variantId: option.id,
    trajectory: [],
    runs: Array.from({ length: runs }, (_, run) => {
      const byActor = actors.map((actor) => {
        const adverse = Math.min(
          1,
          Math.max(
            0,
            valueFor(option.adverse, actor.id, option.rest ?? 0.2) +
              noise(run, phase, option.jitter),
          ),
        );
        const favourable = Math.min(
          1 - adverse,
          Math.max(0, valueFor(option.favourable, actor.id, (1 - adverse) * 0.4)),
        );
        return {
          actorId: actor.id,
          members: actor.sampleSize,
          stanceMean: favourable - adverse,
          responseShares: sharesOf(adverse, favourable),
        };
      });
      const overall = emptyResponseShares();
      for (const entry of byActor) {
        for (const category of Object.keys(overall) as (keyof ResponseShares)[]) {
          overall[category] += entry.responseShares[category] / byActor.length;
        }
      }
      return {
        seed: 100 + run,
        stanceMean: byActor.reduce((total, entry) => total + entry.stanceMean, 0) / byActor.length,
        responseShares: overall,
        byActor,
      };
    }),
  }));
  return analysisSchema.parse({
    id: 'analysis-1',
    status: 'completed',
    createdAt: FIXTURE_TIME,
    completedAt: FIXTURE_TIME,
    config: { runsPerVariant: runs, baseSeed: 100, rounds: 8, variants, sensitivity: true },
    actors,
    relations: [],
    ...(extra.revisions === null
      ? {}
      : {
          inputRevisions: extra.revisions ?? {
            scenario: 1,
            stakeholders: 1,
            actors: 1,
            constraints: 1,
          },
        }),
    ...(extra.constraints ? { constraints: extra.constraints } : {}),
    fidelity: {
      engine: 'rules',
      keyActors: 'rules',
      cohorts: 'rules',
      repeatedRuns: runs,
      modelRepeats: 0,
      label: 'Rules: outcomes follow from the declared assumptions',
      caveats: ['No model was used to decide any actor’s behaviour.'],
    },
    progress: { completedRuns: runs * options.length, totalRuns: runs * options.length },
    variants: results,
    findings: [],
    sensitivity: extra.sensitivity ?? [],
    representativeRun: null,
    crossCheck: null,
    cost: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      simulatedRuns: runs * options.length,
      simulatedMembers: 1_000,
      wallMs: 10,
    },
    error: null,
  });
}

/** A sensitivity row that moves the proposed change’s share by `shift`. */
export function sensitivityRow(
  id: string,
  shift: number,
  overrides: Partial<SensitivityRow> = {},
): SensitivityRow {
  return {
    id,
    target: { kind: 'trait', actorId: 'subscribers', trait: 'switchingCost' },
    label: `Subscribers: cost of switching, ${id}`,
    perturbation: 0.2,
    metric: 'Simulated share of members ending in switch or resist, 20 paired seeds',
    baseMean: 0.4,
    shift,
    standardError: 0.005,
    classification: Math.abs(shift) >= 0.05 ? 'assumption-sensitive' : 'robust',
    assumptionOrigin: 'system-assumption',
    ...overrides,
  };
}

export const OPTIONS = {
  baseline: (adverse: PerActor, extra: Partial<OptionSpec> = {}): OptionSpec => ({
    id: 'baseline',
    label: 'No change',
    kind: 'baseline',
    adverse,
    ...extra,
  }),
  proposed: (adverse: PerActor, extra: Partial<OptionSpec> = {}): OptionSpec => ({
    id: 'proposed-change',
    label: 'Proposed change',
    kind: 'alternative',
    adverse,
    ...extra,
  }),
  smaller: (adverse: PerActor, extra: Partial<OptionSpec> = {}): OptionSpec => ({
    id: 'smaller-rise',
    label: 'Smaller rise',
    kind: 'alternative',
    adverse,
    ...extra,
  }),
};

export function counterfactualOf(
  id: CounterfactualId,
  deltaVsBase: number | null,
  overrides: Partial<Counterfactual> = {},
): Counterfactual {
  return {
    id,
    label: COUNTERFACTUAL_LABELS[id],
    change: `The one thing that differs in the view ${id}.`,
    applicable: deltaVsBase !== null,
    reason: deltaVsBase === null ? 'It does not apply to this project.' : null,
    deltaVsBase,
    standardError: deltaVsBase === null ? null : 0.004,
    classification:
      deltaVsBase === null ? null : Math.abs(deltaVsBase) >= 0.05 ? 'material' : 'negligible',
    driver: `What moved it in ${id}.`,
    driverConstraintIds: [],
    ...overrides,
  };
}

export function counterfactualSet(views: Counterfactual[]): CounterfactualSet {
  return counterfactualSetSchema.parse({
    version: 1,
    generatedAt: FIXTURE_TIME,
    variantId: 'proposed-change',
    variantLabel: 'Proposed change',
    metric: 'Simulated share of members ending in switch or resist',
    seeds: 12,
    baseMean: 0.3,
    inputs: { constraints: 1, actors: 1, scenario: 1 },
    views,
  });
}

export function critiqueOf(overrides: Partial<Critique> = {}): Critique {
  return {
    id: 'critique-1',
    role: 'evidence',
    target: { kind: 'analysis', id: 'analysis-1' },
    severity: 'major',
    objection: 'A key group rests on one passage.',
    basis: [],
    evidence: [],
    origin: 'rules',
    status: 'open',
    response: null,
    remainingDisagreement: null,
    impactOnConclusion: 'The result may rest on a single source.',
    createdAt: FIXTURE_TIME,
    ...overrides,
  };
}

export function critiqueSet(
  critiques: Critique[] = [],
  analysisId: string | null = 'analysis-1',
): CritiqueSet {
  return critiqueSetSchema.parse({
    analysisId,
    generatedAt: FIXTURE_TIME,
    mode: 'rules',
    critiques,
  });
}

/** What a comparison records when it ran under a reviewed set whose constraints were all confirmed. */
export const CLEAR_RECORD: NonNullable<Analysis['constraints']> = {
  revision: 1,
  status: 'clear',
  label: 'No constraint was left unconfirmed when this comparison started.',
  reasons: [],
  applied: [],
  notApplied: [],
  impacts: [],
};

export interface ControlledOptions {
  runs?: number;
  sensitivity?: SensitivityRow[];
  constraints?: Constraint[] | null;
  constraintSet?: Parameters<typeof setOf>[1];
  recorded?: Analysis['constraints'] | null;
  counterfactuals?: CounterfactualSet | null;
  counterfactualsCurrent?: boolean;
  critiques?: CritiqueSet | null;
  documents?: BriefDocument[];
  stakeholders?: StakeholderSet;
  scenario?: ScenarioFrame;
  actors?: Actor[];
  revisions?: Record<string, number> | null;
  revisionsNow?: Record<string, number>;
  ledger?: DecisionInputs['ledger'];
  analysis?: (analysis: Analysis) => Analysis;
}

/**
 * Everything the canvas needs around a hand-set comparison: a reviewed, fully confirmed set of
 * constraints, counterfactual views that moved nothing, an independent review that raised nothing,
 * a cited source for every actor. Each part can be taken away or changed to reach a different status.
 */
export function controlledInputs(
  options: readonly OptionSpec[],
  config: ControlledOptions = {},
): DecisionInputs {
  const scenario = config.scenario ?? scenarioFixture();
  const stakeholders = config.stakeholders ?? stakeholderSetFixture();
  const withConstraints = config.constraints !== null;
  const recorded =
    config.recorded === null
      ? undefined
      : (config.recorded ?? (withConstraints ? CLEAR_RECORD : undefined));
  const analysis0 = controlledAnalysis(options, {
    ...(config.runs !== undefined ? { runs: config.runs } : {}),
    ...(config.sensitivity ? { sensitivity: config.sensitivity } : {}),
    ...(config.actors ? { actors: config.actors } : {}),
    ...(config.revisions !== undefined ? { revisions: config.revisions } : {}),
    ...(recorded ? { constraints: recorded } : {}),
  });
  const analysis = config.analysis ? config.analysis(analysis0) : analysis0;
  const records = {
    scenario: { data: scenario, revision: 1 },
    actors: { data: { actors: analysis.actors, relations: [] }, revision: 1 },
  };
  const set = withConstraints
    ? refreshSet(
        setOf(
          config.constraints ?? [
            constraintOf({ id: 'c-0001', statement: 'Spending on the change is capped.' }),
          ],
          config.constraintSet ?? {},
        ),
        gateWorldOf({ scenarioRevision: 1, actorsRevision: 1 }, records, analysis.config.variants),
        NOW,
      )
    : null;
  return {
    project: {
      id: 'project-1',
      name: 'A decision',
      question: 'Should the provider raise the fee?',
    },
    scenario,
    stakeholders,
    analysis,
    constraints: set,
    counterfactuals:
      config.counterfactuals === null
        ? null
        : {
            set:
              config.counterfactuals ??
              counterfactualSet([
                counterfactualOf('without-budget', 0.01),
                counterfactualOf('delayed-implementation', -0.01),
                counterfactualOf('lower-adoption', 0.02),
              ]),
            current: config.counterfactualsCurrent ?? true,
          },
    critiques: config.critiques === undefined ? critiqueSet() : config.critiques,
    documents: config.documents ?? [{ id: 'doc-1', name: 'Supplied notes.md' }],
    ledger: config.ledger ?? null,
    research: null,
    revisionsNow: config.revisionsNow ?? {
      scenario: 1,
      stakeholders: 1,
      actors: 1,
      constraints: 1,
    },
    newerRunning: false,
  };
}
