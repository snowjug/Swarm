import { createHash } from 'node:crypto';
import {
  researchIntakeSchema,
  researchModeOf,
  type DiscoveryStatus,
  type ResearchBudget,
  type ResearchIntake,
  type ResearchIntakeInput,
  type ResearchRun,
  type ResearchStage,
  type ResearchView,
} from '../../../shared/research.js';
import { MAX_DOCUMENTS, type ProjectDetail } from '../../../shared/types.js';
import { researchEnabled, clampBudget } from './config.js';
import type { ServerConfig } from '../config.js';
import { AppError } from '../errors.js';
import { LedgerService } from '../grounding/service.js';
import { validateStep } from '../guided/state.js';
import type { ModelFactory } from '../models/factory.js';
import type { AddedDocument, Repository } from '../storage/repository.js';
import { productSignals } from '../telemetry/product-signals.js';
import type { CrawlDeps, PageFetcher } from './crawler/types.js';
import { PublicPageFetcher } from './crawler/fetch.js';
import type { SearchProvider } from './discovery.js';
import { searchProviderFor } from './discovery.js';
import type { PdfReader } from './extract/index.js';
import { PauseControl } from './pause.js';
import { addressOf, RunPipeline, type Control, type PipelineDeps } from './run.js';
import { eventOf, isLive, newRun, ResearchStore, RunRecorder, type RunRecord } from './store.js';

/** What the service asks of the job queue; the orchestrator is what answers. */
export interface JobsPort {
  enqueueStep(
    id: string,
    step: 'knowledge',
    resume: boolean,
    options: { idempotencyKey?: string },
  ): unknown;
  cancel(id: string): unknown;
  isBusy(id: string): boolean;
}

/** What a run that is waiting is given before it is taken to be abandoned, in milliseconds. */
const QUEUED_GRACE_MS = 60_000;

/** The stages in which a run is still reading or about to: the only ones a person can pause or finish. */
const CONTROLLABLE: ReadonlySet<ResearchStage> = new Set([
  'planning',
  'finding-sources',
  'reading',
]);

/**
 * What a test may replace. None of it is a setting: nothing in the environment or the configuration
 * reaches these, so a deployment cannot read plain HTTP, a private address or a pretend web by any
 * means but the code that builds the application for a test.
 */
export interface ResearchSeam {
  /** The fetcher the crawl reads through: a stub resolver, or servers on this machine. */
  fetcher?: PageFetcher;
  /** Read http as well as https, for fixture servers that have no certificate. */
  allowHttp?: boolean;
  /** What finds pages for a question that names none. */
  search?: SearchProvider;
  /** The clock, the waiting and the jitter of the crawl, so that a test can run it on virtual time. */
  crawl?: Partial<Pick<CrawlDeps, 'now' | 'sleep' | 'random' | 'tuning' | 'extractLimits'>>;
  /** The service's own clock: the dates it writes, and the age of a page. */
  now?: () => number;
  /** How long a pause may last before the run ends with what it has read. */
  maxPauseMs?: number;
}

export interface ResearchServiceOptions extends ResearchSeam {
  repository: Repository;
  config: ServerConfig;
  createModel: ModelFactory;
  jobs: JobsPort;
  /** The project's isolated PDF reader. Without it a PDF is not fetched. */
  pdf?: PdfReader;
}

export interface StartRequest {
  intake?: ResearchIntakeInput;
  budget?: Partial<Record<keyof ResearchBudget, number>>;
  /** A repeated request with this key is the one it repeats, not a second run. */
  idempotencyKey?: string;
}

/** `proceed`: go on to build the project's knowledge. `hold`: there is nothing to build it from. */
export type PhaseResult = 'proceed' | 'hold';

interface Active {
  recorder: RunRecorder;
  control: Control;
}

const phases = new WeakMap<Repository, ResearchService>();

/** The research service of the application that owns this repository, if there is one. */
export function researchServiceFor(repository: Repository): ResearchService | null {
  return phases.get(repository) ?? null;
}

