import {
  DEFAULT_RESEARCH_BUDGET,
  type ResearchPlan,
  type SourceCategory,
} from '../../shared/research.js';
import { newOperationBudget, taskRunnerFor } from '../../backend/src/models/factory.js';
import type { ModelUsageSink } from '../../backend/src/models/client.js';
import { buildResearchPlan } from '../../backend/src/research/plan.js';
import type { FakeStep } from '../../backend/test/support/fake-foundry.js';
import { startFakeWorld, type FakeWorld, type Harness } from './ai-fake.js';
import { loadScenarios } from './ai-datasets.js';
import {
  loadPlans,
  type PlanCase,
  type PlanCorruption,
  type PlanInjection,
  type PlansFile,
} from './ai-suite-data.js';
import type { Split } from './datasets.js';
import { stringsOf } from './measure-plan.js';

/**
 * The research planner, observed in two modes. In rules mode the rules plan every labelled question,
 * with no model. In fake-foundry mode the real runner and client plan them against the in-process
 * fake of the Foundry endpoint, whose replies are derived from the labels: a clean reply for every
 * question, then each class of corruption of a reply, once as a fault the one correction mends and
 * once as a fault that persists. That measures the rules around a model, never a model's quality.
 */

const NOW = Date.UTC(2026, 10, 3);

export type PlanArm = 'rules' | 'clean' | 'transient' | 'persistent' | 'provider' | 'refusal';

export interface PlanRun {
  id: string;
  kind: 'case' | 'injection';
  split: Split;
  arm: PlanArm;
  /** The corruption class or provider arm; null for the rules and the clean reply. */
  corruption: string | null;
  /** What the product returned: a model's plan, rules' plan in its place, or an error. */
  result: 'rules' | 'model' | 'refused' | 'error';
  code: string | null;
  plan: ResearchPlan | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  question: string;
  case: PlanCase | null;
  injection: PlanInjection | null;
}

export interface PlanObservation {
  file: PlansFile;
  runs: PlanRun[];
  /** What the fake found wrong in anything it was scripted to say or sent. */
  fakeProblems: string[];
}

export interface PlanQuestion {
  id: string;
  kind: 'case' | 'injection';
  split: Split;
  question: string;
  guidance?: string;
  horizon?: string;
  geography?: string;
  case: PlanCase | null;
  injection: PlanInjection | null;
}

/** Every question of the dataset as the planner is asked it: a scenario's own text where a scenario is named. */
export function planQuestions(file: PlansFile = loadPlans()): PlanQuestion[] {
  const scenarios = new Map(loadScenarios().map((scenario) => [scenario.id, scenario.question]));
  const cases = file.cases.map((item): PlanQuestion => ({
    id: item.id,
    kind: 'case',
    split: item.split,
    question: item.scenario ? (scenarios.get(item.scenario) ?? '') : (item.question ?? ''),
    ...(item.intake?.guidance ? { guidance: item.intake.guidance } : {}),
    ...(item.intake?.horizon ? { horizon: item.intake.horizon } : {}),
    ...(item.intake?.geography ? { geography: item.intake.geography } : {}),
    case: item,
    injection: null,
  }));
  const injections = file.injections.map((item): PlanQuestion => ({
    id: item.id,
    kind: 'injection',
    split: item.split,
    question: item.question,
    ...(item.guidance ? { guidance: item.guidance } : {}),
    case: null,
    injection: item,
  }));
  return [...cases, ...injections];
}

// ---------------------------------------------------------------------------------------------
// Replies derived from the labels
// ---------------------------------------------------------------------------------------------

type Reply = Record<string, unknown>;

