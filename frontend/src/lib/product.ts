import type { ExampleScenario } from '../../../shared/example-scenarios';
import type { SourceKind } from '../../../shared/scenario';
import type { AppConfig } from '../../../shared/types';

/** The sentence the product is never to be read without. */
export const POSITIONING_STATEMENT =
  'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.';

/** The question the entry screen leads with. */
export const WHAT_IF_LINE = 'What could happen if…?';

export interface PipelineStep {
  label: string;
  /** What the step gives the person, in a few words. Never a claim about the real world. */
  caption: string;
}

/** The path from a question to a decision, in the order Swarm takes it. */
export const PIPELINE: readonly PipelineStep[] = [
  { label: 'Evidence', caption: 'Your documents or a public page' },
  { label: 'Scenario', caption: 'Your question, made explicit' },
  { label: 'Stakeholders', caption: 'Who is affected, with sources' },
  { label: 'Actors', caption: 'Synthetic, never real people' },
  { label: 'Interactions', caption: 'They respond, round by round' },
  { label: 'Alternative outcomes', caption: 'Baseline against alternatives' },
  { label: 'Analysis', caption: 'Repeated runs and uncertainty' },
  { label: 'Decision', caption: 'A brief you can challenge' },
];

/** Where a piece of evidence came from, for a person reading a list of documents. */
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  upload: 'uploaded file',
  paste: 'pasted text',
  url: 'public web page',
  sample: 'sample evidence',
  historical: 'historical record',
};

/** "2 documents · sample evidence": what an example brings, without opening it. */
export function exampleEvidence(example: ExampleScenario): string {
  const kinds = [
    ...new Set(example.documents.map((document) => SOURCE_KIND_LABELS[document.provenance.kind])),
  ];
  const count = example.documents.length;
  return `${count} ${count === 1 ? 'document' : 'documents'} · ${kinds.join(', ')}`;
}

/** Whether the server may fetch a public web page for the person. An older server says nothing, and means no. */
export function urlIngestionEnabled(config: AppConfig | null): boolean {
  return Boolean(config && 'urlIngestion' in config && config.urlIngestion === true);
}
