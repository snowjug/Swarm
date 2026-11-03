import { randomUUID } from 'node:crypto';
import {
  RESEARCH_SCHEMA_VERSION,
  researchRunSchema,
  type DiscoveryStatus,
  type ResearchBudget,
  type ResearchEvent,
  type ResearchIntake,
  type ResearchMode,
  type ResearchRun,
  type ResearchSource,
  type ResearchStage,
  type ResearchStatus,
  type SourceOutcome,
} from '../../../shared/research.js';
import { AppError } from '../errors.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import { jobLease } from '../storage/jobs.js';
import type { Repository } from '../storage/repository.js';

/** The statuses of a run that is not finished: someone is, or is about to be, working on it. */
export const LIVE_STATUSES: readonly ResearchStatus[] = ['queued', 'running', 'paused'];
export const isLive = (run: Pick<ResearchRun, 'status'>): boolean =>
  LIVE_STATUSES.includes(run.status);

/** The bounds of what one run record holds, which are those of `researchRunSchema`. */
export const MAX_SOURCES = 80;
export const MAX_EVENTS = 80;

export type RunRecord = ArtifactRecord<'research'>;

const emptyUsed = (): ResearchRun['used'] => ({
  pages: 0,
  domains: 0,
  bytes: 0,
  elapsedMs: 0,
  estimatedCostUsd: 0,
  duplicates: 0,
  failures: 0,
  quarantined: 0,
});

export interface NewRun {
  /** Position of this run among the project's: the id sorts in the order the runs were made. */
  sequence: number;
  mode: ResearchMode;
  intake: ResearchIntake;
  budget: ResearchBudget;
  discovery: DiscoveryStatus;
  at: string;
}

/** A run that is waiting for a worker: what was asked, with nothing yet read. */
export function newRun(input: NewRun): ResearchRun {
  return researchRunSchema.parse({
    version: RESEARCH_SCHEMA_VERSION,
    id: `rr-${String(input.sequence).padStart(4, '0')}-${randomUUID().slice(0, 8)}`,
    status: 'queued',
    stage: 'planning',
    mode: input.mode,
    intake: input.intake,
    plan: null,
    budget: input.budget,
    used: emptyUsed(),
    discovery: input.discovery,
    traceId: randomUUID(),
    startedAt: input.at,
    updatedAt: input.at,
  });
}

/** What is kept first when a run has read more addresses than its record holds: what became evidence, then what was read. */
const KEEP_ORDER: Record<SourceOutcome, number> = {
  used: 0,
  read: 1,
  quarantined: 2,
  blocked: 3,
  failed: 4,
  duplicate: 5,
  skipped: 6,
};

/** At most `MAX_SOURCES` records, the most telling first, in the order they were made. */
export function capSources(sources: readonly ResearchSource[]): ResearchSource[] {
  if (sources.length <= MAX_SOURCES) return [...sources];
  const kept = new Set(
    sources
      .map((source, at) => ({ at, rank: KEEP_ORDER[source.outcome] }))
      .sort((a, b) => a.rank - b.rank || a.at - b.at)
      .slice(0, MAX_SOURCES)
      .map(({ at }) => at),
  );
  return sources.filter((_source, at) => kept.has(at));
}

export function eventOf(
  at: string,
  stage: ResearchStage,
  level: ResearchEvent['level'],
  message: string,
): ResearchEvent {
  return { at, stage, level, message: message.slice(0, 240) };
}

/**
 * Where runs are kept: one `research` artifact for each, in the project's own artifacts, so that a run
 * is stored, revised and deleted with its project, on either storage engine, and is never visible to
 * another tenant. A write is held to the revision the writer last saw, and a writer that is a job's is
 * held to the job's lease, so a worker that lost its job cannot overwrite what the new holder wrote.
 */
export class ResearchStore {
  constructor(private readonly repository: Repository) {}

