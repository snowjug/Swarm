import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProjectSchema,
  type EvidenceChunk,
  type SourceDocument,
} from '../../shared/types.js';
import { buildApp } from '../../backend/src/app.js';
import { loadConfig } from '../../backend/src/config.js';
import { chunkDocuments } from '../../backend/src/knowledge/retrieval.js';
import { projectMaterial } from '../../backend/src/orchestration/evidence-gate.js';
import {
  DATASET_DIRECTORY,
  DEMO_DIRECTORY,
  PINNED_SOURCES,
  REPOSITORY_ROOT,
  sha256,
} from './paths.js';

export { DATASET_DIRECTORY, DEMO_DIRECTORY, PINNED_SOURCES, REPOSITORY_ROOT, sha256 };

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
