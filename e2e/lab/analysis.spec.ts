import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios';
import {
  advance,
  apiContext,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  watchPage,
} from '../support/helpers';

// The Simulation stage as a person meets it: the comparison of scenarios on the rules-mode server, from
// the page that sets it up to the results, with what it says and what it must not say, what happens when
// it is stopped, repeated, refused or interrupted, and what the decision brief and the independent review
// make of it. Stages before it are seeded through the routes; the whole path from the landing page is
// another spec's.

const THEMES = ['light', 'dark', 'high-contrast'] as const;
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;
const EXAMPLES = ['copilot-in-teams', 'regional-price-change', 'ecommerce-experience'] as const;

// ---------------------------------------------------------------------------------------------
// Seeding: the same routes the pages use, so that every project here is made by the generic pipeline.
// ---------------------------------------------------------------------------------------------

interface Pack {
  question: string;
  documents: { name: string; content: string; provenance?: unknown }[];
}

interface Stakeholder {
  id: string;
  name: string;
  category: string;
  description: string;
  relevance: string;
  directness: 'direct' | 'indirect';
  priority: 'key' | 'standard' | 'background';
  populationSize: number;
  direction: 'harmed' | 'benefited' | 'mixed' | 'unclear';
  rationale: string;
}

interface AnalysisJson {
  id: string;
  status: string;
  config: {
    runsPerVariant: number;
    baseSeed: number;
    variants: {
      id: string;
      label: string;
      intensity: number;
      round: number;
      description: string;
    }[];
  };
  progress: { completedRuns: number; totalRuns: number };
  cost: { wallMs: number; simulatedRuns: number };
  error: { code: string; message: string } | null;
  findings: unknown[];
  variants: unknown[];
  sensitivity: unknown[];
  representativeRun: unknown;
}

/** A question in a domain none of the examples is in, with the evidence a person would paste in. */
const BUS: Pack = {
  question: 'What could happen if a regional bus operator raises weekday fares by 15% next spring?',
  documents: [
    {
      name: 'operator-fare-briefing.md',
      provenance: { kind: 'paste' },
      content: `# Fare review briefing

_Illustrative synthetic note written for a test; the figures are invented._

The regional bus operator is considering a 15% rise in weekday fares next spring. Fare income covers most running costs, and fuel and wages have risen. Commuters who ride every weekday would pay the most. Students and seniors hold discounted passes, which the operator proposes to raise by the same share. Low-income riders say they have no cheaper way to reach work and would struggle with a higher fare.

The Transport Authority must approve any fare change and has asked the operator for ridership evidence first. A ride-hailing company that competes with the operator on the main commuter corridors has announced commuter discounts. Several large employers buy bulk commuter passes for their staff and have said they would pay more only if the service improves. The drivers' union supports a rise if it funds wages. Disability advocates worry that higher fares reduce independence for riders who cannot drive.
`,
    },
    {
      name: 'rider-survey-notes.md',
      provenance: { kind: 'paste' },
      content: `# Rider survey notes

_Illustrative synthetic notes written for a test; the numbers are invented._

A small self-selected survey of 180 riders found that many commuters would switch to driving or ride-hailing if fares rose, while students would mostly keep riding because the pass is their cheapest option. Seniors said a rise would reduce how often they travel. The employers did not respond. The survey does not describe riders in general. No measurement exists of how riders would actually respond: these notes describe stated worries, not observed behaviour.
`,
    },
  ],
};

/** A question with no amount in it, so that a comparison has the baseline and the change only. */
const UTILITY: Pack = {
  question:
    'What could happen if a large regional utility changes how it bills every customer group?',
  documents: [
    {
      name: 'billing-notes.md',
      provenance: { kind: 'paste' },
      content:
        '# Billing notes\n\n_Illustrative synthetic notes written for a test._\n\nThe utility is considering a change to its billing rules. Customers would pay more under the change, and the regulator must approve it before it applies.',
    },
  ],
};

const person = (
  id: string,
  name: string,
  category: string,
  priority: Stakeholder['priority'],
  populationSize: number,
  direction: Stakeholder['direction'],
  rationale: string,
): Stakeholder => ({
  id,
  name,
  category,
  description: rationale,
  relevance: rationale,
  directness: priority === 'key' ? 'direct' : 'indirect',
  priority,
  populationSize,
  direction,
  rationale,
});

const BUS_STAKEHOLDERS: Stakeholder[] = [
  person(
    'operator',
    'Bus operator',
    'decision-maker',
    'key',
    1,
    'mixed',
    'Raises income but risks losing riders.',
  ),
  person(
    'transport-authority',
    'Transport Authority',
    'regulator',
    'key',
    1,
    'unclear',
    'Must approve any fare change.',
  ),
  person(
    'ride-hailing',
    'Ride-hailing company',
    'competitor',
    'key',
    1,
    'benefited',
    'Gains riders who leave the bus.',
  ),
  person(
    'commuters',
    'Weekday commuters',
    'end-user',
    'standard',
    12_000,
    'harmed',
    'Pay the higher fare and have few alternatives.',
  ),
  person(
    'students',
    'Students',
    'end-user',
    'standard',
    4_000,
    'harmed',
    'The discounted pass rises as well.',
  ),
  person(
    'seniors',
    'Seniors',
    'end-user',
    'standard',
    3_000,
    'harmed',
    'Said a rise would reduce how often they travel.',
  ),
  person(
    'employers',
    'Large employers',
    'partner',
    'standard',
    40,
    'harmed',
    'Bulk passes cost more.',
  ),
  person(
    'drivers-union',
    "Drivers' union",
    'influencer',
    'background',
    600,
    'benefited',
    'Wages may be funded by the rise.',
  ),
  person(
    'disability-advocates',
    'Disability advocates',
    'risk-bearer',
    'standard',
    800,
    'harmed',
    'Riders who cannot drive have no alternative.',
  ),
];

const BUS_RELATIONS = [
  { from: 'transport-authority', to: 'operator', type: 'regulates', strength: 0.8 },
  { from: 'ride-hailing', to: 'operator', type: 'competes-with', strength: 0.7 },
  { from: 'employers', to: 'operator', type: 'buys-from', strength: 0.5 },
  { from: 'drivers-union', to: 'operator', type: 'influences', strength: 0.4 },
  { from: 'disability-advocates', to: 'transport-authority', type: 'influences', strength: 0.4 },
  { from: 'commuters', to: 'ride-hailing', type: 'substitutes-for', strength: 0.5 },
];

