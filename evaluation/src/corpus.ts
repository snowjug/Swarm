import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProjectSchema,
  type EvidenceChunk,
  type SourceDocument,
} from '../../shared/types.js';
import { buildApp } from '../../backend/src/app.js';
import { loadConfig } from '../../backend/src/config.js';
import { chunkDocuments } from '../../backend/src/knowledge/retrieval.js';
import { projectMaterial } from '../../backend/src/orchestration/evidence-gate.js';

const here = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = join(here, '..', '..');
export const DEMO_DIRECTORY = join(REPOSITORY_ROOT, 'docs', 'demo', 'larkholm-ferry');
export const DATASET_DIRECTORY = join(REPOSITORY_ROOT, 'evaluation', 'datasets');

/**
 * SHA-256 of each source with line endings normalised to LF. The labels in `datasets/` were read
 * from exactly this text, so a change to a source must be a deliberate decision to re-label.
 */
export const PINNED_SOURCES: Readonly<Record<string, string>> = {
  '01-council-briefing-note.md': 'dccf232dd17bbf7f6e689b151d44990e9d91870db1b453b6b82e1dace47abeb0',
  '02-ferry-operator-feasibility-memo.md':
    'cefbc6831b9033162641bb17f8a99b7c7625e893a7e112d4a0873fd456c95fb5',
  '03-residents-survey-summary.md':
    'e114ead10df002e731e205295110c07620a09843f8d25834a146e4bf4f1416bd',
  '04-stakeholder-statements.md':
    '9a5503e1c2c61b772ba25f428f9cdd98e7cc001bf3d2ea3f820bcfe469e8b6df',
  '05-scenario-assumptions.md': 'fc15fd2edc13a20a85adce07ecc5b07be79ad2bd9a003b8fca118155b5ec236b',
};

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface Corpus {
  documents: SourceDocument[];
  chunks: EvidenceChunk[];
  /** Names of sources whose text no longer matches the text the labels were written against. */
  drift: string[];
}

export function loadCorpus(): Corpus {
  const documents = Object.keys(PINNED_SOURCES).map((name, index) => ({
    id: `D${index + 1}`,
    name,
    content: readFileSync(join(DEMO_DIRECTORY, name), 'utf8').replaceAll('\r\n', '\n'),
  }));
  const drift = documents
    .filter((document) => sha256(document.content) !== PINNED_SOURCES[document.name])
    .map((document) => document.name);
  return { documents, chunks: chunkDocuments(documents), drift };
}

/**
 * Everything the product's analyst can be asked about besides the sources: the report, personas,
 * graph and recorded activity of a real local run over the same documents. A question is judged
 * against this as well as the passages, exactly as in the product, because report text carries
 * words (such as "forecast" in its disclaimers) that a question may share by accident.
 */
export async function projectMaterialFor(corpus: Corpus): Promise<string[]> {
  const instance = await buildApp({
    config: { ...loadConfig({ LOG_LEVEL: 'silent' }), databasePath: ':memory:' },
  });
  try {
    const project = instance.repository.create(
      createProjectSchema.parse({
        name: 'Larkholm electric ferry (evaluation)',
        question:
          'How might fictional stakeholders on Larkholm respond to replacing the island ferry with a battery-electric vessel?',
        documents: corpus.documents.map(({ name, content }) => ({ name, content })),
        settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
      }),
    );
    instance.jobs.enqueue(project.id);
    await instance.jobs.idle();
    return projectMaterial(instance.repository.get(project.id));
  } finally {
    await instance.app.close();
  }
}
