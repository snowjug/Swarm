import {
  RESPONSE_CATEGORIES,
  RESPONSE_LABELS,
  type Analysis,
  type ResponseCategory,
  type ResponseShares,
  type RoundAggregate,
  type RunOutcome,
  type SimEvent,
  type Variant,
} from '../../../../shared/analysis';
import { planRuns } from '../../../../shared/analysis-plan';
import {
  directionNotice,
  effectiveTrait,
  NO_DIRECTION_NOTICE,
  UNDIRECTED_NOTICE,
} from '../../../../shared/signal';
import type { Actor, RelationType } from '../../../../shared/stakeholders';
import {
  adverseShare,
  chainOf,
  cannotMoveAnyone,
  rankFindings,
  variantDistributions,
  type ChainStep,
  type VariantDistribution,
} from '../../lib/analysis';

/** The run the theatre replays: the one seeded run kept in full detail, read round by round. */
export interface Replay {
  run: RunOutcome;
  /** The scenario the run played (the proposed change). */
  variant: Variant;
  rounds: RoundAggregate[];
  firstRound: number;
  lastRound: number;
  /** The round the change lands in. */
  changeRound: number;
  /** The size, in stance units, that the diverging colour scale reaches its full colour at. */
  scale: number;
  events: SimEvent[];
  eventsByRound: Map<number, SimEvent[]>;
  explained: boolean;
  actors: ReadonlyMap<string, Actor>;
}

/**
 * The stance at which the diverging colours reach full strength: the largest move in the data, so that the actor that moved
 * most is fully coloured and the rest are seen against it. Stances move by hundredths, and a fixed scale of -1 to 1 would
 * show none of it; the scale is always said beside the colours.
 */
export function niceScale(values: readonly number[]): number {
  const largest = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  return Math.max(0.04, Math.ceil(largest * 100) / 100);
}

