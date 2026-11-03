import { z } from 'zod';
import { idSchema } from './stakeholders.js';

/**
 * What a constraint can do to a simulation, and what the analysis keeps of it. This file knows nothing
 * of how a constraint is found, reviewed or labelled (`constraints.ts`): it is only what the engine is
 * given and what a comparison records, so that `analysis.ts` can use it without a cycle.
 *
 * An effect is a deterministic change to the state the engine already has (a round in which the change
 * reaches an actor, an actor's influence, a trait, how a final stance is read). Nothing here is a
 * prediction of what a rule or a limit does in the world: it is what the simulation does when told that
 * a limit exists, and a constraint with no effect here is `interpretive` and changes nothing in a run.
 */

/** The last round a run can have: the same number as `MAX_ROUNDS` in analysis.ts (a test holds them equal). */
export const EFFECT_MAX_ROUND = 36;

/** The kinds of effect the engine applies. Each is listed in `EFFECT_CATALOGUE` with what it does. */
export const ENFORCED_EFFECT_KINDS = [
  'block',
  'limit-actions',
  'delay',
  'reduce-influence',
  'add-cost',
  'require-approval',
  'add-risk',
  'force-sequencing',
] as const;
export type EnforcedEffectKind = (typeof ENFORCED_EFFECT_KINDS)[number];

/** Kinds the engine does not apply: a constraint that can only be read this way stays interpretive. */
export const INTERPRETIVE_EFFECT_KINDS = ['branch'] as const;

export const CONSTRAINT_EFFECT_KINDS = [
  ...ENFORCED_EFFECT_KINDS,
  ...INTERPRETIVE_EFFECT_KINDS,
] as const;
export type ConstraintEffectKind = (typeof CONSTRAINT_EFFECT_KINDS)[number];

/** The responses a constraint can take away from an actor. Each is read as the nearest one left. */
export const LIMITABLE_RESPONSES = ['adopt', 'switch', 'resist'] as const;
export type LimitableResponse = (typeof LIMITABLE_RESPONSES)[number];

/** Where a final stance goes when the response it would read as is not open to the actor. */
export const NEAREST_OPEN_RESPONSE: Record<LimitableResponse, string> = {
  adopt: 'accept-with-conditions',
  switch: 'resist',
  resist: 'adapt-defensively',
};

/** The stance an approver has to reach when the person has not said: the line where a stance reads as accepting. */
export const DEFAULT_APPROVAL_THRESHOLD = 0.1;

const rounds = z.int().min(1).max(EFFECT_MAX_ROUND);

export const constraintEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('block') }),
  z.object({
    kind: z.literal('limit-actions'),
    forbid: z.array(z.enum(LIMITABLE_RESPONSES)).min(1).max(LIMITABLE_RESPONSES.length),
  }),
  z.object({ kind: z.literal('delay'), rounds }),
  z.object({ kind: z.literal('reduce-influence'), amount: z.number().min(0.05).max(0.9) }),
  z.object({
    kind: z.literal('add-cost'),
    target: z.enum(['switching', 'adoption']),
    amount: z.number().min(0.05).max(0.5),
  }),
  z.object({
    kind: z.literal('require-approval'),
    approverActorId: idSchema,
    threshold: z.number().min(-1).max(1),
  }),
  z.object({ kind: z.literal('add-risk'), amount: z.number().min(0.05).max(1) }),
  z.object({
    kind: z.literal('force-sequencing'),
    beforeActorIds: z.array(idSchema).min(1).max(20),
    gapRounds: rounds,
  }),
]);
export type ConstraintEffect = z.infer<typeof constraintEffectSchema>;

export interface EffectInfo {
  enforced: boolean;
  label: string;
  /** What the engine does, in the words a person reads beside the constraint. */
  engine: string;
  /** Which of `fromRound` and `toRound` the engine reads for it; the rest of a window is not modelled. */
  window: 'both' | 'from' | 'none';
}

