import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  runOutcomeSchema,
  simulationSpecSchema,
  type RunOutcome,
  type SimEvent,
  type SimulationSpec,
} from '../../shared/analysis.js';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { autoVariants } from '../src/analysis/variants.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { parseScenario } from '../src/scenario/parse.js';
import { MAX_REPLAYS, explainEvents } from '../src/simulation/explain.js';
import { simulate, simulateValidated } from '../src/simulation/simulate.js';
import { generateActors } from '../src/stakeholders/actors.js';
import { discoverStakeholders } from '../src/stakeholders/discover.js';
import { approveSet } from '../src/stakeholders/review.js';
import { CHAIN_RELATIONS, chainCast, spec } from './support/simulation-cast.js';

// A responder's trigger reads a signal, never an event. Which earlier events an event could not have
// done without is therefore found by asking the run that did not happen: the same seed with the earlier
// responder switched off. What is recorded has to agree with that run, event by event.

const NOW = new Date('2026-03-01T09:00:00.000Z');

/** The proposed change on an example's actors, made the way a project makes them: no model, the real pipeline. */
async function packSpec(id: string): Promise<SimulationSpec> {
  const pack = EXAMPLE_SCENARIOS.find((candidate) => candidate.id === id)!;
  const parsed = await parseScenario({
    question: pack.question,
    documents: pack.documents.map((document) => ({
      name: document.name,
      characters: document.content.length,
    })),
  });
  const passages = chunkDocuments(
    pack.documents.map((document, index) => ({
      id: `D${index + 1}`,
      name: document.name,
      content: document.content,
    })),
  ).map((chunk) => ({
    ...chunk,
    contentHash: createHash('sha256').update(chunk.text).digest('hex'),
  }));
  const found = await discoverStakeholders({
    project: { question: pack.question, graph: null },
    scenario: parsed.frame,
    passages,
    model: null,
    now: () => NOW,
  });
  const approved = approveSet(found, NOW);
  const cast = await generateActors({
    stakeholders: approved.stakeholders,
    relations: approved.relations,
    scenario: parsed.frame,
    stakeholderRevision: 1,
    question: pack.question,
    passages,
    model: null,
    now: () => NOW,
  });
  const proposed = autoVariants(parsed.frame).find((variant) => variant.kind === 'alternative')!;
  return simulationSpecSchema.parse({
    actors: cast.actors,
    relations: cast.relations,
    rounds: 12,
    variant: proposed,
  });
}

/** The same run with one external responder no longer responding, as the review ran it. */
const without = (input: SimulationSpec, actorId: string): SimulationSpec => ({
  ...input,
  actors: input.actors.map((actor) =>
    actor.id === actorId ? { ...actor, category: 'other' as const } : actor,
  ),
});

