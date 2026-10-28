import { z } from 'zod';
import { chapterClaimSchema } from '../../../shared/grounding.js';
import { trimmedIds } from '../../../shared/citations.js';
import { ontologySchema } from '../../../shared/guided.js';
import { MAX_REVIEWED_CLAIMS } from '../grounding/normalize.js';
import { extractedGraphSchema } from '../models/schemas.js';

export const guidedGraphSchema = extractedGraphSchema.extend({
  nodes: z
    .array(
      extractedGraphSchema.shape.nodes.element.extend({
        entityType: z.string().min(2).max(60),
      }),
    )
    .min(2)
    .max(16),
});

export const generatedEnvironmentSchema = z.object({
  minutesPerRound: z.int().min(5).max(180),
  initialPosts: z
    .array(
      z.object({
        text: z.string().trim().min(10).max(500),
        platform: z.enum(['plaza', 'community', 'both']),
        stance: z.number().min(-1).max(1),
        strength: z.number().min(0).max(1),
        sourceIds: trimmedIds(z.string(), 5),
      }),
    )
    .min(1)
    .max(4),
});

/**
 * Swarm explores possible scenarios and does not predict the future. A live model titled a chapter
 * "Predicted Future Trends", which says the opposite on the page a reader opens first, so a title
 * that claims a prediction or a forecast is sent back for a correction.
 */
const PREDICTION_WORDING = /\b(?:predict\w*|forecast\w*)\b/iu;
const honestTitle = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max)
    .refine(
      (text) => !PREDICTION_WORDING.test(text),
      'must not use the words predict, prediction or forecast: this report explores possible scenarios and does not predict the future',
    );

export const reportPlanSchema = z.object({
  title: honestTitle(180),
  sections: z.array(honestTitle(100)).min(3).max(5),
  evidenceQueries: z.array(z.string().trim().min(3).max(300)).min(1).max(3),
  interviewAgentIds: trimmedIds(z.string(), 2),
  interviewQuestion: z.string().trim().min(5).max(500),
});

export const summarySchema = z.object({
  summary: z.string().trim().min(50).max(2_000),
});

/** What the chapter prompt asks for; the schema allows some room above it (see `MAX_CHAPTER_BODY`). */
export const TARGET_CHAPTER_BODY = 3_500;
/**
 * A model cannot count characters, and in live runs about one chapter in five came back a little over
 * the stated length. Rejecting the whole chapter for that cost a corrective retry every time. The text
 * is never cut: the schema simply accepts the overshoot, within a bound that keeps a report small.
 */
export const MAX_CHAPTER_BODY = 5_000;

export const reportChapterSchema = z.object({
  body: z.string().trim().min(30).max(MAX_CHAPTER_BODY),
  // A list the model leaves out is a list with nothing in it.
  sourceIds: trimmedIds(z.string(), 5).default([]),
  memoryIds: trimmedIds(z.string(), 8).default([]),
  interviewIds: trimmedIds(z.string(), 2).default([]),
  /**
   * The checkable statements this chapter rests on; each is verified after the chapter is written.
   * A model that lists a few too many is cut to the limit by `normalizeClaims` (and the review says
   * so) instead of failing the chapter; far more than that is still rejected.
   */
  claims: z
    .array(chapterClaimSchema)
    .min(1)
    .max(MAX_REVIEWED_CLAIMS * 2),
});

export const interviewSchema = z.object({
  answer: z.string().trim().min(10).max(2_500),
  sourceIds: trimmedIds(z.string(), 5),
  memoryIds: trimmedIds(z.string(), 8).default([]),
});

export { ontologySchema };
export type GuidedGraph = z.infer<typeof guidedGraphSchema>;
