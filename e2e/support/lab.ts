import { expect, type Locator, type Page, type Response } from '@playwright/test';
import type { Analysis } from '../../shared/analysis';
import type { BriefView } from '../../shared/brief';
import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../shared/example-scenarios';
import type { ActorsView, Stakeholder, StakeholdersView } from '../../shared/stakeholders';

// What the examples spec does with the page, in the words a person would use, and what it checks
// against the product's rules. Nothing here knows a domain: a question, some evidence and the names of
// the controls are all there is, and the same code serves every pack.

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

const QUOTED = /“[^”]*”|"[^"]*"|‘[^’]*’/gu;
const FUTURE =
  /\b(?:will|shall|going to|(?:is|are) (?:certain|sure|bound|set|likely|expected|projected|forecast|predicted|guaranteed) to|would certainly|inevitabl[ey])\b/iu;
const REAL_WORLD_RATE = /\d(?:[.,]\d+)?\s?(?:%|per ?cent\b)/iu;
const REAL_WORLD_METRIC =
  /\b(?:market share|conversion(?: rate)?|churn(?: rate)?|retention rate|adoption rate|revenue (?:growth|increase)|sales (?:growth|increase))\b/iu;
const FROM_THE_SIMULATION =
  /simulat|seeded|\bruns?\b|interval|assum|synthetic|stance|rules? engine|sensitiv|perturb|intensity|traits?\b/iu;

/**
 * What a statement may not claim. Swarm explores scenarios and does not predict: it never says what
 * will happen, and a figure that looks like a rate in the world (a share, a conversion, a churn) is
 * only ever a count of simulated members or of seeded runs, and says so in the same sentence. What a
 * source or the person wrote is quoted, and is theirs.
 */
export function claimsAgainst(text: string): string[] {
  const found: string[] = [];
  const own = text.replace(QUOTED, ' ');
  for (const sentence of own.split(/(?<=[.!?])\s+/u)) {
    const said = sentence.trim();
    if (!said) continue;
    if (FUTURE.test(said)) found.push(`a prediction: "${said}"`);
    const rate = REAL_WORLD_RATE.test(said) || REAL_WORLD_METRIC.test(said);
    if (rate && !FROM_THE_SIMULATION.test(said)) {
      found.push(`a real-world rate that is not attributed to the simulation: "${said}"`);
    }
  }
  return found;
}

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
// The first screen
// ---------------------------------------------------------------------------------------------

export const questionField = (page: Page): Locator => page.getByLabel('Your what-if question');
export const examplePicker = (page: Page): Locator =>
  page.getByRole('region', { name: 'Not sure what to ask? Try an example' });
export const sourceMaterial = (page: Page): Locator =>
  page.getByRole('region', { name: 'Source material' });
export const scenarioIntake = (page: Page): Locator =>
  page.getByRole('region', { name: 'Scenario', exact: true });
export const urlPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Add a public web page' });

export async function chooseExample(page: Page, example: ExampleScenario): Promise<void> {
  const picker = examplePicker(page);
  // Once an example has been loaded the cards give way to a line, and "Change example" brings them back.
  const change = picker.getByRole('button', { name: 'Change example' });
  if (await change.count()) await change.click();
  await picker.getByRole('button', { name: `Use this example: ${example.title}` }).click();
  await expect(questionField(page)).toHaveValue(example.question);
  await expect(
    page.getByRole('status').filter({ hasText: `Example loaded: ${example.title}` }),
  ).toBeVisible();
  for (const document of example.documents) {
    await expect(sourceMaterial(page).getByText(document.name, { exact: true })).toBeVisible();
  }
}

export async function pasteSource(page: Page, name: string, content: string): Promise<void> {
  const source = sourceMaterial(page);
  const paste = source.locator('details.paste-source');
  if (!(await paste.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await paste.getByText('Or paste a source document').click();
  }
  await source.getByLabel('Source filename').fill(name);
  await source.getByLabel(/^Source text/u).fill(content);
  await source.getByRole('button', { name: 'Attach pasted source' }).click();
  await expect(source.getByText(name, { exact: true })).toBeVisible();
}

/** Types an address into "Add a public web page" and asks for it. Resolves with the server's answer. */
export async function fetchPage(page: Page, address: string): Promise<Response> {
  const panel = urlPanel(page);
  await panel.getByLabel('Web address').fill(address);
  const [answer] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === EVIDENCE_URL),
    panel.getByRole('button', { name: 'Fetch page' }).click(),
  ]);
  return answer;
}

