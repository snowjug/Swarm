import { z } from 'zod';
import type { GroundingReview } from './grounding.js';
import type { GuidedConsoleState } from './guided.js';
import type { LabProgress } from './lab.js';
import { researchIntakeSchema, type DiscoveryStatus, type ResearchBudget } from './research.js';
import { scenarioInputSchema, sourceProvenanceSchema, type SourceProvenance } from './scenario.js';

export const APP_VERSION = '0.3.0';
export const MAX_DOCUMENT_CHARS = 40_000;
export const MAX_TOTAL_CHARS = 200_000;
export const MAX_DOCUMENTS = 10;
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
    .regex(
      /^[^\\/]+\.(txt|md|markdown|pdf|csv|json)$/iu,
      'Use a TXT, Markdown, CSV, JSON or extracted PDF filename.',
    )
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
  /** Where the text came from. Absent for an upload or pasted text made before this field existed. */
  provenance: sourceProvenanceSchema.optional(),
});

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    question: z.string().trim().min(10).max(2_000),
    workflow: z.enum(['quick', 'guided']).default('quick'),
    documents: z.array(documentInputSchema).max(MAX_DOCUMENTS),
    settings: settingsSchema.default(() => settingsSchema.parse({})),
    /** The structure read from the question, when the person went through scenario intake. */
    scenario: scenarioInputSchema.optional(),
    /** What the person asked research to do. Absent means the project was made before research existed. */
    research: researchIntakeSchema.optional(),
  })
  .superRefine((project, context) => {
    // A question on its own is a project only when research is asked to find the sources.
    if (project.documents.length === 0 && project.research?.auto !== true) {
      context.addIssue({
        code: 'too_small',
        origin: 'array',
        minimum: 1,
        inclusive: true,
        input: project.documents,
        path: ['documents'],
      });
    }
    // Research is the first phase of a guided project's grounding: a quick run has no such phase, and with
    // no source it could only fail, so it is refused here, where the person can still change it.
    if (
      project.documents.length === 0 &&
      project.research?.auto === true &&
      project.workflow !== 'guided'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['workflow'],
        message:
          'A question with no source needs the guided workflow, where research finds sources.',
      });
    }
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
export type ProviderName = 'none' | 'ollama' | 'openai' | 'azure' | 'foundry';
export type ProviderAuthMode = 'none' | 'api-key' | 'entra';

export interface SourceDocument {
  id: string;
  name: string;
  content: string;
  pageCount?: number;
  provenance?: SourceProvenance;
}

export interface EvidenceChunk {
  id: string;
  documentId: string;
  documentName: string;
  text: string;
  start: number;
  end: number;
  /** SHA-256 of `text`. Lets a later edit to a source be told apart from what was cited. */
  contentHash?: string;
  /** When the passage was cut from its document. */
  extractedAt?: string;
  /** Which chunker produced the passage, so a change in how passages are cut is auditable. */
  parserVersion?: string;
  /** A person's review of the passage. Passages start unreviewed. */
  reviewStatus?: 'unreviewed' | 'accepted' | 'flagged';
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
  /**
   * How far the project is along the lab's path. Only the route that reads one project fills it in,
   * so a project that was just made, run or copied does not carry it until it is read again.
   */
  lab?: LabProgress;
}

export type ChatGroundingStatus = 'cited' | 'caveated' | 'abstained' | 'uncited';

/** What the evidence gate and the answer check found, so an answer never overstates its support. */
export interface ChatGrounding {
  status: ChatGroundingStatus;
  /** Plain statements about what was and was not found or checked. */
  notes: string[];
  /** How much of the question's key terms the project's own material covers, 0..1. */
  coverage: number | null;
}

export interface ChatMessage {
  id: string;
  target: string;
  role: 'user' | 'assistant';
  content: string;
  sourceIds: string[];
  memoryIds?: string[];
  /** Report statements (evidence-ledger ids) an analyst answer cites. */
  claimIds?: string[];
  mode: EngineMode;
  createdAt: string;
  /** Present on assistant replies produced after the evidence gate existed. */
  grounding?: ChatGrounding;
}

export type ProviderConnectivity = 'not-applicable' | 'unverified' | 'ok' | 'failing';

/**
 * What a connection check found out about one thing. `unknown` is not a failure: the check did not get
 * far enough to say (a request that never reached the provider cannot say whether the credentials are
 * good), and it is shown as that and not as a pass.
 */