describe('which earlier events an event could not do without', () => {
  it('lists an earlier event as a cause only when the event does not happen without it, on seeds of AI-first support', async () => {
    const input = await packSpec('ai-first-support');
    const seen = { needed: 0, only: 0 };
    for (let seed = 449; seed < 479; seed += 1) {
      const plain = simulateValidated(input, seed);
      const explained = simulateValidated(input, seed, { explain: true });
      expect(explained.explained, `seed ${seed}`).toBe(true);
      expect(plain.explained).toBeUndefined();
      expect(explained.events.map(({ id, round, kind }) => [id, round, kind])).toEqual(
        plain.events.map(({ id, round, kind }) => [id, round, kind]),
      );
      for (const [at, event] of explained.events.entries()) {
        const before = plain.events[at]!;
        // Before the replays, the only cause an event has is the signal its responder read.
        expect(before.causedBy).toHaveLength(1);
        const earlier = before.followed ?? [];
        expect([...event.causedBy.slice(1), ...(event.followed ?? [])].sort()).toEqual(
          [...earlier].sort(),
        );
        for (const id of earlier) {
          const parent = plain.events.find((candidate) => candidate.id === id)!;
          const rerun = simulateValidated(without(input, parent.actorId!), seed);
          const again = rerun.events.find((candidate) => candidate.actorId === event.actorId);
          const stillActs = again !== undefined && again.round <= event.round;
          expect(
            event.causedBy.includes(id),
            `seed ${seed}: ${parent.kind} in round ${parent.round}, then ${event.kind} in round ${event.round}`,
          ).toBe(!stillActs);
          seen[stillActs ? 'only' : 'needed'] += 1;
        }
      }
    }
    expect(seen.needed, 'a link that was needed').toBeGreaterThan(0);
    expect(seen.only, 'a link that only came first').toBeGreaterThan(0);
  });

  it('keeps the review’s two cases apart: the competitor needed the first scrutiny in one run and not in the other', async () => {
    const input = await packSpec('ai-first-support');
    const link = (seed: number) => {
      const run = simulateValidated(input, seed, { explain: true });
      const scrutiny = run.events.find((event) => event.kind === 'scrutiny')!;
      const counter = run.events.find((event) => event.kind === 'counter-move')!;
      return { scrutiny, counter };
    };
    const needed = link(449);
    expect(needed.counter.causedBy).toEqual(['adverse-share', needed.scrutiny.id]);
    expect(needed.counter.followed).toEqual([]);
    const only = link(451);
    expect(only.counter.causedBy).toEqual(['adverse-share']);
    expect(only.counter.followed).toEqual([only.scrutiny.id]);
  });

  it('keeps the earlier event as a cause where the later one cannot happen without it, and changes nothing else about the run', () => {
    const input = spec(chainCast(), { relations: CHAIN_RELATIONS, rounds: 12 });
    for (let seed = 1; seed <= 20; seed += 1) {
      const plain = simulate(input, seed);
      const explained = simulate(input, seed, { explain: true });
      expect(explained.events[1], `seed ${seed}`).toMatchObject({
        causedBy: ['switching-pressure', 'e1'],
        followed: [],
      });
      expect(explained.events[0]).toMatchObject({ causedBy: ['adverse-share'], followed: [] });
      expect(() => runOutcomeSchema.parse(explained)).not.toThrow();
      const bare = (run: RunOutcome) => ({ ...run, events: [], explained: undefined, work: null });
      expect(bare(explained)).toEqual(bare(plain));
      expect(simulate(input, seed, { explain: true })).toEqual(explained);
    }
  });

  it('counts the replays in the work of the run, and costs nothing when no event followed another', () => {
    const lone = spec([chainCast()[0]!, chainCast()[1]!], { relations: [], rounds: 12 });
    const plain = simulate(lone, 3);
    expect(plain.events).toHaveLength(1);
    expect(simulate(lone, 3, { explain: true }).work).toEqual(plain.work);
    const chain = spec(chainCast(), { relations: CHAIN_RELATIONS, rounds: 12 });
    const first = simulate(chain, 3);
    const explained = simulate(chain, 3, { explain: true });
    expect(explained.work.members).toBe(2 * first.work.members);
  });

  it('leaves a run with more links than MAX_REPLAYS as it came, and says nothing was tested', () => {
    const base = simulate(spec(chainCast(), { relations: CHAIN_RELATIONS, rounds: 12 }), 1);
    const crowd = (length: number): RunOutcome => {
      const events: SimEvent[] = Array.from({ length }, (_, at) => ({
        id: `e${at + 1}`,
        round: at + 2,
        kind: 'counter-move',
        actorId: `responder-${at + 1}`,
        description: `Responder ${at + 1} acted in round ${at + 2}.`,
        causedBy: ['adverse-share'],
        followed: Array.from({ length: Math.min(at, 3) }, (_, back) => `e${at - back}`).reverse(),
      }));
      return runOutcomeSchema.parse({ ...base, events });
    };
    const links = (run: RunOutcome) =>
      run.events.reduce((sum, event) => sum + (event.followed ?? []).length, 0);
    // A replay in which nothing acts: every earlier event it is asked about is needed.
    const replay = vi.fn((): RunOutcome => ({ ...base, events: [] }));
    const input = spec(chainCast(), { rounds: 12 });

    const many = crowd(12);
    expect(links(many)).toBeGreaterThan(MAX_REPLAYS);
    expect(explainEvents(many, input, replay)).toBe(many);
    expect(replay).not.toHaveBeenCalled();

    // Where every link can be tried, every one is, once, and what the replays showed is what is listed.
    const few = crowd(7);
    expect(links(few)).toBeLessThanOrEqual(MAX_REPLAYS);
    const explained = explainEvents(few, input, replay);
    expect(replay).toHaveBeenCalledTimes(links(few));
    expect(explained.explained).toBe(true);
    expect(explained.events.map((event) => event.causedBy.length - 1)).toEqual(
      few.events.map((event) => (event.followed ?? []).length),
    );
    expect(links(explained)).toBe(0);
  });
});
