import { z } from 'zod';
import { evidenceRefSchema, idSchema } from './stakeholders.js';

/**
 * Independent challenge of the analysis. Each critic looks at the work from one angle and never
 * edits it: what it finds is shown next to the finding, with any response and what still stands.
 */
export const CRITIC_ROLES = [
  'evidence',
  'assumption',
  'methodology',
  'stakeholder-coverage',
  'bias',
  'recommendation',
  'adversarial',
] as const;
export type CriticRole = (typeof CRITIC_ROLES)[number];

export const CRITIC_ROLE_LABELS: Record<CriticRole, string> = {
  evidence: 'Evidence critic',
  assumption: 'Assumption critic',
  methodology: 'Methodology critic',
  'stakeholder-coverage': 'Stakeholder-coverage critic',
  bias: 'Bias critic',
  recommendation: 'Recommendation critic',
  adversarial: 'Adversarial reviewer',
};

export const CRITIC_ROLE_QUESTIONS: Record<CriticRole, string> = {
  evidence: 'Is each important statement backed by the sources, and are the sources good enough?',
  assumption: 'Which assumptions carry the result, and does anything support them?',
  methodology: 'Are there enough repeated runs, and does the fidelity justify the wording?',
  'stakeholder-coverage': 'Who is missing, and who was assumed rather than found?',
  bias: 'Does the wording or the evidence lean one way without saying so?',
  recommendation: 'Does each recommendation follow from a finding and say how to check it?',
  adversarial: 'What would have to be true for the conclusion to be wrong?',
};

export const CRITIQUE_SEVERITIES = ['note', 'minor', 'major', 'blocking'] as const;
export type CritiqueSeverity = (typeof CRITIQUE_SEVERITIES)[number];

export const CRITIQUE_STATUSES = ['open', 'responded', 'accepted', 'disputed'] as const;
export type CritiqueStatus = (typeof CRITIQUE_STATUSES)[number];

const line = (max: number) => z.string().trim().max(max);

export const critiqueSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(CRITIC_ROLES),
  target: z.object({
    kind: z.enum([
      'finding',
      'statement',
      'stakeholder',
      'assumption',
      'recommendation',
      'analysis',
      'brief',
    ]),
    id: z.string().max(80),
  }),
  severity: z.enum(CRITIQUE_SEVERITIES),
  objection: line(800).min(1),
  /** The facts the objection rests on, one short line each, so that it can be checked. */
  basis: z.array(line(200)).max(6).default([]),
  evidence: z.array(evidenceRefSchema).max(5).default([]),
  /** `rules` checks are deterministic; `model` critiques are validated but are a model's reading. */
  origin: z.enum(['rules', 'model']),
  status: z.enum(CRITIQUE_STATUSES).default('open'),
  response: z
    .object({
      text: line(800).min(1),
      by: z.enum(['analysis', 'user']),
      at: z.iso.datetime(),
    })
    .nullable()
    .default(null),
  /** What is still disputed once the response is read. Null until there is a response. */
  remainingDisagreement: line(600).nullable().default(null),
  /** What the objection does to the conclusion if it stands. */
  impactOnConclusion: line(500).default(''),
  createdAt: z.iso.datetime(),
});
export type Critique = z.infer<typeof critiqueSchema>;

/** The artifact `critiques`: every critique of one analysis. */
export const critiqueSetSchema = z.object({
  analysisId: idSchema.nullable(),
  generatedAt: z.iso.datetime(),
  mode: z.enum(['rules', 'model', 'both']),
  critiques: z.array(critiqueSchema).max(120),
  /** What a person should know about how this set was made: a model review that failed, an input that was missing. */
  notes: z.array(line(400)).max(10).optional(),
});
export type CritiqueSet = z.infer<typeof critiqueSetSchema>;

/** What a person can say to a critique. `accepted` means the objection stands and its impact applies. */
export const CRITIQUE_RESPONSE_STATUSES = ['responded', 'accepted', 'disputed'] as const;
export type CritiqueResponseStatus = (typeof CRITIQUE_RESPONSE_STATUSES)[number];

export const critiqueResponseInputSchema = z
  .object({
    text: line(800).min(1),
    status: z.enum(CRITIQUE_RESPONSE_STATUSES),
    remainingDisagreement: line(600).nullable().optional(),
  })
  .strict();
export type CritiqueResponseInput = z.input<typeof critiqueResponseInputSchema>;
export type CritiqueResponseBody = z.output<typeof critiqueResponseInputSchema>;

/** Without `analysisId` the newest finished analysis is reviewed. */
export const runCritiquesInputSchema = z
  .object({
    analysisId: idSchema.optional(),
    useModel: z.boolean().default(false),
  })
  .strict();
export type RunCritiquesInput = z.input<typeof runCritiquesInputSchema>;
export type RunCritiquesBody = z.output<typeof runCritiquesInputSchema>;

/** What the page needs to show the independent review and to know what the caller may do with it. */
export interface CritiquesView {
  critiques: CritiqueSet | null;
  /** The newest finished analysis, so that a review of an older one can be called out of date. */
  analysis: { id: string; completedAt: string | null } | null;
  may: { run: boolean; respond: boolean };
  model: { available: boolean };
}
