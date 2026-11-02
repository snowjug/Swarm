import { expect, test } from '@playwright/test';
import { getJson } from '../support/lab-api';
import { watchPage } from '../support/helpers';
import {
  EXAMPLES,
  STARTER,
  apiCalls,
  chipName,
  chooseExample,
  chooseStarter,
  exampleSummary,
  examplesList,
  exploreButton,
  expectAttached,
  groundIt,
  openAsk,
  pill,
  questionBox,
  readScenario,
  recordRequests,
  textOf,
  tray,
} from '../support/ask';

// The examples are a question and some evidence, and nothing else: no scenario, no stakeholders, no result comes with
// one. Choosing one fills the composer; everything after is made by the code that handles any other question. Rules
// mode. Motion is reduced so that nothing is measured while it moves.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

const note = (page: Parameters<typeof openAsk>[0], title: string) =>
  page.getByRole('button', { name: `${title} loaded. Dismiss this note` });

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}$-]+/gu) ?? [];

test.describe('every example', () => {
  for (const example of EXAMPLES) {
    test(`"${chipName(example)}" brings its own question and every one of its sources, and says what came with it`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      const made = recordRequests(page);
      await openAsk(page);
      await chooseExample(page, example);

      // The question and the sources, in the order the example gives them, and nothing left from before.
      await expect(questionBox(page)).toHaveValue(example.question);
      await expect(tray(page).getByRole('button', { name: /^Read / })).toHaveText(
        example.documents.map((document) => document.name),
      );
      await expectAttached(page, example.documents.length);

      // What came with it is said under the composer, and the chips make way for that line.
      await expect(note(page, example.title)).toHaveText(
        `${example.title} · ${exampleSummary(example)}`,
      );
      await expect(examplesList(page)).toHaveCount(0);

      // The keyboard is where the person writes, so that the question can be changed at once.
      await expect(questionBox(page)).toBeFocused();
      await expect(exploreButton(page)).toBeEnabled();

      // Choosing is not asking: nothing was sent.
      expect(apiCalls(made).filter((call) => !call.startsWith('GET '))).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test('the fictional starter is loaded like any other, and says that it is invented', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseStarter(page);
    await expect(note(page, STARTER.title)).toHaveText(`${STARTER.title} · ${STARTER.summary}`);
    await expect(pill(page, STARTER.document)).toBeVisible();
    await pill(page, STARTER.document).click();
    const sheet = page.getByRole('dialog', { name: STARTER.document });
    await expect(sheet).toContainText('Sample evidence: invented, describes no real case');
    await expect(sheet.getByRole('textbox', { name: 'The text Swarm will work from' })).toHaveValue(
      /Fictional starter input — not a real case/u,
    );
  });
});

test.describe('changing the mind', () => {
  test('the line that says what came with an example is dismissed, and the chips come back with the question and sources kept', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await note(page, EXAMPLES[0]!.title).click();
    await expect(examplesList(page).getByRole('listitem')).toHaveCount(EXAMPLES.length + 1);
    await expect(questionBox(page)).toHaveValue(EXAMPLES[0]!.question);
    await expect(tray(page).getByRole('listitem')).toHaveCount(EXAMPLES[0]!.documents.length);
  });

  test('another example takes the place of the first: its question, its sources, and nothing of the first', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await note(page, EXAMPLES[0]!.title).click();
    await chooseExample(page, EXAMPLES[1]!);

    await expect(questionBox(page)).toHaveValue(EXAMPLES[1]!.question);
    await expect(tray(page).getByRole('button', { name: /^Read / })).toHaveText(
      EXAMPLES[1]!.documents.map((document) => document.name),
    );
    await expect(note(page, EXAMPLES[1]!.title)).toBeVisible();
    await expect(note(page, EXAMPLES[0]!.title)).toHaveCount(0);
  });

  test('an example changes what was written before it, and the person can write over what it brought', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill('What if the harbour doubles its fees next season?');
    await chooseExample(page, EXAMPLES[2]!);
    await expect(questionBox(page)).toHaveValue(EXAMPLES[2]!.question);

    // It is a start: the question is the person's to change, and what is read is what they leave there.
    const own = `${EXAMPLES[2]!.question.replace(/\?$/u, '')} for returning customers only?`;
    await questionBox(page).fill(own);
    const parsed = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/scenario/parse',
    );
    await exploreButton(page).click();
    expect(((await parsed).postDataJSON() as { question: string }).question).toBe(own);
  });

  test('is chosen from the keyboard: Tab to a chip and Enter', async ({ page }) => {
    await openAsk(page);
    const chip = examplesList(page).getByRole('button', {
      name: chipName(EXAMPLES[3]!),
      exact: true,
    });
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(questionBox(page)).toHaveValue(EXAMPLES[3]!.question);
    await expect(questionBox(page)).toBeFocused();
  });

  test('says on a chip, when it is pointed at or focused, what the example is about', async ({
    page,
  }) => {
    await openAsk(page);
    const chip = examplesList(page).getByRole('button', {
      name: chipName(EXAMPLES[0]!),
      exact: true,
    });
    await chip.hover();
    await expect(page.getByRole('tooltip').first()).toContainText(EXAMPLES[0]!.blurb);
    // Pointed away, with a few moves as a hand makes them: the tooltip that opens above a chip covers the composer.
    await page.mouse.move(2, 2, { steps: 8 });
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await chip.focus();
    await expect(page.getByRole('tooltip').first()).toContainText(EXAMPLES[0]!.blurb);
  });
});

test.describe('what is made of an example', () => {
  test('is read into a scenario about its own question, and the same reading serves each example', async ({
    page,
  }) => {
    const found: string[] = [];
    for (const example of EXAMPLES) {
      await openAsk(page);
      await chooseExample(page, example);
      await readScenario(page);
      const decision = await textOf(page, 'The decision or event');
      // Every word of the decision is the question's own: the reading takes nothing from anywhere else.
      const question = new Set(wordsOf(example.question));
      expect(
        wordsOf(decision).filter((word) => !question.has(word)),
        `${chipName(example)}: words of the decision that are not in the question`,
      ).toEqual([]);
      expect(decision.length).toBeGreaterThan(20);
      found.push(decision);
    }
    expect(new Set(found).size, 'each example is read into a scenario of its own').toBe(
      EXAMPLES.length,
    );
  });

  for (const example of [EXAMPLES[0]!, EXAMPLES[2]!]) {
    test(`"${chipName(example)}" becomes a project whose sources are the example's, marked as samples, and with no result`, async ({
      page,
    }) => {
      await openAsk(page);
      await chooseExample(page, example);
      await readScenario(page);
      const project = await groundIt(page);

      const made = await getJson<{
        question: string;
        documents: { name: string; content: string; provenance?: { kind: string } }[];
        status: string;
        rounds: unknown[];
      }>(page, `/api/projects/${project}`);
      expect(made.question).toBe(example.question);
      expect(made.documents.map((document) => document.name)).toEqual(
        example.documents.map((document) => document.name),
      );
      for (const [index, document] of made.documents.entries()) {
        expect(document.content.trim(), document.name).toBe(
          example.documents[index]!.content.trim(),
        );
        expect(document.provenance?.kind, document.name).toBe('sample');
      }
      // An example carries no answer: nothing has run but the reading of its sources.
      expect(made.rounds).toEqual([]);
    });
  }
});
