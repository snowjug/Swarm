import type { DecisionObservation, ExampleRun, FixtureRun } from './ai-decision.js';
import type { SplitFilter } from './ai-measure-rules.js';
import { rateOf, type Rate } from './measure-stats.js';

/**
 * The registered decision metrics, over the gold fixtures (which have a split) and the canvases of the
 * five worked examples (which have no gold of their own and no split, so they are in the pooled
 * numbers of the metrics that are about every canvas and in none of the dev or test columns).
 */

export interface DecisionMeasures {
  filter: SplitFilter;
  fixtures: number;
  examples: number;
  /** The status and the rule the document allows, and the conditions and the preferred option the gold names. */
  status: Rate;
  statusMisses: { id: string; problems: string[] }[];
  /** Each lens whose gold names the clear leader, or says there is none, over the lens the canvas gives. */
  lenses: Rate;
  lensMisses: { id: string; what: string; gold: string | null; got: string | null }[];
  /** The agreement or disagreement of the lenses, where the gold names it. */
  agreement: Rate;
  /** Complete and right, as registered: every part stated or missing, the card's list exactly those with reversibility while unknown, the kind of the status. */
  recommendation: Rate;
  recommendationMisses: { id: string; problems: string[] }[];
  /** The same, without asking the card's list to hold reversibility. Not registered: it says what the one gap is. */
  recommendationOtherwise: Rate;
  wording: {
    count: number;
    of: number;
    where: { id: string; path: string; why: string; text: string }[];
  };
  errors: { id: string; error: string }[];
  /** What the gold fixtures reach, so that a reader can see that every status and rule was put to the test. */
  reached: { statuses: Record<string, number>; rules: Record<string, number> };
  /** What the canvases of the worked examples came out as: not gold, only what the real pipeline gave. */
  exampleStatuses: Record<string, number>;
  elapsedMs: number;
}

const inFilter = (run: FixtureRun, filter: SplitFilter): boolean =>
  filter === 'all' || run.split === filter;

const reversibilityOnly = (problems: readonly string[]): boolean =>
  problems.length > 0 &&
  problems.every((problem) => problem === 'reversibility is missing and not listed');

const tally = (names: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const name of names) out[name] = (out[name] ?? 0) + 1;
  return out;
};

/** Measures the decision canvases on a split. */
export function measureDecisions(
  observed: DecisionObservation,
  filter: SplitFilter,
): DecisionMeasures {
  const fixtures = observed.fixtures.filter((run) => inFilter(run, filter));
  const examples: ExampleRun[] = filter === 'all' ? observed.examples : [];

  const statusMisses = fixtures
    .filter((run) => run.error !== null || !run.statusScore?.ok)
    .map((run) => ({
      id: run.id,
      problems: run.error ? [run.error] : (run.statusScore?.problems ?? []),
    }));

  let lensChecked = 0;
  let lensAgreed = 0;
  let agreementChecked = 0;
  let agreementAgreed = 0;
  const lensMisses: DecisionMeasures['lensMisses'] = [];
  for (const run of fixtures) {
    const wantsAgreement = run.fixture.gold.agreement !== null;
    const leaders = Object.keys(run.fixture.gold.leaders).length;
    lensChecked += leaders;
    if (wantsAgreement) agreementChecked += 1;
    if (!run.lensScore) continue;
    const misses = run.lensScore.misses;
    lensAgreed += leaders - misses.filter((miss) => miss.what !== 'agreement').length;
    if (wantsAgreement && !misses.some((miss) => miss.what === 'agreement')) agreementAgreed += 1;
    for (const miss of misses.filter((item) => item.what !== 'agreement'))
      lensMisses.push({ id: run.id, ...miss });
  }

  const canvases = [
    ...fixtures.map((run) => ({ id: run.id, run, problems: run.recommendation })),
    ...examples.map((run) => ({
      id: `${run.example}/${run.variant}`,
      run,
      problems: run.recommendation,
    })),
  ];
  const built = canvases.filter((item) => item.run.error === null);
  const recommendationMisses = built
    .filter((item) => item.problems.length > 0)
    .map((item) => ({ id: item.id, problems: item.problems }));

  const wordingWhere: DecisionMeasures['wording']['where'] = [];
  let strings = 0;
  for (const run of fixtures) {
    strings += run.strings;
    for (const item of run.wording) wordingWhere.push({ id: run.id, ...item });
  }
  for (const run of examples) {
    strings += run.strings;
    for (const item of run.wording)
      wordingWhere.push({ id: `${run.example}/${run.variant}`, ...item });
  }

  const errors = [
    ...fixtures
      .filter((run) => run.error)
      .map((run) => ({ id: run.id, error: run.error as string })),
    ...examples
      .filter((run) => run.error)
      .map((run) => ({ id: `${run.example}/${run.variant}`, error: run.error as string })),
  ];

  return {
    filter,
    fixtures: fixtures.length,
    examples: examples.length,
    status: rateOf(fixtures.length - statusMisses.length, fixtures.length),
    statusMisses,
    lenses: rateOf(lensAgreed, lensChecked),
    lensMisses,
    agreement: rateOf(agreementAgreed, agreementChecked),
    recommendation: rateOf(built.length - recommendationMisses.length, canvases.length),
    recommendationMisses,
    recommendationOtherwise: rateOf(
      built.filter((item) => item.problems.length === 0 || reversibilityOnly(item.problems)).length,
      canvases.length,
    ),
    wording: { count: wordingWhere.length, of: strings, where: wordingWhere },
    errors,
    reached: {
      statuses: tally(fixtures.flatMap((run) => (run.status ? [run.status] : []))),
      rules: tally(fixtures.flatMap((run) => (run.rule ? [run.rule] : []))),
    },
    exampleStatuses: tally(examples.flatMap((run) => (run.status ? [run.status] : []))),
    elapsedMs: observed.elapsedMs,
  };
}
