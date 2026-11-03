import {
  type ActorReading,
  type ConstraintRow,
  type DecisionCanvas,
  type DecisionStatusReading,
  type StopCondition,
  type ValidationItem,
  type ValidationKind,
  type ValidationSource,
} from '../../../shared/decision.js';
import { CRITIC_ROLE_LABELS, type CriticRole } from '../../../shared/critique.js';
import { Guard, clip, embed, listed, signed } from './words.js';

/**
 * What to check before acting, and when to stop and rethink. Both are worked out from what the
 * project holds, by rules, and never written by a model: a missing source, a hard constraint nobody
 * has confirmed, an assumption whose change could reverse the answer, a role that matters and is
 * uncertain, a conflict between sources, an objection from the independent review that is still open.
 * Each item says what to check, why, and how, in words that belong to no domain.
 */

export interface FlippingAssumption {
  id: string;
  label: string;
  origin: 'evidence' | 'user' | 'system-assumption' | 'model' | 'scenario';
  shift: number;
  flipsAnswer: boolean;
  classification: 'assumption-sensitive' | 'robust' | 'inconclusive';
}

export interface OpenCritique {
  id: string;
  role: CriticRole;
  severity: 'note' | 'minor' | 'major' | 'blocking';
  objection: string;
  impact: string;
  requestedAction: string | null;
}

export interface ValidationWorld {
  status: DecisionStatusReading;
  evidence: DecisionCanvas['evidence'];
  scenarioMissing: readonly string[];
  hardConstraints: readonly ConstraintRow[];
  openQuestions: readonly string[];
  assumptions: readonly FlippingAssumption[];
  actors: readonly ActorReading[];
  /** The topics of the conflicts between sources that are still open. */
  conflicts: readonly string[];
  critiques: readonly OpenCritique[];
  /** The options the simulation could not tell apart, or the ones that lead on different lenses, when the status is about that. */
  optionNames: readonly string[];
  reversibility: 'reversible' | 'partly-reversible' | 'hard-to-reverse' | 'unknown';
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const SOURCE_ORDER: Record<ValidationSource, number> = {
  'unvalidated-constraint': 0,
  'flipping-assumption': 1,
  'missing-evidence': 2,
  stakeholder: 3,
  conflict: 4,
  critic: 5,
  status: 6,
};

const KIND_OF_ROLE: Record<CriticRole, ValidationKind> = {
  evidence: 'evidence',
  assumption: 'assumption',
  methodology: 'assumption',
  'stakeholder-coverage': 'stakeholder',
  bias: 'evidence',
  recommendation: 'assumption',
  adversarial: 'assumption',
};

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 40);

