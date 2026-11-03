import { z } from 'zod';
import { SENSITIVITY_CLASSES, STABILITY_CLASSES } from './analysis.js';
import type { StatementOrigin } from './brief.js';
import {
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_HARDNESS,
  CONSTRAINT_IMPACT_CLASSES,
  CONSTRAINT_VALIDATIONS,
  COUNTERFACTUAL_IDS,
  GATE_STATUSES,
  type ConfidenceBasisKind,
  type ConstraintSource,
} from './constraints.js';
import { CRITIC_ROLES, CRITIQUE_SEVERITIES, CRITIQUE_STATUSES } from './critique.js';
import type { StatementType } from './evidence.js';
import type { ClaimKind } from './grounding.js';
import { STAKEHOLDER_CATEGORIES, idSchema, type TraitOrigin } from './stakeholders.js';

/**
 * The Decision Canvas: the answer-first picture of a decision. It is derived, every time it is asked
 * for, from the documents a project already holds, and nothing is stored, so it can never be older
 * than what it describes. Version 1.
 *
 * It says what a simulation shows and under which assumptions and constraints. It never says what
 * will happen, never invents a measure of its own, and never forces one answer where the evidence
 * supports none: `DecisionStatus` is how it says which of those cases it is in.
 */
export const DECISION_CANVAS_VERSION = 1;

/** Said wherever the canvas is shown or handed over. */
export const EXPLORE_NOT_PREDICT = 'Explore scenarios, not predictions.';
export const SYNTHETIC_ACTORS_NOTE =
  'Actors are simulated roles that Swarm made up. They are not real people, and nothing here says what a real person would do.';
export const NO_ACTION_NOTE =
  'Swarm recommends and explains. It does not contact anyone, execute anything or make the decision.';

// ---------------------------------------------------------------------------------------------
// Epistemic labels
// ---------------------------------------------------------------------------------------------

/**
 * What a statement is. The labels are never merged: each travels with its statement so that a reader
 * can tell a source's words from a person's assumption, a model's reading, a simulated event and a
 * recommendation.
 */
export const EPISTEMIC_LABELS = [
  'fact',
  'source-claim',
  'assumption',
  'model-inference',
  'simulation-event',
  'scenario-possibility',
  'recommendation',
  'validation-requirement',
] as const;
export type EpistemicLabel = (typeof EPISTEMIC_LABELS)[number];

export const EPISTEMIC_LABEL_INFO: Record<EpistemicLabel, { name: string; meaning: string }> = {
  fact: {
    name: 'Fact',
    meaning:
      'Stated in a source and found word for word in its text, or a record Swarm holds and can show. A source can still be mistaken.',
  },
  'source-claim': {
    name: 'Source claim',
    meaning:
      'A source says so. Swarm has not verified it, and the source may be mistaken or out of date.',
  },
  assumption: {
    name: 'Assumption',
    meaning:
      'Taken as given: a person chose it, or Swarm set it as a default. Nothing shows it is true.',
  },
  'model-inference': {
    name: 'Model inference',
    meaning:
      'Swarm inferred it, by rules or by a language model. No source states it, so it is a reading and not a finding.',
  },
  'simulation-event': {
    name: 'Simulation event',
    meaning:
      'Something that happened inside the simulation under the stated assumptions. It did not happen in the world.',
  },
  'scenario-possibility': {
    name: 'Scenario possibility',
    meaning:
      'One way things could unfold in the simulation. It is a possibility to examine, not a forecast.',
  },
  recommendation: {
    name: 'Recommendation',
    meaning:
      'What Swarm suggests doing next, given what is shown. A person decides; Swarm does not act.',
  },
  'validation-requirement': {
    name: 'Validation requirement',
    meaning: 'Something that has to be checked in the real world before the result is relied on.',
  },
};

/**
 * The one table that maps every kind of statement the product already makes onto an epistemic label.
 * Each namespace is exhaustive (the compiler and a test check it), and the rules behind it are:
 *
 *  - FACT needs a source passage and a quote that the server found in it, or a record Swarm can show.
 *    Nothing a model or a rule inferred, and nothing a person assumed, is ever a fact.
 *  - A source's statement that was not quote-verified is a SOURCE CLAIM.
 *  - What a person chose, and what Swarm set as a default, is an ASSUMPTION.
 *  - What Swarm derived (a stakeholder it inferred, a hypothesis, a constraint it suggested) is a
 *    MODEL INFERENCE, whether the derivation was by rules or by a model.
 *  - What came out of a simulation run, singly or added up, is a SIMULATION EVENT.
 *  - An open question or a gap is a VALIDATION REQUIREMENT.
 */
