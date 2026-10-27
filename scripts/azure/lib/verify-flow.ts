import { EXECUTION_STEPS, type ExecutionStep, type RunComparison } from '../../../shared/guided.js';
import type {
  ChatMessage,
  EvidenceChunk,
  ProjectDetail,
  ProviderStatus,
} from '../../../shared/types.js';
import {
  checkBranching,
  checkChatReply,
  checkExport,
  checkGraphQuotes,
  checkGrounding,
  checkGroundingModel,
  checkInjection,
  checkNoSecrets,
  checkPerActor,
  checkProviderConfig,
  checkProviderConnection,
  checkRealCalls,
  checkTelemetry,
  lastReply,
} from './verify-checks.js';
import {
  ACTOR_QUESTION,
  ANALYST_QUESTION,
  branchBody,
  projectBody,
  type ScenarioSize,
} from './verify-scenario.js';
import {
  CheckFailure,
  Recorder,
  describeError,
  expectJson,
  type CheckResult,
  type Http,
} from './verify-support.js';

export interface VerifyOptions {
  expectProvider: string;
  expectAuth: string | null;
  agents: number;
  rounds: number;
  /** False: the source document carries no hidden instruction, so the injection check is skipped. */
  probe: boolean;
  stepTimeoutMs: number;
  pollMs: number;
  log?: (line: string) => void;
}

export interface VerifyReport {
  startedAt: string;
  finishedAt: string;
  observed: { mode: string; provider: string; model: string | null; auth: string };
  checks: CheckResult[];
  verified: boolean;
}

const seconds = (since: number): number => Math.round((Date.now() - since) / 1000);

const FILTER_HINT =
  ' The synthetic source contains a deliberate hidden instruction. If the filter is reacting to it, re-run with --no-probe to test everything else (the injection check is then skipped and the result stays NOT VERIFIED).';

/** Typed wrappers over the application's public API. Every refusal becomes a CheckFailure. */
class Api {
  constructor(
    private readonly http: Http,
    private readonly options: VerifyOptions,
  ) {}

  private async get<T>(path: string, action: string): Promise<T> {
    return expectJson<T>(await this.http.request('GET', path), action);
  }

  private async post<T>(path: string, body: unknown, action: string): Promise<T> {
    return expectJson<T>(await this.http.request('POST', path, body), action);
  }

  status(): Promise<ProviderStatus> {
    return this.get('/api/provider/status', 'Reading the provider status');
  }

  check(): Promise<ProviderStatus> {
    return this.post('/api/provider/check', undefined, 'The real connectivity check');
  }

  create(body: unknown): Promise<ProjectDetail> {
    return this.post('/api/projects', body, 'Creating the synthetic project');
  }

  project(id: string): Promise<ProjectDetail> {
    return this.get(`/api/projects/${id}`, 'Reading the project');
  }

  async evidence(id: string): Promise<EvidenceChunk[]> {
    const body = await this.get<{ matches: EvidenceChunk[] }>(
      `/api/projects/${id}/evidence`,
      'Reading the stored evidence',
    );
    return body.matches;
  }

  branch(id: string, body: unknown): Promise<ProjectDetail> {
    return this.post(`/api/projects/${id}/branches`, body, 'Branching the scenario');
  }

  compare(id: string, otherId: string): Promise<RunComparison> {
    return this.get(`/api/projects/${id}/compare?with=${otherId}`, 'Comparing the scenarios');
  }

  async chat(id: string, target: string, message: string): Promise<ChatMessage[]> {
    const body = await this.post<{ messages: ChatMessage[] }>(
      `/api/projects/${id}/chat`,
      { target, message },
      'The follow-up chat',
    );
    return body.messages;
  }

  async markdown(id: string): Promise<unknown> {
    const result = await this.http.request('GET', `/api/projects/${id}/export?format=markdown`);
    if (result.status !== 200) throw new CheckFailure(`Exporting failed: ${describeError(result)}`);
    return result.body;
  }

  /** Starts one stage and waits until it is persisted as ready. A failed stage is reported with its recorded error. */
  async runStep(id: string, step: ExecutionStep, resume = false): Promise<ProjectDetail> {
    const started = await this.http.request(
      'POST',
      `/api/projects/${id}/steps/${step}`,
      resume ? { resume: true } : undefined,
    );
    if (started.status !== 202) {
      throw new CheckFailure(`Starting the "${step}" stage failed: ${describeError(started)}`);
    }
    const deadline = Date.now() + this.options.stepTimeoutMs;
    for (;;) {
      const project = await this.project(id);
      const state = project.console?.steps[step];
      if (state === 'ready') return project;
      if (state === 'failed' || state === 'cancelled') {
        const error = project.error ?? 'no error was recorded';
        const filtered = this.options.probe && /content filter/iu.test(error);
        throw new CheckFailure(
          `The "${step}" stage ${state}: ${error}${filtered ? FILTER_HINT : ''}`,
        );
      }
      if (Date.now() > deadline) {
        throw new CheckFailure(
          `The "${step}" stage did not finish within ${Math.round(this.options.stepTimeoutMs / 1000)} s (last state: ${state ?? 'unknown'}).`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.pollMs));
    }
  }
}

/**
 * Drives a full synthetic scenario through the running application's public API and records what
 * the application itself reports. It never reads or writes credentials. It passes only if every
 * check holds against the provider the server is really configured for.
 */
