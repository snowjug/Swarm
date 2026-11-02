import { describe, expect, it } from 'vitest';
import {
  actorSetFixture,
  stakeholderFixture,
  stakeholderSetFixture,
} from '../../../../shared/lab-fixtures';
import type { Stakeholder } from '../../../../shared/stakeholders';
import { nodesFromStakeholders } from '../../viz/ecosystem/model';
import {
  buildMapModel,
  clusterOptions,
  connectionsOf,
  enoughToApprove,
  ghostsOf,
  nextInQueue,
  partyKicker,
  partyOf,
  reviewQueue,
} from './model';

const set = stakeholderSetFixture();
const actors = actorSetFixture();

describe('what the map is made of', () => {
  it('draws the stakeholders before there are actors, and the actors after', () => {
    const first = buildMapModel({ set, actors: null, subject: 'stakeholders' });
    expect(first.nodes).toHaveLength(
      set.stakeholders.filter((item) => item.status !== 'removed').length,
    );
    const second = buildMapModel({ set, actors, subject: 'actors' });
    expect(second.nodes).toHaveLength(actors.actors.length);
    expect(second.ghosts).toEqual([]);
  });

  it('asks for the actors only when it has them', () => {
    const model = buildMapModel({ set, actors: null, subject: 'actors' });
    expect(model.nodes.map((node) => node.id).sort()).toEqual(
      set.stakeholders.map((item) => item.id).sort(),
    );
  });

  it('leaves out what was removed, and the relations that touched it', () => {
    const removed = {
      ...set,
      stakeholders: set.stakeholders.map((item, index): Stakeholder =>
        index === 0 ? { ...item, status: 'removed' } : item,
      ),
    };
    const model = buildMapModel({ set: removed, actors: null, subject: 'stakeholders' });
    expect(model.nodes.map((node) => node.id)).not.toContain(set.stakeholders[0]!.id);
    for (const edge of model.edges) {
      expect([edge.from, edge.to]).not.toContain(set.stakeholders[0]!.id);
    }
  });
});

describe('places nobody was found for', () => {
  const present = nodesFromStakeholders([stakeholderFixture('r', 'regulator')]);
  it('shows a missing kind and a missing role, once each', () => {
    const ghosts = ghostsOf(['competitor', 'competitor', 'The privacy officer'], present);
    expect(ghosts.map((ghost) => ghost.label)).toEqual(['Competitor', 'The privacy officer']);
    expect(ghosts[1]!.category).toBe('other');
    expect(ghosts[1]!.text).toBe('The privacy officer');
    expect(ghosts[0]!.text).toBeNull();
  });
  it('does not call a kind missing when it is on the map', () => {
    expect(ghostsOf(['regulator'], present)).toEqual([]);
  });
  it('shortens a long role for the map and keeps it whole for the form', () => {
    const [ghost] = ghostsOf(['The person who is responsible for data protection'], present);
    expect(ghost!.label.length).toBeLessThanOrEqual(26);
    expect(ghost!.text).toBe('The person who is responsible for data protection');
  });
  it('shows at most a few, and never an empty one', () => {
    const many = Array.from({ length: 12 }, (_, index) => `A role number ${index}`);
    expect(ghostsOf(['', '  ', ...many], present)).toHaveLength(5);
  });
});

describe('what a person looks at next', () => {
  const proposed = (
    id: string,
    priority: Stakeholder['priority'],
    status: Stakeholder['status'] = 'proposed',
  ) => stakeholderFixture(id, 'end-user', { priority, status });
  const list = {
    ...set,
    stakeholders: [
      proposed('a', 'background'),
      proposed('b', 'key'),
      proposed('c', 'standard', 'accepted'),
      proposed('d', 'standard'),
    ],
  };
  it('goes through the unreviewed, key actors first', () => {
    expect(reviewQueue(list)).toEqual(['b', 'd', 'a']);
  });
  it('goes round', () => {
    const queue = ['b', 'd', 'a'];
    expect(nextInQueue(queue, null)).toBe('b');
    expect(nextInQueue(queue, 'b')).toBe('d');
    expect(nextInQueue(queue, 'a')).toBe('b');
    expect(nextInQueue(queue, 'c')).toBe('b');
    expect(nextInQueue([], 'a')).toBeNull();
  });
  it('needs two parties to approve', () => {
    expect(enoughToApprove({ ...set, stakeholders: [proposed('a', 'key')] })).toBe(false);
    expect(
      enoughToApprove({
        ...set,
        stakeholders: [proposed('a', 'key'), proposed('b', 'key', 'removed')],
      }),
    ).toBe(false);
    expect(enoughToApprove(list)).toBe(true);
  });
});

describe('groups and connections', () => {
  it('counts the groups in the order the legend lists them', () => {
    const options = clusterOptions(nodesFromStakeholders(set.stakeholders));
    expect(options.reduce((sum, option) => sum + option.count, 0)).toBe(set.stakeholders.length);
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  });

  it('says each relation from the point of view of the party asked about', () => {
    const edges = [
      { id: 'a>regulates>b', from: 'a', to: 'b', type: 'regulates' as const, strength: 0.4 },
      { id: 'c>supplies>a', from: 'c', to: 'a', type: 'supplies' as const, strength: 0.9 },
      { id: 'b>influences>c', from: 'b', to: 'c', type: 'influences' as const, strength: 0.7 },
    ];
    const ofA = connectionsOf('a', edges);
    expect(ofA.map((link) => [link.otherId, link.phrase])).toEqual([
      ['c', 'is supplied by'],
      ['b', 'regulates'],
    ]);
    expect(connectionsOf('b', edges).map((link) => link.phrase)).toEqual([
      'influences',
      'is regulated by',
    ]);
    expect(connectionsOf('z', edges)).toEqual([]);
  });

  it('finds the stakeholder and the actor behind one id, and says what to call it', () => {
    const id = set.stakeholders[0]!.id;
    const party = partyOf(id, set, actors);
    expect(party?.stakeholder?.id).toBe(id);
    expect(party?.actor?.id).toBe(id);
    expect(partyOf('nobody', set, actors)).toBeNull();
    expect(partyKicker(party!, 'stakeholders').text).toMatch(/·/u);
    expect(partyKicker(party!, 'actors').name).toBe(party!.actor!.name);
  });
});
