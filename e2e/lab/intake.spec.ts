import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ScenarioView } from '../../shared/scenario';
import { build, getJson, pasteSource, questionField, scenarioIntake } from '../support/lab';

// The scenario a person checks and edits before it is used: each edit has to do what it says, to the
// rows that were there and to the rows that were not. It runs on the rules-mode server, with a real
// browser, because where focus goes cannot be seen any other way.

const QUESTION =
  'What could happen if the harbour office doubles the mooring fee for visiting boats?';
const NOTES = `Illustrative synthetic notes written for a test; no real harbour is described.

The harbour office is considering a higher mooring fee for visiting boats. Visiting skippers say the fee is already more than the marina next door asks, and the harbour master worries about empty berths in the shoulder season. Local sailing clubs ask for a discount for members, and the town council wants to know what the fee brings in.`;

test.use({ viewport: { width: 1440, height: 900 } });

/** Reads the question into a scenario and returns the review the person is then asked to check. */
async function review(page: Page): Promise<Locator> {
  await page.goto('/');
  await questionField(page).fill(QUESTION);
  const intake = scenarioIntake(page);
  await intake.getByRole('button', { name: 'Understand my question' }).click();
  const reviewing = intake.locator('.intake-review');
  // Focus lands on the heading, so that a keyboard is where the result is.
  await expect(
    reviewing.getByRole('heading', { name: 'Check and edit the scenario' }),
  ).toBeFocused();
  return reviewing;
}

const valuesOf = (fields: Locator): Promise<string[]> =>
  fields.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

test.describe('editing the scenario that was read', () => {
  test('adds an alternative: one more, the ones that were read unchanged, and the new one is named on its own', async ({
    page,
  }) => {
    const reviewing = await review(page);
    const alternatives = reviewing.getByRole('group', { name: /^Alternative \d+$/u });
    const names = () => valuesOf(alternatives.getByLabel('Name', { exact: true }));
    const before = await names();
    await reviewing.getByRole('button', { name: 'Add an alternative' }).click();
    await expect(alternatives).toHaveCount(before.length + 1);
    expect(await names()).toEqual([...before, '']);
    await alternatives.last().getByLabel('Name', { exact: true }).fill('A notice period');
    expect(await names()).toEqual([...before, 'A notice period']);
  });

  test('adds a change and takes focus to its name, and removing one takes the row away and returns focus to the control that adds', async ({
    page,
  }) => {
    const reviewing = await review(page);
    // The scenario's own changes: the alternatives each have a list of their own.
    const changes = reviewing.getByRole('group', { name: 'What changes' });
    const names = () => valuesOf(changes.getByLabel(/^Name of change \d+$/u));
    const add = changes.getByRole('button', { name: 'Add a change' });
    const before = await names();

    await add.click();
    await expect(changes.getByLabel(`Name of change ${before.length + 1}`)).toBeFocused();
    await changes.getByLabel(`Name of change ${before.length + 1}`).fill('Mooring fee');
    await add.click();
    await expect(changes.getByLabel(`Name of change ${before.length + 2}`)).toBeFocused();
    await changes.getByLabel(`Name of change ${before.length + 2}`).fill('Notice period');
    expect(await names()).toEqual([...before, 'Mooring fee', 'Notice period']);

    await changes
      .getByRole('button', { name: `Remove change ${before.length + 1}: Mooring fee` })
      .click();
    expect(await names()).toEqual([...before, 'Notice period']);
    await expect(changes.getByLabel('Mooring fee', { exact: true })).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('keeps an edit of the decision: it is used, shown, there again when the scenario is opened, and stored with the project', async ({
    page,
  }) => {
    const reviewing = await review(page);
    const decision = 'Double the mooring fee from the first of June';
    await reviewing.getByLabel(/^Decision or event/u).fill(decision);
    await reviewing.getByRole('button', { name: 'Use this scenario' }).click();

    const intake = scenarioIntake(page);
    const summary = intake.locator('.intake-summary');
    await expect(summary.locator('.intake-decision')).toHaveText(decision);
    await expect(summary).toContainText('Edited by you');

    await summary.getByRole('button', { name: 'Edit the scenario' }).click();
    await expect(intake.getByLabel(/^Decision or event/u)).toHaveValue(decision);
    await intake.getByRole('button', { name: 'Use this scenario' }).click();
    await expect(summary.locator('.intake-decision')).toHaveText(decision);

    // The project is made from the scenario that was used, not from the one that was read.
    await pasteSource(page, 'harbour-notes.md', NOTES);
    const project = await build(page);
    const stored = await getJson<ScenarioView>(page, `/api/projects/${project}/scenario`);
    expect(stored.scenario?.decision).toBe(decision);
    expect(stored.scenario?.origin).toBe('user');
  });
});
