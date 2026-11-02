import { expect, test, type APIRequestContext } from '@playwright/test';
import { makePdf } from '../../backend/test/pdf-fixture';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  watchPage,
} from '../support/helpers';
import { CITY_BRIEFING, CITY_QUESTION, getJson } from '../support/lab-api';
import {
  EXAMPLES,
  HARBOUR_NOTES,
  HARBOUR_QUESTION,
  addPage,
  apiCalls,
  closeEvidence,
  dropFiles,
  draggedFiles,
  evidenceButton,
  evidenceDialog,
  exploreButton,
  expectAttached,
  expectNothingClipped,
  chooseExample,
  fetchPage,
  fetchedPreview,
  groundIt,
  menuProblem,
  openAsk,
  openEvidence,
  pasteSource,
  pill,
  projectCount,
  questionBox,
  readScenario,
  recordRequests,
  removeSource,
  textFile,
  tray,
  uploadFiles,
  type UploadedFile,
} from '../support/ask';

// The three ways of bringing evidence in: files, pasted text and a public web page that the server fetches. What
// each takes, what it refuses and in what words, what leaves the browser, and what the project is made from.
// Rules mode. Motion is reduced so that nothing is measured while it moves.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

const writes = (made: Parameters<typeof apiCalls>[0]): string[] =>
  apiCalls(made).filter((call) => !call.startsWith('GET '));

/** Plain text of a size, with no control characters and nothing a source could not hold. */
const filler = (characters: number): string =>
  'Harbour notes written for a test. '.repeat(Math.ceil(characters / 34)).slice(0, characters);

const SURVEY_CSV = [
  'group,concern,count',
  'Visiting skippers,mooring fee too high,14',
  'Sailing clubs,member discount,9',
  'Harbour master,empty berths in the shoulder season,6',
  'Town council,revenue from the fee,3',
].join('\n');
const GROUPS_JSON = JSON.stringify({
  groups: [
    { name: 'Visiting skippers', concern: 'mooring fee too high' },
    { name: 'Sailing clubs', concern: 'member discount' },
    { name: 'Harbour master', concern: 'empty berths in the shoulder season' },
  ],
});

const kept = async (page: Parameters<typeof getJson>[0], project: string) =>
  getJson<{
    documents: {
      name: string;
      content: string;
      pageCount?: number;
      provenance?: { kind: string; url?: string; fetchedByServer?: boolean };
    }[];
  }>(page, `/api/projects/${project}`);

