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

// ---------------------------------------------------------------------------------------------
// Participants: the roles a decision involves
// ---------------------------------------------------------------------------------------------

/**
 * How a participant relates to the decision, in words that belong to no domain. The roles sit beside
 * the categories above, which are the lens the engine reads a party through: each role names the
 * categories it may take (the first is its default) and each category has a default role, so a
 * stakeholder saved before roles existed reads as one too. A role is not wanted in every scenario:
 * when nobody material is found for one it is named as a gap, never filled to make the list look whole.
 */
export const PARTICIPANT_ROLES = [
  'decision-owner',
  'directly-affected',
  'indirectly-affected',
  'implementers',
  'approvers',
  'beneficiaries',
  'opponents-resistors',
  'regulators-governance',
  'customers-users',
  'partners-suppliers',
  'competitors-alternatives',
  'system-environment',
  'observers-influencers',
  'missing-voices',
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  'decision-owner': 'Decision owner',
  'directly-affected': 'Directly affected',
  'indirectly-affected': 'Indirectly affected',
  implementers: 'Implementers',
  approvers: 'Approvers',
  beneficiaries: 'Beneficiaries',
  'opponents-resistors': 'Opponents and resistors',
  'regulators-governance': 'Regulators and governance',
  'customers-users': 'Customers and users',
  'partners-suppliers': 'Partners and suppliers',
  'competitors-alternatives': 'Competitors and alternatives',
  'system-environment': 'System and environment',
  'observers-influencers': 'Observers and influencers',
  'missing-voices': 'Missing voices',
};

export const PARTICIPANT_ROLE_MEANINGS: Record<ParticipantRole, string> = {
  'decision-owner': 'Decides whether and how the change goes ahead.',
  'directly-affected':
    'Feels the change in what they do, pay, risk or receive, without choosing it.',
  'indirectly-affected': 'Is reached by the change through someone else.',
  implementers: 'Carries the change out, or keeps things running while it happens.',
  approvers: 'Has to sign off before the change can go ahead.',
  beneficiaries: 'Stands to gain from the change.',
  'opponents-resistors': 'Has reason to oppose, slow or work around the change.',
  'regulators-governance': 'Sets, applies or audits the rules the change has to meet.',
  'customers-users': 'Uses, buys or relies on what the change alters.',
  'partners-suppliers': 'Supplies, resells or works alongside the party making the change.',
  'competitors-alternatives': 'Offers another option that others may turn to, and can respond.',
  'system-environment':
    'A condition or system, such as a market, a platform or a season, that acts on the others.',
  'observers-influencers': 'Does not decide or bear the change but shapes how others see it.',
  'missing-voices': 'Is reached by the change, has no say in it, and is easy to overlook.',
};

/** The categories a role may take, the first being what it starts as. */
export const ROLE_CATEGORIES: Readonly<Record<ParticipantRole, readonly StakeholderCategory[]>> = {
  'decision-owner': ['decision-maker'],
  'directly-affected': ['risk-bearer', 'cost-bearer', 'end-user', 'beneficiary'],
  'indirectly-affected': ['other', 'risk-bearer', 'cost-bearer', 'beneficiary', 'end-user'],
  implementers: ['operations', 'channel', 'partner'],
  approvers: ['governance', 'decision-maker', 'regulator'],
  beneficiaries: ['beneficiary', 'end-user'],
  'opponents-resistors': ['risk-bearer', 'cost-bearer', 'influencer', 'competitor', 'other'],
  'regulators-governance': ['regulator', 'governance'],
  'customers-users': ['end-user', 'cost-bearer', 'beneficiary', 'risk-bearer'],
  'partners-suppliers': ['partner', 'channel'],
  'competitors-alternatives': ['competitor', 'substitute'],
  'system-environment': ['other', 'channel', 'operations'],
  'observers-influencers': ['influencer', 'governance', 'other'],
  'missing-voices': ['other', ...STAKEHOLDER_CATEGORIES.filter((category) => category !== 'other')],
};

/** The role a stakeholder saved before roles existed reads as. */
export const CATEGORY_DEFAULT_ROLE: Readonly<Record<StakeholderCategory, ParticipantRole>> = {
  'decision-maker': 'decision-owner',
  'end-user': 'customers-users',
  'cost-bearer': 'directly-affected',
  'risk-bearer': 'directly-affected',
  beneficiary: 'beneficiaries',
  influencer: 'observers-influencers',
  competitor: 'competitors-alternatives',
  substitute: 'competitors-alternatives',
  partner: 'partners-suppliers',
  channel: 'partners-suppliers',
  regulator: 'regulators-governance',
  governance: 'regulators-governance',
  operations: 'implementers',
  other: 'indirectly-affected',
};

