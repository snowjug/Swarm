import type {
  ActorOutcome,
  Finding,
  FindingKind,
  ResponseShares,
  RunSummary,
  StabilityClass,
  Variant,
} from '../../../shared/analysis.js';
import type { Actor } from '../../../shared/stakeholders.js';
import { classifyStability, round4, wilson } from './stats.js';

/**
 * What the runs of every variant say, as statements that are either true of a run or not. Each is
 * counted over the seeded runs, so it carries how many runs it held in, a Wilson interval and a class
 * (see stats.ts); none carries a score. The wording counts simulated members and runs and never
 * describes what will happen in the world.
 */

/** What is kept of one run while the runs are in memory, so that every finding can be counted. */
export interface RunRecord {
  /** The end state at full precision. */
  summary: RunSummary;
  /** The end states by actor, for lookups. */
  actors: ReadonlyMap<string, ActorOutcome>;
  /** The overall mean stance at each round, for the spread of the trajectory. */
  rounds: readonly { round: number; stanceMean: number }[];
  /** The distinct kinds of event that occurred in the run. */
  eventKinds: readonly string[];
  /** The highest share of simulated members in switch or resist at any round of the run. */
  peakAdverse: number;
}

export interface FindingsInput {
  actors: readonly Actor[];
  variants: readonly Variant[];
  /** The runs of each variant in seed order: position i of every list is the same seed. */
  records: ReadonlyMap<string, readonly RunRecord[]>;
  /** The share of simulated members in switch or resist that a threshold finding tests for. */
  adverseThreshold?: number;
}

export const FINDINGS_LIMIT = 40;
export const DEFAULT_ADVERSE_THRESHOLD = 0.3;
/** A difference in overall stance smaller than this, on a scale from -1 to 1, is not called a direction. */
export const DIRECTION_MARGIN = 0.01;
/** Most event kinds reported for one variant, the most frequent first. */
const EVENT_KINDS_PER_VARIANT = 3;
const ORDERING_DEPTH = 3;

interface ResponseGroup {
  id: 'adverse' | 'defensive' | 'neutral' | 'favourable';
  categories: readonly (keyof ResponseShares)[];
  /** What the members of the group ended up doing, in words that follow "ended up". */
  phrase: string;
  /** The group's share, as the test of a run. */
  test: string;
}

/** Listed in the order that settles a tie: the more adverse group first. */
const GROUPS: readonly ResponseGroup[] = [
  {
    id: 'adverse',
    categories: ['switch', 'resist'],
    phrase: 'looking for an alternative or resisting',
    test: 'the share looking for an alternative plus the share resisting',
  },
  {
    id: 'defensive',
    categories: ['adapt-defensively'],
    phrase: 'adapting to limit the impact',
    test: 'the share adapting to limit the impact',
  },
  {
    id: 'neutral',
    categories: ['wait'],
    phrase: 'waiting and seeing',
    test: 'the share waiting and seeing',
  },
  {
    id: 'favourable',
    categories: ['adopt', 'accept-with-conditions'],
    phrase: 'going along or accepting with conditions',
    test: 'the share going along plus the share accepting with conditions',
  },
];

const groupShare = (shares: ResponseShares, group: ResponseGroup): number =>
  group.categories.reduce((sum, category) => sum + shares[category], 0);