const said = async (
  response: { status: () => number; text: () => Promise<string> },
  status: number,
) => expect(response.status(), await response.text()).toBe(status);

async function createProject(api: APIRequestContext, pack: Pack, name: string): Promise<string> {
  const read = await api.post('/api/scenario/parse', {
    data: {
      question: pack.question,
      documents: pack.documents.map((document) => ({
        name: document.name,
        characters: document.content.length,
      })),
    },
  });
  await said(read, 200);
  const created = await api.post('/api/projects', {
    data: {
      name,
      question: pack.question,
      workflow: 'guided',
      documents: pack.documents,
      scenario: ((await read.json()) as { frame: unknown }).frame,
      settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    },
  });
  await said(created, 201);
  return ((await created.json()) as { id: string }).id;
}

async function approveAndMakeActors(api: APIRequestContext, id: string, revision: number) {
  const approved = await api.post(`/api/projects/${id}/stakeholders/approve`, {
    data: { expectedRevision: revision },
  });
  await said(approved, 200);
  await said(await api.post(`/api/projects/${id}/actors/generate`, { data: {} }), 201);
}

/** An example, found by reading the text with the rules: nothing about it is written here. */
async function seedExample(api: APIRequestContext, exampleId: string): Promise<string> {
  const example = EXAMPLE_SCENARIOS.find((candidate) => candidate.id === exampleId)!;
  const id = await createProject(api, example, `Analysis: ${example.title}`);
  const found = await api.post(`/api/projects/${id}/stakeholders/discover`, {
    data: { mode: 'rules' },
  });
  await said(found, 201);
  await approveAndMakeActors(api, id, ((await found.json()) as { revision: number }).revision);
  return id;
}

/** A question of the person's own, with the stakeholders they wrote down. */
async function seedByHand(
  api: APIRequestContext,
  name: string,
  stakeholders: Stakeholder[],
  relations: typeof BUS_RELATIONS | [] = [],
  pack: Pack = BUS,
): Promise<string> {
  const id = await createProject(api, pack, name);
  const written = await api.put(`/api/projects/${id}/stakeholders`, {
    data: {
      expectedRevision: 0,
      stakeholders: stakeholders.map((stakeholder) => ({
        id: stakeholder.id,
        name: stakeholder.name,
        category: stakeholder.category,
        description: stakeholder.description,
        relevance: stakeholder.relevance,
        directness: stakeholder.directness,
        priority: stakeholder.priority,
        populationSize: stakeholder.populationSize,
        expectedImpact: { direction: stakeholder.direction, rationale: stakeholder.rationale },
        evidence: [],
        assumptions: [],
        uncertainty: { level: 'medium', reason: 'Written by hand for this test.' },
        origin: 'user',
        status: 'added',
        mergedFrom: [],
      })),
      relations: relations.map((relation) => ({ ...relation, rationale: '' })),
    },
  });
  await said(written, 200);
  await approveAndMakeActors(api, id, ((await written.json()) as { revision: number }).revision);
  return id;
}

/** A cast whose every run takes long enough to be stopped, watched and interrupted: 39 cohorts of 200 members. */
async function seedHeavy(api: APIRequestContext, name: string): Promise<string> {
  const groups = Array.from({ length: 39 }, (_, index) =>
    person(
      `group-${index + 1}`,
      `Group ${index + 1}`,
      'end-user',
      'standard',
      100_000,
      'harmed',
      'Pays more.',
    ),
  );
  const id = await seedByHand(
    api,
    name,
    [
      person('utility', 'Utility', 'decision-maker', 'key', 1, 'mixed', 'Raises income.'),
      ...groups,
    ],
    [],
    UTILITY,
  );
  const made = await api.get(`/api/projects/${id}/actors`);
  const { revision, actors } = (await made.json()) as {
    revision: number;
    actors: { actors: { kind: string }[] };
  };
  await said(
    await api.put(`/api/projects/${id}/actors`, {
      data: {
        expectedRevision: revision,
        actors: actors.actors.map((actor) =>
          actor.kind === 'cohort' ? { ...actor, sampleSize: 200 } : actor,
        ),
      },
    }),
    200,
  );
  return id;
}

/**
 * Gives the members of every group the same impact, so that a cast in which nobody has a direction has
 * nothing for the change to land on. The cast the pages make leaves them a spread around it, which
 * moves members in either direction while nobody is set as helped or harmed.
 */
async function freezeImpacts(api: APIRequestContext, id: string): Promise<void> {
  const made = await api.get(`/api/projects/${id}/actors`);
  const { revision, actors } = (await made.json()) as {
    revision: number;
    actors: { actors: { traits: { impact: { spread: number } } }[] };
  };
  await said(
    await api.put(`/api/projects/${id}/actors`, {
      data: {
        expectedRevision: revision,
        actors: actors.actors.map((actor) => ({
          ...actor,
          traits: { ...actor.traits, impact: { ...actor.traits.impact, spread: 0 } },
        })),
      },
    }),
    200,
  );
}

async function startViaApi(
  api: APIRequestContext,
  id: string,
  data: object = {},
): Promise<AnalysisJson> {
  const response = await api.post(`/api/projects/${id}/analysis`, { data });
  await said(response, 202);
  return ((await response.json()) as { analysis: AnalysisJson }).analysis;
}

const readViaApi = async (
  api: APIRequestContext,
  id: string,
  analysis: string,
): Promise<AnalysisJson> =>
  (
    (await (await api.get(`/api/projects/${id}/analysis/${analysis}`)).json()) as {
      analysis: AnalysisJson;
    }
  ).analysis;

async function finished(
  api: APIRequestContext,
  id: string,
  analysis: string,
): Promise<AnalysisJson> {
  await expect
    .poll(async () => (await readViaApi(api, id, analysis)).status, {
      timeout: 120_000,
      intervals: [100, 250, 500],
    })
    .not.toMatch(/^(running|queued)$/u);
  return readViaApi(api, id, analysis);
}

/** Stops anything still running on a project, so that a failing test does not leave the server busy for the next. */
async function stopEverything(api: APIRequestContext, id: string): Promise<void> {
  const listed = await api.get(`/api/projects/${id}/analysis`);
  if (!listed.ok()) return;
  const { analyses } = (await listed.json()) as { analyses: { id: string; status: string }[] };
  for (const analysis of analyses.filter((item) => ['running', 'queued'].includes(item.status))) {
    await api.post(`/api/projects/${id}/analysis/${analysis.id}/cancel`);
    await finished(api, id, analysis.id);
  }
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

const panel = (page: Page): Locator => page.getByRole('region', { name: 'Compare scenarios' });
const results = (page: Page): Locator => panel(page).locator('.analysis-results');
const scenarioRows = (page: Page): Locator =>
  panel(page).getByRole('list', { name: 'Scenarios to compare' }).getByRole('listitem');

async function inTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
}

