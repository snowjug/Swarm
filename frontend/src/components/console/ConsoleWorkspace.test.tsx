import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleStep } from '../../../../shared/guided';
import type { LabProgress } from '../../../../shared/lab';
import { checkpointFixture, projectFixture, roundFixture } from '../../test/project';
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

  it('puts the analysis panel in the Simulation stage, above the run controls, and says what they are', () => {
    const html = render(checkpointFixture(), 'simulation');
    expect(seams(html)).toEqual(['analysis']);
    expect(html.indexOf('03 / SIMULATION')).toBeLessThan(html.indexOf('data-seam="analysis"'));
    expect(html.indexOf('data-seam="analysis"')).toBeLessThan(
      html.indexOf('Deep dive (optional): agent-by-agent simulation'),
    );
    expect(html.indexOf('Deep dive (optional): agent-by-agent simulation')).toBeLessThan(
      html.indexOf('primary-stage-actions'),
    );
    expect(visibleText(html)).toContain('does not replace the comparison above');
    expect(html).not.toContain('Observe recorded behavior');
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
    expect(visibleText(html)).toContain('does not depend on it');
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
  it('keeps the recorded-behavior heading, and has no deep dive, for a record that is not a guided project', () => {
    const project = projectFixture();
    project.workflow = 'quick';
    project.console = null;
    project.rounds = [roundFixture()];
    const html = render(project);
    expect(html).toContain('Observe recorded behavior');
    expect(html).not.toContain('Deep dive');
  });
});

const NO_PROGRESS: LabProgress = {
  scenario: false,
  stakeholders: 'none',
  actors: 0,
  analysis: 'none',
  critiques: false,
  brief: false,
};
const FINISHED: Partial<LabProgress> = {
  stakeholders: 'approved',
  actors: 5,
  analysis: 'completed',
};

/** A project as the page reads it once the lab has recorded something. */
function withLab(change: Partial<LabProgress>, project = checkpointFixture()) {
  project.lab = { ...NO_PROGRESS, ...change };
  return project;
}

/** The opening tag and the content of one button of the stage navigation. */
function stageButton(html: string, name: string) {
  const nav = /<nav class="console-stepper"[^>]*>([^]*?)<\/nav>/u.exec(html)![1]!;
  const found = [...nav.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/gu)].find((match) =>
    match[2]!.includes(`<strong>${name}</strong>`),
  )!;
  return { tag: found[1]!, text: visibleText(found[2]!) };
}

/** Which of the view buttons is pressed. */
function viewControl(html: string) {
  const group = /role="group" aria-label="Console view">([^]*?)<\/div>/u.exec(html)![1]!;
  return Object.fromEntries(
    [...group.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/gu)].map((match) => [
      visibleText(match[2]!).trim(),
      match[1]!.includes('aria-pressed="true"'),
    ]),
  );
}

describe('what the workspace does once the scenario lab has recorded something', () => {
  it('offers the brief from a finished comparison, and the comparison from the brief', () => {
    const simulation = render(withLab(FINISHED), 'simulation');
    expect(simulation).toContain('role="group" aria-label="Next step"');
    expect(visibleText(simulation)).toContain('See the decision brief');
    expect(simulation.indexOf('aria-label="Next step"')).toBeLessThan(
      simulation.indexOf('class="console-grid'),
    );

    const report = render(withLab(FINISHED), 'report');
    expect(visibleText(report)).toContain('Back to the comparison');
    expect(report.indexOf('aria-label="Next step"')).toBeLessThan(
      report.indexOf('<div class="seam-stack">'),
    );
  });

  it('offers nothing before a comparison has finished, or in the other stages', () => {
    for (const analysis of ['none', 'running', 'failed'] as const) {
      const html = render(withLab({ ...FINISHED, analysis }), 'simulation');
      expect(html, analysis).not.toContain('aria-label="Next step"');
    }
    expect(render(checkpointFixture(), 'simulation')).not.toContain('aria-label="Next step"');
    for (const step of ['knowledge', 'environment', 'interaction'] as const) {
      expect(render(withLab(FINISHED), step), step).not.toContain('aria-label="Next step"');
    }
  });

  it('opens Report from a finished comparison without the engine’s simulation, and says what is there', () => {
    const before = render(checkpointFixture(), 'simulation');
    expect(stageButton(before, 'Report').tag).toContain('disabled');
    expect(stageButton(before, 'Report').text).toContain('pending');

    const after = render(withLab(FINISHED), 'simulation');
    expect(stageButton(after, 'Report').tag).not.toContain('disabled');
    expect(stageButton(after, 'Report').text).toContain('ready to write');
    expect(stageButton(after, 'Simulation').text).toContain('paused');
  });

  it('opens Simulation from the actors alone, in a project whose environment was never prepared', () => {
    const project = withLab({ stakeholders: 'approved', actors: 5 }, projectFixture());
    project.console!.steps.knowledge = 'ready';
    project.console!.activeStep = 'environment';
    const html = render(project);
    expect(stageButton(html, 'Simulation').tag).not.toContain('disabled');
    expect(stageButton(html, 'Env Setup').text).toContain('actors ready');
    expect(stageButton(html, 'Report').tag).toContain('disabled');
  });

  it('opens with the workbench alone once there are simulated actors, and in the split view otherwise', () => {
    const plain = render(checkpointFixture(), 'simulation');
    expect(plain).toContain('class="console-grid view-split');
    expect(plain).toContain('console-canvas');
    expect(viewControl(plain)).toEqual({ Graph: false, Split: true, Workbench: false });
    const actors = render(withLab({ stakeholders: 'approved', actors: 5 }), 'simulation');
    expect(actors).toContain('class="console-grid view-workbench');
    expect(actors).not.toContain('console-canvas');
    expect(viewControl(actors)).toEqual({ Graph: false, Split: false, Workbench: true });
  });

  it('ticks the journey from the lab’s record', () => {
    const html = render(withLab(FINISHED), 'report');
    expect(visibleText(html)).toContain('STEP 8 OF 12 Results · in the Report stage');
    expect(html.match(/journey-step done/gu)?.length).toBeGreaterThanOrEqual(6);
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