export const LABEL_TABLE = {
  'brief-origin': {
    'supplied-evidence': 'source-claim',
    'retrieved-public-evidence': 'source-claim',
    'user-assumption': 'assumption',
    'system-assumption': 'assumption',
    'inferred-stakeholder': 'model-inference',
    'actor-behavior': 'simulation-event',
    'simulation-aggregation': 'simulation-event',
    'model-interpretation': 'model-inference',
    'historical-comparison': 'source-claim',
    'unresolved-uncertainty': 'validation-requirement',
  } satisfies Record<StatementOrigin, EpistemicLabel>,
  'claim-kind': {
    'source-fact': 'fact',
    'extracted-claim': 'source-claim',
    'user-assumption': 'assumption',
    'ai-hypothesis': 'model-inference',
    'simulated-event': 'simulation-event',
    'analytical-conclusion': 'simulation-event',
  } satisfies Record<ClaimKind, EpistemicLabel>,
  'statement-type': {
    'source-fact': 'fact',
    'extracted-claim': 'source-claim',
    'user-assumption': 'assumption',
    'inferred-relationship': 'model-inference',
    'ai-hypothesis': 'model-inference',
    'simulated-event': 'simulation-event',
    'analytical-conclusion': 'simulation-event',
    recommendation: 'recommendation',
    'contradicting-evidence': 'source-claim',
    'unresolved-uncertainty': 'validation-requirement',
  } satisfies Record<StatementType, EpistemicLabel>,
  'trait-origin': {
    evidence: 'source-claim',
    user: 'assumption',
    'system-assumption': 'assumption',
    model: 'model-inference',
  } satisfies Record<TraitOrigin, EpistemicLabel>,
  'sensitivity-origin': {
    evidence: 'source-claim',
    user: 'assumption',
    'system-assumption': 'assumption',
    model: 'model-inference',
    scenario: 'assumption',
  } satisfies Record<
    'evidence' | 'user' | 'system-assumption' | 'model' | 'scenario',
    EpistemicLabel
  >,
  'constraint-source': {
    user: 'assumption',
    extracted: 'source-claim',
    inferred: 'model-inference',
  } satisfies Record<ConstraintSource, EpistemicLabel>,
  'constraint-basis': {
    'user-entry': 'assumption',
    'question-quote': 'assumption',
    'scenario-quote': 'assumption',
    'evidence-quote': 'fact',
    'actor-statement': 'model-inference',
    'category-prompt': 'model-inference',
    'model-reading': 'model-inference',
  } satisfies Record<ConfidenceBasisKind, EpistemicLabel>,
  'frame-origin': {
    rules: 'assumption',
    model: 'model-inference',
    user: 'assumption',
  } satisfies Record<'rules' | 'model' | 'user', EpistemicLabel>,
  'stakeholder-origin': {
    rules: 'model-inference',
    model: 'model-inference',
    user: 'assumption',
    scenario: 'assumption',
  } satisfies Record<'rules' | 'model' | 'user' | 'scenario', EpistemicLabel>,
  'critique-origin': {
    rules: 'validation-requirement',
    model: 'model-inference',
  } satisfies Record<'rules' | 'model', EpistemicLabel>,
} as const;

export type LabelNamespace = keyof typeof LABEL_TABLE;
export const LABEL_NAMESPACES = Object.keys(LABEL_TABLE) as LabelNamespace[];

/** The epistemic label of a kind of statement, by the namespace the kind belongs to. */
export function labelOf<N extends LabelNamespace>(
  namespace: N,
  value: keyof (typeof LABEL_TABLE)[N],
): EpistemicLabel {
  return (LABEL_TABLE[namespace] as Record<PropertyKey, EpistemicLabel>)[value]!;
}

/** The label of a constraint: what it was read from, when that is known, else who proposed it. */
export function labelOfConstraint(constraint: {
  source: ConstraintSource;
  confidenceBasis?: { kind: ConfidenceBasisKind };
}): EpistemicLabel {
  return constraint.confidenceBasis
    ? labelOf('constraint-basis', constraint.confidenceBasis.kind)
    : labelOf('constraint-source', constraint.source);
}

const text = (max: number) => z.string().trim().max(max);
const lines = (max: number, count: number) => z.array(text(max)).max(count);
const share = z.number().min(0).max(1);
const signedShare = z.number().min(-1).max(1);
const count = z.int().min(0);

/** A statement with what it is: nothing in the canvas is said without one. `basis` names the kind the label came from. */
export const labelledSchema = z.object({
  text: text(700).min(1),
  label: z.enum(EPISTEMIC_LABELS),
  basis: text(80).optional(),
});
export type Labelled = z.infer<typeof labelledSchema>;

// ---------------------------------------------------------------------------------------------
// The status
// ---------------------------------------------------------------------------------------------