test.describe('files', () => {
  test('a text file is read in the browser, listed with its size, and sent nowhere', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const made = recordRequests(page);
    await openAsk(page);
    await uploadFiles(page, [textFile('notes.txt', HARBOUR_NOTES.content)]);
    await expect(pill(page, 'notes.txt')).toBeVisible();
    await expect(pill(page, 'notes.txt')).toHaveAccessibleName(
      `Read notes.txt, ${HARBOUR_NOTES.content.length} characters`,
    );
    await expectAttached(page, 1);
    await expect(evidenceDialog(page)).toContainText('1/10');
    // Reading a plain text file is the browser's work: nothing was asked of the server.
    expect(writes(made)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('a table is read by the server into text the person can read, and a PDF with its page count', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await uploadFiles(page, [
      textFile('survey.csv', SURVEY_CSV),
      textFile('groups.json', GROUPS_JSON),
      {
        name: 'minutes.pdf',
        mimeType: 'application/pdf',
        buffer: makePdf(HARBOUR_NOTES.content, 2),
      },
    ]);
    for (const name of ['survey.csv', 'groups.json', 'minutes.pdf']) {
      await expect(pill(page, name), name).toBeVisible();
    }
    expect(writes(made)).toEqual(Array(3).fill('POST /api/documents/extract'));

    // What the server read is what a person reads, and corrects, in the source.
    await pill(page, 'survey.csv').click();
    const sheet = page.getByRole('dialog', { name: 'survey.csv' });
    await expect(sheet.getByRole('textbox', { name: 'The text Swarm will work from' })).toHaveValue(
      /^Columns: group \| concern \| count\nRow 1: group: Visiting skippers/u,
    );
    await sheet.getByRole('button', { name: 'Done' }).click();

    await questionBox(page).fill(HARBOUR_QUESTION);
    await readScenario(page);
    const project = await groundIt(page);
    const documents = (await kept(page, project)).documents;
    expect(documents.map((document) => document.name)).toEqual([
      'survey.csv',
      'groups.json',
      'minutes.pdf',
    ]);
    expect(documents[2]!.pageCount).toBe(2);
    expect(documents[2]!.content).toContain('harbour office');
  });

  test('a kind of file Swarm does not read is refused with the reason, before anything is sent, and nothing is attached', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    const before = await projectCount(page);
    await uploadFiles(page, [
      {
        name: 'malware.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('MZ binary'),
      },
    ]);
    await expect(menuProblem(page)).toContainText(
      'malware.exe: Use UTF-8 TXT, Markdown, CSV, JSON or a text-based PDF.',
    );
    await expectAttached(page, 0);
    await expect(tray(page)).toHaveCount(0);
    expect(writes(made)).toEqual([]);
    expect(await projectCount(page)).toBe(before);
  });

  test('a PDF that is damaged is refused with the server’s reason and the number to quote', async ({
    page,
  }) => {
    const before = await projectCount(page);
    await openAsk(page);
    await uploadFiles(page, [
      {
        name: 'broken.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nthis is not a real pdf'),
      },
    ]);
    await expect(menuProblem(page)).toContainText(
      'broken.pdf: The PDF is malformed, encrypted, or not supported.',
    );
    await expect(menuProblem(page)).toContainText(/Request ID: [0-9a-f-]{36}/u);
    await expect(tray(page)).toHaveCount(0);
    expect(await projectCount(page)).toBe(before);
  });

  test('a PDF over 2 MB is refused before it is sent', async ({ page }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await uploadFiles(page, [
      { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2_100_000, 'a') },
    ]);
    await expect(menuProblem(page)).toContainText(
      'big.pdf: PDF files must be at most 2 MB before extraction.',
    );
    expect(writes(made)).toEqual([]);
  });

  test('text that is not UTF-8 is refused, and so is a file with too little in it', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await uploadFiles(page, [
      {
        name: 'latin1.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from([0xff, 0xfe, 0xfd, 0xc3, 0x28]),
      },
      textFile('tiny.txt', 'Far too short.'),
    ]);
    await expect(menuProblem(page)).toContainText(
      'latin1.txt: This file is not valid UTF-8 text. Save it as UTF-8 and try again.',
    );
    await expect(menuProblem(page)).toContainText(
      'tiny.txt: Each document needs at least 80 characters of source material.',
    );
    await expect(tray(page)).toHaveCount(0);
    expect(writes(made)).toEqual([]);
  });

  test('a table with too little readable data is refused in the server’s words', async ({
    page,
  }) => {
    await openAsk(page);
    await uploadFiles(page, [textFile('tiny.csv', 'a,b\n1,2\n')]);
    await expect(menuProblem(page)).toContainText(
      'tiny.csv: This file has fewer than 80 characters of readable data.',
    );
    await expect(tray(page)).toHaveCount(0);
  });

  test('one bad file among good ones is named, and the good ones are kept', async ({ page }) => {
    await openAsk(page);
    await uploadFiles(page, [
      textFile('first.txt', filler(300)),
      { name: 'picture.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') },
      textFile('second.md', filler(300)),
    ]);
    await expect(pill(page, 'first.txt')).toBeVisible();
    await expect(pill(page, 'second.md')).toBeVisible();
    await expect(menuProblem(page)).toContainText('picture.png: Use UTF-8 TXT');
    await expect(menuProblem(page)).not.toContainText('first.txt');
    await expect(menuProblem(page)).not.toContainText('second.md');
    await expect(evidenceDialog(page)).toContainText('2/10');
  });

  test('more than ten files at once are refused together, and none is attached', async ({
    page,
  }) => {
    await openAsk(page);
    await uploadFiles(
      page,
      Array.from({ length: 11 }, (_, index) => textFile(`note-${index + 1}.txt`, filler(120))),
    );
    await expect(menuProblem(page)).toContainText(
      'Use at most 10 source documents. No files were added.',
    );
    await expect(tray(page)).toHaveCount(0);
  });

  test('the sources together are limited, and the file that would pass the limit is the one refused', async ({
    page,
  }) => {
    await openAsk(page);
    await uploadFiles(
      page,
      Array.from({ length: 6 }, (_, index) => textFile(`part-${index + 1}.txt`, filler(39_000))),
    );
    await expect(menuProblem(page)).toContainText(
      'part-6.txt: Combined source text exceeds 200,000 characters.',
    );
    await expect(tray(page).getByRole('listitem')).toHaveCount(5);
    await expect(pill(page, 'part-6.txt')).toHaveCount(0);
  });

  test('a text longer than one source may hold is refused in a sentence, not in the words of a validator', async ({
    page,
  }) => {
    await openAsk(page);
    await uploadFiles(page, [textFile('long.txt', filler(45_000))]);
    await expect(menuProblem(page)).toContainText('long.txt:');
    const said = await menuProblem(page).innerText();
    expect(said).not.toMatch(/Too big|expected string|<=40000/u);
    expect(said).toMatch(/40,?000/u);
    await expect(tray(page)).toHaveCount(0);
  });

  test('reading can be stopped, and what was attached before stays', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/documents/extract', async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await openAsk(page);
    await uploadFiles(page, [textFile('notes.txt', filler(300))]);
    await expect(pill(page, 'notes.txt')).toBeVisible();

    await uploadFiles(page, [textFile('survey.csv', SURVEY_CSV)]);
    const dialog = evidenceDialog(page);
    await expect(dialog).toContainText('Reading survey.csv');
    await dialog.getByRole('button', { name: 'Stop reading' }).click();
    await expect(menuProblem(page)).toContainText(
      'Reading was stopped. Files already attached are unchanged.',
    );
    await expect(pill(page, 'notes.txt')).toBeVisible();
    await expect(pill(page, 'survey.csv')).toHaveCount(0);
    release();
    await expect(dialog).not.toContainText('Reading survey.csv');
    await expect(tray(page).getByRole('listitem')).toHaveCount(1);
  });

  test('files dropped on the composer are attached, and the composer says it will take them while they are over it', async ({
    page,
  }) => {
    await openAsk(page);
    const composer = questionBox(page).locator('xpath=ancestor::form');
    const files: UploadedFile[] = [textFile('dropped.txt', filler(300))];
    const transfer = await draggedFiles(page, files);
    await composer.dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(page.getByText('Drop to add evidence')).toBeVisible();
    await composer.dispatchEvent('dragleave', { dataTransfer: transfer });
    await expect(page.getByText('Drop to add evidence')).toHaveCount(0);

    await dropFiles(page, composer, files);
    await expect(pill(page, 'dropped.txt')).toBeVisible();
    await expect(page.getByText('Drop to add evidence')).toHaveCount(0);
    await expectAttached(page, 1);
  });

  test('a source is taken away from its pill, and the count follows', async ({ page }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    const gone = EXAMPLES[0]!.documents[1]!.name;
    await removeSource(page, gone).click();
    await expect(pill(page, gone)).toHaveCount(0);
    await expectAttached(page, EXAMPLES[0]!.documents.length - 1);
  });

  test('the sources that stay are the same pills afterwards: taking one away moves nothing else out and in again', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    const [first, second] = EXAMPLES[0]!.documents.map((document) => document.name);
    await pill(page, second!).evaluate((button) => {
      (button.closest('li') as HTMLElement & { kept?: boolean }).kept = true;
    });
    await removeSource(page, first!).click();
    await expect(pill(page, first!)).toHaveCount(0);
    expect(
      await pill(page, second!).evaluate(
        (button) => (button.closest('li') as HTMLElement & { kept?: boolean }).kept === true,
      ),
      'the pill that stayed is the one that was there, not a new one that looks like it',
    ).toBe(true);
  });

  test('taking a source away with the keyboard leaves it on the next one, and on the evidence button after the last', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    // An example puts the keyboard in the question; the keys that follow are the person's.
    await expect(questionBox(page)).toBeFocused();
    const names = EXAMPLES[0]!.documents.map((document) => document.name);
    await removeSource(page, names[1]!).focus();
    await page.keyboard.press('Enter');
    await expect(pill(page, names[1]!)).toHaveCount(0);
    await expect(pill(page, names[2]!), 'the source that took its place').toBeFocused();

    for (const name of names.filter((_, index) => index !== 1)) {
      await removeSource(page, name).focus();
      await page.keyboard.press('Enter');
      await expect(pill(page, name)).toHaveCount(0);
    }
    await expect(tray(page)).toHaveCount(0);
    await expect(evidenceButton(page), 'with none left, the control that adds one').toBeFocused();
  });

  test('at the most sources a project can hold, the menu says so and waits until one is taken away', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    const room = 10 - EXAMPLES[0]!.documents.length;
    await uploadFiles(
      page,
      Array.from({ length: room }, (_, index) => textFile(`extra-${index + 1}.txt`, filler(120))),
    );
    const dialog = evidenceDialog(page);
    await expect(dialog).toContainText('10/10');
    await expect(dialog).toContainText(
      'The most sources a project can hold is 10. Remove one to add another.',
    );
    await expect(dialog.getByRole('button', { name: /Drop files, or choose/u })).toBeDisabled();
    await openEvidence(page, 'Paste');
    await dialog.getByRole('textbox', { name: 'Source text, not your question' }).fill(filler(200));
    await expect(dialog.getByRole('button', { name: 'Attach', exact: true })).toBeDisabled();

    await removeSource(page, 'extra-1.txt').click();
    await expect(dialog.getByRole('button', { name: 'Attach', exact: true })).toBeEnabled();
  });
});

