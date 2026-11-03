import { afterEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { ModelFactory } from '../../src/models/factory.js';
import type { SearchProvider } from '../../src/research/discovery.js';
import type { ResearchSeam } from '../../src/research/service.js';
import { testConfig } from '../fixtures.js';
import { QUESTION, harbourWeb } from './research-web.js';
import { drive, FakeNetwork, VirtualClock, type Route } from './research-world.js';

export * from './research-web.js';

export interface ResearchAppOptions {
  web?: Record<string, Route>;
  environment?: Record<string, string>;
  seam?: ResearchSeam;
  search?: SearchProvider;
  modelFactory?: ModelFactory;
  /** More of what `buildApp` takes. */
  app?: Partial<Parameters<typeof buildApp>[0]>;
}

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

/**
 * The application with research reading a web of fake pages on a virtual clock: the real crawler, the
 * real extractor, the real job queue and storage, and nothing that touches a network. Time moves only
 * when `settle` lets it, so a run does the same things at the same moments on any machine.
 */
export async function researchApp(options: ResearchAppOptions = {}) {
  const clock = new VirtualClock();
  const network = new FakeNetwork(clock, options.web ?? harbourWeb());
  const instance = await buildApp({
    config: testConfig({ RESEARCH_DOMAIN_DELAY_MS: '250', ...options.environment }),
    jobs: { timers: false },
    ...(options.modelFactory ? { modelFactory: options.modelFactory } : {}),
    research: {
      fetcher: network,
      now: clock.now,
      crawl: {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0.5,
        extractLimits: { sliceMs: Number.POSITIVE_INFINITY, maxParseMs: Number.POSITIVE_INFINITY },
      },
      ...(options.search ? { search: options.search } : {}),
      ...options.seam,
    },
    ...options.app,
  });
  applications.push(instance);

  /** Lets the queue work until nothing is left to do, moving virtual time when everything waits. */
  const settle = () => drive(clock, instance.jobs.idle());

  /**
   * Lets the queue work, moving virtual time, until `until` holds, and no longer: the job goes on
   * where it is, for a test that has to act in the middle of a run.
   */
  const runUntil = async (until: () => boolean): Promise<void> => {
    const work = instance.jobs.idle();
    let over = false;
    void work.then(
      () => (over = true),
      () => (over = true),
    );
    let quiet = 0;
    while (!over && !until()) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (clock.tick()) quiet = 0;
      else if ((quiet += 1) > 300)
        throw new Error('The run is waiting for something that never comes.');
    }
  };

  /** Lets the event loop turn, and time pass, a number of times: for a test that holds a run still and watches it stay so. */
  const turns = async (count: number): Promise<void> => {
    for (let turn = 0; turn < count; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      clock.tick();
    }
  };

  /** The newest run of a project, as stored. */
  const run = (id: string) => instance.research.store.latest(id)?.data ?? null;

  /** What the audit log of a project says happened, in order, by action. */
  const actions = (id: string): string[] =>
    instance.repository.audit.list({ projectId: id, limit: 500 }).map((entry) => entry.action);

  /** A project made from a question alone, as the Ask scene makes it. */
  const create = async (
    question = QUESTION,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        name: 'Berthing fees',
        question,
        workflow: 'guided',
        documents: [],
        research: { auto: true },
        settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
        ...extra,
      },
    });
    if (response.statusCode !== 201) throw new Error(`Not created: ${response.body}`);
    return (response.json() as { id: string }).id;
  };

  const post = (
    id: string,
    path: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    instance.app.inject({
      method: 'POST',
      url: `/api/projects/${id}/research${path}`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const view = async (id: string) =>
    (await instance.app.inject({ url: `/api/projects/${id}/research` })).json() as ReturnType<
      typeof instance.research.view
    >;

  return { ...instance, clock, network, settle, runUntil, turns, run, actions, create, post, view };
}

export type ResearchApp = Awaited<ReturnType<typeof researchApp>>;
