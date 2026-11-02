import { describe, expect, it } from 'vitest';
import {
  actorFixture,
  actorSetFixture,
  stakeholderFixture,
  stakeholderSetFixture,
} from '../../../../shared/lab-fixtures';
import { CLUSTER_ORDER, clusterGroup, clusterLabel, stanceColor, stanceWord } from '../palette';
import { PositionField, edgePath } from './field';
import { layoutEcosystem, nearestInDirection, radiusOf } from './layout';
import {
  directionOfImpact,
  edgesOf,
  neighbourhood,
  nodeFromActor,
  nodesFromActors,
  nodesFromStakeholders,
} from './model';
import { placeClusterLabels, visibleLabels } from './labels';

const nodes = Array.from({ length: 22 }, (_, index) => ({
  id: `n${index}`,
  cluster: CLUSTER_ORDER[index % 6]!,
  weight: 0.25 + ((index * 37) % 70) / 100,
}));
const edges = Array.from({ length: 28 }, (_, index) => ({
  from: `n${index % 22}`,
  to: `n${(index * 7 + 3) % 22}`,
  strength: 0.3 + ((index * 13) % 60) / 100,
})).filter((edge) => edge.from !== edge.to);

const canvas = { width: 960, height: 560, inset: { top: 32, right: 32, bottom: 52, left: 32 } };

describe('layoutEcosystem', () => {
  it('draws the same picture for the same input', () => {
    const first = layoutEcosystem({ nodes, edges, ...canvas });
    const second = layoutEcosystem({ nodes, edges, ...canvas });
    expect([...second.positions]).toEqual([...first.positions]);
  });

  it('does not depend on the order the nodes arrive in', () => {
    const first = layoutEcosystem({ nodes, edges, ...canvas });
    const second = layoutEcosystem({ nodes: [...nodes].reverse(), edges, ...canvas });
    for (const [id, point] of first.positions) {
      const other = second.positions.get(id)!;
      expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeLessThan(90);
    }
  });

  it('keeps every node inside the canvas and clear of every other', () => {
    for (const size of [
      { width: 390, height: 520, scale: 0.82 },
      { width: 960, height: 560, scale: 1 },
      { width: 1500, height: 760, scale: 1 },
    ]) {
      const layout = layoutEcosystem({
        nodes,
        edges,
        inset: { top: 24, right: 24, bottom: 40, left: 24 },
        ...size,
      });
      const placed = nodes.map((node) => ({
        ...layout.positions.get(node.id)!,
        r: layout.radii.get(node.id)!,
      }));
      for (const [index, p] of placed.entries()) {
        expect(p.x - p.r).toBeGreaterThanOrEqual(0);
        expect(p.x + p.r).toBeLessThanOrEqual(size.width);
        expect(p.y - p.r).toBeGreaterThanOrEqual(0);
        expect(p.y + p.r).toBeLessThanOrEqual(size.height);
        for (const q of placed.slice(index + 1))
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r - 0.5);
      }
    }
  });

  it('gathers a cluster closer together than it is to the rest', () => {
    const layout = layoutEcosystem({ nodes, edges: [], ...canvas });
    const own: number[] = [];
    const others: number[] = [];
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id >= b.id) continue;
        const distance = Math.hypot(
          layout.positions.get(a.id)!.x - layout.positions.get(b.id)!.x,
          layout.positions.get(a.id)!.y - layout.positions.get(b.id)!.y,
        );
        (a.cluster === b.cluster ? own : others).push(distance);
      }
    }
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(own)).toBeLessThan(mean(others) * 0.8);
  });

  it('copes with nothing, one node and a single cluster', () => {
    expect(layoutEcosystem({ nodes: [], edges: [], ...canvas }).positions.size).toBe(0);
    const one = layoutEcosystem({ nodes: [nodes[0]!], edges: [], ...canvas });
    expect(one.positions.get('n0')).toBeDefined();
    expect(one.clusters).toHaveLength(1);
  });

  it('ignores relations to nodes that are not there', () => {
    const layout = layoutEcosystem({
      nodes: nodes.slice(0, 4),
      edges: [{ from: 'n0', to: 'ghost', strength: 1 }],
      ...canvas,
    });
    expect(layout.positions.size).toBe(4);
  });

  it('makes heavier nodes larger', () => {
    expect(radiusOf(1)).toBeGreaterThan(radiusOf(0.2));
    expect(radiusOf(0.5, 0.8)).toBeLessThan(radiusOf(0.5, 1));
  });
});

