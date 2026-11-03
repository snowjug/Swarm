import {
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_CATEGORY_LABELS,
  DEFAULT_APPROVAL_THRESHOLD,
  EFFECT_MAX_ROUND,
  GATE_STATUS_WORDS,
  OPEN_WINDOW,
  constraintEffectSchema,
  isAppliedConstraint,
  isLive,
  type Constraint,
  type ConstraintCategory,
  type ConstraintCoverage,
  type ConstraintEffect,
  type ConstraintHardness,
  type ConstraintInput,
  type ConstraintPatch,
  type ConstraintSet,
  type ConstraintSeverity,
  type ConstraintValidation,
  type ConstraintWindow,
  type ConsideredIn,
  type CounterfactualSet,
  type EnforcedEffectKind,
  type GateStatus,
  type LimitableResponse,
} from '../../../../../shared/constraints';
import type { Tone } from '../../../design/ui';

/** What the page puts in each section: what is live, hard first, and what a person has set aside. */
export interface Sections {
  hard: Constraint[];
  soft: Constraint[];
  setAside: Constraint[];
}

const CATEGORY_ORDER: ReadonlyMap<ConstraintCategory, number> = new Map(
  CONSTRAINT_CATEGORIES.map((category, at) => [category, at]),
);

/** What needs a person first: what waits for a first look, then what is not confirmed, then by kind. */
function weight(constraint: Constraint): number {
  if (constraint.review === 'proposed') return 0;
  return constraint.validation === 'confirmed' ? 2 : 1;
}

const byAttention = (a: Constraint, b: Constraint): number =>
  weight(a) - weight(b) ||
  (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0) ||
  a.id.localeCompare(b.id);

export function sectionsOf(set: Pick<ConstraintSet, 'constraints'>): Sections {
  const live = set.constraints.filter(isLive).sort(byAttention);
  return {
    hard: live.filter((constraint) => constraint.hardness === 'hard'),
    soft: live.filter((constraint) => constraint.hardness === 'soft'),
    setAside: set.constraints.filter((constraint) => !isLive(constraint)).sort(byAttention),
  };
}

/** How many constraints wait for a first look. */
export const waitingOf = (set: Pick<ConstraintSet, 'constraints'>): number =>
  set.constraints.filter((constraint) => constraint.review === 'proposed').length;

export const gateTone = (status: GateStatus): Tone =>
  status === 'clear' ? 'favor' : status === 'provisional' ? 'caution' : 'critical';

export const gateWord = (status: GateStatus): string => GATE_STATUS_WORDS[status];

export interface Tally {
  id: 'known' | 'assumed' | 'conflicting' | 'missing' | 'violated';
  label: string;
  /** What the count counts, in a few words, for the person who has not seen it before. */
  hint: string;
  count: number;
}

/** The gate's lists as the numbers a person reads first. */
export function tallyOf(coverage: ConstraintCoverage): Tally[] {
  return [
    {
      id: 'known',
      label: 'Known',
      hint: 'Hard limits you have confirmed',
      count: coverage.known.length,
    },
    {
      id: 'assumed',
      label: 'Assumed',
      hint: 'Treated as true without being checked',
      count: coverage.assumed.length,
    },
    {
      id: 'conflicting',
      label: 'Conflicting',
      hint: 'Pairs that cannot both hold',
      count: coverage.conflicting.length,
    },
    {
      id: 'missing',
      label: 'Missing',
      hint: 'Questions nobody has answered',
      count: coverage.missing.length,
    },
    {
      id: 'violated',
      label: 'Ruled out',
      hint: 'Alternatives a hard limit forbids',
      count: coverage.violations.length,
    },
  ];
}

export const validationTone = (validation: ConstraintValidation): Tone => {
  switch (validation) {
    case 'confirmed':
      return 'favor';
    case 'unvalidated':
    case 'assumed':
      return 'caution';
    case 'rejected':
      return 'against';
    default:
      return 'neutral';
  }
};

export type AppliedState = 'applied' | 'waiting' | 'unknown' | 'read' | 'set-aside';

/** Whether the next simulation runs under this constraint, and if not, why: said apart from what it is. */
export function appliedStateOf(constraint: Constraint): AppliedState {
  if (!isLive(constraint)) return 'set-aside';
  if (constraint.enforcement !== 'enforced') return 'read';
  if (constraint.review === 'proposed') return 'waiting';
  return isAppliedConstraint(constraint) ? 'applied' : 'unknown';
}

