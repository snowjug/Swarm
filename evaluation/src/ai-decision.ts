import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../shared/example-scenarios.js';
import type { Analysis } from '../../shared/analysis.js';
import type { Constraint } from '../../shared/constraints.js';
import {
  scenarioFixture,
  stakeholderSetFixture,
  actorSetFixture,
  actorFixture,
  stakeholderFixture,
} from '../../shared/lab-fixtures.js';
import {
  stakeholderSetSchema,
  type Actor,
  type StakeholderCategory,
  type StakeholderSet,
} from '../../shared/stakeholders.js';
import type { DecisionCanvas } from '../../shared/decision.js';
import { buildCanvas, type DecisionInputs } from '../../backend/src/decision/build.js';
import { passage } from '../../backend/test/support/brief-world.js';
import { constraintOf } from '../../backend/test/support/constraint-fixtures.js';
import {
  CLEAR_RECORD,
  citedActors,
  controlledInputs,
  counterfactualOf,
  counterfactualSet,
  critiqueOf,
  critiqueSet,
  sensitivityRow,
  type ControlledOptions,
  type OptionSpec,
} from '../../backend/test/support/decision-fixtures.js';
import { decisionInputs } from '../../backend/test/support/decision-world.js';
import { loadScenarios, type Scenario } from './ai-datasets.js';
import { loadDecisionCases, type ResolvedDecisionCase } from './ai-suite-data.js';
import type { Split } from './datasets.js';
import {
  canvasStrings,
  recommendationProblems,
  scoreLenses,
  scoreStatus,
  wordingProblems,
  type LensScore,
  type StatusScore,
  type WordingProblem,
} from './measure-decision.js';

/**
 * Decision canvases built from fixtures that were set by hand, so that each status is reached on
 * purpose, and from the five worked examples through the real rules path and the real engine. The
 * canvas is built by the product's own pure function; what is compared with it is the gold, which was
 * written from docs/analysis/decision-canvas.md before the function was run on any of them.
 */

const CATEGORY_OF_ROLE: Readonly<Record<string, StakeholderCategory>> = {
  'decision-owner': 'decision-maker',
  approvers: 'governance',
  'regulators-governance': 'regulator',
  'directly-affected': 'cost-bearer',
  beneficiaries: 'beneficiary',
  'customers-users': 'end-user',
  implementers: 'operations',
  'partners-suppliers': 'partner',
  'competitors-alternatives': 'competitor',
  'observers-influencers': 'influencer',
};
const KEY_ROLES: ReadonlySet<string> = new Set([
  'decision-owner',
  'approvers',
  'regulators-governance',
  'opponents-resistors',
]);

/** The cast of a scenario of the scenario dataset: every participant a source voices or implies, in the categories of the role table. */
function scenarioCast(scenario: Scenario, cited: ResolvedDecisionCase['evidence']['cited']) {
  const members = scenario.participants.filter((item) => item.voice !== 'missing');
  const citedCount =
    cited === 'all'
      ? members.length
      : cited === 'none'
        ? 0
        : Math.max(1, Math.floor(members.length / 3));
  const stakeholders = members.map((item) => {
    const category = CATEGORY_OF_ROLE[item.role] ?? 'other';
    return stakeholderFixture(item.id, category, {
      name: item.name.slice(0, 120),
      priority: KEY_ROLES.has(item.role) ? 'key' : 'standard',
    });
  });
  const actors: Actor[] = members.map((item, index) => {
    const category = CATEGORY_OF_ROLE[item.role] ?? 'other';
    const key = KEY_ROLES.has(item.role);
    return actorFixture(item.id, category, {
      name: item.name.slice(0, 120),
      kind: key ? 'key' : 'cohort',
      size: key ? 1 : 100,
      sampleSize: key ? 1 : 20,
      evidence: index < citedCount ? [passage({ passageId: `P-${item.id}` })] : [],
    });
  });
  const set: StakeholderSet = stakeholderSetSchema.parse({
    ...stakeholderSetFixture(),
    stakeholders,
    relations: [],
  });
  return { stakeholders: set, actors };
}

/** The five-actor cast of the lab fixtures, optionally with no actor that decides, approves or can block. */
function labCast(
  authority: boolean,
  cited: ResolvedDecisionCase['evidence']['cited'],
): { stakeholders: StakeholderSet; actors: Actor[] } {
  const demote = (id: string, category: StakeholderCategory): StakeholderCategory =>
    authority
      ? category
      : id === 'provider'
        ? 'partner'
        : id === 'regulator'
          ? 'competitor'
          : category;
  const base = cited === 'all' ? citedActors() : actorSetFixture().actors;
  const actors = base.map((actor, index) => ({
    ...actor,
    category: demote(actor.id, actor.category),
    evidence:
      cited === 'all'
        ? actor.evidence
        : cited === 'none'
          ? []
          : index < 1
            ? [passage({ passageId: `P-${actor.id}` })]
            : [],
  }));
  const set = stakeholderSetFixture();
  return {
    stakeholders: {
      ...set,
      stakeholders: set.stakeholders.map((item) => ({
        ...item,
        category: demote(item.id, item.category),
      })),
    },
    actors,
  };
}

