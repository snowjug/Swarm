import type { ExampleScenario } from '../example-scenarios.js';

export type ExampleDocument = ExampleScenario['documents'][number];

/**
 * A bundled example document. Every one is synthetic and says so in its own text; the provenance
 * makes the same statement in a form that travels with the evidence through the whole analysis.
 */
export function sampleDocument(name: string, title: string, content: string): ExampleDocument {
  return { name, content, provenance: { kind: 'sample', title, license: 'Synthetic, CC0' } };
}
