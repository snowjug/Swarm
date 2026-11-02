import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../../../shared/example-scenarios';
import type { CreateProjectInput } from '../../../../shared/types';

type DocumentInput = CreateProjectInput['documents'][number];

/** A made-up question and notes, for learning the workflow. It is not a case and carries no result. */
export const STARTER = {
  id: 'starter',
  title: 'Fictional library hours',
  label: 'Library hours',
  blurb: 'A made-up question and notes, for learning the workflow.',
  name: 'Fictional library-hours scenario',
  question:
    'How might fictional community groups respond to a proposed change in library opening hours?',
  documents: [
    {
      name: 'fictional-library-input.md',
      content:
        '# Fictional starter input — not a real case\n\nA fictional town library is considering a pilot that extends evening opening hours on two weekdays while reducing Sunday hours. The draft proposal keeps the total weekly staffing budget unchanged. Students have asked for quiet evening study space. A fictional parent group values weekend access, while staff representatives have requested predictable shifts and a review of transport safety after closing. No survey has been conducted, no vote has occurred, and no outcome is known. The library proposes a six-week trial followed by an open feedback meeting. These statements are scenario assumptions supplied as input, not measured public opinion.',
      provenance: { kind: 'sample' as const },
    },
  ] satisfies DocumentInput[],
} as const;

/** The short name of each example, for a chip. Anything the list gains later falls back to its title. */
const LABELS: Record<string, string> = {
  'copilot-in-teams': 'Copilot in Teams',
  'regional-price-change': 'Cloud price change',
  'ecommerce-experience': 'Online store checkout',
  'ai-first-support': 'AI-first support',
  'launch-pricing': 'Launch pricing',
};

export const exampleLabel = (example: ExampleScenario): string =>
  LABELS[example.id] ?? example.title;

/** What an example puts into the composer. It is a question and its evidence, nothing else. */
export interface Starting {
  id: string;
  title: string;
  name: string;
  question: string;
  documents: DocumentInput[];
  /** "5 documents · sample evidence". */
  summary: string;
}

export function startingFromExample(example: ExampleScenario): Starting {
  const documents = example.documents.map(({ name, content, provenance }) => ({
    name,
    content,
    provenance,
  }));
  const count = documents.length;
  return {
    id: example.id,
    title: example.title,
    name: example.title.slice(0, 100),
    question: example.question,
    documents,
    summary: `${count} ${count === 1 ? 'document' : 'documents'} · sample evidence`,
  };
}

export function startingFromStarter(): Starting {
  return {
    id: STARTER.id,
    title: STARTER.title,
    name: STARTER.name,
    question: STARTER.question,
    documents: STARTER.documents.map((document) => ({ ...document })),
    summary: '1 document · invented for learning',
  };
}

export { EXAMPLE_SCENARIOS };