/** The group with the largest share; a tie goes to the more adverse group. */
function largestGroup(shares: ResponseShares): ResponseGroup {
  let best = GROUPS[0]!;
  let bestShare = groupShare(shares, best);
  for (const group of GROUPS.slice(1)) {
    const share = groupShare(shares, group);
    if (share > bestShare + 1e-12) {
      best = group;
      bestShare = share;
    }
  }
  return best;
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** A short repeatable tag for a finding's identity, so that its id is stable and fits its limit. */
function tag(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

const list = (names: readonly string[]): string =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

const KIND_RANK: Record<FindingKind, number> = {
  'direction-vs-baseline': 0,
  'threshold-crossing': 1,
  ordering: 2,
  'second-order-event': 3,
  'majority-response': 4,
};
const CLASS_RANK: Record<StabilityClass, number> = {
  repeatable: 0,
  'mostly-repeatable': 1,
  unstable: 2,
  rare: 3,
};

interface Candidate {
  finding: Finding;
  /** Smaller sorts first: the variant (the change before its alternatives, the baseline last), then the detail. */
  variantRank: number;
  detailRank: number;
  tie: string;
}

/** The most frequent value of a tally, with a tie going to the smallest key so that it is repeatable. */
function mostFrequent(tally: ReadonlyMap<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [key, count] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (best === null || count > best[1]) best = [key, count];
  }
  return best;
}

export function generateFindings(input: FindingsInput): Finding[] {
  const { variants, records } = input;
  const threshold = input.adverseThreshold ?? DEFAULT_ADVERSE_THRESHOLD;
  const actors = new Map(input.actors.map((actor) => [actor.id, actor]));
  const baseline = variants.find((variant) => variant.kind === 'baseline');
  const alternatives = variants.filter((variant) => variant.kind === 'alternative');
  const variantRank = (variant: Variant): number =>
    variant.kind === 'baseline' ? variants.length : alternatives.indexOf(variant);
  const runsOf = (variant: Variant): readonly RunRecord[] => records.get(variant.id) ?? [];
  const nameOf = (actorId: string): string => actors.get(actorId)?.name ?? actorId;
  const candidates: Candidate[] = [];

  const add = (
    kind: FindingKind,
    variant: Variant,
    actorId: string | null,
    key: string,
    statement: string,
    predicate: string,
    holdsIn: number,
    of: number,
    detailRank: number,
    tie: string,
  ): void => {
    const interval = wilson(holdsIn, of);
    candidates.push({
      finding: {
        id: `${kind}-${tag(`${variant.id}|${actorId ?? ''}|${key}`)}`,
        kind,
        variantId: variant.id,
        actorId,
        statement: clip(statement, 500),
        predicate: clip(predicate, 400),
        holdsIn,
        of,
        interval: { lo: round4(interval.lo), hi: round4(interval.hi) },
        classification: classifyStability(holdsIn, of),
      },
      variantRank: variantRank(variant),
      detailRank,
      tie,
    });
  };

  for (const variant of variants) {
    const runs = runsOf(variant);
    const of = runs.length;
    if (of === 0) continue;

    // The largest group of final responses, for each actor.
    for (const actor of input.actors) {
      const tally = new Map<string, number>();
      let members = 1;
      for (const run of runs) {
        const outcome = run.actors.get(actor.id);
        if (!outcome) continue;
        members = outcome.members;
        const group = largestGroup(outcome.responseShares);
        tally.set(group.id, (tally.get(group.id) ?? 0) + 1);
      }
      const top = mostFrequent(tally);
      const group = top ? GROUPS.find((candidate) => candidate.id === top[0]) : undefined;
      if (!top || !group) continue;
      const subject =
        members === 1
          ? `the simulated ${actor.name}`
          : `the largest group of simulated members of ${actor.name}`;
      add(
        'majority-response',
        variant,
        actor.id,
        group.id,
        `In ${top[1]} of ${of} seeded runs, ${subject} ended up ${group.phrase} under ${variant.label}.`,
        `Among the simulated members of ${actor.name} under ${variant.label}, ${group.test} is the largest of the four response groups.`,
        top[1],
        of,
        1 - actor.traits.influence.value,
        actor.id,
      );
    }

    // How high the adverse share got at any round.
    const crossed = runs.filter((run) => run.peakAdverse >= threshold).length;
    add(
      'threshold-crossing',
      variant,
      null,
      `threshold-${threshold}`,
      `In ${crossed} of ${of} seeded runs, at least ${Math.round(threshold * 100)}% of simulated members were looking for an alternative or resisting at some round under ${variant.label}.`,
      `At some round, the share of all simulated members (each actor weighted equally) whose response is switch or resist is at least ${threshold}.`,
      crossed,
      of,
      0,
      '',
    );
  }

  // Everything that compares a variant with the baseline on the same seed.
  for (const variant of alternatives) {
    const runs = runsOf(variant);
    const reference = baseline ? runsOf(baseline) : [];
    const of = runs.length;
    if (of === 0) continue;
    const paired = baseline !== undefined && reference.length === of;

    if (baseline && paired) {
      const differences = runs.map(
        (run, index) => run.summary.stanceMean - (reference[index]?.summary.stanceMean ?? 0),
      );
      const average = differences.reduce((sum, value) => sum + value, 0) / of;
      const direction =
        Math.abs(average) <= DIRECTION_MARGIN ? 'same' : average < 0 ? 'lower' : 'higher';
      const holds = differences.filter((difference) =>
        direction === 'same'
          ? Math.abs(difference) <= DIRECTION_MARGIN
          : direction === 'lower'
            ? difference < -DIRECTION_MARGIN
            : difference > DIRECTION_MARGIN,
      ).length;
      const feel =
        direction === 'lower'
          ? { felt: 'less favourable', compared: 'lower' }
          : { felt: 'more favourable', compared: 'higher' };
      add(
        'direction-vs-baseline',
        variant,
        null,
        direction,
        direction === 'same'
          ? `In ${holds} of ${of} seeded runs, simulated members ended up about the same under ${variant.label} as under ${baseline.label} on the same seed (overall stance within ${DIRECTION_MARGIN}).`
          : `In ${holds} of ${of} seeded runs, simulated members ended up ${feel.felt} under ${variant.label} than under ${baseline.label} on the same seed (overall stance ${feel.compared} by more than ${DIRECTION_MARGIN}).`,
        direction === 'same'
          ? `The overall final stance (the mean over all actors, on a scale from -1 to 1) under ${variant.label} is within ${DIRECTION_MARGIN} of the stance under ${baseline.label} on the same seed.`
          : `The overall final stance (the mean over all actors, on a scale from -1 to 1) under ${variant.label} is ${feel.compared} than under ${baseline.label} on the same seed by more than ${DIRECTION_MARGIN}.`,
        holds,
        of,
        0,
        '',
      );
    }

    // Which actors are affected most, and in which order.
    const ids = input.actors.map((actor) => actor.id).sort();
    if (ids.length >= 2) {
      const orders = runs.map((run, index) => {
        const before = paired ? reference[index] : undefined;
        return ids
          .map((id) => {
            const stance = run.actors.get(id)?.stanceMean ?? 0;
            const start = before?.actors.get(id)?.stanceMean ?? 0;
            return { id, change: stance - start };
          })
          .sort((a, b) => a.change - b.change || a.id.localeCompare(b.id))
          .map((entry) => entry.id);
      });
      const depth = Math.min(ORDERING_DEPTH, ids.length);
      const compared = paired && baseline ? ` compared with ${baseline.label}` : '';
      const first = new Map<string, number>();
      const sequence = new Map<string, number>();
      for (const order of orders) {
        const head = order[0] ?? '';
        first.set(head, (first.get(head) ?? 0) + 1);
        const prefix = order.slice(0, depth).join('>');
        sequence.set(prefix, (sequence.get(prefix) ?? 0) + 1);
      }
      const top = mostFrequent(first);
      if (top) {
        add(
          'ordering',
          variant,
          top[0],
          'first',
          `In ${top[1]} of ${of} seeded runs, simulated ${nameOf(top[0])} showed the least favourable change in stance${compared} under ${variant.label}.`,
          `${nameOf(top[0])} has the lowest change in final stance${compared ? ' relative to the baseline on the same seed' : ''} of all actors.`,
          top[1],
          of,
          0,
          '',
        );
      }
      const order = mostFrequent(sequence);
      if (order) {
        const members = order[0].split('>');
        add(
          'ordering',
          variant,
          null,
          `order-${depth}`,
          `In ${order[1]} of ${of} seeded runs, the ${depth === 2 ? 'two' : 'three'} simulated groups with the least favourable change in stance${compared} were, in order, ${list(members.map(nameOf))}, under ${variant.label}.`,
          `The ${depth} actors with the lowest changes in final stance${compared ? ' relative to the baseline on the same seed' : ''}, lowest first, are ${members.map(nameOf).join(', then ')}.`,
          order[1],
          of,
          1,
          '',
        );
      }
    }

    // Which follow-on events occurred, and whether the baseline had them too.
    const kinds = new Map<string, number>();
    for (const run of runs)
      for (const kind of run.eventKinds) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    const frequent = [...kinds]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, EVENT_KINDS_PER_VARIANT);
    for (const [kind, holdsIn] of frequent) {
      const without = paired
        ? reference.filter((run) => run.eventKinds.includes(kind)).length
        : null;
      const clause =
        baseline && without !== null ? ` (under ${baseline.label}: ${without} of ${of})` : '';
      add(
        'second-order-event',
        variant,
        null,
        `event-${kind}`,
        `In ${holdsIn} of ${of} seeded runs, a simulated “${kind}” event occurred under ${variant.label}${clause}.`,
        `At least one event of the kind “${kind}” was recorded in the run.`,
        holdsIn,
        of,
        -holdsIn,
        kind,
      );
    }
  }

  candidates.sort(
    (a, b) =>
      KIND_RANK[a.finding.kind] - KIND_RANK[b.finding.kind] ||
      a.variantRank - b.variantRank ||
      CLASS_RANK[a.finding.classification] - CLASS_RANK[b.finding.classification] ||
      a.detailRank - b.detailRank ||
      a.tie.localeCompare(b.tie) ||
      a.finding.id.localeCompare(b.finding.id),
  );
  return candidates.slice(0, FINDINGS_LIMIT).map((candidate) => candidate.finding);
}
