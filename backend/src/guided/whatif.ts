import { randomUUID } from 'node:crypto';
import type {
  BranchChange,
  BranchRequest,
  GuidedConsoleState,
  OperationTrace,
  PlatformRun,
  SimulationMemory,
  StepStatus,
} from '../../../shared/guided.js';
import {
  settingsSchema,
  type Agent,
  type Intervention,
  type ProjectDetail,
} from '../../../shared/types.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import { readCheckpoint } from './checkpoint.js';
import { combineAgents } from './simulation.js';
import { requireConsole } from './state.js';

const RESUMABLE: StepStatus[] = ['paused', 'failed', 'cancelled'];
const BRANCHABLE: StepStatus[] = ['paused', 'ready', 'failed', 'cancelled'];

/** Schedules or removes the single future intervention while the run is paused at a checkpoint. */
export function setIntervention(
  repository: Repository,
  id: string,
  input: Intervention | null,
): ProjectDetail {
  const project = repository.get(id);
  const state = requireConsole(project);
  const checkpoint = readCheckpoint(project);
  if (!RESUMABLE.includes(state.steps.simulation) || checkpoint === null) {
    throw new AppError(
      409,
      'INTERVENTION_LOCKED',
      'Pause a running simulation after at least one saved round to schedule an intervention. A finished run is never rewritten; branch it instead.',
    );
  }
  const existing = project.settings.intervention;
  if (existing && existing.round <= checkpoint) {
    throw new AppError(
      409,
      'INTERVENTION_CONFLICT',
      `This scenario already applied its one scheduled intervention at saved round ${existing.round}. Branch from an earlier round to change it.`,
    );
  }
  if (input && (input.round <= checkpoint || input.round > project.settings.rounds)) {
    throw new AppError(
      400,
      'INVALID_INTERVENTION',
      `Choose a round from ${checkpoint + 1} to ${project.settings.rounds}; earlier rounds are already saved.`,
    );
  }
  const settings = settingsSchema.parse({ ...project.settings, intervention: input });
  repository.update(id, { settings });
  repository.addEvent(
    id,
    'simulation',
    input
      ? `Intervention scheduled for round ${input.round} (assumed stance ${input.stance.toFixed(2)}, strength ${input.strength.toFixed(2)}): ${input.label}`
      : 'Scheduled intervention removed.',
  );
  return repository.get(id);
}

function resolveIntervention(
  current: Intervention | null,
  requested: Intervention | null | undefined,
  fromRound: number,
): Intervention | null {
  if (requested === undefined) return current;
  if (current && current.round <= fromRound) {
    throw new AppError(
      409,
      'INTERVENTION_CONFLICT',
      `The source run already applied its one scheduled intervention at round ${current.round}. Branch from round ${current.round - 1} or earlier to change it.`,
    );
  }
  if (requested && requested.round <= fromRound) {
    throw new AppError(
      400,
      'INVALID_INTERVENTION',
      `The intervention must happen after the branch point (round ${fromRound + 1} or later).`,
    );
  }
  return requested;
}

function platformAt(
  run: PlatformRun,
  round: number,
  minutesPerRound: number,
  definitions: Agent[],
  memories: SimulationMemory[],
  overrides: Map<string, number>,
): PlatformRun {
  const snapshot = round > 0 ? run.rounds[round - 1] : undefined;
  if (round > 0 && !snapshot) {
    throw new AppError(409, 'BRANCH_NOT_READY', 'The saved platform history is incomplete.');
  }
  const agents = definitions.map((definition): Agent => {
    const saved = snapshot?.opinions.find((item) => item.agentId === definition.id)?.opinion;
    const memory = memories
      .filter(
        (item) =>
          item.kind === 'action' &&
          item.platform === run.platform &&
          item.agentId === definition.id &&
          item.round <= round,
      )
      .sort((left, right) => left.round - right.round)
      .map((item) => item.text)
      .slice(-4);
    return {
      ...definition,
      opinion: overrides.get(definition.id) ?? saved ?? definition.initialOpinion,
      memory,
    };
  });
  return {
    ...run,
    status: round === 0 ? 'ready' : 'paused',
    currentRound: round,
    elapsedMinutes: round * minutesPerRound,
    agents,
    rounds: run.rounds.slice(0, round),
  };
}

/**
 * Creates an independent scenario that copies the source run's saved state through `fromRound`
 * and applies the requested assumption changes only to the rounds that follow. The source run is
 * never modified, so history stays auditable.
 */
