import { describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { PEER_LIMIT, rankPeers, selectPeers } from '../src/agents/peers.js';
import { createLimiter } from '../src/limiter.js';
import type { Agent } from '../../shared/types.js';

function agent(index: number, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `agent-${index}`,
    name: `Proxy ${index}`,
    role: 'Synthetic stakeholder',
    persona: `Fictional persona ${index}, assumed interests only.`,
    topicIds: ['n1'],
    initialOpinion: 0,
    opinion: 0,
    influence: 1,
    openness: 0.5,
    memory: [],
    sourceIds: ['S1'],
    ...overrides,
  };
}

describe('peer selection', () => {
  it('never includes the agent itself', () => {
    const agents = [agent(1), agent(2), agent(3)];
    for (const network of ['broadcast', 'community'] as const) {
      expect(selectPeers(agents[0]!, agents, network).map((peer) => peer.id)).not.toContain(
        'agent-1',
      );
    }
  });

  it('broadcast ranks by influence and keeps only the top voices', () => {
    const agents = [
      agent(1),
      ...Array.from({ length: 6 }, (_, index) =>
        agent(index + 2, { influence: 0.5 + index * 0.2 }),
      ),
    ];
    const peers = selectPeers(agents[0]!, agents, 'broadcast');
    expect(peers).toHaveLength(PEER_LIMIT.broadcast);
    expect(peers.map((peer) => peer.id)).toEqual(['agent-7', 'agent-6', 'agent-5', 'agent-4']);
  });

  it('community ignores views that are too distant and prefers shared topics and similar views', () => {
    const self = agent(1, { opinion: 0, topicIds: ['a', 'b'] });
    const sharesTwo = agent(2, { opinion: 0.4, topicIds: ['a', 'b'] });
    const sharesOne = agent(3, { opinion: 0.1, topicIds: ['a'] });
    const sharesNone = agent(4, { opinion: 0.05, topicIds: ['z'] });
    const tooFar = agent(5, { opinion: 0.96, topicIds: ['a', 'b'] });
    const ranked = rankPeers(self, [self, sharesNone, tooFar, sharesOne, sharesTwo], 'community');
    expect(ranked.map((peer) => peer.id)).toEqual(['agent-2', 'agent-3', 'agent-4']);
  });

  it('community breaks ties by id so runs are reproducible', () => {
    const self = agent(1);
    const twins = [agent(4), agent(2), agent(3)];
    const first = rankPeers(self, [self, ...twins], 'community').map((peer) => peer.id);
    const second = rankPeers(self, [self, ...[...twins].reverse()], 'community').map(
      (peer) => peer.id,
    );
    expect(first).toEqual(['agent-2', 'agent-3', 'agent-4']);
    expect(second).toEqual(first);
  });

  it('does not mutate the caller’s population', () => {
    const agents = [agent(1), agent(2, { influence: 2 }), agent(3, { influence: 0.2 })];
    const before = agents.map((item) => item.id);
    selectPeers(agents[0]!, agents, 'broadcast');
    expect(agents.map((item) => item.id)).toEqual(before);
  });
});

describe('createLimiter', () => {
  it('rejects invalid concurrency', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => createLimiter(bad)).toThrow(RangeError);
    }
  });

  it('never runs more than the cap at once, yet finishes every task', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        limit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(2);
          active -= 1;
          return index;
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('starts waiting tasks in arrival order', async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3].map((index) =>
        limit(async () => {
          order.push(index);
          await sleep(1);
        }),
      ),
    );
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('frees the slot when a task fails, so later tasks are not stuck', async () => {
    const limit = createLimiter(1);
    const outcomes = await Promise.allSettled([
      limit(async () => {
        throw new Error('boom');
      }),
      limit(async () => 'after failure'),
    ]);
    expect(outcomes[0]?.status).toBe('rejected');
    expect(outcomes[1]).toEqual({ status: 'fulfilled', value: 'after failure' });
  });

  it('is shared by everything that holds the same limiter', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const work = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(2);
      active -= 1;
    };
    await Promise.all([
      ...Array.from({ length: 4 }, () => limit(work)),
      ...Array.from({ length: 4 }, () => limit(work)),
    ]);
    expect(peak).toBe(2);
  });
});
