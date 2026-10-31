import { z } from 'zod';
import type { EvidenceRef } from './evidence.js';

/**
 * A lens for asking "who else?", not a list of answers. Discovery proposes stakeholders from the
 * scenario and the evidence; the categories name how a stakeholder relates to the proposed change, and
 * the coverage critic uses them to point at kinds of stakeholder that nobody was found for.
 */
export const STAKEHOLDER_CATEGORIES = [
  'decision-maker',
  'end-user',
  'cost-bearer',
  'risk-bearer',
  'beneficiary',
  'influencer',
  'competitor',
  'substitute',
  'partner',
  'channel',
  'regulator',
  'governance',
  'operations',
  'other',
] as const;
export type StakeholderCategory = (typeof STAKEHOLDER_CATEGORIES)[number];

export const STAKEHOLDER_CATEGORY_LABELS: Record<StakeholderCategory, string> = {
  'decision-maker': 'Decision maker',
  'end-user': 'End user',
  'cost-bearer': 'Bears cost',
  'risk-bearer': 'Bears risk',
  beneficiary: 'Beneficiary',
  influencer: 'Influencer',
  competitor: 'Competitor',
  substitute: 'Substitute',
  partner: 'Partner',
  channel: 'Channel',
  regulator: 'Regulator',
  governance: 'Governance',
  operations: 'Operations',
  other: 'Other',
};

/** Categories whose members react to what other stakeholders do rather than to the change itself. */
export const EXTERNAL_RESPONDER_CATEGORIES: readonly StakeholderCategory[] = [
  'competitor',
  'substitute',
  'partner',
  'regulator',
];

export const RELATION_TYPES = [
  'influences',
  'competes-with',
  'substitutes-for',
  'regulates',
  'supplies',
  'depends-on',
  'partners-with',
  'buys-from',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

const line = (max: number) => z.string().trim().max(max);
export const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/u, 'Use lower-case letters, digits and hyphens.');

/** The same shape as `EvidenceRef` in evidence.ts, so a stakeholder cites the passages the ledger does. */
export const evidenceRefSchema: z.ZodType<EvidenceRef> = z.object({
  passageId: z.string().min(1).max(40),
  documentId: z.string().min(1).max(80),
  documentName: z.string().min(1).max(200),
  start: z.int().min(0),
  end: z.int().min(0),
  quote: z.string().max(600).nullable(),
  contentHash: z.string().min(1).max(100),
  role: z.enum(['supports', 'contradicts']),
  conflictId: z.string().max(80).optional(),
});

/**
 * Where a number or a judgement came from: a passage of the evidence, a person, an assumption Swarm
 * made from the category, or a model's reading. It is shown beside every actor trait.
 */
export const TRAIT_ORIGINS = ['evidence', 'user', 'system-assumption', 'model'] as const;
export type TraitOrigin = (typeof TRAIT_ORIGINS)[number];

export const UNCERTAINTY_LEVELS = ['low', 'medium', 'high'] as const;
export type UncertaintyLevel = (typeof UNCERTAINTY_LEVELS)[number];
export const uncertaintySchema = z.object({
  level: z.enum(UNCERTAINTY_LEVELS),
  reason: line(300),
});
export type Uncertainty = z.infer<typeof uncertaintySchema>;