test.describe('pasted text', () => {
  test('is attached under the name the person gives it, and the next name offered is a new one', async ({
    page,
  }) => {
    await openAsk(page);
    const dialog = await openEvidence(page, 'Paste');
    const name = dialog.getByRole('textbox', { name: 'Source filename' });
    await expect(name).toHaveValue('notes.txt');
    await dialog.getByRole('textbox', { name: 'Source text, not your question' }).fill(filler(300));
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click();
    await expect(pill(page, 'notes.txt')).toBeVisible();
    // The text is emptied, and the next source is offered a name that no source has.
    await expect(
      dialog.getByRole('textbox', { name: 'Source text, not your question' }),
    ).toHaveValue('');
    await expect(name).toHaveValue('notes-2.txt');

    await name.fill('minutes.md');
    await dialog.getByRole('textbox', { name: 'Source text, not your question' }).fill(filler(300));
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click();
    await expect(pill(page, 'minutes.md')).toBeVisible();
    await expect(dialog).toContainText('2/10');
  });

  test('the button waits for text, and a text of under 80 characters is refused with the number it needs', async ({
    page,
  }) => {
    await openAsk(page);
    const dialog = await openEvidence(page, 'Paste');
    const attach = dialog.getByRole('button', { name: 'Attach', exact: true });
    await expect(attach).toBeDisabled();
    await dialog
      .getByRole('textbox', { name: 'Source text, not your question' })
      .fill('Too short.');
    await attach.click();
    await expect(menuProblem(page)).toContainText(
      'Each document needs at least 80 characters of source material.',
    );
    // What was typed is still there, to be added to.
    await expect(
      dialog.getByRole('textbox', { name: 'Source text, not your question' }),
    ).toHaveValue('Too short.');
    await expect(tray(page)).toHaveCount(0);
  });

  test('a name that is not the name of a source is refused', async ({ page }) => {
    await openAsk(page);
    const dialog = await openEvidence(page, 'Paste');
    await dialog.getByRole('textbox', { name: 'Source filename' }).fill('minutes');
    await dialog.getByRole('textbox', { name: 'Source text, not your question' }).fill(filler(300));
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click();
    await expect(menuProblem(page)).toContainText(
      'Use a TXT, Markdown, CSV, JSON or extracted PDF filename.',
    );
    await expect(tray(page)).toHaveCount(0);
  });

  test('the source goes to the server only when the project is made, and what is sent is what was pasted', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    expect(writes(made)).toEqual([]);
    await readScenario(page);
    const created = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/projects' && request.method() === 'POST',
    );
    await groundIt(page);
    const sent = (await created).postDataJSON() as {
      documents: { name: string; content: string }[];
    };
    expect(sent.documents).toEqual([
      { name: HARBOUR_NOTES.name, content: HARBOUR_NOTES.content.trim() },
    ]);
  });
});

