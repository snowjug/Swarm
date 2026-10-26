import { z } from 'zod';

export const MAX_DOCUMENT_CHARS = 40_000;
export const MAX_TOTAL_CHARS = 100_000;
export const MAX_DOCUMENTS = 5;
export const MAX_PROJECTS = 100;

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
    .regex(/^[^\\/\u0000-\u001f]+\.(txt|md|markdown)$/iu, 'Use a TXT or Markdown filename.'),
  content: z
    .string()
    .trim()
    .min(80, 'Each document needs at least 80 characters of source material.')
    .max(MAX_DOCUMENT_CHARS)
    .refine(
      (content) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content),
      'Binary files and control characters are not supported.',
    ),
});

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    question: z.string().trim().min(10).max(2_000),
    documents: z.array(documentInputSchema).min(1).max(MAX_DOCUMENTS),
    settings: settingsSchema.default(() => settingsSchema.parse({})),
  })
  .superRefine((project, context) => {
    if (project.documents.reduce((sum, document) => sum + document.content.length, 0) > MAX_TOTAL_CHARS) {
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
export type ProjectStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type Stage = 'intake' | 'knowledge' | 'personas' | 'simulation' | 'report' | 'complete';
export type ProviderName = 'none' | 'ollama' | 'openai' | 'azure';

export interface SourceDocument {
  id: string;
  name: string;
  content: string;
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
  topicIds: string[];
  initialOpinion: number;
  opinion: number;
  influence: number;
  openness: number;
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
  sourceIds: string[];
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
}

export interface SimulationReport {
  generatedBy: EngineMode;
  title: string;
  executiveSummary: string;
  sections: ReportSection[];
  limitations: string[];
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
}

export interface ChatMessage {
  id: string;
  target: string;
  role: 'user' | 'assistant';
  content: string;
  sourceIds: string[];
  mode: EngineMode;
  createdAt: string;
}

export interface AppConfig {
  version: string;
  provider: {
    name: ProviderName;
    model: string | null;
    configured: boolean;
    reason: string;
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
  };
  sourceUrl: string | null;
  capabilities: {
    local: boolean;
    modelAssisted: boolean;
    fileTypes: string[];
    pdf: boolean;
    webRetrieval: boolean;
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
