import { expect, test, type Locator, type Page } from '@playwright/test';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios';
import { expectNoAxeViolations, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { chooseExample, examplePicker, questionField, scenarioIntake } from '../support/lab';

// The entry screen is a long form. The button that builds used to be three screens down, what an
// example had loaded was said off the screen, and the choice to use a scenario that had been read was
// two screens below the part that needed checking. Rules mode: no model is called.

const [FIRST, SECOND] = EXAMPLE_SCENARIOS;
const QUESTION = 'What could happen if the library changes its opening hours next year?';
const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844 },
] as const;

const build = (page: Page): Locator =>
  page.getByRole('button', { name: 'Build Graph', exact: true });
const bar = (page: Page): Locator => page.locator('.entry-submit-bar');

for (const size of [SIZES[0], SIZES[2]]) {
  test.describe(`the entry screen at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('keeps Build Graph on the screen once a question is written, and says what the form still needs', async ({
      page,
    }) => {
      const problems = watchPage(page, { refusals: true });
      await page.goto('/');
      await expect(questionField(page)).toBeVisible();
      // Nothing is written, so the button is where the form ends: a few screens down.
      await expect(build(page)).not.toBeInViewport();

      await questionField(page).fill(QUESTION);
      await expect(build(page)).toBeInViewport({ ratio: 1 });
      await expect(bar(page)).toContainText(
        'No documents attached yet · attach at least one to build',
      );
      await expect(build(page)).toHaveAccessibleName('Build Graph');

      // Asked to build with nothing to build from, the refusal is where the button is.
      await build(page).click();
      const refusal = page.getByRole('alert').filter({ hasText: 'Cannot build this project' });
      await expect(refusal).toBeVisible();
      await expect(refusal).toBeInViewport({ ratio: 1 });
      await expect(build(page)).toBeInViewport({ ratio: 1 });

      // Reading the form from the top, the button is still in reach.
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(build(page)).toBeInViewport({ ratio: 1 });

      await chooseExample(page, FIRST!);
      await expect(bar(page)).toContainText(
        new RegExp(`${FIRST!.documents.length} documents? attached · ready to build`, 'u'),
      );
      await expect(build(page)).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      expect(problems).toEqual([]);
    });

    test('does not leave the field that takes focus under the bar', async ({ page }) => {
      await page.goto('/');
      await questionField(page).fill(QUESTION);
      await chooseExample(page, FIRST!);
      const seed = page.getByLabel('Random seed');
      await page.getByLabel('Rounds / platform').focus();
      await page.keyboard.press('Tab');
      await expect(seed).toBeFocused();
      const fieldBox = (await seed.boundingBox())!;
      const barBox = (await bar(page).boundingBox())!;
      expect(fieldBox.y + fieldBox.height, 'the field is above the bar').toBeLessThanOrEqual(
        barBox.y + 1,
      );
    });

    test('folds the cards into one line when an example is loaded, and brings them back on request', async ({
      page,
    }) => {
      await page.goto('/');
      const picker = examplePicker(page);
      await expect(picker.getByRole('listitem')).toHaveCount(EXAMPLE_SCENARIOS.length + 1);
      const before = (await picker.boundingBox())!.height;

      await picker.getByRole('button', { name: `Use this example: ${FIRST!.title}` }).click();
      await expect(questionField(page)).toBeFocused();
      const status = page
        .getByRole('status')
        .filter({ hasText: `Example loaded: ${FIRST!.title}` });
      await expect(status).toBeVisible();
      await expect(status).toBeInViewport({ ratio: 1 });
      await expect(status).toContainText(`(${FIRST!.documents.length} document`);
      await expect(status).toContainText('No results come with an example.');
      await expect(picker.getByRole('listitem')).toHaveCount(0);
      const after = (await picker.boundingBox())!.height;
      expect(after, 'the picker takes far less room once an example is loaded').toBeLessThan(
        before / 2,
      );
      await expect(questionField(page)).toHaveValue(FIRST!.question);

      // Change example: the cards are back, focus is on the first, and another can be chosen.
      await picker.getByRole('button', { name: 'Change example' }).click();
      await expect(picker.getByRole('listitem')).toHaveCount(EXAMPLE_SCENARIOS.length + 1);
      await expect(
        picker.getByRole('button', { name: `Use this example: ${FIRST!.title}` }),
      ).toBeFocused();
      // Keep it: the line comes back, and focus goes to the button that brought the cards.
      await picker.getByRole('button', { name: `Keep “${FIRST!.title}”` }).click();
      await expect(picker.getByRole('button', { name: 'Change example' })).toBeFocused();

      await chooseExample(page, SECOND!);
      await expect(
        page.getByRole('status').filter({ hasText: `Example loaded: ${SECOND!.title}` }),
      ).toBeVisible();
      await expect(questionField(page)).toHaveValue(SECOND!.question);
    });

    test('loads the fictional starter like any other card, and says that it is invented', async ({
      page,
    }) => {
      await page.goto('/');
      await examplePicker(page)
        .getByRole('button', { name: 'Use this example: Fictional library hours' })
        .click();
      const status = page.getByRole('status').filter({ hasText: 'Fictional starter INPUT loaded' });
      await expect(status).toBeVisible();
      await expect(status).toContainText('invented for learning the workflow');
      await expect(build(page)).toBeInViewport({ ratio: 1 });
      await expect(bar(page)).toContainText('1 document attached · ready to build');
    });

    test('keeps the choice to use a scenario in reach while it is open, and Build Graph in reach after', async ({
      page,
    }) => {
      await page.goto('/');
      await chooseExample(page, FIRST!);
      await scenarioIntake(page).getByRole('button', { name: 'Understand my question' }).click();
      const review = scenarioIntake(page).locator('.intake-review');
      await expect(
        review.getByRole('heading', { name: 'Check and edit the scenario' }),
      ).toBeVisible();
      const use = review.getByRole('button', { name: 'Use this scenario' });
      await expect(use).toBeInViewport({ ratio: 1 });
      await expect(review.getByRole('button', { name: 'Discard' })).toBeInViewport({ ratio: 1 });
      // One bar at a time: while a scenario is open its own buttons are the ones in reach.
      await expect(build(page)).not.toBeInViewport();

      // However far up the review is read, the choice stays on the screen.
      await review
        .getByRole('heading', { name: 'Check and edit the scenario' })
        .scrollIntoViewIfNeeded();
      await expect(use).toBeInViewport({ ratio: 1 });

      await use.click();
      await expect(
        scenarioIntake(page).getByRole('heading', { name: 'This scenario will be used' }),
      ).toBeVisible();
      await expect(build(page)).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
    });
  });
}

// A phone with its keyboard open leaves about half of the screen: the bar must not take a quarter of it,
// and the field that has focus must not be left under it.
test.describe('the entry screen with the keyboard of a phone open', () => {
  test.use({ viewport: { width: 390, height: 420 } });

  test('keeps the bar to one row and the focused field clear of it', async ({ page }) => {
    await page.goto('/');
    await questionField(page).fill(QUESTION);
    await chooseExample(page, FIRST!);
    const barBox = (await bar(page).boundingBox())!;
    expect(barBox.height, 'the bar is one row, not a quarter of the screen').toBeLessThan(110);
    for (const label of ['Fictional proxies', 'Rounds / platform', 'Random seed']) {
      const field = page.getByLabel(label);
      await field.focus();
      const box = (await field.boundingBox())!;
      const now = (await bar(page).boundingBox())!;
      expect(box.y + box.height, `${label} is above the bar`).toBeLessThanOrEqual(now.y + 1);
    }
  });
});

// One theme for each size keeps this short; every size in every theme was audited by hand.
for (const [size, theme] of [
  [SIZES[0], 'light'],
  [SIZES[1], 'dark'],
  [SIZES[2], 'high-contrast'],
] as const) {
  test.describe(`the entry screen in the ${theme} theme at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('is clean with an example loaded and with a scenario open for checking', async ({
      page,
    }) => {
      await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await chooseExample(page, FIRST!);
      await expectNoAxeViolations(page, `${theme} ${size.name}: example loaded`);
      await expectNoHorizontalOverflow(page);
      await scenarioIntake(page).getByRole('button', { name: 'Understand my question' }).click();
      await expect(
        scenarioIntake(page).getByRole('button', { name: 'Use this scenario' }),
      ).toBeInViewport({ ratio: 1 });
      await expectNoAxeViolations(page, `${theme} ${size.name}: scenario open`);
      await expectNoHorizontalOverflow(page);
    });
  });
}