test.describe('a source that is opened', () => {
  test('is read, corrected and taken away where it stands, and the correction is what the project is made from', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await pill(page, HARBOUR_NOTES.name).click();

    const sheet = page.getByRole('dialog', { name: HARBOUR_NOTES.name });
    await expect(sheet).toBeVisible();
    const text = sheet.getByRole('textbox', { name: 'The text Swarm will work from' });
    await expect(text).toHaveValue(HARBOUR_NOTES.content.trim());
    const corrected = `${HARBOUR_NOTES.content.trim()}\nThe harbour master adds that the fee has not changed since 2019.`;
    await text.fill(corrected);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toBeHidden();
    await expect(pill(page, HARBOUR_NOTES.name)).toHaveAccessibleName(
      `Read ${HARBOUR_NOTES.name}, ${corrected.length} characters`,
    );

    await readScenario(page);
    const project = await groundIt(page);
    expect((await kept(page, project)).documents[0]!.content).toBe(corrected);
  });

  test('says of a sample that it is invented, and gives it back whole', async ({ page }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await pill(page, EXAMPLES[0]!.documents[0]!.name).click();
    const sheet = page.getByRole('dialog', { name: EXAMPLES[0]!.documents[0]!.name });
    await expect(sheet).toContainText('sample evidence');
    await expect(sheet).toContainText('Sample evidence: invented, describes no real case');
    // The text is the example's, whole: the only difference allowed is the line that ends the file.
    const text = sheet.getByRole('textbox', { name: 'The text Swarm will work from' });
    expect((await text.inputValue()).trim()).toBe(EXAMPLES[0]!.documents[0]!.content.trim());
  });

  test('closing it returns the keyboard to the source it was opened from', async ({ page }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    const first = EXAMPLES[0]!.documents[0]!.name;
    await pill(page, first).click();
    const sheet = page.getByRole('dialog', { name: first });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(pill(page, first)).toBeFocused();
  });

  test('taking it away from there closes it and leaves the keyboard in the composer', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    const first = EXAMPLES[0]!.documents[0]!.name;
    await pill(page, first).click();
    const sheet = page.getByRole('dialog', { name: first });
    await sheet.getByRole('button', { name: 'Remove' }).click();
    await expect(sheet).toBeHidden();
    await expect(pill(page, first)).toHaveCount(0);
    await expect(tray(page).getByRole('listitem')).toHaveCount(EXAMPLES[0]!.documents.length - 1);
    await expect(page.locator('main :focus'), 'focus is on the page').toHaveCount(1);
  });
});