export async function runLiveVerification(
  http: Http,
  options: VerifyOptions,
): Promise<VerifyReport> {
  const startedAt = new Date().toISOString();
  const api = new Api(http, options);
  const log = options.log ?? (() => undefined);
  const recorder = new Recorder((result) => {
    const label = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIP' }[result.status];
    log(`${label}  ${result.title}`);
  });
  const size: ScenarioSize = { agents: options.agents, rounds: options.rounds };
  const expected = { provider: options.expectProvider, auth: options.expectAuth };
  const observed: VerifyReport['observed'] = {
    mode: 'unknown',
    provider: 'unknown',
    model: null,
    auth: 'unknown',
  };

  const finish = (): VerifyReport => {
    const checks = recorder.all();
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      observed,
      checks,
      verified: checks.every((check) => check.status === 'pass'),
    };
  };

  const configured = await recorder.collect('provider-config', async () => {
    const status = await api.status();
    Object.assign(observed, {
      mode: status.mode,
      provider: status.provider,
      model: status.model,
      auth: status.auth,
    });
    return {
      detail: checkProviderConfig(status, expected),
      value: { baselineCalls: status.counters.calls },
    };
  });
  if (!configured) return finish();
  const connected = await recorder.run('provider-connection', async () =>
    checkProviderConnection(await api.check()),
  );
  if (!connected) return finish();

  const pipeline = await recorder.collect('pipeline', async () => {
    const begun = Date.now();
    const created = await api.create(projectBody(size, options.probe));
    for (const step of EXECUTION_STEPS) {
      const stepBegun = Date.now();
      await api.runStep(created.id, step);
      log(`      ${step} stage ready in ${seconds(stepBegun)} s`);
    }
    const [project, evidence] = await Promise.all([
      api.project(created.id),
      api.evidence(created.id),
    ]);
    return {
      detail: `All four stages finished in ${seconds(begun)} s.`,
      value: { project, evidence },
    };
  });
  if (!pipeline) return finish();
  const { project, evidence } = pipeline;
  const evidenceIds = new Set(evidence.map((chunk) => chunk.id));
  const memoryIds = new Set((project.console?.memories ?? []).map((memory) => memory.id));

  await recorder.run('real-calls', async () => checkRealCalls(project, await api.status(), size));
  await recorder.run('per-actor', () => checkPerActor(project, size));
  await recorder.run('graph-quotes', () => checkGraphQuotes(project, evidence));
  await recorder.run('grounding', () => checkGrounding(project, evidenceIds, memoryIds));
  await recorder.run('grounding-model-check', () => checkGroundingModel(project));

  const branch = await recorder.collect('branching', async () => {
    const created = await api.branch(project.id, branchBody());
    const finished = await api.runStep(created.id, 'simulation', true);
    const comparison = await api.compare(project.id, created.id);
    return { detail: checkBranching(project, finished, comparison, size), value: finished };
  });

  const replies: string[] = [];
  const converse = async (target: string, message: string): Promise<string> => {
    const before = (await api.status()).counters.calls;
    const messages = await api.chat(project.id, target, message);
    const after = (await api.status()).counters.calls;
    const reply = lastReply(messages);
    if (reply) replies.push(reply.content);
    return checkChatReply(messages, evidenceIds, after - before);
  };
  await recorder.run('analyst-chat', () => converse('report', ANALYST_QUESTION));
  await recorder.run('actor-chat', () => {
    const proxy = project.agents[0];
    if (!proxy) throw new CheckFailure('The project has no proxies to talk to.');
    return converse(proxy.id, ACTOR_QUESTION);
  });

  await recorder.run('telemetry', async () => {
    const [status, main] = await Promise.all([api.status(), api.project(project.id)]);
    const recorded = (main.execution?.modelCalls ?? 0) + (branch?.execution?.modelCalls ?? 0);
    return checkTelemetry(status, configured.baselineCalls, recorded);
  });

  let markdown: unknown = null;
  await recorder.run('export', async () => {
    markdown = await api.markdown(project.id);
    return checkExport(markdown);
  });
  if (options.probe) {
    await recorder.run('injection-probe', () => checkInjection(project, replies));
  } else {
    recorder.skip(
      'injection-probe',
      'Skipped by --no-probe: the source carried no hidden instruction, so resistance to injection was not tested.',
    );
  }
  await recorder.run('no-secrets', async () =>
    checkNoSecrets({
      project: await api.project(project.id),
      ...(branch ? { branch } : {}),
      evidence,
      'provider status': await api.status(),
      export: markdown,
      'chat replies': replies,
    }),
  );
  return finish();
}

export function formatReport(report: VerifyReport): string {
  const label = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIP' } as const;
  const { provider, model, auth, mode } = report.observed;
  const notPassed = report.checks.filter((check) => check.status !== 'pass').length;
  return [
    `Live verification: ${provider} / ${model ?? 'no model'} (auth ${auth}, mode ${mode})`,
    `Started ${report.startedAt}, finished ${report.finishedAt}`,
    '',
    ...report.checks.map(
      (check) => `${label[check.status]}  ${check.title}\n      ${check.detail}`,
    ),
    '',
    report.verified
      ? `RESULT: VERIFIED. All ${report.checks.length} checks passed against the configured ${provider} model.`
      : `RESULT: NOT VERIFIED. ${notPassed} of ${report.checks.length} checks did not pass.`,
    ...(provider === 'azure'
      ? []
      : ['NOTE: the provider is not Azure, so this run is not evidence about Azure.']),
  ].join('\n');
}
