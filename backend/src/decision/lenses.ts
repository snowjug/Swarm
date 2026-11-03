import {
  LENS_IDS,
  LENS_INFO,
  LENS_MATERIAL_GAP,
  LENS_MIN_RUNS,
  LENS_NOISE_FACTOR,
  type DecisionPosition,
  type LensId,
  type LensReading,
  type LensStanding,
} from '../../../shared/decision.js';
import type { Actor } from '../../../shared/stakeholders.js';
import { mean, standardError } from '../analysis/stats.js';
import {
  ADVERSE_CATEGORIES,
  FAVOURABLE_CATEGORIES,
  adverseShareOf,
  shareIn,
  type VariantMeasure,
} from '../brief/measures.js';
import { clip, embed, listed, plural, round4 } from './words.js';

/**
 * The lenses: named, transparent readings of what the simulation itself measured, and nothing else.
 * Every value is a share, from 0 to 1, of simulated members ending in a response, averaged over the
 * seeded runs of an option; none is an outcome in the world, a probability or a score of value.
 *
 * Two options are told apart on a lens only when the paired difference between them, on the same
 * seeds, is at least `LENS_MATERIAL_GAP` of the lens’s own scale and more than `LENS_NOISE_FACTOR`
 * standard errors of that difference, over at least `LENS_MIN_RUNS` runs. Anything closer is level.
 */

export interface LensInput {
  /** Every option that has recorded runs, baseline included. */
  measures: readonly VariantMeasure[];
  actors: readonly Actor[];
  positions: ReadonlyMap<string, DecisionPosition>;
  /** Options that cannot be chosen: a confirmed hard constraint rules them out. They are shown and never ranked. */
  blocked: ReadonlySet<string>;
}

interface Series {
  id: string;
  /** Seed to value, or null when the analysis kept only totals over the runs. */
  values: ReadonlyMap<number, number> | null;
  mean: number;
  low: number | null;
  high: number | null;
  runs: number;
  detail: string | null;
}

const DECIDES: ReadonlySet<DecisionPosition> = new Set(['decides', 'approves', 'can-block']);

/** The actors a lens reads. */
export function lensActors(
  lens: LensId,
  actors: readonly Actor[],
  positions: ReadonlyMap<string, DecisionPosition>,
): Actor[] {
  if (lens === 'key-actor-support') return actors.filter((actor) => actor.kind === 'key');
  if (lens === 'decision-maker-resistance') {
    return actors.filter((actor) => DECIDES.has(positions.get(actor.id) ?? 'none'));
  }
  return [...actors];
}

const favourable = (shares: Parameters<typeof shareIn>[0]): number =>
  shareIn(shares, FAVOURABLE_CATEGORIES);
const adverse = (shares: Parameters<typeof shareIn>[0]): number =>
  shareIn(shares, ADVERSE_CATEGORIES);

function seriesOf(
  lens: LensId,
  measure: VariantMeasure,
  readers: readonly Actor[],
  names: ReadonlyMap<string, string>,
): Series | null {
  const id = measure.variant.id;
  const runs = measure.runs.length;
  if (runs === 0) return null;
  const finish = (
    values: ReadonlyMap<number, number> | null,
    centre: number,
    detail: string | null,
  ): Series => {
    const list = values ? [...values.values()] : [];
    return {
      id,
      values,
      mean: centre,
      low: values ? Math.min(...list) : null,
      high: values ? Math.max(...list) : null,
      runs,
      detail,
    };
  };
  if (lens === 'overall-resistance') {
    const values = new Map(
      measure.runs.map((run) => [run.seed, adverseShareOf(run.responseShares)]),
    );
    return finish(values, mean([...values.values()]), null);
  }
  if (measure.detail === 'none') return null;
  const wanted = new Set(readers.map((actor) => actor.id));
  // The worst-affected actor under an option, by its mean over the runs, for the person to see who it is.
  const worst = measure.actors
    .filter((actor) => wanted.has(actor.actorId))
    .reduce<{ id: string; share: number } | null>((top, actor) => {
      const share = adverse(actor.shares);
      return !top || share > top.share + 1e-12 ? { id: actor.actorId, share } : top;
    }, null);
  const detail =
    lens === 'worst-affected-downside' && worst
      ? `Worst affected: ${embed(names.get(worst.id) ?? worst.id, 60)}`
      : null;
  const read = (
    actors: readonly { actorId: string; shares: Parameters<typeof shareIn>[0] }[],
  ): number | null => {
    const chosen = actors.filter((actor) => wanted.has(actor.actorId));
    if (chosen.length === 0) return null;
    if (lens === 'key-actor-support') return mean(chosen.map((actor) => favourable(actor.shares)));
    if (lens === 'decision-maker-resistance')
      return mean(chosen.map((actor) => adverse(actor.shares)));
    return Math.max(...chosen.map((actor) => adverse(actor.shares)));
  };
  if (measure.detail === 'runs') {
    const values = new Map<number, number>();
    for (const run of measure.runs) {
      const value = read(
        run.byActor.map((actor) => ({ actorId: actor.actorId, shares: actor.responseShares })),
      );
      if (value === null) return null;
      values.set(run.seed, value);
    }
    return finish(values, mean([...values.values()]), detail);
  }
  const centre = read(
    measure.actors.map((actor) => ({ actorId: actor.actorId, shares: actor.shares })),
  );
  return centre === null ? null : finish(null, centre, detail);
}

interface Separation {
  distinguishable: boolean;
  advantage: number;
  pairs: number;
}

