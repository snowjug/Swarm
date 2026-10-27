import { z } from 'zod';
import type { GroundingReview } from './grounding.js';
import type { GuidedConsoleState } from './guided.js';

export const APP_VERSION = '0.3.0';
export const MAX_DOCUMENT_CHARS = 40_000;
export const MAX_TOTAL_CHARS = 100_000;
export const MAX_DOCUMENTS = 5;
export const MAX_PROJECTS = 100;

function hasControlCharacters(value: string, allowWhitespace = false): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && !(allowWhitespace && [9, 10, 13].includes(code)));
  });
}

export const interventionSchema = z.object({
  round: z.int().min(1).max(24),
  label: z.string().trim().min(5).max(300),
  stance: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1),
});

export const settingsSchema = z
  .object({
    mode: z.enum(['local', 'llm']).default('local'),
    agentCount: z.int().min(4).max(24).default(12),
    rounds: z.int().min(3).max(24).default(8),
    seed: z.int().min(1).max(2_147_483_647).default(42),
    network: z.enum(['community', 'broadcast']).default('community'),
    intervention: interventionSchema.nullable().default(null),
  })
  .superRefine((settings, context) => {
    if (settings.intervention && settings.intervention.round > settings.rounds) {
      context.addIssue({
        code: 'custom',
        path: ['intervention', 'round'],
        message: 'The intervention must occur within the simulation.',
      });
    }
    if (settings.mode === 'llm' && (settings.agentCount > 10 || settings.rounds > 10)) {
      context.addIssue({
        code: 'custom',
        message: 'Model-assisted runs are limited to 10 agents and 10 rounds.',
      });
    }
  });

export const documentInputSchema = z.object({
  name: z
    .string()
    .trim()
    .max(120)
    .regex(/^[^\\/]+\.(txt|md|markdown|pdf)$/iu, 'Use a TXT, Markdown or extracted PDF filename.')
    .refine((name) => !hasControlCharacters(name), 'Filenames cannot contain control characters.'),
  content: z
    .string()
    .trim()
    .min(80, 'Each document needs at least 80 characters of source material.')
    .max(MAX_DOCUMENT_CHARS)
    .refine(
      (content) => !hasControlCharacters(content, true),
      'Binary files and control characters are not supported.',
    ),
  pageCount: z.int().min(1).max(40).optional(),
});

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    question: z.string().trim().min(10).max(2_000),
    workflow: z.enum(['quick', 'guided']).default('quick'),
    documents: z.array(documentInputSchema).min(1).max(MAX_DOCUMENTS),
    settings: settingsSchema.default(() => settingsSchema.parse({})),
  })
  .superRefine((project, context) => {
    if (
      project.documents.reduce((sum, document) => sum + document.content.length, 0) >
      MAX_TOTAL_CHARS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message: `Source material must not exceed ${MAX_TOTAL_CHARS.toLocaleString()} characters.`,
      });
    }
  });

export const chatInputSchema = z.object({
  target: z.string().min(1).max(80),
  message: z.string().trim().min(3).max(1_000),
});

export type SimulationSettings = z.infer<typeof settingsSchema>;
export type Intervention = z.infer<typeof interventionSchema>;
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type ValidatedProjectInput = z.output<typeof createProjectSchema>;
export type EngineMode = SimulationSettings['mode'];
export type ProjectStatus =
  'draft' | 'ready' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type Stage = 'intake' | 'knowledge' | 'personas' | 'simulation' | 'report' | 'complete';
export type ProviderName = 'none' | 'ollama' | 'openai' | 'azure';
export type ProviderAuthMode = 'none' | 'api-key' | 'entra';

export interface SourceDocument {
  id: string;
  name: string;
  content: string;
  pageCount?: number;
}

export interface EvidenceChunk {
  id: string;
  documentId: string;
  documentName: string;
  text: string;
  start: number;
  end: number;
}

export interface EvidenceMatch extends EvidenceChunk {
  score: number;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  kind: 'topic' | 'person' | 'organization' | 'group';
  summary: string;
  weight: number;
  sourceIds: string[];
  entityType?: string;
  /** Model graphs only: an excerpt that was found verbatim in one of the cited passages. */
  quote?: string;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  label: string;
  weight: number;
  sourceIds: string[];
}