/**
 * What a request that carries no key is known by: the same documents sent for the same project are one
 * request, so that a double click, or a retry after a reply that was lost, adds them once.
 */
function handKey(documents: readonly AddedDocument[]): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify(
        documents.map((document) => [
          document.name,
          document.content,
          document.pageCount ?? null,
          document.provenance ?? null,
        ]),
      ),
    )
    .digest('hex');
  return `by-hand:${digest.slice(0, 40)}`;
}

const startable = (project: ProjectDetail): boolean => {
  const step = project.console?.steps.knowledge;
  return (
    project.workflow === 'guided' &&
    project.status !== 'completed' &&
    (step === 'pending' || step === 'failed' || step === 'cancelled')
  );
};

/**
 * Automatic research for a project, as the first phase of the job that grounds it. This class is the
 * surface: what a person may do to a run (start, add a site, pause, resume, finish, cancel), what is
 * shown of it, and what the job does before it builds knowledge. The work of a run is `RunPipeline`.
 * Everything here is held in the run's record, so a restart loses nothing but the pause of a run in
 * progress, and a run that a restart cut short is marked so.
 */
export class ResearchService {
  readonly store: ResearchStore;
  private readonly repository: Repository;
  private readonly config: ServerConfig;
  private readonly createModel: ModelFactory;
  private readonly jobs: JobsPort;
  private readonly ledger: LedgerService;
  private readonly fetcher: PageFetcher;
  private readonly search: SearchProvider;
  private readonly pdf: PdfReader | undefined;
  private readonly allowHttp: boolean;
  private readonly crawl: NonNullable<ResearchSeam['crawl']>;
  private readonly clock: () => number;
  private readonly maxPauseMs: number;
  private readonly active = new Map<string, Active>();

  constructor(options: ResearchServiceOptions) {
    this.repository = options.repository;
    this.config = options.config;
    this.createModel = options.createModel;
    this.jobs = options.jobs;
    this.pdf = options.pdf;
    this.store = new ResearchStore(options.repository);
    this.ledger = new LedgerService(options.repository);
    const { urlIngestion } = options.config;
    this.fetcher =
      options.fetcher ??
      new PublicPageFetcher({
        allowedPorts: urlIngestion.allowedPorts,
        ...(urlIngestion.allowedHosts.length > 0
          ? { allowedHosts: urlIngestion.allowedHosts }
          : {}),
      });
    this.search = options.search ?? searchProviderFor(options.config.research);
    this.allowHttp = options.allowHttp === true;
    this.crawl = options.crawl ?? {};
    this.clock = options.now ?? Date.now;
    this.maxPauseMs = options.maxPauseMs ?? options.config.research.maxPauseMs;
  }

  /**
   * Makes this the research of its repository, so that the job that grounds a project runs it first,
   * and marks the runs that a stopped server left unfinished.
   */
  attach(): this {
    phases.set(this.repository, this);
    this.recover();
    return this;
  }

  /** Lets go of what a run in progress holds. The orchestrator ends the job. */
  close(): void {
    for (const { control } of this.active.values()) control.gate.dispose();
    this.active.clear();
  }

  get discovery(): DiscoveryStatus {
    return this.search.status();
  }

  // -- what a person is shown --------------------------------------------------------------------

  view(projectId: string): ResearchView {
    const project = this.repository.get(projectId);
    this.reconcile(projectId);
    const latest = this.store.latest(projectId);
    return {
      run: latest?.data ?? null,
      revision: latest?.revision ?? 0,
      discovery: this.search.status(),
      may: this.may(project, latest?.data ?? null),
    };
  }

  private may(project: ProjectDetail, run: ResearchRun | null): ResearchView['may'] {
    const live = run !== null && isLive(run);
    return {
      start:
        researchEnabled(this.config) &&
        startable(project) &&
        !live &&
        !this.jobs.isBusy(project.id) &&
        project.documents.length < MAX_DOCUMENTS,
      pause:
        this.active.has(project.id) && run?.status === 'running' && CONTROLLABLE.has(run.stage),
      cancel: live && this.repository.jobs.live(project.id) !== null,
    };
  }

