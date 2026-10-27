import { randomUUID } from 'node:crypto';
import {
  EXECUTION_STEPS,
  type BranchInput,
  type ConsoleStep,
  type ExecutionStep,
  type RoundMetrics,
  type RunComparison,
  type StepStatus,
} from '../../../../shared/guided.js';
import type {
  ChatMessage,
  EvidenceChunk,
  Intervention,
  ProjectDetail,
  ProviderStatus,
} from '../../../../shared/types.js';
import type { ScenarioSize } from '../verify-scenario.js';
import type { Http, HttpResult } from '../verify-support.js';
import { EVIDENCE, MARKDOWN, buildProject, buildStatus } from './verify-world.js';

const reply = (status: number, body: unknown): HttpResult => ({ status, body });
const refusal = (status: number, code: string, message: string): HttpResult =>
  reply(status, { error: { code, message } });

function stepsOf(project: ProjectDetail): Record<ConsoleStep, StepStatus> {
  if (!project.console) throw new Error('The fixture project has no console state.');
  return project.console.steps;
}

function difference(left: RoundMetrics, right: RoundMetrics): RoundMetrics {
  return {
    meanOpinion: right.meanOpinion - left.meanOpinion,
    supportShare: right.supportShare - left.supportShare,
    oppositionShare: right.oppositionShare - left.oppositionShare,
    undecidedShare: right.undecidedShare - left.undecidedShare,
    polarization: right.polarization - left.polarization,
    activityCount: right.activityCount - left.activityCount,
  };
}

/**
 * An in-memory stand-in for the application's HTTP API, with the same response shapes, built only
 * to test the verifier's own logic. It is not evidence about the real application or any model.
 */
export class FakeApp implements Http {
  status: ProviderStatus = buildStatus();
  evidence: EvidenceChunk[] = [...EVIDENCE];
  markdown = MARKDOWN;
  readonly requests: string[] = [];
  /** Every POST body received, so tests can inspect exactly what the verifier sent. */
  readonly bodies: unknown[] = [];

  /** Applied to every project the moment it is created, to break one invariant at a time. */
  customize: (project: ProjectDetail) => void = () => undefined;
  editComparison: (comparison: RunComparison) => void = () => undefined;
  chatOverrides: (target: string) => Partial<ChatMessage> = () => ({});
  checkError: { code: string; message: string } | null = null;
  failStep: { step: ExecutionStep; error: string } | null = null;
  /** True: stages never finish. */
  stall = false;
  /** False: the server-wide provider counters never move. */
  countCalls = true;
  /** False: calls are never recorded on the project. */
  recordOnProject = true;

  private readonly projects = new Map<string, ProjectDetail>();
  private readonly pending = new Map<string, number>();
  private readonly resumeFrom = new Map<string, number>();
  private readonly interventions = new Map<string, Intervention | null>();

  constructor(private readonly size: ScenarioSize) {}

  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResult> {
    this.requests.push(`${method} ${path}`);
    if (body !== undefined) this.bodies.push(body);
    return Promise.resolve(this.route(method, new URL(path, 'http://app.test'), body));
  }

  private route(method: string, url: URL, body: unknown): HttpResult {
    const path = url.pathname;
    if (path === '/api/provider/status') return reply(200, structuredClone(this.status));
    if (path === '/api/provider/check' && method === 'POST') return this.check();
    if (path === '/api/projects' && method === 'POST') return this.create();
    const match = /^\/api\/projects\/([^/]+)\/?(.*)$/u.exec(path);
    const project = match?.[1] ? this.projects.get(match[1]) : undefined;
    if (!match || !project) return refusal(404, 'NOT_FOUND', 'No such project.');
    const rest = match[2] ?? '';
    const step = /^steps\/(\w+)$/u.exec(rest)?.[1];
    if (method === 'GET' && rest === '') return reply(200, structuredClone(this.advance(project)));
    if (method === 'GET' && rest === 'evidence') {
      return reply(200, {
        query: '',
        matches: this.evidence.map((chunk) => ({ ...chunk, score: 0 })),
      });
    }
    if (method === 'GET' && rest === 'compare')
      return this.compare(project, url.searchParams.get('with'));
    if (method === 'GET' && rest === 'export') return reply(200, this.markdown);
    if (method === 'POST' && rest === 'branches') return this.branch(project, body as BranchInput);
    if (method === 'POST' && rest === 'chat') return this.chat(project, body as ChatRequest);
    if (method === 'POST' && step) return this.start(project, step);
    return refusal(404, 'NOT_FOUND', 'No such route.');
  }

  private check(): HttpResult {
    if (this.checkError) {
      this.status.connectivity = 'failing';
      this.status.lastError = this.checkError;
      return refusal(502, this.checkError.code, this.checkError.message);
    }
    this.status.connectivity = 'ok';
    this.status.lastLatencyMs = 120;
    this.status.lastError = null;
    if (this.countCalls) this.status.counters.calls += 1;
    return reply(200, structuredClone(this.status));
  }

