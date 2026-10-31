import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_PROJECTS } from '../../shared/demo';
import { Repository } from '../../backend/src/storage/repository';
import { seedDemo } from '../../scripts/demo/lib/seed';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  viewports,
} from '../support/helpers';

// The presentation, performed in a real browser, step for step. It runs in two places:
//
//  - Live (JOURNEY_URL is set, `npm run demo:journey`): against the server that will be shown, with
//    a real model. It asks the analyst and an actor new questions and spends a few model calls.
//  - In CI: against a local-engine server that holds the committed recording. Without a model it
//    cannot ask new questions, so it reads the recorded conversation instead; every other step is
//    the same.
//
// Everything on the way is held to the same rules: no console error or warning, no failed API call,
// no spinner left running, no horizontal overflow, and nothing in a page or an API answer that looks
// like a credential or a private Azure identifier.
const LIVE = Boolean(process.env.JOURNEY_URL);
const ASK = LIVE && process.env.JOURNEY_ASK !== '0';
const SCREENS = process.env.JOURNEY_SCREENSHOTS;
const ABSTENTION = 'The available project evidence does not support a confident answer.';
const POSITIONING =
  'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.';
const [BASE, GUARANTEE, NO_NOTICE] = DEMO_PROJECTS as [
  (typeof DEMO_PROJECTS)[number],
  (typeof DEMO_PROJECTS)[number],
  (typeof DEMO_PROJECTS)[number],
];

const LEAKS: [string, RegExp][] = [
  [
    'a cloud host',
    /[a-z0-9-]+\.(?:openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com|azure-api\.net|blob\.core\.windows\.net|database\.windows\.net|vault\.azure\.net|servicebus\.windows\.net|azurewebsites\.net)/iu,
  ],
  ['a token', /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/u],
  ['a bearer credential', /\bBearer\s+[\w.~+/-]{20,}/u],
  ['an API key', /\b(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})/u],
];
// Anything the person running this must keep private (endpoint host, tenant, subscription), passed
// in by the environment so that it is never written into the repository.
const FORBIDDEN = (process.env.JOURNEY_FORBIDDEN ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.length >= 6);

type StageName = 'Graph Build' | 'Env Setup' | 'Simulation' | 'Report' | 'Interaction';

interface Watch {
  problems: string[];
  scanned: number;
}

function scan(text: string, where: string, watch: Watch): void {
  watch.scanned += text.length;
  const lower = text.toLowerCase();
  for (const [label, pattern] of LEAKS) {
    if (pattern.test(text)) watch.problems.push(`${where} shows ${label}`);
  }
  for (const value of FORBIDDEN) {
    if (lower.includes(value)) watch.problems.push(`${where} shows a value that must stay private`);
  }
}

function watchPage(page: Page): Watch {
  const watch: Watch = { problems: [], scanned: 0 };
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      watch.problems.push(`console ${message.type()}: ${message.text().slice(0, 200)}`);
    }
  });
  page.on('pageerror', (error) => watch.problems.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => {
    // A request the page cancelled itself (leaving a stage while it loads) is not a failure.
    const reason = request.failure()?.errorText ?? '';
    if (reason !== 'net::ERR_ABORTED') {
      watch.problems.push(
        `request failed: ${request.method()} ${new URL(request.url()).pathname} ${reason}`,
      );
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/')) return;
    if (response.status() >= 400) {
      watch.problems.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
    }
    const type = response.headers()['content-type'] ?? '';
    if (/json|text/u.test(type)) {
      void response.text().then(
        (text) => scan(text, `API answer ${url.pathname}`, watch),
        () => undefined,
      );
    }
  });
  return watch;
}

const stageButton = (page: Page, name: StageName): Locator =>
  page
    .getByRole('navigation', { name: 'Guided workflow steps' })
    .getByRole('button', { name: new RegExp(`^${name}`, 'u') });

async function goTo(page: Page, name: StageName): Promise<Locator> {
  await stageButton(page, name).click();
  const workbench = page.getByRole('region', { name: `${name} workbench` });
  await expect(workbench).toBeVisible();
  return workbench;
}

/** The checks every screen must pass before the journey moves on. */
async function settled(page: Page, watch: Watch, label: string): Promise<void> {
  await expect(page.locator('.spin:visible'), `${label}: a spinner is still running`).toHaveCount(
    0,
  );
  await expectNoHorizontalOverflow(page);
  scan(await page.content(), `${label}: page`, watch);
  expect(watch.problems, label).toEqual([]);
}

