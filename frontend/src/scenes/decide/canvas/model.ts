import {
  UNRECORDED_INPUTS_ADVICE,
  inputsInWords,
  staleComparisonInputs,
} from '../../../../../shared/analysis';
import { CONSTRAINT_CATEGORY_LABELS, VALIDATION_LABELS } from '../../../../../shared/constraints';
import {
  ALIGNMENT_WORDS,
  DECISION_STATUS_INFO,
  EPISTEMIC_LABEL_INFO,
  POSITION_WORDS,
  RECOMMENDATION_PARTS,
  RECOMMENDATION_PART_WORDS,
  type ActorReading,
  type CounterfactualReading,
  type CriticalAssumption,
  type DecisionCanvas,
  type DecisionReadiness,
  type DecisionView,
  type DriverReading,
  type EpistemicLabel,
  type FutureReading,
  type StatusTone,
  type ValidationItem,
} from '../../../../../shared/decision';
import { clip, listed, plural, signedPerHundred } from '../model/format';

/**
 * What the canvas page shows, worked out from the view the server answered with. Everything here is a plain
 * function of that view: the page adds no number, no label and no sentence of its own about the decision,
 * only the words that name the parts of the page and say how to read them.
 */

/** Where the full report begins on the page, so that the canvas can take the reader to it. */
export const FULL_REPORT_ANCHOR = 'sw-full-report';

/** The nine things the first viewport shows, in the order a decision is read. */
export const ITEMS = [
  'question',
  'answer',
  'futures',
  'drivers',
  'constraints',
  'who',
  'changes',
  'next',
  'validate',
] as const;
export type Item = (typeof ITEMS)[number];

export const ITEM_TITLES: Record<Item, string> = {
  question: 'Question',
  answer: 'Current best answer',
  futures: 'Most plausible futures',
  drivers: 'What drives them',
  constraints: 'Material constraints',
  who: 'Who moves',
  changes: 'What could change the result',
  next: 'Recommended next move',
  validate: 'What to validate before acting',
};

/** What each part of the first viewport can show before “and more” is said. */
export const GLANCE = {
  futures: 2,
  drivers: 2,
  constraints: 2,
  who: 3,
  views: 2,
  assumptions: 1,
  checks: 3,
} as const;

/** What a change in a share is a change in: said wherever a figure of one stands, so that no figure is read as the world’s. */
export const FIGURE_UNIT = 'simulated members who resist';

/** The words the page uses about itself: held to the same guard as every other sentence, by a test. */
export const COPY = {
  notice: 'Explore scenarios, not predictions.',
  decisionView: 'Decision view',
  basedOn: 'Worked out from the newest finished comparison, every time this page is read.',
  fullReport: 'Full report',
  emptyLead:
    'A decision picture is read from a finished comparison: the scenario run many times with different seeds and set against a baseline.',
  fullReportLead:
    'The decision brief as it was written, with its charts and the independent review. The picture above is worked out again each time this page is read.',
  toFullReport: 'Go to the full report',
  legendTitle: 'What the labels mean',
  legendLead: 'Every statement says what kind of statement it is.',
  whyStatus: 'Why this status',
  rulesLead: 'The rules are tried in this order, and the first that applies sets the status.',
  heldIn: 'Counts are of seeded runs of the simulation, not of events in the world.',
  readOnly: 'Read only: the simulation did not test it',
  run: 'Run in the simulation',
  couldReverse: 'Could reverse the answer',
  doesNotReverse: 'Does not reverse the answer',
  notTold: 'Cannot be told',
  checklistLead:
    'Checks to do in the real world. Swarm does not track them: someone confirms them outside Swarm.',
  simulatedRole: 'Simulated role',
} as const;

// ---------------------------------------------------------------------------------------------
// Status, labels and tones
// ---------------------------------------------------------------------------------------------

export const statusTone = (canvas: Pick<DecisionCanvas, 'status'>): StatusTone =>
  DECISION_STATUS_INFO[canvas.status.status].tone;

export interface Words {
  label: string;
  tone: StatusTone;
}

/** Where the constraint gate stands, in a word that is not colour alone. */
export function gateWords(constraints: DecisionCanvas['constraints']): Words {
  switch (constraints.gate) {
    case 'blocked':
      return { label: 'Blocked', tone: 'critical' };
    case 'provisional':
      return { label: 'Provisional', tone: 'caution' };
    case 'none':
      return { label: 'Not reviewed', tone: 'caution' };
    case 'clear':
      return constraints.comparisonStatus === 'clear'
        ? { label: 'Clear', tone: 'favor' }
        : { label: 'Clear now, run under constraints that were not', tone: 'caution' };
  }
}

export const labelName = (label: EpistemicLabel): string => EPISTEMIC_LABEL_INFO[label].name;
export const labelMeaning = (label: EpistemicLabel): string => EPISTEMIC_LABEL_INFO[label].meaning;

