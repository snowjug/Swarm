import { z } from 'zod';
import type { Agent, RoundSnapshot } from './types.js';

export const CONSOLE_STEPS = [
  'knowledge',
  'environment',
  'simulation',
  'report',
  'interaction',
] as const;
export const EXECUTION_STEPS = ['knowledge', 'environment', 'simulation', 'report'] as const;
export const PLATFORMS = ['plaza', 'community'] as const;
export const MAX_PDF_BYTES = 2_000_000;
export const MAX_PDF_PAGES = 40;
export const MAX_SURVEY_TARGETS = 5;
export const MAX_SURVEYS = 5;

export type ConsoleStep = (typeof CONSOLE_STEPS)[number];
export type ExecutionStep = (typeof EXECUTION_STEPS)[number];
export type Platform = (typeof PLATFORMS)[number];
export type StepStatus = 'pending' | 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const ontologySchema = z.object({
  entityTypes: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().min(5).max(400),
      }),
    )
    .min(1)
    .max(12),
  relationshipTypes: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().min(5).max(400),
      }),
    )
    .min(1)
    .max(16),
});
export type Ontology = z.infer<typeof ontologySchema>;

export const seedPostSchema = z.object({
  id: z.string().regex(/^P[1-4]$/u),
  text: z.string().trim().min(10).max(500),
  platform: z.enum(['plaza', 'community', 'both']),
  stance: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1),
  sourceIds: z.array(z.string()).max(5),
});
export type SeedPost = z.infer<typeof seedPostSchema>;

export const environmentSchema = z.object({
  minutesPerRound: z.int().min(5).max(180),
  platforms: z
    .array(z.enum(PLATFORMS))
    .min(1)
    .max(2)
    .refine(
      (platforms) => new Set(platforms).size === platforms.length,
      'Select each platform only once.',
    ),
  initialPosts: z.array(seedPostSchema).max(4),
  generatedBy: z.enum(['local', 'llm']),
  edited: z.boolean(),
});
export type EnvironmentConfig = z.infer<typeof environmentSchema>;

export const personaEditSchema = z.object({
  id: z.string().regex(/^agent-[1-9]\d?$/u),
  name: z.string().trim().min(3).max(100),
  role: z.string().trim().min(3).max(100),
  persona: z.string().trim().min(30).max(700),
  initialOpinion: z.number().min(-1).max(1),
  influence: z.number().min(0.1).max(2),
  openness: z.number().min(0).max(1),
});

export const environmentUpdateSchema = z.object({
  rounds: z.int().min(3).max(24),
  minutesPerRound: z.int().min(5).max(180),
  platforms: environmentSchema.shape.platforms,
  initialPosts: z.array(seedPostSchema).max(4),
  agents: z.array(personaEditSchema).min(4).max(24),
});
export type EnvironmentUpdate = z.infer<typeof environmentUpdateSchema>;

export interface PlatformRun {
  platform: Platform;
  label: string;
  network: 'broadcast' | 'community';
  status: 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentRound: number;
  elapsedMinutes: number;
  agents: Agent[];
  rounds: RoundSnapshot[];
}

export interface SimulationMemory {
  id: string;
  platform: Platform;
  round: number;
  simulatedMinute: number;
  kind: 'seed' | 'action';
  agentId: string | null;
  actionType: 'seed' | 'update' | 'post' | 'reply' | 'observe';
  text: string;
  opinion: number | null;
  peerIds: string[];
  sourceIds: string[];
}

export interface OperationTrace {
  id: string;
  step: ConsoleStep;
  kind: 'model' | 'retrieval' | 'simulation' | 'review' | 'interview';
  name: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  input: JsonValue;
  output: JsonValue | null;
  error: string | null;
}

export interface SimulatedInterview {
  id: string;
  agentId: string;
  question: string;
  answer: string;
  sourceIds: string[];
  memoryIds: string[];
}

export interface ReportPlan {
  title: string;
  sections: string[];
  evidenceQueries: string[];
  interviewAgentIds: string[];
  interviewQuestion: string;
  completedSections: number;
}

export const surveyInputSchema = z.object({
  kind: z.enum(['state', 'interview']),
  question: z.string().trim().min(5).max(1_000),
  agentIds: z
    .array(z.string().regex(/^agent-[1-9]\d?$/u))
    .min(1)
    .max(MAX_SURVEY_TARGETS)
    .refine((ids) => new Set(ids).size === ids.length, 'Choose each proxy only once.'),
});
export type SurveyInput = z.infer<typeof surveyInputSchema>;

export interface SurveyResponse {
  agentId: string;
  answer: string | null;
  opinion: number;
  position: 'supportive' | 'opposing' | 'undecided';
  sourceIds: string[];
  memoryIds: string[];
}

export interface SurveyRecord {
  id: string;
  kind: 'state' | 'interview';
  question: string;
  agentIds: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt: string | null;
  responses: SurveyResponse[];
  error: string | null;
}

export interface GuidedConsoleState {
  steps: Record<ConsoleStep, StepStatus>;
  activeStep: ConsoleStep;
  ontology: Ontology | null;
  environment: EnvironmentConfig | null;
  platforms: PlatformRun[];
  memories: SimulationMemory[];
  traces: OperationTrace[];
  reportPlan: ReportPlan | null;
  interviews: SimulatedInterview[];
  surveys: SurveyRecord[];
}

export interface ExtractedPdf {
  name: string;
  content: string;
  pageCount: number;
  bytes: number;
}

export function emptyConsole(): GuidedConsoleState {
  return {
    steps: {
      knowledge: 'pending',
      environment: 'pending',
      simulation: 'pending',
      report: 'pending',
      interaction: 'pending',
    },
    activeStep: 'knowledge',
    ontology: null,
    environment: null,
    platforms: [],
    memories: [],
    traces: [],
    reportPlan: null,
    interviews: [],
    surveys: [],
  };
}
