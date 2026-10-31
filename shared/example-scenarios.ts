import type { SourceProvenance } from './scenario.js';

/**
 * A worked example a person can start from. It is only a question and some evidence: everything else,
 * the scenario, the stakeholders, the actors and the results, is made by the same code that handles
 * any other question, so an example never carries an answer. The evidence is synthetic or public, and
 * says so in its provenance.
 */
export interface ExampleScenario {
  id: string;
  title: string;
  /** One line on what the example shows, for the picker. */
  blurb: string;
  question: string;
  documents: { name: string; content: string; provenance: SourceProvenance }[];
  /** A public page that suits this example, for the person to fetch themselves. */
  urlSuggestion?: { url: string; why: string };
}

/** Filled by `shared/examples/*`. The order is the order the picker shows. */
export const EXAMPLE_SCENARIOS: readonly ExampleScenario[] = [];
