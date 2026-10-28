import { z } from 'zod';
import { trimmedIds } from '../../../shared/citations.js';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/u);
const passageId = z.string().regex(/^S[1-9]\d*$/u);
const citations = trimmedIds(passageId, 5);
const requiredCitations = trimmedIds(passageId, 5, { min: 1 });
const opinion = z.number().min(-1).max(1);

/**
 * The longest source excerpt a graph node keeps. A model cannot count characters, so an over-long
 * excerpt is cut to this length instead of failing the whole graph (each retry re-requests every
 * node and takes tens of seconds). Cutting is safe: a prefix of a verbatim excerpt is still
 * verbatim, and `validateNodeQuotes` still requires it to appear in a passage the node cites.
 */
export const MAX_NODE_QUOTE_LENGTH = 240;

export const extractedGraphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: identifier,
        label: z.string().trim().min(2).max(80),
        kind: z.enum(['topic', 'person', 'organization', 'group']),
        summary: z.string().trim().min(10).max(600),
        weight: z.number().min(0.1).max(1),
        sourceIds: requiredCitations,
        /** An exact excerpt of a cited passage that shows the source describes this node. */
        quote: z
          .string()
          .trim()
          .min(12)
          .transform((quote) => quote.slice(0, MAX_NODE_QUOTE_LENGTH).trim()),
      }),
    )
    .min(2)
    .max(16),
  edges: z
    .array(
      z.object({
        source: identifier,
        target: identifier,
        label: z.string().trim().min(2).max(80),
        weight: z.number().min(0).max(1),
        sourceIds: requiredCitations,
      }),
    )
    .max(40),
});

const shortLine = z.string().trim().min(3).max(200);

export const personasSchema = z.object({
  agents: z
    .array(
      z.object({
        id: z.string().regex(/^agent-[1-9]\d?$/u),
        name: z.string().trim().min(3).max(70),
        role: z.string().trim().min(3).max(80),
        persona: z.string().trim().min(30).max(500),
        goals: z.array(shortLine).min(1).max(3).optional(),
        constraints: z.array(shortLine).min(1).max(3).optional(),
        topicIds: z.array(identifier).min(1).max(3),
        initialOpinion: opinion,
        influence: z.number().min(0.1).max(2),
        openness: z.number().min(0).max(1),
        sourceIds: requiredCitations,
      }),
    )
    .min(4)
    .max(10),
});

/** One actor's decision for one round, produced from that actor's own bounded view only. */
export const actorDecisionSchema = z.object({
  opinion,
  type: z.enum(['post', 'reply', 'observe']),
  content: z.string().trim().min(1).max(600),
  peerIds: trimmedIds(z.string(), 5),
  sourceIds: citations,
  rationale: z.string().trim().min(5).max(240),
  confidence: z.number().min(0).max(1),
});
export type ActorDecision = z.infer<typeof actorDecisionSchema>;

export const generatedReportSchema = z.object({
  title: z.string().trim().min(3).max(180),
  executiveSummary: z.string().trim().min(50).max(2_000),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(100),
        body: z.string().trim().min(30).max(3_500),
        sourceIds: citations,
      }),
    )
    .min(3)
    .max(6),
  limitations: z.array(z.string().trim().min(10).max(500)).min(1).max(6),
});

export type ExtractedGraph = z.infer<typeof extractedGraphSchema>;
export type GeneratedPersonas = z.infer<typeof personasSchema>;
export type GeneratedReport = z.infer<typeof generatedReportSchema>;

export const answerSchema = z.object({
  answer: z.string().trim().min(10).max(6_000),
  sourceIds: citations,
});