describe('nearestInDirection', () => {
  const candidates = [
    { id: 'east', x: 100, y: 4 },
    { id: 'far-east', x: 300, y: 0 },
    { id: 'north', x: 3, y: -90 },
    { id: 'south-west', x: -80, y: 70 },
  ];
  const origin = { x: 0, y: 0 };
  it('moves to the nearest node that lies the way the key points', () => {
    expect(nearestInDirection(origin, candidates, 'right')).toBe('east');
    expect(nearestInDirection(origin, candidates, 'up')).toBe('north');
    expect(nearestInDirection(origin, candidates, 'left')).toBe('south-west');
    expect(nearestInDirection(origin, candidates, 'down')).toBe('south-west');
  });
  it('stays put at the edge', () => {
    expect(nearestInDirection({ x: 300, y: 0 }, candidates, 'right')).toBeNull();
  });
});

describe('PositionField', () => {
  const run = (field: PositionField, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) field.step(1 / 60);
  };
  it('brings a node to where it is told to go, without leaving it short', () => {
    const field = new PositionField();
    field.setTargets(new Map([['a', { x: 0, y: 0 }]]));
    field.setTargets(new Map([['a', { x: 200, y: -80 }]]));
    run(field, 3);
    expect(field.get('a')).toEqual({ x: 200, y: -80 });
    expect(field.step(1 / 60)).toBe(false);
  });
  it('starts a new node where it is sent from, and forgets one that has gone', () => {
    const field = new PositionField();
    field.setTargets(new Map([['a', { x: 10, y: 10 }]]));
    field.setTargets(
      new Map([
        ['a', { x: 10, y: 10 }],
        ['b', { x: 100, y: 100 }],
      ]),
      (id) => (id === 'b' ? { x: 0, y: 0 } : undefined),
    );
    expect(field.get('b')).toEqual({ x: 0, y: 0 });
    run(field, 0.1);
    expect(field.get('b')!.x).toBeGreaterThan(0);
    field.setTargets(new Map([['b', { x: 100, y: 100 }]]));
    expect(field.get('a')).toBeUndefined();
  });
  it('moves with a spring: it does not shoot past by much', () => {
    const field = new PositionField();
    field.setTargets(new Map([['a', { x: 0, y: 0 }]]));
    field.setTargets(new Map([['a', { x: 100, y: 0 }]]));
    let peak = 0;
    for (let t = 0; t < 3; t += 1 / 60) {
      field.step(1 / 60);
      peak = Math.max(peak, field.get('a')!.x);
    }
    expect(peak).toBeLessThan(108);
  });
  it('can be snapped', () => {
    const field = new PositionField();
    field.setTargets(new Map([['a', { x: 0, y: 0 }]]));
    field.setTargets(new Map([['a', { x: 50, y: 50 }]]));
    field.snap();
    expect(field.get('a')).toEqual({ x: 50, y: 50 });
  });
});

describe('edgePath', () => {
  it('runs from the rim of one node to the rim of the other', () => {
    const path = edgePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 10, 0);
    expect(path).toMatch(/^M13\.0 0\.0Q/);
    expect(path).toMatch(/86\.0 0\.0$/);
  });
  it('draws nothing between nodes on the same spot', () => {
    expect(edgePath({ x: 5, y: 5 }, { x: 5, y: 5 }, 8, 8, 0.1)).toBe('');
  });
});

describe('visibleLabels', () => {
  it('names the heavier node below, and puts the other name on a side where it is not written over it', () => {
    const layout = layoutEcosystem({
      nodes: [
        { id: 'big', cluster: 'use', weight: 1 },
        { id: 'small', cluster: 'use', weight: 0.2 },
      ],
      edges: [],
      width: 320,
      height: 200,
    });
    layout.positions.set('big', { x: 100, y: 80 });
    layout.positions.set('small', { x: 150, y: 90 });
    const shown = visibleLabels(
      [
        { id: 'big', label: 'The big one', weight: 1 },
        { id: 'small', label: 'The small one', weight: 0.2 },
      ],
      layout,
    );
    expect(shown.get('big')).toBe('below');
    expect(shown.has('small')).toBe(true);
    expect(shown.get('small')).not.toBe('below');
  });

  it('keeps a name inside the canvas: beside its node, on the side that has room, when below would run off the edge', () => {
    const layout = layoutEcosystem({
      nodes: [{ id: 'edge', cluster: 'use', weight: 1 }],
      edges: [],
      width: 320,
      height: 200,
    });
    layout.positions.set('edge', { x: 20, y: 80 });
    const nodes = [{ id: 'edge', label: 'Customer support team', weight: 1 }];
    expect(visibleLabels(nodes, layout).get('edge')).toBe('below');
    expect(visibleLabels(nodes, layout, [], { left: 6, right: 314 }).get('edge')).toBe('right');
    layout.positions.set('edge', { x: 300, y: 80 });
    expect(visibleLabels(nodes, layout, [], { left: 6, right: 314 }).get('edge')).toBe('left');
  });
});

