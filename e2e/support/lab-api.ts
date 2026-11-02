import { expect, type Locator, type Page } from '@playwright/test';
import type { Analysis } from '../../shared/analysis';
import type { BriefView } from '../../shared/brief';
import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../shared/example-scenarios';
import type { ActorsView, Stakeholder, StakeholdersView } from '../../shared/stakeholders';

// What the end-to-end specs need that is not about the page: the questions and evidence they ask with, the
// calls the page makes, what the product may not say, and projects made over HTTP up to a chosen stage, so that a
// spec about one screen does not have to walk through the ones before it. Nothing here knows a domain.

// ---------------------------------------------------------------------------------------------
// The packs
// ---------------------------------------------------------------------------------------------

/** A question, the evidence that comes with it, and what the person adds along the way. */
export interface Pack {
  /** The example's id, or `custom` for a question the person writes themselves. */
  id: string;
  title: string;
  question: string;
  /** The example the person picks. Absent for a question typed out. */
  example?: ExampleScenario;
  /** Evidence the person pastes. */
  pasted: { name: string; content: string }[];
  /** Public pages the person asks Swarm to fetch, as they type them. */
  urls: string[];
  /** What the question is about, which the scenario that is read from it must say. */
  about: RegExp;
  /** An alternative the person names when they read the scenario. */
  alternative: string;
  /** A group the person says is affected. */
  group: string;
  /** An intervention the person designs when they compare: how late and how strongly it lands. */
  intervention: { name: string; intensity: string; round: string };
}

const exampleById = (id: string): ExampleScenario => {
  const found = EXAMPLE_SCENARIOS.find((example) => example.id === id);
  if (!found) throw new Error(`There is no example "${id}" in shared/example-scenarios.ts.`);
  return found;
};

export const CITY_BRIEFING = {
  name: 'council-briefing.txt',
  content: `Illustrative synthetic briefing written for a test; the figures are invented and it describes no real city.

The city council is considering a congestion charge for private cars that enter the central zone on weekdays between seven in the morning and seven in the evening. Residents who live inside the zone would receive a discount, and the transport authority would run the cameras and collect the payments.

Commuters who drive to work in the zone say the charge would cost them more than a monthly bus pass. Shop owners on the main shopping street worry that customers will drive to the retail park outside the zone instead. Bus operators expect more passengers but say they have no spare vehicles at peak times. Delivery contractors ask whether vans will pay the full charge, and taxi operators ask for the same exemption that buses receive.

Disability advocates ask that drivers with a blue badge are exempt. An environmental campaign group supports the charge because it expects cleaner air near the schools. The finance committee of the council wants to know how much revenue the charge would bring in, but no estimate has been made. No survey has measured support, and these notes describe proposals, not observed outcomes.
`,
};

export const CITY_QUESTION =
  'What could happen if the city introduces a congestion charge for private cars entering the central zone on weekdays?';

export const PACKS = {
  teams: {
    id: 'copilot-in-teams',
    title: 'Copilot in Teams',
    question: exampleById('copilot-in-teams').question,
    example: exampleById('copilot-in-teams'),
    pasted: [],
    urls: [],
    about: /copilot/iu,
    alternative: 'Staged opt-in rollout',
    group: 'Tenant administrators',
    intervention: { name: 'Later and gentler start', intensity: '0.3', round: '4' },
  },
  aws: {
    id: 'regional-price-change',
    title: 'Regional cloud price change',
    question: exampleById('regional-price-change').question,
    example: exampleById('regional-price-change'),
    pasted: [],
    urls: [],
    about: /price/iu,
    alternative: 'Notice period before the increase',
    group: 'Finance leads',
    intervention: { name: 'Later and gentler start', intensity: '0.3', round: '4' },
  },
  shop: {
    id: 'ecommerce-experience',
    title: 'Online store: delivery and checkout',
    question: exampleById('ecommerce-experience').question,
    example: exampleById('ecommerce-experience'),
    pasted: [],
    urls: ['http://shop-sandbox.example.org/delivery-and-returns'],
    about: /delivery/iu,
    alternative: 'One flat delivery fee for every order',
    group: 'Returning shoppers',
    intervention: { name: 'Later and gentler start', intensity: '0.3', round: '4' },
  },
  city: {
    id: 'custom',
    title: 'City congestion charge',
    question: CITY_QUESTION,
    pasted: [CITY_BRIEFING],
    urls: ['http://city-transport.example.org/central-zone-pilot'],
    about: /congestion charge/iu,
    alternative: 'A charge only at the busiest hours',
    group: 'Drivers with a blue badge',
    intervention: { name: 'Later and gentler start', intensity: '0.3', round: '4' },
  },
} as const satisfies Record<string, Pack>;

