import type { ScenarioFrame } from '../../../../shared/scenario.js';
import {
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLE_MEANINGS,
  RELATION_TYPES,
  STAKEHOLDER_CATEGORIES,
  MAX_PROPOSED_KEY,
  MAX_PROPOSED_LIVE,
} from '../../../../shared/stakeholders.js';
import type { EvidenceChunk, KnowledgeGraph } from '../../../../shared/types.js';
import { selectContext } from '../../knowledge/retrieval.js';
import { suspiciousPassageIds } from '../../models/injection.js';
import { normaliseLine, redactSecrets } from './language.js';

/** The characters of passages sent to a model. The client refuses a request over 48,000 characters in all. */
export const EVIDENCE_BUDGET = 12_000;
const MAX_CONSTRAINTS = 12;
const MAX_ENTITIES = 12;

export interface ResearchSummary {
  /** How many of the pages a research run read, by the kind of source each was. */
  sourceCategories: { category: string; count: number }[];
  entities: { name: string; kind: string }[];
  topics: string[];
  missingEvidence: string[];
}

/** What a proposal is made from. Everything in it is data: none of it is an instruction. */
export interface ProposalContext {
  question: string;
  scenario: ScenarioFrame | null;
  graph: KnowledgeGraph | null;
  /** Every passage of the project: what quotes are checked against. */
  passages: readonly EvidenceChunk[];
  /** The few most relevant passages, which are what a model is shown. */
  shown: readonly EvidenceChunk[];
  research: ResearchSummary | null;
  constraints: string[];
  /** Names the sources hold as persons: no participant may be one. */
  personLabels: string[];
  /** Passages that carry text addressed to an AI system. They are flagged, and ignored as instruction. */
  flagged: string[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? normaliseLine(redactSecrets(value), max) : '';

/**
 * Reads the newest research run among the artifacts of kind `research`, defensively: whatever is
 * stored may be from a newer or an older shape, so only the few fields used are read and each is
 * bounded. Null when there is nothing usable.
 */
export function summariseResearch(runs: readonly unknown[]): ResearchSummary | null {
  const run = [...runs]
    .reverse()
    .map(record)
    .find((item) => item !== null && Array.isArray(item.sources));
  if (!run) return null;
  const counts = new Map<string, number>();
  for (const source of (run.sources as unknown[]).map(record)) {
    if (!source || source.outcome !== 'used') continue;
    const category = text(source.category, 40);
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const plan = record(run.plan);
  const entities = (Array.isArray(plan?.entities) ? (plan.entities as unknown[]) : [])
    .map(record)
    .flatMap((entity) => {
      const name = text(entity?.name, 120);
      return name ? [{ name, kind: text(entity?.kind, 30) || 'other' }] : [];
    })
    .slice(0, MAX_ENTITIES);
  const strings = (value: unknown, max: number, each: number): string[] =>
    (Array.isArray(value) ? (value as unknown[]) : [])
      .map((item) => text(item, each))
      .filter(Boolean)
      .slice(0, max);
  const summary: ResearchSummary = {
    sourceCategories: [...counts].map(([category, count]) => ({ category, count })),
    entities,
    topics: strings(plan?.topics, 10, 160),
    missingEvidence: strings(plan?.missingEvidence, 8, 240),
  };
  const empty =
    summary.sourceCategories.length === 0 &&
    summary.entities.length === 0 &&
    summary.topics.length === 0;
  return empty ? null : summary;
}

/**
 * Reads the known constraints of a decision from an artifact of kind `constraints`, if one exists. Its
 * shape belongs to another feature, so this takes what looks like a list of statements: strings, or
 * objects with a `statement`, `text`, `label`, `description`, `name` or `title`.
 */
export function constraintsOf(data: unknown): string[] {
  const root = record(data);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(root?.constraints)
      ? root.constraints
      : Array.isArray(root?.items)
        ? root.items
        : [];
  const found: string[] = [];
  for (const item of list as unknown[]) {
    const entry = record(item);
    const line =
      typeof item === 'string'
        ? text(item, 200)
        : text(
            entry?.statement ??
              entry?.text ??
              entry?.label ??
              entry?.description ??
              entry?.name ??
              entry?.title,
            200,
          );
    if (line && !found.includes(line)) found.push(line);
    if (found.length === MAX_CONSTRAINTS) break;
  }
  return found;
}

export function buildContext(input: {
  question: string;
  scenario: ScenarioFrame | null;
  graph: KnowledgeGraph | null;
  passages: readonly EvidenceChunk[];
  research?: ResearchSummary | null;
  constraints?: readonly string[];
}): ProposalContext {
  const query = [input.question, input.scenario?.decision, input.scenario?.system]
    .filter(Boolean)
    .join(' ');
  return {
    question: input.question,
    scenario: input.scenario,
    graph: input.graph,
    passages: input.passages,
    shown: selectContext([...input.passages], query, EVIDENCE_BUDGET),
    research: input.research ?? null,
    constraints: [...(input.constraints ?? [])],
    personLabels: (input.graph?.nodes ?? [])
      .filter((node) => node.kind === 'person')
      .map((node) => node.label),
    flagged: suspiciousPassageIds(input.passages),
  };
}

const scenarioData = (scenario: ScenarioFrame | null): unknown =>
  scenario && {
    decision: text(scenario.decision, 400),
    system: text(scenario.system, 300),
    geography: scenario.geography ? text(scenario.geography, 200) : null,
    horizon: scenario.horizon ? text(scenario.horizon, 200) : null,
    changes: scenario.changes.map((change) => ({
      name: text(change.name, 120),
      from: change.from ? text(change.from, 200) : null,
      to: change.to ? text(change.to, 200) : null,
    })),
    baseline: text(scenario.baseline, 600),
    alternatives: scenario.alternatives.map(({ label, description }) => ({
      label: text(label, 120),
      description: text(description, 300),
    })),
    likelyStakeholders: scenario.likelyStakeholders.map((name) => text(name, 120)),
    assumptions: scenario.assumptions.map((assumption) => text(assumption.text, 300)),
    knownEvidenceGaps: scenario.evidenceMissing.map((gap) => text(gap, 200)),
  };

/**
 * The data a model is asked about: the question, the scenario, the most relevant passages with their
 * ids, what research and the known constraints add when there are any, and the fixed vocabulary it may
 * use. It is bounded, and a credential a source held is replaced before anything leaves the server.
 */
export function modelData(context: ProposalContext, extra: Record<string, unknown> = {}): unknown {
  return {
    question: text(context.question, 2_000),
    scenario: scenarioData(context.scenario),
    roles: PARTICIPANT_ROLES.map((id) => ({
      id,
      label: PARTICIPANT_ROLE_LABELS[id],
      meaning: PARTICIPANT_ROLE_MEANINGS[id],
    })),
    categories: STAKEHOLDER_CATEGORIES,
    relationTypes: RELATION_TYPES,
    limits: { participants: MAX_PROPOSED_LIVE, keyActors: MAX_PROPOSED_KEY },
    research: context.research,
    knownConstraints: context.constraints,
    evidence: context.shown.map(({ id, documentName, text: passage }) => ({
      id,
      documentName: text(documentName, 120),
      text: redactSecrets(passage),
    })),
    ...extra,
  };
}