async function shot(page: Page, name: string): Promise<void> {
  if (SCREENS) await page.screenshot({ path: join(SCREENS, `${name}.png`) });
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

interface LedgerClaim {
  id: string;
  text: string;
  supportClass: string;
  supporting: { passageId: string; quote: string }[];
  contradicting: { passageId: string; quote: string }[];
}

test.describe.configure({ mode: 'serial' });

test('the checks the journey relies on do fail when they should', async ({ page }) => {
  // A guard that has never failed has not been shown to work. Each of these plants one thing the
  // journey must catch and requires that the shared checks refuse it.
  const watch = watchPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const caught = async (label: string, plant: () => Promise<void>): Promise<void> => {
    watch.problems.length = 0;
    await plant();
    await expect(settled(page, watch, label), `${label} must be caught`).rejects.toThrow();
    watch.problems.length = 0;
  };

  await settled(page, watch, 'a clean page');
  await caught('a console error', () => page.evaluate(() => console.error('planted failure')));
  await caught('a console warning', () => page.evaluate(() => console.warn('planted warning')));
  await caught('a failed API call', async () => {
    await page.evaluate(() => fetch('/api/projects/00000000-0000-4000-8000-0000000000ff'));
    await expect.poll(() => watch.problems.length).toBeGreaterThan(0);
  });
  await caught('a credential-shaped string on the page', () =>
    page.evaluate(() => {
      const note = document.createElement('p');
      note.textContent = `Bearer ${'a1B2c3D4'.repeat(4)}`;
      document.body.append(note);
    }),
  );
  await caught('a private cloud host on the page', () =>
    page.evaluate(() => {
      const note = document.createElement('p');
      note.textContent = 'https://planted-resource.openai.azure.com/';
      document.body.append(note);
    }),
  );
  await caught('horizontal overflow', () =>
    page.evaluate(() => {
      const wide = document.createElement('div');
      wide.style.cssText = 'width:4000px;height:10px';
      wide.id = 'planted-wide';
      document.body.append(wide);
    }),
  );
  await page.evaluate(() => document.getElementById('planted-wide')?.remove());
  await caught('a spinner that never stops', () =>
    page.evaluate(() => {
      const spin = document.createElement('span');
      spin.className = 'spin';
      spin.textContent = 'loading';
      spin.id = 'planted-spin';
      document.body.append(spin);
    }),
  );
});

test.beforeAll(async () => {
  if (SCREENS) mkdirSync(SCREENS, { recursive: true });
  if (LIVE) return;
  const root = process.env.E2E_DATA_ROOT;
  if (!root) throw new Error('E2E_DATA_ROOT is not set: this runs under playwright.config.ts.');
  const repository = new Repository(join(root, 'journey', 'swarm-lab.sqlite'));
  try {
    seedDemo(repository, { directory: 'docs/demo/seed' });
  } finally {
    repository.close();
  }
});

test('the presentation, step by step, in a real browser', async ({
  page,
  playwright,
}, testInfo) => {
  // Each axe scan is a whole-page scan, which takes seconds on a quiet machine and a minute on a
  // saturated one: the same walk took 6.9 and 11.7 minutes on one machine kept busy by other work,
  // and well under two on a CI runner. The budget is for the slow case, not an allowance for a hung
  // step: every action and assertion still has its own short timeout.
  test.setTimeout(20 * 60_000);
  const baseURL = testInfo.project.use.baseURL!;
  const api = await playwright.request.newContext({ baseURL });
  const watch = watchPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const steps: { step: string; ms: number }[] = [];
  const run = async (name: string, body: () => Promise<void>): Promise<void> => {
    const begun = Date.now();
    await test.step(name, body);
    steps.push({ step: name, ms: Date.now() - begun });
  };

  const catalogue = JSON.parse(await readFile('docs/demo/demos.json', 'utf8')) as {
    demos: { slug: string; question: string; files: string[] }[];
  };
  const pack = catalogue.demos.find((demo) => demo.slug === 'larkholm-ferry')!;
  let claims: LedgerClaim[] = [];
  let createdBranch: string | null = null;

  await run('1. Open Swarm', async () => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Swarm/u);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await settled(page, watch, 'home');
  });

  await run('2. See professional product positioning', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What could happen if…?');
    const path = page.getByRole('list', { name: 'How Swarm works' }).getByRole('listitem');
    await expect(path).toHaveCount(8);
    await expect(path.first()).toContainText('Evidence');
    await expect(path.last()).toContainText('Decision');
    await expect(page.getByText(/turns it into a scenario from your evidence/u)).toBeVisible();
    await expectNoAxeViolations(page, 'home');
    await shot(page, '01-home');
  });

  await run('3. See that Swarm explores scenarios and does not guarantee or predict', async () => {
    const statement = page.getByText(POSITIONING, { exact: true });
    await expect(statement).toBeVisible();
    const box = (await statement.boundingBox())!;
    expect(box.y + box.height, 'the statement is on the first screen').toBeLessThan(900);
    await expect(page.getByText(/Fictional scenarios, not forecasts/u).first()).toBeVisible();
  });

  await run('4. Open the demonstration workspace', async () => {
    const workspace = page.getByRole('region', { name: 'Demonstration workspace' });
    await expect(workspace).toBeVisible();
    await expect(workspace).toContainText('every source, organisation and person is fictional');
    for (const demo of DEMO_PROJECTS) {
      await expect(
        workspace.getByRole('button', { name: `Open project: ${demo.title}` }),
        `${demo.title} is in this workspace (restore it with npm run demo:seed)`,
      ).toBeEnabled();
    }
    await expect(workspace).not.toContainText('Not loaded');
    await expectTargetSizes(page, 'home');
    await expectReadableText(page, 'home');
    await workspace.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await shot(page, '02-workspace');
  });

  await run('5. Open a polished synthetic project', async () => {
    await page
      .getByRole('region', { name: 'Demonstration workspace' })
      .getByRole('button', { name: `Open project: ${BASE.title}` })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: BASE.title })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`project=${BASE.id}`, 'u'));
    await expect(page.getByText('completed', { exact: true }).first()).toBeVisible();
    await expect(page.locator('main').getByText('REAL AZURE AI')).toBeVisible();
    await settled(page, watch, 'project');
  });

  await run('6. Review the decision question', async () => {
    await expect(
      page.locator('.project-identity').getByText(pack.question, { exact: true }),
    ).toBeVisible();
  });

  await run('7. Review the source documents', async () => {
    const workbench = await goTo(page, 'Graph Build');
    const inspection = workbench.getByRole('heading', { level: 3, name: 'Source inspection' });
    await inspection.scrollIntoViewIfNeeded();
    for (const file of pack.files) {
      await expect(
        workbench.getByRole('button', { name: new RegExp(file.replace('.', '\\.'), 'u') }),
      ).toBeVisible();
    }
    await workbench.getByRole('button', { name: /^01-council-briefing-note\.md/u }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('412,000');
    await expectNoAxeViolations(page, 'source document');
    await shot(page, '03-source-document');
    await closeDialog(page);
  });

  await run('8. Inspect the extracted evidence and claims', async () => {
    const workbench = page.getByRole('region', { name: 'Graph Build workbench' });
    await workbench.getByRole('button', { name: 'Browse evidence' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.evidence-chunk').first()).toBeVisible();
    expect(await dialog.locator('.evidence-chunk').count()).toBeGreaterThanOrEqual(5);
    await dialog.getByRole('searchbox', { name: 'Search source evidence' }).fill('subsidy ceiling');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(dialog.locator('.evidence-chunk').first()).toContainText('1.8');
    await closeDialog(page);

    await goTo(page, 'Report');
    const ledger = page.getByRole('region', { name: 'Evidence ledger' });
    await ledger.scrollIntoViewIfNeeded();
    await expect(ledger).toContainText(/\d+ statements/u);
    expect(await ledger.locator('.ledger-claim').count()).toBeGreaterThanOrEqual(20);
    expect(await ledger.locator('.ledger-claim .tone-chip:not(:has(svg))').count()).toBe(0);
    await shot(page, '04-ledger');
  });

  await run('9. Inspect the contradictory evidence', async () => {
    const ledger = page.getByRole('region', { name: 'Evidence ledger' });
    await expect(
      ledger.getByRole('heading', { level: 3, name: 'Conflicts between sources (1 open of 1)' }),
    ).toBeVisible();
    for (const text of [
      '01-council-briefing-note.md',
      '02-ferry-operator-feasibility-memo.md',
      '412,000',
      '365,000',
      'Neither passage is declared true',
    ]) {
      await expect(ledger).toContainText(text);
    }
    await expect(ledger.getByRole('button', { name: 'Confirm conflict' })).toBeVisible();
    await expectNoAxeViolations(page, 'conflict review');
    await ledger
      .getByRole('heading', { level: 3, name: /^Conflicts between sources/u })
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await shot(page, '05-conflict');
  });

  await run('10. Inspect the assumptions', async () => {
    const ledger = page.getByRole('region', { name: 'Evidence ledger' });
    await expect(
      ledger.getByRole('heading', {
        level: 3,
        name: /Assumptions behind the simulated results \(6\)/u,
      }),
    ).toBeVisible();
    await expect(ledger).toContainText('inputs, not findings');
    const total = await ledger.locator('.ledger-claim').count();
    const dependent = ledger.locator('.assumption .text-button:not([disabled])').first();
    await dependent.click();
    await expect(dependent).toHaveAttribute('aria-pressed', 'true');
    const shown = await ledger.locator('.ledger-claim').count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(total);
    await shot(page, '06-assumptions');
    await ledger.getByRole('button', { name: 'Clear filters' }).click();
    await expect(ledger.locator('.ledger-claim')).toHaveCount(total);
  });

  await run('11. Inspect the scenario graph, and its keyboard alternative', async () => {
    const workbench = await goTo(page, 'Graph Build');
    const graph = page.getByRole('region', {
      name: 'Interactive source graph and simulated overlays',
    });
    await expect(graph).toContainText('11 N · 13 E');
    expect(
      await graph.getByRole('button', { name: /source .*\. Inspect/u }).count(),
    ).toBeGreaterThanOrEqual(11);
    const overlays = graph.getByRole('checkbox', { name: 'Simulated overlays' });
    await overlays.uncheck();
    expect(await graph.getByRole('button', { name: /simulated SIMULATED/u }).count()).toBe(0);
    await overlays.check();
    await page.getByRole('combobox', { name: /Inspect node/u }).selectOption({ index: 1 });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/source/iu);
    await expectNoAxeViolations(page, 'graph node');
    await shot(page, '07-graph');
    await closeDialog(page);
    await expect(workbench).toBeVisible();
  });

  await run('12. Inspect the synthetic actors, and see where editing is closed', async () => {
    const workbench = await goTo(page, 'Env Setup');
    const population = workbench.getByRole('heading', {
      level: 3,
      name: 'Fictional persona population',
    });
    await population.scrollIntoViewIfNeeded();
    await expect(workbench).toContainText('6 FIXED PROXIES');
    for (const name of [
      'Cllr Norton',
      'Ms. Harper',
      'Mr. Rae',
      'Ms. Lin',
      'Mr. Choi',
      'Mrs. Fulton',
    ]) {
      await expect(workbench.getByText(name).first()).toBeVisible();
    }
    await expect(
      workbench.getByText('Fictional proxies, not digital copies of people'),
    ).toBeVisible();
    await expect(workbench).toContainText(
      'Read-only recorded environment. Editing closes when simulation starts.',
    );
    await shot(page, '08-actors');
  });

  await run('13. Inspect how the simulation was configured', async () => {
    const workbench = page.getByRole('region', { name: 'Env Setup workbench' });
    await expect(
      workbench.getByRole('spinbutton', { name: 'Rounds per selected platform' }),
    ).toHaveValue('6');
    await expect(
      workbench.getByRole('spinbutton', { name: 'Scenario minutes / round' }),
    ).toHaveValue('30');
    await expect(workbench.getByRole('checkbox', { name: /Info Plaza/u })).toBeChecked();
    await expect(workbench.getByRole('checkbox', { name: /Topic Community/u })).toBeChecked();
    expect(await workbench.getByText(/ASSUMED INPUT · P\d/u).count()).toBeGreaterThanOrEqual(4);
    // The inputs are shown, and closed: a recorded run is never rewritten.
    await expect(workbench.getByRole('textbox', { name: 'Seed text' }).first()).toBeDisabled();
    await expectNoAxeViolations(page, 'environment');
  });

  await run('14. Replay the recorded simulation', async () => {
    const workbench = await goTo(page, 'Simulation');
    const trajectory = workbench.getByRole('img', {
      name: /Current run — recorded combined trajectory/u,
    });
    await expect(trajectory).toBeVisible();
    await expect(trajectory).toHaveAccessibleName(/6 recorded round positions/u);
    await workbench.getByRole('button', { name: 'Show trajectory data table' }).click();
    const table = workbench.getByRole('table').first();
    await expect(table).toBeVisible();
    expect(await table.locator('tbody tr').count()).toBeGreaterThanOrEqual(6);
    await expect(workbench).toContainText('Info Plaza');
    await expect(workbench).toContainText('Topic Community');
    const platforms = workbench.getByRole('group', { name: 'Recorded platform stream' });
    await platforms.getByRole('button', { name: 'Topic Community' }).click();
    await expect(platforms.getByRole('button', { name: 'Topic Community' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectNoAxeViolations(page, 'simulation');
    await shot(page, '09-simulation');
  });

  await run('15. Inspect actor decisions and the reasons they gave', async () => {
    const workbench = page.getByRole('region', { name: 'Simulation workbench' });
    await workbench
      .getByRole('combobox', { name: 'Fictional proxy' })
      .selectOption({ label: 'Proxy 3: Mr. Rae' });
    const records = workbench.locator('article');
    await expect(records.first()).toBeVisible();
    const count = await records.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let index = 0; index < Math.min(count, 4); index += 1) {
      await expect(records.nth(index)).toContainText('Proxy 3: Mr. Rae');
    }
    await expect(records.first()).toContainText('Stated reason');
    await expect(records.first()).toContainText('not hidden reasoning');
    await expect(records.first()).toContainText(/Self-reported firmness \d+%/u);
    await shot(page, '10-decisions');
  });

  await run('16. Inspect several rounds, and see that the actors decide differently', async () => {
    const workbench = page.getByRole('region', { name: 'Simulation workbench' });
    await workbench.getByRole('combobox', { name: 'Fictional proxy' }).selectOption({ index: 0 });
    const seen = new Map<string, number>();
    for (const round of ['1', '3', '4', '6']) {
      await workbench.getByRole('combobox', { name: 'Round', exact: true }).selectOption(round);
      const records = workbench.locator('article');
      await expect(records.first()).toBeVisible();
      for (const text of await records.allInnerTexts()) {
        expect(text, `a round ${round} record`).toContain(`R${round} ·`);
      }
      seen.set(round, await records.count());
    }
    expect(seen.size).toBe(4);
    await workbench
      .getByRole('combobox', { name: 'Round', exact: true })
      .selectOption({ index: 0 });
    const project = (await (await api.get(`/api/projects/${BASE.id}`)).json()) as {
      rounds: { meanOpinion: number }[];
      agents: { opinion: number; initialOpinion: number }[];
    };
    expect(project.rounds).toHaveLength(6);
    expect(
      new Set(project.rounds.map((round) => round.meanOpinion.toFixed(2))).size,
    ).toBeGreaterThanOrEqual(4);
    expect(
      new Set(project.agents.map((agent) => agent.opinion.toFixed(1))).size,
    ).toBeGreaterThanOrEqual(3);
    expect(project.agents.some((agent) => agent.initialOpinion < 0)).toBe(true);
    expect(project.agents.some((agent) => agent.initialOpinion > 0)).toBe(true);
  });

  await run('17. Branch at a checkpoint: the branch opens paused and ready to resume', async () => {
    await goTo(page, 'Simulation');
    await page.getByRole('button', { name: 'Branch from here' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Last round to copy unchanged').selectOption('2');
    await dialog.getByRole('radio', { name: 'Replace with a future intervention' }).check();
    await dialog.getByLabel('Apply before round').selectOption('4');
    await dialog
      .getByLabel(/Intervention label/u)
      .fill('Assumed journey rehearsal: a fare freeze announced before round four');
    await dialog.getByLabel(/Assumed stance/u).fill('0.7');
    await dialog.getByLabel(/Assumed strength/u).fill('0.6');
    await dialog.getByLabel(/New project name/u).fill('Journey rehearsal branch');
    // Actors can be edited where the product supports it: on a branch, before it is resumed.
    await dialog.getByRole('button', { name: 'Add proxy assumption edit' }).click();
    await dialog.getByLabel('Openness (0–1)').fill('0.9');
    await expectNoAxeViolations(page, 'branch dialog');
    await shot(page, '11-branch-dialog');
    await dialog.getByRole('button', { name: 'Create branch and open it' }).click();
    await expect(page.getByText(/Branched from .* at round 2/u).first()).toBeVisible();
    await expect(page.getByText(/Paused after round 2 of 6/u).first()).toBeVisible();
    createdBranch = new URL(page.url()).searchParams.get('project');
    expect(createdBranch).toMatch(/^[0-9a-f-]{36}$/u);
    const branch = (await (await api.get(`/api/projects/${createdBranch}`)).json()) as {
      parentId: string;
      rounds: unknown[];
      agents: { openness: number }[];
    };
    expect(branch.parentId).toBe(BASE.id);
    expect(branch.rounds).toHaveLength(2);
    expect(branch.agents.some((agent) => agent.openness === 0.9)).toBe(true);
    // Resume is offered. It is not pressed here against a real model: that would spend minutes of
    // model time. Resuming is exercised on the local engine by e2e/local/journey.spec.ts, and
    // against the real model by npm run azure:verify.
    await expect(page.getByRole('button', { name: /^Resume/u })).toBeEnabled();
    await settled(page, watch, 'paused branch');
  });

  await run('18. Introduce an intervention at the checkpoint', async () => {
    await page.getByText(/Edit scheduled intervention/u).click();
    await page.getByLabel('Apply before round').selectOption('5');
    await page
      .getByLabel(/Intervention label/u)
      .fill('Assumed journey rehearsal: a fare cap announced before round five');
    await page.getByLabel(/Assumed stance/u).fill('0.8');
    await page.getByLabel(/Assumed strength/u).fill('0.7');
    await shot(page, '12-intervention');
    await page.getByRole('button', { name: 'Save future intervention' }).click();
    await expect(page.getByText(/Recorded schedule: round 5/u)).toBeVisible();
    const branch = (await (await api.get(`/api/projects/${createdBranch}`)).json()) as {
      settings: { intervention: { round: number; label: string } | null };
    };
    expect(branch.settings.intervention).toMatchObject({ round: 5 });
    expect(branch.settings.intervention?.label).toContain('fare cap announced before round five');
  });

  await run('19. Open the recorded branches', async () => {
    await page.getByRole('button', { name: 'Back to entry console' }).click();
    const workspace = page.getByRole('region', { name: 'Demonstration workspace' });
    await workspace.getByRole('button', { name: `Open project: ${GUARANTEE.title}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: GUARANTEE.title })).toBeVisible();
    const lineage = page.getByRole('region', { name: 'Recorded branch lineage' });
    await expect(lineage).toBeVisible();
    await expect(lineage).toContainText(BASE.title);
    await expect(lineage).toContainText(/round 3/u);
    await settled(page, watch, 'recorded branch');
    await shot(page, '13-branch');
  });

  await run('20. Compare the branches', async () => {
    await page.getByRole('button', { name: 'Compare with parent' }).click();
    await expect(page.getByRole('heading', { name: 'Compare recorded runs' })).toBeVisible();
    await expect(page.getByText('Identical through round 3')).toBeVisible();
    await expect(page.getByRole('img', { name: /recorded run comparison/u }).first()).toBeVisible();
    await expect(page.getByRole('table', { name: /Per-round recorded values/u })).toBeVisible();
    await expect(page.getByText(/not forecasts/u).first()).toBeVisible();
    await expectNoAxeViolations(page, 'comparison');
    await shot(page, '14-compare');
    await page.getByRole('button', { name: 'Back to current stage' }).click();

    // The two recorded branches are siblings: the server says so, and the numbers differ after round 3.
    const siblings = (await (
      await api.get(`/api/projects/${GUARANTEE.id}/compare?with=${NO_NOTICE.id}`)
    ).json()) as { lineage: string; identicalThroughRound: number };
    expect(siblings.lineage).toBe('siblings');
    expect(siblings.identicalThroughRound).toBe(3);
  });

  await run('21. Open the report', async () => {
    await page.getByRole('button', { name: 'Back to entry console' }).click();
    await page
      .getByRole('region', { name: 'Demonstration workspace' })
      .getByRole('button', { name: `Open project: ${BASE.title}` })
      .click();
    await goTo(page, 'Report');
    const reader = page.getByRole('region', { name: 'Scenario report chapter reader' });
    // The project name is the one page heading; the report's own title is a section heading.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(reader.locator('.report-title').getByRole('heading', { level: 2 })).toContainText(
      'Larkholm',
    );
    const chapters = reader
      .getByRole('navigation', { name: 'Recorded report chapters' })
      .getByRole('button');
    await expect(chapters).toHaveCount(5);
    await chapters.nth(1).click();
    await expect(
      reader.getByRole('heading', { level: 2, name: /Economic Impacts/u }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Boundaries of this scenario' }),
    ).toBeVisible();
    await expect(page.getByText(/not a calibrated forecast/u).first()).toBeVisible();
    await settled(page, watch, 'report');
    await shot(page, '15-report');
  });

  await run('22. Select a material report statement', async () => {
    claims = (
      (await (await api.get(`/api/projects/${BASE.id}/ledger`)).json()) as {
        claims: LedgerClaim[];
      }
    ).claims;
    const supported = claims.find(
      (claim) => claim.supportClass === 'directly-supported' && claim.supporting.length > 0,
    )!;
    const row = page.locator(`#ledger-row-${supported.id}`);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const inspector = page.locator('.claim-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { level: 3 })).toHaveText(supported.text);
    await expect(inspector.getByRole('heading', { level: 3 })).toBeFocused();
    for (const label of ['How it was checked', 'Why this class', 'Version']) {
      await expect(inspector).toContainText(label);
    }
  });

  await run('23. Inspect the evidence that supports it', async () => {
    const supported = claims.find(
      (claim) => claim.supportClass === 'directly-supported' && claim.supporting.length > 0,
    )!;
    const inspector = page.locator('.claim-inspector');
    expect(await inspector.locator('.evidence-list li').count()).toBeGreaterThanOrEqual(1);
    await expect(inspector).toContainText(supported.supporting[0]!.quote.slice(0, 40));
    await expectNoAxeViolations(page, 'statement inspector: supporting evidence');
    await shot(page, '16-supporting');
    await inspector.getByRole('button', { name: 'Close statement inspector' }).click();
  });

  await run('24. Inspect the evidence that contradicts a statement', async () => {
    const contradicted = claims.find((claim) => claim.contradicting.length > 0);
    expect(
      contradicted,
      'the recording holds a statement with contradicting passages',
    ).toBeDefined();
    const row = page.locator(`#ledger-row-${contradicted!.id}`);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const inspector = page.locator('.claim-inspector');
    await expect(inspector.getByRole('heading', { level: 3 })).toHaveText(contradicted!.text);
    await expect(inspector).toContainText(contradicted!.contradicting[0]!.quote.slice(0, 40));
    await expect(inspector.locator('.evidence-list')).toContainText(/contradict/iu);
    await expectNoAxeViolations(page, 'statement inspector: contradicting evidence');
    await shot(page, '17-contradicting');
    await inspector.getByRole('button', { name: 'Close statement inspector' }).click();
  });

  const conversation = async (): Promise<Locator> => {
    await goTo(page, 'Interaction');
    await page.getByRole('tab', { name: /Report chat/u }).click();
    return page.getByRole('region', { name: 'Saved conversation messages' });
  };

  await run('25. Ask the analyst a question the sources answer', async () => {
    const messages = await conversation();
    if (ASK) {
      const before = await messages.locator('article').count();
      await page
        .getByRole('textbox', { name: /Question for the report/u })
        .fill(
          'What share of the electric ferry cost would the Clean Coasts Fund pay, and on what condition?',
        );
      await page.getByRole('button', { name: 'Ask model' }).click();
      await expect(messages.locator('article')).toHaveCount(before + 2, { timeout: 4 * 60_000 });
      const answer = messages.locator('article').last();
      await expect(answer).toContainText('40%');
      await expect(answer).toContainText('Cited from project evidence');
    } else {
      // Without a model to ask, the recorded answer is what is read.
      await expect(messages).toContainText('What ceiling applies to the annual ferry subsidy');
      await expect(messages).toContainText('Cited from project evidence');
    }
    await shot(page, '18-analyst-answer');
  });

  await run('26. Verify that the analyst cites stored evidence', async () => {
    const messages = page.getByRole('region', { name: 'Saved conversation messages' });
    const answer = messages.locator('article', { hasText: 'Cited from project evidence' }).last();
    const chips = answer
      .getByRole('group', { name: 'Supporting source excerpts' })
      .getByRole('button');
    expect(await chips.count()).toBeGreaterThanOrEqual(1);
    const cited = (await chips.allInnerTexts()).map((text) => text.trim());
    const stored = (await (await api.get(`/api/projects/${BASE.id}/evidence`)).json()) as {
      matches: { id: string; text: string }[];
    };
    for (const id of cited) {
      expect(
        stored.matches.map((chunk) => chunk.id),
        `${id} is a stored passage`,
      ).toContain(id);
    }
    await chips.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const passage = stored.matches.find((chunk) => chunk.id === cited[0])!;
    await expect(dialog).toContainText(passage.text.slice(0, 30));
    await closeDialog(page);
    // The statements of the report that the answer relied on are named, too.
    await expect(answer).toContainText(/Report statements/u);
  });

  await run('27. Ask a plausible question the sources cannot answer', async () => {
    const messages = page.getByRole('region', { name: 'Saved conversation messages' });
    if (ASK) {
      const before = await messages.locator('article').count();
      await page
        .getByRole('textbox', { name: /Question for the report/u })
        .fill("What was the ferry company's total passenger revenue in 2018?");
      await page.getByRole('button', { name: 'Ask model' }).click();
      await expect(messages.locator('article')).toHaveCount(before + 2, { timeout: 60_000 });
    } else {
      await expect(messages).toContainText('What was ferry ridership in 2019?');
    }
  });

  await run(
    '28. Verify that the analyst says the evidence does not support an answer',
    async () => {
      const messages = page.getByRole('region', { name: 'Saved conversation messages' });
      const reply = messages
        .locator('article', { hasText: 'Not enough evidence to answer' })
        .last();
      await expect(reply).toBeVisible();
      const text = (await reply.locator('p').first().innerText()).trim();
      expect(
        text.startsWith(ABSTENTION),
        `"${text.slice(0, 90)}" starts with the abstention sentence`,
      ).toBe(true);
      await expect(reply).toContainText('The project does not hold evidence that answers this');
      expect(await reply.getByRole('group', { name: 'Supporting source excerpts' }).count()).toBe(
        0,
      );
      await expectNoAxeViolations(page, 'analyst abstention');
      await shot(page, '19-analyst-abstains');
    },
  );

  await run('29. Chat with one synthetic actor', async () => {
    await page.getByRole('tab', { name: /Any fictional agent/u }).click();
    const selector = page.getByLabel('Fictional agent context');
    await expect(selector).toBeVisible();
    const messages = page.getByRole('region', { name: 'Saved conversation messages' });
    if (ASK) {
      await selector.selectOption('agent-3');
      await page
        .getByRole('textbox', { name: /Question for this fictional proxy/u })
        .fill('What would reassure you about the winter timetable?');
      await page.getByRole('button', { name: /^Ask/u }).click();
      await expect(messages.locator('article')).toHaveCount(2, { timeout: 4 * 60_000 });
    } else {
      // The recorded conversation is with the Harbour Business Council's proxy.
      await selector.selectOption('agent-5');
      await expect(messages.locator('article')).toHaveCount(2);
    }
    await expect(messages).toContainText(/fictional/iu);
    const reply = messages.locator('article').last();
    expect((await reply.innerText()).length).toBeGreaterThan(80);
    await expectNoAxeViolations(page, 'actor chat');
    await shot(page, '20-actor-chat');
  });

  await run('30. Export Markdown', async () => {
    await goTo(page, 'Report');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Markdown' }).first().click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`swarm-lab-${BASE.id}.md`);
    const markdown = await readFile(await file.path(), 'utf8');
    for (const text of [
      '## Evidence ledger',
      '## Limitations',
      'Synthetic scenario, not a calibrated forecast',
      '412,000',
      '365,000',
    ]) {
      expect(markdown).toContain(text);
    }
    scan(markdown, 'the Markdown export', watch);
  });

  await run('31. Export JSON', async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`swarm-lab-${BASE.id}.json`);
    const text = await readFile(await file.path(), 'utf8');
    scan(text, 'the JSON export', watch);
    const snapshot = JSON.parse(text) as {
      schemaVersion: number;
      project: { id: string; rounds: unknown[]; report: unknown };
      evidence: unknown[];
      ledger: { claims: unknown[]; contradictions: unknown[] } | null;
      messages: unknown[];
    };
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.project.id).toBe(BASE.id);
    expect(snapshot.project.rounds).toHaveLength(6);
    expect(snapshot.project.report).not.toBeNull();
    expect(snapshot.evidence.length).toBeGreaterThanOrEqual(5);
    expect(snapshot.ledger?.claims.length).toBeGreaterThan(0);
    expect(snapshot.ledger?.contradictions.length).toBe(1);
    expect(snapshot.messages.length).toBeGreaterThanOrEqual(6);
  });

  await run('32. Inspect the audit log', async () => {
    await page.getByRole('button', { name: 'Audit log' }).click();
    const dialog = page.getByRole('dialog', { name: 'Audit log' });
    await expect(dialog).toBeVisible();
    const table = dialog.getByRole('table');
    await expect(table).toBeVisible();
    const events = (await (await api.get(`/api/projects/${BASE.id}/audit`)).json()) as {
      events: { action: string }[];
    };
    await expect(table.locator('tbody tr')).toHaveCount(events.events.length);
    for (const text of ['Project restored from a snapshot', 'Export downloaded']) {
      await expect(table).toContainText(text);
    }
    expect(
      events.events.filter((event) => event.action === 'export.downloaded').length,
    ).toBeGreaterThanOrEqual(2);
    if (ASK) await expect(table).toContainText('Question asked');
    // It records who did what and never what was said.
    const log = await table.innerText();
    expect(log).not.toContain('Clean Coasts');
    expect(log).not.toContain('passenger revenue');
    await dialog.getByRole('button', { name: 'Verify integrity' }).click();
    await expect(dialog.getByText('Chain intact')).toBeVisible();
    await expectNoAxeViolations(page, 'audit log');
    await shot(page, '21-audit-log');
    await closeDialog(page);
  });

  await run('Clean up: delete the rehearsal branch through the history drawer', async () => {
    await page.getByRole('button', { name: /^History/u }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: 'Delete Journey rehearsal branch' }).click();
    await drawer.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(
      drawer.getByRole('button', { name: 'Delete Journey rehearsal branch' }),
    ).toHaveCount(0);
    await closeDialog(page);
    expect((await api.get(`/api/projects/${createdBranch}`)).status()).toBe(404);
    for (const demo of DEMO_PROJECTS) {
      expect((await api.get(`/api/projects/${demo.id}`)).status(), `${demo.title} remains`).toBe(
        200,
      );
    }
  });

  await run('The whole journey: nothing failed, nothing leaked', async () => {
    await settled(page, watch, 'the end');
    expect(watch.scanned).toBeGreaterThan(1_000_000);
  });

  await testInfo.attach('journey-steps.json', {
    body: JSON.stringify({ mode: LIVE ? 'live' : 'ci', askedModel: ASK, steps }, null, 2),
    contentType: 'application/json',
  });
  await api.dispose();
});

// The same screens at the sizes people use, so that nothing clips, overflows or shrinks.
for (const viewport of viewports) {
  test(`the demonstration screens fit at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const watch = watchPage(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const narrow = viewport.width <= 900;
    const check = async (label: string, axe = false): Promise<void> => {
      await settled(page, watch, `${label} at ${viewport.name}`);
      await expectReadableText(page, label);
      await expectTargetSizes(page, label);
      if (axe) await expectNoAxeViolations(page, `${label} at ${viewport.name}`);
    };
    const pane = async (name: 'Graph' | 'Report' | 'Workbench'): Promise<void> => {
      if (narrow) {
        await page
          .getByRole('group', { name: 'Console pane' })
          .getByRole('button', { name })
          .click();
      }
    };

    await page.goto('/');
    await expect(page.getByText(POSITIONING, { exact: true })).toBeVisible();
    await check('home', true);

    await page
      .getByRole('region', { name: 'Demonstration workspace' })
      .getByRole('button', { name: `Open project: ${BASE.title}` })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: BASE.title })).toBeVisible();
    await pane('Report');
    const ledger = page.getByRole('region', { name: 'Evidence ledger' });
    await ledger.scrollIntoViewIfNeeded();
    await expect(ledger).toBeVisible();
    await check('report and ledger', true);

    for (const stage of [
      'Graph Build',
      'Env Setup',
      'Simulation',
      'Report',
      'Interaction',
    ] as const) {
      await pane('Workbench');
      await stageButton(page, stage).click();
      await expect(page.getByRole('region', { name: `${stage} workbench` })).toBeVisible();
      await check(`${stage} stage`);
    }

    await page.getByRole('button', { name: 'Audit log' }).click();
    await expect(page.getByRole('dialog', { name: 'Audit log' }).getByRole('table')).toBeVisible();
    await check('audit log', true);
    await closeDialog(page);

    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compare recorded runs' })).toBeVisible();
    await check('comparison');
  });
}
