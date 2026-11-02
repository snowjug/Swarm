import { describe, expect, it } from 'vitest';
import type { SurveyRecord } from '../../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../../shared/types';
import { projectFixture } from '../../test/project';
import {
  along,
  availability,
  awaiting,
  canStartSurvey,
  engineNote,
  groundingView,
  maxTargets,
  parseReply,
  positionOf,
  resolveSeed,
  splitRole,
  suggestions,
  wordStep,
  words,
} from './chatView';

const config = (
  patch: {
    configured?: boolean;
    modelAssisted?: boolean;
    surveys?: boolean;
    targets?: number;
  } = {},
): AppConfig =>
  ({
    provider: { configured: patch.configured ?? false },
    capabilities: { modelAssisted: patch.modelAssisted ?? false, surveys: patch.surveys ?? true },
    limits: { maxSurveyTargets: patch.targets ?? 5 },
  }) as unknown as AppConfig;

const written = (patch: Partial<ProjectDetail> = {}): ProjectDetail => ({
  ...projectFixture(),
  status: 'completed',
  report: {
    sections: [{ title: 'Scenario' }, { title: 'Observed trajectory' }, { title: 'Mechanism' }],
    limitations: ['Synthetic actors.'],
  } as unknown as ProjectDetail['report'],
  agents: [
    { ...projectFixture().agents[0]!, id: 'agent-1', name: 'Regulators' },
    { ...projectFixture().agents[0]!, id: 'agent-2', name: 'Clients' },
  ],
  ...patch,
});

describe('whether there is anything to ask', () => {
  it('opens only once the report is written, and says why it has not and where it comes from', () => {
    expect(availability(projectFixture(), config()).ready).toBe(false);
    expect(availability(projectFixture(), config())).toMatchObject({
      wait: 'none',
      waiting: expect.stringMatching(/report it writes/u),
    });
    const stage = (
      steps: Partial<Record<'knowledge' | 'environment' | 'simulation' | 'report', string>>,
    ) => {
      const base = projectFixture();
      return {
        ...base,
        console: { ...base.console!, steps: { ...base.console!.steps, ...steps } },
      } as ProjectDetail;
    };
    // Reading the evidence is Ground's, not the deep dive's: Ask has nothing under way while it runs.
    expect(availability(stage({ knowledge: 'running' }), config()).wait).toBe('none');
    expect(availability(stage({ simulation: 'running' }), config()).wait).toBe('running');
    expect(availability(stage({ environment: 'queued' }), config()).wait).toBe('running');
    expect(availability(stage({ simulation: 'paused' }), config()).wait).toBe('paused');
    expect(availability(stage({ simulation: 'failed' }), config()).wait).toBe('stopped');
    expect(availability(stage({ report: 'cancelled' }), config()).wait).toBe('stopped');
    expect(
      availability({ ...projectFixture(), console: null, status: 'running' }, config()).wait,
    ).toBe('running');
    expect(availability(written(), config())).toMatchObject({
      ready: true,
      wait: null,
      waiting: null,
      local: true,
      canReply: true,
    });
  });

  it('lets a real model answer only while a provider is configured', () => {
    const real = written({ mode: 'llm' });
    expect(availability(real, config({ configured: false, modelAssisted: true }))).toMatchObject({
      modelReady: false,
      canReply: false,
    });
    expect(availability(real, config({ configured: true, modelAssisted: true }))).toMatchObject({
      modelReady: true,
      canReply: true,
    });
    expect(
      availability(written(), config({ configured: true, modelAssisted: true })).modelReady,
    ).toBe(false);
  });

  it('offers surveys only to a guided record on a server that has them', () => {
    expect(availability(written(), config()).surveysOn).toBe(true);
    expect(availability(written(), config({ surveys: false })).surveysOn).toBe(false);
    expect(availability(written({ console: null }), config()).surveysOn).toBe(false);
    expect(availability(written(), null).surveysOn).toBe(false);
  });
});

