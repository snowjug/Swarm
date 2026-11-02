import { emptyConsole } from '../../../../../shared/guided';
import type { PlatformRun, SimulationMemory, StepStatus } from '../../../../../shared/guided';
import type {
  Agent,
  AgentAction,
  Intervention,
  ProjectDetail,
  RoundSnapshot,
} from '../../../../../shared/types';
import { projectFixture } from '../../../test/project';

/** A guided deep dive with real-looking, hand-made records, for tests of the pure logic and of what is drawn. */

const PROXIES: {
  id: string;
  name: string;
  role: string;
  start: number;
  influence: number;
  openness: number;
}[] = [
  {
    id: 'agent-1',
    name: 'Regulators',
    role: 'Regulator: sets the rules the change has to meet',
    start: -0.6,
    influence: 1.4,
    openness: 0.2,
  },
  {
    id: 'agent-2',
    name: 'Competitors',
    role: 'Competitor: responds in its own interest',
    start: -0.1,
    influence: 1.0,
    openness: 0.4,
  },
  {
    id: 'agent-3',
    name: 'Administrators',
    role: 'Operations: carries the change out day to day',
    start: 0.2,
    influence: 0.8,
    openness: 0.5,
  },
  {
    id: 'agent-4',
    name: 'Clients',
    role: 'End user: lives with what the change alters',
    start: 0.7,
    influence: 0.6,
    openness: 0.3,
  },
];

export function agentsFixture(): Agent[] {
  return PROXIES.map((proxy, index) => ({
    id: proxy.id,
    name: proxy.name,
    role: proxy.role,
    persona: `A fictional proxy for ${proxy.name.toLowerCase()}, defined only for tests of the deep dive screens.`,
    topicIds: ['topic-1'],
    initialOpinion: proxy.start,
    opinion: proxy.start,
    influence: proxy.influence,
    openness: proxy.openness,
    memory: [],
    sourceIds: index % 2 === 0 ? ['S1'] : ['S1', 'S2'],
  }));
}

function snapshot(
  round: number,
  opinions: number[],
  actions: AgentAction[],
  intervention: Intervention | null = null,
): RoundSnapshot {
  const mean = opinions.reduce((sum, value) => sum + value, 0) / opinions.length;
  const support = opinions.filter((value) => value >= 0.2).length;
  const opposition = opinions.filter((value) => value <= -0.2).length;
  return {
    round,
    meanOpinion: mean,
    supportShare: support / opinions.length,
    oppositionShare: opposition / opinions.length,
    undecidedShare: (opinions.length - support - opposition) / opinions.length,
    polarization: Math.sqrt(
      opinions.reduce((sum, value) => sum + (value - mean) ** 2, 0) / opinions.length,
    ),
    activityCount: actions.filter((action) => action.type !== 'observe').length,
    interactions: actions.reduce((sum, action) => sum + action.peerIds.length, 0),
    opinions: opinions.map((opinion, index) => ({ agentId: PROXIES[index]!.id, opinion })),
    actions,
    intervention,
  };
}

/** Each proxy moves a fifth of the way to the mean each round, so that the figures change but stay plain. */
function evolve(platform: string, rounds: number, event: Intervention | null): RoundSnapshot[] {
  let opinions = PROXIES.map((proxy) => proxy.start);
  const out: RoundSnapshot[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const mean = opinions.reduce((sum, value) => sum + value, 0) / opinions.length;
    const applied = event?.round === round ? event : null;
    const next = opinions.map((value, index) => {
      const pull = (mean - value) * (platform === 'plaza' ? 0.2 : 0.3);
      const push = applied ? applied.strength * (applied.stance - value) * 0.6 : 0;
      return Math.max(-1, Math.min(1, value + pull + push + index * 0.001));
    });
    const actions: AgentAction[] = next.map((opinion, index) => ({
      id: `${platform}-round-${round}-${PROXIES[index]!.id}`,
      round,
      agentId: PROXIES[index]!.id,
      type: Math.abs(opinion - opinions[index]!) >= 0.005 ? 'update' : 'observe',
      content: `Rule-based state update: inclination ${opinions[index]!.toFixed(3)} to ${opinion.toFixed(3)} after 3 peer exposures.`,
      opinion,
      peerIds: PROXIES.filter((other) => other.id !== PROXIES[index]!.id)
        .slice(0, 3)
        .map((other) => other.id),
      sourceIds: ['S1'],
    }));
    out.push(snapshot(round, next, actions, applied));
    opinions = next;
  }
  return out;
}

const platformStatus = (simulation: StepStatus): PlatformRun['status'] => {
  switch (simulation) {
    case 'ready':
      return 'completed';
    case 'paused':
    case 'failed':
    case 'cancelled':
      return simulation;
    case 'running':
      return 'running';
    default:
      return 'ready';
  }
};