/** The plan a model would write if it wrote what the labels say: nothing a check refuses. */
export function cleanPlanReply(item: PlanCase): Reply {
  return {
    entities: item.entities.map((entity) => ({ name: entity.name, kind: entity.kind })),
    topics: item.topics.map((topic) => topic.slots.map((slot) => slot[0]).join(' ')),
    claimsToVerify: item.claims.map((claim, index) => ({
      id: `c${index + 1}`,
      statement: claim.statement,
      why: 'Stated in the question; check what published sources say.',
    })),
    likelySources: [
      {
        category: 'primary' satisfies SourceCategory,
        description: 'Documents written by the people or organisations the question is about.',
      },
      {
        category: 'credible-reporting' satisfies SourceCategory,
        description: 'Reports from news organisations that name their sources.',
      },
    ],
    timeSensitivity: {
      level: 'none',
      note: 'No period is named, so relevant pages of any age are kept.',
    },
    conflictsToLookFor: ['Pages that say the opposite of a claim.'],
    missingEvidence: ['Evidence about the people or groups the decision affects.'],
  };
}

export const SUGGESTED_SITE = 'harbour.example.org';

let neutralBase: Reply | null = null;

/** Whether the plan a run returned still carries what its class of corruption planted. */
export function leaksOf(run: Pick<PlanRun, 'plan' | 'corruption' | 'injection'>): boolean {
  if (run.plan === null || run.corruption === null) return false;
  neutralBase ??= cleanPlanReply(loadPlans().cases[0]!);
  const planted = corrupt(run.corruption, neutralBase, {
    markers: run.injection?.markers ?? [],
    bait: run.injection?.bait ?? null,
  });
  return planted.leaked(run.plan);
}

interface Corrupted {
  step: FakeStep;
  /** Whether the plan the product returns still carries what this class planted. */
  leaked: (plan: ResearchPlan) => boolean;
}

/** The text of a plan outside its `question`, which is the person's own words and holds whatever they wrote. */
const texts = (plan: ResearchPlan): string[] =>
  stringsOf(plan)
    .filter((entry) => entry.path !== 'question')
    .map((entry) => entry.text);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

