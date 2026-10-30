import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { projectFixture } from '../../test/project';
import { KnowledgeStage } from './KnowledgeStage';
import { ReportReader } from './ReportReader';
import { SurveyPanel } from './SurveyPanel';
import { TraceList } from './TraceList';

describe('guided console record rendering', () => {
  it('renders report and model text safely as text, without interpreting HTML', () => {
    const project = projectFixture();
    project.status = 'completed';
    project.report = {
      generatedBy: 'local',
      title: 'Recorded test report',
      executiveSummary: '<img src=x onerror=alert(1)>',
      sections: [{ title: 'Actual chapter', body: '<script>alert(1)</script>', sourceIds: ['S1'] }],
      limitations: ['Synthetic test only.'],
      metrics: {
        initialMean: 0,
        finalMean: 0.2,
        finalSupport: 0.5,
        finalOpposition: 0.25,
        polarization: 0.3,
        totalInteractions: 4,
      },
    };
    const html = renderToStaticMarkup(<ReportReader project={project} onInspect={() => {}} />);
    expect(html).toContain('Actual chapter');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Source');
  });

  it('keeps the project name as the only page heading: the report title is a section heading', () => {
    const project = projectFixture();
    project.status = 'completed';
    project.report = {
      generatedBy: 'local',
      title: 'Recorded test report',
      executiveSummary: 'Synthetic summary.',
      sections: [{ title: 'Actual chapter', body: 'Synthetic body.', sourceIds: ['S1'] }],
      limitations: ['Synthetic test only.'],
      metrics: {
        initialMean: 0,
        finalMean: 0.2,
        finalSupport: 0.5,
        finalOpposition: 0.25,
        polarization: 0.3,
        totalInteractions: 4,
      },
    };
    const html = renderToStaticMarkup(<ReportReader project={project} onInspect={() => {}} />);
    expect(html).not.toMatch(/<h1[ >]/u);
    expect(html).toMatch(/<h2[^>]*>Recorded test report<\/h2>/u);
  });

  it('does not reconstruct ontology for historical quick runs', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    const html = renderToStaticMarkup(
      <KnowledgeStage
        project={project}
        busy={false}
        onRun={() => {}}
        onNavigate={() => {}}
        onInspect={() => {}}
      />,
    );
    expect(html).toContain('no ontology has been reconstructed');
    expect(html).not.toContain('Prepare environment</button>');
  });

  it('shows actual null answers and numeric positions for saved state snapshots', () => {
    const project = projectFixture();
    project.status = 'completed';
    project.console!.surveys = [
      {
        id: 'snapshot-test',
        kind: 'state',
        question: 'Synthetic snapshot context',
        agentIds: ['agent-1'],
        status: 'completed',
        createdAt: project.createdAt,
        completedAt: project.updatedAt,
        error: null,
        responses: [
          {
            agentId: 'agent-1',
            answer: null,
            opinion: 0.37,
            position: 'supportive',
            sourceIds: ['S1'],
            memoryIds: [],
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <SurveyPanel project={project} config={null} onRecord={() => {}} onInspect={() => {}} />,
    );
    expect(html).toContain('answer: null');
    expect(html).toContain('+0.37');
    expect(html).toContain('no fictional speech was generated');
    expect(html).not.toContain('I believe');
  });

  it('exposes recorded tool output, not invented reasoning', () => {
    const html = renderToStaticMarkup(
      <TraceList
        traces={[
          {
            id: 'trace-test',
            step: 'report',
            kind: 'retrieval',
            name: 'Actual evidence query',
            status: 'completed',
            startedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-01T00:00:01Z',
            input: { query: 'topic' },
            output: { sourceIds: ['S1'], text: '<script>no</script>' },
            error: null,
          },
        ]}
      />,
    );
    expect(html).toContain('Actual evidence query');
    expect(html).toContain('Recorded output / evidence');
    expect(html).toContain('S1');
    expect(html).not.toContain('<script>');
  });
});
