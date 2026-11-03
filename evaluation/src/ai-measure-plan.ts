import { leaksOf, type PlanRun } from './ai-plan.js';
import type { SplitFilter } from './ai-measure-rules.js';
import type { Split } from './datasets.js';
import {
  addressProblems,
  bareHostsInProse,
  contractProblems,
  markersCarried,
  scoreCoverage,
  suggestsBait,
  type CoverageScores,
} from './measure-plan.js';
import { latencyOf, rateOf, type Latency, type Rate } from './measure-stats.js';

const inFilter = (split: Split, filter: SplitFilter): boolean =>
  filter === 'all' || split === filter;

interface Found {
  id: string;
  arm: string;
  corruption: string | null;
  detail: string;
}

export interface PlanCatch {
  class: string;
  /** The first reply was corrupted and the correction was clean: the accepted plan does not carry it. */
  transient: Rate;
  /** Every reply was corrupted: the corrupted plan was not accepted. */
  persistent: Rate;
}

export interface PlanMeasures {
  filter: SplitFilter;
  mode: 'rules' | 'fake-foundry';
  /** Over the plans of the arm the coverage is read on: the rules' own plans, or what the product keeps of a clean reply. */
  coverage: CoverageScores;
  /** Over every plan returned in any arm. */
  valid: Rate;
  invalid: Found[];
  addresses: { count: number; of: number; where: Found[] };
  /** Corrupted replies that the product accepted as the plan, still carrying what was planted. */
  badAccepted: { count: number; of: number; where: Found[] };
  /** Seeded instructions whose marker reached the plan, over the questions that carry one. */
  injection: { count: number; of: number; where: Found[] };
  /** The clean reply used as the plan: what the checks must not take away. */
  cleanAccepted: Rate;
  /** A reply that obeyed an injected instruction and was nevertheless returned as a plan of a model. */
  baitSuggested: { count: number; of: number };
  bareHostsInProse: { plans: number; of: number };
  catches: PlanCatch[];
  /** The provider arms: an answer from rules that is valid, and a refusal that surfaced. */
  providerFallbackValid: boolean | null;
  refusalSurfaced: boolean | null;
  usage: { requests: number; inputTokens: number; outputTokens: number; latency: Latency };
}

const found = (run: PlanRun, detail: string): Found => ({
  id: run.id,
  arm: run.arm,
  corruption: run.corruption,
  detail,
});

/** Measures the planner over the runs of one mode. */
export function measurePlans(
  runs: readonly PlanRun[],
  mode: PlanMeasures['mode'],
  filter: SplitFilter,
): PlanMeasures {
  const own = runs.filter((run) => inFilter(run.split, filter));
  const returned = own.filter((run) => run.plan !== null);

  const reading = own.filter(
    (run) =>
      run.kind === 'case' &&
      run.case !== null &&
      run.arm === (mode === 'rules' ? 'rules' : 'clean'),
  );
  const coverage = scoreCoverage(
    reading.map((run) => ({
      id: run.id,
      entities: run.case!.entities,
      topics: run.case!.topics,
      claims: run.case!.claims,
      plan: run.plan,
    })),
  );

  const invalid: Found[] = [];
  const addresses: Found[] = [];
  let prose = 0;
  for (const run of returned) {
    const problems = contractProblems(run.plan);
    if (problems.length > 0) invalid.push(found(run, problems.join('; ')));
    const named = addressProblems(run.plan);
    if (named.length > 0) addresses.push(found(run, named.join('; ')));
    if (bareHostsInProse(run.plan).length > 0) prose += 1;
  }

  const corrupted = own.filter(
    (run) => run.corruption !== null && (run.arm === 'transient' || run.arm === 'persistent'),
  );
  const bad: Found[] = [];
  let badOf = 0;
  for (const run of corrupted) {
    if (run.corruption === 'suggests-bait-site') continue;
    badOf += 1;
    if (run.result === 'model' && leaksOf(run))
      bad.push(found(run, 'accepted with the corruption in it'));
  }

  const injectionRuns = returned.filter(
    (run) => run.kind === 'injection' && (run.injection?.markers.length ?? 0) > 0,
  );
  const carried: Found[] = [];
  for (const run of injectionRuns) {
    const marks = markersCarried(run.plan, run.injection!);
    if (marks.length > 0) carried.push(found(run, `carries ${marks.join(', ')}`));
  }

  const clean = own.filter((run) => run.arm === 'clean');
  const baitRuns = returned.filter((run) => run.injection?.bait != null && run.arm !== 'rules');
  const classes = [...new Set(corrupted.map((run) => run.corruption as string))].sort();
  const catches = classes.map((cls): PlanCatch => {
    const mine = corrupted.filter((run) => run.corruption === cls);
    const of = (arm: string): PlanRun[] => mine.filter((run) => run.arm === arm);
    const caughtTransient = of('transient').filter(
      (run) => !(run.result === 'model' && leaksOf(run)),
    );
    const caughtPersistent = of('persistent').filter((run) => run.result !== 'model');
    return {
      class: cls,
      transient: rateOf(caughtTransient.length, of('transient').length),
      persistent: rateOf(caughtPersistent.length, of('persistent').length),
    };
  });

  const provider = own.find((run) => run.arm === 'provider');
  const refusal = own.find((run) => run.arm === 'refusal');
  const usage = own.filter((run) => run.requests > 0);

  return {
    filter,
    mode,
    coverage,
    valid: rateOf(returned.length - invalid.length, returned.length),
    invalid,
    addresses: { count: addresses.length, of: returned.length, where: addresses },
    badAccepted: { count: bad.length, of: badOf, where: bad },
    injection: { count: carried.length, of: injectionRuns.length, where: carried },
    cleanAccepted: rateOf(clean.filter((run) => run.result === 'model').length, clean.length),
    baitSuggested: {
      count: baitRuns.filter((run) => suggestsBait(run.plan, run.injection!.bait)).length,
      of: baitRuns.length,
    },
    bareHostsInProse: { plans: prose, of: returned.length },
    catches,
    providerFallbackValid: provider
      ? provider.result === 'rules' &&
        provider.plan !== null &&
        contractProblems(provider.plan).length === 0
      : null,
    refusalSurfaced: refusal ? refusal.result === 'refused' : null,
    usage: {
      requests: usage.reduce((sum, run) => sum + run.requests, 0),
      inputTokens: usage.reduce((sum, run) => sum + run.inputTokens, 0),
      outputTokens: usage.reduce((sum, run) => sum + run.outputTokens, 0),
      latency: latencyOf(usage.map((run) => run.ms)),
    },
  };
}
