import {
  RESPONSE_CATEGORIES,
  type Analysis,
  type Finding,
  type ResponseShares,
  type RunOutcome,
  type SensitivityClass,
  type SensitivityRow,
  type StabilityClass,
  type Variant,
} from '../../../shared/analysis';
import { MAX_TOTAL_RUNS, USER_SET_NOTE, planRuns } from '../../../shared/analysis-plan';
import { changeCanMoveAnyone } from '../../../shared/signal';
import type { Actor } from '../../../shared/stakeholders';
import type { Tone } from './ledger';

/** Everything the comparison screens work out from an analysis, kept apart from the markup so it can be tested. */

export const adverseShare = (shares: ResponseShares): number => shares.switch + shares.resist;

/** A quantile by linear interpolation between the closest ranks. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const below = Math.floor(position);
  const low = sorted[below] ?? 0;
  const high = sorted[Math.ceil(position)] ?? low;
  return low + (position - below) * (high - low);
}

export const percentText = (value: number): string => `${Math.round(value * 100)}%`;

/** A share of simulated members as whole points, never as a rate. */
export const signedPoints = (value: number): string => {
  const points = Math.round(value * 100);
  return `${points > 0 ? '+' : ''}${points}`;
};

export const signedNumber = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;

export function durationText(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

export interface VariantDistribution {
  variantId: string;
  label: string;
  kind: Variant['kind'];
  runs: number;
  /** The mean of each response share over the seeded runs. */
  shares: ResponseShares;
  /** How far the share looking for an alternative or resisting spread across the runs. */
  adverse: { p10: number; p50: number; p90: number };
}

export function variantDistributions(analysis: Analysis): VariantDistribution[] {
  return analysis.config.variants.flatMap((variant) => {
    const result = analysis.variants.find((candidate) => candidate.variantId === variant.id);
    if (!result || result.runs.length === 0) return [];
    const shares = Object.fromEntries(
      RESPONSE_CATEGORIES.map((category) => [
        category,
        result.runs.reduce((sum, run) => sum + run.responseShares[category], 0) /
          result.runs.length,
      ]),
    ) as ResponseShares;
    const adverse = result.runs.map((run) => adverseShare(run.responseShares));
    return [
      {
        variantId: variant.id,
        label: variant.label,
        kind: variant.kind,
        runs: result.runs.length,
        shares,
        adverse: {
          p10: quantile(adverse, 0.1),
          p50: quantile(adverse, 0.5),
          p90: quantile(adverse, 0.9),
        },
      },
    ];
  });
}

export function intervalText(finding: Finding): string {
  return `${Math.round(finding.interval.lo * 100)}–${Math.round(finding.interval.hi * 100)}%`;
}

export const holdsText = (finding: Finding): string =>
  `holds in ${finding.holdsIn} of ${finding.of} seeded runs (95% interval ${intervalText(finding)})`;

export const STABILITY: Record<
  StabilityClass,
  { label: string; tone: Tone; explain: (runs: number) => string }
> = {
  repeatable: {
    label: 'Repeatable',
    tone: 'good',
    explain: () =>
      'It held in nearly every seeded run: even the cautious end of the interval is 80% of runs or more.',
  },
  'mostly-repeatable': {
    label: 'Mostly repeatable',
    tone: 'info',
    explain: (runs) =>
      runs < 10
        ? `It held in most seeded runs, but with only ${runs} runs nothing is called repeatable.`
        : 'It held in most seeded runs, but the interval is wide enough that it may not hold every time.',
  },
  unstable: {
    label: 'Unstable',
    tone: 'caution',
    explain: () =>
      'It held in some runs and not in others: the simulation does not settle this, so do not lean on it.',
  },
  rare: {
    label: 'Rare',
    tone: 'neutral',
    explain: () => 'It held in few seeded runs: under these assumptions it is the exception.',
  },
};

export const SENSITIVITY: Record<SensitivityClass, { label: string; tone: Tone; explain: string }> =
  {
    'assumption-sensitive': {
      label: 'Sensitive',
      tone: 'caution',
      explain: 'The result moves clearly, and by a material amount, when this assumption is moved.',
    },
    robust: {
      label: 'Robust',
      tone: 'good',
      explain: 'Moving this assumption changed the result by almost nothing.',
    },
    inconclusive: {
      label: 'Inconclusive',
      tone: 'neutral',
      explain: 'The shift is too small to matter, or too noisy to tell from chance.',
    },
  };

/** Whether the comparison's own cast and scenarios give the change any way to move anyone. */
export const cannotMoveAnyone = (analysis: Pick<Analysis, 'actors' | 'config'>): boolean =>
  !changeCanMoveAnyone(analysis.actors, analysis.config.variants);

/**
 * What a "robust" row says where the change cannot move anyone. Almost nothing changed when the
 * assumption was moved because there was nothing to change, which is not the same as the result
 * standing up to the assumption, so it must not read as a finding.
 */
export const NO_EFFECT_TO_TEST = {
  label: 'No effect to test',
  tone: 'neutral' as Tone,
  explain:
    'The change cannot move anyone under these assumptions, so there was no effect for this assumption to change. That is not evidence that the result is robust.',
};

export function sensitivityView(
  classification: SensitivityClass,
  noEffect: boolean,
): { label: string; tone: Tone; explain: string } {
  return noEffect && classification === 'robust' ? NO_EFFECT_TO_TEST : SENSITIVITY[classification];
}

export const ORIGIN: Record<
  SensitivityRow['assumptionOrigin'],
  { label: string; tone: Tone; evidenced: boolean }
> = {
  evidence: { label: 'Backed by supplied evidence', tone: 'good', evidenced: true },
  user: { label: 'Your assumption', tone: 'info', evidenced: false },
  'system-assumption': {
    label: 'System assumption: no evidence supplied',
    tone: 'caution',
    evidenced: false,
  },
  model: { label: 'Proposed by a model: no evidence supplied', tone: 'caution', evidenced: false },
  scenario: { label: 'Set by the scenario', tone: 'info', evidenced: false },
};

/** The sensitive assumptions that nothing supplied backs: where a result rests on a guess. */
export const unsupportedSensitive = (rows: readonly SensitivityRow[]): SensitivityRow[] =>
  rows.filter(
    (row) =>
      row.classification === 'assumption-sensitive' &&
      (row.assumptionOrigin === 'system-assumption' || row.assumptionOrigin === 'model'),
  );

/** How many findings and assumptions the results show at once; the rest are one disclosure away, unchanged. */
export const SHOWN_FINDINGS = 8;
export const SHOWN_ASSUMPTIONS = 6;

/**
 * A rare finding is material when it is about what a change might set off, an adverse threshold being
 * crossed or a follow-on event, under a scenario that is not the baseline. How seldom the threshold was
 * crossed, even never, is what the person asked the comparison to find out. A rare ordering is not
 * material, and nor is anything under the baseline, which is only the reference.
 */
const isMaterialRare = (finding: Finding, baselines: ReadonlySet<string>): boolean =>
  finding.classification === 'rare' &&
  (finding.kind === 'threshold-crossing' || finding.kind === 'second-order-event') &&
  !baselines.has(finding.variantId);

/**
 * The findings in the order to read them: the repeatable ones and the rare ones that matter first, then
 * the mostly repeatable, then the unstable, and last the rare ones that do not matter. Within each the
 * order the server gave, which puts the change before its alternatives and the baseline last.
 */
export function rankFindings(
  findings: readonly Finding[],
  variants: readonly Pick<Variant, 'id' | 'kind'>[],
): Finding[] {
  const baselines = new Set(
    variants.filter((variant) => variant.kind === 'baseline').map((variant) => variant.id),
  );
  const bucket = (finding: Finding): number => {
    switch (finding.classification) {
      case 'repeatable':
        return 0;
      case 'mostly-repeatable':
        return 1;
      case 'unstable':
        return 2;
      case 'rare':
        return isMaterialRare(finding, baselines) ? 0 : 3;
    }
  };
  return findings
    .map((finding, index) => ({ finding, index, bucket: bucket(finding) }))
    .sort((a, b) => a.bucket - b.bucket || a.index - b.index)
    .map((entry) => entry.finding);
}

const nameList = (names: readonly string[]): string => {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length > 4) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

/**
 * Three short lines that say what the comparison found, made only of what it already states: which
 * scenarios were compared and how many seeded runs of each, the finding that states the direction of the
 * proposed change against the baseline, and whether that finding is repeatable. Where the change cannot
 * move anyone there is no direction to state, and it says so instead.
 */
export function comparisonSummary(analysis: Analysis): string[] {
  const { variants, runsPerVariant } = analysis.config;
  const compared = `Compared ${nameList(variants.map((variant) => variant.label))}: ${runsPerVariant} seeded runs of each, on the same seeds.`;
  if (cannotMoveAnyone(analysis)) {
    return [
      compared,
      'Nothing in the change can move anyone in this cast, so a difference from no change below is noise and not an effect of the change.',
      'Say who is helped or harmed in the stakeholder review, then compare again.',
    ];
  }
  const proposed = variants.find((variant) => variant.kind === 'alternative');
  const direction = proposed
    ? analysis.findings.find(
        (finding) => finding.kind === 'direction-vs-baseline' && finding.variantId === proposed.id,
      )
    : undefined;
  if (!direction) {
    return [
      compared,
      'No finding sets the proposed change against the baseline on the same seeds.',
      'Read the findings below for what did hold.',
    ];
  }
  return [
    compared,
    direction.statement,
    `${STABILITY[direction.classification].label}: it ${holdsText(direction)}.`,
  ];
}

export interface ChainStep {
  id: string;
  round: number;
  kind: string;
  actor: string | null;
  description: string;
  /** What it followed from: an earlier event in the run, or a named signal. */
  because: { kind: 'event' | 'signal'; text: string }[];
}

/** The events of one run in the order they happened, each with what it followed from, to be read as a chain. */
export function chainOf(run: RunOutcome, actors: readonly Actor[]): ChainStep[] {
  const names = new Map(actors.map((actor) => [actor.id, actor.name]));
  const byId = new Map(run.events.map((event) => [event.id, event]));
  return run.events
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.round - b.event.round || a.order - b.order)
    .map(({ event }) => ({
      id: event.id,
      round: event.round,
      kind: event.kind,
      actor: event.actorId ? (names.get(event.actorId) ?? event.actorId) : null,
      description: event.description,
      because: event.causedBy.map((cause) => {
        const earlier = byId.get(cause);
        return earlier
          ? { kind: 'event' as const, text: `the ${earlier.kind} in round ${earlier.round}` }
          : { kind: 'signal' as const, text: `the “${cause}” signal` };
      }),
    }));
}

