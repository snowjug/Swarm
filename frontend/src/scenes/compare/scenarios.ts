import {
  RESPONSE_CATEGORIES,
  type Analysis,
  type Finding,
  type ResponseShares,
  type Variant,
} from '../../../../shared/analysis';
import { adverseShare, quantile } from '../../lib/analysis';

/** One scenario of the comparison with everything the page says of it, worked out once from its seeded runs. */
export interface Scenario {
  id: string;
  label: string;
  kind: Variant['kind'];
  description: string;
  /** The round the change lands in, and how strongly. The strength is a system assumption unless a person set it. */
  round: number;
  intensity: number;
  runs: number;
  /** The mean share of simulated members in each response over the runs. */
  shares: ResponseShares;
  /** The mean share looking for an alternative or resisting. */
  adverse: number;
  /** How far that share spread across the runs. */
  spread: { p10: number; p50: number; p90: number };
  /** The mean overall final stance, from -1 (against) to +1 (in favour). */
  stance: number;
  /** Its place among the scenarios as configured: what its colour and key follow. */
  index: number;
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** The scenarios that have results, in the order the comparison was set up. A scenario with no runs is left out. */
export function scenariosOf(analysis: Analysis): Scenario[] {
  return analysis.config.variants.flatMap((variant, index) => {
    const result = analysis.variants.find((candidate) => candidate.variantId === variant.id);
    if (!result || result.runs.length === 0) return [];
    const shares = Object.fromEntries(
      RESPONSE_CATEGORIES.map((category) => [
        category,
        mean(result.runs.map((run) => run.responseShares[category])),
      ]),
    ) as ResponseShares;
    const adverse = result.runs.map((run) => adverseShare(run.responseShares));
    return [
      {
        id: variant.id,
        label: variant.label,
        kind: variant.kind,
        description: variant.description,
        round: variant.round,
        intensity: variant.intensity,
        runs: result.runs.length,
        shares,
        adverse: adverseShare(shares),
        spread: {
          p10: quantile(adverse, 0.1),
          p50: quantile(adverse, 0.5),
          p90: quantile(adverse, 0.9),
        },
        stance: mean(result.runs.map((run) => run.stanceMean)),
        index,
      },
    ];
  });
}

/** A difference in overall stance smaller than this is not called a direction: the engine's own cut-off for its findings. */
export const DIRECTION_EPSILON = 0.01;

export type Verdict = 'less' | 'more' | 'same';

export const verdictOf = (stanceDelta: number): Verdict =>
  stanceDelta < -DIRECTION_EPSILON ? 'less' : stanceDelta > DIRECTION_EPSILON ? 'more' : 'same';

/** One scenario set against another, on the seeds both ran. Every difference is `b` minus `a`. */
export interface Gap {
  a: Scenario;
  b: Scenario;
  /** How many seeded runs both scenarios ran: the runs the differences are paired on. */
  paired: number;
  /** The mean paired difference of the share looking for an alternative or resisting, in 0..1 units. */
  delta: number;
  /** How that paired difference spread across the runs. */
  deltaSpread: { p10: number; p50: number; p90: number };
  /** In how many of the paired runs the share was higher under `b`. */
  higher: number;
  /** The mean paired difference of the overall stance. */
  stanceDelta: number;
  verdict: Verdict;
}

export function gapOf(analysis: Analysis, a: Scenario, b: Scenario): Gap {
  const runsA = analysis.variants.find((result) => result.variantId === a.id)?.runs ?? [];
  const runsB = new Map(
    (analysis.variants.find((result) => result.variantId === b.id)?.runs ?? []).map((run) => [
      run.seed,
      run,
    ]),
  );
  const pairs = runsA.flatMap((run) => {
    const other = runsB.get(run.seed);
    return other ? [{ a: run, b: other }] : [];
  });
  if (pairs.length === 0) {
    // Nothing was run on the same seed, so the difference is of the two means and says so by its count.
    const delta = b.adverse - a.adverse;
    const stanceDelta = b.stance - a.stance;
    return {
      a,
      b,
      paired: 0,
      delta,
      deltaSpread: { p10: delta, p50: delta, p90: delta },
      higher: 0,
      stanceDelta,
      verdict: verdictOf(stanceDelta),
    };
  }
  const differences = pairs.map(
    (pair) => adverseShare(pair.b.responseShares) - adverseShare(pair.a.responseShares),
  );
  const stanceDelta = mean(pairs.map((pair) => pair.b.stanceMean - pair.a.stanceMean));
  return {
    a,
    b,
    paired: pairs.length,
    delta: mean(differences),
    deltaSpread: {
      p10: quantile(differences, 0.1),
      p50: quantile(differences, 0.5),
      p90: quantile(differences, 0.9),
    },
    higher: differences.filter((difference) => difference > 0).length,
    stanceDelta,
    verdict: verdictOf(stanceDelta),
  };
}

/**
 * The engine's own finding that sets a change against the baseline on the same seeds, when the reference is
 * the baseline. For any other pairing there is no such finding, and none is made up.
 */
export function directionFindingOf(
  findings: readonly Finding[],
  a: Pick<Scenario, 'kind'>,
  b: Pick<Scenario, 'id'>,
): Finding | null {
  if (a.kind !== 'baseline') return null;
  return (
    findings.find(
      (finding) => finding.kind === 'direction-vs-baseline' && finding.variantId === b.id,
    ) ?? null
  );
}

export type GapTone = 'against' | 'favor' | 'neutral';

/** Which way the paired difference points: more of the simulated members adverse, fewer, or no difference to speak of. */
export const gapTone = (delta: number): GapTone =>
  delta > 0.0005 ? 'against' : delta < -0.0005 ? 'favor' : 'neutral';
