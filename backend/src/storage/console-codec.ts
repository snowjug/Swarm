import { z } from 'zod';
import {
  CONSOLE_STEPS,
  PLATFORMS,
  environmentSchema,
  ontologySchema,
  type GuidedConsoleState,
  type JsonValue,
} from '../../../shared/guided.js';
import { interventionSchema, type Agent, type RoundSnapshot } from '../../../shared/types.js';

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const references = z.array(z.string());
const platform = z.enum(PLATFORMS);
const opinion = z.number().min(-1).max(1);
const agentChange = z.object({
  kind: z.literal('agent'),
  agentId: z.string(),
  field: z.enum(['influence', 'openness', 'opinion']),
  from: z.number(),
  to: z.number(),
});
const interventionChange = z.object({
  kind: z.literal('intervention'),
  from: interventionSchema.nullable(),
  to: interventionSchema.nullable(),
});
const branchSchema = z.object({
  parentId: z.string(),
  parentName: z.string(),
  rootId: z.string(),
  fromRound: z.int().nonnegative(),
  createdAt: z.string(),
  changes: z.array(z.discriminatedUnion('kind', [agentChange, interventionChange])).max(60),
});

export function consoleSchema(
  agent: z.ZodType<Agent>,
  round: z.ZodType<RoundSnapshot>,
): z.ZodType<GuidedConsoleState> {
  return z.object({
    steps: z.record(
      z.enum(CONSOLE_STEPS),
      z.enum(['pending', 'queued', 'running', 'paused', 'ready', 'failed', 'cancelled']),
    ),
    activeStep: z.enum(CONSOLE_STEPS),
    branch: branchSchema.nullable().default(null),
    ontology: ontologySchema.nullable(),
    environment: environmentSchema.nullable(),
    platforms: z
      .array(
        z.object({
          platform,
          label: z.string(),
          network: z.enum(['broadcast', 'community']),
          status: z.enum(['ready', 'running', 'paused', 'completed', 'failed', 'cancelled']),
          currentRound: z.int().nonnegative(),
          elapsedMinutes: z.int().nonnegative(),
          agents: z.array(agent),
          rounds: z.array(round),
        }),
      )
      .max(2),
    memories: z
      .array(
        z.object({
          id: z.string(),
          platform,
          round: z.int().nonnegative(),
          simulatedMinute: z.int().nonnegative(),
          kind: z.enum(['seed', 'action']),
          agentId: z.string().nullable(),
          actionType: z.enum(['seed', 'update', 'post', 'reply', 'observe']),
          text: z.string(),
          opinion: opinion.nullable(),
          peerIds: references,
          sourceIds: references,
          rationale: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
        }),
      )
      .max(1_200),
    traces: z
      .array(
        z.object({
          id: z.string(),
          step: z.enum(CONSOLE_STEPS),
          kind: z.enum(['model', 'retrieval', 'simulation', 'review', 'interview']),
          name: z.string(),
          status: z.enum(['running', 'completed', 'failed']),
          startedAt: z.string(),
          completedAt: z.string().nullable(),
          input: jsonValue,
          output: jsonValue.nullable(),
          error: z.string().nullable(),
        }),
      )
      .max(120),
    reportPlan: z
      .object({
        title: z.string(),
        sections: z.array(z.string()),
        evidenceQueries: z.array(z.string()),
        interviewAgentIds: references,
        interviewQuestion: z.string(),
        completedSections: z.int().nonnegative(),
      })
      .nullable(),
    interviews: z
      .array(
        z.object({
          id: z.string(),
          agentId: z.string(),
          question: z.string(),
          answer: z.string(),
          sourceIds: references,
          memoryIds: references,
        }),
      )
      .max(2),
    surveys: z
      .array(
        z.object({
          id: z.uuid(),
          kind: z.enum(['state', 'interview']),
          question: z.string(),
          agentIds: references,
          status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
          createdAt: z.string(),
          completedAt: z.string().nullable(),
          responses: z
            .array(
              z.object({
                agentId: z.string(),
                answer: z.string().nullable(),
                opinion,
                position: z.enum(['supportive', 'opposing', 'undecided']),
                sourceIds: references,
                memoryIds: references,
              }),
            )
            .max(5),
          error: z.string().nullable(),
        }),
      )
      .max(5),
  });
}