async function openSimulation(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}`);
  await page
    .getByRole('navigation', { name: 'Guided workflow steps' })
    .getByRole('button', { name: /^Simulation/u })
    .click();
  await expect(
    panel(page).getByRole('heading', { level: 2, name: 'Compare scenarios' }),
  ).toBeVisible();
}

/** The setup form, which sits behind "Run another comparison" once a comparison is on show. */
async function openSetup(page: Page): Promise<Locator> {
  const another = panel(page).locator('details.analysis-another');
  if (
    (await another.count()) > 0 &&
    !(await another.evaluate((element) => (element as HTMLDetailsElement).open))
  ) {
    await another.getByText('Run another comparison').click();
  }
  return panel(page).locator('form.analysis-setup');
}

async function chooseRuns(page: Page, runs: number): Promise<void> {
  await (
    await openSetup(page)
  )
    .getByLabel('Seeded runs of each scenario')
    .selectOption(String(runs));
}

async function setScenario(
  row: Locator,
  values: { name?: string; intensity?: number; round?: number },
): Promise<void> {
  if (values.name !== undefined) await row.getByLabel('Name').fill(values.name);
  if (values.intensity !== undefined)
    await row.getByLabel('How strongly it lands (0 to 1)').fill(String(values.intensity));
  if (values.round !== undefined)
    await row.getByLabel(/^Starts in round/u).fill(String(values.round));
}

async function compare(page: Page): Promise<void> {
  const form = await openSetup(page);
  await form.getByRole('button', { name: /^Compare scenarios/u }).click();
}

async function waitForResults(page: Page): Promise<void> {
  await expect(results(page)).toBeVisible({ timeout: 120_000 });
}

/** What the results say, without what differs between two identical runs: when it finished and how long it took. */
const resultsText = async (page: Page): Promise<string> =>
  (await results(page).innerText())
    .replace(/Finished [^.]*\.\s*/u, '')
    .replace(/ in (\d+ ms|[\d.]+ s|\d+ min \d+ s);/u, ' in X;');

/**
 * No sentence on the page presents a simulated number as something real. Nothing is said in the words of
 * a forecast or of a measurement of people, and every share is a simulated one. The sentences that
 * deny it (not a rate, not a prediction) are the ones that may use the words.
 */
const DENIALS = [
  'does not guarantee or precisely predict real-world behavior',
  'none of it is a rate of anything real',
  'not how likely anything is in the world',
  'It is not the chance of anything happening in the world',
  'nothing is claimed about the world',
  // The brief's own denials.
  'None is a rate, a share of a real population, a forecast or a measurement.',
  'the counts above are neither rates nor forecasts',
];
function expectNoRealWorldClaims(text: string, label: string): void {
  const rest = DENIALS.reduce((kept, phrase) => kept.split(phrase).join(''), text);
  const lines = rest
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const words =
    /\b(conversions?|churn\w*|market share|sentiment|adoption|forecast\w*|predict\w*|probabilit\w+|likelihood|prediction)\b/iu;
  expect(
    lines.filter((line) => words.test(line)),
    `words of a forecast or a measurement: ${label}`,
  ).toEqual([]);
  const shares = lines.filter(
    (line) => /\bshares?\b/iu.test(line) && !/simulated|seeded run/iu.test(line),
  );
  expect(shares, `a share that is not said to be simulated: ${label}`).toEqual([]);
}

/** What a finished comparison says, whatever it was about. */
async function expectHonestResults(page: Page, label: string): Promise<void> {
  const text = await results(page).innerText();
  expect(text, label).toContain('What this comparison says');
  expect(text).toMatch(/Compared .+: \d+ seeded runs of each, on the same seeds\./u);
  expect(text).toMatch(/seeds \d+ to \d+, the same for every scenario/u);
  expect(text).toContain('Origin: simulation aggregation of rules-engine runs');
  expect(text).toContain('system assumption unless it says it was set by you');
  expect(text).toContain(
    'Final responses of the simulated members, averaged over the seeded runs of each scenario',
  );
  expect(text).toContain('not observed behaviour');
  expect(text).toContain(
    'Stance runs from -1 (clearly against) to +1 (clearly in favour) and is a simulated reading, not a measurement.',
  );
  expect(text).toContain('How far to rely on this');
  expect(text).toContain('Rules: outcomes follow from the declared assumptions');
  expect(text).toContain('no model decided any actor’s behaviour');
  expect(text).toContain(
    'Repeatability describes that randomness, not how likely anything is in the world.',
  );
  expect(text).toMatch(
    /Cost: [\d,]+ simulated runs of [\d,]+ simulated members in .+; 0 model calls\./u,
  );
  expect(text).toContain('Which assumptions the result is sensitive to');
  expect(text).toMatch(
    /System assumption: no evidence supplied|Your assumption|Backed by supplied evidence|Set by the scenario/u,
  );
  expect(text).toContain('Second-order effects in one typical run');
  expect(text).toMatch(/holds in \d+ of \d+ seeded runs \(95% interval \d+–\d+%\)/u);
  expect(text).toMatch(
    /Looking for an alternative or resisting: \d+% of the simulated members in a typical run/u,
  );
  const bars = await results(page)
    .locator('.analysis-bar[role="img"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  expect(bars.length).toBeGreaterThan(1);
  for (const bar of bars)
    expect(bar).toMatch(/averaged over \d+ seeded runs: .* of the simulated members\.$/u);
  // The panel's own words, and the findings that are folded away, are held to the same standard.
  expectNoRealWorldClaims(await panel(page).innerText(), label);
  for (const summary of await results(page).locator('details > summary').all()) {
    const details = summary.locator('xpath=ancestor::details[1]');
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
      await summary.click();
  }
  expectNoRealWorldClaims(await results(page).innerText(), `${label}, every disclosure opened`);
}

// ---------------------------------------------------------------------------------------------
// What the tests share
// ---------------------------------------------------------------------------------------------

const ids = {} as Record<
  | (typeof EXAMPLES)[number]
  | 'bus'
  | 'fresh'
  | 'still'
  | 'undirected'
  | 'heavy'
  | 'reproduce'
  | 'report',
  string
>;
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  for (const example of EXAMPLES) ids[example] = await seedExample(api, example);
  ids.bus = await seedByHand(api, 'Analysis: regional bus fares', BUS_STAKEHOLDERS, BUS_RELATIONS);
  ids.fresh = await seedByHand(
    api,
    'Analysis: bus fares, not yet compared',
    BUS_STAKEHOLDERS,
    BUS_RELATIONS,
  );
  ids.reproduce = await seedByHand(
    api,
    'Analysis: bus fares, repeated',
    BUS_STAKEHOLDERS,
    BUS_RELATIONS,
  );
  ids.report = await seedByHand(
    api,
    'Analysis: bus fares, to the brief',
    BUS_STAKEHOLDERS,
    BUS_RELATIONS,
  );
  const unclear = BUS_STAKEHOLDERS.map((stakeholder) => ({
    ...stakeholder,
    direction: 'unclear' as const,
  }));
  ids.still = await seedByHand(
    api,
    'Analysis: nobody has a direction, nothing to land on',
    unclear,
  );
  await freezeImpacts(api, ids.still);
  ids.undirected = await seedByHand(
    api,
    'Analysis: nobody has a direction, members differ',
    unclear,
  );
  // The engine's first stage is done here, as it is for a person who came through Graph Build, so that the
  // way back to the stakeholder review is open.
  await advance(api, ids.still, 'knowledge');
  await advance(api, ids.undirected, 'knowledge');
  ids.heavy = await seedHeavy(api, 'Analysis: a cast that takes long to compare');
});

test.afterEach(async () => {
  await stopEverything(api, ids.heavy);
});

// ---------------------------------------------------------------------------------------------
// The examples and a question of the person's own, through the real page
// ---------------------------------------------------------------------------------------------

test.describe('comparing scenarios on the page', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const example of EXAMPLES) {
    test(`${example}: a baseline, the change and an alternative, run, read and said honestly`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await openSimulation(page, ids[example]);

      // Before anything runs: what is compared, and that how strongly it lands is the system's guess.
      await expect(
        panel(page).getByText(
          'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(panel(page)).toContainText('none of it is a rate of anything real');
      const rows = scenarioRows(page);
      await expect(rows.first()).toContainText('Baseline');
      await expect(rows.first()).toContainText('Intensity 0: no change lands.');
      await expect(rows.nth(1)).toContainText('Intensity 0.7 from round 2 is a system assumption');
      expect(await rows.count()).toBeGreaterThanOrEqual(2);
      await expect(panel(page)).toContainText(/This runs \d+ simulated runs/u);
      await expect(panel(page)).toContainText('No model is called, so it costs server time only');

      // The person defines their own: the proposed change stronger and later, and one more way to do it.
      const before = await rows.count();
      await setScenario(rows.nth(1), { intensity: 0.8, round: 3 });
      await panel(page).getByRole('button', { name: 'Add an alternative' }).click();
      await expect(rows).toHaveCount(before + 1);
      await setScenario(rows.last(), {
        name: 'Staged rollout (intervention)',
        intensity: 0.35,
        round: 5,
      });
      await chooseRuns(page, 10);
      await compare(page);
      await waitForResults(page);

      await expectHonestResults(page, example);
      await expect(results(page)).toContainText(
        /Compared No change, Proposed change.*Staged rollout \(intervention\)/su,
      );
      await expect(results(page)).toContainText('10 seeded runs of each');
      await expect(results(page)).toContainText('seeds 42 to 51');

      // What was set is said as set: the sentence that is saved says the values that were run.
      const scenarios = (await readViaApi(api, ids[example], await latestId(ids[example]))).config
        .variants;
      const rollout = scenarios.find(
        (scenario) => scenario.label === 'Staged rollout (intervention)',
      )!;
      expect(rollout).toMatchObject({ intensity: 0.35, round: 5 });
      expect(rollout.description).toBe('Added by you. Intensity 0.35 from round 5 was set by you.');
      expect(
        scenarios.find((scenario) => scenario.id === 'proposed-change')!.description,
      ).toContain('Intensity 0.8 from round 3 was set by you.');
      expect(problems).toEqual([]);
    });
  }

  test('a question of the person’s own, in another domain: second-order effects, and the second move of a competitor or a regulator', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSimulation(page, ids.bus);
    const rows = scenarioRows(page);
    // The suggested larger and smaller versions follow the amounts the scenario states.
    const labels = await rows
      .getByLabel('Name')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(labels).toEqual([
      'No change',
      'Proposed change',
      'Smaller change (suggestion)',
      'Larger change (suggestion)',
    ]);
    const intensity = async (index: number) =>
      Number(await rows.nth(index).getByLabel('How strongly it lands (0 to 1)').inputValue());
    expect(await intensity(2)).toBeLessThan(await intensity(1));
    expect(await intensity(3)).toBeGreaterThanOrEqual(await intensity(1));
    await expect(rows.nth(3)).toContainText('times as much');

    await setScenario(rows.nth(1), { intensity: 1 });
    await panel(page).getByRole('button', { name: 'Add an alternative' }).click();
    await setScenario(rows.last(), {
      name: 'Student fare cap (intervention)',
      intensity: 0.3,
      round: 5,
    });
    await chooseRuns(page, 10);
    await compare(page);
    await waitForResults(page);
    await expectHonestResults(page, 'bus');

    const chain = results(page).locator('.analysis-chain > li');
    await expect(chain.first()).toBeVisible();
    await expect(results(page).locator('.analysis-chain')).toContainText(
      /a simulated “(counter-move|scrutiny|enablement|substitute-offer)” event by (Ride-hailing company|Transport Authority|Large employers)/u,
    );
    await expect(results(page).locator('.analysis-chain')).toContainText(
      /the simulated “[a-z-]+” signal/u,
    );
    // How often each kind of event occurred is among the findings, with the runs of the baseline alongside.
    await expect(results(page)).toContainText(
      /seeded runs, a simulated “(counter-move|scrutiny|enablement)” event occurred under Proposed change \(under No change: \d+ of 10\)/u,
    );
    expect(problems).toEqual([]);
  });

  for (const [width, height] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    test(`keeps the button that starts a comparison on the screen at ${width}x${height}, however long the form is`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openSimulation(page, ids.fresh);
      const start = panel(page).getByRole('button', { name: 'Compare scenarios', exact: true });
      // Six scenarios make a form several screens long.
      for (let more = 0; more < 2; more += 1) {
        await panel(page).getByRole('button', { name: 'Add an alternative' }).click();
      }
      await expect(scenarioRows(page)).toHaveCount(6);
      await expect(start).toBeInViewport({ ratio: 1 });
      await page.mouse.wheel(0, 600);
      await expect(start).toBeInViewport({ ratio: 1 });
      // A field that takes focus is not left behind it.
      const last = scenarioRows(page).last().getByLabel('How strongly it lands (0 to 1)');
      await last.focus();
      const [field, button] = await Promise.all([last.boundingBox(), start.boundingBox()]);
      expect(field!.y + field!.height).toBeLessThanOrEqual(button!.y);
    });
  }

  test('says before and after the run that a change that cannot move anyone shows only chance', async ({
    page,
  }) => {
    await openSimulation(page, ids.still);
    const warning = panel(page)
      .getByRole('status')
      .filter({ hasText: 'Nothing in this change can move anyone yet' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('every difference from no change is noise');
    await expect(warning).toContainText('You can still run it');
    await expect(
      warning.getByRole('button', { name: 'Open the stakeholder review' }),
    ).toBeVisible();
    await expect(panel(page).getByRole('button', { name: /^Compare scenarios/u })).toBeEnabled();
    await chooseRuns(page, 10);
    await compare(page);
    await waitForResults(page);
    await expect(results(page).getByRole('status').first()).toContainText(
      'This comparison cannot say anything about the change',
    );
    await expect(results(page)).toContainText('Nothing in the change can move anyone in this cast');
    // It says nothing of a direction, and a robust row is not allowed to read as a finding.
    await expect(results(page).locator('.analysis-says')).not.toContainText(/favourable/u);
    await expect(results(page)).toContainText('No effect to test');
    await expect(results(page)).not.toContainText(/\bRobust\b/u);
    expectNoRealWorldClaims(await panel(page).innerText(), 'no direction');

    // The way to say who is helped or harmed is one press away, in the stage that asks it.
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Guided workflow steps' })
      .getByRole('button', { name: /^Simulation/u })
      .click();
    await expect(results(page)).toBeVisible();
    const again = await openSetup(page);
    await again.getByRole('button', { name: 'Open the stakeholder review' }).click();
    await expect(page.getByRole('heading', { name: 'Stakeholders and actors' })).toBeVisible();
  });

  test('says before and after the run that nobody has a direction, and not that nothing can move, where members still differ in how the change lands', async ({
    page,
  }) => {
    await openSimulation(page, ids.undirected);
    const warning = panel(page)
      .getByRole('status')
      .filter({ hasText: 'No stakeholder has an expected direction yet' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('nobody is set as helped or harmed by the change');
    await expect(warning).toContainText('they come from those assumptions');
    await expect(warning).toContainText('You can still run it');
    await expect(warning).not.toContainText(/cannot move anyone|can move anyone yet|noise/u);
    await expect(
      warning.getByRole('button', { name: 'Open the stakeholder review' }),
    ).toBeVisible();
    await expect(panel(page).getByRole('button', { name: /^Compare scenarios/u })).toBeEnabled();
    await chooseRuns(page, 10);
    await compare(page);
    await waitForResults(page);
    const notice = results(page)
      .getByRole('status')
      .filter({ hasText: 'No stakeholder has an expected direction of impact' });
    await expect(notice.first()).toBeVisible();
    await expect(results(page)).not.toContainText(
      'This comparison cannot say anything about the change',
    );
    await expect(results(page)).not.toContainText('Nothing in the change can move anyone');
    await expect(results(page)).not.toContainText('No effect to test');
    expectNoRealWorldClaims(await panel(page).innerText(), 'no direction, members differ');
  });

  test('repeating a comparison on the same seeds gives the same numbers, and the page says which seeds', async ({
    page,
  }) => {
    await openSimulation(page, ids.reproduce);
    await chooseRuns(page, 10);
    await compare(page);
    await waitForResults(page);
    await expect(results(page)).toContainText('seeds 42 to 51, the same for every scenario');
    const first = await resultsText(page);
    const firstId = await latestId(ids.reproduce);

    await compare(page);
    await expect(
      panel(page).getByRole('progressbar', { name: 'Comparison progress' }),
    ).toBeVisible();
    await waitForResults(page);
    const second = await resultsText(page);
    expect(second).toBe(first);

    // The saved documents agree too, to the last digit; a different first seed does not.
    const stable = (analysis: AnalysisJson) =>
      JSON.stringify([
        analysis.config.baseSeed,
        analysis.variants,
        analysis.findings,
        analysis.sensitivity,
        analysis.representativeRun,
      ]);
    const a = await readViaApi(api, ids.reproduce, firstId);
    const b = await readViaApi(api, ids.reproduce, await latestId(ids.reproduce));
    expect(stable(b)).toBe(stable(a));
    const other = await finished(
      api,
      ids.reproduce,
      (await startViaApi(api, ids.reproduce, { runsPerVariant: 10, baseSeed: 4_242 })).id,
    );
    expect(other.config.baseSeed).toBe(4_242);
    expect(stable(other)).not.toBe(stable(a));
  });
});

/** The newest comparison of a project, which is the one the page shows once it has finished. */
async function latestId(project: string): Promise<string> {
  const listed = await api.get(`/api/projects/${project}/analysis`);
  return ((await listed.json()) as { analyses: { id: string }[] }).analyses[0]!.id;
}

// ---------------------------------------------------------------------------------------------
// Watching, stopping, refusing and interrupting
// ---------------------------------------------------------------------------------------------

test.describe('a comparison that is running', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows its progress where the person is looking, can be cancelled, and shows no partial result', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSimulation(page, ids.heavy);
    await chooseRuns(page, 100);
    await compare(page);

    // The form that was pressed is gone: focus and the screen follow the person to the progress.
    const progress = panel(page).getByRole('progressbar', { name: 'Comparison progress' });
    await expect(progress).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'Comparing scenarios' })).toBeFocused();
    await expect(panel(page).getByRole('heading', { name: 'Comparing scenarios' })).toBeInViewport({
      ratio: 1,
    });
    await expect(progress).toHaveAttribute(
      'aria-valuetext',
      /^[\d,]+ of 1,340 simulated runs finished$/u,
    );
    await expect(panel(page)).toContainText(
      '2 scenarios × 100 seeded runs, then the sensitivity of the proposed change.',
    );
    await expect(panel(page).locator('.sr-only[role="status"]').last()).toHaveText(
      /^Comparing scenarios: about \d+% of the simulated runs are finished\.$/u,
    );

    // The server answers while it works, the whole time.
    const slowest = await page.evaluate(async () => {
      let worst = 0;
      for (let index = 0; index < 20; index += 1) {
        const at = performance.now();
        await (await fetch('/api/health')).text();
        worst = Math.max(worst, performance.now() - at);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return worst;
    });
    expect(slowest, 'the slowest answer of /api/health during the comparison, in ms').toBeLessThan(
      500,
    );

    const cancel = panel(page).getByRole('button', { name: 'Cancel the comparison' });
    await cancel.click();
    // Cancelling stays said until it has stopped, and the button cannot be pressed again meanwhile.
    await expect(panel(page)).toContainText('Cancelling: it stops after the run in progress.');
    await expect(panel(page).getByRole('button', { name: 'Cancelling' })).toBeDisabled();
    const cancelled = panel(page)
      .getByRole('status')
      .filter({ hasText: 'This comparison was cancelled' });
    await expect(cancelled).toBeVisible();
    await expect(cancelled).toContainText(
      /It stopped after [\d,]+ of 1,340 runs\. Nothing is shown from a partial comparison/u,
    );
    await expect(
      panel(page).getByRole('button', { name: 'Run it again with the same settings' }),
    ).toBeEnabled();
    await expect(results(page)).toHaveCount(0);
    await expect(panel(page).locator('.sr-only[role="status"]').first()).toHaveText(
      'The comparison was cancelled.',
    );
    expect(problems).toEqual([]);

    // It can be run again with the same settings, and stopped again.
    await panel(page).getByRole('button', { name: 'Run it again with the same settings' }).click();
    await expect(progress).toBeVisible();
    await panel(page).getByRole('button', { name: 'Cancel the comparison' }).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'This comparison was cancelled' }),
    ).toBeVisible();
    const server = await page.request.get('/api/health');
    expect(server.ok()).toBe(true);
  });

  test('refuses a second comparison for the same project in a sentence, not in the engine’s words', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    await openSimulation(page, ids.heavy);
    // The page was set up before anything ran, so its form is still there when another client starts one.
    const running = await startViaApi(api, ids.heavy, { runsPerVariant: 10 });
    await compare(page);
    const refusal = panel(page).getByRole('alert');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(
      'A comparison of scenarios is already running for this project. Wait for it to finish, or cancel it.',
    );
    await expect(refusal).not.toContainText(/ANALYSIS_|expected|Invalid|undefined/u);
    expect(problems.filter((problem) => !problem.includes('409'))).toEqual([]);

    // And cancelling what has already finished or been cancelled is a sentence too.
    await api.post(`/api/projects/${ids.heavy}/analysis/${running.id}/cancel`);
    await finished(api, ids.heavy, running.id);
    const late = await api.post(`/api/projects/${ids.heavy}/analysis/${running.id}/cancel`);
    expect(late.status()).toBe(409);
    expect(((await late.json()) as { error: { message: string } }).error.message).toBe(
      'This comparison has already finished.',
    );
  });

  test('refuses a request that is too large or not understood, with the limit in a sentence', async () => {
    const refused = async (data: unknown) => {
      const response = await api.post(`/api/projects/${ids.fresh}/analysis`, {
        data: data as object,
      });
      expect(response.status(), JSON.stringify(data)).toBe(400);
      return ((await response.json()) as { error: { message: string } }).error.message;
    };
    const variant = (index: number) => ({
      id: index === 0 ? 'baseline' : `alt-${index}`,
      label: index === 0 ? 'No change' : `Alternative ${index}`,
      kind: index === 0 ? 'baseline' : 'alternative',
      intensity: index === 0 ? 0 : 0.5,
    });
    const nine = Array.from({ length: 9 }, (_, index) => variant(index));
    const eight = Array.from({ length: 8 }, (_, index) => variant(index));
    const messages = [
      await refused({ runsPerVariant: 5_000 }),
      await refused({ rounds: 99 }),
      await refused({ variants: nine }),
      await refused({ runsPerVariant: 200, variants: eight, sensitivity: true }),
      await refused({ variants: [variant(0), { ...variant(1), intensity: 1.5 }] }),
      await refused({ somethingElse: true }),
    ];
    expect(messages[0]).toBe(
      'Choose a whole number of seeded runs for each scenario, from 3 to 200.',
    );
    expect(messages[1]).toBe('A run has a whole number of rounds from 3 to 36.');
    expect(messages[2]).toContain('between 2 and 8 scenarios');
    expect(messages[3]).toMatch(
      /limit is 2,400\. Use fewer runs for each scenario or fewer scenarios, or turn sensitivity off\.$/u,
    );
    expect(messages[4]).toBe(
      'Scenario 2 was not accepted: its intensity has to be a number from 0 to 1.',
    );
    for (const message of messages)
      expect(message).not.toMatch(
        /expected|Invalid input|Too (big|small)|Unrecognized|undefined|\[object/u,
      );
    const oversized = await api.post(`/api/projects/${ids.fresh}/analysis`, {
      data: {
        runsPerVariant: 10,
        variants: [{ ...variant(0), description: 'x'.repeat(2_000_000) }],
      },
    });
    expect(oversized.status()).toBe(413);
    // Nothing was started by any of them.
    const listed = (await (await api.get(`/api/projects/${ids.fresh}/analysis`)).json()) as {
      analyses: unknown[];
    };
    expect(listed.analyses).toEqual([]);
  });
});

test.describe('a comparison that the server did not finish', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(240_000);
  let server: ChildProcess | undefined;
  const dataDir = join(process.env.E2E_DATA_ROOT ?? tmpdir(), 'analysis-interrupted');

  const freePort = (): Promise<number> =>
    new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });

  const launch = async (port: number): Promise<void> => {
    server = spawn('node', ['dist/backend/src/index.js'], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
        LOG_LEVEL: 'warn',
        RATE_LIMIT_SCALE: '100',
        AI_PROVIDER: 'none',
      },
      stdio: 'ignore',
    });
    await expect
      .poll(
        async () =>
          fetch(`http://127.0.0.1:${port}/api/health`).then(
            (response) => response.ok,
            () => false,
          ),
        { timeout: 60_000, intervals: [100, 250, 500] },
      )
      .toBe(true);
  };
  const stop = async (): Promise<void> => {
    if (!server || server.exitCode !== null) return;
    const gone = new Promise<void>((resolve) => server!.once('exit', () => resolve()));
    server.kill('SIGKILL');
    await gone;
  };

  test.afterEach(async () => {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('says on the open page that it cannot read the progress, then that it was interrupted, and can be run again', async ({
    page,
    playwright,
  }) => {
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    await launch(port);
    const own = await playwright.request.newContext({ baseURL: origin });
    const id = await seedHeavy(own, 'Analysis: interrupted');
    await page.goto(`${origin}/?project=${id}`);
    await page
      .getByRole('navigation', { name: 'Guided workflow steps' })
      .getByRole('button', { name: /^Simulation/u })
      .click();
    await expect(panel(page)).toBeVisible();
    await compare(page);
    const progress = panel(page).getByRole('progressbar', { name: 'Comparison progress' });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/u, { timeout: 30_000 });

    // The server stops in the middle of the run, with the page open.
    await stop();
    const trouble = panel(page)
      .getByRole('status')
      .filter({ hasText: 'The progress cannot be read just now' });
    await expect(trouble).toBeVisible({ timeout: 20_000 });
    await expect(trouble).toContainText('Cannot reach the local server.');
    await expect(trouble).toContainText('It tries again by itself.');
    await expectNoAxeViolations(page, 'progress while the server is away');

    // It comes back and says what became of the comparison, without a reload.
    await launch(port);
    const interrupted = panel(page)
      .getByRole('status')
      .filter({ hasText: 'This comparison was interrupted' });
    await expect(interrupted).toBeVisible({ timeout: 60_000 });
    await expect(interrupted).toContainText(
      'The server stopped before this comparison finished. It can be reproduced exactly from its seeds: run it again with the same settings.',
    );
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'The comparison was interrupted.' }),
    ).toHaveCount(1);
    await expect(trouble).toHaveCount(0);
    await expect(results(page)).toHaveCount(0);
    await expectNoAxeViolations(page, 'an interrupted comparison');
    await expectNoHorizontalOverflow(page);

    // A reload says the same, and nothing is left running that no one is running.
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Guided workflow steps' })
      .getByRole('button', { name: /^Simulation/u })
      .click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'This comparison was interrupted' }),
    ).toBeVisible();
    const listed = (await (await own.get(`/api/projects/${id}/analysis`)).json()) as {
      analyses: { status: string }[];
    };
    expect(listed.analyses.map((analysis) => analysis.status)).toEqual(['interrupted']);

    // Run again with the same settings: the same seeds, and it starts.
    await panel(page).getByRole('button', { name: 'Run it again with the same settings' }).click();
    await expect(
      panel(page).getByRole('progressbar', { name: 'Comparison progress' }),
    ).toBeVisible();
    await panel(page).getByRole('button', { name: 'Cancel the comparison' }).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'This comparison was cancelled' }),
    ).toBeVisible();
    await own.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// The brief and the independent review read what the comparison found