export const EFFECT_CATALOGUE: Record<ConstraintEffectKind, EffectInfo> = {
  block: {
    enforced: true,
    label: 'Forbids the change',
    engine:
      'The change does not reach the actors in scope (all of them when none is named) in the rounds the constraint is active, so their stances stay where they would be without it.',
    window: 'both',
  },
  'limit-actions': {
    enforced: true,
    label: 'Limits what an actor can do',
    engine:
      'For the actors in scope, a final stance that would read as a response the constraint takes away is read as the nearest open one instead: adopt as accept with conditions, switch as resist, resist as adapt defensively. Stances do not change.',
    window: 'both',
  },
  delay: {
    enforced: true,
    label: 'Delays the change',
    engine:
      'The change reaches the actors in scope that many rounds later than it otherwise would. A delay that runs past the last round means it never reaches them.',
    window: 'none',
  },
  'reduce-influence': {
    enforced: true,
    label: 'Reduces influence',
    engine:
      'The influence of the actors in scope is scaled down by the amount, for the whole run, so the actors that listen to them weigh them less.',
    window: 'none',
  },
  'add-cost': {
    enforced: true,
    label: 'Adds friction',
    engine:
      'For the whole run, raises the cost of switching of the actors in scope, or lowers their readiness to take up something new, by the amount.',
    window: 'none',
  },
  'require-approval': {
    enforced: true,
    label: 'Needs an approver',
    engine:
      'The change reaches the actors in scope only from the round after the approver’s simulated mean stance is at or above the threshold (read once the change has reached the approver). If it never is, it never reaches them.',
    window: 'both',
  },
  'add-risk': {
    enforced: true,
    label: 'Adds risk',
    engine:
      'From the first round of the window, adds scrutiny to the actors in scope: members who accept little risk settle at a lower stance. Removed after the last round of the window, if it has one.',
    window: 'both',
  },
  'force-sequencing': {
    enforced: true,
    label: 'Forces an order',
    engine:
      'The change reaches the actors in scope that many rounds after it reaches the named earlier actors.',
    window: 'none',
  },
  branch: {
    enforced: false,
    label: 'Would open a branch',
    engine:
      'Not applied: the engine runs the alternatives it is given and does not open new ones. The counterfactual views explore such a branch instead.',
    window: 'none',
  },
};

export const isEnforcedKind = (kind: string): kind is EnforcedEffectKind =>
  (ENFORCED_EFFECT_KINDS as readonly string[]).includes(kind);

const line = (max: number) => z.string().trim().max(max);

/**
 * One effect of one constraint as the engine takes it. `actorIds` is who it is about (every actor when
 * empty) and the window is the rounds it is active in (the whole run when open); `EFFECT_CATALOGUE` says
 * which part of the window an effect reads.
 */
export const appliedConstraintSchema = z
  .object({
    id: idSchema,
    effect: constraintEffectSchema,
    actorIds: z.array(idSchema).max(60).default([]),
    fromRound: rounds.nullable().default(null),
    toRound: rounds.nullable().default(null),
  })
  .refine(
    (applied) =>
      applied.fromRound === null ||
      applied.toRound === null ||
      applied.toRound >= applied.fromRound,
    {
      message: 'A window ends in or after the round it starts.',
      path: ['toRound'],
    },
  );
export type AppliedConstraint = z.infer<typeof appliedConstraintSchema>;

export const MAX_APPLIED_CONSTRAINTS = 100;

/** What a run says it did because of a constraint: simulation events, never findings about the world. */
export const CONSTRAINT_EVENT_KINDS = [
  'held',
  'delayed',
  'sequenced',
  'approval-granted',
  'approval-withheld',
  'limited',
  'risk-added',
  'influence-reduced',
  'friction-added',
] as const;
export type ConstraintEventKind = (typeof CONSTRAINT_EVENT_KINDS)[number];

export const constraintEventSchema = z.object({
  constraintId: idSchema,
  kind: z.enum(CONSTRAINT_EVENT_KINDS),
  round: rounds,
  actorIds: z.array(idSchema).max(60).default([]),
  description: line(300),
});
export type ConstraintEvent = z.infer<typeof constraintEventSchema>;

export const MAX_CONSTRAINT_EVENTS = 80;

// ---------------------------------------------------------------------------------------------
// What a comparison records
// ---------------------------------------------------------------------------------------------

export const CONSTRAINT_SOURCES = ['user', 'extracted', 'inferred'] as const;
export type ConstraintSource = (typeof CONSTRAINT_SOURCES)[number];

