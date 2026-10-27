import { Children, isValidElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { checkpointFixture, projectFixture } from '../../test/project';
import { ConsoleViewControls, CONSOLE_NARROW_QUERY } from './ConsoleViewControls';
import { ConsoleStepper } from './ConsoleStepper';
import { ConsoleWorkspace } from './ConsoleWorkspace';
import { GraphCanvas } from './GraphCanvas';
import { Inspector } from './Inspector';

function buttonNames(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gu)].map((match) =>
    match[1]!
      .replace(/<[^>]*>/gu, '')
      .replace(/\s+/gu, ' ')
      .trim(),
  );
}

describe('one responsive view control with accurate left-pane labels', () => {
  it.each(['Graph', 'Report'] as const)(
    'renders only the wide three-way %s/Split/Workbench switch',
    (leftLabel) => {
      const html = renderToStaticMarkup(
        <ConsoleViewControls
          narrow={false}
          leftLabel={leftLabel}
          view="split"
          onChange={() => {}}
        />,
      );
      expect(html.match(/role="group"/gu)).toHaveLength(1);
      expect(html).toContain('aria-label="Console view"');
      expect(buttonNames(html)).toEqual([leftLabel, 'Split', 'Workbench']);
      expect(html.match(/aria-pressed="true"/gu)).toHaveLength(1);
    },
  );
  it.each(['Graph', 'Report'] as const)(
    'renders only the narrow %s/Workbench pane switch',
    (leftLabel) => {
      const html = renderToStaticMarkup(
        <ConsoleViewControls narrow leftLabel={leftLabel} view="split" onChange={() => {}} />,
      );
      expect(html.match(/role="group"/gu)).toHaveLength(1);
      expect(html).toContain('aria-label="Console pane"');
      expect(buttonNames(html)).toEqual([leftLabel, 'Workbench']);
      expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Workbench<\/button>/u);
      expect(CONSOLE_NARROW_QUERY).toBe('(max-width: 900px)');
    },
  );
  it('keeps the narrow controls wired to the single left/workbench view state', () => {
    const onChange = vi.fn();
    const element = ConsoleViewControls({
      narrow: true,
      leftLabel: 'Report',
      view: 'workbench',
      onChange,
    });
    const buttons = Children.toArray(element.props.children).filter(
      (child): child is ReactElement<{ onClick: () => void }> => isValidElement(child),
    );
    expect(buttons).toHaveLength(2);
    buttons[0]!.props.onClick();
    buttons[1]!.props.onClick();
    expect(onChange.mock.calls).toEqual([['graph'], ['workbench']]);
  });
  it.each(['report', 'interaction'] as const)(
    'labels the actual left-hand report reader on %s',
    (step) => {
      const project = checkpointFixture();
      project.console!.activeStep = step;
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
      expect(buttonNames(html).filter((name) => name === 'Report')).toHaveLength(1);
      expect(buttonNames(html).filter((name) => name === 'Graph')).toHaveLength(0);
      expect(html).toContain('aria-label="Scenario report chapter reader"');
      expect(html).not.toContain('aria-label="Interactive source graph and simulated overlays"');
    },
  );
});

describe('stepper names contain exact visible labels before hidden context', () => {
  it('uses visible labels and statuses without an aria-label override on any step button', () => {
    const html = renderToStaticMarkup(
      <ConsoleStepper project={checkpointFixture()} step="simulation" onNavigate={() => {}} />,
    );
    const openings = [...html.matchAll(/<button\b[^>]*>/gu)].map((match) => match[0]);
    expect(openings).toHaveLength(5);
    expect(openings.every((opening) => !opening.includes('aria-label='))).toBe(true);
    expect(html).toContain('<strong>Graph Build</strong> <small>ready</small>');
    expect(html).toContain('class="sr-only">, step 1 of 5</span>');
    expect(html).toContain('class="sr-only">, step 4 of 5, prerequisite not ready</span>');
  });
});

describe('graph keyboard entry and equivalent edge inspection', () => {
  function graphSvg(html: string): string {
    const match = /<svg\b[^>]*role="group"[\s\S]*?<\/svg>/u.exec(html);
    expect(match).not.toBeNull();
    return match![0];
  }
  it('exposes exactly one SVG tab stop with 12 source nodes, dense edges and 48 memory overlays', () => {
    const project = checkpointFixture();
    const template = project.graph!.nodes[0]!;
    project.graph!.nodes = Array.from({ length: 12 }, (_, index) => ({
      ...template,
      id: `topic-${index + 1}`,
      label: `Recorded topic ${index + 1}`,
    }));
    project.graph!.edges = project.graph!.nodes.flatMap((source, index) =>
      project.graph!.nodes.slice(index + 1).map((target) => ({
        source: source.id,
        target: target.id,
        label: 'co-occurs',
        weight: 1,
        sourceIds: ['S1'],
      })),
    );
    project.console!.memories = Array.from({ length: 48 }, (_, index) => ({
      id: `M-${index}`,
      platform: 'plaza',
      round: 1,
      simulatedMinute: 10,
      kind: 'action',
      agentId: 'agent-1',
      actionType: 'update',
      text: 'Recorded test-only update.',
      opinion: 0.2,
      peerIds: ['agent-1'],
      sourceIds: ['S1'],
    }));
    const svg = graphSvg(
      renderToStaticMarkup(<GraphCanvas project={project} evolution onInspect={() => {}} />),
    );
    expect(svg.match(/tabindex="0"/gu)).toHaveLength(1);
    const edges = [...svg.matchAll(/<g\b[^>]*class="graph-edge[^"]*"[^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(edges.length).toBeGreaterThan(36);
    expect(
      edges.every((edge) => !edge.includes('tabindex=') && !edge.includes('role="button"')),
    ).toBe(true);
    expect(svg).toContain('Use [ and ] to cycle nodes, Enter or Space to inspect');
  });
  it('keeps one keyboard entry when no graph nodes are available', () => {
    const project = projectFixture();
    project.graph = null;
    project.agents = [];
    const svg = graphSvg(
      renderToStaticMarkup(<GraphCanvas project={project} onInspect={() => {}} />),
    );
    expect(svg.match(/tabindex="0"/gu)).toHaveLength(1);
  });
  it('provides source-edge details as keyboard-reachable buttons in the node inspector', () => {
    const html = renderToStaticMarkup(
      <Inspector
        project={projectFixture()}
        selection={{ kind: 'node', id: 'topic-1' }}
        onInspect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('Recorded source relationships (1)');
    expect(buttonNames(html)).toContain('Synthetic topic → co-occurs → Other topic');
  });
});