  /** The newest run of a project, or null. A run that can no longer be read counts as absent. */
  latest(projectId: string): RunRecord | null {
    const [key] = this.repository.artifacts.keys(projectId, 'research');
    if (key === undefined) return null;
    try {
      return this.repository.artifacts.get(projectId, 'research', key);
    } catch {
      return null;
    }
  }

  /** The newest run, when it is not finished. */
  live(projectId: string): RunRecord | null {
    const latest = this.latest(projectId);
    return latest && isLive(latest.data) ? latest : null;
  }

  /** How many runs a project has had, for the id of the next. */
  count(projectId: string): number {
    return this.repository.artifacts.keys(projectId, 'research').length;
  }

  get(projectId: string, runId: string): RunRecord | null {
    return this.repository.artifacts.get(projectId, 'research', runId);
  }

  create(projectId: string, run: ResearchRun): RunRecord {
    return this.save(projectId, run, 0);
  }

  /**
   * Writes a run, if its stored revision is still `expectedRevision`. Refused with
   * `ARTIFACT_CONFLICT` when someone else wrote it meanwhile, and with `LEASE_LOST` when the job this
   * write is made for has been handed to another worker.
   */
  save(projectId: string, run: ResearchRun, expectedRevision: number): RunRecord {
    const held = jobLease.getStore();
    if (held && !this.repository.jobs.holds(held.jobId, held.owner)) {
      throw new AppError(
        409,
        'LEASE_LOST',
        'This job was handed to another worker, so this one must stop and write nothing more.',
      );
    }
    return this.repository.artifacts.put(
      projectId,
      'research',
      run.id,
      { ...run, sources: capSources(run.sources), events: run.events.slice(-MAX_EVENTS) },
      { expectedRevision },
    );
  }

  remove(projectId: string, runId: string): void {
    this.repository.artifacts.delete(projectId, 'research', runId);
  }

  /** Every run of every project that is not finished: for the work done when the server starts. */
  liveRuns(): RunRecord[] {
    return this.repository.artifacts
      .listAll('research', {
        matching: (payload) => /"status":"(?:queued|running|paused)"/u.test(payload),
      })
      .filter((record) => isLive(record.data));
  }
}

/**
 * The run that a worker is carrying out, and the means to keep what is known of it written down. Every
 * change is a whole new record, saved at once, held to the revision the last save made: the record in
 * the store is always a state the run was in, and is never a half of one.
 */
export class RunRecorder {
  private run: ResearchRun;
  private revision: number;

  constructor(
    private readonly store: ResearchStore,
    private readonly projectId: string,
    record: RunRecord,
    private readonly clock: () => Date,
  ) {
    this.run = record.data;
    this.revision = record.revision;
  }

  get current(): ResearchRun {
    return this.run;
  }

  get stored(): number {
    return this.revision;
  }

  /**
   * Takes up a record that was saved by the caller, in a transaction of its own, from the revision `stored`
   * had. It is for a write that belongs with others (the sources a run adds and the record of having added
   * them), where the recorder must not move until that transaction has committed.
   */
  adopt(record: RunRecord): ResearchRun {
    this.run = record.data;
    this.revision = record.revision;
    return this.run;
  }

  /** Changes the run and writes it. The change gets the run as it stands and returns what it becomes. */
  update(change: (run: ResearchRun) => ResearchRun): ResearchRun {
    const next = { ...change(this.run), updatedAt: this.clock().toISOString() };
    const record = this.store.save(this.projectId, next, this.revision);
    this.run = record.data;
    this.revision = record.revision;
    return this.run;
  }

  /** Adds a line to the run's log, with the stage the run is at. */
  event(level: ResearchEvent['level'], message: string): ResearchRun {
    return this.update((run) => ({
      ...run,
      events: [...run.events, eventOf(this.clock().toISOString(), run.stage, level, message)],
    }));
  }

  /** Moves the run to a stage it has reached, with a line for the log. */
  reach(stage: ResearchStage, message?: string): ResearchRun {
    return this.update((run) => ({
      ...run,
      stage,
      events: message
        ? [...run.events, eventOf(this.clock().toISOString(), stage, 'info', message)]
        : run.events,
    }));
  }
}
