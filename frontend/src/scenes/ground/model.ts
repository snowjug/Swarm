import type { OperationTrace } from '../../../../shared/guided';
import type { SourceKind } from '../../../../shared/scenario';
import type { KnowledgeGraph, ProjectDetail, SourceDocument } from '../../../../shared/types';
import type { SceneId, SceneInfo } from '../../app/scenes';
import { canExecute, isGuided } from '../../lib/console';
import { SOURCE_KIND_LABELS } from '../../lib/product';

/**
 * Where the evidence step is, from the project's own record. `record` is a project the guided flow did
 * not make: it has whatever documents and graph it holds, and nothing to run.
 */
export type GroundStage = 'idle' | 'queued' | 'running' | 'ready' | 'failed' | 'stopped' | 'record';

export function groundStage(project: ProjectDetail): GroundStage {
  if (!isGuided(project)) return 'record';
  switch (project.console?.steps.knowledge) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'ready':
      return 'ready';
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'paused':
      return 'stopped';
    default:
      return 'idle';
  }
}

/** Work is under way: the engine has the step and will say when it is done. */
export const isWorking = (stage: GroundStage): boolean => stage === 'queued' || stage === 'running';

export function graphOf(project: ProjectDetail): KnowledgeGraph | null {
  return project.graph && project.graph.nodes.length > 0 ? project.graph : null;
}

/** What the third figure counts: a lexical graph holds topics, a model graph holds entities. */
export function entityNoun(graph: KnowledgeGraph | null): { one: string; many: string } {
  return graph?.method === 'llm'
    ? { one: 'Entity', many: 'Entities' }
    : { one: 'Topic', many: 'Topics' };
}

// ---- Views ---------------------------------------------------------------------------------------

/** The parts of the page a link can open: `?view=` holds one of these. */
export const GROUND_VIEWS = ['graph', 'sources', 'conflicts', 'statements', 'trace'] as const;
export type GroundView = (typeof GROUND_VIEWS)[number];

const VIEW_ALIASES: Record<string, GroundView> = {
  evidence: 'sources',
  documents: 'sources',
  ledger: 'statements',
  claims: 'statements',
  log: 'trace',
  topics: 'graph',
};

export function parseView(value: string | null | undefined): GroundView | null {
  if (!value) return null;
  if ((GROUND_VIEWS as readonly string[]).includes(value)) return value as GroundView;
  return VIEW_ALIASES[value] ?? null;
}

// ---- Documents -----------------------------------------------------------------------------------

const SHORT_KIND: Record<SourceKind, string> = {
  upload: 'Upload',
  paste: 'Pasted',
  url: 'Web page',
  sample: 'Sample',
  historical: 'Historical',
};

export interface DocumentFacts {
  id: string;
  index: number;
  name: string;
  characters: number;
  pages: number | null;
  /** `null` where the record says nothing of where the text came from. */
  kind: SourceKind | null;
  shortKind: string;
  longKind: string;
  /** Illustrative text, not real information: always labelled as such. */
  synthetic: boolean;
  address: string | null;
  host: string | null;
  retrievedAt: string | null;
  fetchedByServer: boolean;
  title: string | null;
  license: string | null;
  asOf: string | null;
  sha256: string | null;
  contentType: string | null;
}

/** The host of an address, or null when it is not one a person could be sent to. */
export function hostOf(address: string | null | undefined): string | null {
  if (!address) return null;
  try {
    const url = new URL(address);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.host : null;
  } catch {
    return null;
  }
}

export function documentFacts(document: SourceDocument, index: number): DocumentFacts {
  const provenance = document.provenance;
  const kind = provenance?.kind ?? null;
  const address = provenance?.finalUrl ?? provenance?.url ?? null;
  return {
    id: document.id,
    index,
    name: document.name,
    characters: document.content.length,
    pages: document.pageCount ?? null,
    kind,
    shortKind: kind ? SHORT_KIND[kind] : 'Supplied',
    longKind: kind ? SOURCE_KIND_LABELS[kind] : 'supplied text',
    synthetic: kind === 'sample',
    address,
    host: hostOf(address),
    retrievedAt: provenance?.retrievedAt ?? null,
    fetchedByServer: provenance?.fetchedByServer === true,
    title: provenance?.title ?? null,
    license: provenance?.license ?? null,
    asOf: provenance?.asOf ?? null,
    sha256: provenance?.sha256 ?? null,
    contentType: provenance?.contentType ?? null,
  };
}

export function documentList(project: ProjectDetail): DocumentFacts[] {
  return project.documents.map(documentFacts);
}

/** The colour of a document wherever it appears: a ring on a topic, a thread, a chip. Never the only cue. */
export function documentColour(index: number): string {
  return `var(--cat-${(((index % 8) + 8) % 8) + 1})`;
}

// ---- The step's own progress -------------------------------------------------------------------

export type PhaseState = 'waiting' | 'active' | 'done' | 'failed';

export interface Phase {
  id: 'types' | 'graph';
  /** Plain words for the person; the engine's own name is `engineName`. */
  label: string;
  engineName: string;
  state: PhaseState;
  trace: OperationTrace | null;
}

const PHASES = [
  { id: 'types', label: 'Reading', engineName: 'Ontology definition' },
  { id: 'graph', label: 'Extracting', engineName: 'Source graph construction' },
] as const;

/** The time the step last started or was last queued: what an earlier attempt's traces must not count past. */
function attemptStart(project: ProjectDetail): string | null {
  let latest: string | null = null;
  for (const event of project.events) {
    if (event.stage !== 'knowledge' || !/^knowledge (queued|started)/u.test(event.message))
      continue;
    if (!latest || event.createdAt > latest) latest = event.createdAt;
  }
  return latest;
}