/** The labels of a list of statements, in the order they first appear, so that one shared label is said once. */
export function labelsOf(lines: readonly { label: EpistemicLabel }[]): EpistemicLabel[] {
  return [...new Set(lines.map((line) => line.label))];
}

export const validationWords = (value: keyof typeof VALIDATION_LABELS): string =>
  VALIDATION_LABELS[value];
export const categoryWords = (value: keyof typeof CONSTRAINT_CATEGORY_LABELS): string =>
  CONSTRAINT_CATEGORY_LABELS[value];
export const positionWords = (actor: Pick<ActorReading, 'position'>): string | null =>
  actor.position === 'none' ? null : POSITION_WORDS[actor.position];
export const alignmentWords = (actor: Pick<ActorReading, 'alignment'>): string =>
  ALIGNMENT_WORDS[actor.alignment];
/** The name of a role without what it is said to do: “Operations: Carries out the change” is “Operations”. */
export const roleName = (actor: Pick<ActorReading, 'role'>): string =>
  clip(actor.role.split(':')[0]?.trim() || actor.role, 40);

// ---------------------------------------------------------------------------------------------
// The first viewport
// ---------------------------------------------------------------------------------------------

export interface ConstraintGlance {
  words: Words;
  hard: number;
  soft: number;
  provisional: number;
  rows: DecisionCanvas['constraints']['hard'];
  more: number;
}

export function constraintGlance(canvas: DecisionCanvas): ConstraintGlance {
  const { hard, soft } = canvas.constraints;
  // What the answer rests on without anyone having confirmed it comes first, then the rest of the hard ones.
  const ordered = [
    ...hard.filter((row) => row.provisional),
    ...hard.filter((row) => !row.provisional),
    ...soft,
  ];
  return {
    words: gateWords(canvas.constraints),
    hard: hard.length,
    soft: soft.length,
    provisional: hard.filter((row) => row.provisional).length,
    rows: ordered.slice(0, GLANCE.constraints),
    more: Math.max(0, ordered.length - GLANCE.constraints),
  };
}

export function moveWords(actor: Pick<ActorReading, 'moves' | 'adverseChange'>): string {
  switch (actor.moves) {
    case 'toward-resistance':
      return 'More resistance';
    case 'toward-support':
      return 'More support';
    case 'little':
      return 'Little change';
    case 'unknown':
      return 'Not compared';
  }
}

/** The change in the simulated share resisting, in simulated members in 100: never a percent. */
export const changeWords = (actor: Pick<ActorReading, 'adverseChange'>): string | null =>
  actor.adverseChange === null ? null : `${signedPerHundred(actor.adverseChange)} in 100`;

