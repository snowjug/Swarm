import { createHash } from 'node:crypto';
import type { Variant } from '../../../shared/analysis.js';
import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../../shared/example-scenarios.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import type { ActorSet, StakeholderSet } from '../../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { autoVariants } from '../../src/analysis/variants.js';
import { chunkDocuments } from '../../src/knowledge/retrieval.js';
import { parseScenario } from '../../src/scenario/parse.js';
import { generateActors } from '../../src/stakeholders/actors.js';
import { discoverStakeholders } from '../../src/stakeholders/discover.js';
import { approveSet } from '../../src/stakeholders/review.js';

const NOW = new Date('2026-03-01T09:00:00.000Z');

/** What the real rules path makes of one worked example: the frame, the passages, the cast and the scenarios. */
export interface ExampleWorld {
  pack: ExampleScenario;
  scenario: ScenarioFrame;
  passages: EvidenceChunk[];
  stakeholders: StakeholderSet;
  actors: ActorSet;
  variants: Variant[];
}

/**
 * The same chain a project follows with no model, run on a worked example: the question is read into a
 * frame, the stakeholders are found and approved, and the actors are made. Nothing is made up here, so
 * a test built on it is about the real pipeline.
 */
export async function exampleWorld(pack: ExampleScenario): Promise<ExampleWorld> {
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
  const discovered = await discoverStakeholders({
    project: { question: pack.question, graph: null },
    scenario: parsed.frame,
    passages,
    model: null,
    now: () => NOW,
  });
  const stakeholders = approveSet(discovered, NOW);
  const actors = await generateActors({
    stakeholders: stakeholders.stakeholders,
    relations: stakeholders.relations,
    scenario: parsed.frame,
    stakeholderRevision: 1,
    question: pack.question,
    passages,
    model: null,
    now: () => NOW,
  });
  return {
    pack,
    scenario: parsed.frame,
    passages,
    stakeholders,
    actors,
    variants: autoVariants(parsed.frame),
  };
}

export async function exampleWorlds(): Promise<ExampleWorld[]> {
  const worlds: ExampleWorld[] = [];
  for (const pack of EXAMPLE_SCENARIOS) worlds.push(await exampleWorld(pack));
  return worlds;
}

/** A fingerprint of any JSON-serialisable value: two outcomes with the same digest are the same, byte for byte. */
export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