const optionsOf = (item: ResolvedDecisionCase): OptionSpec[] =>
  item.options.map((option) => ({
    id: option.id,
    label: option.label,
    kind: option.kind,
    adverse: option.adverse,
    ...(option.favourable !== undefined ? { favourable: option.favourable } : {}),
  }));

const PROVISIONAL_RECORD: NonNullable<Analysis['constraints']> = {
  revision: 1,
  status: 'provisional',
  label: 'Provisional: the simulation ran with 1 constraint not yet validated.',
  reasons: [],
  applied: [],
  notApplied: [],
  impacts: [],
};

const constraintFrom = (
  item: NonNullable<ResolvedDecisionCase['constraints']>['items'][number],
): Constraint =>
  constraintOf({
    id: item.id,
    category: item.category as Constraint['category'],
    hardness: item.hardness,
    statement: item.statement,
    validation: item.validation as Constraint['validation'],
    ...(item.rulesOut
      ? {
          affectedAlternativeIds: item.rulesOut,
          effects: [{ kind: 'block' }] as Constraint['effects'],
        }
      : {}),
  });

/** The inputs of the canvas for a gold fixture: everything not named is in its clear state, as the dataset's note says. */
export function inputsFor(
  item: ResolvedDecisionCase,
  scenarios: readonly Scenario[],
): DecisionInputs {
  const scenario = item.scenario
    ? scenarios.find((entry) => entry.id === item.scenario)
    : undefined;
  if (item.scenario && !scenario)
    throw new Error(
      `The fixture ${item.id} names the scenario ${item.scenario}, which does not exist.`,
    );
  const cast = scenario
    ? scenarioCast(scenario, item.evidence.cited)
    : labCast(item.cast !== 'lab-no-authority', item.evidence.cited);
  const actors =
    item.direction === 'none'
      ? cast.actors.map((actor) => ({
          ...actor,
          traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0, spread: 0 } },
        }))
      : cast.actors;
  const config: ControlledOptions = {
    runs: item.runs,
    sensitivity: item.sensitivity.map((row) => sensitivityRow(row.id, row.shift)),
    stakeholders: cast.stakeholders,
    actors,
    documents:
      item.evidence.documents === 'attached' ? [{ id: 'doc-1', name: 'Supplied notes.md' }] : [],
    ...(scenario
      ? {
          scenario: scenarioFixture({
            decision: scenario.question.slice(0, 400),
            system: scenario.title.slice(0, 300),
          }),
        }
      : {}),
  };
  if (item.constraints === null) config.constraints = null;
  else config.constraints = item.constraints.items.map(constraintFrom);
  config.recorded =
    item.comparisonRecord === 'none'
      ? null
      : item.comparisonRecord === 'provisional'
        ? PROVISIONAL_RECORD
        : item.constraints === null
          ? undefined
          : CLEAR_RECORD;
  config.counterfactuals =
    item.counterfactuals === null
      ? null
      : counterfactualSet(
          item.counterfactuals.views.map((view) =>
            counterfactualOf(view.id as Parameters<typeof counterfactualOf>[0], view.delta),
          ),
        );
  if (item.counterfactuals) config.counterfactualsCurrent = item.counterfactuals.current;
  config.critiques =
    item.critics === null
      ? null
      : critiqueSet(
          item.critics.objections.map((objection, index) =>
            critiqueOf({
              id: `critique-${index + 1}`,
              severity: objection.severity,
              status: objection.status === 'open' ? 'open' : 'responded',
            }),
          ),
          item.critics.analysis === 'this' ? 'analysis-1' : 'analysis-other',
        );
  if (item.inputs === 'stale')
    config.revisionsNow = { scenario: 1, stakeholders: 1, actors: 1, constraints: 2 };
  if (item.inputs === 'unrecorded') config.revisions = null;
  if (item.evidence.ledger !== null)
    config.ledger = {
      conflicts: [],
      sufficiency: {
        level: item.evidence.ledger === 'abstains' ? 'insufficient' : 'limited',
        reasons: ['The fixture sets the level of the grounding review.'],
      },
    };
  const inputs = controlledInputs(optionsOf(item), config);
  return scenario
    ? { ...inputs, project: { id: 'project-1', name: scenario.title, question: scenario.question } }
    : inputs;
}

export interface FixtureRun {
  id: string;
  split: Split;
  fixture: ResolvedDecisionCase;
  status: string | null;
  rule: string | null;
  statusScore: StatusScore | null;
  lensScore: LensScore | null;
  recommendation: string[];
  wording: WordingProblem[];
  strings: number;
  /** Set when the fixture could not be built or the canvas could not be made from it. */
  error: string | null;
  elapsedMs: number;
}

export interface ExampleRun {
  example: string;
  variant: string;
  status: string | null;
  rule: string | null;
  recommendation: string[];
  wording: WordingProblem[];
  strings: number;
  error: string | null;
}

export interface DecisionObservation {
  fixtures: FixtureRun[];
  examples: ExampleRun[];
  elapsedMs: number;
}