/** A page the person fetched: what Swarm stored of it, as the server returned it. */
export interface FetchedPage {
  name: string;
  content: string;
  provenance: { kind: string; url?: string; fetchedByServer?: boolean };
}

// ---------------------------------------------------------------------------------------------
// The calls the page makes
// ---------------------------------------------------------------------------------------------

export interface ApiCall {
  method: string;
  /** The path with every id replaced, so that two projects' calls look alike. */
  shape: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;

/** Records the calls the page makes to the application, in order, from now on. */
export function recordApi(page: Page): ApiCall[] {
  const calls: ApiCall[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) {
      calls.push({
        method: request.method(),
        shape: pathname
          .replace(UUID, ':id')
          .replace(/\/critiques\/[^/]+\//u, '/critiques/:critique/'),
      });
    }
  });
  return calls;
}

const EVIDENCE_URL = '/api/evidence/url';

/**
 * What the person asked the application to do, in order: every call that is not a read. Where a page
 * comes from is the person's choice of evidence, not a step of the pipeline, so reading one is left out.
 */
export function pipelineCalls(calls: readonly ApiCall[]): string[] {
  return calls
    .filter((call) => call.method !== 'GET' && call.shape !== EVIDENCE_URL)
    .map((call) => `${call.method} ${call.shape}`);
}

/** Every kind of call the page made, once each and in a fixed order: polling repeats, and adds nothing. */
export function kindsOfCall(calls: readonly ApiCall[]): string[] {
  const seen = new Set<string>();
  for (const call of calls) {
    if (call.shape !== EVIDENCE_URL) seen.add(`${call.method} ${call.shape}`);
  }
  return [...seen].sort();
}

export const readPages = (calls: readonly ApiCall[]): number =>
  calls.filter((call) => call.method === 'POST' && call.shape === EVIDENCE_URL).length;

// ---------------------------------------------------------------------------------------------
// What the product may not say
// ---------------------------------------------------------------------------------------------

export { claimsAgainst } from './claims';

/** The words of a text with every kind of space and of quotation mark made alike, for comparing quotes. */
export const squash = (text: string): string =>
  text
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

/** Whether a quote is, word for word, in one of the documents. */
export const isQuotedFrom = (quote: string, documents: readonly { content: string }[]): boolean => {
  const wanted = squash(quote);
  return (
    wanted.length > 0 && documents.some((document) => squash(document.content).includes(wanted))
  );
};

// ---------------------------------------------------------------------------------------------
// The text of the page, element by element
// ---------------------------------------------------------------------------------------------

/** The text of each element, one by one, so that a claim is judged in the sentence that makes it. */
export const textsOf = (scope: Locator): Promise<string[]> =>
  scope.evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? '').replace(/\s+/gu, ' ').trim()),
  );

// ---------------------------------------------------------------------------------------------
// Projects made over HTTP
// ---------------------------------------------------------------------------------------------

