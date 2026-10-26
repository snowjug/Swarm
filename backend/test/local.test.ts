import { describe, expect, it } from 'vitest';
import type { RoundSnapshot, SimulationSettings } from '../../shared/types.js';
import { createLocalAgents, localRound } from '../src/agents/local.js';
import { buildLocalGraph } from '../src/knowledge/graph.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { fixtureInput } from './fixtures.js';

const input = fixtureInput();
const graph = buildLocalGraph(
  chunkDocuments(input.documents.map((document, index) => ({ ...document, id: `D${index + 1}` }))),
  input.question,
);

function simulate(settings: SimulationSettings) {
  let agents = createLocalAgents(graph, settings);
  const rounds: RoundSnapshot[] = [];
  for (let round = 1; round <= settings.rounds; round += 1) {
    const result = localRound(agents, settings, round);
    agents = result.agents;
    rounds.push(result.snapshot);
  }
  return { agents, rounds };
}

describe('real rules-based simulation', () => {
  it('is reproducible for the same evidence/configuration/seed, not pre-recorded output', () => {
    const first = simulate(input.settings);
    expect(simulate(input.settings)).toEqual(first);
    expect(simulate({ ...input.settings, seed: 43 })).not.toEqual(first);
    expect(first.rounds).toHaveLength(input.settings.rounds);
    expect(first.rounds[0]!.opinions).not.toEqual(first.rounds.at(-1)!.opinions);
  });

  it('preserves bounded simultaneous state and auditable peer/action counts', () => {
    const { agents, rounds } = simulate(input.settings);
    expect(agents).toHaveLength(input.settings.agentCount);
    for (const agent of agents) {
      expect(agent.persona).toContain('Fictional stakeholder proxy');
      expect(agent.memory.length).toBeLessThanOrEqual(4);
    }
    for (const snapshot of rounds) {
      expect(snapshot.actions).toHaveLength(agents.length);
      expect(
        snapshot.supportShare + snapshot.oppositionShare + snapshot.undecidedShare,
      ).toBeCloseTo(1, 12);
      expect(snapshot.interactions).toBe(
        snapshot.actions.reduce((sum, action) => sum + action.peerIds.length, 0),
      );
      for (const action of snapshot.actions) {
        expect(['update', 'observe']).toContain(action.type);
        expect(action.content).toContain('Rule-based state update');
        expect(action.opinion).toBeGreaterThanOrEqual(-1);
        expect(action.opinion).toBeLessThanOrEqual(1);
        expect(action.peerIds).not.toContain(action.agentId);
      }
    }
  });

  it('applies the intervention only on its scheduled round and changes computed outcomes measurably', () => {
    const baseline = simulate(input.settings);
    const intervened = simulate({
      ...input.settings,
      intervention: { round: 2, label: 'Assume full funding is confirmed', stance: 1, strength: 1 },
    });
    expect(intervened.rounds[0]).toEqual(baseline.rounds[0]);
    expect(intervened.rounds.map((round) => Boolean(round.intervention))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(
      intervened.rounds.at(-1)!.meanOpinion - baseline.rounds.at(-1)!.meanOpinion,
    ).toBeGreaterThan(0.2);
  });

  it('network selection affects actual exposure and trajectories', () => {
    const community = simulate(input.settings);
    const broadcast = simulate({ ...input.settings, network: 'broadcast' });
    expect(broadcast.rounds.at(-1)!.meanOpinion).not.toBe(community.rounds.at(-1)!.meanOpinion);
    expect(broadcast.rounds[0]!.interactions).toBe(input.settings.agentCount * 4);
  });
});