export const INFLUENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type InfluenceLevel = (typeof INFLUENCE_LEVELS)[number];
export const INFLUENCE_LABELS: Record<InfluenceLevel, string> = {
  low: 'Low influence',
  medium: 'Medium influence',
  high: 'High influence',
};

/** What a participant can do about the decision itself, which is not the same as how much others heed them. */
export const DECISION_AUTHORITIES = [
  'decides',
  'approves',
  'can-block',
  'advises',
  'none',
] as const;
export type DecisionAuthority = (typeof DECISION_AUTHORITIES)[number];
export const AUTHORITY_LABELS: Record<DecisionAuthority, string> = {
  decides: 'Decides',
  approves: 'Approves',
  'can-block': 'Can block',
  advises: 'Advises',
  none: 'No say in the decision',
};

/**
 * What a participant's place on the list rests on. Only `source-quote` is a claim about the sources,
 * and it needs a quotation; every other basis is an assumption and is shown as one.
 */
export const CONFIDENCE_BASES = [
  'source-quote',
  'scenario-statement',
  'category-pattern',
  'model-inference',
  'user-assertion',
] as const;
export type ConfidenceBasis = (typeof CONFIDENCE_BASES)[number];
export const CONFIDENCE_BASIS_LABELS: Record<ConfidenceBasis, string> = {
  'source-quote': 'Quoted from a source',
  'scenario-statement': 'Named in your question',
  'category-pattern': 'Role pattern',
  'model-inference': 'Model inference',
  'user-assertion': 'Your assertion',
};
export const CONFIDENCE_BASIS_MEANINGS: Record<ConfidenceBasis, string> = {
  'source-quote': 'A cited passage names this participant or says what it does.',
  'scenario-statement':
    'Your question or scenario names this participant; no passage was quoted for it.',
  'category-pattern':
    'Added because a change of this kind usually involves this role; nothing was quoted for it.',
  'model-inference':
    'A model inferred this participant from context; no passage was quoted for it.',
  'user-assertion': 'Added or changed by you.',
};

/**
 * Fields a participant never has, however it was made: they would identify a person or claim to know
 * one. A model reply that carries one is refused, and the instructions say so.
 */
export const PROHIBITED_PARTICIPANT_FIELDS = [
  'realName',
  'fullName',
  'firstName',
  'lastName',
  'email',
  'phone',
  'address',
  'age',
  'dateOfBirth',
  'gender',
  'sex',
  'ethnicity',
  'race',
  'religion',
  'nationality',
  'politicalParty',
  'health',
  'sexualOrientation',
  'photo',
  'socialMedia',
  'privateMotives',
  'privateBeliefs',
  'emotions',
  'personality',
  'biography',
] as const;

const actionLine = line(200).min(1);

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
  /**
   * What makes a stakeholder a participant in a decision. Every one of these is optional, so a set
   * saved before they existed still parses; `participantOf` reads a stakeholder with the defaults
   * filled in. Nothing here describes a real person: a participant is a role Swarm models.
   */
  participantRole: z.enum(PARTICIPANT_ROLES).optional(),
  /** What the role is trying to achieve, as a role and not as a person's private wish. */
  objective: line(300).optional(),
  incentives: z.array(actionLine).max(6).optional(),
  pressures: z.array(actionLine).max(6).optional(),
  constraints: z.array(actionLine).max(6).optional(),
  concerns: z.array(actionLine).max(6).optional(),
  influence: z.enum(INFLUENCE_LEVELS).optional(),
  decisionAuthority: z.enum(DECISION_AUTHORITIES).optional(),
  /** What the role is assumed to see and know when the change is decided and carried out. */
  informationAccess: z.array(actionLine).max(6).optional(),
  /** What the role could do: possibilities for the simulation to try, never predictions. */
  plausibleActions: z.array(actionLine).max(8).optional(),
  /** What must never be asserted about this participant. The server keeps the standing ones. */
  prohibitedClaims: z.array(actionLine).max(10).optional(),
  confidenceBasis: z.enum(CONFIDENCE_BASES).optional(),
  /** Always true: a participant is a synthetic role, never an identified person. */
  synthetic: z.literal(true).optional(),
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

/**
 * A stakeholder with every participant field present: what it was saved with, and for what an older
 * save lacks, the default for its role. The defaults say nothing about the sources, and a reader that
 * shows one says it is a default.
 */
