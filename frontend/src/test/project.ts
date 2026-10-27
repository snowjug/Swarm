import { emptyConsole } from '../../../shared/guided';
import type { ProjectDetail, RoundSnapshot } from '../../../shared/types';

export function roundFixture(round = 1): RoundSnapshot {
  return {
    round,
    meanOpinion: 0.2,
    supportShare: 0.5,
    oppositionShare: 0.25,
    undecidedShare: 0.25,
    polarization: 0.3,
    activityCount: 1,
    interactions: 1,
    opinions: [{ agentId: 'agent-1', opinion: 0.2 }],
    actions: [],
    intervention: null,
  };
}

export function checkpointFixture(): ProjectDetail {
  const project = projectFixture();
  project.status = 'ready';
  project.stage = 'simulation';
  project.currentRound = 1;
  project.rounds = [roundFixture()];
  project.console!.steps.knowledge = 'ready';
  project.console!.steps.environment = 'ready';
  project.console!.steps.simulation = 'paused';
  project.console!.activeStep = 'simulation';
  return project;
}

export function projectFixture(): ProjectDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test-only fictional scenario',
    question: 'How does this synthetic test scenario behave?',
    workflow: 'guided',
    parentId: null,
    status: 'draft',
    stage: 'intake',
    progress: 0,
    mode: 'local',
    agentCount: 4,
    roundCount: 3,
    currentRound: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    error: null,
    settings: {
      mode: 'local',
      agentCount: 4,
      rounds: 3,
      seed: 42,
      network: 'community',
      intervention: null,
    },
    documents: [
      {
        id: 'doc-1',
        name: 'test.txt',
        content:
          'This is synthetic source material used only in frontend tests. No application result is prefilled from this fixture.',
      },
    ],
    graph: {
      method: 'lexical',
      nodes: [
        {
          id: 'topic-1',
          label: 'Synthetic topic',
          kind: 'topic',
          summary: 'Test source topic.',
          weight: 1,
          sourceIds: ['S1'],
        },
        {
          id: 'topic-2',
          label: 'Other topic',
          kind: 'topic',
          summary: 'Another test topic.',
          weight: 1,
          sourceIds: ['S1'],
        },
      ],
      edges: [
        { source: 'topic-1', target: 'topic-2', label: 'co-occurs', weight: 1, sourceIds: ['S1'] },
      ],
      notes: ['Synthetic test input.'],
    },
    agents: [
      {
        id: 'agent-1',
        name: 'Test Proxy',
        role: 'Fictional participant',
        persona: 'A fictional proxy defined only for automated frontend validation.',
        topicIds: ['topic-1'],
        initialOpinion: 0.2,
        opinion: 0.3,
        influence: 1,
        openness: 0.5,
        memory: [],
        sourceIds: ['S1'],
      },
    ],
    rounds: [],
    report: null,
    events: [],
    execution: null,
    console: emptyConsole(),
  };
}
