import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleStep } from '../../../../shared/guided';
import { checkpointFixture, projectFixture } from '../../test/project';
import { visibleText } from '../../test/provider';
import { ConsoleWorkspace } from './ConsoleWorkspace';
import type { UiMode } from '../../lib/mode';

// The feature panels that other work fills in are replaced by markers, so that what is tested here is
// where the workspace mounts them and what it hands them, not what they will one day show.
vi.mock('../stakeholders/StakeholderPanel', async () => {
  const { createElement } = await import('react');
  return {
    StakeholderPanel: (props: { project: { id: string }; onChanged: () => void }) =>
      createElement(
        'p',
        { 'data-seam': 'stakeholders', 'data-project': props.project.id },
        `onChanged is a ${typeof props.onChanged}`,
      ),
  };
});
vi.mock('../analysis/AnalysisPanel', async () => {
  const { createElement } = await import('react');
  return {
    AnalysisPanel: (props: { project: { id: string } }) =>
      createElement('p', { 'data-seam': 'analysis', 'data-project': props.project.id }, 'analysis'),
  };
});
vi.mock('../brief/DecisionBriefView', async () => {
  const { createElement } = await import('react');
  return {
    DecisionBriefView: (props: { project: { id: string } }) =>
      createElement('p', { 'data-seam': 'brief', 'data-project': props.project.id }, 'brief'),
  };
});
vi.mock('../critics/CriticPanel', async () => {
  const { createElement } = await import('react');
  return {
    CriticPanel: (props: { project: { id: string } }) =>
      createElement('p', { 'data-seam': 'critics', 'data-project': props.project.id }, 'critics'),
  };
});

function render(project = checkpointFixture(), step?: ConsoleStep, mode?: UiMode): string {
  if (step) project.console!.activeStep = step;
  return renderToStaticMarkup(
    <ConsoleWorkspace
      project={project}
      config={null}
      busy={false}
      refreshing={false}
      projects={[]}
      onRun={async () => {}}
      onSave={async () => {}}
      onCancel={async () => {}}
      onRefresh={() => {}}
      onDuplicate={() => {}}
      onSurvey={() => {}}
      onPause={async () => {}}
      onResume={async () => {}}
      onIntervention={async () => {}}
      onBranch={async () => {}}
      onSelectProject={() => {}}
      onCloseComparison={() => {}}
      mode={mode}
    />,
  );
}

const seams = (html: string) => [...html.matchAll(/data-seam="(\w+)"/gu)].map((match) => match[1]);

describe('where the workspace mounts the feature panels', () => {
  it('puts the stakeholder panel at the top of Env Setup, under its heading and above its controls', () => {
    const html = render(checkpointFixture(), 'environment');
    expect(seams(html)).toEqual(['stakeholders']);
    expect(html).toContain('data-project="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('onChanged is a function');
    expect(html.indexOf('Make the assumptions explicit')).toBeLessThan(
      html.indexOf('data-seam="stakeholders"'),
    );
    expect(html.indexOf('data-seam="stakeholders"')).toBeLessThan(
      html.indexOf('Fictional proxies, not digital copies of people'),
    );
  });

  it('puts the analysis panel in the Simulation stage, above the run controls', () => {
    const html = render(checkpointFixture(), 'simulation');
    expect(seams(html)).toEqual(['analysis']);
    expect(html.indexOf('Observe recorded behavior')).toBeLessThan(
      html.indexOf('data-seam="analysis"'),
    );
    expect(html.indexOf('data-seam="analysis"')).toBeLessThan(
      html.indexOf('primary-stage-actions'),
    );
  });

  it('puts the brief, then the critics, at the top of Report, and the existing report below its own heading', () => {
    const html = render(checkpointFixture(), 'report');
    expect(seams(html)).toEqual(['brief', 'critics']);
    const brief = html.indexOf('data-seam="brief"');
    const critics = html.indexOf('data-seam="critics"');
    const heading = html.indexOf('>Detailed report</h2>');
    const grid = html.indexOf('class="console-grid');
    expect(brief).toBeGreaterThan(-1);
    expect(brief).toBeLessThan(critics);
    expect(critics).toBeLessThan(heading);
    expect(heading).toBeLessThan(grid);
    expect(html).toContain('<div class="seam-stack">');
  });

  it('mounts nothing in the other stages', () => {
    expect(seams(render(checkpointFixture(), 'knowledge'))).toEqual([]);
    expect(seams(render(checkpointFixture(), 'interaction'))).toEqual([]);
  });

  it('mounts nothing for a record that is not a guided project', () => {
    for (const step of ['environment', 'simulation', 'report'] as const) {
      const project = projectFixture();
      project.workflow = 'quick';
      project.console = null;
      const html = renderToStaticMarkup(
        <ConsoleWorkspace
          project={project}
          config={null}
          busy={false}
          refreshing={false}
          projects={[]}
          onRun={async () => {}}
          onSave={async () => {}}
          onCancel={async () => {}}
          onRefresh={() => {}}
          onDuplicate={() => {}}
          onSurvey={() => {}}
          onPause={async () => {}}
          onResume={async () => {}}
          onIntervention={async () => {}}
          onBranch={async () => {}}
          onSelectProject={() => {}}
          onCloseComparison={() => {}}
        />,
      );
      expect(seams(html), step).toEqual([]);
      expect(html).not.toContain('Detailed report');
      expect(html).not.toContain('class="journey"');
    }
  });
});

describe('the journey and the stage help in the workspace', () => {
  it('shows the path with the stage in view, for a guided project', () => {
    const html = render(checkpointFixture(), 'simulation');
    expect(html).toContain('aria-label="Your path through the scenario"');
    expect(visibleText(html)).toContain('STEP 7 OF 12 Progress · in the Simulation stage');
    expect(html.match(/aria-current="step"/gu)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the five engine stage names and puts a help line under each in Guided only', () => {
    const guided = render(checkpointFixture(), 'simulation', 'guided');
    const advanced = render(checkpointFixture(), 'simulation', 'advanced');
    for (const name of ['Graph Build', 'Env Setup', 'Simulation', 'Report', 'Interaction']) {
      expect(guided).toContain(`<strong>${name}</strong>`);
      expect(advanced).toContain(`<strong>${name}</strong>`);
    }
    expect(guided.match(/class="step-help"/gu)).toHaveLength(5);
    expect(visibleText(guided)).toContain('Review stakeholders and actors');
    expect(advanced).not.toContain('step-help');
    expect(visibleText(advanced)).not.toContain('Review stakeholders and actors');
  });

  it('groups the technical project actions under one named group, all still buttons', () => {
    const html = render(checkpointFixture());
    const group =
      /<div class="project-tools" role="group" aria-label="Project tools">([^]*?)<\/div>/u.exec(
        html,
      );
    expect(group).not.toBeNull();
    const names = [...group![1]!.matchAll(/<button\b[^>]*>([^]*?)<\/button>/gu)].map((match) =>
      visibleText(match[1]!),
    );
    expect(names).toEqual(['Audit log', 'Duplicate as guided', 'Export JSON']);
  });

  it('opens the project details and the operation log by default in Advanced, and not in Guided', () => {
    const guided = render(checkpointFixture(), undefined, 'guided');
    const advanced = render(checkpointFixture(), undefined, 'advanced');
    expect(guided).not.toMatch(/<details class="project-metadata mono" open/u);
    expect(guided).toContain('aria-expanded="false"');
    expect(advanced).toMatch(/<details class="project-metadata mono" open=""/u);
    expect(advanced).toContain('aria-expanded="true"');
  });
});