export interface ParticipantView {
  role: ParticipantRole;
  objective: string;
  incentives: string[];
  pressures: string[];
  constraints: string[];
  concerns: string[];
  influence: InfluenceLevel;
  decisionAuthority: DecisionAuthority;
  informationAccess: string[];
  plausibleActions: string[];
  prohibitedClaims: string[];
  confidenceBasis: ConfidenceBasis;
  synthetic: true;
}

/** What a participant's place rests on when nothing says: what the stakeholder's own fields show. */
export function defaultConfidenceBasis(
  stakeholder: Pick<Stakeholder, 'origin' | 'evidence'>,
): ConfidenceBasis {
  if (stakeholder.evidence.length > 0) return 'source-quote';
  switch (stakeholder.origin) {
    case 'scenario':
      return 'scenario-statement';
    case 'model':
      return 'model-inference';
    case 'user':
      return 'user-assertion';
    case 'rules':
      return 'category-pattern';
  }
}

const AUTHORITY_BY_CATEGORY: Readonly<Record<StakeholderCategory, DecisionAuthority>> = {
  'decision-maker': 'decides',
  governance: 'approves',
  regulator: 'can-block',
  influencer: 'advises',
  'end-user': 'none',
  'cost-bearer': 'none',
  'risk-bearer': 'none',
  beneficiary: 'none',
  competitor: 'none',
  substitute: 'none',
  partner: 'none',
  channel: 'none',
  operations: 'none',
  other: 'none',
};

export function participantOf(stakeholder: Stakeholder): ParticipantView {
  const level: InfluenceLevel =
    stakeholder.priority === 'key'
      ? 'high'
      : stakeholder.priority === 'standard'
        ? 'medium'
        : 'low';
  return {
    role: stakeholder.participantRole ?? CATEGORY_DEFAULT_ROLE[stakeholder.category],
    objective: stakeholder.objective ?? '',
    incentives: stakeholder.incentives ?? [],
    pressures: stakeholder.pressures ?? [],
    constraints: stakeholder.constraints ?? [],
    concerns: stakeholder.concerns ?? [],
    influence: stakeholder.influence ?? level,
    decisionAuthority: stakeholder.decisionAuthority ?? AUTHORITY_BY_CATEGORY[stakeholder.category],
    informationAccess: stakeholder.informationAccess ?? [],
    plausibleActions: stakeholder.plausibleActions ?? [],
    prohibitedClaims: stakeholder.prohibitedClaims ?? [],
    confidenceBasis: stakeholder.confidenceBasis ?? defaultConfidenceBasis(stakeholder),
    synthetic: true,
  };
}

/**
 * How a proposal was made, kept with the set so that a person can see it later. It holds no model
 * words: `failure` is a class of failure with fixed text, and the rest are counts, ids and labels.
 */
export const PROPOSAL_VERSION = 1;
export const proposalInfoSchema = z.object({
  version: z.literal(PROPOSAL_VERSION),
  generatedAt: z.iso.datetime(),
  /** `model` only when a model's reply passed every check; `rules` when none was asked or its reply was not used. */
  source: z.enum(['rules', 'model']),
  model: line(120).nullable().default(null),
  /** Set when a model was asked and rules answered instead. */
  failure: z
    .object({ code: line(60), detail: line(300) })
    .nullable()
    .default(null),
  /** How many passages were shown, of how many the project has. */
  evidence: z.object({ shown: z.int().min(0), of: z.int().min(0) }),
  /** Passages that carry text addressed to an AI system: it was ignored and is flagged. */
  flaggedPassages: z.array(z.string().min(1).max(40)).max(20).default([]),
  /** Whether research sources and known constraints were part of what the proposal was made from. */
  usedResearch: z.boolean().default(false),
  usedConstraints: z.boolean().default(false),
  /** How many participants were folded into another because they were certainly the same one. */
  merged: z.int().min(0).default(0),
  /** Participants that were left out, and why, so that nothing disappears without a trace. */
  dropped: z
    .array(z.object({ name: line(120), reason: line(200) }))
    .max(30)
    .default([]),
  /** Roles nobody material was found for, with why each might matter here. */
  missingVoices: z
    .array(z.object({ role: z.enum(PARTICIPANT_ROLES), reason: line(300) }))
    .max(14)
    .default([]),
  /** Plain notices about how the proposal was checked and changed. */
  notes: z.array(line(300)).max(12).default([]),
});
export type ProposalInfo = z.infer<typeof proposalInfoSchema>;

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
  /** Present when the set was made by the participant proposal, which is what holds it to the full checks. */
  proposal: proposalInfoSchema.optional(),
});
export type StakeholderSet = z.infer<typeof stakeholderSetSchema>;