  // -- starting ----------------------------------------------------------------------------------

  private requireEnabled(): void {
    if (!researchEnabled(this.config)) {
      throw new AppError(
        403,
        'RESEARCH_DISABLED',
        'Automatic research is turned off on this server. Add sources of your own instead.',
      );
    }
  }

  /** What the person asked for, on top of what the project's scenario already says about its time and place. */
  private intakeFor(project: ProjectDetail, given?: ResearchIntakeInput): ResearchIntake {
    let horizon: string | null = null;
    let geography: string | null = null;
    try {
      const scenario = this.repository.artifacts.get(project.id, 'scenario')?.data;
      horizon = scenario?.horizon ?? null;
      geography = scenario?.geography ?? null;
    } catch {
      // A scenario that cannot be read says nothing about time or place.
    }
    return researchIntakeSchema.parse({
      ...(horizon ? { horizon } : {}),
      ...(geography ? { geography } : {}),
      ...given,
    });
  }

  /** Starts a run for the project: it reads what the intake names, or looks for sources, as the first part of grounding. */
  start(projectId: string, request: StartRequest, actor: string): ResearchView {
    this.requireEnabled();
    const project = this.repository.get(projectId);
    this.reconcile(projectId);
    if (this.repeated(projectId, request.idempotencyKey)) return this.view(projectId);
    this.requireIdle(projectId);
    return this.launch(project, this.intakeFor(project, request.intake), request, actor, 'run');
  }

  /**
   * Adds a page or a site a person named, as a run of its own: a page is read (and what it links to, as far
   * as the budget goes), and a site is read and kept to. The same rules as for any address apply, and what
   * it adds counts against the project's limits of ten sources and 200,000 characters.
   */
  addSource(
    projectId: string,
    address: string,
    request: Pick<StartRequest, 'budget' | 'idempotencyKey'>,
    actor: string,
  ): ResearchView {
    this.requireEnabled();
    const project = this.repository.get(projectId);
    this.reconcile(projectId);
    if (this.repeated(projectId, request.idempotencyKey)) return this.view(projectId);
    this.requireIdle(projectId);
    const earlier = this.store.latest(projectId)?.data.intake;
    const text = address.trim();
    let site = false;
    try {
      const url = new URL(addressOf(text));
      site = (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash;
    } catch {
      // An address that cannot be read is recorded as refused by the run, like any other.
    }
    const intake = this.intakeFor(project, {
      ...(earlier?.guidance ? { guidance: earlier.guidance } : {}),
      ...(earlier?.horizon ? { horizon: earlier.horizon } : {}),
      ...(earlier?.geography ? { geography: earlier.geography } : {}),
      ...(site
        ? { domain: text.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '').replace(/\/+$/u, '') }
        : { url: text }),
    });
    return this.launch(project, intake, request, actor, 'source', site ? 'site' : 'page');
  }

  private repeated(projectId: string, key: string | undefined): boolean {
    return key !== undefined && this.repository.jobs.byIdempotencyKey(projectId, key) !== null;
  }

  private requireIdle(projectId: string): void {
    if (this.store.live(projectId)) {
      throw new AppError(
        409,
        'RESEARCH_ACTIVE',
        'Research is already running for this project. Wait for it, or cancel it first.',
      );
    }
  }

