import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import type { ResearchStage } from '../../shared/research';
import { openApp, settled } from './app';
import {
  exploreButton,
  goOn,
  openAsk,
  optionsButton,
  questionBox,
  readScenario,
  siteBox,
} from './ask';
import { pill } from './ground-map';
import { expectNoHorizontalOverflow, expectReadableText } from './helpers';
import { deployed, harness } from './journey';
import { projectIdOf } from './journey-api';
import { expectSignedIn } from './signin';
import type { Person } from '../../backend/test/support/journey-protocol';

// How a person walks the production journey, scene by scene, found the way a person finds things: by role and by name.
// Each function does one thing a person does and waits for what the page says it did. What is asserted about the result
// is in the spec, where a reader can see it.

/** Signs in (as the harness's test identity provider lets a person), and opens the first screen. */
export async function signIn(page: Page, person: Person = 'analyst'): Promise<void> {
  if (deployed) {
    await openApp(page);
    return;
  }
  await harness.signInNext(person);
  await page.goto('/');
  await settled(page);
  await expectSignedIn(page);
}

// ---------------------------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------------------------

export interface Asked {
  project: string;
  /** What the page sent to make the project. */
  created: {
    question?: string;
    documents?: unknown[];
    research?: Record<string, unknown>;
    settings?: { mode?: string };
  };
}

/** Chooses how the exploration is read and run: rules on this machine, or the model the server has. */
export async function chooseEngine(
  page: Page,
  engine: 'Local rules' | 'Model assisted',
): Promise<void> {
  await optionsButton(page).click();
  const options = page.getByRole('dialog', { name: 'Options' });
  await options.getByRole('radio', { name: engine }).click();
  await expect(options.getByRole('radio', { name: engine })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
}

/**
 * From the first screen to Ground: the question and, where given, the site or page that is named, and nothing else. No
 * source is attached. The page's own request to make the project is returned, so that what it sent can be read.
 */
export async function ask(
  page: Page,
  input: {
    question: string;
    site?: string;
    engine?: 'Local rules' | 'Model assisted';
    /** What the page shows between reading the question and making the project. */
    beforeGround?: () => Promise<void>;
  },
): Promise<Asked> {
  await openAsk(page);
  if (input.engine === 'Model assisted') await chooseEngine(page, input.engine);
  await questionBox(page).fill(input.question);
  if (input.site) await siteBox(page).fill(input.site);
  await expect(exploreButton(page)).toBeEnabled();
  await readScenario(page);
  await input.beforeGround?.();
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects',
  );
  await goOn(page).click();
  const created = (await sent).postDataJSON() as Asked['created'];
  await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
  return { project: projectIdOf(page), created };
}

// ---------------------------------------------------------------------------------------------
// Ground: the research
// ---------------------------------------------------------------------------------------------

/** The word that says where the research is: Reading, Needs a source, Ready, Stopped. */
export const chip = (page: Page): Locator => page.locator('[data-moment]');
export const researchSection = (page: Page): Locator =>
  page.getByRole('region', { name: /^Research/u });
export const stage = (page: Page, name: ResearchStage): Locator =>
  page.getByRole('list', { name: 'Research progress' }).locator(`[data-stage="${name}"]`);
export const pagesList = (page: Page): Locator => page.getByRole('list', { name: 'Pages' });
export const pageRow = (page: Page, text: string | RegExp): Locator =>
  pagesList(page).getByRole('listitem').filter({ hasText: text });
export const figure = (page: Page, label: string): Locator =>
  page.locator('.sw-ground__figures > li').filter({ hasText: label });
export const press = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

/** Opens the provenance of a page, from its row, and returns the card. */
export async function openProvenance(page: Page, row: Locator): Promise<Locator> {
  await row
    .getByRole('button', { name: /^Provenance/u })
    .first()
    .click();
  const card = page.getByRole('dialog');
  await expect(card).toBeVisible();
  return card;
}

/** Names a site or a page for research to read, as a person does once a run has stopped. */
export async function addSource(page: Page, address: string): Promise<void> {
  await press(page, 'Add a site or page').click();
  const field = page.getByRole('textbox', { name: 'Site or page to add' });
  await expect(field).toBeFocused();
  await field.fill(address);
  await press(page, 'Add').click();
}

// ---------------------------------------------------------------------------------------------
// Map: the participants
// ---------------------------------------------------------------------------------------------

export const mapAt = async (page: Page, project: string, view?: string): Promise<void> =>
  openApp(page, { project, scene: 'map', ...(view ? { view } : {}) });

/** The participant cards of the review, by the name in their heading. */
export const participantCard = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 4, name, exact: true }).locator('xpath=ancestor::li[1]');

export const participantNames = (page: Page): Promise<string[]> =>
  page.getByRole('heading', { level: 4 }).allInnerTexts();

export const useActors = (page: Page): Locator =>
  pill(page).getByRole('button', { name: 'Use these actors' });

// ---------------------------------------------------------------------------------------------
// Constraints and the gate
// ---------------------------------------------------------------------------------------------

export const gateRegion = (page: Page): Locator =>
  page.getByRole('region', { name: 'Constraint coverage' });

/** A constraint's row, by what it says. */
export const constraintRow = (page: Page, statement: string | RegExp): Locator =>
  page
    .getByRole('listitem')
    .filter({ has: page.locator('.sw-con__statement'), hasText: statement });

// ---------------------------------------------------------------------------------------------
// Simulate, Compare, Decide
// ---------------------------------------------------------------------------------------------

export const canvas = (page: Page): Locator =>
  page.getByRole('region', { name: 'Decision view', exact: true });

/** The tools of the brief, which stand under the decision view. */
export const briefTools = (page: Page): Locator =>
  page.getByRole('main').getByRole('group', { name: 'Tools for the brief' });

export const reviewSheet = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Independent review' });

/**
 * DEFECT J-01 (docs/production/journey.md, "Defects found"). A comparison that cannot be read as a result (no stakeholder
 * has a direction of impact, which is how every question that starts from research ends up) is dimmed as a whole to 55%
 * opacity (`[data-unread]`), and its text falls to 2.8:1, under the 4.5:1 that WCAG asks. The page is held to everything
 * else, with the dimmed rows left out, and the rows are held to still be at fault, so that fixing the defect is noticed
 * and this function is taken away for `expectSound`.
 */
export async function expectSoundExceptDimmedRows(page: Page, label: string): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectReadableText(page, label);
  const rest = await new AxeBuilder({ page }).exclude('[data-unread]').analyze();
  expect(
    rest.violations.map(
      (violation) =>
        `${violation.impact}: ${violation.id} ×${violation.nodes.length} (${violation.nodes[0]?.target.join(' ')})`,
    ),
    `axe violations: ${label}`,
  ).toEqual([]);
  expect(
    await page.locator('[data-unread]').count(),
    'J-01: there are dimmed rows to judge',
  ).toBeGreaterThan(0);
  const dimmed = await new AxeBuilder({ page })
    .include('[data-unread]')
    .withRules(['color-contrast'])
    .analyze();
  expect(
    dimmed.violations.length,
    'J-01 (dimmed rows below 4.5:1) is no longer found: use expectSound here',
  ).toBeGreaterThan(0);
}