// ---------------------------------------------------------------------------------------------
// What a model is asked for: ProposedParticipants v1
// ---------------------------------------------------------------------------------------------

export const PROPOSED_PARTICIPANTS_VERSION = 1;
export const MAX_PROPOSED_PARTICIPANTS = 30;
/** The most participants a proposal keeps; a longer list is cut, least important first, and says so. */
export const MAX_PROPOSED_LIVE = 25;
/** The most that become individual actors. */
export const MAX_PROPOSED_KEY = 8;

const proposedEvidenceSchema = z.strictObject({
  passageId: z.string().trim().min(1).max(40),
  quote: line(600).min(1),
});

/** One participant as a model proposes it: strict, so that a field it was not asked for is refused. */
export const proposedParticipantSchema = z.strictObject({
  id: idSchema,
  /** A concise, specific role for this scenario: never "staff", "users" or "team" alone. */
  name: line(120).min(3),
  role: z.enum(PARTICIPANT_ROLES),
  /** Left out, the first category of the role is used. */
  category: z.enum(STAKEHOLDER_CATEGORIES).optional(),
  whyTheyMatter: line(600).min(8),
  description: line(600).default(''),
  objective: line(300).min(3),
  incentives: z.array(line(200).min(3)).max(6).default([]),
  pressures: z.array(line(200).min(3)).max(6).default([]),
  constraints: z.array(line(200).min(3)).max(6).default([]),
  concerns: z.array(line(200).min(3)).max(6).default([]),
  influence: z.enum(INFLUENCE_LEVELS),
  decisionAuthority: z.enum(DECISION_AUTHORITIES),
  directness: z.enum(['direct', 'indirect']),
  impact: z.strictObject({
    direction: z.enum(['harmed', 'benefited', 'mixed', 'unclear']),
    rationale: line(400).default(''),
  }),
  informationAccess: z.array(line(200).min(3)).max(6).default([]),
  plausibleActions: z.array(line(200).min(3)).min(1).max(6),
  prohibitedClaims: z.array(line(200).min(3)).max(8).default([]),
  evidence: z.array(proposedEvidenceSchema).max(6).default([]),
  assumptions: z.array(line(300).min(3)).max(8).default([]),
  uncertainty: z.strictObject({ level: z.enum(UNCERTAINTY_LEVELS), reason: line(300).min(3) }),
  confidenceBasis: z.enum(CONFIDENCE_BASES),
  priority: z.enum(['key', 'standard', 'background']).default('standard'),
  /** A modelling weight for a group, never a count of real people. */
  populationSize: z.int().min(1).max(1_000_000).optional(),
  synthetic: z.literal(true),
});
export type ProposedParticipant = z.infer<typeof proposedParticipantSchema>;

export const proposedParticipantsSchema = z.strictObject({
  version: z.literal(PROPOSED_PARTICIPANTS_VERSION),
  participants: z.array(proposedParticipantSchema).min(1).max(MAX_PROPOSED_PARTICIPANTS),
  relations: z
    .array(
      z.strictObject({
        from: idSchema,
        to: idSchema,
        type: z.enum(RELATION_TYPES),
        strength: z.number().min(0).max(1),
        rationale: line(300).default(''),
      }),
    )
    .max(120)
    .default([]),
  /** Roles nobody was found for that may matter here. */
  gaps: z
    .array(z.strictObject({ role: z.enum(PARTICIPANT_ROLES), reason: line(300).min(3) }))
    .max(14)
    .default([]),
});
export type ProposedParticipants = z.infer<typeof proposedParticipantsSchema>;

// ---------------------------------------------------------------------------------------------
// The review of a proposal
// ---------------------------------------------------------------------------------------------

export type IssueSeverity = 'blocking' | 'advisory';

/** What a person can do about an issue, so that a screen can offer it beside the message. */
export type IssueFix = 'rename' | 'edit' | 'remove' | 'merge' | 'add-missing' | 'regenerate';

export interface ParticipantIssue {
  /** `code:participantId`, stable between reads so that a screen can keep its place. */
  id: string;
  code: string;
  severity: IssueSeverity;
  participantId: string | null;
  /** Other participants the issue is about, such as the one this looks like a duplicate of. */
  relatedIds: string[];
  /** The role the issue is about, for an issue that says nobody holds one. */
  role: ParticipantRole | null;
  message: string;
  /** What to do about it, in a sentence. */
  fix: string;
  fixAction: IssueFix | null;
}