  private launch(
    project: ProjectDetail,
    intake: ResearchIntake,
    request: Pick<StartRequest, 'budget' | 'idempotencyKey'>,
    actor: string,
    kind: 'run' | 'source',
    target?: 'page' | 'site',
  ): ResearchView {
    const mode = researchModeOf(intake);
    if (mode === 'manual') {
      throw new AppError(
        400,
        'RESEARCH_OFF',
        'Automatic research is turned off for this request. Add sources of your own instead.',
      );
    }
    if (project.documents.length >= MAX_DOCUMENTS) {
      throw new AppError(
        409,
        'DOCUMENT_LIMIT',
        `This project already holds ${MAX_DOCUMENTS} sources, the most it can, so research has nowhere to add more.`,
      );
    }
    const budget = clampBudget(this.config.research, request.budget);
    const run = newRun({
      sequence: this.store.count(project.id) + 1,
      mode,
      intake,
      budget,
      discovery: this.search.status(),
      at: new Date(this.clock()).toISOString(),
    });
    // The run is written first, so that a worker that takes the job at once finds it; and removed again
    // when the job is refused (a full queue, a stage that cannot be started), so that no run waits for a job.
    this.store.create(project.id, run);
    try {
      this.jobs.enqueueStep(
        project.id,
        'knowledge',
        false,
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {},
      );
    } catch (error) {
      this.store.remove(project.id, run.id);
      throw error;
    }
    this.repository.audit.record({
      actor,
      action: kind === 'run' ? 'research.started' : 'research.source.added',
      targetType: 'project',
      targetId: project.id,
      projectId: project.id,
      detail: {
        mode,
        ...(target ? { target } : {}),
        pages: budget.maxPages,
        sites: budget.maxDomains,
        depth: budget.maxDepth,
        seconds: Math.round(budget.maxElapsedMs / 1_000),
        model: project.mode === 'llm',
      },
    });
    return this.view(project.id);
  }

  // -- the person's own sources ------------------------------------------------------------------

  /**
   * Adds text that a person pasted or took from a file to a project that has not been grounded, and goes on to
   * ground the project with the sources it now holds. It is the person's own evidence: research does not read
   * it, plan from it or change it, and it works when research is off. The sources and the queued stage are one
   * unit, so a stage that cannot be queued (the queue is full, a model that is not set up) leaves the project as
   * it was and the same request can be sent again; and a request sent twice is one request, by the key it
   * carries or, without one, by what it holds.
   */
  addDocuments(
    projectId: string,
    documents: readonly AddedDocument[],
    request: Pick<StartRequest, 'idempotencyKey'>,
    actor: string,
  ): ProjectDetail {
    const project = this.repository.get(projectId);
    const key = request.idempotencyKey ?? handKey(documents);
    const repeated = (): boolean => this.repository.jobs.byIdempotencyKey(projectId, key) !== null;
    if (repeated()) return project;
    this.reconcile(projectId);
    this.requireIdle(projectId);
    validateStep(project, 'knowledge');
    this.repository.atomic(() => {
      // Asked again inside the unit: a request that raced this one has queued the stage by now.
      if (repeated()) return;
      this.repository.appendDocuments(projectId, documents, {
        actor,
        origin: 'evidence',
        how: 'by a person',
      });
      // A ledger that was built before these sources were added learns of the conflicts they bring.
      this.ledger.addFoundConflicts(projectId);
      this.jobs.enqueueStep(projectId, 'knowledge', false, { idempotencyKey: key });
    });
    return this.repository.get(projectId);
  }

  // -- controlling a run in progress -------------------------------------------------------------

  private controllable(projectId: string, code: string, message: string): Active {
    this.repository.get(projectId);
    const active = this.active.get(projectId);
    const run = active?.recorder.current;
    if (
      !active ||
      !run ||
      !['running', 'paused'].includes(run.status) ||
      !CONTROLLABLE.has(run.stage)
    ) {
      throw new AppError(409, code, message);
    }
    return active;
  }

  pause(projectId: string): ResearchView {
    const active = this.controllable(
      projectId,
      'RESEARCH_NOT_PAUSABLE',
      'Research can be paused only while it is running and has not finished reading.',
    );
    const { recorder, control } = active;
    if (recorder.current.status !== 'running') {
      throw new AppError(409, 'RESEARCH_NOT_PAUSABLE', 'This research is already paused.');
    }
    if (control.gate.expired) {
      throw new AppError(
        409,
        'RESEARCH_NOT_PAUSABLE',
        'This research was paused for as long as it may be, and is finishing with what it has read.',
      );
    }
    control.gate.pause(this.maxPauseMs, () => this.expire(active));
    recorder.update((run) => ({ ...run, status: 'paused' }));
    recorder.event(
      'info',
      'Paused. It ends by itself with what has been read if it stays paused too long.',
    );
    return this.view(projectId);
  }