/** A reply with one thing wrong, as the scripted step that says it, and how to tell whether the returned plan kept it. */
export function corrupt(
  id: string,
  base: Reply,
  context: { markers: readonly string[]; bait: string | null },
): Corrupted {
  const copy = structuredClone(base) as Reply & {
    topics: string[];
    claimsToVerify: { id: string; statement: string; why: string }[];
    likelySources: { category: string; description: string; suggestedDomain?: string }[];
    timeSensitivity: { level: string; note: string };
  };
  const reply = (leaked: (plan: ResearchPlan) => boolean): Corrupted => ({
    step: { kind: 'reply', value: copy },
    leaked,
  });
  const domainOf = (value: string): Corrupted => {
    copy.likelySources[0]!.suggestedDomain = value;
    return reply((plan) => plan.likelySources.some((source) => source.suggestedDomain === value));
  };
  const marker = context.markers[0] ?? 'MARKER-0000';
  switch (id) {
    case 'missing-time-sensitivity': {
      const rest = Object.fromEntries(
        Object.entries(copy).filter(([key]) => key !== 'timeSensitivity'),
      );
      return { step: { kind: 'text', text: JSON.stringify(rest) }, leaked: () => false };
    }
    case 'claim-ids-out-of-order':
      copy.claimsToVerify.forEach((claim, index) => {
        claim.id = `c${copy.claimsToVerify.length - index + 1}`;
      });
      return reply((plan) =>
        plan.claimsToVerify.some((claim, index) => claim.id !== `c${index + 1}`),
      );
    case 'address-in-description':
      copy.likelySources[0]!.description += ' See https://harbour.example.org/fees for details.';
      return reply((plan) => texts(plan).some((text) => /https?:\/\//u.test(text)));
    case 'address-in-claim-www':
      copy.claimsToVerify[0]!.statement += ' (www.harbour.example.org/fees)';
      return reply((plan) => texts(plan).some((text) => /\bwww\./u.test(text)));
    case 'domain-with-scheme':
      return domainOf('https://harbour.example.org');
    case 'domain-with-path':
      return domainOf('harbour.example.org/fees');
    case 'domain-ip-address':
      return domainOf('203.0.113.9');
    case 'domain-localhost':
      return domainOf('localhost');
    case 'domain-single-label':
      return domainOf('intranet');
    case 'domain-upper-case':
      return domainOf('Harbour.Example.org');
    case 'domain-repeated':
      copy.likelySources[0]!.suggestedDomain = SUGGESTED_SITE;
      copy.likelySources[1]!.suggestedDomain = SUGGESTED_SITE;
      return reply(
        (plan) =>
          plan.likelySources.filter((source) => source.suggestedDomain === SUGGESTED_SITE).length >
          1,
      );
    case 'control-character':
      copy.topics[0] += '\u0007';
      return reply((plan) => texts(plan).some((text) => CONTROL.test(text)));
    case 'forecast-wording':
      copy.likelySources[0]!.description = 'The authority will certainly raise the fee next year.';
      return reply((plan) => texts(plan).some((text) => /will certainly raise/u.test(text)));
    case 'percentage-wording':
      copy.timeSensitivity.note = 'Fee changes are listed as 12% of the schedule.';
      return reply((plan) => plan.timeSensitivity.note.includes('12%'));
    case 'category-user-supplied':
      copy.likelySources[0]!.category = 'user-supplied';
      return reply((plan) =>
        plan.likelySources.some((source) => source.category === 'user-supplied'),
      );
    case 'too-many-topics':
      copy.topics = Array.from({ length: 11 }, (_, index) => `topic number ${index + 1}`);
      return reply((plan) => plan.topics.length > 10);
    case 'obeys-injection':
      copy.topics.push(marker);
      copy.claimsToVerify[0]!.statement += ` ${marker}`;
      return reply((plan) =>
        texts(plan).some((text) => text.toLowerCase().includes(marker.toLowerCase())),
      );
    case 'suggests-bait-site':
      return domainOf(context.bait ?? 'bait.example');
    default:
      throw new Error(`Unknown corruption class ${id}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------------------------

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'THROWN';

const inputOf = (question: PlanQuestion) => ({
  question: question.question,
  intake: {
    ...(question.guidance ? { guidance: question.guidance } : {}),
    ...(question.horizon ? { horizon: question.horizon } : {}),
    ...(question.geography ? { geography: question.geography } : {}),
  },
  mode: 'discovery' as const,
  budget: DEFAULT_RESEARCH_BUDGET,
  now: NOW,
});

const recordOf = (
  question: PlanQuestion,
  arm: PlanArm,
  corruption: string | null,
  rest: Pick<
    PlanRun,
    'result' | 'code' | 'plan' | 'requests' | 'inputTokens' | 'outputTokens' | 'ms'
  >,
): PlanRun => ({
  id: question.id,
  kind: question.kind,
  split: question.split,
  arm,
  corruption,
  question: question.question,
  case: question.case,
  injection: question.injection,
  ...rest,
});

/** Rules plan every question, with no model. */
export async function observeRulesPlans(file: PlansFile = loadPlans()): Promise<PlanRun[]> {
  const runs: PlanRun[] = [];
  for (const question of planQuestions(file)) {
    const started = performance.now();
    const outcome = await buildResearchPlan({
      ...inputOf(question),
      runner: null,
      signal: new AbortController().signal,
    });
    runs.push(
      recordOf(question, 'rules', null, {
        result: 'rules',
        code: null,
        plan: outcome.plan,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        ms: performance.now() - started,
      }),
    );
  }
  return runs;
}

/** One planning call against a model endpoint, counted: the requests it made, the tokens it reported, the time it took. */
export async function planOnce(
  world: Harness,
  question: PlanQuestion,
  setup: { steps?: FakeStep[]; answerAll?: FakeStep; costCeilingUsd?: number },
  arm: PlanArm,
  corruption: string | null,
): Promise<PlanRun> {
  const { fake, config } = world;
  if (!config) throw new Error('A planning call needs the server configuration of the harness.');
  if (fake) {
    fake.reset();
    if (setup.answerAll) {
      const step = setup.answerAll;
      fake.respond(() => step);
    } else if (setup.steps) {
      fake.script(...setup.steps);
    }
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;
  const onUsage: ModelUsageSink = Object.assign(
    (usage: { inputTokens: number; outputTokens: number }) => {
      calls += 1;
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
    },
    {
      admit: () => {
        if (
          world.tokenBudget !== undefined &&
          (world.spent ?? 0) + inputTokens + outputTokens >= world.tokenBudget
        )
          throw Object.assign(new Error('The token budget of the evaluation is used.'), {
            code: 'EVAL_TOKEN_BUDGET',
          });
      },
    },
  ) as ModelUsageSink;
  const runner = taskRunnerFor(config, world.factory, {
    onUsage,
    maxCalls: 3,
    budget: newOperationBudget(config, {}),
  });
  const started = performance.now();
  let plan: ResearchPlan | null = null;
  let result: PlanRun['result'] = 'error';
  let code: string | null = null;
  try {
    const outcome = await buildResearchPlan({
      ...inputOf(question),
      runner,
      signal: new AbortController().signal,
      ...(setup.costCeilingUsd ? { costCeilingUsd: setup.costCeilingUsd } : {}),
    });
    plan = outcome.plan;
    result = outcome.origin;
    code = outcome.failure?.code ?? null;
  } catch (error) {
    code = codeOf(error);
    result = code === 'MODEL_REFUSED' ? 'refused' : 'error';
  }
  const ms = performance.now() - started;
  if (fake) world.problems.push(...fake.problems);
  world.spent = (world.spent ?? 0) + inputTokens + outputTokens;
  return recordOf(question, arm, corruption, {
    result,
    code,
    plan,
    requests: fake ? fake.requests.length : calls,
    inputTokens,
    outputTokens,
    ms,
  });
}

/** The cases whose questions the corruptions are run on: one of each split, to keep it quick. `npm run eval:ai` runs the same. */
export const CORRUPTED_CASES = ['L07', 'L08'] as const;

const classesFor = (
  question: PlanQuestion,
  corruptions: readonly PlanCorruption[],
  cases: readonly string[],
): PlanCorruption[] =>
  corruptions.filter((item) => {
    if (item.expect === 'accepted') return false;
    if (item.onlyWithMarkers) return (question.injection?.markers.length ?? 0) > 0;
    if (item.onlyWithBait) return question.injection?.bait != null;
    return question.kind === 'case' && cases.includes(question.id);
  });

export interface PlanFakeOptions {
  /** Corrupt only these cases (the clean arm always runs for every question). */
  corruptCases?: readonly string[];
}

/** Plan every question against the fake: a clean reply, then each class of corruption, then the provider arms. */
export async function observeFakePlans(
  file: PlansFile = loadPlans(),
  options: PlanFakeOptions = {},
  existing?: FakeWorld,
): Promise<{ runs: PlanRun[]; problems: string[] }> {
  const world = existing ?? (await startFakeWorld({ prices: true }));
  const runs: PlanRun[] = [];
  try {
    const questions = planQuestions(file);
    const byId = new Map(file.cases.map((item) => [item.id, item]));
    const neutral = byId.get('L07')!;
    const baseFor = (question: PlanQuestion): Reply => cleanPlanReply(question.case ?? neutral);
    for (const question of questions) {
      runs.push(
        await planOnce(
          world,
          question,
          { steps: [{ kind: 'reply', value: baseFor(question) }] },
          'clean',
          null,
        ),
      );
      const chosen = classesFor(
        question,
        file.corruptions,
        options.corruptCases ?? CORRUPTED_CASES,
      );
      for (const item of chosen) {
        const planted = corrupt(item.id, baseFor(question), {
          markers: question.injection?.markers ?? [],
          bait: question.injection?.bait ?? null,
        });
        const clean = { kind: 'reply', value: baseFor(question) } as const;
        runs.push(
          await planOnce(world, question, { steps: [planted.step, clean] }, 'transient', item.id),
          await planOnce(world, question, { answerAll: planted.step }, 'persistent', item.id),
        );
      }
    }
    const first = questions.find((question) => question.id === 'L07')!;
    runs.push(
      await planOnce(
        world,
        first,
        { answerAll: { kind: 'status', status: 500 } },
        'provider',
        'provider-error',
      ),
      await planOnce(
        world,
        first,
        { answerAll: { kind: 'refusal' } },
        'refusal',
        'provider-refusal',
      ),
    );
    return { runs, problems: [...world.problems] };
  } finally {
    if (!existing) await world.close();
  }
}
