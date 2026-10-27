import { z } from 'zod';
import {
  documentInputSchema,
  interventionSchema,
  settingsSchema,
  type Agent,
  type ChatMessage,
  type EvidenceChunk,
  type JobEvent,
  type KnowledgeGraph,
  type ProjectDetail,
  type RoundSnapshot,
  type SimulationReport,
} from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { consoleSchema } from './console-codec.js';

export type StoredProject = Omit<ProjectDetail, 'events' | 'parentId'>;
const ids = z.array(z.string());
const opinion = z.number().min(-1).max(1);
const fraction = z.number().min(0).max(1);
export const stageSchema = z.enum([
  'intake',
  'knowledge',
  'personas',
  'simulation',
  'report',
  'complete',
]);

export const graphSchema: z.ZodType<KnowledgeGraph> = z.object({
  method: z.enum(['lexical', 'llm']),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(['topic', 'person', 'organization', 'group']),
      summary: z.string(),
      weight: fraction,
      sourceIds: ids,
      entityType: z.string().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      label: z.string(),
      weight: fraction,
      sourceIds: ids,
    }),
  ),
  notes: z.array(z.string()),
});

export const agentSchema: z.ZodType<Agent> = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  persona: z.string(),
  topicIds: ids,
  initialOpinion: opinion,
  opinion,
  influence: z.number().min(0.1).max(2),
  openness: fraction,
  memory: z.array(z.string()),
  sourceIds: ids,
});

export const roundSchema: z.ZodType<RoundSnapshot> = z.object({
  round: z.int().positive(),
  meanOpinion: opinion,
  supportShare: fraction,
  oppositionShare: fraction,
  undecidedShare: fraction,
  polarization: fraction,
  activityCount: z.int().nonnegative(),
  interactions: z.int().nonnegative(),
  opinions: z.array(z.object({ agentId: z.string(), opinion })),
  actions: z.array(
    z.object({
      id: z.string(),
      round: z.int().positive(),
      agentId: z.string(),
      type: z.enum(['update', 'post', 'reply', 'observe']),
      content: z.string(),
      opinion,
      peerIds: ids,
      sourceIds: ids,
    }),
  ),
  intervention: interventionSchema.nullable(),
});

export const reportSchema: z.ZodType<SimulationReport> = z.object({
  generatedBy: z.enum(['local', 'llm']),
  title: z.string(),
  executiveSummary: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
      sourceIds: ids,
      memoryIds: ids.optional(),
      interviewIds: ids.optional(),
    }),
  ),
  limitations: z.array(z.string()),
  metrics: z.object({
    initialMean: opinion,
    finalMean: opinion,
    finalSupport: fraction,
    finalOpposition: fraction,
    polarization: fraction,
    totalInteractions: z.int().nonnegative(),
  }),
});

export const storedProjectSchema: z.ZodType<StoredProject> = z.object({
  id: z.uuid(),
  name: z.string(),
  workflow: z.enum(['quick', 'guided']).default('quick'),
  question: z.string(),
  status: z.enum(['draft', 'ready', 'queued', 'running', 'completed', 'failed', 'cancelled']),
  stage: stageSchema,
  progress: z.number().min(0).max(100),
  mode: z.enum(['local', 'llm']),
  agentCount: z.int(),
  roundCount: z.int(),
  currentRound: z.int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().nullable(),
  settings: settingsSchema,
  documents: z.array(documentInputSchema.extend({ id: z.string() })),
  graph: graphSchema.nullable(),
  agents: z.array(agentSchema),
  rounds: z.array(roundSchema),
  report: reportSchema.nullable(),
  execution: z
    .object({
      provider: z.enum(['none', 'ollama', 'openai', 'azure']),
      model: z.string().nullable(),
      modelCalls: z.int().nonnegative(),
      inputTokens: z.int().nonnegative(),
      outputTokens: z.int().nonnegative(),
    })
    .nullable(),
  console: consoleSchema(agentSchema, roundSchema).nullable().default(null),
});

export const chunkSchema: z.ZodType<EvidenceChunk> = z.object({
  id: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  text: z.string(),
  start: z.int().nonnegative(),
  end: z.int().nonnegative(),
});

export const eventSchema: z.ZodType<JobEvent> = z.object({
  id: z.int(),
  projectId: z.string(),
  stage: stageSchema,
  message: z.string(),
  createdAt: z.string(),
});

export const chatMessageSchema: z.ZodType<ChatMessage> = z.object({
  id: z.uuid(),
  target: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  sourceIds: ids,
  memoryIds: ids.optional(),
  mode: z.enum(['local', 'llm']),
  createdAt: z.string(),
});

export function decode<T>(schema: z.ZodType<T>, payload: string): T {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (cause) {
    throw new AppError(
      500,
      'STORAGE_CORRUPT',
      'Stored JSON is invalid. Restore a known-good backup.',
      {
        cause,
      },
    );
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      500,
      'STORAGE_SCHEMA_MISMATCH',
      'Stored data does not match this application version. Check the database version and backup.',
    );
  }
  return result.data;
}
