import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type {
  EnvironmentConfig,
  PlatformRun,
  SeedPost,
  SimulationMemory,
} from '../../../shared/guided.js';
import type { Agent, ProjectDetail, RoundSnapshot } from '../../../shared/types.js';
import { localRound } from '../agents/local.js';
import { modelRound } from '../agents/model.js';
import { clamp, makeSnapshot, mean } from '../agents/state.js';
import { AppError, throwIfAborted } from '../errors.js';
import type { ModelGateway } from '../models/client.js';
import type { Repository } from '../storage/repository.js';
import { requireConsole, traceOperation, updateConsole } from './state.js';
import { searchMemories } from './tools.js';

function postsFor(config: EnvironmentConfig, platform: PlatformRun['platform']): SeedPost[] {
  return config.initialPosts.filter(
    (post) => post.platform === 'both' || post.platform === platform,
  );
}

function seedInclinations(agents: Agent[], posts: SeedPost[]): Agent[] {
  const weight = posts.reduce((sum, post) => sum + post.strength, 0);
  if (!weight) return agents;
  const target = posts.reduce((sum, post) => sum + post.stance * post.strength, 0) / weight;
  return agents.map((agent) => ({
    ...agent,
    opinion: clamp(agent.opinion + (target - agent.opinion) * Math.min(0.6, weight * 0.15)),
  }));
}

function aggregate(runs: PlatformRun[], round: number, project: ProjectDetail) {
  const agents = project.agents.map((agent): Agent => {
    const versions = runs.map((run) => {
      const version = run.agents.find((item) => item.id === agent.id);
      if (!version) throw new Error('Platform populations must share the prepared proxy IDs.');
      return { run, agent: version };
    });
    return {
      ...agent,
      opinion: mean(versions.map((version) => version.agent.opinion)),
      memory: versions
        .flatMap((version) =>
          version.agent.memory.slice(-2).map((entry) => `[${version.run.label}] ${entry}`),
        )
        .slice(-4),
    };
  });
  const actions = runs.flatMap((run) => {
    const snapshot = run.rounds.at(-1);
    if (!snapshot || snapshot.round !== round) throw new Error('Platform rounds are out of sync.');
    return snapshot.actions;
  });
  return {
    agents,
    snapshot: makeSnapshot(
      round,
      agents,
      actions,
      project.settings.intervention?.round === round ? project.settings.intervention : null,
    ),
  };
}

export async function runPlatforms(
  repository: Repository,
  id: string,
  model: ModelGateway | null,
  signal: AbortSignal,
): Promise<void> {
  const project = repository.get(id);
  const state = requireConsole(project);
  const environment = state.environment;
  if (!environment || !project.agents.length)
    throw new AppError(409, 'ENVIRONMENT_NOT_READY', 'Prepare the environment first.');
  const base = project.agents.map((agent) => ({
    ...agent,
    opinion: agent.initialOpinion,
    memory: [],
  }));
  let runs: PlatformRun[] = environment.platforms.map((platform) => ({
    platform,
    label: platform === 'plaza' ? 'Info Plaza' : 'Topic Community',
    network: platform === 'plaza' ? 'broadcast' : 'community',
    status: 'running',
    currentRound: 0,
    elapsedMinutes: 0,
    agents: base.map((agent) => ({ ...agent, memory: [] })),
    rounds: [],
  }));
  const seeds: SimulationMemory[] = runs.flatMap((run) =>
    postsFor(environment, run.platform).map((post) => ({
      id: `M-${run.platform}-0-seed-${post.id}`,
      platform: run.platform,
      round: 0,
      simulatedMinute: 0,
      kind: 'seed' as const,
      agentId: null,
      actionType: 'seed' as const,
      text: post.text,
      opinion: post.stance,
      peerIds: [],
      sourceIds: post.sourceIds,
    })),
  );
  repository.update(id, { agents: base, rounds: [], report: null, currentRound: 0 });
  updateConsole(repository, id, (current) => ({
    ...current,
    platforms: runs,
    memories: seeds,
    reportPlan: null,
    interviews: [],
  }));
  const chunks = repository.chunks(id);
  for (let round = 1; round <= project.settings.rounds; round += 1) {
    throwIfAborted(signal);
    const current = repository.get(id);
    const memories = requireConsole(current).memories;
    const roundController = new AbortController();
    const roundSignal = AbortSignal.any([signal, roundController.signal]);
    let primaryError: unknown = null;
    const settled = await Promise.allSettled(
      runs.map(async (run) => {
        try {
          const inputAgents =
            !model && round === 1
              ? seedInclinations(run.agents, postsFor(environment, run.platform))
              : run.agents;
          const input: ProjectDetail = {
            ...current,
            agents: inputAgents,
            rounds: run.rounds,
            settings: { ...project.settings, network: run.network },
          };
          const result = await traceOperation(
            repository,
            id,
            'simulation',
            model ? 'model' : 'simulation',
            `${run.label}: round ${round}`,
            { platform: run.platform, round, network: run.network, mode: project.mode },
            () =>
              model
                ? modelRound(model, input, chunks, round, roundSignal, {
                    platform: run.platform,
                    simulatedMinute: round * environment.minutesPerRound,
                    initialPosts: postsFor(environment, run.platform),
                    memories: searchMemories(memories, project.question, 4, run.platform),
                  })
                : localRound(inputAgents, input.settings, round),
            (output) => ({
              meanOpinion: output.snapshot.meanOpinion,
              actions: output.snapshot.actions.length,
              interactions: output.snapshot.interactions,
              sourceIds: [
                ...new Set(output.snapshot.actions.flatMap((action) => action.sourceIds)),
              ],
            }),
          );
          throwIfAborted(roundSignal);
          const snapshot: RoundSnapshot = {
            ...result.snapshot,
            actions: result.snapshot.actions.map((action) => ({
              ...action,
              id: `${run.platform}-${action.id}`,
            })),
          };
          return {
            ...run,
            agents: result.agents,
            currentRound: round,
            elapsedMinutes: round * environment.minutesPerRound,
            rounds: [...run.rounds, snapshot],
          };
        } catch (error) {
          if (primaryError === null) primaryError = error;
          roundController.abort(error);
          throw error;
        }
      }),
    );
    if (primaryError !== null) throw primaryError;
    runs = settled.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    throwIfAborted(signal);
    const combined = aggregate(runs, round, project);
    const additions: SimulationMemory[] = runs.flatMap((run) =>
      (run.rounds.at(-1)?.actions || []).map((action) => ({
        id: `M-${run.platform}-${round}-${action.agentId}`,
        platform: run.platform,
        round,
        simulatedMinute: run.elapsedMinutes,
        kind: 'action',
        agentId: action.agentId,
        actionType: action.type,
        text: action.content,
        opinion: action.opinion,
        peerIds: action.peerIds,
        sourceIds: action.sourceIds,
      })),
    );
    repository.update(id, {
      agents: combined.agents,
      rounds: [...repository.get(id).rounds, combined.snapshot],
      currentRound: round,
      progress: 40 + Math.floor((round / project.settings.rounds) * 44),
    });
    updateConsole(repository, id, (latest) => ({
      ...latest,
      platforms: runs,
      memories: [...latest.memories, ...additions],
    }));
    repository.addEvent(
      id,
      'simulation',
      `Round ${round}/${project.settings.rounds} persisted across ${runs.length} independent platform context(s); ${additions.length} synthetic action memories recorded.`,
    );
    await yieldToLoop(undefined, { signal });
  }
  updateConsole(repository, id, (latest) => ({
    ...latest,
    platforms: runs.map((run) => ({ ...run, status: 'completed' })),
  }));
}
