import { expect, test, type Locator, type Page } from '@playwright/test';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  seed,
  watchPage,
} from '../support/helpers';

// The stakeholder review, through the real screens, on the rules-mode server: from an example on the
// first page to the actors the simulation will run on. Nothing here needs a model. The checks that run
// in every state are the ones a person would fail on: the panel must not push the stage's own action
// off the screen, nothing may overflow sideways, axe must be clean in each theme, and focus must not be
// lost when the control that had it goes away.

test.use({ actionTimeout: 15_000 });

const PACKS = ['copilot-in-teams', 'regional-price-change', 'ecommerce-experience'] as const;
const THEMES = ['light', 'dark', 'high-contrast'] as const;
const DESKTOP = { width: 1440, height: 900 };
const LAPTOP = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };

const exampleOf = (id: string) => {
  const found = EXAMPLE_SCENARIOS.find((example) => example.id === id);
  if (!found) throw new Error(`There is no example ${id}.`);
  return found;
};

const panel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Stakeholders and actors' });
const startSimulation = (page: Page): Locator =>
  page.getByRole('button', { name: 'Start Simulation' });
const rows = (page: Page): Locator =>
  panel(page).locator('ul[aria-label="Stakeholders, key actors first"] > li');
/** The row of the stakeholder with exactly this name: found by its button, not by words in its hidden detail. */
const rowNamed = (page: Page, name: string): Locator =>
  rows(page).filter({ has: page.getByRole('button', { name, exact: true }) });
const removedRows = (page: Page): Locator => panel(page).locator('details.stk-removed li.stk-row');
/** Opens the list of removed stakeholders if it is not open already: clicking its summary twice would shut it. */
async function openRemoved(page: Page): Promise<void> {
  const removed = panel(page).locator('details.stk-removed');
  if (!(await removed.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await removed.locator('> summary').click();
  }
  await expect(removed).toHaveJSProperty('open', true);
}
const actorRows = (page: Page): Locator => panel(page).locator('ul[aria-label="Actors"] > li');
const toggleOf = (row: Locator): Locator => row.locator('button.stk-row-toggle');
const nameOf = (row: Locator): Locator => row.locator('.stk-name').first();
const stakeholdersToggle = (page: Page): Locator =>
  panel(page).getByRole('button', { name: /^Stakeholders \d+$/u });
const actorsToggle = (page: Page): Locator =>
  panel(page).getByRole('button', { name: /^Actors \d+$/u });

interface Counts {
  found: number;
  needReview: number;
  approved: number;
  actors: number;
}

/** The four counts the summary shows, read as a person reads them: "12 found", "9 need review". */
async function counts(page: Page): Promise<Counts> {
  const items = await panel(page)
    .getByRole('list', { name: 'Summary of the stakeholders' })
    .getByRole('listitem')
    .allInnerTexts();
  const read = (label: string): number => {
    const item = items.find((text) => text.trim().endsWith(label));
    if (!item) throw new Error(`The summary has no "${label}": ${items.join(' | ')}`);
    return Number.parseInt(item, 10);
  };
  return {
    found: read('found'),
    needReview: read('need review'),
    approved: read('approved'),
    actors: read('actors'),
  };
}

async function openFromExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: `Use this example: ${exampleOf(id).title}` }).click();
  await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
  await page.getByRole('button', { name: /Prepare environment/u }).click();
  await expect(page.getByRole('heading', { name: 'Make the assumptions explicit' })).toBeVisible();
  await expect(panel(page)).toBeVisible();
}

async function inTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
}

/** Everything a person fails on, in the state the page is in now. */
async function expectSound(page: Page, label: string, theme?: (typeof THEMES)[number]) {
  await expectNoAxeViolations(page, label);
  await expectNoHorizontalOverflow(page);
  await expectReadableText(page, label);
  await expectTargetSizes(page, label);
  if (theme && theme !== 'light') await expectNoBrowserPaintedControls(page, label);
}

/** The words of a passage with its white space made single, so that a quote can be found in the source. */
const flat = (text: string): string => text.replace(/\s+/gu, ' ').trim();