/** Keeps the page that was fetched as evidence, and says what Swarm stored of it. */
export async function addFetchedPage(page: Page, answer: Response): Promise<FetchedPage> {
  const { document } = (await answer.json()) as { document: FetchedPage };
  const panel = urlPanel(page);
  const preview = panel.getByRole('article', { name: 'The fetched page' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Swarm has not checked that it is true');
  await preview.getByRole('button', { name: 'Add as evidence' }).click();
  await expect(preview).toBeHidden();
  const added = sourceMaterial(page)
    .locator('details.source-file')
    .filter({ hasText: document.name });
  await expect(added).toHaveCount(1);
  await expect(added).toContainText('public web page');
  return document;
}

export interface ScenarioEdits {
  period: string;
  alternative: string;
  group: string;
  /** The person's answer to "What would count as a good outcome?", which the reading asks of every question that does not say. */
  success: string;
}

/** Reads the question into a scenario, edits what came back, and uses it. Resolves with the decision it states. */
export async function readScenario(page: Page, edits: ScenarioEdits): Promise<string> {
  const intake = scenarioIntake(page);
  await intake.getByRole('button', { name: 'Understand my question' }).click();
  const review = intake.locator('.intake-review');
  await expect(review.getByRole('heading', { name: 'Check and edit the scenario' })).toBeVisible();
  await expect(review).toContainText('Read by rules, not a model');
  const decision = await review.getByLabel(/^Decision or event/u).inputValue();

  // One of the things the question left open is answered where it is asked, and the question goes.
  const asked = 'What would count as a good outcome?';
  const open = review.locator('.intake-question').filter({ hasText: asked });
  await open.getByLabel(asked).fill(edits.success);
  await open.getByRole('button', { name: 'Apply my answer' }).click();
  await expect(open).toHaveCount(0);

  await review.getByLabel('Over what period (optional)').fill(edits.period);
  await review.getByRole('button', { name: 'Add an alternative' }).click();
  await review
    .getByRole('group', { name: /^Alternative \d+$/u })
    .last()
    .getByLabel('Name', { exact: true })
    .fill(edits.alternative);
  await review.getByRole('button', { name: 'Add a group' }).click();
  await review
    .getByLabel(/^Group \d+$/u)
    .last()
    .fill(edits.group);
  await review.getByRole('button', { name: 'Use this scenario' }).click();

  const summary = intake.locator('.intake-summary');
  await expect(summary.getByRole('heading', { name: 'This scenario will be used' })).toBeVisible();
  await expect(summary).toContainText('Edited by you');
  await expect(summary).toContainText(`Period: ${edits.period}`);
  return decision;
}

/** Builds the graph, and resolves with the id of the project it made once the stage is ready. */
export async function build(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
  await page.waitForURL(/[?&]project=/u);
  await expect(stages(page).getByRole('button', { name: /Graph Build ready/u })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('project');
  if (!id) throw new Error('The page did not say which project it opened.');
  return id;
}

// ---------------------------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------------------------

export const stages = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Guided workflow steps' });
export const openStage = (page: Page, stage: RegExp): Promise<void> =>
  // Anchored: a locked stage names the one to finish first in its description, so the name of another
  // stage can appear further along in a button's accessible name.
  stages(page)
    .getByRole('button', { name: new RegExp(`^${stage.source}`, stage.flags) })
    .click();
export const stakeholderPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Stakeholders and actors', exact: true });
export const comparisonPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Compare scenarios', exact: true });
export const reviewPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Independent review', exact: true });
export const briefDocument = (page: Page): Locator =>
  page.getByRole('article', { name: 'Decision brief' });

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

export async function findStakeholders(page: Page): Promise<void> {
  const panel = stakeholderPanel(page);
  await panel.getByRole('button', { name: 'Find stakeholders by reading the text' }).click();
  await expect(panel.getByText(/\d+ stakeholders? \(\d+ key\)/u)).toBeVisible();
}

/** Opens the list of stakeholders or the list of actors, which the panel keeps shut until it is asked. */
export async function openRegion(page: Page, region: 'Stakeholders' | 'Actors'): Promise<void> {
  const toggle = stakeholderPanel(page).getByRole('button', {
    name: new RegExp(`^${region} \\d+$`, 'u'),
    expanded: false,
  });
  if (await toggle.count()) await toggle.click();
}

/** A stakeholder's row, opened: its evidence, its assumptions and what can be done to it are inside. */
export async function openStakeholder(page: Page, name: string): Promise<Locator> {
  await openRegion(page, 'Stakeholders');
  const row = stakeholderPanel(page).getByRole('listitem', { name, exact: true });
  const closed = row.getByRole('button', { name, exact: true, expanded: false });
  if (await closed.count()) await closed.click();
  return row;
}

export async function editStakeholder(
  page: Page,
  name: string,
  change: { why: string; direction: 'harmed' | 'benefited' | 'mixed'; because: string },
): Promise<void> {
  const panel = stakeholderPanel(page);
  const row = await openStakeholder(page, name);
  await row.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  const form = panel.getByRole('form', { name: `Edit ${name}` });
  await form.getByLabel('Why they matter here').fill(change.why);
  await form.getByLabel('How the change lands on them').selectOption(change.direction);
  await form.getByLabel('Why you think so').fill(change.because);
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(form).toBeHidden();
  await expect(row.getByText(change.why).first()).toBeVisible();
}

export async function approveAndMakeActors(page: Page): Promise<void> {
  const panel = stakeholderPanel(page);
  await panel.getByRole('button', { name: 'Approve stakeholders and create actors' }).click();
  await expect(panel.getByRole('list', { name: 'Summary of the stakeholders' })).toContainText(
    /\d+ approved/u,
  );
  await panel.getByRole('button', { name: /^Review the \d+ actors$/u }).click();
  await expect(panel.getByRole('region', { name: 'Actors' })).toBeVisible();
}

export interface Comparison {
  runs: '10' | '30' | '100';
  intervention: Pack['intervention'];
}

/** Sets up the comparison: more runs or fewer, and an intervention of the person's own. Then runs it. */
export async function compareScenarios(page: Page, options: Comparison): Promise<void> {
  const panel = comparisonPanel(page);
  const scenarios = panel.getByRole('list', { name: 'Scenarios to compare' }).getByRole('listitem');
  await panel.getByLabel('Seeded runs of each scenario').selectOption(options.runs);
  const before = await scenarios.count();
  await panel.getByRole('button', { name: 'Add an alternative' }).click();
  await expect(scenarios).toHaveCount(before + 1);
  const added = scenarios.last();
  await added.getByLabel('Name', { exact: true }).fill(options.intervention.name);
  await added.getByLabel('How strongly it lands (0 to 1)').fill(options.intervention.intensity);
  await added.getByLabel(/^Starts in round/u).fill(options.intervention.round);
  await panel.getByRole('button', { name: 'Compare scenarios', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'What this comparison says' })).toBeVisible({
    timeout: 90_000,
  });
}

/**
 * Opens the decision brief from the comparison. The comparison finishing should unlock the Report stage
 * by itself; where the page has not noticed within a few seconds, the person's own way of reading the
 * project again is used, and this says so, so that the journey still goes on and the bug is not lost.
 */
/** The workspace follows the lab on its own: a finished comparison opens the way to the brief without a reload. */
export async function openReport(page: Page): Promise<void> {
  const next = page.getByRole('button', { name: 'See the decision brief' });
  await next.waitFor({ state: 'visible', timeout: 12_000 });
  await next.click();
  await expect(reviewPanel(page)).toBeVisible();
}

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

/**
 * Opens every section of the decision brief. The answer is open when the page opens and the reference
 * sections are closed until they are wanted, so a check that reads or clicks inside one asks for them first.
 */
export async function expandBrief(page: Page): Promise<void> {
  await briefDocument(page).getByRole('button', { name: 'Expand all sections' }).click();
  await expect(briefDocument(page).locator('details.brief-collapse:not([open])')).toHaveCount(0);
}

/** Makes a project the way the pages do, up to the approved stakeholders and their actors, over HTTP. */
export async function seedThroughActors(
  page: Page,
  seed: { title: string; question: string; documents: { name: string; content: string }[] },
): Promise<string> {
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

/**
 * Makes a project the way the pages do, up to a finished comparison and its decision brief, over HTTP,
 * and runs the independent review when asked: the Report stage then has everything to show.
 */
export async function seedWithBrief(
  page: Page,
  seed: { title: string; question: string; documents: { name: string; content: string }[] },
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

/** Opens an attached document in the evidence list and replaces its text, as a person correcting a source would. */
export async function editSource(page: Page, name: string, content: string): Promise<void> {
  const file = sourceMaterial(page).locator('details.source-file').filter({ hasText: name });
  await file.getByText(name, { exact: true }).click();
  await file.getByLabel('Extracted / supplied source text').fill(content);
}

/** Looks a cited passage up by its id in the evidence browser, and checks that the quote is in it. */
export async function inspectPassage(page: Page, passageId: string, quote: string): Promise<void> {
  await openStage(page, /Graph Build/u);
  await page.getByRole('button', { name: /Browse evidence/u }).click();
  const dialog = page.getByRole('dialog', { name: 'Sources & evidence' });
  await dialog.getByRole('searchbox', { name: 'Search source evidence' }).fill(passageId);
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  const chunk = dialog.locator('article.evidence-chunk').filter({ hasText: passageId }).first();
  await expect(chunk).toBeVisible();
  expect(squash(await chunk.innerText()), `passage ${passageId}`).toContain(squash(quote));
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
}

/** The text of each element, one by one, so that a claim is judged in the sentence that makes it. */
export const textsOf = (scope: Locator): Promise<string[]> =>
  scope.evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? '').replace(/\s+/gu, ' ').trim()),
  );
