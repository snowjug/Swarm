import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios';
import { addressOf, settled } from './app';
import { claimsAgainst } from './claims';

// What the specs of the simulation and of the comparison share: projects made over HTTP with a cast ready to simulate,
// the comparisons started and followed over HTTP, and the way the pages of both scenes are read. Everything here is the
// new interface's; nothing is imported from the helper of the one that was replaced.

// ---------------------------------------------------------------------------------------------
// Seeding: the routes the pages use, so that every project here is made by the generic pipeline
// ---------------------------------------------------------------------------------------------

export interface Pack {
  question: string;
  documents: { name: string; content: string; provenance?: unknown }[];
}

export interface Stakeholder {
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

/** The parts of a saved comparison the specs read. */
export interface AnalysisJson {
  id: string;
  status: string;
  config: {
    runsPerVariant: number;
    baseSeed: number;
    variants: {
      id: string;
      label: string;
      kind: string;
      intensity: number;
      round: number;
      description: string;
    }[];
  };
  progress: { completedRuns: number; totalRuns: number };
  cost: { wallMs: number; simulatedRuns: number };
  error: { code: string; message: string } | null;
  findings: { id: string; holdsIn: number; of: number }[];
  variants: unknown[];
  sensitivity: unknown[];
  representativeRun: { seed: number; events: unknown[] } | null;
}

/** A question in a domain none of the examples is in, with the evidence a person would paste in. */
export const BUS: Pack = {
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
export const UTILITY: Pack = {
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

export const BUS_STAKEHOLDERS: Stakeholder[] = [
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

export const BUS_RELATIONS = [
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
): Promise<void> => expect(response.status(), await response.text()).toBe(status);

export async function createProject(
  api: APIRequestContext,
  pack: Pack,
  name: string,
): Promise<string> {
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

export async function approveAndMakeActors(
  api: APIRequestContext,
  id: string,
  revision: number,
): Promise<void> {
  await said(
    await api.post(`/api/projects/${id}/stakeholders/approve`, {
      data: { expectedRevision: revision },
    }),
    200,
  );
  await said(await api.post(`/api/projects/${id}/actors/generate`, { data: {} }), 201);
}

/** An example, found by reading the text with the rules: nothing about it is written here. */
export async function seedExample(
  api: APIRequestContext,
  exampleId: (typeof EXAMPLE_SCENARIOS)[number]['id'],
  name = 'Simulate',
): Promise<string> {
  const example = EXAMPLE_SCENARIOS.find((candidate) => candidate.id === exampleId)!;
  const id = await createProject(api, example, `${name}: ${example.title}`);
  const found = await api.post(`/api/projects/${id}/stakeholders/discover`, {
    data: { mode: 'rules' },
  });
  await said(found, 201);
  await approveAndMakeActors(api, id, ((await found.json()) as { revision: number }).revision);
  return id;
}

/** A question of the person's own, with the stakeholders they wrote down. */
export async function seedByHand(
  api: APIRequestContext,
  name: string,
  stakeholders: Stakeholder[] = BUS_STAKEHOLDERS,
  relations: typeof BUS_RELATIONS | [] = BUS_RELATIONS,
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
export async function seedHeavy(api: APIRequestContext, name: string): Promise<string> {
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
 * Gives the members of every group the same impact, so that a cast in which nobody has a direction has nothing for the
 * change to land on. The cast the pages make leaves them a spread around it, which moves members in either direction
 * while nobody is set as helped or harmed.
 */
export async function freezeImpacts(api: APIRequestContext, id: string): Promise<void> {
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

/** The scenario, the approved stakeholders and the actors made from them, for the rules, over HTTP. */
export async function rename(api: APIRequestContext, id: string, name: string): Promise<void> {
  const view = (await (await api.get(`/api/projects/${id}/stakeholders`)).json()) as {
    revision: number;
    stakeholders: {
      stakeholders: { id: string; name: string; status: string }[];
      relations: unknown[];
    };
  };
  const set = view.stakeholders;
  const first = set.stakeholders.find((stakeholder) => stakeholder.status !== 'removed')!;
  await said(
    await api.put(`/api/projects/${id}/stakeholders`, {
      data: {
        expectedRevision: view.revision,
        relations: set.relations,
        stakeholders: set.stakeholders.map((stakeholder) =>
          stakeholder.id === first.id ? { ...stakeholder, name } : stakeholder,
        ),
      },
    }),
    200,
  );
}

// ---------------------------------------------------------------------------------------------
// Comparisons over HTTP
// ---------------------------------------------------------------------------------------------

export async function startViaApi(
  api: APIRequestContext,
  id: string,
  data: object = {},
): Promise<AnalysisJson> {
  const response = await api.post(`/api/projects/${id}/analysis`, { data });
  await said(response, 202);
  return ((await response.json()) as { analysis: AnalysisJson }).analysis;
}

export const readViaApi = async (
  api: APIRequestContext,
  id: string,
  analysis: string,
): Promise<AnalysisJson> =>
  (
    (await (await api.get(`/api/projects/${id}/analysis/${analysis}`)).json()) as {
      analysis: AnalysisJson;
    }
  ).analysis;

/** Waits for a comparison to stop, however it stops, and reads it. */
export async function finished(
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

/** Starts a comparison and waits for it to finish. */
export async function compared(
  api: APIRequestContext,
  id: string,
  data: object = { runsPerVariant: 10 },
): Promise<AnalysisJson> {
  const done = await finished(api, id, (await startViaApi(api, id, data)).id);
  expect(done.status).toBe('completed');
  return done;
}

/** The newest comparison of a project, which is the one the page shows once it has finished. */
export async function latestId(api: APIRequestContext, project: string): Promise<string> {
  const listed = await api.get(`/api/projects/${project}/analysis`);
  return ((await listed.json()) as { analyses: { id: string }[] }).analyses[0]!.id;
}

/** Whether a project already has a finished comparison, so that the audits share one. */
export async function hasFinished(api: APIRequestContext, project: string): Promise<boolean> {
  const listed = (await (await api.get(`/api/projects/${project}/analysis`)).json()) as {
    analyses: { status: string }[];
  };
  return listed.analyses.some((analysis) => analysis.status === 'completed');
}

/** Stops anything still running on a project, so that a failing test does not leave the server busy for the next. */
export async function stopEverything(api: APIRequestContext, id: string): Promise<void> {
  const listed = await api.get(`/api/projects/${id}/analysis`);
  if (!listed.ok()) return;
  const { analyses } = (await listed.json()) as { analyses: { id: string; status: string }[] };
  for (const analysis of analyses.filter((item) => ['running', 'queued'].includes(item.status))) {
    await api.post(`/api/projects/${id}/analysis/${analysis.id}/cancel`);
    await finished(api, id, analysis.id);
  }
}

// ---------------------------------------------------------------------------------------------
// The simulation, as the page shows it
// ---------------------------------------------------------------------------------------------

export const simulateAt = (project: string, view?: string): string =>
  addressOf({ project, scene: 'simulate', ...(view ? { view } : {}) });

export const compareAt = (project: string, view?: string): string =>
  addressOf({ project, scene: 'compare', ...(view ? { view } : {}) });

export const THEATRE_VIEWS = ['Story', 'Live', 'Network', 'Timeline'] as const;
export type TheatreView = (typeof THEATRE_VIEWS)[number];

/** The page that sets the futures side by side: its heading is the way to know it is the one on show. */
export const setup = (page: Page): Locator =>
  page.getByRole('region', { name: 'Set the futures side by side' });

export const scenarioRows = (page: Page): Locator =>
  setup(page).getByRole('list', { name: 'Scenarios to compare' }).getByRole('listitem');

/** The simulation that has finished: the theatre, in whichever view is open. */
export const theatre = (page: Page): Locator => page.getByRole('region', { name: 'Simulation' });

/** The way to look at a finished simulation, by the name of the view. */
export const viewChoice = (page: Page, view: TheatreView): Locator =>
  page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: view });

export const roundSlider = (page: Page): Locator => page.getByRole('slider', { name: 'Round' });

/** Opens a project's setup, which is where a person who has no finished simulation starts. */
export async function openSetup(page: Page, project: string): Promise<void> {
  await page.goto(simulateAt(project, 'setup'));
  await settled(page);
  await expect(setup(page)).toBeVisible();
}

/** Moves a slider with the keys it answers to, to the value asked for. */
async function slideTo(thumb: Locator, value: number, step: number): Promise<void> {
  await thumb.focus();
  const now = Number(await thumb.getAttribute('aria-valuenow'));
  const presses = Math.round((value - now) / step);
  for (let press = 0; press < Math.abs(presses); press += 1)
    await thumb.press(presses > 0 ? 'ArrowRight' : 'ArrowLeft');
  await expect(thumb).toHaveAttribute('aria-valuenow', String(value));
}

/** What the person sets for one scenario: its name, how strongly it lands (0 to 1) and the round it starts in. */
export async function setScenario(
  row: Locator,
  values: { name?: string; intensity?: number; round?: number },
): Promise<void> {
  if (values.name !== undefined)
    await row.getByRole('textbox', { name: /^Name of scenario/u }).fill(values.name);
  if (values.intensity !== undefined)
    await slideTo(
      row.getByRole('slider', { name: /^How strongly .* lands$/u }),
      values.intensity,
      0.05,
    );
  if (values.round !== undefined) {
    const group = row.getByRole('group', { name: /^Round the change starts in for/u });
    const value = group.getByRole('status');
    const now = Number(await value.innerText());
    const button = values.round > now ? /^Later:/u : /^Earlier:/u;
    for (let press = 0; press < Math.abs(values.round - now); press += 1)
      await group.getByRole('button', { name: button }).click();
    await expect(value).toHaveText(String(values.round));
  }
}

export async function chooseRuns(page: Page, runs: number): Promise<void> {
  await setup(page)
    .getByRole('radiogroup', { name: 'Seeded runs of each scenario' })
    .getByRole('radio', { name: String(runs), exact: true })
    .click();
}

export const startButton = (page: Page): Locator =>
  setup(page).getByRole('button', { name: 'Run the simulation' });

/** Presses the button that starts the simulation. */
export async function run(page: Page): Promise<void> {
  await startButton(page).click();
}

/** The progress of a simulation that is running, where the person is looking. */
export const progress = (page: Page): Locator =>
  page.getByRole('progressbar', { name: 'Simulation progress' });

/** The simulation is done and its theatre is on show: a finished simulation always has a way to move along its rounds. */
export async function waitForTheatre(page: Page): Promise<void> {
  await expect(theatre(page)).toBeVisible({ timeout: 120_000 });
}

/** Switches to a view of the theatre by pressing its name, and waits for the address to say so. */
export async function showView(page: Page, view: TheatreView): Promise<void> {
  await viewChoice(page, view).click();
  await expect(viewChoice(page, view)).toBeChecked();
}

/** What the page's main region says, as one text, for the checks about what it claims. */
export const mainText = (page: Page): Promise<string> => page.getByRole('main').innerText();

/**
 * No sentence of a page says what will happen, or presents a figure as a rate in the world: the same judge as the rest
 * of the product is held to, applied to the sentences the main region says in its own voice. The answers to what a
 * simulation is (not a prediction, not a forecast) are the sentences that may use the words.
 */
export async function expectNoForecasts(page: Page, label: string): Promise<void> {
  const prose = await page
    .getByRole('main')
    .locator('p, li, h1, h2, h3, dd, figcaption')
    .evaluateAll((elements) =>
      elements
        .filter((element) => !element.closest('svg, table, [role=img], blockquote, [role=meter]'))
        .map((element) => (element.textContent ?? '').replace(/\s+/gu, ' ').trim())
        .filter((text) => text.split(' ').length >= 6),
    );
  expect(prose.length, `${label}: there is prose to judge`).toBeGreaterThan(0);
  expect(
    prose.flatMap((text) => claimsAgainst(text)),
    `${label}: claims the product may not make`,
  ).toEqual([]);
}