export const CONSTRAINT_VALIDATIONS = [
  'unvalidated',
  'confirmed',
  'rejected',
  'unknown',
  'assumed',
] as const;
export type ConstraintValidation = (typeof CONSTRAINT_VALIDATIONS)[number];

/** A constraint as a comparison applied it, copied so that the comparison can be read, and run again, as it was. */
export const recordedConstraintSchema = z.object({
  constraintId: idSchema,
  statement: line(400),
  category: z.string().min(1).max(40),
  hardness: z.enum(['hard', 'soft']),
  source: z.enum(CONSTRAINT_SOURCES),
  validation: z.enum(CONSTRAINT_VALIDATIONS),
  effect: constraintEffectSchema,
  actorIds: z.array(idSchema).max(60).default([]),
  /** The scenarios it applies to: every scenario of the comparison when empty. */
  alternativeIds: z.array(idSchema).max(8).default([]),
  fromRound: rounds.nullable().default(null),
  toRound: rounds.nullable().default(null),
  /** Said where the simulation applies it differently from how it is written, such as a window it does not read. */
  note: line(240).optional(),
});
export type RecordedConstraint = z.infer<typeof recordedConstraintSchema>;

/** A constraint the comparison read but did not apply, and why: it is listed so that it is not mistaken for one that was. */
export const NOT_APPLIED_REASONS = [
  'interpretive',
  'unknown',
  'excluded',
  'dangling',
  'soft-block',
  'over-limit',
] as const;
export type NotAppliedReason = (typeof NOT_APPLIED_REASONS)[number];

export const NOT_APPLIED_WORDS: Record<NotAppliedReason, string> = {
  interpretive: 'Not modelled: the simulation has no way to apply it, so it is read, not run.',
  unknown: 'Not applied: it is marked unknown, and an unknown is not treated as true.',
  excluded: 'Not applied: you left it out of the model.',
  dangling: 'Not applied: it names an actor or a scenario that is not in this comparison.',
  'soft-block': 'Not applied: a soft constraint is not run as a ban on the change.',
  'over-limit': `Not applied: a comparison applies at most ${MAX_APPLIED_CONSTRAINTS} effects, and this one came after them.`,
};

export const unappliedConstraintSchema = z.object({
  constraintId: idSchema,
  statement: line(400),
  category: z.string().min(1).max(40),
  hardness: z.enum(['hard', 'soft']),
  source: z.enum(CONSTRAINT_SOURCES),
  validation: z.enum(CONSTRAINT_VALIDATIONS),
  reason: z.enum(NOT_APPLIED_REASONS),
});
export type UnappliedConstraint = z.infer<typeof unappliedConstraintSchema>;

export const CONSTRAINT_IMPACT_CLASSES = ['material', 'negligible', 'inconclusive'] as const;
export type ConstraintImpactClass = (typeof CONSTRAINT_IMPACT_CLASSES)[number];

/**
 * What taking one constraint away did to a scenario on the same seeds: the mean paired difference of the
 * headline share (members ending in switch or resist, every actor counting equally) without the
 * constraint less with it. It is a result of the simulation, not of the world.
 */
export const constraintImpactSchema = z.object({
  constraintId: idSchema,
  variantId: idSchema,
  metric: line(200),
  seeds: z.int().min(1),
  withMean: z.number(),
  withoutShift: z.number(),
  standardError: z.number().min(0),
  classification: z.enum(CONSTRAINT_IMPACT_CLASSES),
});
export type ConstraintImpact = z.infer<typeof constraintImpactSchema>;

/**
 * What a comparison records about the constraints it was run under. `status` is the gate's word when it
 * started (a blocked gate refuses to start one), and a provisional comparison says so in `label`, so that
 * the review and the brief made from it can say the same.
 */
export const analysisConstraintsSchema = z.object({
  /** The revision of the constraint set it was made from. */
  revision: z.int().min(0),
  status: z.enum(['clear', 'provisional']),
  label: line(300),
  reasons: z.array(line(300)).max(12).default([]),
  applied: z.array(recordedConstraintSchema).max(MAX_APPLIED_CONSTRAINTS).default([]),
  notApplied: z.array(unappliedConstraintSchema).max(60).default([]),
  impacts: z.array(constraintImpactSchema).max(80).default([]),
});
export type AnalysisConstraints = z.infer<typeof analysisConstraintsSchema>;