export interface KnowledgeGraph {
  method: 'lexical' | 'llm';
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  notes: string[];
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  persona: string;
  /** Model-generated, optional: what this fictional proxy is trying to achieve and what limits it. */
  goals?: string[];
  constraints?: string[];
  topicIds: string[];
  initialOpinion: number;
  opinion: number;
  influence: number;
  openness: number;
  /** Private to this proxy: only its own prompts ever include it. */
  memory: string[];
  sourceIds: string[];
}

export interface AgentAction {
  id: string;
  round: number;
  agentId: string;
  type: 'update' | 'post' | 'reply' | 'observe';
  content: string;
  opinion: number;
  peerIds: string[];
  sourceIds: string[];
  /** Short stated reason (model runs only). A summary the model chose to give, not hidden reasoning. */
  rationale?: string;
  /** The proxy's self-reported firmness of its new stance, 0..1 (model runs only). */
  confidence?: number;
}

export interface RoundSnapshot {
  round: number;
  meanOpinion: number;
  supportShare: number;
  oppositionShare: number;
  undecidedShare: number;
  polarization: number;
  activityCount: number;
  interactions: number;
  opinions: { agentId: string; opinion: number }[];
  actions: AgentAction[];
  intervention: Intervention | null;
}

export interface ReportSection {
  title: string;
  body: string;
  sourceIds: string[];
  memoryIds?: string[];
  interviewIds?: string[];
}

export interface SimulationReport {
  generatedBy: EngineMode;
  title: string;
  executiveSummary: string;
  sections: ReportSection[];
  limitations: string[];
  /** Present only on model-written reports whose statements were checked against their sources. */
  grounding?: GroundingReview;
  metrics: {
    initialMean: number;
    finalMean: number;
    finalSupport: number;
    finalOpposition: number;
    polarization: number;
    totalInteractions: number;
  };
}

export interface JobEvent {
  id: number;
  projectId: string;
  stage: Stage;
  message: string;
  createdAt: string;
}

export interface ExecutionInfo {
  provider: ProviderName;
  model: string | null;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workflow: 'quick' | 'guided';
  question: string;
  status: ProjectStatus;
  stage: Stage;
  progress: number;
  mode: EngineMode;
  agentCount: number;
  roundCount: number;
  currentRound: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  /** Set when this scenario was branched from another scenario's checkpoint. */
  parentId: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  settings: SimulationSettings;
  documents: SourceDocument[];
  graph: KnowledgeGraph | null;
  agents: Agent[];
  rounds: RoundSnapshot[];
  report: SimulationReport | null;
  events: JobEvent[];
  execution: ExecutionInfo | null;
  console: GuidedConsoleState | null;
}

export interface ChatMessage {
  id: string;
  target: string;
  role: 'user' | 'assistant';
  content: string;
  sourceIds: string[];
  memoryIds?: string[];
  mode: EngineMode;
  createdAt: string;
}

export type ProviderConnectivity = 'not-applicable' | 'unverified' | 'ok' | 'failing';

/** Safe, credential-free view of the model provider for the UI and operators. */
export interface ProviderStatus {
  /** What the server can run: the offline rules engine only, or a configured real model. */
  mode: 'local-rules' | 'real-model';
  provider: ProviderName;
  model: string | null;
  auth: ProviderAuthMode;
  configured: boolean;
  connectivity: ProviderConnectivity;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: { code: string; message: string } | null;
  /** Counters since the server started: every real provider round trip, including repairs. */
  counters: {
    calls: number;
    repairCalls: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    /** False until the provider has reported usage; zero tokens then does not mean zero cost. */
    tokensReported: boolean;
  };
  startedAt: string;
}

export interface AppConfig {
  version: string;
  provider: {
    name: ProviderName;
    model: string | null;
    configured: boolean;
    reason: string;
    auth: ProviderAuthMode;
  };
  limits: {
    maxDocuments: number;
    maxDocumentChars: number;
    maxTotalChars: number;
    maxProjects: number;
    maxQueuedRuns: number;
    localMaxAgents: number;
    localMaxRounds: number;
    modelMaxAgents: number;
    modelMaxRounds: number;
    maxPdfBytes: number;
    maxPdfPages: number;
    maxSurveyTargets: number;
  };
  sourceUrl: string | null;
  storage?: { warning: string | null };
  capabilities: {
    local: boolean;
    modelAssisted: boolean;
    fileTypes: string[];
    pdf: boolean;
    webRetrieval: boolean;
    guidedConsole: boolean;
    surveys: boolean;
    whatIf: boolean;
    authentication: 'local-single-user';
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}