test.describe('the evidence menu', () => {
  test('is one choice of three, moved by the arrow keys', async ({ page }) => {
    await openAsk(page);
    const dialog = await openEvidence(page);
    const ways = dialog.getByRole('radiogroup', { name: 'How to add evidence' });
    await expect(ways.getByRole('radio')).toHaveText(['Files', 'Paste', 'Web page']);
    await ways.getByRole('radio', { name: 'Files' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(ways.getByRole('radio', { name: 'Paste' })).toBeChecked();
    await expect(ways.getByRole('radio', { name: 'Paste' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(ways.getByRole('radio', { name: 'Web page' })).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(ways.getByRole('radio', { name: 'Files' })).toBeChecked();
  });

  test('closes with Escape and returns the keyboard to the button that opened it', async ({
    page,
  }) => {
    await openAsk(page);
    await evidenceButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(evidenceDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(evidenceDialog(page)).toBeHidden();
    await expect(evidenceButton(page)).toBeFocused();
  });

  test('is open on the first screen and again in the scenario, and says the same in both', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await openEvidence(page, 'Web page');
    await expect(evidenceDialog(page)).toContainText(
      'Only the extracted text is kept. Uploads stay on this server.',
    );
    await closeEvidence(page);
    await readScenario(page);
    await page.getByRole('button', { name: 'Add evidence' }).click();
    await expect(evidenceDialog(page)).toContainText(
      'Only the extracted text is kept. Uploads stay on this server.',
    );
    await expect(evidenceDialog(page)).toContainText(`${EXAMPLES[0]!.documents.length}/10`);
  });

  test('forgets what went wrong when it is closed, so that the next opening does not scold', async ({
    page,
  }) => {
    await openAsk(page);
    await uploadFiles(page, [
      { name: 'old-failure.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
    ]);
    await expect(menuProblem(page)).toContainText('old-failure.exe');
    await closeEvidence(page);
    await openEvidence(page);
    await expect(menuProblem(page)).toHaveCount(0);

    // A refused question does not drag the old failure back either, and a good file is then accepted.
    await closeEvidence(page);
    await exploreButton(page).click();
    await expect(page.getByText(/old-failure\.exe/u)).toHaveCount(0);
    await uploadFiles(page, [
      { name: 'library-notes.pdf', mimeType: 'application/pdf', buffer: makePdf(filler(300)) },
    ]);
    await expect(pill(page, 'library-notes.pdf')).toBeVisible();
    await expect(page.getByText(/not supported|malformed/u)).toHaveCount(0);
  });

  test('offers a web page only where the server says it reads them', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...body, urlIngestion: false } });
    });
    await openAsk(page);
    const dialog = await openEvidence(page);
    await expect(dialog.getByRole('radio')).toHaveText(['Files', 'Paste']);
  });

  test('keeps to the screen at every size, with every line readable', async ({ page }) => {
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1366, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      await openAsk(page);
      for (const way of ['Files', 'Paste', 'Web page'] as const) {
        await openEvidence(page, way);
        await expectNoHorizontalOverflow(page);
        await expectNothingClipped(page, `${width}px: ${way}`, '[role=dialog]');
        await expectReadableText(page, `${width}px: the evidence menu, ${way}`);
      }
    }
  });
});

