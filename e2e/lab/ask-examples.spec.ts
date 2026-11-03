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
  exploreButton,
  expectAttached,
  groundIt,
  openAsk,
  openSamples,
  pill,
  questionBox,
  readScenario,
  recordRequests,
  templatesList,
  textOf,
  tray,
} from '../support/ask';

// The sample cases are a question and some evidence, and nothing else: no scenario, no stakeholders, no result comes
// with one. Choosing one fills the composer; everything after is made by the code that handles any other question.
// The templates are a sentence with blanks and no evidence at all. Rules mode. Motion is reduced so that nothing is
// measured while it moves.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

// The name begins with the words on the chip (WCAG 2.5.3 Label in Name) and then says what pressing it does.
const note = (page: Parameters<typeof openAsk>[0], title: string) =>
  page.getByRole('button', {
    name: new RegExp(
      `^${title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} · .*Dismiss this note$`,
      'u',
    ),
  });

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}$-]+/gu) ?? [];

test.describe('every sample case', () => {
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

      // What came with it is said under the composer, and the templates make way for that line.
      await expect(note(page, example.title)).toHaveText(
        `${example.title} · ${exampleSummary(example)}`,
      );
      await expect(templatesList(page)).toHaveCount(0);

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

  test('they are described as sample cases, with invented evidence, and not as recordings', async ({
    page,
  }) => {
    await openAsk(page);
    const dialog = await openSamples(page);
    await expect(dialog.getByRole('heading', { name: 'Sample cases' })).toBeVisible();
    await expect(dialog).toContainText('None of it describes a real case');
    // Each one says in a line what it is about, which is also its description for a screen reader.
    for (const example of EXAMPLES) {
      await expect(
        dialog.getByRole('button', { name: chipName(example), exact: true }),
      ).toHaveAccessibleDescription(example.blurb);
    }
  });

  test('they bring their own sources, so automatic research is off for them, and says so', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await expect(page.getByRole('switch', { name: /^Research automatically/u })).not.toBeChecked();
  });
});

test.describe('changing the mind', () => {
  test('the line that says what came with a sample case is dismissed, and the templates come back with the question and sources kept', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await note(page, EXAMPLES[0]!.title).click();
    await expect(templatesList(page).getByRole('listitem')).toHaveCount(7);
    await expect(questionBox(page)).toHaveValue(EXAMPLES[0]!.question);
    await expect(tray(page).getByRole('listitem')).toHaveCount(EXAMPLES[0]!.documents.length);
  });

  test('another sample case takes the place of the first: its question, its sources, and nothing of the first', async ({
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

  test('a sample case changes what was written before it, and the person can write over what it brought', async ({
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

  test('a sample case is chosen from the keyboard: Tab to the link, Enter, an arrow to a case and Enter', async ({
    page,
  }) => {
    await openAsk(page);
    const link = page.getByRole('button', { name: /^Try a sample case$/u });
    await link.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Try a sample case' });
    await expect(dialog).toBeVisible();
    const chip = dialog.getByRole('button', { name: chipName(EXAMPLES[3]!), exact: true });
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(questionBox(page)).toHaveValue(EXAMPLES[3]!.question);
    // Not back on the link that opened the list: where the person writes.
    await expect(questionBox(page)).toBeFocused();
  });

  test('closing the sample cases with Escape changes nothing and gives the keyboard back to the link', async ({
    page,
  }) => {
    await openAsk(page);
    await openSamples(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Try a sample case' })).toBeHidden();
    await expect(page.getByRole('button', { name: /^Try a sample case$/u })).toBeFocused();
    await expect(questionBox(page)).toHaveValue('');
    await expect(tray(page)).toHaveCount(0);
  });
});

test.describe('the templates', () => {
  const chip = (page: Parameters<typeof openAsk>[0], name: string) =>
    templatesList(page).getByRole('button', { name, exact: true });

  test('fill the box with a sentence to write over, select its first blank, and bring no evidence and no figure', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await chip(page, 'Market entry').click();
    const template =
      'What could happen if we enter [a market, region or community] with [an offer]?';
    await expect(questionBox(page)).toHaveValue(template);
    await expect(questionBox(page)).toBeFocused();
    expect(
      await questionBox(page).evaluate((box: HTMLTextAreaElement) =>
        box.value.slice(box.selectionStart, box.selectionEnd),
      ),
    ).toBe('[a market, region or community]');
    await expect(tray(page)).toHaveCount(0);
    await expectAttached(page, 0);
    expect(apiCalls(made).filter((call) => !call.startsWith('GET '))).toEqual([]);

    // The next words replace the blank that was selected.
    await page.keyboard.type('a coastal region');
    await expect(questionBox(page)).toHaveValue(
      'What could happen if we enter a coastal region with [an offer]?',
    );
  });

  test('are not read until their blanks are replaced: the person is told which blank is left', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await chip(page, 'AI adoption').click();
    await exploreButton(page).click();
    await expect(
      page.getByRole('main').getByRole('status').or(page.getByRole('main').getByRole('alert')),
    ).toContainText('Replace [a team] with your own words.');
    await expect(questionBox(page)).toBeFocused();
    expect(apiCalls(made).filter((call) => !call.startsWith('GET '))).toEqual([]);
  });

  test('"Custom" is the way to start from nothing: it clears a template that was not touched, and keeps what was written', async ({
    page,
  }) => {
    await openAsk(page);
    await chip(page, 'Policy change').click();
    await chip(page, 'Custom').click();
    await expect(questionBox(page)).toHaveValue('');
    await expect(questionBox(page)).toBeFocused();

    await questionBox(page).fill('What if the town closes the harbour to cars?');
    await chip(page, 'Custom').click();
    await expect(questionBox(page)).toHaveValue('What if the town closes the harbour to cars?');
  });
});

test.describe('what is made of a sample case', () => {
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