describe('where the sheet opens', () => {
  it('reads the analyst, the surveys, an actor by identifier or by name, and falls back to the analyst', () => {
    const project = written();
    expect(resolveSeed(project, undefined)).toEqual({ tab: 'analyst', actorId: 'agent-1' });
    expect(resolveSeed(project, 'report').tab).toBe('analyst');
    expect(resolveSeed(project, 'Analyst').tab).toBe('analyst');
    expect(resolveSeed(project, 'surveys').tab).toBe('survey');
    expect(resolveSeed(project, 'agent-2')).toEqual({ tab: 'actors', actorId: 'agent-2' });
    expect(resolveSeed(project, 'clients')).toEqual({ tab: 'actors', actorId: 'agent-2' });
    expect(resolveSeed(project, 'nobody').tab).toBe('analyst');
    expect(resolveSeed({ agents: [] }, 'agent-9')).toEqual({ tab: 'analyst', actorId: null });
  });

  it('splits "Kind: what it does" and copes with a role that has no colon', () => {
    expect(splitRole('Regulator: Sets or enforces rules')).toEqual({
      kind: 'Regulator',
      what: 'Sets or enforces rules',
    });
    expect(splitRole('Fictional participant')).toEqual({
      kind: 'Fictional participant',
      what: null,
    });
    expect(splitRole('Kind:')).toEqual({ kind: 'Kind', what: null });
  });
});

describe('where an actor stands', () => {
  it('takes a side from 0.2 either way, as the engine does', () => {
    expect(positionOf(0.2)).toBe('supportive');
    expect(positionOf(0.19)).toBe('undecided');
    expect(positionOf(-0.2)).toBe('opposing');
    expect(positionOf(0)).toBe('undecided');
  });

  it('keeps a mark on its track however far out the number is', () => {
    expect(along(-1)).toBe(0);
    expect(along(0)).toBe(0.5);
    expect(along(1)).toBe(1);
    expect(along(7)).toBe(1);
    expect(along(-7)).toBe(0);
  });
});

describe('a reply, laid out and never rewritten', () => {
  const lookup = [
    'Local evidence lookup - not an AI-generated answer or persona interview.',
    'Recorded scenario: 8 rounds, 4 fictional proxies.',
    '[S1] 01-brief.md\nThe brief assumes a change.\nIt has two lines.',
    'Recorded synthetic memories',
    '[M-plaza-1-agent-1] plaza, round 1: Rule-based update: 0.000 to 0.001.',
    'Configure and explicitly select model-assisted mode in a new experiment.',
  ].join('\n\n');

  it('finds the notes, the quoted passages and the memories, in order', () => {
    const blocks = parseReply(lookup);
    expect(blocks.map((block) => block.kind)).toEqual([
      'note',
      'text',
      'passage',
      'note',
      'passage',
      'note',
    ]);
    expect(blocks[2]).toEqual({
      kind: 'passage',
      id: 'S1',
      label: '01-brief.md',
      text: 'The brief assumes a change.\nIt has two lines.',
      memory: false,
    });
    expect(blocks[4]).toMatchObject({
      kind: 'passage',
      id: 'M-plaza-1-agent-1',
      label: 'plaza, round 1',
      memory: true,
    });
  });

  it('shows a part it cannot place as the text it is, and drops nothing', () => {
    const odd = 'A model answer.\n\n[not a passage\n\n[S2]no space after the bracket';
    const blocks = parseReply(odd);
    expect(blocks.every((block) => block.kind === 'text')).toBe(true);
    expect(blocks.map((block) => block.kind === 'text' && block.text).join('\n\n')).toBe(odd);
    expect(parseReply('')).toEqual([]);
  });

  it('lets words arrive one after another, however long the reply, in under a second', () => {
    const parts = words('One  two\nthree');
    expect(parts.map((part) => part.text).join('')).toBe('One  two\nthree');
    expect(parts.filter((part) => part.index !== null).map((part) => part.index)).toEqual([
      0, 1, 2,
    ]);
    expect(wordStep(10)).toBeCloseTo(0.014);
    expect(wordStep(10_000) * 10_000).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(wordStep(0)).toBeGreaterThan(0);
  });
});

