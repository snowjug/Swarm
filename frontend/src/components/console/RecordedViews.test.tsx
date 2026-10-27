import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunComparison } from '../../../../shared/guided';
import { checkpointFixture } from '../../test/project';
import { ComparisonResults } from './ComparisonResults';
import { GraphRoundControl } from './GraphRoundControl';
import { GraphCanvas } from './GraphCanvas';
import { OperationLog } from './OperationLog';
import { TrajectoryChart } from './TrajectoryChart';
import { EntryConsole } from './EntryConsole';
import { recordedMemories, layoutGraph } from '../../lib/graph';

function comparisonFixture(): RunComparison {
  const metrics = {
    meanOpinion: 0.2,
    supportShare: 0.5,
    oppositionShare: 0.25,
    undecidedShare: 0.25,
    polarization: 0.3,
    activityCount: 1,
  };
  const run = {
    id: 'base',
    name: 'Base test run',
    status: 'ready',
    seed: 42,
    completedRounds: 1,
    totalRounds: 3,
    branchFromRound: null,
    intervention: null,
  };
  return {
    base: run,
    other: { ...run, id: 'other', name: 'Other test run', branchFromRound: 0 },
    lineage: 'base-is-parent',
    identicalThroughRound: 0,
    rounds: [
      {
        round: 1,
        base: metrics,
        other: { ...metrics, meanOpinion: 0.3 },
        delta: {
          meanOpinion: 0.1,
          supportShare: 0,
          oppositionShare: 0,
          undecidedShare: 0,
          polarization: 0,
          activityCount: 0,
        },
      },
    ],
    declaredChanges: [],
    notes: ['Synthetic note: no causal effect is established. <b>Not HTML.</b>'],
  };
}

describe('recorded comparison and trajectory accessibility', () => {
  it('names both comparison charts and exposes real values and deltas in a real table', () => {
    const html = renderToStaticMarkup(<ComparisonResults comparison={comparisonFixture()} />);
    expect(html.match(/role="img"/gu)).toHaveLength(2);
    expect(html).toContain('aria-label="Mean inclination — recorded run comparison.');
    expect(html).toContain('aria-label="Polarization — recorded run comparison.');
    expect(html).toContain('solid line with circles');
    expect(html).toContain('dashed line with squares');
    expect(html).toContain('<table');
    expect(html).toContain('<caption>');
    expect(html).toContain('scope="rowgroup"');
    expect(html).toContain('+0.100');
    expect(html).toContain('Identical through round 0');
    expect(html).toContain('Base test run is the parent run of Other test run.');
    expect(html).toContain(
      'Synthetic note: no causal effect is established. &lt;b&gt;Not HTML.&lt;/b&gt;',
    );
    expect(html).not.toContain('<b>Not HTML.</b>');
    const fontSizes = [...html.matchAll(/font-size="([0-9.]+)"/gu)].map((match) =>
      Number(match[1]),
    );
    expect(fontSizes.length).toBeGreaterThan(0);
    expect(fontSizes.every((size) => size >= 12)).toBe(true);
  });
  it('does not fill missing comparison rounds or deltas', () => {
    const comparison = comparisonFixture();
    comparison.rounds[0]!.other = null;
    comparison.rounds[0]!.delta = null;
    const html = renderToStaticMarkup(<ComparisonResults comparison={comparison} />);
    expect(html).toContain('Not recorded');
    expect(html).not.toContain('+0.100');
  });
  it('shows all current-run trajectory measures and a labelled data-table toggle', () => {
    const html = renderToStaticMarkup(<TrajectoryChart project={checkpointFixture()} />);
    for (const label of [
      'Mean inclination',
      'Support share',
      'Opposition share',
      'Undecided share',
      'Polarization',
    ])
      expect(html).toContain(label);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Show trajectory data table');
    expect(html).toContain('<caption>Current run');
  });
});