export function observeFixtures(): FixtureRun[] {
  const { cases } = loadDecisionCases();
  const scenarios = loadScenarios();
  return cases.map((fixture): FixtureRun => {
    const started = performance.now();
    const empty = {
      id: fixture.id,
      split: fixture.split,
      fixture,
      status: null,
      rule: null,
      statusScore: null,
      lensScore: null,
      recommendation: [] as string[],
      wording: [] as WordingProblem[],
      strings: 0,
    };
    try {
      const inputs = inputsFor(fixture, scenarios);
      const canvas: DecisionCanvas = buildCanvas(inputs);
      return {
        ...empty,
        status: canvas.status.status,
        rule: canvas.status.rule,
        statusScore: scoreStatus(fixture.gold, canvas),
        lensScore: scoreLenses(fixture.gold, canvas),
        recommendation: recommendationProblems(canvas, fixture.gold.recommendation),
        wording: wordingProblems(canvas, inputs),
        strings: canvasStrings(canvas).length,
        error: null,
        elapsedMs: performance.now() - started,
      };
    } catch (error) {
      return {
        ...empty,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: performance.now() - started,
      };
    }
  });
}

/** What each worked example is built under: the states a project can be in, each by what the inputs hold and nothing else. */
const VARIANTS: {
  id: string;
  options: (pack: ExampleScenario) => Parameters<typeof decisionInputs>[1];
}[] = [
  { id: 'as-made', options: () => ({}) },
  {
    id: 'reviewed-and-examined',
    options: () => ({
      constraints: [constraintOf({ id: 'c-0001', statement: 'Spending on the change is capped.' })],
      counterfactuals: counterfactualSet([
        counterfactualOf('without-budget', 0.01),
        counterfactualOf('delayed-implementation', -0.01),
        counterfactualOf('lower-adoption', 0.02),
      ]),
      critiques: critiqueSet(),
    }),
  },
  {
    id: 'unsettled-legal-constraint',
    options: () => ({
      constraints: [
        constraintOf({
          id: 'c-0003',
          category: 'legal',
          hardness: 'hard',
          statement: 'The change needs a licence.',
          validation: 'unvalidated',
        }),
      ],
    }),
  },
  { id: 'no-sources', options: () => ({ documents: [] }) },
  {
    id: 'two-hard-constraints-that-cannot-hold',
    options: () => ({
      constraints: [
        constraintOf({
          id: 'c-0005',
          category: 'budget',
          hardness: 'hard',
          statement: 'Spending is capped at $100,000.',
        }),
        constraintOf({
          id: 'c-0006',
          category: 'budget',
          hardness: 'hard',
          statement: 'Spending is at least $200,000.',
        }),
      ],
    }),
  },
  {
    id: 'a-check-larger-than-the-lead',
    options: () => ({
      constraints: [constraintOf({ id: 'c-0001', statement: 'Spending on the change is capped.' })],
      counterfactuals: counterfactualSet([counterfactualOf('without-budget', 0.4)]),
      critiques: critiqueSet(),
    }),
  },
  {
    id: 'grounding-review-abstains',
    options: () => ({
      ledger: {
        conflicts: [],
        sufficiency: {
          level: 'insufficient',
          reasons: ['Only 1 directly supported finding; at least 3 are needed.'],
        },
      },
    }),
  },
  {
    id: 'constraints-changed-after-the-comparison',
    options: () => ({
      constraints: [constraintOf({ id: 'c-0001', statement: 'Spending on the change is capped.' })],
      revisionsNow: { scenario: 1, stakeholders: 1, actors: 1, constraints: 2 },
    }),
  },
  {
    id: 'blocking-objection',
    options: () => ({
      critiques: critiqueSet([critiqueOf({ severity: 'blocking', status: 'open' })]),
    }),
  },
];

export const EXAMPLE_VARIANTS = VARIANTS.map((variant) => variant.id);

/** The canvases of the worked examples, through the real rules path and the real engine, each in nine states. */
export async function observeExamples(
  packs: readonly ExampleScenario[] = EXAMPLE_SCENARIOS,
): Promise<ExampleRun[]> {
  const runs: ExampleRun[] = [];
  for (const pack of packs) {
    for (const variant of VARIANTS) {
      const base = { example: pack.id, variant: variant.id };
      try {
        const inputs = await decisionInputs(pack, variant.options(pack));
        const canvas = buildCanvas(inputs);
        runs.push({
          ...base,
          status: canvas.status.status,
          rule: canvas.status.rule,
          recommendation: recommendationProblems(canvas),
          wording: wordingProblems(canvas, inputs),
          strings: canvasStrings(canvas).length,
          error: null,
        });
      } catch (error) {
        runs.push({
          ...base,
          status: null,
          rule: null,
          recommendation: [],
          wording: [],
          strings: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return runs;
}

export async function observeDecisions(
  options: { examples?: boolean } = {},
): Promise<DecisionObservation> {
  const started = performance.now();
  const fixtures = observeFixtures();
  const examples = options.examples === false ? [] : await observeExamples();
  return { fixtures, examples, elapsedMs: performance.now() - started };
}
