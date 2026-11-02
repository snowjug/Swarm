import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SurveyRecord } from '../../../../shared/guided';
import type { AppConfig, ChatMessage, ProjectDetail } from '../../../../shared/types';
import { MotionRoot } from '../../design/motion';
import { TooltipProvider } from '../../design/ui';
import { projectFixture } from '../../test/project';
import { visibleText } from '../../test/provider';
import { availability } from './chatView';
import { Message } from './Message';
import { Surveys } from './Surveys';

const render = (node: ReactNode): string =>
  renderToStaticMarkup(
    <MotionRoot>
      <TooltipProvider>{node}</TooltipProvider>
    </MotionRoot>,
  );
const noop = () => undefined;

const config = {
  provider: { configured: false },
  capabilities: { modelAssisted: false, surveys: true },
  limits: { maxSurveyTargets: 3 },
} as unknown as AppConfig;

const base = projectFixture();
const guided = (surveys: SurveyRecord[] = []): ProjectDetail => ({
  ...base,
  status: 'completed',
  report: {
    sections: [{ title: 'Scenario' }],
    limitations: [],
  } as unknown as ProjectDetail['report'],
  agents: [
    { ...base.agents[0]!, id: 'agent-1', name: 'Regulators' },
    { ...base.agents[0]!, id: 'agent-2', name: 'Clients' },
  ],
  console: {
    ...base.console!,
    surveys,
    memories: [
      {
        id: 'M-plaza-1-agent-1',
        platform: 'plaza',
        round: 1,
        text: 'Rule-based update.',
        sourceIds: [],
        peerIds: [],
      },
    ] as unknown as NonNullable<ProjectDetail['console']>['memories'],
  },
});

const survey = (patch: Partial<SurveyRecord> = {}): SurveyRecord => ({
  id: 's1',
  kind: 'state',
  question: 'Where do you stand on the change?',
  agentIds: ['agent-1', 'agent-2'],
  status: 'completed',
  createdAt: '2026-11-01T09:00:00Z',
  completedAt: '2026-11-01T09:00:01Z',
  responses: [
    {
      agentId: 'agent-1',
      answer: null,
      opinion: 0.5,
      position: 'supportive',
      sourceIds: [],
      memoryIds: [],
    },
    {
      agentId: 'agent-2',
      answer: null,
      opinion: -0.4,
      position: 'opposing',
      sourceIds: [],
      memoryIds: [],
    },
  ],
  error: null,
  ...patch,
});

const surveys = (project: ProjectDetail) =>
  render(
    <Surveys
      project={project}
      config={config}
      availability={availability(project, config)}
      onSurvey={noop}
      onOpenActor={noop}
    />,
  );