/** Round figures that frame a range of stance values and always include 0, which is where no change sits. */
export function niceAxis(values: readonly number[]): { min: number; max: number; ticks: number[] } {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = Math.max(high - low, 0.08);
  const pad = span * 0.18;
  const steps = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  const step = steps.find((candidate) => span / candidate <= 6) ?? 1;
  const min = Math.max(-1, Math.floor((low - pad) / step) * step);
  const max = Math.min(1, Math.ceil((high + pad) / step) * step);
  const ticks: number[] = [];
  for (let tick = min; tick <= max + 1e-9; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return { min, max, ticks };
}

/** The replay of a finished analysis, or null where it has no run kept in detail (no proposed change, or an older record). */
export function replayOf(analysis: Analysis): Replay | null {
  const run = analysis.representativeRun;
  if (!run || run.rounds.length === 0) return null;
  const variant = analysis.config.variants.find((candidate) => candidate.id === run.variantId);
  if (!variant) return null;
  const rounds = [...run.rounds].sort((a, b) => a.round - b.round);
  const eventsByRound = new Map<number, SimEvent[]>();
  for (const event of run.events) {
    const list = eventsByRound.get(event.round);
    if (list) list.push(event);
    else eventsByRound.set(event.round, [event]);
  }
  const values = rounds.flatMap((round) => round.byActor.map((entry) => entry.stanceMean));
  return {
    run,
    variant,
    rounds,
    firstRound: rounds[0]!.round,
    lastRound: rounds[rounds.length - 1]!.round,
    changeRound: variant.round,
    scale: niceScale(values),
    events: run.events,
    eventsByRound,
    explained: run.explained === true,
    actors: new Map(analysis.actors.map((actor) => [actor.id, actor])),
  };
}

export const roundOf = (replay: Replay, round: number): RoundAggregate =>
  replay.rounds.find((entry) => entry.round === round) ?? replay.rounds[replay.rounds.length - 1]!;

/** Where every actor stands in a round, by id. */
export function stancesAt(replay: Replay, round: number): Map<string, number> {
  return new Map(roundOf(replay, round).byActor.map((entry) => [entry.actorId, entry.stanceMean]));
}

/** One actor's stance round by round, for a trace. */
export function traceOf(replay: Replay, actorId: string): { round: number; stance: number }[] {
  return replay.rounds.flatMap((entry) => {
    const found = entry.byActor.find((item) => item.actorId === actorId);
    return found ? [{ round: entry.round, stance: found.stanceMean }] : [];
  });
}

/** How far an actor moved over the run, from its first round to its last. */
export function movementOf(replay: Replay, actorId: string): number {
  const trace = traceOf(replay, actorId);
  return trace.length < 2 ? 0 : trace[trace.length - 1]!.stance - trace[0]!.stance;
}

/**
 * The earlier events a later one was shown to need, as links between the actors that acted: drawn only where the run
 * was replayed to test them (`explained`), because otherwise an earlier event in `causedBy` merely came first.
 */
export function causalLinks(
  replay: Replay,
  round: number,
): { from: string; to: string; key: string }[] {
  if (!replay.explained) return [];
  const byId = new Map(replay.events.map((event) => [event.id, event]));
  return (replay.eventsByRound.get(round) ?? []).flatMap((event) =>
    event.causedBy.flatMap((cause) => {
      const earlier = byId.get(cause);
      if (!earlier || !earlier.actorId || !event.actorId || earlier.actorId === event.actorId)
        return [];
      return [{ from: earlier.actorId, to: event.actorId, key: `${earlier.id}>${event.id}` }];
    }),
  );
}

/** The actors the change lands on: those whose impact is not 0 once the scenario's own settings are applied. */
export function landsOn(actors: readonly Actor[], variant: Variant): string[] {
  if (variant.intensity <= 0) return [];
  return actors
    .filter((actor) => effectiveTrait(actor, variant, 'impact') !== 0)
    .map((actor) => actor.id);
}

const SIGNAL_WORDS: Record<string, string> = {
  'adverse-share': 'Adverse',
  'switching-pressure': 'Switching',
  adoption: 'Adoption',
  'risk-concern': 'Risk concern',
};

export const signalLabel = (key: string): string =>
  SIGNAL_WORDS[key] ?? key.replace(/-/gu, ' ').replace(/^./u, (letter) => letter.toUpperCase());

export interface SignalReading {
  key: string;
  label: string;
  value: number;
}

export function signalsOf(round: RoundAggregate): SignalReading[] {
  return Object.entries(round.signals)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => ({ key, label: signalLabel(key), value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The six response categories of a mix, in the order the contract lists them, with their words. */
export function mixOf(
  shares: ResponseShares,
): { id: ResponseCategory; label: string; share: number }[] {
  return RESPONSE_CATEGORIES.map((id) => ({ id, label: RESPONSE_LABELS[id], share: shares[id] }));
}

/** How far each stance reaches on the colour scale, so that a word can be said with a colour. */
export function stanceSentence(value: number, scale: number): string {
  const share = value / Math.max(scale, 0.01);
  if (share <= -0.66) return 'against';
  if (share <= -0.2) return 'leaning against';
  if (share < 0.2) return 'near neutral';
  if (share < 0.66) return 'leaning in favour';
  return 'in favour';
}

// ---------------------------------------------------------------------------------------------
// While it runs: what the engine's own order of work says is done
// ---------------------------------------------------------------------------------------------

export interface RunLanes {
  phase: 'runs' | 'sensitivity' | 'reading';
  /** For each scenario, how many of its seeded runs have finished: the engine runs one seed at a time across every scenario. */
  lanes: { variantId: string; label: string; kind: Variant['kind']; done: number; of: number }[];
  mainRuns: number;
  sensitivityRuns: number;
  /** How far the sensitivity step has got. */
  sensitivityDone: number;
}

/** What `completedRuns` means: seeds one at a time across every scenario, then the sensitivity runs, then the reading of the results. */
export function lanesOf(
  analysis: Pick<Analysis, 'config' | 'progress'>,
  perturbations: number,
): RunLanes {
  const { variants, runsPerVariant, sensitivity } = analysis.config;
  const plan = planRuns({ variants: variants.length, runsPerVariant, sensitivity, perturbations });
  const completed = Math.min(
    Math.max(analysis.progress.completedRuns, 0),
    analysis.progress.totalRuns || plan.totalRuns,
  );
  const main = Math.min(completed, plan.mainRuns);
  const full = Math.floor(main / Math.max(variants.length, 1));
  const extra = main % Math.max(variants.length, 1);
  const total = analysis.progress.totalRuns || plan.totalRuns;
  return {
    phase: completed >= total ? 'reading' : main < plan.mainRuns ? 'runs' : 'sensitivity',
    lanes: variants.map((variant, index) => ({
      variantId: variant.id,
      label: variant.label,
      kind: variant.kind,
      done: full + (index < extra ? 1 : 0),
      of: runsPerVariant,
    })),
    mainRuns: plan.mainRuns,
    sensitivityRuns: Math.max(total - plan.mainRuns, 0),
    sensitivityDone: Math.max(completed - plan.mainRuns, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// The story: what the comparison says, in the order it is read
// ---------------------------------------------------------------------------------------------

export interface Mover {
  actorId: string;
  name: string;
  category: Actor['category'];
  members: number;
  baseline: number;
  proposed: number;
  /** Proposed less baseline: the paired movement of the mean stance. */
  shift: number;
}

export interface Story {
  baseline: Variant | null;
  proposed: Variant | null;
  /** The share of simulated members who look for an alternative or resist, with and without the change. */
  adverse: {
    baseline: number;
    proposed: number;
    shift: number;
    spread: { p10: number; p50: number; p90: number };
    runs: number;
  } | null;
  movers: Mover[];
  firstEvents: ChainStep[];
  eventCount: number;
  caution: 'no-direction' | 'undirected' | 'cannot-move' | null;
}

/** The aggregate end state of one actor in one scenario: the per-actor summary the variant keeps, which is there even when the runs have dropped their per-actor detail. */
const actorEnd = (analysis: Analysis, variantId: string, actorId: string) =>
  analysis.variants
    .find((variant) => variant.variantId === variantId)
    ?.actors?.find((entry) => entry.actorId === actorId);

export function moversOf(
  analysis: Analysis,
  baselineId: string,
  proposedId: string,
  limit = 5,
): Mover[] {
  const found: Mover[] = [];
  for (const actor of analysis.actors) {
    const a = actorEnd(analysis, baselineId, actor.id);
    const b = actorEnd(analysis, proposedId, actor.id);
    if (!a || !b) continue;
    found.push({
      actorId: actor.id,
      name: actor.name,
      category: actor.category,
      members: b.members,
      baseline: a.stanceMean,
      proposed: b.stanceMean,
      shift: b.stanceMean - a.stanceMean,
    });
  }
  return found
    .sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift) || x.name.localeCompare(y.name))
    .slice(0, limit);
}

export function storyOf(analysis: Analysis): Story {
  const baseline = analysis.config.variants.find((variant) => variant.kind === 'baseline') ?? null;
  const proposed =
    analysis.config.variants.find((variant) => variant.kind === 'alternative') ?? null;
  const distributions = variantDistributions(analysis);
  const a: VariantDistribution | undefined = baseline
    ? distributions.find((item) => item.variantId === baseline.id)
    : undefined;
  const b: VariantDistribution | undefined = proposed
    ? distributions.find((item) => item.variantId === proposed.id)
    : undefined;
  const notice = directionNotice(analysis.actors, analysis.config.variants);
  const run = analysis.representativeRun;
  const steps = run ? chainOf(run, analysis.actors) : [];
  return {
    baseline,
    proposed,
    adverse:
      a && b
        ? {
            baseline: adverseShare(a.shares),
            proposed: adverseShare(b.shares),
            shift: adverseShare(b.shares) - adverseShare(a.shares),
            spread: b.adverse,
            runs: b.runs,
          }
        : null,
    movers: baseline && proposed ? moversOf(analysis, baseline.id, proposed.id) : [],
    firstEvents: steps.slice(0, 3),
    eventCount: steps.length,
    caution: cannotMoveAnyone(analysis)
      ? 'cannot-move'
      : notice === NO_DIRECTION_NOTICE
        ? 'no-direction'
        : notice === UNDIRECTED_NOTICE
          ? 'undirected'
          : null,
  };
}

/** The findings to read first: the repeatable ones, then the rest in the order of `rankFindings`. */
export const topFindings = (analysis: Analysis, count = 3) =>
  rankFindings(analysis.findings, analysis.config.variants).slice(0, count);

// ---------------------------------------------------------------------------------------------
// One colour for each scenario, the same everywhere in the scene
// ---------------------------------------------------------------------------------------------

const PALETTE = [
  'var(--accent)',
  'var(--cat-4)',
  'var(--cat-6)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-7)',
  'var(--cat-1)',
  'var(--cat-8)',
];

/** No change is quiet, and every other scenario takes a hue of its own, in the order they were given. */
export function variantColours(variants: readonly Pick<Variant, 'kind'>[]): string[] {
  let next = 0;
  return variants.map((variant) =>
    variant.kind === 'baseline'
      ? 'var(--ink-3)'
      : (PALETTE[next++ % PALETTE.length] ?? 'var(--accent)'),
  );
}

export interface Series {
  id: string;
  label: string;
  kind: 'baseline' | 'alternative';
  colour: string;
  dash: string | undefined;
  points: { round: number; p10: number; p50: number; p90: number }[];
}

/** The scenarios as series of bands over the rounds: no change is dashed, the proposed change takes the accent. */
export function seriesOf(analysis: Analysis): Series[] {
  const colours = variantColours(analysis.config.variants);
  return analysis.config.variants.flatMap((variant, index) => {
    const result = analysis.variants.find((candidate) => candidate.variantId === variant.id);
    if (!result || result.trajectory.length === 0) return [];
    return [
      {
        id: variant.id,
        label: variant.label,
        kind: variant.kind,
        colour: colours[index] ?? 'var(--accent)',
        dash: variant.kind === 'baseline' ? '6 5' : undefined,
        points: [...result.trajectory].sort((a, b) => a.round - b.round),
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// What the network shows
// ---------------------------------------------------------------------------------------------

/** How the network is coloured, and which kinds of relation it draws. */
export interface NetworkSettings {
  colour: 'end' | 'movement';
  hidden: ReadonlySet<RelationType>;
}

export const NETWORK_DEFAULTS: NetworkSettings = { colour: 'end', hidden: new Set() };
