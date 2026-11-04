import {
  RESEARCH_STOP_LABELS,
  type FetchErrorClass,
  type ResearchPlan,
  type ResearchRun,
  type ResearchSource,
  type ResearchStatus,
  type ResearchStopReason,
} from '../../../shared/research.js';
import type { ServerConfig } from '../config.js';
import { AppError, publicFailure, throwIfAborted } from '../errors.js';
import { detectContradictions } from '../grounding/contradictions.js';
import type { LedgerService } from '../grounding/service.js';
import type { ModelFactory } from '../models/factory.js';
import { newOperationBudget, taskRunnerFor } from '../models/factory.js';
import type { Repository } from '../storage/repository.js';
import {
  productSignals,
  safetyReasonOfAddress,
  type SafetyBlockReason,
} from '../telemetry/product-signals.js';
import { Assessor } from './assess.js';
import { crawl } from './crawler/crawl.js';
import { systemDeps } from './crawler/deps.js';
import type {
  CrawlDeps,
  CrawlEvent,
  CrawlInput,
  CrawlResult,
  CrawlSeed,
  CrawlState,
  PageFetcher,
} from './crawler/types.js';
import type { SearchProvider } from './discovery.js';
import { searchFailureSentence, searchQueryOf } from './search.js';
import type { PdfReader } from './extract/index.js';
import type { PauseControl } from './pause.js';
import { buildResearchPlan, planQuestion, stoppingConditionsOf } from './plan.js';
import { existingEvidence, locatePassages, selectDocuments, type Selection } from './select.js';
import { eventOf, type ResearchStore, type RunRecorder } from './store.js';
import { clip } from './text.js';

/** Calls the planner may make: the first, a correction, and one more if its deployment is changed. */
const PLAN_CALLS = 3;
/** Addresses taken from a search provider's answer. */
const MAX_SEARCH_SEEDS = 10;

/** What a run needs from the server around it. */
export interface PipelineDeps {
  repository: Repository;
  config: ServerConfig;
  createModel: ModelFactory;
  store: ResearchStore;
  ledger: LedgerService;
  fetcher: PageFetcher;
  search: SearchProvider;
  pdf: PdfReader | undefined;
  allowHttp: boolean;
  /** The clock, the waiting and the jitter of the crawl, and what its parser is held to. A test replaces them. */
  crawl: Partial<Pick<CrawlDeps, 'now' | 'sleep' | 'random' | 'tuning' | 'extractLimits'>>;
  clock: () => number;
}

/** What a person can ask of a run in progress, held in this process. */
export interface Control {
  readonly gate: PauseControl;
  /** A person asked to stop reading and use what has been read. */
  finish: boolean;
}

interface Found {
  seeds: CrawlSeed[];
  sameSiteOnly: boolean;
  domains: string[];
  /** Set when there is nothing to read, and a rule is why. */
  blocked: ResearchStopReason | null;
}

type Ending = {
  status: Extract<ResearchStatus, 'completed' | 'blocked' | 'cancelled'>;
  stop: ResearchStopReason | null;
};

/** Words the crawler gives for the rule that refused an address, as the reasons metrics are counted by. */
const ADDRESS_REASONS: Readonly<Record<string, SafetyBlockReason>> = {
  'ip-form': 'invalid-address',
  unparsable: 'invalid-address',
  empty: 'invalid-address',
  'too-long': 'invalid-address',
  'control-characters': 'invalid-address',
  'no-host': 'invalid-address',
  'single-label': 'internal-name',
  'internal-name': 'internal-name',
  scheme: 'blocked-scheme',
  'http-not-allowed': 'https-downgrade',
  port: 'blocked-port',
  credentials: 'credentials-in-url',
  'allow-list': 'not-on-allow-list',
  robots: 'robots-disallowed',
  'robots-unavailable': 'robots-disallowed',
  noai: 'robots-disallowed',
};

function safetyReasonOf(errorClass: string, reason: string): SafetyBlockReason {
  if (errorClass === 'redirect-refused') return 'redirect-refused';
  return ADDRESS_REASONS[reason] ?? safetyReasonOfAddress(reason);
}

/** A page the crawl accepted is only read until the run has chosen among them: what became evidence is `used`. */
const provisional = (source: ResearchSource): ResearchSource =>
  source.outcome === 'used' ? { ...source, outcome: 'read' } : source;