// ---------------------------------------------------------------------------------------------

test.describe('what a finished comparison feeds', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(240_000);

  test('the brief and the review are made from the newest finished comparison, say what it found, and are called out of date by a newer one', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const first = await finished(
      api,
      ids.report,
      (await startViaApi(api, ids.report, { runsPerVariant: 10 })).id,
    );
    expect(first.status).toBe('completed');
    await said(await api.post(`/api/projects/${ids.report}/critiques/run`, { data: {} }), 200);
    const written = await api.post(`/api/projects/${ids.report}/brief`, { data: {} });
    await said(written, 201);
    const brief = (await written.json()) as {
      brief: {
        analysisId: string;
        headline: string;
        limitations: string[];
        sections: { id: string; statements: { text: string }[] }[];
        recommendations: { text: string; validation: string }[];
        validationPlan: unknown[];
      };
      latestAnalysis: { id: string };
      changedSince: string[];
    };
    expect(brief.brief.analysisId).toBe(first.id);
    expect(brief.changedSince).toEqual([]);
    const text = (id: string) =>
      brief.brief.sections
        .find((section) => section.id === id)!
        .statements.map((statement) => statement.text)
        .join('\n');
    // The variants and their strengths, second-order effects, uncertainty, recommendations and a plan to check.
    expect(text('decision')).toMatch(
      /Variants simulated: “No change” \(baseline\), “Proposed change” \(alternative, lands in round 2 at strength 0\.70 of 1\)/u,
    );
    expect(text('alternative-outcomes')).toMatch(
      /Against “No change”, “Proposed change” left about [\d.]+ more of \d+ simulated members/u,
    );
    expect(text('second-order')).toMatch(
      /a simulated "(scrutiny|counter-move|enablement)" event occurred/u,
    );
    expect(text('uncertainty')).toMatch(/Wilson interval/u);
    expect(brief.brief.recommendations.length).toBeGreaterThan(0);
    expect(brief.brief.validationPlan.length).toBeGreaterThan(0);
    expect(text('limitations')).toContain(
      'None is a rate, a share of a real population, a forecast or a measurement.',
    );
    const claims = [
      brief.brief.headline,
      ...brief.brief.sections.flatMap((section) =>
        section.statements.map((statement) => statement.text),
      ),
      ...brief.brief.recommendations.flatMap((item) => [item.text, item.validation]),
      ...brief.brief.limitations,
    ]
      .join('\n')
      // The name of an assumed trait, with the mark of who assumed it, is not a claim about anyone.
      .replace(/adoption tendency [\d.]+ \[[a-z]+\]/gu, '');
    expectNoRealWorldClaims(claims, 'the brief');

    // The review names the findings it is about, with their counts.
    const review = (await (await api.get(`/api/projects/${ids.report}/critiques`)).json()) as {
      critiques: {
        analysisId: string;
        critiques: { target: { kind: string; id: string }; objection: string }[];
      };
    };
    expect(review.critiques.analysisId).toBe(first.id);
    const aboutFindings = review.critiques.critiques.filter(
      (critique) => critique.target.kind === 'finding',
    );
    expect(aboutFindings.length).toBeGreaterThan(0);
    const findingIds = new Set((first.findings as { id: string }[]).map((finding) => finding.id));
    for (const critique of aboutFindings) {
      expect(findingIds.has(critique.target.id), critique.target.id).toBe(true);
    }
    // At least one says how often the finding it challenges held, in the counts the page shows for it.
    const counted = aboutFindings.filter((critique) =>
      /holds in \d+ of \d+ seeded runs/u.test(critique.objection),
    );
    expect(counted.length).toBeGreaterThan(0);
    for (const critique of counted) {
      const finding = (first.findings as { id: string; holdsIn: number; of: number }[]).find(
        (item) => item.id === critique.target.id,
      )!;
      expect(critique.objection).toContain(
        `holds in ${finding.holdsIn} of ${finding.of} seeded runs`,
      );
    }

    // On the page, and not out of date.
    await page.goto(`/?project=${ids.report}`);
    await page
      .getByRole('navigation', { name: 'Guided workflow steps' })
      .getByRole('button', { name: /^Report/u })
      .click();
    await expect(page.getByText('This brief may be out of date')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Second-order and competitor effects' }),
    ).toBeVisible();

    // A newer comparison leaves neither of them standing as if it were current. A cancelled one does not.
    const cancelled = await startViaApi(api, ids.report, { runsPerVariant: 200 });
    await api.post(`/api/projects/${ids.report}/analysis/${cancelled.id}/cancel`);
    await finished(api, ids.report, cancelled.id);
    const stillCurrent = (await (await api.get(`/api/projects/${ids.report}/brief`)).json()) as {
      changedSince: string[];
      latestAnalysis: { id: string };
    };
    expect(stillCurrent.latestAnalysis.id).toBe(first.id);
    expect(stillCurrent.changedSince).toEqual([]);
    const second = await finished(
      api,
      ids.report,
      (await startViaApi(api, ids.report, { runsPerVariant: 12, baseSeed: 77 })).id,
    );
    expect(second.status).toBe('completed');
    const stale = (await (await api.get(`/api/projects/${ids.report}/brief`)).json()) as {
      brief: { analysisId: string };
      changedSince: string[];
      latestAnalysis: { id: string };
    };
    expect(stale.brief.analysisId).toBe(first.id);
    expect(stale.latestAnalysis.id).toBe(second.id);
    expect(stale.changedSince).toContain('a newer analysis exists');
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Guided workflow steps' })
      .getByRole('button', { name: /^Report/u })
      .click();
    await expect(page.getByText('This brief may be out of date')).toBeVisible();
    await expect(page.getByText(/A newer analysis has finished since\./u)).toBeVisible();

    // Doing both again brings them up to date, from the newer comparison.
    await said(await api.post(`/api/projects/${ids.report}/critiques/run`, { data: {} }), 200);
    const again = (await (
      await api.post(`/api/projects/${ids.report}/brief`, { data: {} })
    ).json()) as { brief: { analysisId: string }; changedSince: string[] };
    expect(again.brief.analysisId).toBe(second.id);
    expect(again.changedSince).toEqual([]);
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Axe, overflow, targets and reading, in every theme, on a desktop and a phone
// ---------------------------------------------------------------------------------------------

async function openEverything(page: Page): Promise<void> {
  for (const summary of await panel(page).locator('details > summary').all()) {
    const details = summary.locator('xpath=ancestor::details[1]');
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
      await summary.click();
  }
}

for (const size of SIZES) {
  test.describe(`the stage at ${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    test.setTimeout(180_000);

    for (const theme of THEMES) {
      const audit = async (page: Page, label: string): Promise<void> => {
        await expectNoAxeViolations(page, `${theme} ${size.name}: ${label}`);
        if (theme !== 'light')
          await expectNoBrowserPaintedControls(page, `${theme} ${size.name}: ${label}`);
        await expectNoHorizontalOverflow(page);
        await expectReadableText(page, `${label} ${theme} ${size.name}`);
        await expectTargetSizes(page, `${label} ${theme} ${size.name}`);
      };

      test(`the setup, with a scenario added, is clean in the ${theme} theme`, async ({ page }) => {
        const problems = watchPage(page);
        await inTheme(page, theme);
        await openSimulation(page, ids.fresh);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await panel(page).getByRole('button', { name: 'Add an alternative' }).click();
        await setScenario(scenarioRows(page).last(), {
          name: 'Student fare cap (intervention)',
          intensity: 0.3,
          round: 5,
        });
        await audit(page, 'setup');
        // A refused value is said beside the button, in words, and keeps it from starting.
        await scenarioRows(page).last().getByLabel('How strongly it lands (0 to 1)').fill('1.5');
        await expect(panel(page)).toContainText(
          '“Student fare cap (intervention)”: intensity is from 0 to 1.',
        );
        await expect(
          panel(page).getByRole('button', { name: 'Compare scenarios', exact: true }),
        ).toBeDisabled();
        await audit(page, 'setup with a refused value');
        expect(problems).toEqual([]);
      });

      test(`the results, every disclosure opened, are clean and readable in the ${theme} theme`, async ({
        page,
      }) => {
        const problems = watchPage(page);
        if (!(await finishedOnce(ids.bus)))
          await finished(
            api,
            ids.bus,
            (await startViaApi(api, ids.bus, { runsPerVariant: 10 })).id,
          );
        await inTheme(page, theme);
        await openSimulation(page, ids.bus);
        await expect(results(page)).toBeVisible();
        await openEverything(page);
        await audit(page, 'results');
        // A figure is never the only way to read it: each has its table beside it.
        for (const caption of [
          'Mean share of the simulated members in each final response, over the seeded runs',
          'Shift of the headline when one assumption is moved, on the same seeds',
        ]) {
          await expect(results(page).locator('caption', { hasText: caption })).toBeVisible();
        }
        expect(problems).toEqual([]);
      });
    }

    test('the progress of a running comparison is clean in every theme', async ({ page }) => {
      const running = await startViaApi(api, ids.heavy, { runsPerVariant: 100 });
      for (const theme of THEMES) {
        await inTheme(page, theme);
        await openSimulation(page, ids.heavy);
        await expect(
          panel(page).getByRole('progressbar', { name: 'Comparison progress' }),
        ).toBeVisible();
        await expectNoAxeViolations(page, `${theme} ${size.name}: progress`);
        if (theme !== 'light')
          await expectNoBrowserPaintedControls(page, `${theme} ${size.name}: progress`);
        await expectNoHorizontalOverflow(page);
        await expectTargetSizes(page, `progress ${theme} ${size.name}`);
        await expectReadableText(page, `progress ${theme} ${size.name}`);
      }
      await api.post(`/api/projects/${ids.heavy}/analysis/${running.id}/cancel`);
      await finished(api, ids.heavy, running.id);
    });
  });
}

/** Whether a project already has a finished comparison, so that the audits share one. */
async function finishedOnce(project: string): Promise<boolean> {
  const listed = (await (await api.get(`/api/projects/${project}/analysis`)).json()) as {
    analyses: { status: string }[];
  };
  return listed.analyses.some((analysis) => analysis.status === 'completed');
}