export function planValidation(
  world: ValidationWorld,
  guard: Guard,
): { items: ValidationItem[]; stopConditions: StopCondition[] } {
  const items: ValidationItem[] = [];
  const add = (
    source: ValidationSource,
    key: string,
    kind: ValidationKind,
    priority: ValidationItem['priority'],
    what: string,
    why: string,
    how: string,
    refs: readonly string[] = [],
  ): void => {
    const id = `val-${source}-${slug(key) || String(items.length + 1)}`;
    if (items.some((item) => item.id === id)) return;
    items.push({
      id,
      kind,
      priority,
      source,
      what: guard.say(what, 400),
      why: guard.say(why, 500),
      how: guard.say(how, 500),
      label: 'validation-requirement',
      refs: refs.slice(0, 4).map((ref) => clip(ref, 80)),
    });
  };

  // Hard constraints that the result rests on without anyone having confirmed them.
  for (const row of world.hardConstraints) {
    if (row.validation === 'confirmed' || row.validation === 'rejected') continue;
    add(
      'unvalidated-constraint',
      row.id,
      'constraint',
      'high',
      `Confirm or set aside the hard constraint ${embed(row.statement, 120)}.`,
      `It is ${row.validation === 'unvalidated' ? 'not yet validated' : row.validation === 'assumed' ? 'assumed, not checked' : 'marked unknown'}${row.enforcement === 'read-only' ? ', and the simulation only reads it without testing it' : ''}, so the result holds only provisionally.`,
      'Ask whoever owns the constraint to confirm it in writing, or find the rule that sets it. Then mark it confirmed, edit it or remove it in the constraints review, and run the comparison again.',
      [row.id],
    );
  }
  for (const question of world.openQuestions.slice(0, 3)) {
    add(
      'unvalidated-constraint',
      `question-${question}`,
      'constraint',
      'medium',
      `Answer the open question: ${embed(question, 140)}`,
      'Swarm could not find this out, and the answer could change what limits the decision.',
      'Ask the person who knows, record the answer as a constraint, an assumption or unknown, and run the comparison again.',
    );
  }

  // Assumptions the result turns on.
  const flipping = world.assumptions.filter((row) => row.flipsAnswer);
  for (const row of flipping) {
    add(
      'flipping-assumption',
      row.id,
      'assumption',
      'high',
      `Check ${embed(row.label, 120)} against real observations.`,
      `Moving it changed the simulated share by ${signed(row.shift)}, enough to put another option ahead, and ${row.origin === 'evidence' ? 'a source supports it' : 'nothing cited supports it'}.`,
      'Collect real observations of this quantity, or run a small pilot, and compare them with the value the simulation used. If they differ, edit the assumption and run the comparison again.',
      [row.id],
    );
  }
  for (const row of world.assumptions
    .filter(
      (candidate) =>
        !candidate.flipsAnswer &&
        candidate.classification === 'assumption-sensitive' &&
        candidate.origin !== 'evidence',
    )
    .slice(0, 2)) {
    add(
      'flipping-assumption',
      row.id,
      'assumption',
      'medium',
      `Check ${embed(row.label, 120)}.`,
      `The result is sensitive to it (a shift of ${signed(row.shift)} in the simulated share) and nothing cited supports it.`,
      'Find a source for it or a real observation of it, and edit the assumption if it differs.',
      [row.id],
    );
  }

  // Evidence that is missing.
  if (world.evidence.documents.total === 0) {
    add(
      'missing-evidence',
      'no-sources',
      'evidence',
      'high',
      'Attach at least one source that bears on the decision.',
      'No source is attached, so nothing the comparison rests on is sourced.',
      'Add a document or a public page that states how the change affects the groups involved, then run the comparison again.',
    );
  }
  for (const item of world.scenarioMissing.slice(0, 3)) {
    add(
      'missing-evidence',
      `missing-${item}`,
      'evidence',
      world.evidence.level === 'insufficient' ? 'high' : 'medium',
      `Find evidence for ${embed(item, 140)}.`,
      'The scenario lists it as missing, so what the simulation assumes about it is unsupported.',
      'Find a source that states it, or ask whoever holds the underlying data. Add it as a source and run the comparison again.',
    );
  }
  for (const actor of world.actors
    .filter(
      (candidate) =>
        !candidate.cited && (candidate.influence === 'high' || candidate.position !== 'none'),
    )
    .slice(0, 3)) {
    add(
      'missing-evidence',
      `actor-${actor.actorId}`,
      'evidence',
      actor.influence === 'high' ? 'high' : 'medium',
      `Find a source for how the change lands on ${embed(actor.name, 80)}.`,
      'The role matters in the simulation and nothing cited supports how the change affects it, so its direction of impact is an assumption.',
      'Find a passage, a record or a data set that shows how the change affects the group this role stands for, and add it as a source.',
      [actor.actorId],
    );
  }

  // Roles that matter and are uncertain.
  for (const actor of world.actors
    .filter(
      (candidate) =>
        candidate.uncertainty === 'high' &&
        (candidate.influence === 'high' || candidate.position !== 'none'),
    )
    .slice(0, 3)) {
    add(
      'stakeholder',
      actor.actorId,
      'stakeholder',
      actor.position === 'decides' ||
        actor.position === 'approves' ||
        actor.position === 'can-block'
        ? 'high'
        : 'medium',
      `Check with someone who holds the role ${embed(actor.name, 80)} what they would need to see.`,
      'The role has real weight in the simulation and its response is uncertain, so what the simulation shows for it is a reading and not a finding.',
      'Speak with a real person in that role, or review how people in it have responded to comparable changes. Swarm does not contact anyone.',
      [actor.actorId],
    );
  }

  // Sources that disagree.
  for (const topic of world.conflicts.slice(0, 2)) {
    add(
      'conflict',
      topic,
      'evidence',
      'medium',
      `Resolve the conflict between sources about ${embed(topic, 120)}.`,
      'Two sources disagree, so the simulation may be resting on the wrong one.',
      'Get the underlying data from both owners, find which is current, and mark the conflict resolved in Ground.',
    );
  }

  // What the independent review left open.
  for (const critique of world.critiques
    .filter((candidate) => candidate.severity === 'blocking' || candidate.severity === 'major')
    .slice(0, 3)) {
    add(
      'critic',
      critique.id,
      KIND_OF_ROLE[critique.role],
      critique.severity === 'blocking' ? 'high' : 'medium',
      `Answer the ${CRITIC_ROLE_LABELS[critique.role].toLowerCase()}: ${embed(critique.objection, 140)}`,
      critique.impact === ''
        ? 'An independent reviewer raised it and it is still open.'
        : critique.impact,
      critique.requestedAction ??
        'Respond to it in the independent review, with the evidence that answers it.',
      [critique.id],
    );
  }

  // Where the status itself is about a gap.
  if (world.status.status === 'multiple-plausible-options') {
    add(
      'status',
      'separate-options',
      'assumption',
      'high',
      `Find out what would tell ${listed(world.optionNames.slice(0, 3))} apart.`,
      'The simulation could not separate them within run-to-run variation, so choosing between them is not something it supports.',
      'Look at the assumptions the options differ by, test the one that matters most in a small and reversible trial, and run the comparison again.',
    );
  }
  if (world.status.status === 'needs-human-decision') {
    add(
      'status',
      'weigh-tradeoff',
      'stakeholder',
      'high',
      'Settle with the decision owner which lens matters more.',
      'Each lens favours a different option, and the simulation cannot say which lens a person should value.',
      'Put the lenses in front of the decision owner and ask which they would weigh most and why. Record the answer and the reason.',
    );
  }

  items.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      a.id.localeCompare(b.id),
  );

  const stops: StopCondition[] = [];
  const stop = (key: string, when: string, then: string, basis: string): void => {
    stops.push({
      id: `stop-${slug(key) || String(stops.length + 1)}`,
      when: guard.say(when, 400),
      then: guard.say(then, 300),
      basis: guard.say(basis, 300),
      label: 'validation-requirement',
    });
  };
  for (const row of world.hardConstraints
    .filter(
      (candidate) => candidate.validation !== 'confirmed' && candidate.validation !== 'rejected',
    )
    .slice(0, 2)) {
    stop(
      `constraint-${row.id}`,
      `${embed(row.statement, 110)} turns out not to hold as written.`,
      'Stop, correct the constraint and run the comparison again before going on.',
      'The result rests on this hard constraint without anyone having confirmed it.',
    );
  }
  for (const row of flipping.slice(0, 2)) {
    stop(
      `assumption-${row.id}`,
      `A real measurement of ${embed(row.label, 110)} falls where it would put another option ahead.`,
      'Pause, take the measured value back into the simulation and read the answer again before acting.',
      'The simulation shows that this assumption alone could change which option leads.',
    );
  }
  const holder = world.actors.find(
    (actor) =>
      actor.position === 'decides' ||
      actor.position === 'approves' ||
      actor.position === 'can-block',
  );
  if (holder) {
    stop(
      `holder-${holder.actorId}`,
      `A real person in the role ${embed(holder.name, 80)} says no when asked directly.`,
      'Stop and rethink the option or the plan: a simulation cannot overrule someone who can decide or block.',
      'The role can decide, approve or block, and its simulated response is only a reading.',
    );
  }
  if (world.critiques.some((critique) => critique.severity === 'blocking')) {
    stop(
      'blocking-objection',
      'An objection marked blocking by the independent review cannot be answered with evidence.',
      'Stop and rethink before acting on the result.',
      'A blocking objection says the conclusion may not stand.',
    );
  }
  if (world.reversibility !== 'reversible') {
    stop(
      'irreversible-first-step',
      'The first step turns out to be impossible to undo.',
      'Stop and ask the named approver for an explicit decision before taking it.',
      world.reversibility === 'unknown'
        ? 'Whether the choice can be reversed is unknown.'
        : 'The choice is hard to reverse, or only partly reversible.',
    );
  }
  stop(
    'new-information',
    'Something the simulation did not include appears: a new group affected, a new rule, or a source that contradicts one the result rests on.',
    'Pause and run the comparison again with it included.',
    'The comparison only knows what the project held when it was run.',
  );
  return { items: items.slice(0, 12), stopConditions: stops.slice(0, 8) };
}