const ASSUMPTION_SENTENCE = /\s*Intensity [\d.]+ from round \d+ [^]*$/u;

/**
 * The description of a scenario after a person has edited it. A system-made one says its intensity is a
 * system assumption; once they have set a value that is no longer true, so the sentence is replaced.
 */
export function describeEdit(
  edited: Pick<Variant, 'description' | 'intensity' | 'round'>,
  original: Pick<Variant, 'intensity' | 'round'> | undefined,
): string {
  if (!original || (edited.intensity === original.intensity && edited.round === original.round)) {
    return edited.description;
  }
  const base = edited.description.replace(ASSUMPTION_SENTENCE, '').trimEnd();
  const note = `Intensity ${edited.intensity} from round ${edited.round} ${USER_SET_NOTE}.`;
  return `${base ? `${base} ` : ''}${note}`.slice(0, 600);
}

export interface EstimateInput {
  variants: number;
  runsPerVariant: number;
  sensitivity: boolean;
  perturbations: number;
  /** The simulated members of the cast (a key actor counts as one) and the rounds of a run: what sets how long a run takes. */
  members: number;
  rounds: number;
}

/**
 * What one seeded run takes, from measurement and not from any stand-in engine. The simulator's benchmark
 * (docs/analysis/engine-benchmark.md) puts a run of its typical cast, 600 simulated members over 24
 * rounds, at about 2 to 3 ms, and the comparison of the Copilot in Teams example on the real routes (25
 * actors, 334 simulated members, 12 rounds, 1,201 runs with the summaries, findings and sensitivity
 * around them) took 2.7 and 3.2 ms a run. A cast with more member updates (members times rounds) than
 * the typical one takes proportionally longer: 12,000 members over 12 rounds ran at 17 to 18.5 ms. A
 * smaller cast is not counted as faster, because what a run costs apart from its members (checking the
 * actors, what each actor reports each round) does not shrink with them.
 */
