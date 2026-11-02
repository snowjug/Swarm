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
import {
  leaderOf,
  placeClusterLabels,
  placeFirstNames,
  placeNames,
  visibleLabels,
  type Box,
} from './labels';

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

describe('the names of the nodes that are named first', () => {
  const canvas = { left: 6, right: 384, top: 20, bottom: 560 };

  /** A phone-sized picture with the given nodes put where the test wants them, and every circle 14px across. */
  const crowd = (spots: { id: string; x: number; y: number; weight: number; label?: string }[]) => {
    const layout = layoutEcosystem({
      nodes: spots.map((spot) => ({ id: spot.id, cluster: 'use', weight: spot.weight })),
      edges: [],
      width: 390,
      height: 580,
    });
    for (const spot of spots) {
      layout.positions.set(spot.id, { x: spot.x, y: spot.y });
      layout.radii.set(spot.id, 14);
    }
    const nodes = spots.map((spot) => ({
      id: spot.id,
      label: spot.label ?? `Party ${spot.id}`,
      weight: spot.weight,
    }));
    return { layout, nodes };
  };

  const ring = (centre: { x: number; y: number }, count: number, distance: number) =>
    Array.from({ length: count }, (_, at) => {
      const angle = (at / count) * Math.PI * 2;
      return {
        id: `c${at}`,
        x: centre.x + Math.cos(angle) * distance,
        y: centre.y + Math.sin(angle) * distance,
        weight: 0.9,
      };
    });

  const apart = (a: Box, b: Box): boolean =>
    a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;

  /** Every pair of the names that are drawn, and which two overlap, if any. */
  const overlapping = (drawn: ReadonlyMap<string, { box: Box }>): string[] => {
    const entries = [...drawn.entries()];
    const found: string[] = [];
    for (let at = 0; at < entries.length; at += 1) {
      for (let other = at + 1; other < entries.length; other += 1) {
        if (!apart(entries[at]![1].box, entries[other]![1].box)) {
          found.push(`${entries[at]![0]} and ${entries[other]![0]}`);
        }
      }
    }
    return found;
  };

  it('names a first node before any other, however little it weighs, so that the limit is spent on it first', () => {
    // Twelve cohorts that weigh more, well apart, and a first node that weighs the least.
    const spread = Array.from({ length: 12 }, (_, at) => ({
      id: `c${at}`,
      x: 40 + (at % 4) * 100,
      y: 60 + Math.floor(at / 4) * 160,
      weight: 0.9 - at * 0.01,
    }));
    const { layout, nodes } = crowd([
      ...spread,
      { id: 'key', x: 190, y: 540, weight: 0.1, label: 'Administrators' },
    ]);
    const shown = placeNames(nodes, layout, [], canvas, undefined, {
      limit: 8,
      first: new Set(['key']),
    });
    expect(shown.has('key')).toBe(true);
    expect(shown.size).toBe(8);
    expect([...shown.keys()].filter((id) => id !== 'key').sort()).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
    ]);
    // Without the rule the node, the lightest, would be the thirteenth and would be left out.
    expect(placeNames(nodes, layout, [], canvas, undefined, { limit: 8 }).has('key')).toBe(false);
  });

  it('gives a first node a name in a crowd: it stands off its node, with a line to it, where its own sides are taken', () => {
    // A node with a ring of others close around it: below, above and both sides are all taken by other nodes.
    const centre = { x: 195, y: 280 };
    const { layout, nodes } = crowd([
      { id: 'key', ...centre, weight: 0.4, label: 'Competitors' },
      ...ring(centre, 10, 30),
    ]);
    const places = placeFirstNames(nodes, layout, canvas, undefined, { first: new Set(['key']) });
    const place = places.get('key');
    expect(place).toBeDefined();
    // Inside the canvas, and off every other node.
    expect(place!.box.x0).toBeGreaterThanOrEqual(canvas.left);
    expect(place!.box.x1).toBeLessThanOrEqual(canvas.right);
    expect(place!.box.y0).toBeGreaterThanOrEqual(canvas.top);
    expect(place!.box.y1).toBeLessThanOrEqual(canvas.bottom);
    for (const spot of ring(centre, 10, 30)) {
      const nearest = {
        x: Math.min(Math.max(spot.x, place!.box.x0), place!.box.x1),
        y: Math.min(Math.max(spot.y, place!.box.y0), place!.box.y1),
      };
      expect(Math.hypot(nearest.x - spot.x, nearest.y - spot.y)).toBeGreaterThan(14);
    }
    // Where it is not beside its node, it is joined to it.
    expect(place!.leader).toBe(true);
  });

  it('keeps the names of several first nodes apart from one another and from the edge of the canvas', () => {
    const { layout, nodes } = crowd([
      { id: 'a', x: 20, y: 120, weight: 0.9, label: 'Administrators' },
      { id: 'b', x: 60, y: 130, weight: 0.8, label: 'Competitors' },
      { id: 'c', x: 100, y: 120, weight: 0.7, label: 'Regulators' },
      { id: 'd', x: 370, y: 130, weight: 0.6, label: 'Sales director' },
    ]);
    const places = placeFirstNames(nodes, layout, canvas, undefined, {
      first: new Set(['a', 'b', 'c', 'd']),
    });
    expect([...places.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const place of places.values()) {
      expect(place.box.x0).toBeGreaterThanOrEqual(canvas.left);
      expect(place.box.x1).toBeLessThanOrEqual(canvas.right);
    }
    expect(overlapping(places)).toEqual([]);
  });

  it('keeps every name out of what floats over the picture, the zoom buttons in a corner', () => {
    const buttons = { x0: 330, x1: 384, y0: 380, y1: 540 };
    const { layout, nodes } = crowd([
      { id: 'key', x: 270, y: 450, weight: 0.5, label: 'Larkholm Ferry Company' },
      { id: 'other', x: 90, y: 450, weight: 0.4, label: 'Analyst' },
      { id: 'near', x: 300, y: 380, weight: 0.3, label: 'Visitor' },
    ]);
    const first = new Set(['key']);
    // Centred below its node, the name runs under the buttons: that is where it was drawn before they were known.
    const unaware = placeFirstNames(nodes, layout, canvas, undefined, { first });
    expect(apart(unaware.get('key')!.box, buttons)).toBe(false);
    const places = placeFirstNames(nodes, layout, canvas, undefined, { first, avoid: [buttons] });
    expect(places.has('key')).toBe(true);
    expect(apart(places.get('key')!.box, buttons)).toBe(true);
    const shown = placeNames(nodes, layout, [buttons], canvas, undefined, {
      first,
      placed: places,
    });
    expect(shown.size).toBeGreaterThan(1);
    for (const place of shown.values()) expect(apart(place.box, buttons)).toBe(true);
  });

  it('names the movers of a comparison without writing them over one another, when they stand side by side', () => {
    // Five of the heaviest movers in one tight bunch, the way adjacent actors of one group stand, and a few others.
    const bunch = [
      { id: 'm1', x: 150, y: 220, weight: 0.95, label: 'Customer support team' },
      { id: 'm2', x: 176, y: 232, weight: 0.9, label: 'Operations manager' },
      { id: 'm3', x: 202, y: 222, weight: 0.85, label: 'Marketing manager' },
      { id: 'm4', x: 164, y: 258, weight: 0.8, label: 'Delivery partners' },
      { id: 'm5', x: 192, y: 262, weight: 0.75, label: 'Specialist' },
    ];
    const others = Array.from({ length: 9 }, (_, at) => ({
      id: `o${at}`,
      x: 40 + (at % 3) * 150,
      y: 80 + Math.floor(at / 3) * 190,
      weight: 0.3,
    }));
    const { layout, nodes } = crowd([...bunch, ...others]);
    const first = new Set(bunch.map((node) => node.id));
    // They stand so close that each name below its node, as a name is by default, would be over its neighbour's.
    for (const [at, a] of bunch.entries()) {
      for (const b of bunch.slice(at + 1)) expect(Math.abs(a.x - b.x)).toBeLessThan(70);
    }
    // As in a comparison, where only the movers are named...
    const named = placeFirstNames(nodes, layout, canvas, undefined, { first });
    expect([...named.keys()].sort()).toEqual([...first].sort());
    expect(overlapping(named)).toEqual([]);
    // ...and as on a map, where the others are named around them: no two names drawn overlap.
    const all = placeNames(nodes, layout, [], canvas, undefined, { first });
    for (const id of first) expect(all.has(id)).toBe(true);
    expect(overlapping(all)).toEqual([]);
  });

  it('makes a group name and a cohort name give way to a first node', () => {
    const { layout, nodes } = crowd([
      { id: 'key', x: 195, y: 200, weight: 0.3, label: 'Clients' },
      { id: 'cohort', x: 195, y: 262, weight: 0.9, label: 'Managers' },
    ]);
    const firsts = placeFirstNames(nodes, layout, canvas, undefined, { first: new Set(['key']) });
    const keyBox = firsts.get('key')!.box;
    const group = { x0: keyBox.x0 + 2, x1: keyBox.x1 - 2, y0: keyBox.y0 + 2, y1: keyBox.y1 - 2 };
    const shown = placeNames(nodes, layout, [group], canvas, undefined, {
      first: new Set(['key']),
      placed: firsts,
    });
    expect(shown.get('key')!.box).toEqual(keyBox);
    const cohort = shown.get('cohort');
    if (cohort) expect(apart(cohort.box, keyBox)).toBe(true);
  });

  it('leaves a first node out, rather than write it over another name, when no place is clear in all its reach', () => {
    // A canvas the size of two names, and three first nodes in it.
    const small = { left: 0, right: 90, top: 0, bottom: 70 };
    const { layout, nodes } = crowd([
      { id: 'a', x: 45, y: 30, weight: 0.9, label: 'Administrators' },
      { id: 'b', x: 40, y: 38, weight: 0.8, label: 'Competitors' },
      { id: 'c', x: 50, y: 34, weight: 0.7, label: 'Regulators' },
    ]);
    const places = placeFirstNames(nodes, layout, small, undefined, {
      first: new Set(['a', 'b', 'c']),
    });
    expect(overlapping(places)).toEqual([]);
    for (const place of places.values()) {
      expect(place.box.x0).toBeGreaterThanOrEqual(small.left);
      expect(place.box.x1).toBeLessThanOrEqual(small.right);
    }
  });

  it('joins a name to its node only when it stands off it', () => {
    expect(leaderOf({ side: 'below', dx: 0, dy: 0, width: 80 }, 14)).toBeNull();
    const line = leaderOf({ side: 'below', dx: 0, dy: 30, width: 80 }, 14)!;
    expect(line).not.toBeNull();
    expect(Math.hypot(line.x0, line.y0)).toBeGreaterThan(14);
    expect(line.y1).toBeGreaterThan(line.y0);
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