/** An address as a person typed it, with `https://` in front when it has no scheme. */
export function addressOf(text: string): string {
  const trimmed = text.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * One run, from its plan to its end: planning, finding something to read, reading, keeping the best of
 * what was read as sources of the project, and checking those sources against each other. It owns no
 * state of its own but what it writes to the run's record, so that what a person is shown is the run's
 * real state; every stage a run reports is one it has reached.
 *
 * Which addresses are fetched, in what order, how fast and when to stop is decided by the crawler and by
 * code in this folder from the budget and the plan. No model chooses an address, and no page, question
 * or model reply changes a limit.
 */
export class RunPipeline {
  private plan!: ResearchPlan;
  private assessor: Assessor | null = null;
  private crawled: CrawlResult | null = null;
  private chosen: Selection['chosen'] = [];
  private addedIds = new Set<string>();
  private conflicts = 0;
  private documents = 0;
  private ended = false;
  private readonly blocks = new Map<SafetyBlockReason, number>();

  constructor(
    private readonly deps: PipelineDeps,
    private readonly projectId: string,
    private readonly recorder: RunRecorder,
    private readonly control: Control,
    private readonly signal: AbortSignal,
  ) {}

  private now = (): Date => new Date(this.deps.clock());

  private progress(value: number): void {
    this.deps.repository.update(this.projectId, { progress: value });
  }

  /** A line in the project's own log, which every person who can read the project sees: counts, never text. */
  private note(message: string): void {
    this.deps.repository.addEvent(this.projectId, 'knowledge', message);
  }

  /** Runs the run. It returns how many sources it added; it throws what stopped it, after recording that. */
  async run(): Promise<number> {
    try {
      await this.go();
      return this.documents;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private async go(): Promise<void> {
    const { recorder } = this;
    throwIfAborted(this.signal);
    recorder.update((run) => ({
      ...run,
      status: 'running',
      stage: 'planning',
      startedAt: this.now().toISOString(),
    }));
    productSignals.researchRun({ outcome: 'started', mode: recorder.current.mode });
    this.note('Research started: planning what to look for.');
    this.progress(5);

    await this.planning();
    throwIfAborted(this.signal);

    recorder.reach('finding-sources');
    this.progress(6);
    const found = await this.finding();
    throwIfAborted(this.signal);
    if (found.blocked) {
      recorder.event('block', RESEARCH_STOP_LABELS[found.blocked]);
      this.end({ status: 'blocked', stop: found.blocked });
      return;
    }

    const crawled = await this.reading(found);
    throwIfAborted(this.signal);
    this.crawled = crawled;
    this.report(crawled);

    const ending = this.keeping(crawled);
    if (ending === null) {
      this.checking();
      this.end({ status: 'completed', stop: crawled.stoppedBecause });
    } else {
      this.end(ending);
    }
  }

  // -- planning ----------------------------------------------------------------------------------

  private async planning(): Promise<void> {
    const { recorder, deps } = this;
    const run = recorder.current;
    const project = deps.repository.get(this.projectId);
    const earlier = this.earlierPlan(project.question);
    if (earlier) {
      this.plan = {
        ...earlier,
        mode: run.mode,
        stoppingConditions: stoppingConditionsOf(run.budget),
      };
      recorder.update((current) => ({ ...current, plan: this.plan }));
      recorder.event('info', 'Reused the plan made for this question earlier.');
      return;
    }
    const wantsModel = project.mode === 'llm' && deps.config.provider.configured;
    const spendsNothing = run.budget.maxEstimatedCostUsd <= 0;
    const priced = deps.config.routing.prices.length > 0;
    const runner =
      wantsModel && !spendsNothing
        ? taskRunnerFor(deps.config, deps.createModel, {
            onUsage: deps.repository.modelUse(this.projectId),
            maxCalls: PLAN_CALLS,
            budget: newOperationBudget(
              deps.config,
              priced ? { usd: run.budget.maxEstimatedCostUsd } : {},
            ),
          })
        : null;
    const tenantId = deps.repository.ownership(this.projectId)?.tenantId;
    const outcome = await buildResearchPlan({
      question: project.question,
      intake: run.intake,
      mode: run.mode,
      budget: run.budget,
      now: deps.clock(),
      runner,
      signal: this.signal,
      ...(tenantId ? { tenantId } : {}),
      ...(priced && !spendsNothing ? { costCeilingUsd: run.budget.maxEstimatedCostUsd } : {}),
    });
    const called = (outcome.usage?.calls ?? 0) > 0;
    this.plan = outcome.plan;
    recorder.update((current) => ({
      ...current,
      plan: outcome.plan,
      modelUsed: called,
      used: {
        ...current.used,
        estimatedCostUsd: outcome.cost.basis === 'estimate' ? outcome.cost.usd : 0,
      },
    }));
    if (outcome.origin === 'model') {
      recorder.event('info', 'Planned what to look for with the model you chose.');
    } else if (outcome.failure) {
      recorder.event('warn', outcome.failure.detail);
    } else if (wantsModel && spendsNothing) {
      recorder.event(
        'info',
        'The estimated model cost limit is zero, so rules planned what to look for.',
      );
    } else {
      recorder.event('info', 'Planned what to look for by rules on this server.');
    }
    if (called && outcome.cost.basis === 'unknown') {
      recorder.event(
        'info',
        'The cost of the model call could not be estimated: no price is set for it.',
      );
    }
  }

  /** The plan of the run before this one, when it was made for the same question: asked for once, not again. */
  private earlierPlan(question: string): ResearchPlan | null {
    const { store } = this.deps;
    const keys = this.deps.repository.artifacts.keys(this.projectId, 'research');
    for (const key of keys) {
      if (key === this.recorder.current.id) continue;
      try {
        const plan = store.get(this.projectId, key)?.data.plan;
        if (plan && plan.question === planQuestion(question)) return plan;
      } catch {
        // A run that cannot be read is not a plan to reuse.
      }
    }
    return null;
  }

  // -- finding something to read -----------------------------------------------------------------

  private async finding(): Promise<Found> {
    const { recorder, deps } = this;
    const run = recorder.current;
    const first = deps.store.count(this.projectId) <= 1;
    const named = (kind: 'user-url' | 'user-domain'): CrawlSeed['discoveredBy'] =>
      first ? kind : 'user-added';
    const hostOf = (address: string): string[] => {
      try {
        return [new URL(address).hostname];
      } catch {
        return [];
      }
    };
    if (run.mode === 'url') {
      const url = addressOf(run.intake.url ?? '');
      recorder.event('info', 'Starting from the page you named.');
      return {
        seeds: [{ url, discoveredBy: named('user-url') }],
        sameSiteOnly: false,
        domains: hostOf(url),
        blocked: null,
      };
    }
    if (run.mode === 'domain') {
      const url = addressOf(run.intake.domain ?? '');
      recorder.event('info', 'Starting from the site you named, and staying on it.');
      return {
        seeds: [{ url, discoveredBy: named('user-domain') }],
        sameSiteOnly: true,
        domains: hostOf(url),
        blocked: null,
      };
    }
    const status = deps.search.status();
    if (!status.available)
      return { seeds: [], sameSiteOnly: false, domains: [], blocked: 'discovery-unconfigured' };
    let hits: Awaited<ReturnType<SearchProvider['search']>>;
    // What the provider is sent is the names and topics of the plan, a few of them, and not the question as it was typed.
    const query = searchQueryOf(this.plan);
    recorder.event(
      'info',
      `Asked ${status.provider ?? 'the search provider'} for pages about the ${plural(this.plan.entities.length + this.plan.topics.length, 'name or topic', 'names and topics')} of the plan.`,
    );
    try {
      hits = await deps.search.search(query, {
        limit: Math.min(run.budget.maxPages, MAX_SEARCH_SEEDS),
        signal: this.signal,
      });
    } catch (error) {
      throwIfAborted(this.signal);
      throw new AppError(502, 'DISCOVERY_FAILED', searchFailureSentence(error));
    }
    const urls = [...new Set(hits.map((hit) => hit.url))].slice(0, MAX_SEARCH_SEEDS);
    recorder.event(
      'info',
      `The search provider offered ${plural(urls.length, 'address', 'addresses')}.`,
    );
    return {
      seeds: urls.map((url) => ({ url, discoveredBy: 'search' as const })),
      sameSiteOnly: false,
      domains: [],
      blocked: urls.length === 0 ? 'frontier-exhausted' : null,
    };
  }

  // -- reading -----------------------------------------------------------------------------------

  private async reading(found: Found): Promise<CrawlResult> {
    const { recorder, control, deps } = this;
    const run = recorder.current;
    const assessor = new Assessor(this.plan, () => this.now());
    this.assessor = assessor;
    const terms = [
      ...new Set([...this.plan.topics, ...this.plan.entities.map((entity) => entity.name)]),
    ]
      .map((term) => clip(term, 60))
      .slice(0, 24);
    let reading = false;
    let written = { pages: -1, sources: -1 };

    const onEvent = (event: CrawlEvent): void => {
      if (event.type === 'fetch-start' && !reading) {
        reading = true;
        try {
          recorder.reach('reading', 'Reading pages.');
          this.progress(8);
        } catch {
          // The next write finds the same fault and ends the run.
        }
      } else if (event.type === 'fetch-blocked') {
        const reason = safetyReasonOf(event.errorClass, event.reason);
        this.blocks.set(reason, (this.blocks.get(reason) ?? 0) + 1);
      }
    };

    const shouldStop = (state: CrawlState): ResearchStopReason | null => {
      assessor.take(state.pages);
      if (state.pages.length !== written.pages || state.sources.length !== written.sources) {
        written = { pages: state.pages.length, sources: state.sources.length };
        recorder.update((current) => ({
          ...current,
          used: { ...state.used, estimatedCostUsd: current.used.estimatedCostUsd },
          sources: state.sources.map(provisional),
          assessments: assessor.assessments(),
        }));
      }
      if (control.finish) return 'cancelled';
      if (control.gate.expired) return 'time-limit';
      const spent = recorder.current.used.estimatedCostUsd;
      if (spent > 0 && spent >= run.budget.maxEstimatedCostUsd) return 'cost-limit';
      if (assessor.sufficient()) return 'evidence-sufficient';
      if (assessor.saturated()) return 'no-new-signal';
      return null;
    };

    const input: CrawlInput = {
      seeds: found.seeds,
      budget: run.budget,
      allowHttp: deps.allowHttp,
      hints: {
        terms,
        categories: this.plan.likelySources.map((source) => source.category),
        domains: found.domains,
      },
      sameSiteOnly: found.sameSiteOnly,
      signal: this.signal,
      pause: control.gate,
      shouldStop,
    };
    const crawlDeps: CrawlDeps = {
      ...systemDeps({
        onEvent,
        traceId: run.traceId,
        fetcher: deps.fetcher,
        ...(deps.pdf ? { pdf: deps.pdf } : {}),
      }),
      ...deps.crawl,
    };
    return crawl(input, crawlDeps);
  }

  /** What the crawl found, as the run's record says it: every address, the counts, the reason it stopped. */
  private report(result: CrawlResult): void {
    const { recorder } = this;
    const stop = result.stoppedBecause;
    recorder.update((run) => ({
      ...run,
      used: { ...result.used, estimatedCostUsd: run.used.estimatedCostUsd },
      sources: result.sources.map(provisional),
      assessments: this.assessor?.assessments() ?? run.assessments,
      stoppedBecause: stop,
      events: [
        ...run.events,
        ...(stop
          ? [eventOf(this.now().toISOString(), run.stage, 'info', RESEARCH_STOP_LABELS[stop])]
          : []),
        ...(result.used.quarantined > 0
          ? [
              eventOf(
                this.now().toISOString(),
                run.stage,
                'warn',
                `${plural(result.used.quarantined, 'page was', 'pages were')} set aside as not usable as evidence.`,
              ),
            ]
          : []),
        ...(this.refusals() > 0
          ? [
              eventOf(
                this.now().toISOString(),
                run.stage,
                'warn',
                `${plural(this.refusals(), 'address was', 'addresses were')} refused by a safety rule.`,
              ),
            ]
          : []),
      ],
    }));
  }

  private refusals(): number {
    return [...this.blocks.values()].reduce((sum, count) => sum + count, 0);
  }

  // -- keeping the best of it --------------------------------------------------------------------

  /** Chooses the sources and adds them to the project with the record of having done so. Null when it went on. */
  private keeping(result: CrawlResult): Ending | null {
    const { recorder, deps } = this;
    const stop = result.stoppedBecause;
    if (this.control.finish && result.pages.length === 0)
      return { status: 'cancelled', stop: 'cancelled' };
    recorder.reach(
      'extracting-evidence',
      `Reading is over: ${plural(result.pages.length, 'page was', 'pages were')} read. Choosing which to keep as sources.`,
    );
    this.progress(11);
    const project = deps.repository.get(this.projectId);
    const selection = selectDocuments({
      pages: result.pages,
      plan: this.plan,
      existing: existingEvidence(project.documents),
      opposing: this.assessor?.opposingSources() ?? new Set(),
      now: deps.clock(),
    });
    throwIfAborted(this.signal);

    const verdicts = new Map(selection.setAside.map((aside) => [aside.sourceId, aside]));
    const chosen = new Map(selection.chosen.map((item) => [item.sourceId, item]));
    const at = this.now().toISOString();
    const saved = deps.repository.atomic(() => {
      const appended = deps.repository.appendDocuments(
        this.projectId,
        selection.chosen.map((item) => item.document),
        { origin: 'research' },
      );
      const ids = new Map(
        selection.chosen.map((item, index) => [item.sourceId, appended.documents[index]?.id ?? '']),
      );
      const passages = locatePassages(appended.chunks, selection.chosen, ids);
      const passagesOf = (id: string): number =>
        appended.chunks.filter((chunk) => chunk.documentId === id).length;
      const current = recorder.current;
      const sources = current.sources.map((source): ResearchSource => {
        const item = chosen.get(source.id);
        if (item) {
          const documentId = ids.get(source.id) ?? null;
          return {
            ...source,
            outcome: 'used',
            documentId,
            passageCount: documentId ? passagesOf(documentId) : 0,
            contentHash: item.document.provenance.sha256 ?? source.contentHash,
            warnings: [
              ...source.warnings.slice(0, Math.max(0, 8 - item.notes.length)),
              ...item.notes,
            ],
          };
        }
        const aside = verdicts.get(source.id);
        if (aside) {
          return {
            ...source,
            outcome: aside.outcome,
            passageCount: 0,
            warnings: [...source.warnings.slice(0, 7), aside.reason],
          };
        }
        return source;
      });
      const added = appended.documents.length;
      const next: ResearchRun = {
        ...current,
        stage: added > 0 ? 'checking-conflicts' : current.stage,
        sources,
        passages,
        updatedAt: at,
        events: [
          ...current.events,
          eventOf(
            at,
            'extracting-evidence',
            'info',
            added > 0
              ? `Kept ${plural(added, 'page')} as sources, indexed as ${plural(appended.chunks.length, 'passage')}.${
                  result.pages.length > added
                    ? ` ${plural(result.pages.length - added, 'page was', 'pages were')} read and not used.`
                    : ''
                }`
              : 'No page was kept as a source.',
          ),
        ],
      };
      return { appended, record: deps.store.save(this.projectId, next, recorder.stored) };
    });
    recorder.adopt(saved.record);
    this.chosen = selection.chosen;
    this.documents = saved.appended.documents.length;
    this.addedIds = new Set(saved.appended.documents.map((document) => document.id));

    const held = selection.setAside.filter((aside) => aside.outcome === 'duplicate').length;
    if (this.documents === 0 && held === 0) {
      return { status: 'blocked', stop };
    }
    return null;
  }

  // -- checking what was kept against itself -----------------------------------------------------

  private checking(): void {
    const { recorder, deps } = this;
    if (this.addedIds.size > 0) {
      this.progress(13);
      const found = detectContradictions(deps.repository.chunks(this.projectId), this.now());
      this.conflicts = found.filter(
        (conflict) =>
          this.addedIds.has(conflict.left.documentId) ||
          this.addedIds.has(conflict.right.documentId),
      ).length;
      // A ledger that was built before these sources were added learns of the conflicts they bring.
      deps.ledger.addFoundConflicts(this.projectId);
      recorder.update((run) => ({ ...run, conflictCount: this.conflicts }));
      recorder.event(
        this.conflicts > 0 ? 'warn' : 'info',
        this.conflicts > 0
          ? `Found ${plural(this.conflicts, 'possible conflict')} between sources. Each is a candidate for a person to review.`
          : 'Found no conflicts between the sources.',
      );
    }
  }

  // -- ending ------------------------------------------------------------------------------------

  private end(ending: Ending): void {
    if (this.ended) return;
    const { recorder, deps } = this;
    const at = this.now().toISOString();
    const completed = ending.status === 'completed';
    const run = recorder.update((current) => ({
      ...current,
      status: ending.status,
      stage: completed ? 'ready' : current.stage,
      stoppedBecause: ending.stop,
      finishedAt: at,
      events: [
        ...current.events,
        eventOf(
          at,
          completed ? 'ready' : current.stage,
          completed ? 'info' : 'warn',
          completed
            ? 'Research is finished.'
            : ending.status === 'cancelled'
              ? 'Research was stopped, and nothing had been read.'
              : 'Nothing could be used as a source.',
        ),
      ],
    }));
    // Only now is the run over: a write that failed above leaves it to `fail`.
    this.ended = true;
    this.telemetry(ending);
    deps.repository.audit.record({
      actor: 'system',
      action: 'research.ended',
      targetType: 'project',
      targetId: this.projectId,
      projectId: this.projectId,
      detail: {
        status: ending.status,
        mode: run.mode,
        stop: ending.stop ?? 'none',
        pages: run.used.pages,
        sources: this.documents,
        quarantined: run.used.quarantined,
        failures: run.used.failures,
        conflicts: this.conflicts,
        model: run.modelUsed,
      },
    });
    if (!completed) {
      this.note(
        `Research ended without a source. ${ending.stop ? RESEARCH_STOP_LABELS[ending.stop] : 'Nothing could be used.'}`,
      );
    } else if (this.documents === 0) {
      this.note('Research finished: the project already held the sources it found.');
    } else {
      this.note(
        `Research finished: ${plural(this.documents, 'source')} added from ${plural(run.used.pages, 'page')} read.`,
      );
    }
  }

  private telemetry(ending: Ending): void {
    const run = this.recorder.current;
    productSignals.researchRun({ outcome: ending.status, mode: run.mode, stopReason: ending.stop });
    const crawled = this.crawled;
    if (!crawled) return;
    productSignals.researchPages({ count: run.used.pages, mode: run.mode });
    productSignals.crawlDuration({
      durationMs: run.used.elapsedMs,
      mode: run.mode,
      stopReason: ending.stop,
    });
    const failures = new Map<FetchErrorClass, number>();
    for (const source of crawled.sources) {
      if (source.outcome === 'failed' && source.failure) {
        failures.set(source.failure.class, (failures.get(source.failure.class) ?? 0) + 1);
      }
      if (source.outcome === 'quarantined' && source.quarantine) {
        productSignals.quarantine(source.quarantine.reason);
        if (source.quarantine.reason === 'prompt-injection') {
          productSignals.safetyBlock('prompt-injection');
        }
      }
    }
    for (const [errorClass, count] of failures) productSignals.fetchFailure(errorClass, count);
    for (const [reason, count] of this.blocks) productSignals.safetyBlock(reason, count);
    const byCategory = new Map<ResearchSource['category'], number>();
    for (const item of this.chosen) {
      const category = run.sources.find((source) => source.id === item.sourceId)?.category;
      if (category) byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }
    for (const [category, count] of byCategory) productSignals.sourcesUsed(category, count);
    productSignals.evidencePassages(Object.keys(run.passages).length, run.mode);
  }

  /** Records how a run that did not finish ended, and says nothing that the error said. */
  private fail(error: unknown): void {
    if (this.ended) return;
    const { recorder } = this;
    const failure = publicFailure(error);
    // The job was handed to another worker: the run is theirs now, and nothing more is written to it.
    if (failure.code === 'LEASE_LOST' || failure.code === 'ARTIFACT_CONFLICT') return;
    this.ended = true;
    const at = this.now().toISOString();
    try {
      const run = recorder.current;
      if (failure.code === 'RUN_INTERRUPTED') {
        recorder.update((current) => ({
          ...current,
          status: 'queued',
          stage: 'planning',
          events: [
            ...current.events,
            eventOf(
              at,
              current.stage,
              'warn',
              'The server stopped during this run. It starts again when a worker is free.',
            ),
          ],
        }));
        return;
      }
      const cancelled = failure.code === 'RUN_CANCELLED';
      const status: ResearchStatus = cancelled ? 'cancelled' : 'failed';
      if (run.status !== status) {
        recorder.update((current) => ({
          ...current,
          status,
          stoppedBecause: cancelled ? 'cancelled' : current.stoppedBecause,
          finishedAt: at,
          events: [
            ...current.events,
            eventOf(
              at,
              current.stage,
              cancelled ? 'warn' : 'block',
              cancelled
                ? 'Research was cancelled.'
                : `Research stopped: ${error instanceof AppError ? failure.message : 'an internal error stopped it.'}`,
            ),
          ],
        }));
      }
      productSignals.researchRun({
        outcome: cancelled ? 'cancelled' : 'failed',
        mode: run.mode,
        stopReason: cancelled ? 'cancelled' : null,
      });
      this.deps.repository.audit.record({
        actor: 'system',
        action: 'research.ended',
        targetType: 'project',
        targetId: this.projectId,
        projectId: this.projectId,
        detail: {
          status,
          mode: run.mode,
          stop: cancelled ? 'cancelled' : 'none',
          pages: run.used.pages,
          sources: this.documents,
          error: cancelled ? null : failure.code,
        },
      });
    } catch {
      // Writing the end of a run that is ending badly must not hide what ended it.
    }
  }
}
