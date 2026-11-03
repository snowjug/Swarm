import { chunkDocuments } from '../../backend/src/knowledge/retrieval.js';
import type { DiscoveryContext } from '../../backend/src/constraints/types.js';
import { readByRules } from '../../backend/src/scenario/rules.js';
import {
  buildContext,
  type ProposalContext,
} from '../../backend/src/stakeholders/participants/context.js';
import { SCENARIO_EXCERPT_MAX, type ScenarioFrame } from '../../shared/scenario.js';
import type { EvidenceChunk } from '../../shared/types.js';
import { documentsOf, documentsWithGap, type DocumentText, type Scenario } from './ai-datasets.js';
import { indexPassages, type PassageIndex } from './measure-grounding.js';

/**
 * `full`: the documents as written. `gap`: the sentence of the seeded gap taken out. `no-sources`: the
 * question alone, as a project with no documents.
 */
export type Variant = 'full' | 'gap' | 'no-sources';

export interface Prepared {
  question: string;
  variant: Variant;
  documents: { id: string; name: string; content: string }[];
  passages: EvidenceChunk[];
  records: PassageIndex;
  frame: ScenarioFrame;
  context: ProposalContext;
  discovery: DiscoveryContext;
}

/** What the product makes of a question and some documents before any proposal: passages, a frame, contexts. */
export function prepareFrom(
  question: string,
  texts: readonly DocumentText[],
  variant: Variant,
): Prepared {
  const documents = texts.map((text, index) => ({
    id: `D${index + 1}`,
    name: text.name,
    content: text.content,
  }));
  const passages = chunkDocuments(documents);
  const { frame } = readByRules({
    question,
    documents: documents.map((document) => ({
      name: document.name,
      characters: document.content.length,
      excerpt: document.content.slice(0, SCENARIO_EXCERPT_MAX),
    })),
  });
  return {
    question,
    variant,
    documents,
    passages,
    records: indexPassages(
      passages.map((passage) => ({
        id: passage.id,
        documentId: passage.documentId,
        documentName: passage.documentName,
        start: passage.start,
        end: passage.end,
        text: passage.text,
      })),
    ),
    frame,
    context: buildContext({ question, scenario: frame, graph: null, passages }),
    discovery: {
      question,
      scenario: frame,
      actors: [],
      actorRelations: [],
      alternatives: frame.alternatives.map((alternative) => ({
        id: alternative.id,
        label: alternative.label,
      })),
      passages,
    },
  };
}

export function prepare(scenario: Scenario, variant: Variant = 'full'): Prepared {
  const texts =
    variant === 'no-sources'
      ? []
      : variant === 'gap'
        ? documentsWithGap(scenario)
        : documentsOf(scenario);
  return prepareFrom(scenario.question, texts, variant);
}