  /** A pause that lasted as long as it may: the gate has opened, and the run goes on to end with what it read. */
  private expire(active: Active): void {
    try {
      if (active.recorder.current.status !== 'paused') return;
      active.recorder.update((run) => ({ ...run, status: 'running' }));
      active.recorder.event(
        'warn',
        'The pause lasted too long, so research ends with what has been read.',
      );
    } catch {
      // The run finds the same fault at its next write, and ends there.
    }
  }

  resume(projectId: string): ResearchView {
    const active = this.controllable(
      projectId,
      'RESEARCH_NOT_PAUSED',
      'Only research that is paused can be resumed.',
    );
    if (active.recorder.current.status !== 'paused') {
      throw new AppError(
        409,
        'RESEARCH_NOT_PAUSED',
        'Only research that is paused can be resumed.',
      );
    }
    active.control.gate.resume();
    active.recorder.update((run) => ({ ...run, status: 'running' }));
    active.recorder.event('info', 'Resumed.');
    return this.view(projectId);
  }

  /** Stops reading and goes on with what has been read: not a cancellation, which ends the job. */
  finish(projectId: string): ResearchView {
    const active = this.controllable(
      projectId,
      'RESEARCH_NOT_FINISHABLE',
      'Research can be finished early only while it has not finished reading.',
    );
    active.control.finish = true;
    active.control.gate.resume();
    active.recorder.update((run) => ({ ...run, status: 'running' }));
    active.recorder.event('info', 'A person asked to finish with what had been read.');
    return this.view(projectId);
  }

  cancel(projectId: string): ResearchView {
    this.repository.get(projectId);
    this.reconcile(projectId);
    const live = this.store.live(projectId);
    if (!live) {
      throw new AppError(409, 'RESEARCH_NOT_ACTIVE', 'There is no research running to cancel.');
    }
    this.jobs.cancel(projectId);
    productSignals.cancellation('research');
    const active = this.active.get(projectId);
    if (active) {
      if (active.recorder.current.status !== 'cancelled') {
        active.recorder.update((run) => ({
          ...run,
          status: 'cancelled',
          stoppedBecause: 'cancelled',
          finishedAt: new Date(this.clock()).toISOString(),
        }));
        active.recorder.event('warn', 'Research was cancelled.');
      }
    } else if (live.data.status === 'queued') {
      // A job that had not started is cancelled at once, so nothing will write this run again.
      this.settle(live, 'cancelled');
    }
    return this.view(projectId);
  }

  // -- what a stopped server leaves --------------------------------------------------------------

  /** Marks a run that nobody is carrying out as ended, as cancelled when its job was, and failed otherwise. */
  private settle(record: RunRecord, status: 'cancelled' | 'failed'): void {
    const run = record.data;
    const at = new Date(this.clock()).toISOString();
    try {
      this.store.save(
        record.projectId,
        {
          ...run,
          status,
          stoppedBecause: status === 'cancelled' ? 'cancelled' : run.stoppedBecause,
          finishedAt: at,
          updatedAt: at,
          events: [
            ...run.events,
            eventOf(
              at,
              run.stage,
              'warn',
              status === 'cancelled'
                ? 'Research was cancelled before it started.'
                : 'The server stopped before this run finished. Start it again.',
            ),
          ],
        },
        record.revision,
      );
    } catch (error) {
      // Someone else settled it first.
      if (
        !(error instanceof AppError) ||
        !['ARTIFACT_CONFLICT', 'LEASE_LOST'].includes(error.code)
      ) {
        throw error;
      }
      return;
    }
    productSignals.researchRun({
      outcome: status === 'cancelled' ? 'cancelled' : 'failed',
      mode: run.mode,
      stopReason: status === 'cancelled' ? 'cancelled' : null,
    });
  }