export interface RoleCoverage {
  role: ParticipantRole;
  /** Live participants with this role. */
  count: number;
  /** `missing` when nobody holds a role that looks material here, and `optional` when nobody does and nothing says it matters. */
  status: 'covered' | 'missing' | 'optional';
  reason: string | null;
}

/**
 * The result of checking a set of participants. It is made from the set and the project's passages
 * and never stored, so it cannot be out of date. `valid` is true only when no blocking issue remains,
 * and approving the set is refused until it is.
 */
export interface ParticipantReview {
  valid: boolean;
  /** `strict` for a set the proposal made; `legacy` for one found before it existed, which keeps its old checks. */
  profile: 'strict' | 'legacy';
  /** "Swarm proposes these participants because…", composed from the participants' own fields. */
  summary: string;
  counts: {
    participants: number;
    key: number;
    sourced: number;
    assumed: number;
    proposed: number;
    removed: number;
    blocking: number;
    advisory: number;
  };
  coverage: RoleCoverage[];
  issues: ParticipantIssue[];
}

/** `GET /api/projects/:id/stakeholders/validation`. */
export interface ParticipantValidationView {
  revision: number | null;
  review: ParticipantReview | null;
}

/** `GET /api/projects/:id/stakeholders/:participantId/why`: only what the participant already holds. */
export interface ParticipantWhy {
  id: string;
  name: string;
  roleLabel: string;
  headline: string;
  because: string[];
  evidence: { passageId: string; documentName: string; quote: string }[];
  basis: { kind: ConfidenceBasis; label: string; explanation: string };
  assumptions: string[];
  uncertainty: Uncertainty;
  /** What this does not say, so that nothing here is read as a finding about a person. */
  limits: string[];
}

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

/**
 * What the sign of an impact rests on, when that is not what its size rests on. A passage can show
 * which way a change points for a group, but none gives a number, so the size of an impact is the
 * system's default for its direction unless a person or a model set the number itself. An absent
 * direction means the sign rests on whatever the trait's own `origin` says.
 */
export const impactDirectionSchema = z.object({
  origin: z.enum(TRAIT_ORIGINS),
  /** For `evidence`: the passages the direction was read from, as they were cited when the actors were made. */
  passageIds: z.array(z.string().min(1).max(40)).max(8).default([]),
});
export type ImpactDirection = z.infer<typeof impactDirectionSchema>;

/** Said beside an impact whose direction is read from cited passages: the sign is theirs, the size is not. */
export const sizeIsDefault = (value: number): string =>
  `the size, ${value > 0 ? '+' : ''}${value.toFixed(2)}, is a system default, not read from any passage`;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * An impact saved while `evidence` labelled the whole number. Only its direction was ever read from
 * passages and its size was always the default for that direction, so it reads as that now.
 */
export const impactTraitSchema = signedTraitSchema
  .extend({ direction: impactDirectionSchema.optional() })
  .transform((trait) =>
    trait.origin === 'evidence'
      ? {
          ...trait,
          origin: 'system-assumption' as const,
          direction: trait.direction ?? { origin: 'evidence' as const, passageIds: [] },
          rationale: clip(
            `The direction rests on cited passages; ${sizeIsDefault(trait.value)}. ${trait.rationale}`.trim(),
            300,
          ),
        }
      : trait,
  );
export type ImpactTrait = z.output<typeof impactTraitSchema>;

/** What the sign of an actor's impact rests on, which is its own origin unless it says otherwise. */
export const directionOrigin = (trait: Pick<ImpactTrait, 'origin' | 'direction'>): TraitOrigin =>
  trait.direction?.origin ?? trait.origin;

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
    impact: impactTraitSchema,
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
  /** Where the actor's stakeholder stands in the decision, when it was proposed as a participant. */
  participantRole: z.enum(PARTICIPANT_ROLES).optional(),
  /** What the actor could do, as possibilities to try and never as predictions. */
  plausibleActions: z.array(actionLine).max(8).optional(),
  /** What must never be asserted about the actor. Persona text and results keep to it. */
  prohibitedClaims: z.array(actionLine).max(10).optional(),
  /** Always true: an actor is a synthetic role, never an identified person. */
  synthetic: z.literal(true).optional(),
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
  /** The check of the participants, made when the view was read. Absent from a view made before it existed. */
  review?: ParticipantReview | null;
}

/** `GET /api/projects/:id/actors`. `stale` means the stakeholders changed after these actors were made. */
export interface ActorsView {
  actors: ActorSet | null;
  revision: number | null;
  stale: boolean;
  model: ModelAvailability;
  may: { edit: boolean; run: boolean };
}