export const stakeholderSchema = z.object({
  id: idSchema,
  name: line(120).min(1),
  category: z.enum(STAKEHOLDER_CATEGORIES),
  description: line(600).default(''),
  /** Why this stakeholder matters for this scenario. */
  relevance: line(600).default(''),
  directness: z.enum(['direct', 'indirect']),
  /** `key` stakeholders become individual actors; the rest become cohorts. A person can change it. */
  priority: z.enum(['key', 'standard', 'background']),
  /**
   * The size of the population this stakeholder stands for in the model. It is an assumption used to
   * weight a cohort, never a measured count, and it is shown as such.
   */
  populationSize: z.int().min(1).max(1_000_000).default(1),
  /** How the change is expected to land on them, in words. Actors turn it into a number a person can edit. */
  expectedImpact: z
    .object({
      direction: z.enum(['harmed', 'benefited', 'mixed', 'unclear']),
      rationale: line(400).default(''),
      /** Who set the direction. Absent means a category default, which is a system assumption. */
      origin: z.enum(TRAIT_ORIGINS).optional(),
    })
    .default({ direction: 'unclear', rationale: '' }),
  evidence: z.array(evidenceRefSchema).max(8).default([]),
  assumptions: z.array(line(300)).max(8).default([]),
  uncertainty: uncertaintySchema,
  origin: z.enum(['rules', 'model', 'user', 'scenario']),
  /** Where the person's review has got to. `removed` stays in the set so the review is auditable. */
  status: z.enum(['proposed', 'accepted', 'edited', 'added', 'removed']).default('proposed'),
  mergedFrom: z.array(idSchema).max(10).default([]),
});
export type Stakeholder = z.infer<typeof stakeholderSchema>;

export const stakeholderRelationSchema = z.object({
  from: idSchema,
  to: idSchema,
  type: z.enum(RELATION_TYPES),
  strength: z.number().min(0).max(1),
  rationale: line(300).default(''),
});
export type StakeholderRelation = z.infer<typeof stakeholderRelationSchema>;

/** The artifact `stakeholders`: what was discovered, and what the person decided about it. */
export const stakeholderSetSchema = z.object({
  stakeholders: z.array(stakeholderSchema).max(40),
  relations: z.array(stakeholderRelationSchema).max(160).default([]),
  discovery: z.object({
    mode: z.enum(['rules', 'model', 'user']),
    model: line(120).nullable().default(null),
    generatedAt: z.iso.datetime(),
    /** What discovery could and could not do, in a sentence a person can read. */
    note: line(500).default(''),
  }),
  /**
   * Kinds of stakeholder, or named roles, that nothing was found for: a category id such as
   * `regulator` when no stakeholder of that category was found, or a few words naming a role.
   */
  gaps: z.array(line(300)).max(20).default([]),
  /** Set when the person approved the set; actors are generated only from an approved set. */
  approvedAt: z.iso.datetime().nullable().default(null),
});
export type StakeholderSet = z.infer<typeof stakeholderSetSchema>;

// ---------------------------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------------------------

/** One number the engine uses, with where it came from, so that no trait is an unexplained input. */
export const traitSchema = z.object({
  value: z.number().min(0).max(1),
  /** How far members of a cohort differ from `value`; ignored for a single actor. */
  spread: z.number().min(0).max(0.5).default(0.1),
  origin: z.enum(TRAIT_ORIGINS),
  rationale: line(300).default(''),
});
export type Trait = z.infer<typeof traitSchema>;

/** Stance and impact run from -1 to 1, so they have their own bounds. */
export const signedTraitSchema = traitSchema.extend({ value: z.number().min(-1).max(1) });
export type SignedTrait = z.infer<typeof signedTraitSchema>;

/** The traits that are on a 0 to 1 scale. `priorStance` and `impact` are signed and listed apart. */
export const UNSIGNED_TRAIT_KEYS = [
  'influence',
  'openness',
  'sensitivity',
  'riskTolerance',
  'switchingCost',
  'trust',
  'adoptionTendency',
  'authority',
  'reactivity',
] as const;
export type UnsignedTraitKey = (typeof UNSIGNED_TRAIT_KEYS)[number];
export const SIGNED_TRAIT_KEYS = ['priorStance', 'impact'] as const;
export type SignedTraitKey = (typeof SIGNED_TRAIT_KEYS)[number];
export type TraitKey = UnsignedTraitKey | SignedTraitKey;
export const TRAIT_KEYS: readonly TraitKey[] = [...SIGNED_TRAIT_KEYS, ...UNSIGNED_TRAIT_KEYS];