describe('visibleLabels on the screen the camera shows', () => {
  const row = (spacing: number) => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    const nodes = names.map((label, at) => ({
      id: label.toLowerCase(),
      label: `${label} team`,
      weight: 1 - at * 0.1,
    }));
    const layout = layoutEcosystem({
      nodes: nodes.map((node) => ({ id: node.id, cluster: 'use', weight: node.weight })),
      edges: [],
      width: 800,
      height: 300,
    });
    nodes.forEach((node, at) => layout.positions.set(node.id, { x: 100 + at * spacing, y: 150 }));
    return { nodes, layout };
  };

  it('names fewer parties when the picture is zoomed out, because they stand closer on the screen', () => {
    const { nodes, layout } = row(90);
    const atRest = visibleLabels(nodes, layout);
    const farOut = visibleLabels(nodes, layout, [], undefined, { k: 0.4, x: 0, y: 0 });
    expect(atRest.size).toBe(5);
    expect(farOut.size).toBeLessThan(atRest.size);
  });

  it('names more parties when zoomed in on a crowd, because they stand further apart', () => {
    const { nodes, layout } = row(28);
    const atRest = visibleLabels(nodes, layout);
    const close = visibleLabels(nodes, layout, [], undefined, { k: 3, x: -200, y: -200 });
    expect(atRest.size).toBeLessThan(5);
    expect(close.size).toBe(5);
  });

  it('keeps names inside the canvas as it is now, not as the picture was drawn', () => {
    const layout = layoutEcosystem({
      nodes: [{ id: 'edge', cluster: 'use', weight: 1 }],
      edges: [],
      width: 320,
      height: 200,
    });
    layout.positions.set('edge', { x: 20, y: 80 });
    const nodes = [{ id: 'edge', label: 'Customer support team', weight: 1 }];
    const canvas = { left: 6, right: 314 };
    expect(visibleLabels(nodes, layout, [], canvas).get('edge')).toBe('right');
    expect(visibleLabels(nodes, layout, [], canvas, { k: 1, x: 120, y: 0 }).get('edge')).toBe(
      'below',
    );
    expect(visibleLabels(nodes, layout, [], canvas, { k: 1, x: -150, y: 0 }).has('edge')).toBe(
      false,
    );
  });

  it('keeps a name clear of a group name that is already on the screen', () => {
    const { nodes, layout } = row(200);
    const obstacle = { x0: 60, x1: 160, y0: 155, y1: 200 };
    expect(visibleLabels(nodes, layout).get('alpha')).toBe('below');
    expect(visibleLabels(nodes, layout, [obstacle]).get('alpha')).not.toBe('below');
  });
});

describe('placeClusterLabels', () => {
  const partners = [
    { id: 'a', cluster: 'partners', label: 'A', weight: 1 },
    { id: 'b', cluster: 'partners', label: 'B', weight: 1 },
  ];
  const atEdge = () => {
    const layout = layoutEcosystem({ nodes: partners, edges: [], width: 390, height: 500 });
    for (const cluster of layout.clusters) {
      cluster.x = 360;
      cluster.y = 250;
    }
    layout.positions.set('a', { x: 350, y: 250 });
    layout.positions.set('b', { x: 370, y: 250 });
    return layout;
  };
  const canvas = { left: 8, top: 8, right: 382, bottom: 492 };

  it('slides a group name inward when the group is at the edge of the canvas, and keeps it clear of the nodes', () => {
    const spots = placeClusterLabels(partners, atEdge(), () => 'Partners and operations', canvas);
    const spot = [...spots.values()][0]!;
    expect(spot.box.x1).toBeLessThanOrEqual(382);
    expect(spot.box.x0).toBeGreaterThanOrEqual(8);
  });

  it('keeps it inside the canvas where the camera has moved the group to, not where the group was drawn', () => {
    const layout = atEdge();
    for (const view of [
      { k: 0.8, x: 60, y: 20 },
      { k: 1.6, x: -420, y: -300 },
      { k: 0.6, x: 120, y: 200 },
    ]) {
      const spots = placeClusterLabels(
        partners,
        layout,
        () => 'Partners and operations',
        canvas,
        view,
      );
      const spot = [...spots.values()][0]!;
      expect(spot.box.x1).toBeLessThanOrEqual(canvas.right);
      expect(spot.box.x0).toBeGreaterThanOrEqual(canvas.left);
    }
  });

  it('puts the name at its offset in pixels from the group, which scales with the zoom of the group, not of the name', () => {
    const layout = atEdge();
    layout.clusters[0]!.x = 195;
    layout.positions.set('a', { x: 185, y: 250 });
    layout.positions.set('b', { x: 205, y: 250 });
    const near = placeClusterLabels(partners, layout, () => 'Partners', canvas, {
      k: 1,
      x: 0,
      y: 0,
    });
    const far = placeClusterLabels(partners, layout, () => 'Partners', canvas, {
      k: 2,
      x: -195,
      y: -250,
    });
    const closeOffset = Math.abs([...near.values()][0]!.dy);
    const farOffset = Math.abs([...far.values()][0]!.dy);
    expect(farOffset).toBeGreaterThan(closeOffset);
  });
});