describe('graph recorded-round evolution', () => {
  it('filters only persisted overlays at or before the selected round, retaining seed round 0', () => {
    const project = checkpointFixture();
    const input = {
      graph: project.graph,
      agents: project.agents,
      seed: 42,
      memories: [0, 1, 2].map((round) => ({
        id: `M-${round}`,
        platform: 'plaza' as const,
        round,
        simulatedMinute: round * 10,
        kind: round === 0 ? ('seed' as const) : ('action' as const),
        agentId: round === 0 ? null : 'agent-1',
        actionType: round === 0 ? ('seed' as const) : ('update' as const),
        text: `Recorded round ${round}`,
        opinion: null,
        peerIds: [],
        sourceIds: ['S1'],
      })),
    };
    expect(recordedMemories(input, 0).map((memory) => memory.id)).toEqual(['M-0']);
    expect(recordedMemories(input, 1).map((memory) => memory.id)).toEqual(['M-0', 'M-1']);
    const graph = layoutGraph(input, true, 1);
    expect(
      graph.nodes.filter((node) => node.layer === 'memory').map((node) => node.referenceId),
    ).toEqual(['M-0', 'M-1']);
    expect(graph.nodes.filter((node) => node.layer === 'source')).toHaveLength(
      project.graph!.nodes.length,
    );
    expect(input.memories).toHaveLength(3);
  });
  it('labels the slider and announces the selected recorded round', () => {
    const html = renderToStaticMarkup(
      <GraphRoundControl round={1} completed={3} onChange={() => {}} />,
    );
    expect(html).toContain('type="range"');
    expect(html).toContain('min="0" max="3"');
    expect(html).toContain('aria-valuetext="Round 1 of 3 recorded rounds"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('the source graph itself is static');
    expect(html).toContain('does not execute, accelerate or invent');
  });
  it('keeps memory accessible names but does not print every memory label on the canvas', () => {
    const project = checkpointFixture();
    project.console!.memories = [
      {
        id: 'M-1',
        platform: 'plaza',
        round: 1,
        simulatedMinute: 10,
        kind: 'action',
        agentId: 'agent-1',
        actionType: 'update',
        text: 'Recorded test update.',
        opinion: 0.2,
        peerIds: [],
        sourceIds: ['S1'],
      },
    ];
    const html = renderToStaticMarkup(
      <GraphCanvas project={project} onInspect={() => {}} evolution />,
    );
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('Plaza R1 · update');
    expect(html).not.toMatch(/<text[^>]*>Plaza R1/gu);
    expect(html).toContain('Inspect node');
  });
});

describe('audit regression: in-flow log and entry validation semantics', () => {
  it('starts collapsed with the actual latest saved event and exposes an expanded live log', () => {
    const project = checkpointFixture();
    project.events = [
      {
        id: 1,
        projectId: project.id,
        stage: 'simulation',
        message: 'A real persisted test event.',
        createdAt: project.updatedAt,
      },
    ];
    const collapsed = renderToStaticMarkup(<OperationLog project={project} />);
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('Expand log');
    expect(collapsed).toContain('A real persisted test event.');
    expect(collapsed).not.toContain('class="log-line ');
    const expanded = renderToStaticMarkup(<OperationLog project={project} initialExpanded />);
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('role="log"');
    expect(expanded).toContain('aria-live="polite"');
    expect(expanded).toContain('Collapse log');
    expect(expanded).toContain('class="log-line ');
  });
  it('uses custom inline entry validation with associated live feedback instead of a native empty-submit block', () => {
    const html = renderToStaticMarkup(
      <EntryConsole config={null} busy={false} onSubmit={async () => {}} onHistory={() => {}} />,
    );
    expect(html).toMatch(/<form[^>]*noValidate=""/u);
    expect(html).toContain('id="project-name" aria-describedby=');
    expect(html).toContain('id="project-question" aria-describedby=');
    expect(html).toContain('aria-live="polite"');
  });
});