/** How far `better` is ahead of `other` on the same seeds, and whether that is more than noise. */
function separate(better: Series, other: Series, direction: 'lower' | 'higher'): Separation {
  if (!better.values || !other.values) return { distinguishable: false, advantage: 0, pairs: 0 };
  const differences: number[] = [];
  for (const [seed, value] of better.values) {
    const against = other.values.get(seed);
    if (against === undefined) continue;
    differences.push(direction === 'lower' ? against - value : value - against);
  }
  const advantage = mean(differences);
  const noise = standardError(differences);
  return {
    distinguishable:
      differences.length >= LENS_MIN_RUNS &&
      advantage >= LENS_MATERIAL_GAP &&
      advantage > LENS_NOISE_FACTOR * noise,
    advantage,
    pairs: differences.length,
  };
}

const NOT_COMPUTED: Record<LensId, string> = {
  'overall-resistance': 'No option has recorded runs.',
  'key-actor-support':
    'No key actor is in the cast, so there is nobody for this lens to read. Key actors are the roles simulated one by one.',
  'decision-maker-resistance':
    'No actor decides, approves or can block, so there is nobody for this lens to read.',
  'worst-affected-downside':
    'The analysis kept no per-actor results, so the worst-affected group cannot be named.',
};

const NO_DETAIL = 'The analysis kept no per-actor results, so this lens cannot be read.';

function computeLens(id: LensId, input: LensInput): LensReading {
  const info = LENS_INFO[id];
  const names = new Map(input.actors.map((actor) => [actor.id, actor.name]));
  const readers = lensActors(id, input.actors, input.positions);
  const base = {
    id,
    name: info.name,
    question: info.question,
    measure: info.measure,
    direction: info.direction,
  };
  const none = (note: string): LensReading => ({
    ...base,
    computable: false,
    note: clip(note, 400),
    results: [],
    leaderId: null,
    levelIds: [],
    margin: null,
    verdict: 'not-assessed',
  });
  if (input.measures.length === 0) return none(NOT_COMPUTED['overall-resistance']);
  if (id !== 'overall-resistance' && readers.length === 0) return none(NOT_COMPUTED[id]);
  const series: Series[] = [];
  for (const measure of input.measures) {
    const made = seriesOf(id, measure, readers, names);
    if (!made) return none(id === 'worst-affected-downside' ? NOT_COMPUTED[id] : NO_DETAIL);
    series.push(made);
  }
  const eligible = series.filter((entry) => !input.blocked.has(entry.id));
  const sentence = [
    id === 'key-actor-support' || id === 'decision-maker-resistance'
      ? `Read over ${readers.length} ${plural(readers.length, 'actor')}: ${listed(readers.slice(0, 3).map((actor) => embed(actor.name, 40)))}${readers.length > 3 ? ' and others' : ''}.`
      : '',
    series.some((entry) => entry.values === null)
      ? 'The analysis kept only totals over the runs, so this lens cannot be told apart from run-to-run variation.'
      : '',
    eligible.length < 2
      ? 'Fewer than two options can be chosen, so nothing is compared.'
      : eligible[0] && eligible[0].runs < LENS_MIN_RUNS
        ? `Only ${eligible[0].runs} seeded ${plural(eligible[0].runs, 'run')} per option: at least ${LENS_MIN_RUNS} are needed to tell options apart.`
        : '',
  ]
    .filter(Boolean)
    .join(' ');
  const better = (a: Series, b: Series): boolean =>
    info.direction === 'lower' ? a.mean < b.mean - 1e-12 : a.mean > b.mean + 1e-12;
  const ranked = [...eligible].sort((a, b) =>
    better(a, b) ? -1 : better(b, a) ? 1 : a.id.localeCompare(b.id),
  );
  const best = ranked[0];
  const standing = new Map<string, LensStanding>(series.map((entry) => [entry.id, 'not-assessed']));
  let leaderId: string | null = null;
  let levelIds: string[] = [];
  let margin: number | null = null;
  let verdict: LensReading['verdict'] = 'not-assessed';
  const comparable = eligible.length >= 2 && eligible.every((entry) => entry.values !== null);
  if (best && comparable) {
    const others = ranked.slice(1);
    const apart = others.map((other) => ({ other, ...separate(best, other, info.direction) }));
    for (const entry of apart)
      standing.set(entry.other.id, entry.distinguishable ? 'behind' : 'level');
    if (apart.every((entry) => entry.distinguishable)) {
      standing.set(best.id, 'leads');
      leaderId = best.id;
      margin = round4(Math.min(...apart.map((entry) => entry.advantage)));
      verdict = 'clear-leader';
    } else {
      standing.set(best.id, 'level');
      levelIds = [
        best.id,
        ...apart.filter((entry) => !entry.distinguishable).map((entry) => entry.other.id),
      ];
      verdict = 'tie';
    }
  }
  return {
    ...base,
    computable: true,
    note: sentence === '' ? null : clip(sentence, 400),
    results: series.map((entry) => ({
      alternativeId: entry.id,
      value: round4(entry.mean),
      low: entry.low === null ? null : round4(entry.low),
      high: entry.high === null ? null : round4(entry.high),
      runs: entry.runs,
      standing: standing.get(entry.id) ?? 'not-assessed',
      detail: entry.detail,
    })),
    leaderId,
    levelIds,
    margin,
    verdict,
  };
}

/** Every lens, in the order the page lists them. */
export function computeLenses(input: LensInput): LensReading[] {
  return LENS_IDS.map((id) => computeLens(id, input));
}