  /** A run that is not finished, with no job to carry it out and no worker here that is: it was cut short. */
  private reconcile(projectId: string): void {
    const latest = this.store.latest(projectId);
    if (!latest || !isLive(latest.data) || this.active.has(projectId)) return;
    if (this.repository.jobs.live(projectId)) return;
    // A run is written just before its job is queued, by another process perhaps: give it a moment.
    const age = this.clock() - Date.parse(latest.data.updatedAt);
    if (latest.data.status === 'queued' && age < QUEUED_GRACE_MS) return;
    const last = this.repository.jobs.recent(projectId, 1)[0];
    this.settle(latest, last?.state === 'cancelled' ? 'cancelled' : 'failed');
  }

  /** When the server starts: every run that is not finished and whose job is not in the queue was cut short. */
  recover(): void {
    const owned = new Set(this.repository.jobs.liveProjectIds());
    for (const record of this.store.liveRuns()) {
      if (owned.has(record.projectId)) continue;
      const last = this.repository.jobs.recent(record.projectId, 1)[0];
      this.settle(record, last?.state === 'cancelled' ? 'cancelled' : 'failed');
    }
  }

  // -- the first phase of grounding --------------------------------------------------------------

  /**
   * Which run the job that grounds this project should carry out, if any. A run that was started and is
   * waiting is the one. A project that has no evidence at all gets one made for it (a question on its own,
   * or a run that ended with nothing) from what it asked for before. A project with sources of its own,
   * and no run waiting, is grounded as it always was.
   */
  private claim(project: ProjectDetail): RunRecord | null {
    const latest = this.store.latest(project.id);
    if (latest?.data.status === 'queued') return latest;
    const evidence = this.repository.chunks(project.id).length;
    if (latest && isLive(latest.data)) {
      // Running or paused, and this process is not running it: an earlier attempt of the job was cut off.
      this.settle(latest, 'failed');
      return this.fresh(project, latest.data);
    }
    if (evidence > 0) return null;
    return this.fresh(project, latest?.data ?? null);
  }

  private fresh(project: ProjectDetail, previous: ResearchRun | null): RunRecord {
    const intake = previous ? previous.intake : this.intakeFor(project);
    return this.store.create(
      project.id,
      newRun({
        sequence: this.store.count(project.id) + 1,
        mode: researchModeOf(intake),
        intake,
        budget: clampBudget(this.config.research, previous?.budget),
        discovery: this.search.status(),
        at: new Date(this.clock()).toISOString(),
      }),
    );
  }

  private pipeline(): PipelineDeps {
    return {
      repository: this.repository,
      config: this.config,
      createModel: this.createModel,
      store: this.store,
      ledger: this.ledger,
      fetcher: this.fetcher,
      search: this.search,
      pdf: this.pdf,
      allowHttp: this.allowHttp,
      crawl: this.crawl,
      clock: this.clock,
    };
  }

  /**
   * Runs before the knowledge of a project is built, inside the job that builds it, so that the job's
   * lease, cancellation, retry and recovery are the queue's. It carries out the run that is waiting, or
   * makes one when the project has no evidence yet. Whatever it adds is in the project before it returns.
   * `hold` says there is still nothing to build knowledge from.
   */
  async beforeKnowledge(projectId: string, signal: AbortSignal): Promise<PhaseResult> {
    if (!researchEnabled(this.config)) return 'proceed';
    const project = this.repository.get(projectId);
    const record = this.claim(project);
    if (!record) return 'proceed';
    const control: Control = { gate: new PauseControl(), finish: false };
    const recorder = new RunRecorder(this.store, projectId, record, () => new Date(this.clock()));
    this.active.set(projectId, { recorder, control });
    try {
      await new RunPipeline(this.pipeline(), projectId, recorder, control, signal).run();
    } finally {
      control.gate.dispose();
      this.active.delete(projectId);
    }
    return this.repository.chunks(projectId).length > 0 ? 'proceed' : 'hold';
  }
}