export function createBranch(
  repository: Repository,
  id: string,
  input: BranchRequest,
): ProjectDetail {
  const parent = repository.get(id);
  const state = requireConsole(parent);
  const environment = state.environment;
  const { fromRound } = input;
  const total = parent.settings.rounds;
  if (!environment || state.steps.environment !== 'ready' || !parent.agents.length) {
    throw new AppError(
      409,
      'BRANCH_NOT_READY',
      'Prepare the environment before branching a scenario.',
    );
  }
  if (fromRound >= total) {
    throw new AppError(
      400,
      'INVALID_BRANCH_ROUND',
      `Branch from round 0 to ${total - 1} so at least one round remains to simulate.`,
    );
  }
  if (fromRound > 0) {
    const checkpoint = readCheckpoint(parent);
    if (checkpoint === null || !BRANCHABLE.includes(state.steps.simulation)) {
      throw new AppError(
        409,
        'BRANCH_NOT_READY',
        'Pause the simulation (or let it finish) so a consistent checkpoint exists before branching.',
      );
    }
    if (fromRound > checkpoint) {
      throw new AppError(
        400,
        'INVALID_BRANCH_ROUND',
        `Only ${checkpoint} round(s) are saved; choose a branch point from 0 to ${checkpoint}.`,
      );
    }
  }
  const knownIds = new Set(parent.agents.map((agent) => agent.id));
  const unknown = input.agentEdits.find((edit) => !knownIds.has(edit.id));
  if (unknown) {
    throw new AppError(400, 'INVALID_POPULATION', `${unknown.id} is not part of this population.`);
  }

  const changes: BranchChange[] = [];
  const intervention = resolveIntervention(
    parent.settings.intervention,
    input.intervention,
    fromRound,
  );
  if (JSON.stringify(intervention) !== JSON.stringify(parent.settings.intervention)) {
    changes.push({ kind: 'intervention', from: parent.settings.intervention, to: intervention });
  }
  const settings = settingsSchema.parse({ ...parent.settings, intervention });

  const overrides = new Map<string, number>();
  const definitions = parent.agents.map((agent): Agent => {
    const edit = input.agentEdits.find((item) => item.id === agent.id);
    if (!edit) return agent;
    for (const field of ['influence', 'openness'] as const) {
      const to = edit[field];
      if (to !== undefined && to !== agent[field]) {
        changes.push({ kind: 'agent', agentId: agent.id, field, from: agent[field], to });
      }
    }
    const current =
      fromRound === 0
        ? agent.initialOpinion
        : (parent.rounds[fromRound - 1]?.opinions.find((item) => item.agentId === agent.id)
            ?.opinion ?? agent.opinion);
    if (edit.opinion !== undefined && edit.opinion !== current) {
      changes.push({
        kind: 'agent',
        agentId: agent.id,
        field: 'opinion',
        from: current,
        to: edit.opinion,
      });
      overrides.set(agent.id, edit.opinion);
    }
    return {
      ...agent,
      influence: edit.influence ?? agent.influence,
      openness: edit.openness ?? agent.openness,
      initialOpinion:
        fromRound === 0 && edit.opinion !== undefined ? edit.opinion : agent.initialOpinion,
    };
  });

  const platforms = state.platforms.map((run) =>
    platformAt(run, fromRound, environment.minutesPerRound, definitions, state.memories, overrides),
  );
  const agents =
    fromRound === 0
      ? definitions.map((agent) => ({ ...agent, opinion: agent.initialOpinion, memory: [] }))
      : combineAgents(definitions, platforms);

  const now = new Date().toISOString();
  const trace: OperationTrace = {
    id: randomUUID(),
    step: 'simulation',
    kind: 'review',
    name: `Branched from "${parent.name}" after round ${fromRound}`,
    status: 'completed',
    startedAt: now,
    completedAt: now,
    input: { parentId: parent.id, fromRound, declaredChanges: changes.length },
    output: { inheritedRounds: fromRound },
    error: null,
  };
  const consoleState: GuidedConsoleState = {
    ...state,
    steps: {
      knowledge: 'ready',
      environment: 'ready',
      simulation: fromRound === 0 ? 'pending' : 'paused',
      report: 'pending',
      interaction: 'pending',
    },
    activeStep: 'simulation',
    branch: {
      parentId: parent.id,
      parentName: parent.name,
      rootId: state.branch?.rootId ?? parent.id,
      fromRound,
      createdAt: now,
      changes,
    },
    environment: { ...environment, edited: environment.edited || input.agentEdits.length > 0 },
    platforms: fromRound === 0 ? [] : platforms,
    memories: state.memories.filter((memory) => memory.round <= fromRound),
    traces: [
      ...state.traces.filter((item) => item.step === 'knowledge' || item.step === 'environment'),
      trace,
    ].slice(-120),
    reportPlan: null,
    interviews: [],
    surveys: [],
  };

  const child = repository.create(
    {
      name: (input.name ?? `${parent.name.slice(0, 70)} · branch r${fromRound}`).slice(0, 100),
      question: parent.question,
      workflow: 'guided',
      settings,
      documents: parent.documents.map((document) => ({
        name: document.name,
        content: document.content,
        ...(document.pageCount ? { pageCount: document.pageCount } : {}),
      })),
    },
    { inheritChunksFrom: parent.id },
  );
  try {
    repository.update(child.id, {
      graph: parent.graph,
      agents,
      rounds: parent.rounds.slice(0, fromRound),
      currentRound: fromRound,
      status: 'ready',
      stage: fromRound === 0 ? 'personas' : 'simulation',
      progress: fromRound === 0 ? 40 : 40 + Math.floor((fromRound / total) * 44),
      execution: parent.execution
        ? { ...parent.execution, modelCalls: 0, inputTokens: 0, outputTokens: 0 }
        : null,
      console: consoleState,
    });
  } catch (error) {
    repository.delete(child.id);
    throw error;
  }
  repository.addEvent(
    child.id,
    'simulation',
    fromRound === 0
      ? `Branched from "${parent.name}" before round 1 with edited assumptions; start the simulation to run all ${total} rounds.`
      : `Branched from "${parent.name}" after round ${fromRound}. Rounds 1-${fromRound} are copied unchanged; resume to simulate rounds ${fromRound + 1}-${total}.`,
  );
  return repository.get(child.id);
}