describe('the ecosystem model', () => {
  const set = stakeholderSetFixture();
  const actors = actorSetFixture();

  it('turns stakeholders into nodes and leaves the removed out', () => {
    const removed = { ...set.stakeholders[1]!, status: 'removed' as const };
    const list = nodesFromStakeholders([set.stakeholders[0]!, removed]);
    expect(list.map((node) => node.id)).toEqual([set.stakeholders[0]!.id]);
    expect(list[0]!.weight).toBeGreaterThan(0.8);
  });

  it('turns the reverse of a stated uncertainty into confidence', () => {
    const base = stakeholderFixture('x', 'end-user');
    const low = nodesFromStakeholders([
      { ...base, uncertainty: { level: 'low', reason: 'x' } },
    ])[0]!;
    const high = nodesFromStakeholders([
      { ...base, uncertainty: { level: 'high', reason: 'x' } },
    ])[0]!;
    expect(low.confidence).toBe('high');
    expect(high.confidence).toBe('low');
  });

  it('reads the direction of an actor from its stakeholder first and its impact trait otherwise', () => {
    const actor = actorFixture('a', 'end-user');
    const stakeholder = stakeholderFixture('a', 'end-user', {
      expectedImpact: { direction: 'harmed', rationale: 'x' },
    });
    expect(nodeFromActor(actor, stakeholder).direction).toBe('harmed');
    expect(nodeFromActor(actor).direction).toBe(
      directionOfImpact(actor.traits.impact.value, actor.traits.impact.spread),
    );
    expect(directionOfImpact(-0.4, 0)).toBe('harmed');
    expect(directionOfImpact(0.4, 0)).toBe('benefited');
    expect(directionOfImpact(0, 0.5)).toBe('mixed');
    expect(directionOfImpact(0, 0)).toBe('unclear');
  });

  it('sizes an actor by its influence and shows a cohort as a cohort', () => {
    const list = nodesFromActors(actors.actors, set.stakeholders);
    expect(list).toHaveLength(actors.actors.length);
    for (const node of list) {
      expect(node.weight).toBeGreaterThan(0);
      expect(node.weight).toBeLessThanOrEqual(1);
    }
  });

  it('keeps relations between nodes that exist, once each', () => {
    const ids = new Set(['a', 'b', 'c']);
    const list = edgesOf(
      [
        { from: 'a', to: 'b', type: 'influences', strength: 0.5 },
        { from: 'a', to: 'b', type: 'influences', strength: 0.9 },
        { from: 'a', to: 'x', type: 'supplies', strength: 0.5 },
        { from: 'c', to: 'c', type: 'supplies', strength: 0.5 },
        { from: 'b', to: 'c', type: 'competes-with', strength: 0.4 },
      ],
      ids,
    );
    expect(list.map((edge) => edge.id)).toEqual(['a>influences>b', 'b>competes-with>c']);
  });

  it('finds what a node is joined to', () => {
    const list = edgesOf(
      [
        { from: 'a', to: 'b', type: 'influences', strength: 0.5 },
        { from: 'c', to: 'a', type: 'supplies', strength: 0.5 },
        { from: 'b', to: 'd', type: 'supplies', strength: 0.5 },
      ],
      new Set(['a', 'b', 'c', 'd']),
    );
    const around = neighbourhood('a', list);
    expect([...around.nodes].sort()).toEqual(['a', 'b', 'c']);
    expect(around.edges.size).toBe(2);
  });
});

describe('the palette', () => {
  it('gives every category a group, a label and a colour', () => {
    for (const category of ['decision-maker', 'competitor', 'regulator', 'other'] as const) {
      const group = clusterGroup(category);
      expect(CLUSTER_ORDER).toContain(group.id);
      expect(clusterLabel(group.id)).toBe(group.label);
    }
  });
  it('colours a stance by its size relative to the scale and says it in words', () => {
    expect(stanceColor(-0.5, 0.5)).toContain('--c-against');
    expect(stanceColor(0.5, 0.5)).toContain('--c-favor');
    expect(stanceColor(0, 0.5)).toContain('0%');
    expect(stanceColor(Number.NaN)).toBe('var(--c-neutral)');
    expect(stanceWord(-0.5, 0.5)).toBe('against');
    expect(stanceWord(0.05, 0.5)).toBe('undecided');
    expect(stanceWord(0.2, 0.5)).toBe('leaning in favour');
    expect(stanceWord(0.2, 0.2)).toBe('in favour');
  });
});
