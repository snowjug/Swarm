import type { z } from 'zod';
import { analysisSchema } from './analysis.js';
import {
  actualOutcomeSchema,
  backtestResultSchema,
  historicalCaseSchema,
  leakageReportSchema,
} from './backtest.js';
import { decisionBriefSchema } from './brief.js';
import { critiqueSetSchema } from './critique.js';
import { scenarioFrameSchema } from './scenario.js';
import { actorSetSchema, stakeholderSetSchema } from './stakeholders.js';

/**
 * What a project can carry beyond its own record. Each kind is one validated JSON document stored in
 * `project_artifacts`, keyed by project, kind and key, so a new kind needs a schema here and no new
 * table. Most kinds have one document, under the key `default`; `analysis` has one per run set.
 */
export const artifactSchemas = {
  scenario: scenarioFrameSchema,
  stakeholders: stakeholderSetSchema,
  actors: actorSetSchema,
  analysis: analysisSchema,
  critiques: critiqueSetSchema,
  brief: decisionBriefSchema,
  'backtest-case': historicalCaseSchema,
  'backtest-outcome': actualOutcomeSchema,
  'backtest-leakage': leakageReportSchema,
  'backtest-result': backtestResultSchema,
} as const;

export type ArtifactKind = keyof typeof artifactSchemas;
export const ARTIFACT_KINDS = Object.keys(artifactSchemas) as ArtifactKind[];
export type ArtifactData<K extends ArtifactKind> = z.output<(typeof artifactSchemas)[K]>;

export const DEFAULT_ARTIFACT_KEY = 'default';

/** A document larger than this is refused: the artifacts are results, not storage for source material. */
export const MAX_ARTIFACT_BYTES = 2_000_000;

export function isArtifactKind(value: string): value is ArtifactKind {
  return Object.hasOwn(artifactSchemas, value);
}
