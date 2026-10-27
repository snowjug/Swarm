import type { GroundedClaim, GroundingReview } from '../../../../shared/grounding.js';
import { emptyConsole, type PlatformRun } from '../../../../shared/guided.js';
import type {
  Agent,
  AgentAction,
  EvidenceChunk,
  ProjectDetail,
  ProviderStatus,
  RoundSnapshot,
} from '../../../../shared/types.js';
import { SYNTHETIC_SOURCE, type ScenarioSize } from '../verify-scenario.js';

export const MODEL = 'gpt-test';
export const QUOTE = 'The Library Service proposes opening until nine in the evening';

export function buildStatus(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    mode: 'real-model',
    provider: 'azure',
    model: MODEL,
    auth: 'entra',
    configured: true,
    connectivity: 'unverified',
    lastCheckedAt: null,
    lastLatencyMs: null,
    lastError: null,
    counters: {
      calls: 0,
      repairCalls: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokensReported: false,
    },
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export const EVIDENCE: EvidenceChunk[] = [
  {
    id: 'S1',
    documentId: 'D1',
    documentName: 'library-notes.md',
    text: SYNTHETIC_SOURCE,
    start: 0,
    end: SYNTHETIC_SOURCE.length,
  },
];

function agentOf(index: number): Agent {
  return {
    id: `agent-${index}`,
    name: `Fictional proxy ${index}`,
    role: 'Neighbour',
    persona: 'A fictional resident created for this synthetic scenario.',
    topicIds: [],
    initialOpinion: 0,
    opinion: 0.1,
    influence: 1,
    openness: 0.5,
    memory: [],
    sourceIds: ['S1'],
  };
}

function actionOf(round: number, agentId: string, platform: string): AgentAction {
  return {
    id: `${platform}-r${round}-${agentId}`,
    round,
    agentId,
    type: 'post',
    content: `${agentId} shares a view in round ${round}.`,
    opinion: 0.1 * round,
    peerIds: [],
    sourceIds: ['S1'],
    rationale: 'Reacts to the proposed evening hours it was shown.',
    confidence: 0.6,
  };
}

function snapshots(size: ScenarioSize, platform: string): RoundSnapshot[] {
  return Array.from({ length: size.rounds }, (_, index) => {
    const round = index + 1;
    const actions = Array.from({ length: size.agents }, (_unused, agent) =>
      actionOf(round, `agent-${agent + 1}`, platform),
    );
    return {
      round,
      meanOpinion: 0.1 * round,
      supportShare: 0.5,
      oppositionShare: 0.25,
      undecidedShare: 0.25,
      polarization: 0.2,
      activityCount: actions.length,
      interactions: 0,
      opinions: actions.map((action) => ({ agentId: action.agentId, opinion: action.opinion })),
      actions,
      intervention: null,
    };
  });
}

function claim(index: number, overrides: Partial<GroundedClaim> = {}): GroundedClaim {
  return {
    id: `C${index}`,
    section: 'Findings',
    text: `The source proposes longer weekday evening hours (statement ${index}).`,
    kind: 'source-fact',
    sourceIds: ['S1'],
    memoryIds: [],
    quote: QUOTE,
    verdict: 'supported',
    checks: { quote: 'found', overlap: 0.9, numbers: null, entailment: 'supports' },
    reason: 'The quote was found verbatim and the independent check agreed.',
    ...overrides,
  };
}

export function buildReview(): GroundingReview {
  return {
    checkedAt: '2026-01-01T00:00:00.000Z',
    method: 'deterministic+model',
    claims: [claim(1), claim(2)],
    counts: { supported: 2, partial: 0, unsupported: 0, contradicted: 0, unchecked: 0 },
    unverifiedFigures: [],
    notes: ['Only the first 30 statements are checked.'],
  };
}

/** A finished model project in the exact shape the application returns. */
export function buildProject(
  id: string,
  size: ScenarioSize,
  status: ProviderStatus,
): ProjectDetail {
  const agents = Array.from({ length: size.agents }, (_, index) => agentOf(index + 1));
  const platform = (name: 'plaza' | 'community'): PlatformRun => ({
    platform: name,
    label: name === 'plaza' ? 'Plaza' : 'Community',
    network: name === 'plaza' ? 'broadcast' : 'community',
    status: 'completed',
    currentRound: size.rounds,
    elapsedMinutes: size.rounds * 30,
    agents,
    rounds: snapshots(size, name),
  });
  const state = emptyConsole();
  state.platforms = [platform('plaza'), platform('community')];
  return {
    id,
    name: 'Live verification (synthetic)',
    workflow: 'guided',
    question: 'How might fictional community groups respond?',
    status: 'completed',
    stage: 'complete',
    progress: 100,
    mode: 'llm',
    agentCount: size.agents,
    roundCount: size.rounds,
    currentRound: size.rounds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    error: null,
    parentId: null,
    settings: {
      mode: 'llm',
      agentCount: size.agents,
      rounds: size.rounds,
      seed: 42,
      network: 'community',
      intervention: null,
    },
    documents: [{ id: 'D1', name: 'library-notes.md', content: SYNTHETIC_SOURCE }],
    graph: {
      method: 'llm',
      nodes: [
        {
          id: 'n1',
          label: 'Library Service',
          kind: 'organization',
          summary: 'The service proposing the change.',
          weight: 1,
          sourceIds: ['S1'],
          quote: QUOTE,
        },
      ],
      edges: [],
      notes: [],
    },
    agents,
    rounds: snapshots(size, 'plaza'),
    report: {
      generatedBy: 'llm',
      title: 'Synthetic scenario report',
      executiveSummary: 'A conditional reading of a fictional scenario.',
      sections: [],
      limitations: ['Synthetic scenario, not a calibrated forecast.'],
      grounding: buildReview(),
      metrics: {
        initialMean: 0,
        finalMean: 0.3,
        finalSupport: 0.5,
        finalOpposition: 0.25,
        polarization: 0.2,
        totalInteractions: 0,
      },
    },
    events: [],
    execution: {
      provider: status.provider,
      model: status.model,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    console: state,
  };
}

export const MARKDOWN = [
  '# Synthetic scenario report',
  '> Synthetic scenario, not a calibrated forecast.',
  '## Grounding review',
  '2 statements checked.',
].join('\n');