describe('what the empty conversation suggests', () => {
  it('makes questions from this report, and for an actor by name, and offers nothing for an unknown one', () => {
    expect(suggestions(written(), 'report')).toEqual([
      'Explain “Observed trajectory”',
      'Explain “Mechanism”',
      'What are the limits of this report?',
    ]);
    expect(suggestions(written(), 'agent-2')).toEqual([
      'What matters most to Clients?',
      'How would Clients react to the change?',
    ]);
    expect(suggestions(written(), 'agent-9')).toEqual([]);
    expect(suggestions(projectFixture(), 'report')).toEqual([]);
  });
});

const survey = (patch: Partial<SurveyRecord> = {}): SurveyRecord => ({
  id: 's1',
  kind: 'state',
  question: 'Where do you stand?',
  agentIds: ['agent-1', 'agent-2', 'agent-3'],
  status: 'completed',
  createdAt: '2026-11-01T09:00:00Z',
  completedAt: null,
  responses: [],
  error: null,
  ...patch,
});

describe('starting a survey', () => {
  const ready = {
    enabled: true,
    surveys: [] as SurveyRecord[],
    question: 'Where do you stand today?',
    chosen: 2,
    kind: 'state' as const,
    modelReady: false,
  };

  it('needs a question of some length, at least one actor, and a server that offers it', () => {
    expect(canStartSurvey(ready)).toBe(true);
    expect(canStartSurvey({ ...ready, question: 'Hi' })).toBe(false);
    expect(canStartSurvey({ ...ready, question: '     ' })).toBe(false);
    expect(canStartSurvey({ ...ready, chosen: 0 })).toBe(false);
    expect(canStartSurvey({ ...ready, enabled: false })).toBe(false);
  });

  it('allows one survey under way at a time and five kept in all', () => {
    expect(canStartSurvey({ ...ready, surveys: [survey({ status: 'running' })] })).toBe(false);
    expect(canStartSurvey({ ...ready, surveys: [survey({ status: 'queued' })] })).toBe(false);
    expect(
      canStartSurvey({
        ...ready,
        surveys: Array.from({ length: 5 }, (_, index) => survey({ id: `s${index}` })),
      }),
    ).toBe(false);
    expect(
      canStartSurvey({
        ...ready,
        surveys: Array.from({ length: 4 }, (_, index) => survey({ id: `s${index}` })),
      }),
    ).toBe(true);
  });

  it('asks a real model to interview only where one can answer', () => {
    expect(canStartSurvey({ ...ready, kind: 'interview' })).toBe(false);
    expect(canStartSurvey({ ...ready, kind: 'interview', modelReady: true })).toBe(true);
  });

  it('knows who has not answered yet, and caps the actors asked at five or the server’s own limit', () => {
    expect(awaiting(survey({ responses: [{ agentId: 'agent-2' } as never] }))).toEqual([
      'agent-1',
      'agent-3',
    ]);
    expect(maxTargets(null)).toBe(5);
    expect(maxTargets(config({ targets: 3 }))).toBe(3);
    expect(maxTargets(config({ targets: 12 }))).toBe(5);
  });
});

describe('what is answering', () => {
  it('says rules are a lookup and never a person speaking', () => {
    const local = engineNote(written(), availability(written(), config()), true);
    expect(local.kind).toBe('lookup');
    expect(local.short).toMatch(/no actor speaks/u);
    expect(local.long).toMatch(/does not generate speech/u);
  });

  it('says a real model is real, or that it is not available now', () => {
    const real = written({
      mode: 'llm',
      execution: {
        provider: 'azure',
        model: 'm',
        modelCalls: 1,
        inputTokens: 1,
        outputTokens: 1,
      } as never,
    });
    const on = engineNote(
      real,
      availability(real, config({ configured: true, modelAssisted: true })),
      false,
    );
    expect(on.kind).toBe('model');
    expect(on.short).toMatch(/generated analysis/u);
    const off = engineNote(real, availability(real, config()), false);
    expect(off.kind).toBe('unavailable');
    expect(off.short).toMatch(/not available now/u);
  });

  it('reads how well an answer rests on evidence in the project’s own words, with a safe fallback', () => {
    expect(groundingView('cited').tone).toBe('favor');
    expect(groundingView('caveated').tone).toBe('caution');
    expect(groundingView('uncited').tone).toBe('critical');
    expect(groundingView('invented' as never).label).toBe(groundingView('uncited').label);
  });
});
