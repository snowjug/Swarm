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
  openDisclosure,
  viewports,
} from '../support/helpers';
import { expectPressable, quiet } from '../support/shell';

// The presentation, performed in a real browser, step for step. It runs in two places:
//
//  - Live (JOURNEY_URL is set, `npm run demo:journey`): against the server that will be shown, with
//    a real model. It asks the analyst and an actor new questions and spends a few model calls.
//  - In CI: against a local-engine server that holds the committed recording. Without a model it
//    cannot ask new questions, so it reads the recorded conversation instead; every other step is
//    the same.
//
// Everything on the way is held to the same rules: no console error or warning, no failed API call,
// nothing left loading, no horizontal overflow, and nothing in a page or an API answer that looks
// like a credential or a private Azure identifier.
//
// The demonstration is a run made by the engine, with its report and two branches. It was not made by
// the guided flow, so it has no stakeholder map and no decision brief; the journey shows what it does
// have: its evidence, its actors, the run round by round, a branch, the analyst, the exports and the
// audit log. The deep dive is opened by its address, because nothing on the page leads a recorded run
// to it yet.
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
    // A request the page cancelled itself (leaving a scene while it loads) is not a failure.
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

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const startsWith = (text: string): RegExp => new RegExp(`^${escaped(text)}`, 'u');
const endsWith = (text: string): RegExp => new RegExp(`${escaped(text)}$`, 'u');

