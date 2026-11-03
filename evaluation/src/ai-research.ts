import { Repository } from '../../backend/src/storage/repository.js';
import { FLAG_LABEL } from '../../backend/src/research/extract/index.js';
import { ResearchService, type JobsPort } from '../../backend/src/research/service.js';
import type { ModelFactory } from '../../backend/src/models/factory.js';
import { createModelFactory } from '../../backend/src/models/factory.js';
import { ProviderTelemetry } from '../../backend/src/models/telemetry.js';
import { testConfig } from '../../backend/test/fixtures.js';
import type { ServerConfig } from '../../backend/src/config.js';
import type { ResearchBudget, ResearchRun } from '../../shared/research.js';
import { createProjectSchema } from '../../shared/types.js';
import { loadSites, type SiteSet } from './ai-datasets.js';
import { startFakeWorld, type FakeWorld } from './ai-fake.js';
import { startSiteWorld, warpedClock, type SiteWorld } from './ai-fixtures.js';
import { cleanPlanReply, corrupt } from './ai-plan.js';
import { expandWorlds } from './ai-runworld.js';
import { loadPlans, loadRunsFile, type RunCase, type RunsFile } from './ai-suite-data.js';
import type { Split } from './datasets.js';
import { costUsd, type Prices } from './measure-usage.js';
import {
  checkArm,
  checkRun,
  diversityOf,
  sourceFor,
  type DocumentView,
  type RunChecks,
  type RunView,
  type SourceView,
} from './measure-run.js';
import {
  scoreInjectionLabelling,
  type InjectedPage,
  type InjectionScores,
} from './measure-sources.js';

/**
 * Whole research runs through the real service: the planner, the crawler and the extractor, the
 * assessor that says when there is enough, and the selection of the pages that become documents of
 * a project, over the fixture web. Time is the warped clock of the first phase: waiting is skipped
 * and the clock still moves, so a run reaches a time limit and costs milliseconds. Rules mode is a
 * project whose person did not choose a model; model mode is one that did, planned by the in-process
 * fake of the Foundry endpoint, whose replies are scripted from the labels.
 */

const STUB_JOBS: JobsPort = {
  enqueueStep: () => undefined,
  cancel: () => undefined,
  isBusy: () => false,
};

export interface ModelUse {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Priced by the harness at the list price of the registered deployment. */
  costUsd: number;
  /** The budget the run was given, in US dollars. */
  budgetUsd: number;
  /** What the product estimated and recorded on the run. */
  estimatedUsd: number;
}

export interface RunObservation {
  caseId: string;
  /** A budget arm of the case, or null. */
  arm: string | null;
  split: Split;
  mode: 'rules' | 'model';
  case: RunCase;
  view: RunView;
  checks: RunChecks;
  injected: InjectionScores | null;
  /** The sites the documents of the run come from and the largest share of its passages that one holds, for every run. */
  spread: { domains: number; maxShare: number };
  model: ModelUse | null;
  budget: ResearchBudget;
  elapsedMs: number;
  /** Set when the run could not be carried out at all; it is also recorded as a failed check. */
  error: string | null;
}

export interface ResearchObservation {
  runs: RunObservation[];
  /** What the fake Foundry found wrong in anything it was scripted to say or sent. */
  fakeProblems: string[];
}

/** How long a run is given in real time: the clock is warped, so a run that takes this long is stuck. */
const PATIENCE_MS = 120_000;

export interface ResearchOptions {
  /** Run only these cases, by id. */
  cases?: readonly string[];
  /** Leave out the runs of a project that did not choose a model (default: they are run). */
  rules?: boolean;
  /** Leave out the runs planned by the scripted model, and the fake that serves it (default: they are run). */
  models?: boolean;
  /** Time moves this many times faster than the wall clock whenever a run waits. */
  warp?: number;
}

const sourceViewOf = (source: ResearchRun['sources'][number]): SourceView => ({
  id: source.id,
  requestedUrl: source.requestedUrl,
  finalUrl: source.finalUrl,
  outcome: source.outcome,
  quarantine: source.quarantine?.reason ?? null,
  failure: source.failure?.class ?? null,
  category: source.category,
  authority: source.authority,
  documentId: source.documentId,
  contentHash: source.contentHash,
  note: source.warnings.at(-1) ?? '',
});