export const TRAIT_MEANINGS: Record<TraitKey, string> = {
  priorStance: 'Where they stand before the change: -1 against, 0 undecided, 1 in favour.',
  impact: 'How the change lands on them: -1 harms, 0 neither, 1 benefits.',
  influence: 'How much others weigh what they do.',
  openness: 'How readily they move toward what others do.',
  sensitivity: 'How strongly they respond to the change.',
  riskTolerance: 'How much uncertainty or loss they will accept.',
  switchingCost: 'How costly it is for them to change supplier, tool or habit.',
  trust: 'How far they trust the party making the change.',
  adoptionTendency: 'Their general readiness to take up something new.',
  authority: 'Their power to decide or act on their own.',
  reactivity: 'How quickly they respond to what others do.',
};

export const actorSchema = z.object({
  id: idSchema,
  stakeholderId: idSchema,
  name: line(120).min(1),
  /** `key` is one actor; `cohort` stands for a modelled group of many. */
  kind: z.enum(['key', 'cohort']),
  category: z.enum(STAKEHOLDER_CATEGORIES),
  /** The population this actor represents in the model. It is an assumption, not a measurement. */
  size: z.int().min(1).max(1_000_000).default(1),
  /** How many members a cohort simulates. This is the cost, and the diversity, of the cohort. */
  sampleSize: z.int().min(1).max(200).default(1),
  role: line(200).default(''),
  segment: line(200).nullable().default(null),
  objectives: z.array(line(200)).max(6).default([]),
  incentives: z.array(line(200)).max(6).default([]),
  concerns: z.array(line(200)).max(6).default([]),
  constraints: z.array(line(200)).max(6).default([]),
  resources: z.array(line(200)).max(6).default([]),
  information: z.array(line(200)).max(6).default([]),
  dependencies: z.array(line(200)).max(6).default([]),
  channels: z.array(line(120)).max(6).default([]),
  priorBelief: line(300).default(''),
  traits: z.object({
    priorStance: signedTraitSchema,
    impact: signedTraitSchema,
    influence: traitSchema,
    openness: traitSchema,
    sensitivity: traitSchema,
    riskTolerance: traitSchema,
    switchingCost: traitSchema,
    trust: traitSchema,
    adoptionTendency: traitSchema,
    authority: traitSchema,
    reactivity: traitSchema,
  }),
  uncertainty: uncertaintySchema,
  evidence: z.array(evidenceRefSchema).max(8).default([]),
  /** True once a person has changed anything about this actor. */
  edited: z.boolean().default(false),
});
export type Actor = z.infer<typeof actorSchema>;

export const actorRelationSchema = z.object({
  from: idSchema,
  to: idSchema,
  type: z.enum(RELATION_TYPES),
  strength: z.number().min(0).max(1),
});
export type ActorRelation = z.infer<typeof actorRelationSchema>;

/** The artifact `actors`: the cast the engine runs, derived from an approved stakeholder set. */
export const actorSetSchema = z.object({
  actors: z.array(actorSchema).min(1).max(60),
  relations: z.array(actorRelationSchema).max(240).default([]),
  generatedAt: z.iso.datetime(),
  mode: z.enum(['rules', 'model', 'user']),
  /** The revision of the stakeholder set these were made from. */
  stakeholderRevision: z.int().min(1),
  /** What generation could and could not do, in a sentence a person can read. */
  note: line(500).default(''),
});
export type ActorSet = z.infer<typeof actorSetSchema>;

// ---------------------------------------------------------------------------------------------
// What the routes answer
// ---------------------------------------------------------------------------------------------

/** Whether a model can be used for this project's discovery, and if not, why, in plain words. */
export interface ModelAvailability {
  available: boolean;
  reason: string | null;
}

/** `GET /api/projects/:id/stakeholders`. `stakeholders` is null for a project that has none yet. */
export interface StakeholdersView {
  stakeholders: StakeholderSet | null;
  revision: number | null;
  model: ModelAvailability;
  may: { edit: boolean; run: boolean };
}

/** `GET /api/projects/:id/actors`. `stale` means the stakeholders changed after these actors were made. */
export interface ActorsView {
  actors: ActorSet | null;
  revision: number | null;
  stale: boolean;
  model: ModelAvailability;
  may: { edit: boolean; run: boolean };
}