export async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.ok(), `${path}: ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

export const liveStakeholders = (view: StakeholdersView): Stakeholder[] =>
  (view.stakeholders?.stakeholders ?? []).filter((stakeholder) => stakeholder.status !== 'removed');

export const stakeholdersOf = (page: Page, project: string): Promise<StakeholdersView> =>
  getJson<StakeholdersView>(page, `/api/projects/${project}/stakeholders`);
export const actorsOf = (page: Page, project: string): Promise<ActorsView> =>
  getJson<ActorsView>(page, `/api/projects/${project}/actors`);

export const analysisOf = async (page: Page, project: string): Promise<Analysis> => {
  const list = await getJson<{ analyses: { id: string; status: string }[] }>(
    page,
    `/api/projects/${project}/analysis`,
  );
  const done = list.analyses.find((analysis) => analysis.status === 'completed');
  if (!done) throw new Error('The project has no finished comparison.');
  return (
    await getJson<{ analysis: Analysis }>(page, `/api/projects/${project}/analysis/${done.id}`)
  ).analysis;
};

export const briefOf = (page: Page, project: string): Promise<BriefView> =>
  getJson<BriefView>(page, `/api/projects/${project}/brief`);

interface Seed {
  title: string;
  question: string;
  documents: { name: string; content: string }[];
}

/** Makes a project the way the pages do, up to the approved stakeholders and their actors, over HTTP. */
export async function seedThroughActors(page: Page, seed: Seed): Promise<string> {
  const settings = { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' };
  const created = await page.request.post('/api/projects', {
    data: {
      name: seed.title,
      question: seed.question,
      workflow: 'guided',
      documents: seed.documents,
      settings,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await page.request.post(`/api/projects/${id}/steps/knowledge`)).status()).toBe(202);
  await expect
    .poll(
      async () =>
        (await getJson<{ console: { steps: Record<string, string> } }>(page, `/api/projects/${id}`))
          .console.steps.knowledge,
      { timeout: 30_000 },
    )
    .toBe('ready');
  const found = await page.request.post(`/api/projects/${id}/stakeholders/discover`, {
    data: { mode: 'rules' },
  });
  expect(found.status(), await found.text()).toBe(201);
  const { revision } = (await found.json()) as { revision: number };
  const approved = await page.request.post(`/api/projects/${id}/stakeholders/approve`, {
    data: { expectedRevision: revision },
  });
  expect(approved.status(), await approved.text()).toBe(200);
  const made = await page.request.post(`/api/projects/${id}/actors/generate`, { data: {} });
  expect(made.status(), await made.text()).toBe(201);
  return id;
}

/** Takes a project on from its actors to a finished comparison, an independent review and the brief, over HTTP. */
export async function seedThroughBrief(page: Page, seed: Seed): Promise<string> {
  const id = await seedThroughActors(page, seed);
  const started = await page.request.post(`/api/projects/${id}/analysis`, { data: {} });
  expect(started.status(), await started.text()).toBe(202);
  await expect
    .poll(
      async () =>
        (
          await getJson<{ analyses: { status: string }[] }>(page, `/api/projects/${id}/analysis`)
        ).analyses.map((analysis) => analysis.status),
      { timeout: 90_000 },
    )
    .toContain('completed');
  const reviewed = await page.request.post(`/api/projects/${id}/critiques/run`, { data: {} });
  expect(reviewed.ok(), await reviewed.text()).toBe(true);
  const written = await page.request.post(`/api/projects/${id}/brief`, { data: {} });
  expect(written.status(), await written.text()).toBe(201);
  return id;
}

/**
 * Makes a project the way the pages do, up to a finished comparison and its decision brief, over HTTP,
 * and runs the independent review when asked: the decision scene then has everything to show.
 */
export async function seedWithBrief(
  page: Page,
  seed: Seed,
  options: { review?: boolean } = {},
): Promise<string> {
  const id = await seedThroughActors(page, seed);
  const started = await page.request.post(`/api/projects/${id}/analysis`, {
    data: { runsPerVariant: 10 },
  });
  expect(started.status(), await started.text()).toBe(202);
  const { analysis } = (await started.json()) as { analysis: { id: string } };
  await expect
    .poll(
      async () =>
        (
          await getJson<{ analysis: { status: string } }>(
            page,
            `/api/projects/${id}/analysis/${analysis.id}`,
          )
        ).analysis.status,
      { timeout: 120_000, intervals: [100, 250, 500] },
    )
    .toBe('completed');
  const brief = await page.request.post(`/api/projects/${id}/brief`, { data: {} });
  expect(brief.ok(), await brief.text()).toBe(true);
  if (options.review) {
    const review = await page.request.post(`/api/projects/${id}/critiques/run`, {
      data: { useModel: false },
    });
    expect(review.ok(), await review.text()).toBe(true);
  }
  return id;
}