export interface DeepFixtureOptions {
  rounds?: number;
  saved?: number;
  event?: Intervention | null;
  simulation?: StepStatus;
  environment?: StepStatus;
  report?: StepStatus;
  mode?: 'local' | 'llm';
}

export function deepFixture(options: DeepFixtureOptions = {}): ProjectDetail {
  const total = options.rounds ?? 6;
  const saved = options.saved ?? total;
  const event = options.event ?? null;
  const simulation = options.simulation ?? (saved >= total ? 'ready' : 'paused');
  const project = projectFixture();
  const agents = agentsFixture();
  const roundsByPlatform = {
    plaza: evolve('plaza', saved, event).slice(0, saved),
    community: evolve('community', saved, event).slice(0, saved),
  };
  const combined = roundsByPlatform.plaza.map((round, index) => {
    const other = roundsByPlatform.community[index]!;
    return snapshot(
      round.round,
      round.opinions.map((item, at) => (item.opinion + other.opinions[at]!.opinion) / 2),
      [...round.actions, ...other.actions],
      round.intervention,
    );
  });
  const runs: PlatformRun[] = (['plaza', 'community'] as const).map((id) => ({
    platform: id,
    label: id === 'plaza' ? 'Info Plaza' : 'Topic Community',
    network: id === 'plaza' ? 'broadcast' : 'community',
    status: platformStatus(simulation),
    currentRound: saved,
    elapsedMinutes: saved * 60,
    agents: agents.map((agent) => ({
      ...agent,
      opinion:
        roundsByPlatform[id].at(-1)?.opinions.find((item) => item.agentId === agent.id)?.opinion ??
        agent.initialOpinion,
    })),
    rounds: roundsByPlatform[id],
  }));
  const memories: SimulationMemory[] = [
    ...(['plaza', 'community'] as const).map((id): SimulationMemory => ({
      id: `M-${id}-0-seed-P1`,
      platform: id,
      round: 0,
      simulatedMinute: 0,
      kind: 'seed',
      agentId: null,
      actionType: 'seed',
      text: 'Source context, not a simulated opinion: the office brief assumes a hypothetical change.',
      opinion: 0,
      peerIds: [],
      sourceIds: ['S1'],
    })),
    ...runs.flatMap((run) =>
      run.rounds.flatMap((round) =>
        round.actions.map((action): SimulationMemory => ({
          id: `M-${run.platform}-${round.round}-${action.agentId}`,
          platform: run.platform,
          round: round.round,
          simulatedMinute: round.round * 60,
          kind: 'action',
          agentId: action.agentId,
          actionType: action.type,
          text: action.content,
          opinion: action.opinion,
          peerIds: action.peerIds,
          sourceIds: action.sourceIds,
        })),
      ),
    ),
  ];
  const state = emptyConsole();
  state.steps = {
    knowledge: 'ready',
    environment: options.environment ?? 'ready',
    simulation,
    report: options.report ?? 'pending',
    interaction: 'pending',
  };
  state.activeStep = 'simulation';
  state.environment = {
    minutesPerRound: 60,
    platforms: ['plaza', 'community'],
    initialPosts: [
      {
        id: 'P1',
        text: 'Source context, not a simulated opinion: the office brief assumes a hypothetical change.',
        platform: 'both',
        stance: 0.2,
        strength: 0.4,
        sourceIds: ['S1'],
      },
    ],
    generatedBy: 'local',
    edited: false,
  };
  state.platforms = runs;
  state.memories = memories;
  state.traces = [
    {
      id: 'trace-1',
      step: 'simulation',
      kind: 'simulation',
      name: 'Info Plaza: round 1',
      status: 'completed',
      startedAt: '2026-01-01T00:00:01Z',
      completedAt: '2026-01-01T00:00:02Z',
      input: { platform: 'plaza', round: 1 },
      output: { meanOpinion: 0.01 },
      error: null,
    },
  ];
  return {
    ...project,
    name: 'Deep dive test scenario',
    status:
      simulation === 'running' ||
      simulation === 'queued' ||
      simulation === 'failed' ||
      simulation === 'cancelled'
        ? simulation
        : simulation === 'ready' && options.report === 'ready'
          ? 'completed'
          : 'ready',
    stage: 'simulation',
    mode: options.mode ?? 'local',
    settings: {
      ...project.settings,
      mode: options.mode ?? 'local',
      rounds: total,
      agentCount: agents.length,
      intervention: event,
    },
    agentCount: agents.length,
    roundCount: total,
    currentRound: saved,
    agents: agents.map((agent) => ({
      ...agent,
      opinion:
        combined.at(-1)?.opinions.find((item) => item.agentId === agent.id)?.opinion ??
        agent.initialOpinion,
    })),
    rounds: combined,
    events: [
      {
        id: 1,
        projectId: project.id,
        stage: 'simulation',
        message: 'Round 1 persisted.',
        createdAt: '2026-01-01T00:00:02Z',
      },
    ],
    console: state,
  };
}
