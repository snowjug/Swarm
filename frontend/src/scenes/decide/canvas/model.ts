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
  recommendationCompleteness,
  type ActorReading,
  type CounterfactualReading,
  type CriticalAssumption,
  type DecisionCanvas,
  type DecisionReadiness,
  type DecisionView,
  type DriverReading,
  type EpistemicLabel,
  type FutureReading,
  type Labelled,
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

/**
 * The ten things the first viewport shows, in the order a decision is read: the question and the answer, then the
 * situation (the futures, who moves, what limits it, what it assumes), then what follows from it (what drives it,
 * what could change it, the next move, what to validate before acting).
 */
export const ITEMS = [
  'question',
  'answer',
  'futures',
  'who',
  'constraints',
  'assumptions',
  'drivers',
  'changes',
  'next',
  'validate',
] as const;
export type Item = (typeof ITEMS)[number];

export const ITEM_TITLES: Record<Item, string> = {
  question: 'Question',
  answer: 'Current best answer',
  futures: 'Most plausible futures',
  who: 'Who moves',
  constraints: 'Material constraints',
  assumptions: 'Critical assumptions',
  drivers: 'What drives them',
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
  assumptions: 2,
  checks: 3,
  conditions: 2,
  reasons: 2,
  /** What a decision about one person says of what the exploration can and cannot tell, before “more” is said. */
  canTell: 1,
  cannotTell: 1,
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
  scopeLabel: 'What Swarm does not decide',
  scopeMatched: 'Matched',
  canTell: 'Can tell them',
  cannotTell: 'Cannot tell them',
  tellLabel: 'What the exploration can and cannot tell the person who decides',
  canTellDetail: 'What the exploration can tell them',
  cannotTellDetail: 'What it cannot tell them',
  scopeBridge: 'The note on what Swarm does not decide, above, applies to everything below.',
  reviewTitle: 'Who reviews it, by matter',
  scopeLimits:
    'The rules read words and are not complete: a matter they miss is still a matter for a person.',
  noScope:
    'Nothing in the question or its framing points to a matter of employment, credit, legal, medical or safety. Swarm still does not make the decision.',
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
      return { label: 'Not read yet', tone: 'caution' };
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
/**
 * What the answer rests on, as the recommendation says it (the assumptions it depends on first, then those the
 * scenario states), how many of the sensitive assumptions could reverse the answer, and how many lines there are
 * beyond the ones shown.
 */
export function assumptionsOf(canvas: DecisionCanvas): {
  lines: Labelled[];
  total: number;
  more: number;
  flips: number;
  missing: string | null;
} {
  const part = canvas.answer.recommendation.assumptions;
  return {
    lines: part.items.slice(0, GLANCE.assumptions),
    total: part.items.length,
    more: Math.max(0, part.items.length - GLANCE.assumptions),
    flips: canvas.changes.assumptions.filter((row) => row.flipsAnswer).length,
    missing: part.missing,
  };
}

/** How many of the assumptions could reverse the answer, said as a count. */
export const reverseWords = (flips: number): string => `${flips} could reverse the answer`;

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

/**
 * What the sensitivity step did and found, in a count of its rows: how many assumptions it moved, and how many moved the
 * result clearly. Said wherever the changes are, so that "no view was run" is never read as "nothing was tried".
 */
export function sensitivityWords(sensitivity: DecisionCanvas['changes']['sensitivity']): string {
  return sensitivity.tested === 0
    ? 'Sensitivity to assumptions was not run.'
    : `${plural(sensitivity.tested, 'assumption')} moved on the same seeds: ${sensitivity.sensitive} moved the result clearly, ${sensitivity.robust} did not, ${sensitivity.inconclusive} could not be told.`;
}

export type Completeness = ReturnType<typeof recommendationCompleteness>;

/**
 * What stands under the status. A status that holds only on conditions says them, those the headline has not already
 * said (a status that leans on a condition without saying it is the page misleading); any other says what made the
 * rules land.
 */
export function reasonsOf(canvas: DecisionCanvas): { label: string; lines: string[] } {
  const { status, answer } = canvas;
  const conditions = status.conditions.filter((line) => !answer.headline.text.includes(line));
  return conditions.length > 0
    ? { label: 'Conditions it holds under', lines: conditions.slice(0, GLANCE.conditions) }
    : { label: 'Why this status', lines: status.why.slice(0, GLANCE.reasons) };
}

/**
 * What a decision about one person says, at a glance, of what the exploration can and cannot tell the person who
 * decides: the first of each, and how many more the recommendation in full holds. Null for any other question.
 */
export function explorationOf(
  canvas: DecisionCanvas,
): { canTell: Labelled[]; cannotTell: Labelled[]; more: number } | null {
  const { exploration } = canvas.scope;
  if (!exploration) return null;
  return {
    canTell: exploration.canTell.slice(0, GLANCE.canTell),
    cannotTell: exploration.cannotTell.slice(0, GLANCE.cannotTell),
    more:
      Math.max(0, exploration.canTell.length - GLANCE.canTell) +
      Math.max(0, exploration.cannotTell.length - GLANCE.cannotTell),
  };
}

/**
 * What the recommendation rests on, in what the project holds: the sources, the simulated actors with a passage cited for
 * them, and how far the evidence is judged to go. Counts of the record, so they are facts; the judgement is flagged when it
 * is not adequate.
 */
export function basisOf(canvas: DecisionCanvas): { counts: string; level: string | null } {
  const { documents, actors, level } = canvas.evidence;
  return {
    counts: `${plural(documents.total, 'source document')}, ${actors.supported} of ${plural(actors.total, 'simulated actor')} with a cited passage`,
    level: level === 'adequate' ? null : `Evidence ${level}`,
  };
}

/**
 * How much of the recommendation is said, and which parts are not: the card's own list of missing parts, counted. A gap
 * is shown, never left out; and a part that says only that something is not known (whether the choice can be reversed)
 * is a gap, not a part stated. The count and the words are the shared function's, so that an export says the same.
 */
export function completenessOf(card: DecisionCanvas['answer']['recommendation']): Completeness {
  return recommendationCompleteness(card);
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
    case 'assumptions': {
      const { total, flips } = assumptionsOf(canvas);
      if (total === 0) return 'None recorded';
      return flips > 0
        ? `${plural(total, 'assumption')} · ${reverseWords(flips)}`
        : plural(total, 'assumption');
    }
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
      const { counterfactuals, assumptions, sensitivity } = canvas.changes;
      const run = counterfactuals.views.filter((view) => view.deltaVsBase !== null);
      const tried = run.length + sensitivity.tested;
      if (tried === 0) return 'Nothing was tried against it';
      if (canvas.answer.preferredAlternativeId === null) return `${tried} tried`;
      const reversing =
        run.filter((view) => view.couldChangeAnswer === true).length +
        assumptions.filter((row) => row.flipsAnswer).length;
      if (reversing > 0) return `${reversing} could reverse the answer`;
      const unsettled =
        run.filter((view) => view.couldChangeAnswer === null).length + sensitivity.inconclusive;
      return unsettled > 0
        ? `${tried} tried; ${unsettled} cannot be told`
        : `${tried} tried; none reverses it`;
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
  /** What the notice offers to open: the simulation, to run it again, or the Map, where the model can be asked again. */
  action?: 'simulate' | 'map';
}

/** What to say at the top of a canvas that describes the project as it was, or that a newer comparison is on its way. */
export function noticesOf(canvas: DecisionCanvas): Notice[] {
  const notices: Notice[] = [];
  // A list the rules made after the model was asked and could not be used is the rules’, never the model’s, and
  // the page says so here, where nobody can miss it. A note among the roles would push the ten things off the
  // first screen, which is kept for what is the same for every project.
  for (const origin of [canvas.actors.origin, canvas.constraints.origin]) {
    if (origin.source === 'rules-fallback') {
      notices.push({ tone: 'caution', title: origin.label, text: origin.detail, action: 'map' });
    }
  }
  if (canvas.freshness.stale) {
    const known = staleComparisonInputs(canvas.freshness.changedSince);
    notices.push({
      tone: 'caution',
      title: 'This picture describes the project as it was',
      text:
        known.length > 0
          ? `The comparison it rests on was run before ${inputsInWords(known)} changed. Run it again to bring this up to date.`
          : `${UNRECORDED_INPUTS_ADVICE} Run it again to be sure.`,
      action: 'simulate',
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
