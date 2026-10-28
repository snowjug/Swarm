import { z } from 'zod';
import { chapterClaimSchema } from '../../../shared/grounding.js';
import { trimmedIds } from '../../../shared/citations.js';
import { ontologySchema } from '../../../shared/guided.js';
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

export const reportPlanSchema = z.object({
  title: z.string().trim().min(3).max(180),
  sections: z.array(z.string().trim().min(3).max(100)).min(3).max(5),
  evidenceQueries: z.array(z.string().trim().min(3).max(300)).min(1).max(3),
  interviewAgentIds: trimmedIds(z.string(), 2),
  interviewQuestion: z.string().trim().min(5).max(500),
});

export const summarySchema = z.object({
  summary: z.string().trim().min(50).max(2_000),
});

export const reportChapterSchema = z.object({
  body: z.string().trim().min(30).max(3_500),
  sourceIds: trimmedIds(z.string(), 5),
  memoryIds: trimmedIds(z.string(), 8),
  interviewIds: trimmedIds(z.string(), 2),
  /** The checkable statements this chapter rests on; each is verified after the chapter is written. */
  claims: z.array(chapterClaimSchema).min(1).max(6),
});

export const interviewSchema = z.object({
  answer: z.string().trim().min(10).max(2_500),
  sourceIds: trimmedIds(z.string(), 5),
  memoryIds: trimmedIds(z.string(), 8).default([]),
});

export { ontologySchema };
export type GuidedGraph = z.infer<typeof guidedGraphSchema>;