/** The views that matter first: those that could reverse the answer, then the largest moves, then those that were not run. */
export function strip(
  views: readonly CounterfactualReading[],
  limit: number = GLANCE.views,
): CounterfactualReading[] {
  const rank = (view: CounterfactualReading): number =>
    view.couldChangeAnswer === true ? 0 : view.applicable ? 1 : 2;
  return [...views]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Math.abs(b.deltaVsBase ?? 0) - Math.abs(a.deltaVsBase ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function viewWords(view: CounterfactualReading): { effect: string; flag: string } {
  return {
    effect: view.deltaVsBase === null ? 'Not run' : `${signedPerHundred(view.deltaVsBase)} in 100`,
    flag:
      view.couldChangeAnswer === true
        ? COPY.couldReverse
        : view.couldChangeAnswer === false
          ? COPY.doesNotReverse
          : COPY.notTold,
  };
}

/** The assumptions that could reverse the answer first, then the rest by size. */
export function assumptionGlance(
  assumptions: readonly CriticalAssumption[],
  limit: number = GLANCE.assumptions,
): CriticalAssumption[] {
  return [...assumptions]
    .sort(
      (a, b) =>
        Number(b.flipsAnswer) - Number(a.flipsAnswer) ||
        Math.abs(b.shift) - Math.abs(a.shift) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export interface Completeness {
  total: number;
  stated: number;
  missing: string[];
}

/**
 * How much of the recommendation is said, and which parts are not. A gap is shown, never left out; and a part that
 * says only that something is not known (whether the choice can be reversed) is a gap, not a part stated.
 */
export function completenessOf(card: DecisionCanvas['answer']['recommendation']): Completeness {
  const total = RECOMMENDATION_PARTS.length + 1;
  const missing = card.missing.map((part) => RECOMMENDATION_PART_WORDS[part]);
  if (card.reversibility.value === 'unknown' && !card.missing.includes('reversibility')) {
    missing.push(`${RECOMMENDATION_PART_WORDS.reversibility} (unknown)`);
  }
  return { total, stated: total - missing.length, missing };
}

export interface Checks {
  items: ValidationItem[];
  more: number;
  /** How many have to be done before anyone acts. */
  before: number;
}

export function checksOf(canvas: DecisionCanvas): Checks {
  const items = canvas.validation.items;
  return {
    items: items.slice(0, GLANCE.checks),
    more: Math.max(0, items.length - GLANCE.checks),
    before: items.filter((item) => item.priority === 'high').length,
  };
}

export const PRIORITY_WORDS: Record<ValidationItem['priority'], string> = {
  high: 'Before acting',
  medium: 'Soon',
  low: 'Later',
};

/**
 * The futures the glance shows: the one that ranks first and the option that changes nothing, so that the first is read
 * against it. Where there are no more than the glance holds, all of them.
 */
export function futureItems(canvas: DecisionCanvas): FutureReading[] {
  const items = canvas.futures.items;
  if (items.length <= GLANCE.futures) return items;
  const [first, ...rest] = items;
  const reference = rest.find((item) => item.kind === 'baseline') ?? rest[0];
  return first && reference ? [first, reference] : items.slice(0, GLANCE.futures);
}
export const driverItems = (canvas: DecisionCanvas): DriverReading[] =>
  canvas.drivers.slice(0, GLANCE.drivers);
export const moverItems = (canvas: DecisionCanvas): ActorReading[] =>
  canvas.actors.items.slice(0, GLANCE.who);

/** One line for an item, said where the item is folded away (a narrow screen). */
export function gistOf(item: Item, canvas: DecisionCanvas): string {
  switch (item) {
    case 'question':
      return clip(canvas.question.asked, 90);
    case 'answer':
      return canvas.status.label;
    case 'futures':
      return canvas.futures.items.length > 0
        ? plural(canvas.futures.items.length, 'simulated future')
        : 'Not shown: too few runs';
    case 'drivers':
      return canvas.drivers.length > 0 ? plural(canvas.drivers.length, 'driver') : 'None stood out';
    case 'constraints': {
      const glance = constraintGlance(canvas);
      return `${glance.words.label} · ${glance.hard} hard, ${glance.soft} soft`;
    }
    case 'who':
      return canvas.actors.items.length > 0
        ? listed(canvas.actors.items.slice(0, 2).map((actor) => actor.name))
        : 'No role simulated';
    case 'changes': {
      const reversing = canvas.changes.counterfactuals.views.filter(
        (view) => view.couldChangeAnswer === true,
      ).length;
      const flipping = canvas.changes.assumptions.filter((row) => row.flipsAnswer).length;
      return reversing + flipping > 0
        ? `${reversing + flipping} could reverse the answer`
        : 'Nothing tried reverses it';
    }
    case 'next':
      return clip(canvas.answer.recommendation.what.text, 90);
    case 'validate': {
      const checks = checksOf(canvas);
      return `${plural(canvas.validation.items.length, 'check')}, ${checks.before} before acting`;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// What is shown when there is no canvas, or it is out of date
// ---------------------------------------------------------------------------------------------

export type CanvasState = 'loading' | 'error' | 'ready' | 'no-analysis' | 'running' | 'failed';

export function stateOf(
  view: DecisionView | null,
  loading: boolean,
  error: string | null,
): CanvasState {
  if (!view) return loading ? 'loading' : error ? 'error' : 'loading';
  return view.canvas
    ? 'ready'
    : view.readiness.state === 'ready'
      ? 'no-analysis'
      : view.readiness.state;
}

export const NEXT_STEPS: Record<
  NonNullable<DecisionReadiness['next']>,
  { scene: 'ask' | 'ground' | 'map' | 'simulate'; label: string }
> = {
  ask: { scene: 'ask', label: 'Open Ask' },
  ground: { scene: 'ground', label: 'Open Ground' },
  map: { scene: 'map', label: 'Open Map' },
  simulate: { scene: 'simulate', label: 'Open Simulate' },
};

export interface Notice {
  tone: 'caution' | 'info';
  title: string;
  text: string;
}

/** What to say at the top of a canvas that describes the project as it was, or that a newer comparison is on its way. */
export function noticesOf(canvas: DecisionCanvas): Notice[] {
  const notices: Notice[] = [];
  if (canvas.freshness.stale) {
    const known = staleComparisonInputs(canvas.freshness.changedSince);
    notices.push({
      tone: 'caution',
      title: 'This picture describes the project as it was',
      text:
        known.length > 0
          ? `The comparison it rests on was run before ${inputsInWords(known)} changed. Run it again to bring this up to date.`
          : `${UNRECORDED_INPUTS_ADVICE} Run it again to be sure.`,
    });
  }
  if (canvas.freshness.newerRunning) {
    notices.push({
      tone: 'info',
      title: 'A newer comparison is running',
      text: 'This picture is of the last finished comparison. It updates when the new one finishes.',
    });
  }
  return notices;
}

/** The words that put a day beside the comparison the picture is of. */
export const basedOnWords = (canvas: DecisionCanvas, day: (iso: string) => string): string =>
  canvas.freshness.completedAt
    ? `Comparison finished ${day(canvas.freshness.completedAt)}`
    : 'Comparison finished';