export const TYPICAL_RUN_MS = { low: 2, high: 3 } as const;
export const TYPICAL_MEMBER_ROUNDS = 600 * 24;

export function estimateRunMs(members: number, rounds: number): { low: number; high: number } {
  const scale = Math.max(1, (members * rounds) / TYPICAL_MEMBER_ROUNDS);
  return { low: TYPICAL_RUN_MS.low * scale, high: TYPICAL_RUN_MS.high * scale };
}

export function estimate(input: EstimateInput) {
  return planRuns(input);
}

/** A span of milliseconds said roughly, in whole seconds or minutes, so that it claims no more than it knows. */
export function durationRangeText(lowMs: number, highMs: number): string {
  if (highMs < 1_000) return 'under a second';
  const step = highMs < 10_000 ? 1_000 : highMs < 60_000 ? 5_000 : 60_000;
  const per = step === 60_000 ? 60_000 : 1_000;
  const unit = step === 60_000 ? 'minute' : 'second';
  const say = (ms: number): string => `${ms / per} ${unit}${ms === per ? '' : 's'}`;
  const high = Math.ceil(highMs / step) * step;
  const low = Math.floor(lowMs / step) * step;
  if (low <= 0) return `under ${say(high)}`;
  if (low >= high) return `about ${say(high)}`;
  return `about ${low / per} to ${say(high)}`;
}