/**
 * What the canvas can honestly say about the choice. Exactly one applies, by rules (`STATUS_RULES`)
 * that read only the stored documents, and the first that applies wins.
 */
export const DECISION_STATUSES = [
  'robust-option',
  'conditional-option',
  'multiple-plausible-options',
  'insufficient-evidence',
  'blocked-by-hard-constraint',
  'needs-human-decision',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export type StatusTone = 'favor' | 'caution' | 'neutral' | 'critical';

export const DECISION_STATUS_INFO: Record<
  DecisionStatus,
  { label: string; meaning: string; tone: StatusTone; recommends: boolean }
> = {
  'robust-option': {
    label: 'Robust option',
    meaning:
      'One option comes out ahead under every lens, the constraints are confirmed, the evidence is adequate, and nothing Swarm tried reverses it.',
    tone: 'favor',
    recommends: true,
  },
  'conditional-option': {
    label: 'Conditional option',
    meaning:
      'One option comes out ahead in the base case, but only while named conditions hold: something could reverse it, or a constraint, the evidence or a lens is not settled.',
    tone: 'caution',
    recommends: true,
  },
  'multiple-plausible-options': {
    label: 'More than one plausible option',
    meaning:
      'The simulation cannot tell the leading options apart within run-to-run variation, so Swarm does not pick one.',
    tone: 'neutral',
    recommends: false,
  },
  'insufficient-evidence': {
    label: 'Insufficient evidence',
    meaning:
      'There is not enough evidence behind the comparison to recommend an option. What is shown follows from assumptions.',
    tone: 'caution',
    recommends: false,
  },
  'blocked-by-hard-constraint': {
    label: 'Blocked by a hard constraint',
    meaning:
      'A hard constraint stops the change, or is unsettled in a way that has to be resolved first. Swarm does not recommend going past it.',
    tone: 'critical',
    recommends: false,
  },
  'needs-human-decision': {
    label: 'Needs a human decision',
    meaning:
      'The choice turns on a value trade-off, or on hard constraints that cannot all hold. The simulation shows the trade-off; a person has to weigh it.',
    tone: 'neutral',
    recommends: false,
  },
};

export const STATUS_RULE_IDS = [
  'no-analysis',
  'gate-blocked',
  'all-violate',
  'no-direction',
  'evidence-insufficient',
  'hard-conflict',
  'value-tradeoff',
  'no-clear-leader',
  'robust',
  'conditional',
] as const;
export type StatusRuleId = (typeof STATUS_RULE_IDS)[number];

/** The rules, in the order they are tried. The first that applies sets the status. */
export const STATUS_RULES: readonly { id: StatusRuleId; status: DecisionStatus; rule: string }[] = [
  {
    id: 'no-analysis',
    status: 'insufficient-evidence',
    rule: 'No finished comparison with recorded runs exists.',
  },
  {
    id: 'gate-blocked',
    status: 'blocked-by-hard-constraint',
    rule: 'The constraint gate, worked out now, is blocked.',
  },
  {
    id: 'all-violate',
    status: 'blocked-by-hard-constraint',
    rule: 'Every alternative violates a confirmed hard constraint.',
  },
  {
    id: 'no-direction',
    status: 'insufficient-evidence',
    rule: 'The comparison cannot tell the change from no change, because no stakeholder has an expected direction of impact.',
  },
  {
    id: 'evidence-insufficient',
    status: 'insufficient-evidence',
    rule: 'The evidence reading is insufficient: the grounding review abstains, no source is attached, or nothing cited supports any actor.',
  },
  {
    id: 'hard-conflict',
    status: 'needs-human-decision',
    rule: 'Two live hard constraints cannot hold together and nobody has settled which gives way.',
  },
  {
    id: 'value-tradeoff',
    status: 'needs-human-decision',
    rule: 'Two lenses each have a different clear leader, so the choice turns on which lens matters more.',
  },
  {
    id: 'no-clear-leader',
    status: 'multiple-plausible-options',
    rule: 'The headline lens has no clear leader: the leading options are within run-to-run variation of each other, there are too few runs to separate them, or the change cannot be told from no change.',
  },
  {
    id: 'robust',
    status: 'robust-option',
    rule: 'One option is the clear leader on every lens that could be computed (at least two), no counterfactual or sensitive assumption could reverse it, the gate and the comparison’s constraints are clear and current, the evidence is adequate, the comparison is current, and the independent review has run with no open blocking objection.',
  },
  {
    id: 'conditional',
    status: 'conditional-option',
    rule: 'One option is the clear leader on the headline lens, and at least one condition above is not met. The conditions are listed.',
  },
];

export const decisionStatusReadingSchema = z.object({
  status: z.enum(DECISION_STATUSES),
  rule: z.enum(STATUS_RULE_IDS),
  label: text(80),
  meaning: text(400),
  /** One sentence for the top of the page, specific to this project. */
  headline: text(600),
  /** What made the rules land here, in order. */
  why: lines(400, 8),
  /** For a recommended option: what it holds under. Empty when it holds under nothing in particular. */
  conditions: lines(400, 10),
});
export type DecisionStatusReading = z.infer<typeof decisionStatusReadingSchema>;

// ---------------------------------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------------------------------

/**
 * Swarm has no objective of its own. A lens is one named, transparent way to read the simulation's
 * own outputs, and each says plainly what it measures. Lenses can disagree, and when they do, that
 * is shown and not averaged away.
 */
export const LENS_IDS = [
  'overall-resistance',
  'key-actor-support',
  'decision-maker-resistance',
  'worst-affected-downside',
] as const;
export type LensId = (typeof LENS_IDS)[number];

/** The lens the headline reads: the share the engine, the brief and the sensitivity step already lead with. */
export const PRIMARY_LENS: LensId = 'overall-resistance';

export interface LensInfo {
  name: string;
  question: string;
  /** What is measured, exactly, in words. */
  measure: string;
  /** Whether a lower or a higher value is the better one on this lens. */
  direction: 'lower' | 'higher';
  scope: string;
}

export const LENS_INFO: Record<LensId, LensInfo> = {
  'overall-resistance': {
    name: 'Least resistance overall',
    question:
      'Which option leaves the smallest simulated share of members looking for an alternative or resisting?',
    measure:
      'The simulated share of members whose final response is to look for an alternative or to resist, every actor counting equally, averaged over the seeded runs.',
    direction: 'lower',
    scope: 'Every actor',
  },
  'key-actor-support': {
    name: 'Broadest support among key actors',
    question:
      'Which option leaves the largest simulated share of the key actors going along or accepting with conditions?',
    measure:
      'The simulated share of the key actors’ members whose final response is to go along or to accept with conditions, every key actor counting equally, averaged over the seeded runs.',
    direction: 'higher',
    scope: 'Key actors: the roles simulated one by one',
  },
  'decision-maker-resistance': {
    name: 'Least resistance among decision makers and approvers',
    question:
      'Which option leaves the smallest simulated share of the people who decide, approve or can block it resisting?',
    measure:
      'The simulated share of the members of actors who decide, approve or can block, whose final response is to look for an alternative or to resist, averaged over the seeded runs.',
    direction: 'lower',
    scope: 'Actors that decide, approve or can block',
  },
  'worst-affected-downside': {
    name: 'Smallest downside for the worst-affected group',
    question:
      'Which option leaves the group that fares worst with the smallest simulated share looking for an alternative or resisting?',
    measure:
      'In each seeded run, the highest simulated share of any one actor’s members looking for an alternative or resisting, averaged over the runs.',
    direction: 'lower',
    scope: 'The actor that fares worst under each option',
  },
};

/** An option is only told apart from another by at least this much of the lens’s own scale (the sensitivity step’s own “material” line). */
export const LENS_MATERIAL_GAP = 0.05;
/** A clear leader needs at least this many paired seeded runs: with fewer, the spread says too little. */
export const LENS_MIN_RUNS = 10;
/** Noise that has to be exceeded, in standard errors of the paired difference, before an option is called ahead. */
export const LENS_NOISE_FACTOR = 2;

export const LENS_STANDINGS = ['leads', 'level', 'behind', 'not-assessed'] as const;
export type LensStanding = (typeof LENS_STANDINGS)[number];

export const LENS_STANDING_WORDS: Record<LensStanding, string> = {
  leads: 'Clearly ahead',
  level: 'Level with the best',
  behind: 'Clearly behind',
  'not-assessed': 'Not assessed',
};

const lensResultSchema = z.object({
  alternativeId: idSchema,
  /** The lens’s own scale, 0 to 1, as a mean over the seeded runs. */
  value: share.nullable(),
  low: share.nullable(),
  high: share.nullable(),
  runs: count,
  standing: z.enum(LENS_STANDINGS),
  detail: text(200).nullable().default(null),
});

export const lensReadingSchema = z.object({
  id: z.enum(LENS_IDS),
  name: text(120),
  question: text(300),
  measure: text(400),
  direction: z.enum(['lower', 'higher']),
  computable: z.boolean(),
  /** Why a lens could not be computed, or what limits how far it can be read. */
  note: text(400).nullable(),
  results: z.array(lensResultSchema).max(8),
  /** The option clearly ahead of every other that can be chosen, when there is one. */
  leaderId: idSchema.nullable(),
  /** When there is no clear leader: the options that cannot be told apart at the top. */
  levelIds: z.array(idSchema).max(8),
  /** How far the leader is ahead of the nearest other option, on the lens’s own scale. */
  margin: z.number().min(0).max(1).nullable(),
  verdict: z.enum(['clear-leader', 'tie', 'not-assessed']),
});
export type LensReading = z.infer<typeof lensReadingSchema>;

// ---------------------------------------------------------------------------------------------
// Responses read as who stands where
// ---------------------------------------------------------------------------------------------

export const RESPONSE_GROUPS = ['favourable', 'neutral', 'defensive', 'adverse'] as const;
export type ResponseGroup = (typeof RESPONSE_GROUPS)[number];

export const RESPONSE_GROUP_CATEGORIES: Record<ResponseGroup, readonly string[]> = {
  favourable: ['adopt', 'accept-with-conditions'],
  neutral: ['wait'],
  defensive: ['adapt-defensively'],
  adverse: ['switch', 'resist'],
};

export const RESPONSE_GROUP_WORDS: Record<ResponseGroup, string> = {
  favourable: 'Go along or accept with conditions',
  neutral: 'Wait and see',
  defensive: 'Adapt to limit the impact',
  adverse: 'Look for an alternative or resist',
};

/** How an actor stands toward the option, in a word: where most of its simulated members ended. */
export const ALIGNMENT_WORDS: Record<ResponseGroup, string> = {
  favourable: 'Supports',
  neutral: 'Undecided',
  defensive: 'Adapts defensively',
  adverse: 'Resists',
};

export type GroupShares = Record<ResponseGroup, number>;

/** The group with the largest share; a tie goes to the more adverse group, as the findings do. */
export function dominantGroup(shares: GroupShares): ResponseGroup {
  let best: ResponseGroup = 'adverse';
  for (const group of ['defensive', 'neutral', 'favourable'] as const) {
    if (shares[group] > shares[best] + 1e-12) best = group;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------------------------

export const ALTERNATIVE_VERDICTS = ['preferred', 'viable', 'weak', 'blocked'] as const;
export type AlternativeVerdict = (typeof ALTERNATIVE_VERDICTS)[number];

export const ALTERNATIVE_VERDICT_WORDS: Record<AlternativeVerdict, string> = {
  preferred: 'Preferred',
  viable: 'Viable',
  weak: 'Weak',
  blocked: 'Blocked',
};

const alternativeSchema = z.object({
  id: idSchema,
  label: text(120),
  kind: z.enum(['baseline', 'alternative']),
  verdict: z.enum(ALTERNATIVE_VERDICTS),
  why: text(500),
  /** The hard constraints that rule it out, when any do. */
  violatedConstraintIds: z.array(idSchema).max(20),
  /** Whether every one of those constraints is confirmed: an unconfirmed one makes it provisional, not blocked. */
  violationConfirmed: z.boolean().nullable(),
  standing: z.record(z.enum(LENS_IDS), z.enum(LENS_STANDINGS)),
  runs: count,
});
export type AlternativeReading = z.infer<typeof alternativeSchema>;

const futureSchema = z.object({
  alternativeId: idSchema,
  label: text(120),
  kind: z.enum(['baseline', 'alternative']),
  /** What the simulation shows when this option is taken; a scenario possibility, never a forecast. */
  statement: labelledSchema,
  dominant: z.enum(RESPONSE_GROUPS),
  shares: z.object({ favourable: share, neutral: share, defensive: share, adverse: share }),
  /** The lowest and highest run of the adverse share, only where the runs support a spread. */
  adverseRange: z.object({ low: share, high: share }).nullable(),
  /** The runs in which the dominant response was the largest, out of the runs. */
  heldIn: count,
  of: count,
  repeatability: z.enum(STABILITY_CLASSES),
  standing: z.enum(LENS_STANDINGS),
});
export type FutureReading = z.infer<typeof futureSchema>;

const driverSchema = z.object({
  id: text(100),
  kind: z.enum(['assumption', 'constraint', 'actor']),
  statement: labelledSchema,
  /** How far it moved the headline share in the simulation, when it was measured: positive is more resistance. */
  effect: signedShare.nullable(),
  flipsAnswer: z.boolean(),
});
export type DriverReading = z.infer<typeof driverSchema>;

export const POSITIONS = ['decides', 'approves', 'can-block', 'advises', 'none'] as const;
export type DecisionPosition = (typeof POSITIONS)[number];
export const POSITION_WORDS: Record<DecisionPosition, string> = {
  decides: 'Decides',
  approves: 'Approves',
  'can-block': 'Can block',
  advises: 'Advises',
  none: 'No say in the decision',
};

const actorReadingSchema = z.object({
  actorId: idSchema,
  name: text(120),
  kind: z.enum(['key', 'cohort']),
  category: z.enum(STAKEHOLDER_CATEGORIES),
  /** The participant role where one was proposed, else the actor’s own role. A role Swarm models, never a person. */
  role: text(120),
  synthetic: z.literal(true),
  influence: z.enum(['low', 'medium', 'high']),
  position: z.enum(POSITIONS),
  alignment: z.enum(RESPONSE_GROUPS),
  /** Mean final stance under the option shown, from -1 (against) to 1 (in favour). */
  stance: signedShare,
  stanceChange: signedShare.nullable(),
  adverseShare: share,
  adverseChange: signedShare.nullable(),
  moves: z.enum(['toward-support', 'toward-resistance', 'little', 'unknown']),
  /** Where the direction of the change’s impact on this actor comes from. */
  directionBasis: labelledSchema,
  uncertainty: z.enum(['low', 'medium', 'high']),
  cited: z.boolean(),
  plausibleActions: lines(200, 3),
});
export type ActorReading = z.infer<typeof actorReadingSchema>;

export const constraintRowSchema = z.object({
  id: idSchema,
  statement: text(400),
  category: z.enum(CONSTRAINT_CATEGORIES),
  hardness: z.enum(CONSTRAINT_HARDNESS),
  /** “From your question”, “From evidence”, “Inferred”, “You”. */
  source: text(60),
  label: z.enum(EPISTEMIC_LABELS),
  validation: z.enum(CONSTRAINT_VALIDATIONS),
  enforcement: z.enum(['enforced', 'read-only']),
  /** What the comparison did with it: ran it, only read it, or was run before it was there. */
  inComparison: z.enum(['applied', 'read-only', 'not-in-comparison', 'unknown']),
  effects: lines(200, 3),
  /** A hard constraint nobody has confirmed: the result rests on it provisionally. */
  provisional: z.boolean(),
  violatedBy: z.array(idSchema).max(8),
});
export type ConstraintRow = z.infer<typeof constraintRowSchema>;

const assumptionSchema = z.object({
  id: text(100),
  statement: labelledSchema,
  origin: z.enum(['evidence', 'user', 'system-assumption', 'model', 'scenario']),
  classification: z.enum(SENSITIVITY_CLASSES),
  /** How far moving it moved the headline share in the simulation, on the same seeds. */
  shift: signedShare,
  standardError: z.number().min(0).max(1),
  flipsAnswer: z.boolean(),
  evidenced: z.boolean(),
});
export type CriticalAssumption = z.infer<typeof assumptionSchema>;

const counterfactualReadingSchema = z.object({
  id: z.enum(COUNTERFACTUAL_IDS),
  label: text(120),
  change: text(300),
  applicable: z.boolean(),
  deltaVsBase: signedShare.nullable(),
  standardError: z.number().min(0).max(1).nullable(),
  classification: z.enum(CONSTRAINT_IMPACT_CLASSES).nullable(),
  driver: text(240),
  /** Whether it could reverse the answer: true or false when it was measurable, null when it was not. */
  couldChangeAnswer: z.boolean().nullable(),
  statement: labelledSchema,
});
export type CounterfactualReading = z.infer<typeof counterfactualReadingSchema>;

const critiqueReadingSchema = z.object({
  id: text(80),
  role: z.enum(CRITIC_ROLES),
  roleLabel: text(80),
  severity: z.enum(CRITIQUE_SEVERITIES),
  status: z.enum(CRITIQUE_STATUSES),
  objection: labelledSchema,
  impact: text(500),
  requestedAction: text(300).nullable(),
});
export type CritiqueReading = z.infer<typeof critiqueReadingSchema>;

export const VALIDATION_KINDS = ['evidence', 'assumption', 'constraint', 'stakeholder'] as const;
export type ValidationKind = (typeof VALIDATION_KINDS)[number];
export const VALIDATION_SOURCES = [
  'missing-evidence',
  'unvalidated-constraint',
  'flipping-assumption',
  'stakeholder',
  'conflict',
  'critic',
  'status',
] as const;
export type ValidationSource = (typeof VALIDATION_SOURCES)[number];

export const validationItemSchema = z.object({
  id: text(100),
  kind: z.enum(VALIDATION_KINDS),
  priority: z.enum(['high', 'medium', 'low']),
  source: z.enum(VALIDATION_SOURCES),
  what: text(400),
  why: text(500),
  how: text(500),
  label: z.literal('validation-requirement'),
  refs: z.array(text(80)).max(4),
});
export type ValidationItem = z.infer<typeof validationItemSchema>;

export const stopConditionSchema = z.object({
  id: text(100),
  when: text(400),
  then: text(300),
  basis: text(300),
  label: z.literal('validation-requirement'),
});
export type StopCondition = z.infer<typeof stopConditionSchema>;

/** Present or explicitly missing: a part of a recommendation is never left out. */
export const partSchema = z.object({
  items: z.array(labelledSchema).max(8),
  missing: text(300).nullable(),
});
export type Part = z.infer<typeof partSchema>;

export const RECOMMENDATION_PARTS = [
  'forWhom',
  'assumptions',
  'constraints',
  'supportingEvidence',
  'weakeningEvidence',
  'invalidatedBy',
  'testNext',
  'approval',
] as const;
export type RecommendationPart = (typeof RECOMMENDATION_PARTS)[number];

export const RECOMMENDATION_PART_WORDS: Record<RecommendationPart | 'reversibility', string> = {
  forWhom: 'For whom',
  assumptions: 'Under these assumptions',
  constraints: 'Under these constraints',
  supportingEvidence: 'Evidence that supports it',
  weakeningEvidence: 'Evidence that weakens it',
  invalidatedBy: 'What would invalidate it',
  testNext: 'What to test next',
  reversibility: 'Whether it can be reversed',
  approval: 'Human approval needed',
};

export const REVERSIBILITY_VALUES = [
  'reversible',
  'partly-reversible',
  'hard-to-reverse',
  'unknown',
] as const;
export type Reversibility = (typeof REVERSIBILITY_VALUES)[number];
export const REVERSIBILITY_WORDS: Record<Reversibility, string> = {
  reversible: 'Can be reversed',
  'partly-reversible': 'Partly reversible',
  'hard-to-reverse': 'Hard to reverse',
  unknown: 'Unknown',
};

export const recommendationSchema = z.object({
  kind: z.enum([
    'proceed',
    'keep-no-change',
    'hold',
    'decide',
    'resolve-constraint',
    'gather-evidence',
  ]),
  what: labelledSchema,
  forWhom: partSchema,
  assumptions: partSchema,
  constraints: partSchema,
  supportingEvidence: partSchema,
  weakeningEvidence: partSchema,
  invalidatedBy: partSchema,
  testNext: partSchema,
  reversibility: z.object({ value: z.enum(REVERSIBILITY_VALUES), statement: labelledSchema }),
  approval: partSchema,
  /** Every part above that has nothing in it, so that a gap is a finding and not an omission. */
  missing: z.array(z.enum([...RECOMMENDATION_PARTS, 'reversibility'])).max(9),
});
export type RecommendationCard = z.infer<typeof recommendationSchema>;

export const APPROVAL_STAGES = ['before-simulation', 'before-acting'] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];
export const approvalPointSchema = z.object({
  id: text(80),
  stage: z.enum(APPROVAL_STAGES),
  text: text(400),
  /** `done` only where Swarm holds the record; everything else is `open`: a person confirms it outside Swarm. */
  state: z.enum(['done', 'open']),
});
export type ApprovalPoint = z.infer<typeof approvalPointSchema>;

export const HIGH_STAKES_DOMAINS = ['employment', 'credit', 'legal', 'medical', 'safety'] as const;
export type HighStakesDomain = (typeof HIGH_STAKES_DOMAINS)[number];

export const decisionCanvasSchema = z.object({
  version: z.literal(DECISION_CANVAS_VERSION),
  notice: z.literal(EXPLORE_NOT_PREDICT),
  /** 1. The question, in the person’s words, and what Swarm made of it. */
  question: z.object({
    asked: text(2000),
    decision: labelledSchema,
    baseline: labelledSchema,
    system: text(300),
    horizon: labelledSchema.nullable(),
    geography: labelledSchema.nullable(),
    successWording: labelledSchema.nullable(),
  }),
  /** 2. The current best answer. */
  status: decisionStatusReadingSchema,
  answer: z.object({
    headline: labelledSchema,
    preferredAlternativeId: idSchema.nullable(),
    recommendation: recommendationSchema,
  }),
  alternatives: z.array(alternativeSchema).max(8),
  lenses: z.array(lensReadingSchema).max(4),
  lensAgreement: z.object({
    state: z.enum(['agree', 'disagree', 'tied', 'not-assessed']),
    statement: text(600),
  }),
  /** 3. The most plausible futures, as scenario possibilities; empty when the simulation does not support them. */
  futures: z.object({
    supported: z.boolean(),
    note: text(500),
    items: z.array(futureSchema).max(3),
  }),
  /** 4. What drives them. */
  drivers: z.array(driverSchema).max(6),
  /** 5. The material constraints. */
  constraints: z.object({
    gate: z.enum([...GATE_STATUSES, 'none']),
    gateSummary: text(300),
    comparisonStatus: z.enum(['none', 'clear', 'provisional']),
    provisional: z.boolean(),
    provisionalLabel: text(300).nullable(),
    reviewed: z.boolean(),
    hard: z.array(constraintRowSchema).max(20),
    soft: z.array(constraintRowSchema).max(20),
    missing: lines(300, 6),
    notModelled: lines(200, 8),
    note: text(500),
  }),
  /** 6. Who moves. */
  actors: z.object({
    focusAlternativeId: idSchema.nullable(),
    focusLabel: text(120).nullable(),
    baselineLabel: text(120).nullable(),
    items: z.array(actorReadingSchema).max(12),
    note: text(400),
  }),
  /** 7. What could change the result. */
  changes: z.object({
    counterfactuals: z.object({
      available: z.boolean(),
      current: z.boolean(),
      note: text(400),
      views: z.array(counterfactualReadingSchema).max(COUNTERFACTUAL_IDS.length),
    }),
    assumptions: z.array(assumptionSchema).max(8),
    sensitivity: z.object({
      tested: count,
      sensitive: count,
      robust: count,
      inconclusive: count,
      note: text(400),
    }),
  }),
  /** 9. What to validate before acting, and when to stop and rethink. */
  validation: z.object({
    items: z.array(validationItemSchema).max(14),
    stopConditions: z.array(stopConditionSchema).max(8),
    note: text(400),
  }),
  evidence: z.object({
    level: z.enum(['adequate', 'limited', 'insufficient']),
    reasons: lines(300, 8),
    documents: z.object({ total: count, supplied: count, retrieved: count, historical: count }),
    actors: z.object({ total: count, supported: count, unsupported: lines(120, 6) }),
    conflicts: z.object({ open: count, total: count }).nullable(),
    ledger: z.object({
      assessed: z.boolean(),
      level: z.enum(['sufficient', 'limited', 'insufficient']).nullable(),
      reasons: lines(300, 4),
    }),
    research: z
      .object({
        status: text(40),
        pagesRead: count,
        pagesUsed: count,
        quarantined: count,
        failed: count,
        conflicts: count,
        categories: z.array(z.object({ category: text(60), label: text(80), count })).max(10),
        authorityEstimates: z.object({ high: count, medium: count, low: count, unknown: count }),
        stoppedBecause: text(200).nullable(),
      })
      .nullable(),
    missing: lines(240, 6),
    statements: z.array(labelledSchema).max(8),
  }),
  uncertainty: z.object({
    runsPerOption: count,
    fidelity: text(200),
    reasons: z.array(labelledSchema).max(8),
    note: text(400),
  }),
  reversibility: z.object({ value: z.enum(REVERSIBILITY_VALUES), statement: labelledSchema }),
  timing: z.object({
    horizon: labelledSchema.nullable(),
    lands: labelledSchema,
    constraints: z.array(labelledSchema).max(4),
  }),
  risks: z.array(labelledSchema).max(5),
  opportunities: z.array(labelledSchema).max(5),
  interventions: z
    .array(
      z.object({
        alternativeId: idSchema,
        label: text(120),
        changes: z.array(labelledSchema).max(6),
        setting: labelledSchema,
      }),
    )
    .max(8),
  noRegret: z.object({ moves: z.array(labelledSchema).max(4), note: text(400) }),
  critic: z.object({
    reviewed: z.boolean(),
    current: z.boolean(),
    open: count,
    blockingOpen: count,
    note: text(400),
    challenges: z.array(critiqueReadingSchema).max(5),
  }),
  approvals: z.array(approvalPointSchema).max(8),
  highStakes: z.object({
    flagged: z.boolean(),
    domains: z.array(z.enum(HIGH_STAKES_DOMAINS)).max(HIGH_STAKES_DOMAINS.length),
    note: text(400),
  }),
  freshness: z.object({
    analysisId: idSchema,
    completedAt: z.iso.datetime().nullable(),
    stale: z.boolean(),
    changedSince: lines(120, 8),
    newerRunning: z.boolean(),
    inputRevisions: z.record(z.string().max(40), z.int().min(0)),
  }),
  notes: lines(400, 8),
  /** How many generated sentences broke the wording guard and were replaced by a plain one. Expected: 0. */
  withheld: count,
});
export type DecisionCanvas = z.infer<typeof decisionCanvasSchema>;

// ---------------------------------------------------------------------------------------------
// What the route answers
// ---------------------------------------------------------------------------------------------

export const READINESS_STATES = ['ready', 'no-analysis', 'running', 'failed'] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export interface DecisionReadiness {
  state: ReadinessState;
  /** What is missing, in plain words: for no canvas, what stops it; for one, what it still lacks. */
  missing: string[];
  /** The step that supplies it. */
  next: 'ask' | 'ground' | 'map' | 'simulate' | null;
  /** Where the status rules land without a canvas: always insufficient evidence, with why. */
  status: DecisionStatusReading | null;
}

/** `GET /api/projects/:id/decision`. */
export interface DecisionView {
  canvas: DecisionCanvas | null;
  readiness: DecisionReadiness;
  may: { run: boolean; export: boolean };
}