for (const theme of ['light', 'dark', 'high-contrast'] as const) {
  test.describe(`the evidence menu in the ${theme} theme`, () => {
    test('is clean with a source attached and a file refused', async ({ page }) => {
      await openAsk(page, { theme });
      await uploadFiles(page, [
        textFile('notes.txt', filler(300)),
        { name: 'malware.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
      ]);
      await expect(menuProblem(page)).toBeVisible();
      await expectNoAxeViolations(page, `${theme}: files, a source attached and one refused`);
    });

    test('is clean with pasted text refused', async ({ page }) => {
      await openAsk(page, { theme });
      const dialog = await openEvidence(page, 'Paste');
      await dialog.getByRole('textbox', { name: 'Source text, not your question' }).fill('Short.');
      await dialog.getByRole('button', { name: 'Attach', exact: true }).click();
      await expect(menuProblem(page)).toBeVisible();
      await expectNoAxeViolations(page, `${theme}: paste, refused`);
    });

    test('is clean with a source opened', async ({ page }) => {
      await openAsk(page, { theme });
      await chooseExample(page, EXAMPLES[0]!);
      await pill(page, EXAMPLES[0]!.documents[0]!.name).click();
      await expect(
        page.getByRole('dialog', { name: EXAMPLES[0]!.documents[0]!.name }),
      ).toBeVisible();
      await expectNoAxeViolations(page, `${theme}: a source opened`);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// A public web page. The server (backend/test/support/lab-e2e-server.ts) is the real application, and the pages are
// fixtures on this machine that appear as public hosts, so the real fetcher, with all of its checks, reads them and no
// page on the internet is reached.
// ---------------------------------------------------------------------------------------------------------------

const WEB = process.env.E2E_LAB_WEB_URL ?? 'http://127.0.0.1:3117';
const FIXTURES = process.env.E2E_LAB_WEB_FIXTURE_URL ?? 'http://127.0.0.1:3118';
const PILOT = 'http://city-transport.example.org/central-zone-pilot';

test.describe('a public web page', () => {
  test.use({ baseURL: WEB });

  const NOT_PUBLIC = /Swarm reads only public web pages|web address Swarm can read/u;
  const NOT_FOUND_PUBLIC = /could not find .* on the public web/u;
  const attempts = async (request: APIRequestContext) =>
    (
      (await (await request.get(`${FIXTURES}/__attempts`)).json()) as {
        attempts: { host: string; path: string }[];
      }
    ).attempts;

  const refusals: [string, string, RegExp][] = [
    ['a loopback address', 'http://127.0.0.1/', NOT_PUBLIC],
    ['the cloud metadata service', 'http://169.254.169.254/latest/meta-data/', NOT_PUBLIC],
    ['a private network', 'http://10.0.0.5/admin', NOT_PUBLIC],
    ['localhost', 'http://localhost/', NOT_PUBLIC],
    ['an address written as one number', 'http://2130706433/', NOT_PUBLIC],
    // A name that leads inside a network is answered exactly like one that does not exist, so the answer cannot be
    // used to learn which names are in use there.
    [
      'a name that answers with a private address',
      'http://intranet-wiki.example.org/',
      NOT_FOUND_PUBLIC,
    ],
    [
      'a name with a metadata address among its answers',
      'http://mixed-answers.example.org/x',
      NOT_FOUND_PUBLIC,
    ],
    ['a file on the server', 'file:///etc/passwd', NOT_PUBLIC],
    [
      'a user name and password',
      `http://agent:${'hunter2'}@city-transport.example.org/central-zone-pilot`,
      NOT_PUBLIC,
    ],
    [
      'a page its site asks robots not to read',
      'http://city-transport.example.org/private/briefing',
      /robots\.txt/u,
    ],
    [
      'a page that is not there',
      'http://city-transport.example.org/nothing-here',
      /was not found/u,
    ],
    ['a site that does not exist', 'http://no-such-site.example.org/', /could not find/u],
  ];

  test('is fetched by the server, shown as a preview that says where it is from, and added as evidence on request', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const made = recordRequests(page);
    await openAsk(page);
    await questionBox(page).fill(CITY_QUESTION);
    const answer = await fetchPage(page, PILOT);
    expect(answer.status()).toBe(200);

    const preview = fetchedPreview(page);
    await expect(preview).toContainText(
      'Central zone charge pilot: findings from the first six weeks',
    );
    await expect(preview).toContainText('city-transport.example.org');
    await expect(preview.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/u);
    await expect(preview).toContainText(/\d[\d.]*k? characters/u);
    // Looking is not attaching: nothing is a source until the person says so.
    await expectAttached(page, 0);
    await preview.getByRole('button', { name: 'Add as evidence' }).click();
    await expectAttached(page, 1);
    await expect(preview).toHaveCount(0);
    await expect(evidenceDialog(page).getByRole('textbox', { name: 'Web address' })).toHaveValue(
      '',
    );
    await closeEvidence(page);

    // The server was asked once for the page, and what the project keeps says it was fetched by the server.
    expect(apiCalls(made).filter((call) => call === 'POST /api/evidence/url')).toHaveLength(1);
    await readScenario(page);
    const project = await groundIt(page);
    const [document] = (await kept(page, project)).documents;
    expect(document?.provenance).toMatchObject({ kind: 'url', fetchedByServer: true, url: PILOT });
    expect(problems).toEqual([]);
  });

  test('can be discarded, and nothing of it is kept', async ({ page }) => {
    await openAsk(page);
    expect((await fetchPage(page, PILOT)).status()).toBe(200);
    await expect(fetchedPreview(page)).toBeVisible();
    await evidenceDialog(page).getByRole('button', { name: 'Discard' }).click();
    await expect(fetchedPreview(page)).toHaveCount(0);
    await expect(evidenceDialog(page).getByRole('textbox', { name: 'Web address' })).toHaveValue(
      '',
    );
    await expectAttached(page, 0);
  });

  test('an address that is not public is refused in words, and nothing is kept or even contacted', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page, { refusals: true });
    await request.post(`${FIXTURES}/__reset`);
    await openAsk(page);
    const before = await projectCount(page);
    await questionBox(page).fill(CITY_QUESTION);

    for (const [what, address, reason] of refusals) {
      await test.step(`${what} is not read`, async () => {
        const answer = await fetchPage(page, address);
        expect(answer.status(), address).toBeGreaterThanOrEqual(400);
        expect(answer.status(), address).toBeLessThan(500);
        await expect(menuProblem(page)).toContainText('The page could not be read');
        await expect(menuProblem(page)).toContainText(reason);
        await expect(menuProblem(page)).toContainText(/You can paste (?:its|the) text instead\./u);
        // A person is told what is wrong, not how the server found out, and is never read back an address or password.
        const said = (await menuProblem(page).innerText()).toLowerCase();
        for (const leak of ['hunter2', '/etc/passwd', '169.254', 'econn', 'getaddrinfo', 'stack']) {
          expect(said, address).not.toContain(leak);
        }
        await expect(fetchedPreview(page)).toHaveCount(0);
        await expectAttached(page, 0);
      });
    }

    // The fetcher never so much as tried a private address. The only connections made were to the one public host that
    // a page was asked of: for its robots.txt, and for the page that was not there. The page that robots.txt forbids
    // was never requested.
    const made = await attempts(request);
    expect(made.length, 'connections made').toBeGreaterThan(0);
    for (const attempt of made) {
      expect(attempt.host, JSON.stringify(attempt)).toBe('city-transport.example.org');
      expect(['/robots.txt', '/nothing-here'], JSON.stringify(attempt)).toContain(attempt.path);
    }

    // Nothing was made or stored, and the menu still works for a page that is public.
    expect(await projectCount(page)).toBe(before);
    expect((await fetchPage(page, PILOT)).status()).toBe(200);
    await expect(fetchedPreview(page)).toBeVisible();
    expect(problems.filter((problem) => !/status of 4\d\d/u.test(problem))).toEqual([]);
  });

  test('typing after a refusal takes the refusal away and keeps the address to be corrected', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    await openAsk(page);
    const answer = await fetchPage(page, 'http://127.0.0.1/');
    expect(answer.status()).toBeGreaterThanOrEqual(400);
    expect(answer.status()).toBeLessThan(500);
    await expect(menuProblem(page)).toContainText('The page could not be read');
    const address = evidenceDialog(page).getByRole('textbox', { name: 'Web address' });
    await expect(address).toHaveValue('http://127.0.0.1/');
    await address.fill('http://city-transport.example.org/central-zone-pilot');
    await expect(menuProblem(page)).toHaveCount(0);
    expect(problems.filter((problem) => !/status of 4\d\d/u.test(problem))).toEqual([]);
  });

  test('a person can cancel while Swarm waits for a page, and nothing is kept', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openAsk(page);
    const dialog = await openEvidence(page, 'Web page');
    await dialog
      .getByRole('textbox', { name: 'Web address' })
      .fill('http://city-transport.example.org/never-answers');
    await dialog.getByRole('button', { name: 'Fetch', exact: true }).click();
    // While Swarm waits the button says so (as a status inside it) and cannot be pressed again.
    await expect(dialog.getByRole('button', { name: 'Fetch', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Fetch', exact: true })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(dialog.getByRole('status').filter({ hasText: 'Fetching the page' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(menuProblem(page)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Fetch', exact: true })).toBeEnabled();
    await expectAttached(page, 0);
    // The menu is not left waiting: the next page is read.
    expect((await fetchPage(page, PILOT)).status()).toBe(200);
    expect(problems).toEqual([]);
  });

  test('pressing Enter in the address fetches the page, and neither reads the question nor makes a project', async ({
    page,
  }) => {
    const made = recordRequests(page);
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    await openAsk(page);
    const loaded = navigations;
    const before = await projectCount(page);
    await questionBox(page).fill(CITY_QUESTION);
    const dialog = await openEvidence(page, 'Web page');
    const address = dialog.getByRole('textbox', { name: 'Web address' });
    await address.fill(PILOT);
    const answered = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/evidence/url',
    );
    await address.press('Enter');
    expect((await answered).status()).toBe(200);
    await expect(fetchedPreview(page)).toBeVisible();

    // Only the page was asked for: no question was read, no project made, the page was not reloaded.
    expect(writes(made)).toEqual(['POST /api/evidence/url']);
    await expect(page).not.toHaveURL(/project=/u);
    await expect(questionBox(page)).toHaveValue(CITY_QUESTION);
    expect(navigations).toBe(loaded);
    expect(await projectCount(page)).toBe(before);
  });

  test('a page that tries to run something, or to instruct the analysis, is only text', async ({
    page,
  }) => {
    const problems = watchPage(page);
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await openAsk(page);
    await questionBox(page).fill(CITY_QUESTION);
    const answer = await fetchPage(page, 'http://city-transport.example.org/zone-notice');
    expect(answer.status()).toBe(200);
    const preview = fetchedPreview(page);
    await expect(preview).toContainText('reads like instructions to an AI system');
    // The preview is text: whatever markup the page wrote is not an element of the preview.
    await expect(preview.locator('img, script')).toHaveCount(0);
    const { document } = (await answer.json()) as { document: { name: string; content: string } };
    // The markup the page wrote out is the text it is, and the instruction to an AI is kept as text.
    expect(document.content).toContain('<img src=x onerror="window.__pwned = 1">');
    expect(document.content).toContain('ignore all previous instructions');
    await evidenceDialog(page).getByRole('button', { name: 'Add as evidence' }).click();
    await closeEvidence(page);
    await readScenario(page);
    await groundIt(page);

    // Nothing the page said ran, and none of it became an element.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
    expect(dialogs).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a page that the person then changes is no longer called a retrieved page', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(CITY_QUESTION);
    const added = await addPage(page, PILOT);
    await pill(page, added.name).click();
    const sheet = page.getByRole('dialog', { name: added.name });
    await expect(sheet).toContainText('public web page');
    const text = sheet.getByRole('textbox', { name: 'The text Swarm will work from' });
    await text.fill(`${await text.inputValue()}\nAn extra sentence the person added.`);
    await sheet.getByRole('button', { name: 'Done' }).click();

    await readScenario(page);
    const project = await groundIt(page);
    const [document] = (await kept(page, project)).documents;
    expect(document?.content).toContain('An extra sentence the person added.');
    expect(document?.provenance?.kind).not.toBe('url');
    expect(document?.provenance?.fetchedByServer).not.toBe(true);
  });

  test('is one of several kinds of evidence in one project, each kept as what it is', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(CITY_QUESTION);
    await pasteSource(page, CITY_BRIEFING.name, CITY_BRIEFING.content);
    await uploadFiles(page, [textFile('survey.csv', SURVEY_CSV)]);
    await closeEvidence(page);
    await addPage(page, PILOT);
    await expectAttached(page, 3);
    await readScenario(page);
    const project = await groundIt(page);
    const documents = (await kept(page, project)).documents;
    expect(documents.map((document) => document.name).slice(0, 2)).toEqual([
      CITY_BRIEFING.name,
      'survey.csv',
    ]);
    expect(documents.map((document) => document.provenance?.kind ?? 'none')).toEqual([
      expect.stringMatching(/^(?:none|paste)$/u),
      expect.stringMatching(/^(?:none|upload)$/u),
      'url',
    ]);
  });

  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    test(`shows its preview cleanly in the ${theme} theme`, async ({ page }) => {
      await openAsk(page, { theme });
      expect((await fetchPage(page, PILOT)).status()).toBe(200);
      await expect(fetchedPreview(page)).toBeVisible();
      await expectNoAxeViolations(page, `${theme}: a fetched page`);
    });
  }

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ] as const) {
    test(`fits ${width}px with its preview open`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openAsk(page);
      expect((await fetchPage(page, PILOT)).status()).toBe(200);
      await expect(fetchedPreview(page)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNothingClipped(page, `${width}px: a fetched page`, '[role=dialog]');
      await expectReadableText(page, `${width}px: a fetched page`);
    });
  }
});