/**
 * The two things the engine does in this step, in order, and which of them it is doing. It is read from
 * the operation traces the engine records as it goes, so a phase is `active` only while the engine says
 * it is running, and `done` only when it says it completed. Nothing is estimated.
 */
export function knowledgePhases(project: ProjectDetail): Phase[] {
  const stage = groundStage(project);
  const since = attemptStart(project);
  const traces = (project.console?.traces ?? []).filter(
    (trace) => trace.step === 'knowledge' && (since === null || trace.startedAt >= since),
  );
  const latest = (name: string): OperationTrace | null =>
    traces
      .filter((trace) => trace.name === name)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

  let previousDone = true;
  return PHASES.map((phase) => {
    const trace = latest(phase.engineName);
    let state: PhaseState = 'waiting';
    if (stage === 'ready' || trace?.status === 'completed') state = 'done';
    else if (trace?.status === 'failed') state = 'failed';
    else if (trace?.status === 'running') state = 'active';
    else if (stage === 'running' && previousDone) state = 'active';
    previousDone = state === 'done';
    return { id: phase.id, label: phase.label, engineName: phase.engineName, state, trace };
  });
}

/**
 * Where the evidence is, in the five words a person reads it by. `reading` and `extracting` are the two things the
 * engine does, as its own traces say; `checking` is the time the conflicts are being looked for once it has finished.
 */
export type Moment =
  | 'idle'
  | 'queued'
  | 'reading'
  | 'extracting'
  | 'checking'
  | 'ready'
  | 'failed'
  | 'stopped'
  | 'record';

export const MOMENT_LABEL: Record<Moment, string> = {
  idle: 'Not started',
  queued: 'Queued',
  reading: 'Reading',
  extracting: 'Extracting',
  checking: 'Checking',
  ready: 'Ready',
  failed: 'Failed',
  stopped: 'Stopped',
  record: 'Saved record',
};

/** What the evidence is doing now: the step's stage, the phase the engine is in, and whether conflicts are still being looked for. */
export function momentOf(stage: GroundStage, phases: readonly Phase[], checking: boolean): Moment {
  switch (stage) {
    case 'running':
      return phases.some((phase) => phase.id === 'graph' && phase.state === 'active')
        ? 'extracting'
        : 'reading';
    case 'ready':
      return checking ? 'checking' : 'ready';
    case 'record':
      return checking ? 'checking' : 'record';
    default:
      return stage;
  }
}

/** Why the step stopped, in the engine's own words, or null when it did not fail. */
export function failureReason(project: ProjectDetail): string | null {
  if (groundStage(project) !== 'failed') return null;
  const failed = (project.console?.traces ?? [])
    .filter((trace) => trace.step === 'knowledge' && trace.status === 'failed' && trace.error)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return project.error?.trim() || failed?.error?.trim() || null;
}

/** The newest thing the engine said about this step, for the one quiet line under the progress. */
export function latestEvent(project: ProjectDetail): { message: string; at: string } | null {
  const last = [...project.events]
    .filter((event) => event.stage === 'knowledge')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  return last ? { message: last.message, at: last.createdAt } : null;
}

/** Seconds since an ISO time, never negative and never absurd (a clock that disagrees says nothing). */
export function elapsedSeconds(since: string | null | undefined, now: number): number | null {
  if (!since) return null;
  const started = Date.parse(since);
  if (Number.isNaN(started)) return null;
  const seconds = Math.floor((now - started) / 1000);
  return seconds >= 0 && seconds < 3600 * 6 ? seconds : null;
}

export function elapsedText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** How long a finished operation took, as the engine recorded it. */
export function traceDuration(
  trace: Pick<OperationTrace, 'startedAt' | 'completedAt'> | null,
): string | null {
  if (!trace?.completedAt) return null;
  const ms = Date.parse(trace.completedAt) - Date.parse(trace.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return 'under 1 s';
  return elapsedText(Math.round(ms / 1000));
}

// ---- What to do next -----------------------------------------------------------------------------

export interface NextStep {
  scene: SceneId;
  label: string;
}

const NEXT: { scene: SceneId; label: string }[] = [
  { scene: 'map', label: 'Map the stakeholders' },
  { scene: 'simulate', label: 'Open the simulation' },
  { scene: 'decide', label: 'Open the decision' },
];

/** The scene to offer after this one: the first that the journey has open, Map by preference. */
export function nextStep(journey: readonly SceneInfo[]): NextStep | null {
  for (const candidate of NEXT) {
    const info = journey.find((step) => step.id === candidate.scene);
    if (info && info.state !== 'locked') return candidate;
  }
  return null;
}

/** Whether the person may start the evidence step now. */
export function mayRun(project: ProjectDetail): boolean {
  return canExecute(project, 'knowledge');
}

// ---- Words -----------------------------------------------------------------------------------------

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

/** A number as people read it. */
export const figure = (value: number): string => value.toLocaleString('en-GB');

/**
 * The most passages a word search answers with. The server returns its best few and does not say how many
 * more hold the words (`retrieve(chunks, query, 5)` in the evidence route), so an answer that is this long
 * may be only the start of the matches.
 */
export const SEARCH_LIMIT = 5;

/**
 * What to say of a search's answer. A short answer is every passage that matches; one as long as the server
 * gives is only the best of them, and the page says so instead of reading it as a count of what matches.
 */
export function describeSearch(count: number, query: string): string {
  if (count === 0) return `No match for “${query}”`;
  if (count >= SEARCH_LIMIT)
    return `The best ${figure(count)} matches for “${query}”. There may be more.`;
  return `${plural(count, 'match', 'matches')} for “${query}”`;
}
