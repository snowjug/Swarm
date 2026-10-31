import {
  critiqueSchema,
  type Critique,
  type CritiqueSet,
  type CritiquesView,
} from '../../../shared/critique';
import type { CritiquesState } from '../hooks/useCritiques';

export function critiqueFixture(overrides: Partial<Critique> = {}): Critique {
  return critiqueSchema.parse({
    id: 'methodology-rules-only',
    role: 'methodology',
    target: { kind: 'analysis', id: 'analysis-1' },
    severity: 'minor',
    objection: 'Every outcome is a mechanical consequence of the declared assumptions.',
    basis: ['Engine: rules; key actors: rules; cohorts: rules.'],
    evidence: [],
    origin: 'rules',
    status: 'open',
    response: null,
    remainingDisagreement: null,
    impactOnConclusion: 'If this stands, the findings are consistency checks on the assumptions.',
    createdAt: '2026-02-01T09:00:00.000Z',
    ...overrides,
  });
}

export function setFixture(
  critiques: Critique[],
  overrides: Partial<CritiqueSet> = {},
): CritiqueSet {
  return {
    analysisId: 'analysis-1',
    generatedAt: '2026-02-01T09:00:00.000Z',
    mode: 'rules',
    critiques,
    ...overrides,
  };
}

export function viewFixture(overrides: Partial<CritiquesView> = {}): CritiquesView {
  return {
    critiques: setFixture([critiqueFixture()]),
    analysis: { id: 'analysis-1', completedAt: '2026-02-01T08:00:00.000Z' },
    may: { run: true, respond: true },
    model: { available: false },
    ...overrides,
  };
}

export function stateFixture(overrides: Partial<CritiquesState> = {}): CritiquesState {
  return {
    view: viewFixture(),
    loading: false,
    error: null,
    running: false,
    runError: null,
    answering: null,
    answerError: null,
    reload: () => undefined,
    run: async () => undefined,
    respond: async () => true,
    ...overrides,
  };
}