for (const id of PACKS) {
  test(`${id}: finds stakeholders with their evidence, is reviewed, approved, and becomes actors a person can change`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const problems = watchPage(page);
    const example = exampleOf(id);
    const source = flat(example.documents.map((document) => document.content).join('\n'));
    await page.setViewportSize(DESKTOP);
    await openFromExample(page, id);

    await test.step('the panel starts small, offers to find stakeholders, and leaves Start Simulation on the screen', async () => {
      await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(
        'Stakeholders and actors',
      );
      await expect(
        panel(page).getByRole('button', { name: 'Find stakeholders by reading the text' }),
      ).toBeVisible();
      await expect(panel(page)).toContainText('not real people');
      await expect(startSimulation(page)).toBeInViewport({ ratio: 1 });
      await expectSound(page, `${id}: before anything is found`);
    });

    await test.step('finds the stakeholders by reading the text, opens the list and says how many need review', async () => {
      await panel(page)
        .getByRole('button', { name: 'Find stakeholders by reading the text' })
        .click();
      await expect(
        panel(page).getByRole('heading', { name: /^Stakeholders \(\d+\)$/u }),
      ).toBeFocused();
      await expect(panel(page)).toContainText('Found by reading the text, not by a model');
      const found = await counts(page);
      expect(found.found).toBeGreaterThanOrEqual(5);
      expect(found.needReview).toBe(found.found);
      expect(found.approved).toBe(0);
      expect(found.actors).toBe(0);
      await expect(
        panel(page).getByRole('button', { name: /^Review \d+ stakeholders$/u }),
      ).toBeVisible();
      await expect(rows(page)).toHaveCount(found.found);
      // The panel says what it cannot do.
      await expect(panel(page)).toContainText('expect gaps');
    });

    await test.step('every row says its role, its direction of impact in words, its uncertainty, and whether it cites evidence', async () => {
      const total = await rows(page).count();
      for (let index = 0; index < total; index += 1) {
        const row = rows(page).nth(index);
        await expect(row.getByRole('list', { name: /^About / })).toContainText(/Impact: /u);
        await expect(row.getByRole('list', { name: /^About / })).toContainText(/Uncertainty: /u);
        await expect(row.getByRole('list', { name: /^About / })).toContainText(
          /cited quotes?|Assumption: no cited evidence/u,
        );
        await expect(row.locator('.stk-role')).toContainText(/Key actor|cohort/u);
      }
    });

    await test.step('opens a row to see the quotes it rests on, word for word, with the passage they are from', async () => {
      const cited = rows(page)
        .filter({ hasText: /cited quotes?/u })
        .first();
      await toggleOf(cited).click();
      await expect(toggleOf(cited)).toHaveAttribute('aria-expanded', 'true');
      const quotes = cited.locator('blockquote.stk-quote');
      expect(await quotes.count()).toBeGreaterThanOrEqual(1);
      for (const quote of await quotes.allInnerTexts()) {
        const words = flat(quote.replace(/^“|”$/gu, ''));
        expect(source, `“${words}” is in the example's own text`).toContain(words);
      }
      await expect(cited.locator('.stk-source').first()).toContainText(/S\d+/u);
      await expect(cited.getByText('Expected impact:')).toBeVisible();
      await expect(cited.locator('.stk-origin').first()).toHaveText(
        /^(?:assumption|evidence|model|you)$/u,
      );
      await toggleOf(cited).click();
      await expect(toggleOf(cited)).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('edits one: it is marked as edited by you, and no longer needs review', async () => {
      const before = await counts(page);
      const row = rows(page).first();
      const original = await nameOf(row).innerText();
      await toggleOf(row).click();
      await row.getByRole('button', { name: `Edit ${original}` }).click();
      const form = row.getByRole('form', { name: `Edit ${original}` });
      await expect(form.getByLabel('Name')).toBeFocused();
      await form.getByLabel('Name').fill(`${original} (as we call them)`);
      await form.getByLabel('How the change lands on them').selectOption('mixed');
      await form
        .getByLabel('Why you think so')
        .fill('The team told us they gain some and lose some.');
      await form.getByRole('button', { name: 'Save changes' }).click();
      const edited = rowNamed(page, `${original} (as we call them)`);
      await expect(edited).toHaveCount(1);
      await expect(edited.getByRole('list', { name: /^About / })).toContainText('Edited by you');
      // The direction is the person's now, and says so; the server marks it only because they changed it.
      await expect(edited.getByRole('list', { name: /^About / })).toContainText(
        'Impact: mixed · set by you',
      );
      await expect(
        edited.getByText('The team told us they gain some and lose some.'),
      ).toBeAttached();
      // Focus goes back to the control that opened the form.
      await expect(edited.getByRole('button', { name: /^Edit / })).toBeFocused();
      const after = await counts(page);
      expect(after.found).toBe(before.found);
      expect(after.needReview).toBe(before.needReview - 1);
    });

    await test.step('adds one of its own: it carries no evidence, says so, and takes focus', async () => {
      const before = await counts(page);
      await panel(page)
        .locator('.stk-add')
        .getByRole('button', { name: 'Add a stakeholder' })
        .click();
      const form = panel(page).getByRole('form', { name: 'Add a stakeholder' });
      await expect(form.getByLabel('Name')).toBeFocused();
      // An empty name is refused beside the field, and nothing is sent.
      await form.getByRole('button', { name: 'Add stakeholder' }).click();
      await expect(form.getByRole('alert')).toContainText('Give the stakeholder a name.');
      await form.getByLabel('Name').fill('Neighbourhood association');
      await form
        .getByLabel('Why they matter here')
        .fill('Our own judgement: they will hear first.');
      await form.getByRole('button', { name: 'Add stakeholder' }).click();
      const added = rowNamed(page, 'Neighbourhood association');
      await expect(added).toHaveCount(1);
      await expect(toggleOf(added)).toBeFocused();
      await expect(added.getByRole('list', { name: /^About / })).toContainText(
        'Assumption: no cited evidence',
      );
      await expect(added.getByRole('list', { name: /^About / })).toContainText('Added by you');
      await expect(added.locator('.stk-why')).toContainText('Our own judgement');
      expect((await counts(page)).found).toBe(before.found + 1);
    });

    await test.step('removes one, which stays in the record and can be restored; focus moves to its neighbour', async () => {
      const before = await counts(page);
      const row = rows(page).nth(2);
      const neighbour = await nameOf(rows(page).nth(3)).innerText();
      const name = await nameOf(row).innerText();
      await toggleOf(row).click();
      await row.getByRole('button', { name: `Remove ${name}` }).click();
      await expect(rowNamed(page, name)).toHaveCount(0);
      await expect(toggleOf(rows(page).nth(2))).toBeFocused();
      await expect(nameOf(rows(page).nth(2))).toHaveText(neighbour);
      expect((await counts(page)).found).toBe(before.found - 1);
      await expect(panel(page).locator('details.stk-removed')).toContainText(
        'Any of them can be restored.',
      );
      await openRemoved(page);
      await removedRows(page)
        .filter({ has: page.getByRole('button', { name, exact: true }) })
        .getByRole('button', { name: `Restore ${name}` })
        .click();
      await expect(rowNamed(page, name)).toHaveCount(1);
      await expect(toggleOf(rowNamed(page, name))).toBeFocused();
      expect((await counts(page)).found).toBe(before.found);
    });

    await test.step('merges one into another and takes the merge back', async () => {
      const before = await counts(page);
      const row = rows(page).nth(1);
      const target = rows(page).nth(0);
      const name = await nameOf(row).innerText();
      const targetName = await nameOf(target).innerText();
      await toggleOf(row).click();
      await row.getByRole('button', { name: `Merge ${name}` }).click();
      await row.getByLabel(`Merge ${name} into`).selectOption({ label: targetName });
      await row.getByRole('button', { name: 'Merge', exact: true }).click();
      await expect(rowNamed(page, name)).toHaveCount(0);
      await expect(toggleOf(rowNamed(page, targetName))).toBeFocused();
      await expect(rowNamed(page, targetName)).toContainText('Edited by you');
      expect((await counts(page)).found).toBe(before.found - 1);
      await openRemoved(page);
      await removedRows(page)
        .filter({ has: page.getByRole('button', { name, exact: true }) })
        .getByRole('button', { name: `Undo the merge of ${name}` })
        .click();
      await expect(rowNamed(page, name)).toHaveCount(1);
      expect((await counts(page)).found).toBe(before.found);
    });

    await test.step('is sound with the list open and a row being edited, at desktop size', async () => {
      const row = rows(page).nth(3);
      const name = await nameOf(row).innerText();
      await toggleOf(row).click();
      await row.getByRole('button', { name: `Edit ${name}` }).click();
      await expectSound(page, `${id}: list open, edit form open`);
      await row.getByRole('button', { name: 'Cancel' }).click();
      await expect(row.getByRole('button', { name: `Edit ${name}` })).toBeFocused();
    });

    await test.step('closing the list gives the page back to the stage: Start Simulation is on the screen', async () => {
      await stakeholdersToggle(page).click();
      await expect(stakeholdersToggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(startSimulation(page)).toBeInViewport({ ratio: 1 });
      await expectSound(page, `${id}: list shut, stakeholders found`);
      await stakeholdersToggle(page).click();
    });

    await test.step('approves and makes the actors, says so, and keeps the person where they were', async () => {
      const before = await counts(page);
      await panel(page)
        .getByRole('button', { name: 'Approve stakeholders and create actors' })
        .click();
      await expect(
        panel(page).getByRole('button', { name: /^Review the \d+ actors$/u }),
      ).toBeFocused();
      await expect(panel(page).getByRole('status').filter({ hasText: 'Approved.' })).toBeAttached();
      const after = await counts(page);
      expect(after.approved).toBe(before.found);
      expect(after.needReview).toBe(0);
      expect(after.actors).toBeGreaterThanOrEqual(4);
      await expect(stakeholdersToggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(startSimulation(page)).toBeInViewport({ ratio: 1 });
      await expectSound(page, `${id}: approved, actors made`);
    });

    await test.step('shows the actors, each with its traits labelled by where they came from, and lets one be changed', async () => {
      await panel(page)
        .getByRole('button', { name: /^Review the \d+ actors$/u })
        .click();
      await expect(actorsToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(panel(page).getByRole('heading', { name: /^Actors \(\d+\)$/u })).toBeFocused();
      await expect(panel(page)).toContainText('These actors are synthetic.');
      const actor = actorRows(page).first();
      await toggleOf(actor).click();
      const traits = actor.getByRole('table');
      await expect(traits.locator('.stk-origin').first()).toHaveText(
        /^(?:assumption|evidence|model|you)$/u,
      );
      await expect(traits).toContainText('Category prior');
      await expectSound(page, `${id}: actors open, one actor open`);

      const slider = actor.getByRole('slider', { name: /^Influence of / });
      const was = Number(await slider.inputValue());
      await slider.focus();
      await page.keyboard.press(was >= 0.9 ? 'ArrowLeft' : 'ArrowRight');
      await expect(slider).not.toHaveValue(String(was));
      await expect(actor.getByText('Changed by you; not saved yet.')).toBeVisible();
      const save = panel(page).getByRole('button', { name: 'Save changes to the actors' });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(panel(page).getByRole('heading', { name: /^Actors \(\d+\)$/u })).toBeFocused();
      await expect(actorRows(page).first()).toContainText('Edited by you');
      await expect(save).toBeDisabled();
    });

    await test.step('keeps what was changed after the page is read again', async () => {
      await page.reload();
      await expect(panel(page)).toBeVisible();
      await actorsToggle(page).click();
      await expect(actorRows(page).first()).toContainText('Edited by you');
      expect((await counts(page)).actors).toBeGreaterThanOrEqual(4);
    });

    expect(problems).toEqual([]);
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('shows the summary first, then the next step, and the stage’s own action is within reach', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const api = await apiContext(playwright);
    const id = await seed(api, 'environment', { name: 'Stakeholders: phone' });
    await page.goto(`/?project=${id}`);
    await expect(panel(page)).toBeVisible();
    await panel(page)
      .getByRole('button', { name: 'Find stakeholders by reading the text' })
      .click();
    await expect(
      panel(page).getByRole('heading', { name: /^Stakeholders \(\d+\)$/u }),
    ).toBeFocused();
    await stakeholdersToggle(page).click();

    // In the panel, the counts come before the buttons and before anything long.
    const stats = panel(page).getByRole('list', { name: 'Summary of the stakeholders' });
    await expect(stats).toBeInViewport({ ratio: 1 });
    const order = await panel(page).evaluate((element) => {
      const top = (selector: string) =>
        element.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN;
      return {
        title: top('h3'),
        stats: top('.stk-stats'),
        next: top('.stk-controls'),
      };
    });
    expect(order.title).toBeLessThan(order.stats);
    expect(order.stats).toBeLessThan(order.next);
    await expect(
      panel(page).getByRole('button', { name: /^Review \d+ stakeholders$/u }),
    ).toBeInViewport();
    await expect(startSimulation(page)).toBeVisible();
    await expectSound(page, 'phone: stakeholders found, list shut');

    await panel(page)
      .getByRole('button', { name: /^Review \d+ stakeholders$/u })
      .click();
    await expect(rows(page).first()).toBeVisible();
    await toggleOf(rows(page).first()).click();
    await expectSound(page, 'phone: list open, a row open');
    expect(problems).toEqual([]);
  });
});

test.describe('on a laptop', () => {
  test.use({ viewport: LAPTOP });

  test('keeps Start Simulation on the screen before, during and after the review', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const id = await seed(api, 'environment', { name: 'Stakeholders: laptop' });
    await page.goto(`/?project=${id}`);
    await expect(startSimulation(page)).toBeInViewport({ ratio: 1 });
    await panel(page)
      .getByRole('button', { name: 'Find stakeholders by reading the text' })
      .click();
    await stakeholdersToggle(page).click();
    await expect(startSimulation(page)).toBeInViewport({ ratio: 1 });
    await panel(page)
      .getByRole('button', { name: /^Review \d+ stakeholders$/u })
      .click();
    await panel(page)
      .getByRole('button', { name: 'Approve stakeholders and create actors' })
      .click();
    await expect(
      panel(page).getByRole('button', { name: /^Review the \d+ actors$/u }),
    ).toBeVisible();
    await expect(stakeholdersToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(startSimulation(page)).toBeInViewport({ ratio: 1 });
  });
});

test.describe('from the keyboard alone', () => {
  test.use({ viewport: DESKTOP });

  test('finds, reviews, edits and approves without a pointer, and focus is never lost', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const id = await seed(api, 'environment', { name: 'Stakeholders: keyboard' });
    await page.goto(`/?project=${id}`);
    const find = panel(page).getByRole('button', { name: 'Find stakeholders by reading the text' });
    await find.focus();
    await page.keyboard.press('Enter');
    await expect(
      panel(page).getByRole('heading', { name: /^Stakeholders \(\d+\)$/u }),
    ).toBeFocused();

    // The next Tab reaches the first row's toggle, which opens with Enter and closes with Space.
    await page.keyboard.press('Tab');
    const first = rows(page).first();
    await expect(toggleOf(first)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggleOf(first)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(toggleOf(first)).toHaveAttribute('aria-expanded', 'false');

    // Accepting takes away the Accept button; focus must stay on the row.
    await page.keyboard.press('Tab');
    const accept = first.getByRole('button', { name: /^Accept / });
    await expect(accept).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggleOf(first)).toBeFocused();
    await expect(first.getByRole('list', { name: /^About / })).toContainText('Accepted');

    // Every control has a visible focus ring of at least 2px.
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as HTMLElement);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
  });
});

for (const theme of THEMES) {
  test(`is sound in the ${theme} theme, shut, with the list open and with the actors open`, async ({
    page,
    playwright,
  }) => {
    test.setTimeout(180_000);
    const api = await apiContext(playwright);
    const id = await seed(api, 'environment', { name: `Stakeholders: ${theme}` });
    await inTheme(page, theme);

    await page.setViewportSize(DESKTOP);
    await page.goto(`/?project=${id}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(panel(page)).toBeVisible();
    await expectSound(page, `${theme} desktop: nothing found yet`, theme);
    await panel(page)
      .getByRole('button', { name: 'Find stakeholders by reading the text' })
      .click();
    await expect(
      panel(page).getByRole('heading', { name: /^Stakeholders \(\d+\)$/u }),
    ).toBeFocused();
    await toggleOf(rows(page).first()).click();
    await expectSound(page, `${theme} desktop: list open, a row open`, theme);
    await panel(page)
      .getByRole('button', { name: 'Approve stakeholders and create actors' })
      .click();
    await expect(
      panel(page).getByRole('button', { name: /^Review the \d+ actors$/u }),
    ).toBeFocused();
    await expectSound(page, `${theme} desktop: approved, shut`, theme);
    await actorsToggle(page).click();
    await toggleOf(actorRows(page).first()).click();
    await expectSound(page, `${theme} desktop: actors open, an actor open`, theme);

    // The same project on a phone: the person comes back to it later.
    await page.setViewportSize(PHONE);
    await page.goto(`/?project=${id}`);
    await expect(panel(page)).toBeVisible();
    await expectSound(page, `${theme} phone: approved, shut`, theme);
    await stakeholdersToggle(page).click();
    await toggleOf(rows(page).first()).click();
    await expectSound(page, `${theme} phone: list open, a row open`, theme);
    await actorsToggle(page).click();
    await toggleOf(actorRows(page).first()).click();
    await expectSound(page, `${theme} phone: list and actors open`, theme);
  });
}
