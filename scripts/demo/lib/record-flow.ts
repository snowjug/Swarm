import { DEMO_PROJECTS } from '../../../shared/demo.js';
import type { Intervention } from '../../../shared/types.js';
import type { RunComparison } from '../../../shared/guided.js';
import type { ChatMessage, ProjectDetail, ProviderStatus } from '../../../shared/types.js';
import { ABSTENTION_MESSAGE } from '../../../backend/src/orchestration/evidence-gate.js';
import type { Api } from './api.js';

/**
 * What is recorded. These are the analyst's inputs: they are labelled as assumptions in the
 * interface and nothing here says how the scenario will turn out. What the actors then decide, what
 * the report concludes and what the analyst answers come from the model and are recorded as found.
 */
export const STORY = {
  settings: { agentCount: 6, rounds: 6, seed: 7, network: 'community' as const },
  branchFromRound: 3,
  notice: {
    round: 4,
    label:
      'Assumed operator notice: from November to March the timetable is cut from six to four daily return sailings',
    stance: -0.6,
    strength: 0.6,
  } satisfies Intervention,
  guarantee: {
    round: 4,
    label:
      'Assumed council guarantee: six daily return sailings all winter and a fare rise capped at 5%',
    stance: 0.8,
    strength: 0.7,
  } satisfies Intervention,
  /** Stated in the sources, so a grounded answer exists. */
  analystAnswerable: 'What ceiling applies to the annual ferry subsidy, and which source says so?',
  /** Plausible, and in none of the sources. */
  analystUnsupported: 'What was ferry ridership in 2019?',
  actor: 'What would you need to hear before you accepted a reduced winter timetable?',
} as const;

