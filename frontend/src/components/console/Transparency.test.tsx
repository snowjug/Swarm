import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SimulationMemory } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { projectFixture, roundFixture } from '../../test/project';
import { Inspector } from './Inspector';
import { MemoryStream } from './MemoryStream';
import { ProxyAssumptions } from './ProxyAssumptions';
import { SimulationStage } from './SimulationStage';
import { StatedReason } from './StatedReason';

const hostile = '<img src=x onerror=alert(1)>';
const CAPTION = 'A short explanation the model chose to give, not hidden reasoning';

function memoryFixture(overrides: Partial<SimulationMemory> = {}): SimulationMemory {
  return {
    id: 'M-1',
    platform: 'plaza',
    round: 1,
    simulatedMinute: 10,
    kind: 'action',
    agentId: 'agent-1',
    actionType: 'post',
    text: 'Recorded test post.',
    opinion: 0.2,
    peerIds: [],
    sourceIds: ['S1'],
    ...overrides,
  };
}

function modelProject(): ProjectDetail {
  const project = projectFixture();
  project.mode = 'llm';
  project.settings = { ...project.settings, mode: 'llm' };
  return project;
}

function inspect(project: ProjectDetail, selection: Parameters<typeof Inspector>[0]['selection']) {
  return renderToStaticMarkup(
    <Inspector project={project} selection={selection} onInspect={() => {}} onClose={() => {}} />,
  );
}

const headingLevels = (html: string) =>
  [...html.matchAll(/<h([1-6])\b/gu)].map((match) => Number(match[1]));

describe('graph inspector: the verified source quote', () => {
  it('shows the excerpt as a labelled blockquote naming the passage it was checked against', () => {
    const project = modelProject();
    project.graph!.nodes[0]!.quote = 'an excerpt copied from the passage';
    const html = inspect(project, { kind: 'node', id: 'topic-1' });
    expect(html).toContain(
      '<figure class="quote-block"><figcaption>Source quote (checked verbatim against S1)</figcaption><blockquote>an excerpt copied from the passage</blockquote></figure>',
    );
  });

  it('names every passage a node cites, because the excerpt may be in any one of them', () => {
    const project = modelProject();
    project.graph!.nodes[0]!.sourceIds = ['S1', 'S2'];
    project.graph!.nodes[0]!.quote = 'an excerpt copied from the passage';
    expect(inspect(project, { kind: 'node', id: 'topic-1' })).toContain(
      '<figcaption>Source quote (checked verbatim against S1, S2)</figcaption>',
    );
  });

  it('shows nothing extra for a node without a quote, as on every local graph', () => {
    const html = inspect(projectFixture(), { kind: 'node', id: 'topic-1' });
    expect(html).not.toContain('Source quote');
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('quote-block');
  });

  it('renders a hostile excerpt as text', () => {
    const project = modelProject();
    project.graph!.nodes[0]!.quote = hostile;
    const html = inspect(project, { kind: 'node', id: 'topic-1' });
    expect(html).toContain('<blockquote>&lt;img src=x onerror=alert(1)&gt;</blockquote>');
    expect(html).not.toMatch(/<img\b/u);
  });
});