  private create(): HttpResult {
    const project = buildProject(randomUUID(), this.size, this.status);
    this.customize(project);
    this.projects.set(project.id, project);
    return reply(201, structuredClone(project));
  }

  private start(project: ProjectDetail, step: string): HttpResult {
    const stage = EXECUTION_STEPS.find((name) => name === step);
    if (!stage) return refusal(400, 'VALIDATION', 'Unknown stage.');
    stepsOf(project)[stage] = 'queued';
    this.pending.set(`${project.id}:${stage}`, 0);
    return reply(202, { accepted: true });
  }

  /** The first read after a start shows the stage running; the next shows its outcome. */
  private advance(project: ProjectDetail): ProjectDetail {
    for (const [key, reads] of [...this.pending]) {
      const [id, stage] = key.split(':');
      const step = EXECUTION_STEPS.find((name) => name === stage);
      if (id !== project.id || !step) continue;
      if (this.stall || reads === 0) {
        stepsOf(project)[step] = 'running';
        this.pending.set(key, reads + 1);
        continue;
      }
      this.pending.delete(key);
      if (this.failStep?.step === step) {
        stepsOf(project)[step] = 'failed';
        project.error = this.failStep.error;
        continue;
      }
      stepsOf(project)[step] = 'ready';
      this.record(project, this.callsFor(project, step));
    }
    return project;
  }

  private callsFor(project: ProjectDetail, step: ExecutionStep): number {
    const later = this.size.rounds - (this.resumeFrom.get(project.id) ?? 0);
    return {
      knowledge: 3,
      environment: 2,
      simulation: this.size.agents * 2 * later,
      report: 8,
    }[step];
  }

  private record(project: ProjectDetail, calls: number): void {
    if (this.recordOnProject && project.execution) project.execution.modelCalls += calls;
    if (this.countCalls) this.status.counters.calls += calls;
  }

  private branch(parent: ProjectDetail, input: BranchInput): HttpResult {
    const child = structuredClone(parent);
    child.id = randomUUID();
    child.parentId = parent.id;
    if (child.execution) child.execution = { ...child.execution, modelCalls: 0 };
    stepsOf(child).simulation = 'paused';
    this.projects.set(child.id, child);
    this.resumeFrom.set(child.id, input.fromRound);
    this.interventions.set(child.id, input.intervention ?? null);
    return reply(201, structuredClone(child));
  }

  private compare(base: ProjectDetail, otherId: string | null): HttpResult {
    const other = otherId ? this.projects.get(otherId) : undefined;
    if (!other) return refusal(404, 'NOT_FOUND', 'No such project.');
    const from = this.resumeFrom.get(other.id) ?? 0;
    const ran = (project: ProjectDetail): RunComparison['base'] => ({
      id: project.id,
      name: project.name,
      status: project.status,
      seed: 42,
      completedRounds: this.size.rounds,
      totalRounds: this.size.rounds,
      branchFromRound: this.resumeFrom.get(project.id) ?? null,
      intervention: this.interventions.get(project.id) ?? null,
    });
    const comparison: RunComparison = {
      base: ran(base),
      other: ran(other),
      lineage: other.parentId === base.id ? 'base-is-parent' : 'unrelated',
      identicalThroughRound: from,
      rounds: Array.from({ length: this.size.rounds }, (_, index) => {
        const round = index + 1;
        const left: RoundMetrics = {
          meanOpinion: 0.1 * round,
          supportShare: 0.5,
          oppositionShare: 0.25,
          undecidedShare: 0.25,
          polarization: 0.2,
          activityCount: this.size.agents,
        };
        const right = round <= from ? left : { ...left, meanOpinion: left.meanOpinion + 0.05 };
        return { round, base: left, other: right, delta: difference(left, right) };
      }),
      declaredChanges: [
        { kind: 'intervention', from: null, to: this.interventions.get(other.id) ?? null },
      ],
      notes: [],
    };
    this.editComparison(comparison);
    return reply(200, comparison);
  }

  private chat(project: ProjectDetail, request: ChatRequest): HttpResult {
    const { target, message } = request;
    if (target !== 'report' && !project.agents.some((agent) => agent.id === target)) {
      return refusal(400, 'UNKNOWN_TARGET', 'Unknown chat target.');
    }
    this.record(project, 1);
    const createdAt = '2026-01-01T00:00:00.000Z';
    const asked: ChatMessage = {
      id: randomUUID(),
      target,
      role: 'user',
      content: message,
      sourceIds: [],
      mode: 'llm',
      createdAt,
    };
    const answered: ChatMessage = {
      id: randomUUID(),
      target,
      role: 'assistant',
      content: 'Based on the recorded scenario only, the position moved as the report describes.',
      sourceIds: ['S1'],
      memoryIds: [],
      mode: 'llm',
      createdAt,
      ...this.chatOverrides(target),
    };
    return reply(200, { messages: [asked, answered] });
  }
}

interface ChatRequest {
  target: string;
  message: string;
}