export const APPLIED_WORDS: Record<AppliedState, string> = {
  applied: 'Applied in the simulation',
  waiting: 'Applied once you accept it',
  unknown: 'Not applied: unknown',
  read: 'Read, not modelled',
  'set-aside': 'Set aside',
};

export const appliedTone = (state: AppliedState): Tone =>
  state === 'applied' ? 'accent' : 'neutral';

const CONSIDERED_WORDS: Record<ConsideredIn, string> = {
  gate: 'the gate',
  critic: 'the independent review',
  counterfactual: 'a counterfactual view',
  'analysis-record': 'the comparison’s record',
};

/** Where a constraint the simulation cannot apply was taken into account instead. Never claims a change it did not make. */
export function consideredWords(
  constraint: Pick<Constraint, 'consideredIn' | 'enforcement'>,
): string {
  if (constraint.enforcement === 'enforced') return '';
  const places = constraint.consideredIn.map((place) => CONSIDERED_WORDS[place]);
  const list =
    places.length < 2
      ? (places[0] ?? '')
      : `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
  return list
    ? `The simulation does not apply it, and does not change because of it. Taken into account in ${list}.`
    : 'The simulation does not apply it, and does not change because of it.';
}

/** The window of a constraint in words: the rounds the engine reads, and the person’s own words beside them. */
export function windowWords(window: ConstraintWindow): string {
  const { fromRound, toRound, text } = window;
  const rounds =
    fromRound !== null && toRound !== null
      ? `Rounds ${fromRound} to ${toRound}`
      : fromRound !== null
        ? `From round ${fromRound}`
        : toRound !== null
          ? `Until round ${toRound}`
          : '';
  return [rounds, text].filter(Boolean).join(' · ');
}

/** Names for ids, in the order given, with ids that are not known left out. */
export function namesOf(ids: readonly string[], names: ReadonlyMap<string, string>): string[] {
  return ids.flatMap((id) => {
    const name = names.get(id);
    return name ? [name] : [];
  });
}

export type ReviewChoice =
  | 'accept'
  | 'confirm'
  | 'edit'
  | 'mark-unknown'
  | 'use-assumption'
  | 'exclude'
  | 'remove'
  | 'restore';

export const CHOICE_WORDS: Record<ReviewChoice, string> = {
  accept: 'Accept',
  confirm: 'Confirm',
  edit: 'Edit',
  'mark-unknown': 'Mark unknown',
  'use-assumption': 'Use as an assumption',
  exclude: 'Leave out of the model',
  remove: 'Remove',
  restore: 'Restore',
};

/** What each choice does, for a tooltip and the page's own explanation of it. */
export const CHOICE_HINTS: Record<ReviewChoice, string> = {
  accept: 'Keep it in the list. It stays not yet validated until you confirm it.',
  confirm: 'You have checked it, and it holds.',
  edit: 'Change its words, its scope or what the simulation does with it.',
  'mark-unknown': 'You do not know whether it holds. It is not applied and not treated as true.',
  'use-assumption':
    'Treat it as true for now without checking, and say so wherever the result is used.',
  exclude: 'Keep it listed but leave it out of the simulation.',
  remove: 'Set it aside. It stays on record as removed.',
  restore: 'Put it back in the list.',
};

/** The choices for one constraint: the ones a person is likely to want, and the rest in a menu. */
export function choicesOf(constraint: Constraint): {
  primary: ReviewChoice[];
  more: ReviewChoice[];
} {
  if (!isLive(constraint)) return { primary: ['restore'], more: [] };
  const more: ReviewChoice[] = ['edit'];
  if (constraint.validation !== 'unknown') more.push('mark-unknown');
  if (constraint.validation !== 'assumed' && constraint.validation !== 'confirmed') {
    more.push('use-assumption');
  }
  more.push('exclude', 'remove');
  if (constraint.review === 'proposed') return { primary: ['accept', 'confirm'], more };
  return { primary: constraint.validation === 'confirmed' ? [] : ['confirm'], more };
}

// ---- Writing a constraint -------------------------------------------------------------------------

export type EffectChoice = 'none' | EnforcedEffectKind;

export interface EffectDraft {
  kind: EffectChoice;
  /** The size of a reduction, a cost or a risk, as typed. */
  amount: string;
  /** Rounds of a delay or of the gap in a sequence, as typed. */
  rounds: string;
  /** The stance an approver has to reach, as typed. */
  threshold: string;
  approver: string;
  target: 'switching' | 'adoption';
  forbid: LimitableResponse[];
  before: string[];
}

export const NO_EFFECT: EffectDraft = {
  kind: 'none',
  amount: '0.2',
  rounds: '2',
  threshold: String(DEFAULT_APPROVAL_THRESHOLD),
  approver: '',
  target: 'adoption',
  forbid: [],
  before: [],
};

export function draftOfEffect(effect: ConstraintEffect | undefined): EffectDraft {
  if (!effect) return { ...NO_EFFECT };
  switch (effect.kind) {
    case 'block':
      return { ...NO_EFFECT, kind: 'block' };
    case 'limit-actions':
      return { ...NO_EFFECT, kind: effect.kind, forbid: [...effect.forbid] };
    case 'delay':
      return { ...NO_EFFECT, kind: effect.kind, rounds: String(effect.rounds) };
    case 'reduce-influence':
    case 'add-risk':
      return { ...NO_EFFECT, kind: effect.kind, amount: String(effect.amount) };
    case 'add-cost':
      return {
        ...NO_EFFECT,
        kind: effect.kind,
        amount: String(effect.amount),
        target: effect.target,
      };
    case 'require-approval':
      return {
        ...NO_EFFECT,
        kind: effect.kind,
        approver: effect.approverActorId,
        threshold: String(effect.threshold),
      };
    case 'force-sequencing':
      return {
        ...NO_EFFECT,
        kind: effect.kind,
        before: [...effect.beforeActorIds],
        rounds: String(effect.gapRounds),
      };
  }
}

/** The effect a draft says, or what is wrong with it in words a person can act on. */
export function effectOfDraft(draft: EffectDraft): {
  effect: ConstraintEffect | null;
  problem: string | null;
} {
  const number = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));
  const candidate = ((): unknown => {
    switch (draft.kind) {
      case 'none':
        return null;
      case 'block':
        return { kind: 'block' };
      case 'limit-actions':
        return { kind: 'limit-actions', forbid: draft.forbid };
      case 'delay':
        return { kind: 'delay', rounds: number(draft.rounds) };
      case 'reduce-influence':
      case 'add-risk':
        return { kind: draft.kind, amount: number(draft.amount) };
      case 'add-cost':
        return { kind: 'add-cost', target: draft.target, amount: number(draft.amount) };
      case 'require-approval':
        return {
          kind: 'require-approval',
          approverActorId: draft.approver,
          threshold: number(draft.threshold),
        };
      case 'force-sequencing':
        return {
          kind: 'force-sequencing',
          beforeActorIds: draft.before,
          gapRounds: number(draft.rounds),
        };
    }
  })();
  if (candidate === null) return { effect: null, problem: null };
  const parsed = constraintEffectSchema.safeParse(candidate);
  if (parsed.success) return { effect: parsed.data, problem: null };
  const { kind } = draft;
  if (kind === 'force-sequencing' && draft.before.length === 0) {
    return { effect: null, problem: 'Choose who has to hear first.' };
  }
  const problem =
    kind === 'delay' || kind === 'force-sequencing'
      ? `Rounds must be a whole number from 1 to ${EFFECT_MAX_ROUND}.`
      : kind === 'require-approval'
        ? 'Choose who approves, and a stance between -1 and 1.'
        : kind === 'limit-actions'
          ? 'Choose at least one response to take away.'
          : kind === 'add-cost'
            ? 'The amount must be between 0.05 and 0.5.'
            : kind === 'reduce-influence'
              ? 'The amount must be between 0.05 and 0.9.'
              : 'The amount must be between 0.05 and 1.';
  return { effect: null, problem };
}

export interface EditorDraft {
  category: ConstraintCategory;
  statement: string;
  hardness: ConstraintHardness;
  actorIds: string[];
  alternativeIds: string[];
  windowText: string;
  fromRound: string;
  toRound: string;
  severity: ConstraintSeverity;
  effect: EffectDraft;
  /** What the person says of a constraint they add: it holds, they assume it, or they do not know. */
  validation: 'confirmed' | 'assumed' | 'unknown';
  note: string;
}

export function draftOfConstraint(
  constraint?: Constraint,
  category: ConstraintCategory = 'budget',
): EditorDraft {
  return {
    category: constraint?.category ?? category,
    statement: constraint?.statement ?? '',
    hardness: constraint?.hardness ?? 'soft',
    actorIds: [...(constraint?.affectedActorIds ?? [])],
    alternativeIds: [...(constraint?.affectedAlternativeIds ?? [])],
    windowText: constraint?.window.text ?? '',
    fromRound: constraint?.window.fromRound?.toString() ?? '',
    toRound: constraint?.window.toRound?.toString() ?? '',
    severity: constraint?.severity ?? 'medium',
    effect: draftOfEffect(constraint?.effects[0]),
    validation: 'confirmed',
    note: constraint?.note ?? '',
  };
}

const wholeRound = (text: string): number | null | 'bad' => {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= EFFECT_MAX_ROUND ? value : 'bad';
};

/** What is wrong with a draft, in words a person can act on, or null when it can be saved. */
export function problemWith(draft: EditorDraft): string | null {
  if (draft.statement.trim().length < 3) return 'Say what the limit is, in a sentence.';
  if (draft.statement.trim().length > 400) return 'Keep it to 400 characters.';
  const from = wholeRound(draft.fromRound);
  const to = wholeRound(draft.toRound);
  if (from === 'bad' || to === 'bad') {
    return `A round is a whole number from 1 to ${EFFECT_MAX_ROUND}.`;
  }
  if (from !== null && to !== null && to < from) {
    return 'A window ends in or after the round it starts.';
  }
  return effectOfDraft(draft.effect).problem;
}

function windowOfDraft(draft: EditorDraft): ConstraintWindow {
  const from = wholeRound(draft.fromRound);
  const to = wholeRound(draft.toRound);
  return {
    ...OPEN_WINDOW,
    fromRound: typeof from === 'number' ? from : null,
    toRound: typeof to === 'number' ? to : null,
    text: draft.windowText.trim().slice(0, 120),
  };
}

/** A constraint of the person's own, for an add or an answer: where it came from is the server's to say, so it is not here. */
export function inputOfDraft(draft: EditorDraft): ConstraintInput {
  const { effect } = effectOfDraft(draft.effect);
  return {
    category: draft.category,
    statement: draft.statement.trim(),
    hardness: draft.hardness,
    affectedActorIds: draft.actorIds,
    affectedAlternativeIds: draft.alternativeIds,
    window: windowOfDraft(draft),
    severity: draft.severity,
    effects: effect ? [effect] : [],
    note: draft.note.trim(),
    validation: draft.validation,
  };
}

/** What changed between a constraint and the draft of it, and nothing else, so that an edit says what it is. */
export function patchOfDraft(draft: EditorDraft, original: Constraint): ConstraintPatch {
  const patch: ConstraintPatch = {};
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (draft.category !== original.category) patch.category = draft.category;
  if (draft.statement.trim() !== original.statement) patch.statement = draft.statement.trim();
  if (draft.hardness !== original.hardness) patch.hardness = draft.hardness;
  if (!same(draft.actorIds, original.affectedActorIds)) patch.affectedActorIds = draft.actorIds;
  if (!same(draft.alternativeIds, original.affectedAlternativeIds)) {
    patch.affectedAlternativeIds = draft.alternativeIds;
  }
  const window = windowOfDraft(draft);
  if (!same(window, original.window)) patch.window = window;
  if (draft.severity !== original.severity) patch.severity = draft.severity;
  const { effect } = effectOfDraft(draft.effect);
  const effects = effect ? [effect] : [];
  if (!same(effects, original.effects)) patch.effects = effects;
  if (draft.note.trim() !== original.note) patch.note = draft.note.trim();
  return patch;
}

export const hasChanges = (patch: ConstraintPatch): boolean => Object.keys(patch).length > 0;

// ---- The views of the proposed change ------------------------------------------------------------

export const CLASS_WORDS = {
  material: 'Moves the result',
  negligible: 'Barely moves it',
  inconclusive: 'Too noisy to say',
} as const;

export const classTone = (classification: keyof typeof CLASS_WORDS | null): Tone =>
  classification === 'material' ? 'caution' : 'neutral';

/** A difference in the simulated headline share, in points of it, with its sign written out. */
export function pointsWords(delta: number | null): string {
  if (delta === null) return '';
  const points = Math.round(Math.abs(delta) * 100);
  if (points === 0) return 'No difference';
  return `${delta > 0 ? '+' : '−'}${points} points`;
}

export interface ViewRow {
  id: string;
  label: string;
  change: string;
  applicable: boolean;
  /** Why it was not run, when it was not. */
  reason: string | null;
  points: string;
  classification: keyof typeof CLASS_WORDS | null;
  driver: string;
}

export function viewRowsOf(set: CounterfactualSet): ViewRow[] {
  return set.views.map((view) => ({
    id: view.id,
    label: view.label,
    change: view.change,
    applicable: view.applicable,
    reason: view.reason,
    points: pointsWords(view.deltaVsBase),
    classification: view.classification,
    driver: view.driver,
  }));
}

export const labelOfCategory = (category: ConstraintCategory): string =>
  CONSTRAINT_CATEGORY_LABELS[category];