export interface RecordOptions {
  question: string;
  sources: { name: string; content: string }[];
  /** A server that is not using a real model is refused unless this is set. Tests only. */
  allowLocal?: boolean;
  /**
   * Experiments from an earlier, interrupted recording on the same server. Each is finished
   * rather than made again, and a question already answered is not asked again, so a failure
   * late in a long recording costs only what it had not yet done.
   */
  resume?: { base?: string; guarantee?: string; noNotice?: string };
  stepTimeoutMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

export interface RecordedFile {
  slug: string;
  file: string;
  snapshot: Record<string, unknown>;
}

export interface Recording {
  recordedAt: string;
  provider: string;
  model: string | null;
  usage: { modelCalls: number; inputTokens: number; outputTokens: number };
  files: RecordedFile[];
  notes: string[];
}

type Step = 'knowledge' | 'environment' | 'simulation' | 'report';

interface Exported extends Record<string, unknown> {
  project: ProjectDetail;
  ledger: { claims: unknown[]; contradictions: unknown[] } | null;
  messages: ChatMessage[];
}

const seconds = (since: number): number => Math.round((Date.now() - since) / 1000);

export async function recordDemo(api: Api, options: RecordOptions): Promise<Recording> {
  const log = options.log ?? (() => undefined);
  const stepTimeoutMs = options.stepTimeoutMs ?? 20 * 60_000;
  const pollMs = options.pollMs ?? 3000;
  const [baseDemo, guaranteeDemo, noNoticeDemo] = DEMO_PROJECTS;
  if (!baseDemo || !guaranteeDemo || !noNoticeDemo)
    throw new Error('shared/demo.ts lists no demonstration.');

  const status = await api.get<ProviderStatus>('/api/provider/status');
  const real = status.mode === 'real-model';
  if (!real && !options.allowLocal) {
    throw new Error(
      `This server is in ${status.mode} mode. Recording needs a real model, so that nothing in the recording is a stand-in. Configure the provider (docs/AZURE.md) and start the server again.`,
    );
  }
  if (real) {
    await api.post('/api/provider/check');
    log(
      `Provider: ${status.provider}, deployment ${status.model}, ${status.auth} sign-in. A real round trip succeeded.`,
    );
  }

  const run = async (id: string, step: Step, resume = false): Promise<ProjectDetail> => {
    const begun = Date.now();
    await api.post(`/api/projects/${id}/steps/${step}`, resume ? { resume: true } : undefined);
    for (;;) {
      const project = await api.get<ProjectDetail>(`/api/projects/${id}`);
      const state = project.console?.steps[step];
      if (state === 'ready') {
        log(`  ${step} ready in ${seconds(begun)} s`);
        return project;
      }
      if (state === 'failed' || state === 'cancelled') {
        throw new Error(`The ${step} stage ${state}: ${project.error ?? 'no error was recorded'}`);
      }
      if (Date.now() - begun > stepTimeoutMs) {
        throw new Error(
          `The ${step} stage did not finish within ${Math.round(stepTimeoutMs / 60_000)} minutes.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };
  /** Brings an experiment to the end of `steps`, running only those that are not already done. */
  const finish = async (id: string, steps: readonly Step[], resume = false): Promise<void> => {
    for (const step of steps) {
      const project = await api.get<ProjectDetail>(`/api/projects/${id}`);
      if (project.console?.steps[step] === 'ready') continue;
      await run(id, step, resume && step === 'simulation');
    }
  };

  const baseId = options.resume?.base ?? (await createBase());
  async function createBase(): Promise<string> {
    log(`Creating "${baseDemo!.title}".`);
    const created = await api.post<ProjectDetail>('/api/projects', {
      name: baseDemo!.title,
      question: options.question,
      workflow: 'guided',
      documents: options.sources,
      settings: { mode: real ? 'llm' : 'local', ...STORY.settings, intervention: STORY.notice },
    });
    return created.id;
  }
  if (options.resume?.base) log(`Continuing "${baseDemo.title}" (${baseId.slice(0, 8)}).`);
  await finish(baseId, ['knowledge', 'environment', 'simulation', 'report']);

  log('Asking the analyst and one actor, on the finished report.');
  const base = await api.get<ProjectDetail>(`/api/projects/${baseId}`);
  // A question already answered in this conversation is read back, not asked again.
  const ask = async (target: string, message: string): Promise<ChatMessage> => {
    const held = await api.get<{ messages: ChatMessage[] }>(
      `/api/projects/${baseId}/chat?target=${encodeURIComponent(target)}`,
    );
    const at = held.messages.findIndex((item) => item.role === 'user' && item.content === message);
    const earlier = at >= 0 ? held.messages[at + 1] : undefined;
    if (earlier?.role === 'assistant') {
      log(`  "${message.slice(0, 60)}" was already answered`);
      return earlier;
    }
    const begun = Date.now();
    const body = await api.post<{ messages: ChatMessage[] }>(`/api/projects/${baseId}/chat`, {
      target,
      message,
    });
    log(`  "${message.slice(0, 60)}" answered in ${seconds(begun)} s`);
    const reply = body.messages.at(-1);
    if (!reply || reply.role !== 'assistant') throw new Error('The chat returned no reply.');
    return reply;
  };
  const answerable = await ask('report', STORY.analystAnswerable);
  const unsupported = await ask('report', STORY.analystUnsupported);
  const proxy =
    base.agents.find((agent) => /harbour|business/iu.test(`${agent.role} ${agent.name}`)) ??
    base.agents[0];
  if (!proxy) throw new Error('The base run has no actors.');
  const actor = await ask(proxy.id, STORY.actor);

  const branch = async (
    demo: typeof guaranteeDemo,
    intervention: Intervention | null,
    existing: string | undefined,
  ): Promise<string> => {
    let id = existing;
    if (id) {
      log(`Continuing "${demo.title}" (${id.slice(0, 8)}).`);
    } else {
      log(`Branching "${demo.title}" from round ${STORY.branchFromRound}.`);
      id = (
        await api.post<ProjectDetail>(`/api/projects/${baseId}/branches`, {
          name: demo.title,
          fromRound: STORY.branchFromRound,
          intervention,
        })
      ).id;
    }
    await finish(id, ['simulation', 'report'], true);
    return id;
  };
  const guaranteeId = await branch(guaranteeDemo, STORY.guarantee, options.resume?.guarantee);
  const noNoticeId = await branch(noNoticeDemo, null, options.resume?.noNotice);

  const compare = (a: string, b: string): Promise<RunComparison> =>
    api.get<RunComparison>(`/api/projects/${a}/compare?with=${b}`);
  const [againstBase, againstOther, siblings] = await Promise.all([
    compare(guaranteeId, baseId),
    compare(noNoticeId, baseId),
    compare(guaranteeId, noNoticeId),
  ]);

  const exports = await Promise.all(
    [baseId, guaranteeId, noNoticeId].map((id) =>
      api.get<Exported>(`/api/projects/${id}/export?format=json`),
    ),
  );
  const [baseExport, guaranteeExport, noNoticeExport] = exports as [Exported, Exported, Exported];

  const problems = checkContract({
    strict: real,
    rounds: STORY.settings.rounds,
    base: baseExport,
    branches: [guaranteeExport, noNoticeExport],
    comparisons: { againstBase, againstOther, siblings },
    replies: { answerable, unsupported, actor },
  });
  if (problems.length > 0) {
    throw new Error(
      `The recording does not meet the demonstration contract:\n- ${problems.join('\n- ')}`,
    );
  }

  const usage = exports.reduce(
    (total, { project }) => ({
      modelCalls: total.modelCalls + (project.execution?.modelCalls ?? 0),
      inputTokens: total.inputTokens + (project.execution?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (project.execution?.outputTokens ?? 0),
    }),
    { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
  );

  // Fixed identifiers, so that restoring always gives the same projects. Every reference to a run
  // is a UUID, so replacing the text replaces them all.
  const identifiers = new Map([
    [baseId, baseDemo.id],
    [guaranteeId, guaranteeDemo.id],
    [noNoticeId, noNoticeDemo.id],
  ]);
  const files = exports.map((exported, index): RecordedFile => {
    const demo = [baseDemo, guaranteeDemo, noNoticeDemo][index]!;
    let text = JSON.stringify({ ...exported, ledger: null });
    for (const [from, to] of identifiers) text = text.replaceAll(from, to);
    return {
      slug: demo.slug,
      file: `${demo.slug}.json`,
      snapshot: JSON.parse(text) as Record<string, unknown>,
    };
  });

  return {
    recordedAt: new Date().toISOString(),
    provider: status.provider,
    model: status.model,
    usage,
    files,
    notes: [
      `Compared with the parent, the guarantee branch is identical through round ${againstBase.identicalThroughRound} of ${STORY.settings.rounds}.`,
      `Compared with the parent, the no-notice branch is identical through round ${againstOther.identicalThroughRound} of ${STORY.settings.rounds}.`,
      `The two branches are ${siblings.lineage} and identical through round ${siblings.identicalThroughRound}.`,
    ],
  };
}

interface Contract {
  strict: boolean;
  rounds: number;
  base: Exported;
  branches: [Exported, Exported];
  comparisons: { againstBase: RunComparison; againstOther: RunComparison; siblings: RunComparison };
  replies: { answerable: ChatMessage; unsupported: ChatMessage; actor: ChatMessage };
}

/** Everything the demonstration promises, checked against what was actually recorded. */
export function checkContract(contract: Contract): string[] {
  const problems: string[] = [];
  const { base, branches, comparisons, replies } = contract;
  const baseProject = base.project;
  if (baseProject.status !== 'completed') problems.push('the base run did not complete');
  if (baseProject.agents.length < 3) problems.push('the base run has fewer than three actors');
  if (baseProject.rounds.length !== contract.rounds)
    problems.push('the base run has the wrong number of rounds');
  if (!baseProject.settings.intervention)
    problems.push('the base run has no scheduled intervention');
  if (!baseProject.report) problems.push('the base run has no report');
  if (!baseProject.documents || baseProject.documents.length < 3)
    problems.push('the base run has fewer than three sources');

  for (const [index, branch] of branches.entries()) {
    const label = `branch ${index + 1}`;
    if (branch.project.status !== 'completed') problems.push(`${label} did not complete`);
    if (branch.project.parentId !== baseProject.id)
      problems.push(`${label} does not descend from the base run`);
    if (!branch.project.report) problems.push(`${label} has no report`);
  }
  if (comparisons.againstBase.identicalThroughRound < STORY.branchFromRound) {
    problems.push('the guarantee branch differs from its parent before the branch point');
  }
  if (comparisons.againstBase.identicalThroughRound >= contract.rounds) {
    problems.push('the guarantee branch never diverged from its parent');
  }
  if (comparisons.siblings.lineage !== 'siblings')
    problems.push('the two branches are not siblings');

  if (contract.strict) {
    const claims = base.ledger?.claims.length ?? 0;
    if (claims === 0) problems.push('the base report has no checked statements');
    if ((base.ledger?.contradictions.length ?? 0) === 0) {
      problems.push('no conflict between sources was found, although two are planted');
    }
    const cited = replies.answerable.sourceIds.length + (replies.answerable.claimIds?.length ?? 0);
    if (cited === 0) problems.push('the answerable question was answered without citing a source');
    if (
      replies.unsupported.grounding?.status !== 'abstained' ||
      !replies.unsupported.content.includes(ABSTENTION_MESSAGE)
    ) {
      problems.push('the unsupported question was not answered with the abstention sentence');
    }
  }
  if (replies.actor.role !== 'assistant' || replies.actor.content.trim().length === 0) {
    problems.push('the actor gave no reply');
  }
  return problems;
}