describe('simulation transparency: stated reason and self-reported firmness', () => {
  it('shows the reason, its caption and the rounded firmness in the memory inspector', () => {
    const project = modelProject();
    project.console!.memories = [
      memoryFixture({ rationale: 'It answered my worry.', confidence: 0.7 }),
    ];
    const html = inspect(project, { kind: 'memory', id: 'M-1' });
    expect(html).toContain(
      `<div class="stated-reason"><p class="stated-reason-text"><span class="stated-reason-label">Stated reason</span> <span class="preserve-text">It answered my worry.</span></p><p class="stated-reason-note">${CAPTION}</p><p class="stated-reason-note stated-reason-firmness">Self-reported firmness 70%</p></div>`,
    );
  });

  it('keeps the block compact: at most a reason, its caption and one firmness line', () => {
    const html = renderToStaticMarkup(<StatedReason rationale="A reason." confidence={0.456} />);
    expect(html.match(/<p\b/gu)).toHaveLength(3);
    expect(html).toContain('Self-reported firmness 46%');
  });

  it('shows the firmness alone when no reason was given, without the reason caption', () => {
    const html = renderToStaticMarkup(<StatedReason confidence={0} />);
    expect(html).toContain('Self-reported firmness 0%');
    expect(html).not.toContain('Stated reason');
    expect(html).not.toContain(CAPTION);
  });

  it('shows the reason alone when no firmness was given', () => {
    const html = renderToStaticMarkup(<StatedReason rationale="Only a reason." />);
    expect(html).toContain('Only a reason.');
    expect(html).toContain(CAPTION);
    expect(html).not.toContain('firmness');
  });

  it.each([
    [{}],
    [{ rationale: '   ' }],
    [{ rationale: '', confidence: Number.NaN }],
    [{ rationale: null, confidence: null }],
  ])('renders nothing for %j', (props) => {
    expect(renderToStaticMarkup(<StatedReason {...props} />)).toBe('');
  });

  it('shows nothing extra for a memory that has neither, as on local runs and seed inputs', () => {
    const project = projectFixture();
    project.console!.memories = [memoryFixture(), memoryFixture({ id: 'M-0', kind: 'seed' })];
    for (const id of ['M-1', 'M-0']) {
      const html = inspect(project, { kind: 'memory', id });
      expect(html).not.toContain('stated-reason');
      expect(html).not.toContain('Stated reason');
      expect(html).not.toContain('firmness');
    }
  });

  it('renders a hostile reason as text', () => {
    const project = modelProject();
    project.console!.memories = [memoryFixture({ rationale: hostile })];
    const html = inspect(project, { kind: 'memory', id: 'M-1' });
    expect(html).toContain('<span class="preserve-text">&lt;img src=x onerror=alert(1)&gt;</span>');
    expect(html).not.toMatch(/<img\b/u);
  });

  it('shows it only on the stream rows that have it', () => {
    const project = modelProject();
    project.console!.memories = [
      memoryFixture({ id: 'M-1', rationale: 'A reason for the first post.', confidence: 0.4 }),
      memoryFixture({ id: 'M-2', text: 'A post with nothing stated.' }),
      memoryFixture({ id: 'M-3', kind: 'seed', agentId: null, actionType: 'seed' }),
    ];
    const html = renderToStaticMarkup(
      <MemoryStream project={project} platform="plaza" onInspect={() => {}} />,
    );
    expect(html.match(/class="stated-reason"/gu)).toHaveLength(1);
    expect(html).toContain('A reason for the first post.');
    expect(html).toContain('Self-reported firmness 40%');
    expect(html.match(/<article\b/gu)).toHaveLength(3);
  });

  it('shows it on the actions of a quick run', () => {
    const project = modelProject();
    project.workflow = 'quick';
    project.console = null;
    project.rounds = [
      {
        ...roundFixture(1),
        actions: [
          {
            id: 'A-1',
            round: 1,
            agentId: 'agent-1',
            type: 'post',
            content: 'A recorded action.',
            opinion: 0.2,
            peerIds: [],
            sourceIds: ['S1'],
            rationale: 'Because of the library hours.',
            confidence: 0.55,
          },
          {
            id: 'A-2',
            round: 1,
            agentId: 'agent-1',
            type: 'update',
            content: 'An action with nothing stated.',
            opinion: 0.2,
            peerIds: [],
            sourceIds: [],
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <SimulationStage
        project={project}
        busy={false}
        onRun={() => {}}
        onNavigate={() => {}}
        onCancel={() => {}}
        onInspect={() => {}}
        onPause={async () => {}}
        onResume={async () => {}}
        onRestart={async () => {}}
        onIntervention={async () => {}}
        onBranch={() => {}}
        onCompare={() => {}}
      />,
    );
    expect(html.match(/class="stated-reason"/gu)).toHaveLength(1);
    expect(html).toContain('Because of the library hours.');
    expect(html).toContain('Self-reported firmness 55%');
  });
});

describe('proxy inspector: goals and constraints', () => {
  it('lists them under their own headings with the caption, as plain text', () => {
    const project = modelProject();
    project.agents[0]!.goals = ['Keep the shuttle affordable', hostile];
    project.agents[0]!.constraints = ['Cannot exceed the neighbourhood budget'];
    const html = inspect(project, { kind: 'agent', id: 'agent-1' });
    expect(html).toContain('Assumed by the model for this fictional proxy');
    expect(html).toContain('<h4>Goals</h4><ul><li>Keep the shuttle affordable</li>');
    expect(html).toContain('<li>&lt;img src=x onerror=alert(1)&gt;</li>');
    expect(html).toContain(
      '<h4>Constraints</h4><ul><li>Cannot exceed the neighbourhood budget</li></ul>',
    );
    expect(html).not.toMatch(/<img\b/u);
  });

  it('keeps the heading order under the proxy role', () => {
    const project = modelProject();
    project.agents[0]!.goals = ['A goal'];
    project.agents[0]!.constraints = ['A constraint'];
    const levels = headingLevels(inspect(project, { kind: 'agent', id: 'agent-1' }));
    expect(levels).toEqual([2, 3, 4, 4]);
  });

  it('shows only the list that exists and drops empty entries', () => {
    const html = renderToStaticMarkup(
      <ProxyAssumptions goals={['  ', 'A real goal']} constraints={[]} />,
    );
    expect(html).toContain('<h4>Goals</h4>');
    expect(html.match(/<li>/gu)).toHaveLength(1);
    expect(html).not.toContain('Constraints');
  });

  it('shows nothing for a proxy without either, as on local personas', () => {
    expect(renderToStaticMarkup(<ProxyAssumptions />)).toBe('');
    expect(renderToStaticMarkup(<ProxyAssumptions goals={[]} constraints={['  ']} />)).toBe('');
    const html = inspect(projectFixture(), { kind: 'agent', id: 'agent-1' });
    expect(html).not.toContain('Goals');
    expect(html).not.toContain('Assumed by the model');
  });
});