/** The checks every screen must pass before the journey moves on. */
async function settled(page: Page, watch: Watch, label: string): Promise<void> {
  await expect(
    page.locator('.sw-orbit:visible, .sw-skeleton:visible, [aria-busy="true"]:visible'),
    `${label}: something is still loading`,
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  scan(await page.content(), `${label}: page`, watch);
  expect(watch.problems, label).toEqual([]);
}

/** An axe scan of a page at rest: one taken in the middle of a fade reads a colour that is not the one it ends on. */
async function axe(page: Page, label: string): Promise<void> {
  await quiet(page);
  await expectNoAxeViolations(page, label);
}

async function shot(page: Page, name: string): Promise<void> {
  if (SCREENS) await page.screenshot({ path: join(SCREENS, `${name}.png`) });
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function fromSettings(page: Page, item: string): Promise<void> {
  // A menu that was just used is still leaving: pressing the button then would be swallowed by it.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings and tools' }).click();
  const menu = page.getByRole('menu', { name: 'Settings and tools' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item }).click();
  await expect(menu).toHaveCount(0);
}

const journey = (page: Page): Locator => page.getByRole('navigation', { name: 'Journey' });

type DeepTab = 'Setup' | 'Run' | 'Rounds' | 'Memory';

/** The deep dive of a project, on the tab asked for. */
async function openDeepDive(page: Page, id: string, tab: DeepTab): Promise<Locator> {
  await page.goto(`/?project=${id}&scene=simulate&view=deep`);
  await expect(
    page.getByRole('heading', { level: 1, name: /A slower, closer look/u }),
  ).toBeVisible();
  return openTab(page, tab);
}

async function openTab(page: Page, tab: DeepTab): Promise<Locator> {
  const button = page.getByRole('tab', { name: startsWith(tab) });
  await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel');
  await expect(panel).toBeVisible();
  return panel;
}

/** The round in view, moved with the keyboard: Home is the start, then one key press for each round. */
async function toRound(panel: Locator, page: Page, round: number): Promise<void> {
  const slider = panel.getByRole('slider', { name: /^Round in view/u });
  await slider.focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < round; step += 1) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', String(round));
}

interface LedgerClaim {
  id: string;
  text: string;
  supportClass: string;
  supporting: { passageId: string; quote: string }[];
  contradicting: { passageId: string; quote: string }[];
}

test.describe.configure({ mode: 'serial' });
// A step that cannot find what it needs fails in seconds, not at the end of the test budget.
test.use({ actionTimeout: 30_000 });

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
  await caught('something that never stops loading', () =>
    page.evaluate(() => {
      const spin = document.createElement('span');
      spin.className = 'sw-orbit';
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
    console.log(`  ${name} (${((Date.now() - begun) / 1000).toFixed(1)}s)`);
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'See how a decision could unfold.',
    );
    // The path is told in five stages in plain words, which the six scenes of the journey carry out: the question (Ask),
    // research (Ground), people and constraints (Map), possible futures (Simulate and Compare) and the decision (Decide).
    // It is the story of what Swarm does, and not a second copy of the bar of scenes that appears once there is a project.
    const path = page.getByRole('list', { name: 'How Swarm works' }).getByRole('listitem');
    await expect(path).toHaveCount(5);
    await expect(path.first()).toContainText('Question');
    await expect(path.last()).toContainText('Decision');
    await expect(page.getByRole('textbox', { name: 'Your what-if question' })).toBeVisible();
    await axe(page, 'home');
    await shot(page, '01-home');
  });

  await run('3. See that Swarm explores scenarios and does not guarantee or predict', async () => {
    const statement = page.getByText(POSITIONING, { exact: true });
    await expect(statement).toBeVisible();
    const box = (await statement.boundingBox())!;
    expect(box.y + box.height, 'the statement is on the first screen').toBeLessThan(900);
  });

  await run('4. Find the recorded demonstration', async () => {
    const workspace = page.getByRole('region', { name: 'Continue' });
    await expect(
      workspace.getByRole('heading', { level: 3, name: 'Recorded demonstration' }),
    ).toBeVisible();
    await expect(workspace).toContainText('Nothing in it describes a real place');
    for (const demo of DEMO_PROJECTS) {
      await expect(
        workspace.getByRole('button', { name: startsWith(demo.title) }),
        `${demo.title} is in this workspace (restore it with npm run demo:seed)`,
      ).toBeEnabled();
    }
    await expectPressable(page, 'home');
    await expectReadableText(page, 'home');
    await workspace.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await shot(page, '02-demonstration');
  });

  await run('5. Open a polished synthetic project', async () => {
    await page
      .getByRole('region', { name: 'Continue' })
      .getByRole('button', { name: startsWith(BASE.title) })
      .click();
    await expect(page).toHaveURL(new RegExp(`project=${BASE.id}`, 'u'));
    await expect(page).toHaveTitle(new RegExp(escaped(BASE.title), 'u'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(journey(page).getByRole('button', { name: /^Ground, done/u })).toBeVisible();
    await settled(page, watch, 'project');
  });

  await run('6. Review the decision question', async () => {
    await journey(page)
      .getByRole('button', { name: startsWith('Ground') })
      .click();
    await expect(page).toHaveURL(/scene=ground/u);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(pack.question);
    await settled(page, watch, 'ground');
    await shot(page, '03-question');
  });

  await run('7. Review the source documents', async () => {
    const sources = page.getByRole('region', { name: /^Sources/u });
    await sources.scrollIntoViewIfNeeded();
    for (const file of pack.files) {
      await expect(sources.getByRole('button', { name: endsWith(file) })).toBeVisible();
    }
    await sources.getByRole('button', { name: endsWith('01-council-briefing-note.md') }).click();
    const dialog = page.getByRole('dialog', { name: '01-council-briefing-note.md' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('412,000');
    await axe(page, 'source document');
    await shot(page, '04-source-document');
    await closeDialog(page);
  });

  await run('8. Inspect the extracted evidence and the statements built from it', async () => {
    const stored = (await (await api.get(`/api/projects/${BASE.id}/evidence`)).json()) as {
      matches: { id: string }[];
    };
    expect(stored.matches.length).toBeGreaterThanOrEqual(5);
    const sources = page.getByRole('region', { name: /^Sources/u });
    await expect(sources.getByRole('button', { name: /^Passage S\d+/u })).toHaveCount(
      stored.matches.length,
    );
    claims = (
      (await (await api.get(`/api/projects/${BASE.id}/ledger`)).json()) as {
        claims: LedgerClaim[];
      }
    ).claims;
    expect(claims.length).toBeGreaterThanOrEqual(20);
    const statements = page.getByRole('region', { name: /^Statements/u });
    await statements.scrollIntoViewIfNeeded();
    await expect(statements.getByRole('heading', { level: 2 })).toContainText(
      String(claims.length),
    );
    await expect(statements).toContainText(
      'How well the sources back each statement, not whether they are true.',
    );
    await expect(
      statements.getByRole('img', { name: new RegExp(`^${claims.length} statements:`, 'u') }),
    ).toBeVisible();
    await shot(page, '05-statements');
  });

  await run('9. Inspect the evidence that supports a statement', async () => {
    const supported = claims
      .slice(0, 10)
      .find((claim) => claim.supportClass === 'directly-supported' && claim.supporting.length > 0)!;
    await page
      .getByRole('region', { name: /^Statements/u })
      .getByRole('button', { name: supported.text.slice(0, 40) })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: `Statement ${supported.id}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(supported.text.slice(0, 40));
    const passages = dialog.getByRole('region', { name: 'Cited passages' });
    await expect(passages).toContainText('Supporting');
    await expect(passages).toContainText(supported.supporting[0]!.quote.slice(0, 30));
    for (const label of ['How it was checked', 'Review']) {
      await expect(dialog).toContainText(label);
    }
    await axe(page, 'statement: supporting evidence');
    await shot(page, '06-supporting');
    await closeDialog(page);
  });

  await run('10. Inspect the evidence that contradicts a statement, and the conflict', async () => {
    const contradicted = claims.find((claim) => claim.contradicting.length > 0);
    expect(
      contradicted,
      'the recording holds a statement with contradicting passages',
    ).toBeDefined();
    await page
      .getByRole('region', { name: /^Statements/u })
      .getByRole('button', { name: contradicted!.text.slice(0, 40) })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: `Statement ${contradicted!.id}` });
    const passages = dialog.getByRole('region', { name: 'Cited passages' });
    await expect(passages).toContainText('Contradicting');
    await expect(passages).toContainText(contradicted!.contradicting[0]!.quote.slice(0, 30));
    await axe(page, 'statement: contradicting evidence');
    await shot(page, '07-contradicting');
    await closeDialog(page);

    const conflicts = page.getByRole('region', { name: /^Conflicts/u });
    await conflicts.scrollIntoViewIfNeeded();
    await expect(conflicts.getByRole('heading', { level: 2 })).toContainText('1');
    await expect(conflicts).toContainText('0 of 1 reviewed');
    await expect(conflicts).toContainText('Neither side is declared true');
    const conflict = conflicts.getByRole('article', { name: /^X1: 412,000 against 365,000/u });
    for (const text of [
      '01-council-briefing-note.md',
      '02-ferry-operator-feasibility-memo.md',
      '412,000',
      '365,000',
    ]) {
      await expect(conflict).toContainText(text);
    }
    for (const decision of ['Confirm', 'Not a conflict', 'Mark resolved']) {
      await expect(conflict.getByRole('button', { name: decision })).toBeVisible();
    }
    await axe(page, 'conflict review');
    await conflicts.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await shot(page, '08-conflict');
  });

  await run('11. Inspect the assumptions', async () => {
    const list = await openDisclosure(page, /^Assumptions/u);
    await expect(list.getByRole('listitem')).toHaveCount(6);
    await expect(list).toContainText('Intervention at round 4');
    await expect(list).toContainText('none of these is a measured value');
    await expect(list).toContainText('statements rest on it');
    await shot(page, '09-assumptions');
  });

  await run('12. Inspect the scenario graph, and its keyboard alternative', async () => {
    const graph = page.getByRole('group', { name: /^Source graph: 11 entities, 13 links/u });
    await graph.scrollIntoViewIfNeeded();
    await expect(graph).toHaveAccessibleName(/Press \[ and \] to move between them/u);
    const nodes = graph.getByRole('button', { name: /, cited in \d+ of \d+ documents$/u });
    expect(await nodes.count()).toBeGreaterThanOrEqual(11);
    // A node is a button: reached by Tab, opened by Enter, and what it opens names its sources.
    const operator = graph.getByRole('button', { name: startsWith('Larkholm Ferry Company') });
    await operator.focus();
    await page.keyboard.press('Enter');
    const details = page.getByRole('region', { name: 'Larkholm Ferry Company: details' });
    await expect(details).toBeVisible();
    await expect(details).toContainText('Quote checked character for character against S3');
    await expect(details.getByRole('region', { name: 'Cited in' })).toContainText(
      '02-ferry-operator-feasibility-memo.md',
    );
    await axe(page, 'graph node');
    await shot(page, '10-graph');
    await details.getByRole('button', { name: 'Close' }).click();
    await expect(details).toHaveCount(0);
  });

  await run('13. Inspect the synthetic actors, and see where editing is closed', async () => {
    const setup = await openDeepDive(page, BASE.id, 'Setup');
    await expect(
      page.getByText(/Proxies are fictional stand-ins, not people/u).first(),
    ).toBeVisible();
    const cast = setup.getByRole('region', { name: 'The cast' });
    await cast.scrollIntoViewIfNeeded();
    for (const name of [
      'Proxy 1: Cllr Norton',
      'Proxy 2: Ms. Harper',
      'Proxy 3: Mr. Rae',
      'Proxy 4: Ms. Lin',
      'Proxy 5: Mr. Choi',
      'Proxy 6: Mrs. Fulton',
    ]) {
      await expect(cast.getByRole('button', { name: startsWith(name) })).toBeVisible();
    }
    await expect(cast).toContainText('Personas and numeric inclinations are generated scenario');
    await expect(setup).toContainText('Editing closes when the simulation starts');
    await cast.getByRole('button', { name: startsWith('Proxy 3: Mr. Rae') }).click();
    const proxy = page.getByRole('dialog', { name: 'Proxy 3: Mr. Rae' });
    await expect(proxy).toContainText('An assumed simulation persona, not a real person');
    await axe(page, 'a proxy');
    await shot(page, '11-actors');
    await closeDialog(page);
  });

  await run('14. Inspect how the simulation was configured', async () => {
    const setup = page.getByRole('tabpanel');
    await expect(setup.getByRole('region', { name: 'How it runs' })).toContainText(
      '6 rounds of 30 scenario minutes, on Info Plaza and Topic Community.',
    );
    const inputs = setup.getByRole('region', { name: 'Where they start' });
    expect(await inputs.getByText(/Assumed input · P\d/u).count()).toBeGreaterThanOrEqual(4);
    await expect(inputs).toContainText('explicit assumptions, not observed audience sentiment');
    // The inputs are shown, and closed: a recorded run is never rewritten.
    await expect(
      setup.locator(
        'input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled])',
      ),
    ).toHaveCount(0);
    await axe(page, 'setup');
  });

  await run('15. Replay the recorded simulation', async () => {
    const rounds = await openTab(page, 'Rounds');
    const platforms = rounds.getByRole('radiogroup', { name: 'Platform' });
    await expect(platforms.getByRole('radio', { name: 'Info Plaza' })).toBeChecked();
    await expect(
      rounds.getByRole('img', { name: /^Info Plaza: 6 of 6 rounds recorded/u }),
    ).toBeVisible();
    await toRound(rounds, page, 0);
    await expect(rounds.getByRole('heading', { level: 3, name: /^The start/u })).toBeVisible();
    await page.keyboard.press('End');
    await expect(rounds.getByRole('heading', { level: 3, name: /^Round 6 of 6/u })).toBeVisible();
    await rounds.getByRole('button', { name: 'Previous round' }).click();
    await expect(rounds.getByRole('heading', { level: 3, name: /^Round 5 of 6/u })).toBeVisible();
    await rounds.getByRole('button', { name: 'Next round' }).click();
    await expect(rounds.getByRole('button', { name: 'Next round' })).toBeDisabled();
    await platforms.getByRole('radio', { name: 'Topic Community' }).click();
    await expect(platforms.getByRole('radio', { name: 'Topic Community' })).toBeChecked();
    await expect(
      rounds.getByRole('img', { name: /^Topic Community: 6 of 6 rounds recorded/u }),
    ).toBeVisible();
    await platforms.getByRole('radio', { name: 'Info Plaza' }).click();
    await axe(page, 'rounds');
    await shot(page, '12-rounds');
  });

  await run('16. Inspect actor decisions and the reasons they gave', async () => {
    const rounds = page.getByRole('tabpanel');
    const records = rounds.locator('li', {
      has: page.locator('strong', { hasText: 'Proxy 3: Mr. Rae' }),
    });
    await expect(records).toHaveCount(1);
    await expect(records).toContainText('Stated reason');
    await expect(records).toContainText('not hidden reasoning');
    await expect(records).toContainText(/Self-reported firmness \d+%/u);
    await records.scrollIntoViewIfNeeded();
    await shot(page, '13-decisions');
  });

  await run('17. Inspect several rounds, and see that the actors decide differently', async () => {
    const rounds = page.getByRole('tabpanel');
    const means = new Set<string>();
    for (const round of [1, 3, 4, 6]) {
      await toRound(rounds, page, round);
      await expect(
        rounds.getByRole('heading', { level: 3, name: new RegExp(`^Round ${round} of 6`, 'u') }),
      ).toBeVisible();
      const mean = rounds.locator('dt', { hasText: 'Mean inclination' }).locator('+ dd').first();
      means.add((await mean.innerText()).trim().split(/\s/u)[0]!);
    }
    expect(means.size, 'the mean inclination moved from round to round').toBeGreaterThanOrEqual(3);
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

  await run('18. Branch at a checkpoint: the branch opens paused and ready to resume', async () => {
    const runTab = await openTab(page, 'Run');
    await runTab.getByRole('button', { name: startsWith('Branch from a round') }).click();
    const dialog = page.getByRole('dialog', { name: 'Branch from a checkpoint' });
    await expect(dialog).toBeVisible();
    const checkpoint = dialog.getByRole('slider', { name: 'Last round to copy unchanged' });
    await checkpoint.focus();
    await page.keyboard.press('Home');
    for (let step = 0; step < 2; step += 1) await page.keyboard.press('ArrowRight');
    await expect(checkpoint).toHaveAttribute('aria-valuenow', '2');
    await dialog.getByRole('radio', { name: 'Replace' }).click();
    const before = dialog.getByRole('slider', { name: 'Round the event is applied before' });
    await before.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await expect(before).toHaveAttribute('aria-valuenow', '4');
    await dialog
      .getByRole('textbox', { name: 'What happens' })
      .fill('Assumed journey rehearsal: a fare freeze announced before round four');
    await dialog.getByRole('spinbutton', { name: 'Stance' }).fill('0.7');
    await dialog.getByRole('spinbutton', { name: 'Strength' }).fill('0.6');
    // Actors can be edited where the product supports it: on a branch, before it is resumed.
    await dialog.getByRole('button', { name: 'Change a proxy' }).click();
    await dialog.getByRole('spinbutton', { name: 'Openness' }).fill('0.9');
    await dialog
      .getByRole('textbox', { name: 'Name of the branch (optional)' })
      .fill('Journey rehearsal branch');
    await axe(page, 'branch dialog');
    await shot(page, '14-branch-dialog');
    await dialog.getByRole('button', { name: 'Create the branch and open it' }).click();
    await expect(page.getByText(/Branched after round 2 of 6/u).first()).toBeVisible();
    createdBranch = new URL(page.url()).searchParams.get('project');
    expect(createdBranch).toMatch(/^[0-9a-f-]{36}$/u);
    expect(createdBranch).not.toBe(BASE.id);
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
    await expect(page.getByRole('button', { name: /^Resume/u }).first()).toBeEnabled();
    await settled(page, watch, 'paused branch');
    await shot(page, '15-paused-branch');
  });

  await run('19. Introduce an intervention at the checkpoint', async () => {
    const event = page.getByRole('region', { name: 'An assumed event' });
    await expect(event).toContainText('Scheduled before round 4');
    const round = event.getByRole('slider', { name: 'Round the event is applied before' });
    await round.focus();
    await page.keyboard.press('ArrowRight');
    await expect(round).toHaveAttribute('aria-valuenow', '5');
    await event
      .getByRole('textbox', { name: 'What happens' })
      .fill('Assumed journey rehearsal: a fare cap announced before round five');
    await event.getByRole('spinbutton', { name: 'Stance' }).fill('0.8');
    await event.getByRole('spinbutton', { name: 'Strength' }).fill('0.7');
    await shot(page, '16-intervention');
    await event.getByRole('button', { name: 'Replace the event' }).click();
    await expect(event).toContainText('Scheduled before round 5');
    const branch = (await (await api.get(`/api/projects/${createdBranch}`)).json()) as {
      settings: { intervention: { round: number; label: string } | null };
    };
    expect(branch.settings.intervention).toMatchObject({ round: 5 });
    expect(branch.settings.intervention?.label).toContain('fare cap announced before round five');
  });

  await run('20. Open the recorded branches', async () => {
    await page.getByRole('button', { name: 'Swarm: start a new question' }).click();
    await page
      .getByRole('region', { name: 'Continue' })
      .getByRole('button', { name: startsWith(GUARANTEE.title) })
      .click();
    await expect(page).toHaveURL(new RegExp(`project=${GUARANTEE.id}`, 'u'));
    const runTab = await openDeepDive(page, GUARANTEE.id, 'Run');
    const lineage = runTab.getByRole('region', { name: startsWith(`A branch of ${BASE.title}`) });
    await expect(lineage).toBeVisible();
    await expect(lineage).toContainText('Left after round 3');
    await expect(lineage).toContainText('Rounds 1 to 3 were copied unchanged');
    await expect(lineage.getByRole('listitem').first()).toContainText('council guarantee');
    await expect(lineage.getByRole('button', { name: 'Compare with the parent' })).toBeVisible();
    await settled(page, watch, 'recorded branch');
    await shot(page, '17-branch');
    await lineage.getByRole('button', { name: 'Open the parent run' }).click();
    await expect(page).toHaveURL(new RegExp(`project=${BASE.id}`, 'u'));
    await expect(
      page.getByRole('heading', { level: 1, name: /A slower, closer look/u }),
    ).toBeVisible();
  });

  const conversation = async (): Promise<Locator> => {
    const panel = page.getByRole('dialog', { name: 'Ask', exact: true });
    if ((await panel.count()) === 0) {
      await page.getByRole('button', { name: 'Ask about this' }).click();
    }
    await expect(panel).toBeVisible();
    return panel;
  };

  await run('21. Ask the analyst a question the sources answer', async () => {
    const panel = await conversation();
    await panel.getByRole('tab', { name: startsWith('Analyst') }).click();
    const messages = panel.getByRole('log', { name: 'Messages' });
    if (ASK) {
      const before = await messages.getByRole('listitem').count();
      await panel
        .getByRole('textbox', { name: 'Question for the analyst' })
        .fill(
          'What share of the electric ferry cost would the Clean Coasts Fund pay, and on what condition?',
        );
      await panel.getByRole('button', { name: 'Ask model' }).click();
      await expect(messages.getByRole('listitem')).toHaveCount(before + 2, {
        timeout: 4 * 60_000,
      });
      const answer = messages.getByRole('listitem').last();
      await expect(answer).toContainText('40%');
      await expect(answer).toContainText('Cited from project evidence');
    } else {
      // Without a model to ask, the recorded answer is what is read.
      await expect(messages).toContainText('What ceiling applies to the annual ferry subsidy');
      await expect(messages).toContainText('Cited from project evidence');
    }
    await shot(page, '18-analyst-answer');
  });

  await run('22. Verify that the analyst cites stored evidence', async () => {
    const panel = await conversation();
    const messages = panel.getByRole('log', { name: 'Messages' });
    const answer = messages
      .getByRole('listitem')
      .filter({ hasText: 'Cited from project evidence' })
      .last();
    const cites = answer.getByRole('group', { name: 'What this answer cites' });
    const passages = cites.getByRole('button', { name: /^Source S\d+$/u });
    expect(await passages.count()).toBeGreaterThanOrEqual(1);
    const cited = (await passages.allInnerTexts()).map((text) => text.trim());
    const stored = (await (await api.get(`/api/projects/${BASE.id}/evidence`)).json()) as {
      matches: { id: string; text: string }[];
    };
    for (const id of cited) {
      expect(
        stored.matches.map((chunk) => chunk.id),
        `${id} is a stored passage`,
      ).toContain(id);
    }
    await passages.first().click();
    const popover = page.getByRole('dialog', { name: `Source ${cited[0]}` });
    await expect(popover).toBeVisible();
    const passage = stored.matches.find((chunk) => chunk.id === cited[0])!;
    await expect(popover).toContainText(passage.text.slice(0, 30));
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    // The statements of the report that the answer relied on are named, too.
    await expect(
      cites.getByRole('button', { name: /^Report statement C\d+$/u }).first(),
    ).toBeVisible();
  });

  await run('23. Ask a plausible question the sources cannot answer', async () => {
    const panel = await conversation();
    const messages = panel.getByRole('log', { name: 'Messages' });
    if (ASK) {
      const before = await messages.getByRole('listitem').count();
      await panel
        .getByRole('textbox', { name: 'Question for the analyst' })
        .fill("What was the ferry company's total passenger revenue in 2018?");
      await panel.getByRole('button', { name: 'Ask model' }).click();
      await expect(messages.getByRole('listitem')).toHaveCount(before + 2, { timeout: 60_000 });
    } else {
      await expect(messages).toContainText('What was ferry ridership in 2019?');
    }
    const reply = messages
      .getByRole('listitem')
      .filter({ hasText: 'Not enough evidence to answer' })
      .last();
    await expect(reply).toBeVisible();
    const text = (await reply.locator('p').first().innerText()).trim();
    expect(
      text.startsWith(ABSTENTION),
      `"${text.slice(0, 90)}" starts with the abstention sentence`,
    ).toBe(true);
    await expect(reply).toContainText('The project does not hold evidence that answers this');
    expect(await reply.getByRole('group', { name: 'What this answer cites' }).count()).toBe(0);
    await axe(page, 'analyst abstention');
    await shot(page, '19-analyst-abstains');
  });

  await run('24. Chat with one synthetic actor', async () => {
    const panel = await conversation();
    await panel.getByRole('tab', { name: startsWith('Actors') }).click();
    const choice = panel.getByRole('radiogroup', { name: 'Actor to talk to' });
    await expect(choice).toBeVisible();
    if (ASK) {
      await choice.getByRole('radio', { name: 'Proxy 3: Mr. Rae' }).click();
      const talk = panel.getByRole('region', { name: 'Conversation with Proxy 3: Mr. Rae' });
      await panel
        .getByRole('textbox', { name: 'Question for Proxy 3: Mr. Rae' })
        .fill('What would reassure you about the winter timetable?');
      await panel.getByRole('button', { name: 'Ask model' }).click();
      await expect(talk.getByRole('listitem')).toHaveCount(2, { timeout: 4 * 60_000 });
    } else {
      // The recorded conversation is with the Harbour Business Council's proxy.
      await choice.getByRole('radio', { name: 'Proxy 5: Mr. Choi' }).click();
    }
    const talk = panel.getByRole('region', { name: /^Conversation with Proxy \d/u });
    const messages = talk.getByRole('log', { name: 'Messages' });
    await expect(messages.getByRole('listitem')).toHaveCount(2);
    await expect(messages).toContainText('Fictional role-play');
    const reply = messages.getByRole('listitem').last();
    expect((await reply.innerText()).length).toBeGreaterThan(80);
    await expect(panel).toContainText(/synthetic, not people/iu);
    await axe(page, 'actor chat');
    await shot(page, '20-actor-chat');
    await closeDialog(page);
  });

  await run('25. Export the snapshot', async () => {
    const download = page.waitForEvent('download');
    await fromSettings(page, 'Export snapshot');
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

  await run('26. Inspect the audit log', async () => {
    await fromSettings(page, 'Audit log');
    const dialog = page.getByRole('dialog', { name: 'Audit log' });
    await expect(dialog).toBeVisible();
    const events = (await (await api.get(`/api/projects/${BASE.id}/audit`)).json()) as {
      events: { action: string }[];
    };
    await expect(dialog.getByRole('button', { name: `All ${events.events.length}` })).toBeVisible();
    const entries = dialog.getByRole('heading', { level: 4 });
    for (const text of ['Project restored from a snapshot', 'Export downloaded']) {
      await expect(entries.filter({ hasText: text }).first()).toBeVisible();
    }
    expect(
      events.events.filter((event) => event.action === 'export.downloaded').length,
    ).toBeGreaterThanOrEqual(1);
    if (ASK) await expect(entries.filter({ hasText: 'Question asked' }).first()).toBeVisible();
    // It records who did what and never what was said.
    const log = await dialog.innerText();
    expect(log).not.toContain('Clean Coasts');
    expect(log).not.toContain('passenger revenue');
    await dialog.getByRole('button', { name: 'Verify integrity' }).click();
    await expect(dialog.getByText('Chain intact')).toBeVisible();
    await axe(page, 'audit log');
    await shot(page, '21-audit-log');
    await closeDialog(page);
  });

  await run('Clean up: delete the rehearsal branch through the history', async () => {
    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: 'Your explorations' });
    await history.getByRole('button', { name: 'Delete Journey rehearsal branch' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete this exploration?' });
    await confirmation.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(
      history.getByRole('button', { name: 'Delete Journey rehearsal branch' }),
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
    console.log(`  ${watch.scanned} characters of pages and API answers were scanned`);
    expect(watch.scanned).toBeGreaterThan(1_000_000);
  });

  await testInfo.attach('journey-steps.json', {
    body: JSON.stringify({ mode: LIVE ? 'live' : 'ci', askedModel: ASK, steps }, null, 2),
    contentType: 'application/json',
  });
  await api.dispose();
});

// A run the engine made on its own has no lab record (the recorded demonstration is one): the shell opens its
// detailed report in Decide and its recorded branches in Compare (`frontend/src/app/scenes.ts`). This is the walk
// that has to keep working: the detailed report from the run, the recorded runs side by side.
test('the recorded run opens its detailed report, and the recorded branches their comparison', async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(10 * 60_000);
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL! });
  const watch = watchPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const project = (await (await api.get(`/api/projects/${BASE.id}`)).json()) as {
    report: { title: string };
  };
  await openDeepDive(page, BASE.id, 'Run');
  await page.getByRole('button', { name: 'Open the detailed report' }).first().click();
  await expect(page).toHaveURL(/scene=decide&view=report/u);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(project.report.title);
  await expect(
    page.getByText('Fictional actors under stated assumptions. A simulation, not a forecast.'),
  ).toBeVisible();
  const chapters = page.getByRole('navigation', { name: 'On this page' }).getByRole('button');
  await expect(chapters.first()).toContainText('Summary');
  await expect(chapters.last()).toContainText('Limitations');
  await chapters.filter({ hasText: /Economic Impacts/u }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Economic Impacts/u })).toBeVisible();
  await chapters.filter({ hasText: /^Statement checks/u }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'What was checked' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^\d+ Supported$/u })).toBeVisible();
  await settled(page, watch, 'detailed report');
  await axe(page, 'detailed report');
  await shot(page, '22-detailed-report');

  const markdown = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('menuitem', { name: 'Markdown' }).click();
  const file = await markdown;
  expect(file.suggestedFilename()).toBe(`swarm-lab-${BASE.id}.md`);
  const text = await readFile(await file.path(), 'utf8');
  for (const expected of [
    '## Evidence ledger',
    '## Limitations',
    'Synthetic scenario, not a calibrated forecast',
    '412,000',
    '365,000',
  ]) {
    expect(text).toContain(expected);
  }
  scan(text, 'the Markdown export', watch);

  await openDeepDive(page, GUARANTEE.id, 'Run');
  await page
    .getByRole('region', { name: startsWith('A branch of') })
    .getByRole('button', { name: 'Compare with the parent' })
    .click();
  await expect(page).toHaveURL(/scene=compare&view=runs/u);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('is the parent run of');
  await expect(page.getByText('Identical through round 3')).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Mean inclination in each of the 6 recorded rounds/u }),
  ).toBeVisible();
  await expect(page.getByText(/Not a forecast, and not a cause/u)).toBeVisible();
  await settled(page, watch, 'comparison');
  await axe(page, 'comparison');
  await shot(page, '23-compare');

  // The two recorded branches are siblings: the server says so, and the numbers differ after round 3.
  const siblings = (await (
    await api.get(`/api/projects/${GUARANTEE.id}/compare?with=${NO_NOTICE.id}`)
  ).json()) as { lineage: string; identicalThroughRound: number };
  expect(siblings.lineage).toBe('siblings');
  expect(siblings.identicalThroughRound).toBe(3);
  await api.dispose();
});

// The same screens at the sizes people use, so that nothing clips, overflows or shrinks.
for (const viewport of viewports) {
  test(`the demonstration screens fit at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const watch = watchPage(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const check = async (label: string, accessibility = false): Promise<void> => {
      await settled(page, watch, `${label} at ${viewport.name}`);
      await expectReadableText(page, label);
      await expectPressable(page, label);
      if (accessibility) await axe(page, `${label} at ${viewport.name}`);
    };

    await page.goto('/');
    await expect(page.getByText(POSITIONING, { exact: true })).toBeVisible();
    await check('home', true);

    await page
      .getByRole('region', { name: 'Continue' })
      .getByRole('button', { name: startsWith(BASE.title) })
      .click();
    await expect(page).toHaveURL(new RegExp(`project=${BASE.id}`, 'u'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check('the demonstration as it opens', true);

    await page.goto(`/?project=${BASE.id}&scene=ground`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('region', { name: /^Statements/u }).scrollIntoViewIfNeeded();
    await check('evidence', true);
    await page.getByRole('region', { name: /^Conflicts/u }).scrollIntoViewIfNeeded();
    await check('conflicts');

    await openDeepDive(page, BASE.id, 'Setup');
    for (const tab of ['Setup', 'Run', 'Rounds', 'Memory'] as const) {
      await openTab(page, tab);
      await check(`deep dive, ${tab}`, tab === 'Rounds');
    }

    await page.getByRole('button', { name: 'Ask about this' }).click();
    await expect(page.getByRole('dialog', { name: 'Ask', exact: true })).toBeVisible();
    await check('the analyst', true);
    await closeDialog(page);

    await fromSettings(page, 'Audit log');
    await expect(page.getByRole('dialog', { name: 'Audit log' })).toBeVisible();
    await check('audit log', true);
    await closeDialog(page);
  });
}