export type CheckState = 'ok' | 'failed' | 'unknown';

export interface CheckStage {
  state: CheckState;
  /** What was found, in fixed words or counts: never a word the provider or the model wrote. */
  detail: string | null;
}

/**
 * The four things a connection check reports, separately, for one deployment, so that "connected" and
 * "the check failed" cannot be said of the same thing: the first three are the connection, and the fourth
 * is whether the deployment gives the structured JSON that every model step needs.
 */
export interface DeploymentCheck {
  /** The deployment asked, or null for a provider that has none. */
  deployment: string | null;
  /** The request reached the endpoint and something answered. */
  reachable: CheckStage;
  /** The provider took the credentials this server signs in with. */
  authenticated: CheckStage;
  /** The provider has a deployment of this name. */
  deploymentFound: CheckStage;
  /** A tiny request, at the lowest effort and with room to finish, came back as the JSON it asked for. */
  structuredOutput: CheckStage;
  /** How the structured output was asked for when it worked: a strict schema, or plain JSON because strict output was refused. */
  structuredMode: 'json_schema' | 'json_object' | null;
  /** The machine code of what stopped the check, when something did. */
  code: string | null;
  latencyMs: number;
}

/** The result of one explicit connection check, of every deployment a task could be sent to. */
export interface ProviderCheck {
  checkedAt: string;
  /** All four confirmed for every deployment. */
  ok: boolean;
  /** The first three confirmed for every deployment: the provider is reached, signed in to, and has them. */
  connected: boolean;
  deployments: DeploymentCheck[];
}

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
  /**
   * The last explicit connection check, with what it confirmed apart: reachable, authenticated, deployment
   * found, structured output. Null until one has been made; absent from a server of an earlier build.
   */
  check?: ProviderCheck | null;
  /** Counters since the server started: every real provider round trip, including repairs. */
  counters: {
    /** Round trips whose reply was used. */
    calls: number;
    repairCalls: number;
    /** Round trips that gave no answer, for any reason: `truncated` and `schemaInvalid` are among them. */
    failures: number;
    /** Of `failures`: replies cut off at their output limit, so that nothing could be read. */
    truncated: number;
    /** Of `failures`: whole replies that were not accepted (not the JSON asked for, or failed a check). */
    schemaInvalid: number;
    /** Every token the provider reported, whatever became of the reply: a cut-off reply is billed too. */
    inputTokens: number;
    outputTokens: number;
    /** Of `outputTokens`, the hidden thinking tokens of a reasoning deployment. */
    reasoningTokens: number;
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
  /**
   * Whether this server reads a public web page on request (`POST /api/evidence/url`). The page hides
   * the control when it is not true. Absent from a server that does not know the feature.
   */
  urlIngestion?: boolean;
  /**
   * Automatic research: whether this server does it, whether it can find sources from a question alone
   * (`discovery`), and the budget a run has when a person asks for nothing more. Absent from a server
   * that does not know the field.
   */
  research?: { enabled: boolean; discovery: DiscoveryStatus; budget: ResearchBudget };
  /**
   * What this server can do beyond the six steps, so the first screen claims only what exists:
   * `constraints` (a reviewed set of constraints that bears on the simulation) and `participants`
   * (AI-proposed participants a person reviews). Absent from a server that does not know the field.
   */
  features?: { constraints: boolean; participants: boolean };
  /**
   * What this deployment says it is: `local` (one person, this machine), `pilot` or `production`, and
   * the label to show. Absent from a server that does not know the field.
   */
  deployment?: { mode: 'local' | 'pilot' | 'production'; label: string };
  /** The release that is running, and the commit it was built from when the build says so. */
  build?: { version: string; sha: string | null };
  capabilities: {
    local: boolean;
    modelAssisted: boolean;
    /** What a new question starts with on the Ask screen. Absent from a server that does not say: `local`. */
    defaultEngine?: 'local' | 'llm';
    fileTypes: string[];
    pdf: boolean;
    webRetrieval: boolean;
    guidedConsole: boolean;
    surveys: boolean;
    whatIf: boolean;
    authentication: 'local-single-user' | 'entra' | 'entra-session' | 'public-session';
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

/** One entry of the append-only audit log. It holds identifiers, counts and short labels only. */
export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  projectId: string | null;
  detail: Record<string, string | number | boolean | null>;
  prevHash: string;
  hash: string;
}

/** The result of recomputing the log's hash chain. */
export interface AuditVerification {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
}