describe('surveys', () => {
  it('starts with nothing kept, and holds the interview back where no model can answer', () => {
    const markup = surveys(guided());
    expect(visibleText(markup)).toContain('No surveys yet');
    expect(visibleText(markup)).toContain(
      'Interviews need a model-assisted project and a configured provider.',
    );
    expect(markup).toMatch(/role="radio"[^>]*disabled[^>]*>[^<]*(<[^>]*>)*[^<]*Interview/u);
    expect(markup).toMatch(/Record snapshot/u);
    expect(markup).toMatch(
      /<button[^>]*disabled[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled/u,
    );
  });

  it('puts a seeded question in the field without sending it', () => {
    expect(surveys(guided())).not.toContain('Where do you stand today?');
    const project = guided();
    const seeded = render(
      <Surveys
        project={project}
        config={config}
        availability={availability(project, config)}
        onSurvey={noop}
        onOpenActor={noop}
        seed="Where do you stand today?"
      />,
    );
    expect(seeded).toContain('Where do you stand today?');
  });

  it('shows what each actor said and where it stands, never an invented answer', () => {
    const text = visibleText(surveys(guided([survey()])));
    expect(text).toContain('Where do you stand on the change?');
    expect(text).toContain('2 of 2 answered');
    expect(text).toContain('In favour');
    expect(text).toContain('Against');
    expect(text).toContain('Recorded position only: no one answered.');
    expect(text).toContain('1 of 5 kept');
  });

  it('lets a running survey be cancelled and shows who it is still waiting for', () => {
    const running = survey({
      status: 'running',
      responses: [survey().responses[0]!],
      completedAt: null,
    });
    const markup = surveys(guided([running]));
    expect(visibleText(markup)).toContain('Cancel survey');
    expect(markup).toContain('aria-label="Waiting for Clients"');
    expect(visibleText(markup)).toContain(
      'A survey is under way. Finish or cancel it to start another.',
    );
  });

  it('says a stopped survey stopped, and keeps what it saved', () => {
    const text = visibleText(
      surveys(guided([survey({ status: 'failed', error: 'The model did not answer.' })])),
    );
    expect(text).toContain('The survey stopped');
    expect(text).toContain('The model did not answer.');
    expect(visibleText(surveys(guided([survey({ status: 'cancelled' })])))).toContain(
      'Responses saved before it stopped are kept.',
    );
  });

  it('keeps at most five, and says so', () => {
    const five = Array.from({ length: 5 }, (_, index) =>
      survey({ id: `s${index}`, createdAt: `2026-11-0${index + 1}T09:00:00Z` }),
    );
    expect(visibleText(surveys(guided(five)))).toContain('keeps at most 5 surveys');
  });
});

const reply = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm-2',
  target: 'report',
  role: 'assistant',
  content: [
    'Local evidence lookup - not an AI-generated answer or persona interview.',
    '[S1] 01-brief.md\nThe brief assumes a change.',
    '[M-plaza-1-agent-1] plaza, round 1: Rule-based update.',
  ].join('\n\n'),
  sourceIds: ['S1'],
  memoryIds: ['M-plaza-1-agent-1'],
  claimIds: ['C-1'],
  mode: 'local',
  createdAt: '2026-11-01T09:00:00Z',
  grounding: {
    status: 'caveated',
    notes: ['A figure was not found in the cited passages.'],
    coverage: 0.5,
  },
  ...patch,
});

const speaker = { name: 'The analyst', seed: 'p:analyst', analyst: true };

describe('one message', () => {
  const message = (patch: Partial<ChatMessage> = {}, who = speaker) =>
    render(
      <ol>
        <Message message={reply(patch)} project={guided()} speaker={who} animate={false} />
      </ol>,
    );

  it('quotes a passage exactly, marks a simulated memory as not evidence, and names the engine', () => {
    const markup = message();
    expect(markup).toContain(
      '<blockquote class="sw-chat__quote">The brief assumes a change.</blockquote>',
    );
    const text = visibleText(markup);
    expect(text).toContain('Simulated, not evidence');
    expect(text).toContain('Evidence lookup');
  });

  it('shows how well it rests on evidence in the project’s own words, with the reasons beside it', () => {
    const text = visibleText(message());
    expect(text).toContain('Cited, with figures to check');
    expect(text).toContain('A figure was not found in the cited passages.');
    expect(text).toContain('covers 50% of the question’s key terms');
  });

  it('turns what it cites into chips that open the thing itself', () => {
    const markup = message();
    expect(markup).toContain('aria-label="Source S1"');
    expect(markup).toContain('aria-label="Report statement C-1"');
    expect(markup).toContain('aria-label="Simulated memory, plaza, round 1"');
  });

  it('never calls a model’s analysis a lookup, nor an actor’s words testimony', () => {
    expect(visibleText(message({ mode: 'llm' }))).toContain('Generated analysis');
    const actor = { name: 'Regulators', seed: 'agent-1', analyst: false };
    expect(visibleText(message({ mode: 'llm' }, actor))).toContain('Fictional role-play');
  });

  it('shows the user’s own words as they were typed', () => {
    const own = render(
      <ol>
        <Message
          message={reply({
            role: 'user',
            content: '<b>What</b> is "this"?',
            grounding: undefined,
            sourceIds: [],
            memoryIds: [],
            claimIds: [],
          })}
          project={guided()}
          speaker={speaker}
          animate={false}
        />
      </ol>,
    );
    expect(own).toContain('&lt;b&gt;What&lt;/b&gt; is &quot;this&quot;?');
  });
});
