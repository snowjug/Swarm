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
}

export function estimate(input: EstimateInput) {
  return planRuns(input);
}

export function estimateText(input: EstimateInput, lastWallMs: number | null): string {
  const plan = estimate(input);
  const sensitivity =
    plan.sensitivityRuns > 0
      ? `, plus ${plan.sensitivityRuns.toLocaleString('en-GB')} for sensitivity (${plan.sensitivitySeeds} seeds, ${input.perturbations} assumptions moved one at a time)`
      : '';
  const last =
    lastWallMs === null
      ? ''
      : ` The last comparison on this project took ${durationText(lastWallMs)}.`;
  return `This runs ${plan.mainRuns.toLocaleString('en-GB')} simulated runs (${input.variants} scenarios × ${input.runsPerVariant} seeds)${sensitivity}. No model is called, so it costs server time only.${last}`;
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
