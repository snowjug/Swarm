import { z } from 'zod';

/**
 * What a statement in a report claims to be. A report mixes very different things; the label keeps
 * "the source says", "the simulation did", "the user assumed" and "the model guessed" apart.
 */
export const CLAIM_KINDS = [
  'source-fact',
  'extracted-claim',
  'user-assumption',
  'ai-hypothesis',
  'simulated-event',
  'analytical-conclusion',
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  'source-fact': 'Source fact',
  'extracted-claim': 'Extracted claim',
  'user-assumption': 'User assumption',
  'ai-hypothesis': 'AI hypothesis',
  'simulated-event': 'Simulated event',
  'analytical-conclusion': 'Analytical conclusion',
};

export const CLAIM_KIND_MEANINGS: Record<ClaimKind, string> = {
  'source-fact': 'Stated in the provided source text and quoted verbatim.',
  'extracted-claim': 'A paraphrase of what a provided source says.',
  'user-assumption': 'An input the user chose: a setting, an intervention or a seed post.',
  'ai-hypothesis': 'The model’s speculation. Not claimed to be supported by any source.',
  'simulated-event': 'Something that happened inside the simulation, not in the real world.',
  'analytical-conclusion': 'A figure or reading derived from the recorded simulation metrics.',
};

export const SUPPORT_VERDICTS = [
  'supported',
  'partial',
  'unsupported',
  'contradicted',
  'unchecked',
] as const;
export type SupportVerdict = (typeof SUPPORT_VERDICTS)[number];

export const SUPPORT_VERDICT_LABELS: Record<SupportVerdict, string> = {
  supported: 'Supported',
  partial: 'Partly supported',
  unsupported: 'Not supported',
  contradicted: 'Contradicted',
  unchecked: 'Not checkable',
};

/** The model-written statement before any verification. */
export const chapterClaimSchema = z.object({
  text: z.string().trim().min(10).max(400),
  kind: z.enum(CLAIM_KINDS),
  sourceIds: z.array(z.string()).max(3),
  memoryIds: z.array(z.string()).max(3),
  /** A verbatim excerpt of a cited source passage. Required for a source fact. */
  quote: z.string().trim().min(8).max(300).nullable(),
});
export type ChapterClaim = z.infer<typeof chapterClaimSchema>;

export interface ClaimChecks {
  /** A supplied quote was (not) found verbatim in a cited passage. null: no quote was supplied. */
  quote: 'found' | 'not-found' | null;
  /** Share of the claim's content words present in the cited material, 0..1. null: not applicable. */
  overlap: number | null;
  /** Whether every number in the claim appears in the cited material. null: the claim has none. */
  numbers: 'match' | 'mismatch' | null;
  /** An independent model judgement that had to point at real text. null: the model check did not run. */
  entailment: 'supports' | 'partial' | 'contradicts' | 'not-supported' | null;
}

export interface GroundedClaim {
  id: string;
  /** Title of the report chapter the statement appears in. */
  section: string;
  text: string;
  kind: ClaimKind;
  sourceIds: string[];
  memoryIds: string[];
  quote: string | null;
  verdict: SupportVerdict;
  checks: ClaimChecks;
  /** Why the verdict was reached. Written by the server from the checks, never copied from the model. */
  reason: string;
}

export interface GroundingReview {
  checkedAt: string;
  /** `deterministic+model` only when the independent model check really ran. */
  method: 'deterministic' | 'deterministic+model';
  claims: GroundedClaim[];
  counts: Record<SupportVerdict, number>;
  /**
   * Figures written in a chapter that appear neither in the cited material nor in the recorded
   * simulation. They may be invented statistics; nothing stands behind them.
   */
  unverifiedFigures: { section: string; figures: string[] }[];
  /** Plain statements about what was and was not checked, including any check that failed to run. */
  notes: string[];
}

export function emptyVerdictCounts(): Record<SupportVerdict, number> {
  return { supported: 0, partial: 0, unsupported: 0, contradicted: 0, unchecked: 0 };
}

const count = z.int().nonnegative();

/** Validates a stored review when a project is loaded. */
export const groundingReviewSchema: z.ZodType<GroundingReview> = z.object({
  checkedAt: z.string(),
  method: z.enum(['deterministic', 'deterministic+model']),
  claims: z.array(
    z.object({
      id: z.string(),
      section: z.string(),
      text: z.string(),
      kind: z.enum(CLAIM_KINDS),
      sourceIds: z.array(z.string()),
      memoryIds: z.array(z.string()),
      quote: z.string().nullable(),
      verdict: z.enum(SUPPORT_VERDICTS),
      checks: z.object({
        quote: z.enum(['found', 'not-found']).nullable(),
        overlap: z.number().min(0).max(1).nullable(),
        numbers: z.enum(['match', 'mismatch']).nullable(),
        entailment: z.enum(['supports', 'partial', 'contradicts', 'not-supported']).nullable(),
      }),
      reason: z.string(),
    }),
  ),
  counts: z.object({
    supported: count,
    partial: count,
    unsupported: count,
    contradicted: count,
    unchecked: count,
  }),
  unverifiedFigures: z.array(z.object({ section: z.string(), figures: z.array(z.string()) })),
  notes: z.array(z.string()),
});
