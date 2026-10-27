import { z } from 'zod';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/u);
const citations = z.array(z.string().regex(/^S[1-9]\d*$/u)).max(5);
const opinion = z.number().min(-1).max(1);

export const extractedGraphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: identifier,
        label: z.string().trim().min(2).max(80),
        kind: z.enum(['topic', 'person', 'organization', 'group']),
        summary: z.string().trim().min(10).max(600),
        weight: z.number().min(0.1).max(1),
        sourceIds: citations.min(1),
        /** An exact excerpt of a cited passage that shows the source describes this node. */
        quote: z.string().trim().min(12).max(240),
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
        sourceIds: citations.min(1),
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
        sourceIds: citations.min(1),
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
  peerIds: z.array(z.string()).max(5),
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