/** How long a comparison of this size takes, from the engine's measured speed; null when the size of the cast is not known. */
export function estimateWallText(input: EstimateInput): string | null {
  if (input.members < 1) return null;
  const { low, high } = estimateRunMs(input.members, input.rounds);
  const { totalRuns } = estimate(input);
  return durationRangeText(totalRuns * low, totalRuns * high);
}

/** One line under the estimate that says where its time comes from. */
export const ESTIMATE_BASIS =
  'The time is estimated from the engine’s measured speed, not an assumed one: about 2 to 3 ms a run for a typical cast (600 simulated members over 24 rounds), and more for a larger one. A busy server takes longer.';

export function estimateText(input: EstimateInput, lastWallMs: number | null): string {
  const plan = estimate(input);
  const sensitivity =
    plan.sensitivityRuns > 0
      ? `, plus ${plan.sensitivityRuns.toLocaleString('en-GB')} for sensitivity (${plan.sensitivitySeeds} seeds, ${input.perturbations} assumptions moved one at a time): ${plan.totalRuns.toLocaleString('en-GB')} in all`
      : '';
  const time = estimateWallText(input);
  const last =
    lastWallMs === null
      ? ''
      : ` The last comparison on this project took ${durationText(lastWallMs)}.`;
  return `This runs ${plan.mainRuns.toLocaleString('en-GB')} simulated runs (${input.variants} scenarios × ${input.runsPerVariant} seeds)${sensitivity}. No model is called, so it costs server time only${time ? `, ${time}` : ''}.${last}`;
}

/** What stops a comparison from starting, in words, for the form to show beside the button. */
export function setupProblems(
  variants: readonly Variant[],
  runsPerVariant: number,
  sensitivity: boolean,
  perturbations: number,
  rounds: number,
): string[] {
  const problems: string[] = [];
  if (!variants.some((variant) => variant.kind === 'alternative')) {
    problems.push('Keep at least one alternative to compare with the baseline.');
  }
  for (const variant of variants) {
    if (variant.label.trim() === '') problems.push('Give every scenario a name.');
    if (!Number.isFinite(variant.intensity) || variant.intensity < 0 || variant.intensity > 1) {
      problems.push(`“${variant.label || 'A scenario'}”: intensity is from 0 to 1.`);
    }
    if (!Number.isInteger(variant.round) || variant.round < 1 || variant.round > rounds) {
      problems.push(
        `“${variant.label || 'A scenario'}”: the change starts in a round from 1 to ${rounds}.`,
      );
    }
  }
  const plan = planRuns({ variants: variants.length, runsPerVariant, sensitivity, perturbations });
  if (plan.totalRuns > MAX_TOTAL_RUNS) {
    problems.push(
      `That is ${plan.totalRuns.toLocaleString('en-GB')} runs and the limit is ${MAX_TOTAL_RUNS.toLocaleString('en-GB')}: use fewer seeds or scenarios, or turn sensitivity off.`,
    );
  }
  return [...new Set(problems)];
}

/** Round numbers that frame a range of stance values, never wider than the scale of -1 to 1. */
export function stanceAxis(values: readonly number[]): {
  min: number;
  max: number;
  ticks: number[];
} {
  const low = values.length ? Math.min(...values) : -1;
  const high = values.length ? Math.max(...values) : 1;
  let min = Math.max(-1, Math.floor((low - 0.02) * 4) / 4);
  let max = Math.min(1, Math.ceil((high + 0.02) * 4) / 4);
  if (max - min < 0.5) {
    min = Math.max(-1, min - 0.25);
    max = Math.min(1, max + 0.25);
  }
  const ticks: number[] = [];
  for (let tick = min; tick <= max + 1e-9; tick += 0.25) ticks.push(Math.round(tick * 100) / 100);
  return { min, max, ticks };
}

export const VARIANT_STYLES: { color: string; dash: string | undefined }[] = [
  { color: 'var(--chart-1)', dash: undefined },
  { color: 'var(--chart-2)', dash: '8 3' },
  { color: 'var(--chart-3)', dash: '3 3' },
  { color: 'var(--chart-4)', dash: '8 3 2 3' },
  { color: 'var(--chart-5)', dash: '2 4' },
  { color: 'var(--graph-1)', dash: '12 4' },
  { color: 'var(--graph-2)', dash: '6 2 2 2' },
  { color: 'var(--graph-3)', dash: '1 3' },
];