const withTimeout = async <T>(work: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Runs the cases of the dataset through the service, one project each. */
export async function observeRuns(options: ResearchOptions = {}): Promise<ResearchObservation> {
  const file = loadRunsFile();
  const sites = loadSites();
  const siteSet: SiteSet = {
    ...sites,
    hosts: { ...sites.hosts, ...file.hosts },
    pages: [...sites.pages, ...expandWorlds(file)],
  };
  const wanted = file.cases.filter(
    (item) =>
      (options.cases === undefined || options.cases.includes(item.id)) &&
      (item.mode === 'rules' ? options.rules !== false : options.models !== false),
  );
  const world = await startSiteWorld(siteSet);
  const fake = wanted.some((item) => item.mode === 'model')
    ? await startFakeWorld({
        prices: true,
        environment: { RESEARCH_DOMAIN_DELAY_MS: '250' },
      })
    : null;
  try {
    return await carryOut(file, wanted, siteSet, world, fake, options);
  } finally {
    await world.close();
    await fake?.close();
  }
}

async function carryOut(
  file: RunsFile,
  wanted: readonly RunCase[],
  sites: SiteSet,
  world: SiteWorld,
  fake: FakeWorld | null,
  options: ResearchOptions,
): Promise<ResearchObservation> {
  const repository = new Repository(':memory:');
  const clock = warpedClock(options.warp ?? 25);
  const rulesConfig = testConfig({ RESEARCH_DOMAIN_DELAY_MS: '250' });
  const plans = loadPlans();
  const prices: Prices = { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 };
  const port = new URL(world.urlOf(sites.pages[0]!.id)).port;
  const idleFactory: ModelFactory = createModelFactory(
    rulesConfig,
    new ProviderTelemetry(rulesConfig.provider),
  );

  const services = new Map<string, ResearchService>();
  const serviceFor = (
    config: ServerConfig,
    factory: ModelFactory,
    tuning: Record<string, number> | undefined,
    key: string,
  ): ResearchService => {
    const found = services.get(key);
    if (found) return found;
    const created = new ResearchService({
      repository,
      config,
      createModel: factory,
      jobs: STUB_JOBS,
      fetcher: world.fetcher,
      allowHttp: true,
      crawl: {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0.5,
        extractLimits: { sliceMs: Number.POSITIVE_INFINITY, maxParseMs: Number.POSITIVE_INFINITY },
        ...(tuning ? { tuning } : {}),
      },
      now: clock.now,
    });
    services.set(key, created);
    return created;
  };

  const textOf = (key: string | undefined): string | undefined =>
    key === undefined ? undefined : file.questions[key]?.replaceAll('{{port}}', port);
  const address = (start: string): string =>
    start.startsWith('http') ? start : world.urlOf(start);
  const observations: RunObservation[] = [];

  const modelWorld = (): FakeWorld => {
    if (!fake) throw new Error('A run planned by a model needs the fake Foundry.');
    return fake;
  };

  const one = async (
    item: RunCase,
    arm: NonNullable<RunCase['budgetArms']>[number] | null,
  ): Promise<RunObservation> => {
    const model = item.mode === 'model';
    const config = model ? modelWorld().config : rulesConfig;
    const service = serviceFor(
      config,
      model ? modelWorld().factory : idleFactory,
      item.tuning,
      `${model ? 'model' : 'rules'}:${JSON.stringify(item.tuning ?? {})}`,
    );
    const question = textOf(item.question) ?? item.question;
    const guidance = textOf(item.guidance);
    const budget = { perDomainDelayMs: 250, ...item.budget, ...arm?.budget };
    const project = repository.create(
      createProjectSchema.parse({
        name: `Run ${item.id}${arm ? ` ${arm.id}` : ''}`,
        question,
        workflow: 'guided',
        documents: [],
        research: { auto: true },
        settings: {
          mode: model ? 'llm' : 'local',
          agentCount: 6,
          rounds: 4,
          seed: 42,
          network: 'community',
        },
      }),
    );
    if (model && item.model) {
      const base = cleanPlanReply(plans.cases.find((entry) => entry.id === item.model!.base)!) as {
        likelySources: { suggestedDomain?: string }[];
      };
      if (item.model.suggest) base.likelySources[0]!.suggestedDomain = item.model.suggest;
      modelWorld().fake.reset();
      if (item.model.corrupt) {
        const planted = corrupt(item.model.corrupt, base, { markers: [], bait: null });
        modelWorld().fake.respond(() => planted.step);
      } else {
        modelWorld().fake.script({ kind: 'reply', value: base });
      }
    }
    const before = world.requests.length;
    const started = performance.now();
    let error: string | null = null;
    try {
      const intake = {
        ...(item.start ? { url: address(item.start) } : {}),
        ...(guidance ? { guidance } : {}),
      };
      service.start(project.id, { intake, budget }, 'evaluation');
      await withTimeout(
        service.beforeKnowledge(project.id, new AbortController().signal),
        PATIENCE_MS,
        `The run ${item.id}`,
      );
      for (const add of item.adds ?? []) {
        service.addSource(project.id, address(add), { budget }, 'evaluation');
        await withTimeout(
          service.beforeKnowledge(project.id, new AbortController().signal),
          PATIENCE_MS,
          `The addition of ${add} to ${item.id}`,
        );
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const elapsedMs = performance.now() - started;

    const keys = repository.artifacts.keys(project.id, 'research');
    const runs = keys
      .map((key) => service.store.get(project.id, key)?.data)
      .filter((run): run is ResearchRun => run !== undefined)
      .reverse();
    const last = runs[runs.length - 1];
    const documents = repository.get(project.id).documents;
    const chunks = repository.chunks(project.id);
    const documentViews: DocumentView[] = documents.map((document) => ({
      id: document.id,
      address: document.provenance?.url ?? null,
      text: document.content,
      sha256: document.provenance?.sha256 ?? null,
      passages: chunks.filter((chunk) => chunk.documentId === document.id).length,
    }));
    const view: RunView = {
      caseId: item.id,
      status: last?.status ?? 'none',
      stop: last?.stoppedBecause ?? null,
      used: {
        pages: last?.used.pages ?? 0,
        domains: last?.used.domains ?? 0,
        bytes: last?.used.bytes ?? 0,
        failures: last?.used.failures ?? 0,
        duplicates: last?.used.duplicates ?? 0,
      },
      sources: runs.flatMap((run) => run.sources.map(sourceViewOf)),
      documents: documentViews,
      heldBefore: 0,
      passageSourceIds: runs.flatMap((run) =>
        Object.values(run.passages).map((passage) => passage.sourceId),
      ),
      planOrigin: last?.plan?.origin ?? null,
      suggested: (last?.plan?.likelySources ?? []).flatMap((source) =>
        source.suggestedDomain ? [source.suggestedDomain] : [],
      ),
      requests: world.requests.slice(before).map((request) => ({ ...request })),
    };
    const checks = checkRun(item.id, item.gold, view, world);
    if (error) checks.checks.push({ name: 'carried out', ok: false, detail: error });

    let injected: InjectionScores | null = null;
    if (item.gold.injectionLinesLabelled && item.start) {
      const group = sites.pages.find((entry) => entry.id === item.start)?.group;
      const pages: InjectedPage[] = sites.pages
        .filter((entry) => entry.group === group && entry.gold.injection !== null)
        .map((entry) => {
          const source = sourceFor(view.sources, world.urlOf(entry.id));
          const document =
            source?.outcome === 'used'
              ? documentViews.find((candidate) => candidate.id === source.documentId)
              : undefined;
          return {
            id: entry.id,
            expected: entry.gold.injection!.expected,
            lines: entry.gold.injection!.lines,
            text: document?.text ?? null,
          };
        });
      injected = scoreInjectionLabelling(pages, FLAG_LABEL);
    }

    let used: ModelUse | null = null;
    if (model) {
      const usage = repository.usage.get(project.id);
      used = {
        calls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: costUsd(usage.inputTokens, usage.outputTokens, prices),
        budgetUsd: last?.budget.maxEstimatedCostUsd ?? 0,
        estimatedUsd: last?.used.estimatedCostUsd ?? 0,
      };
      modelWorld().problems.push(...modelWorld().fake.problems);
      if (arm) checks.checks.push(...checkArm(arm.gold, view, used));
    }
    return {
      caseId: item.id,
      arm: arm?.id ?? null,
      split: item.split,
      mode: item.mode,
      case: item,
      view,
      checks,
      spread: diversityOf(view),
      injected,
      model: used,
      budget: last?.budget as ResearchBudget,
      elapsedMs,
      error,
    };
  };

  for (const item of wanted) {
    if (item.budgetArms) {
      for (const arm of item.budgetArms) observations.push(await one(item, arm));
    } else {
      observations.push(await one(item, null));
    }
  }
  return { runs: observations, fakeProblems: fake ? [...fake.problems] : [] };
}
