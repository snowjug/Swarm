import { ANALYSIS_INPUTS, type AnalysisInput } from '../../../shared/analysis.js';
import type { ArtifactStore } from '../storage/artifacts.js';

/** The revision of documents by kind, as an artifact records the ones it was made from. */
export type Revisions = Record<string, number>;

/**
 * The revision of each document a comparison is made from, as the project holds it now (0 when there
 * is none). A comparison records these when it starts; a review and a brief are told from what they
 * rest on by comparing what that recorded with these.
 */
export function inputRevisionsNow(artifacts: ArtifactStore, projectId: string): Revisions {
  return Object.fromEntries(
    ANALYSIS_INPUTS.map((kind) => [kind, artifacts.get(projectId, kind)?.revision ?? 0]),
  );
}

/**
 * Which of the documents a comparison is made from have changed since. What the comparison recorded
 * decides, so that making a brief or a review again from it does not make it look current; where it
 * recorded nothing (it was saved before that was kept), `fallback`, what the brief or the review
 * itself recorded, stands in, and a document that neither recorded is not reported.
 */
export function changedInputs(
  recorded: Revisions | undefined,
  fallback: Revisions | undefined,
  now: Revisions,
): AnalysisInput[] {
  return ANALYSIS_INPUTS.filter((kind) => {
    const was = recorded?.[kind] ?? fallback?.[kind];
    return was !== undefined && was !== now[kind];
  });
}
