import { expect, test, type Page } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTouchTargets,
  openDisclosure,
  viewports,
  watchPage,
} from '../support/helpers';
import { projectOf } from '../support/app';
import { claimsAgainst, textsOf } from '../support/lab-api';
import {
  EXAMPLES,
  HARBOUR_NOTES,
  HARBOUR_QUESTION,
  HEADING,
  answerQuestion,
  apiCalls,
  bar,
  chooseExample,
  coveredByBars,
  editText,
  editable,
  exploreButton,
  expectNothingClipped,
  focusIsIn,
  focusedElement,
  goOn,
  groundIt,
  openAsk,
  part,
  pasteSource,
  projectCount,
  question,
  questionBox,
  readScenario,
  recordRequests,
  reviewHarbour,
  reviewHeading,
  readingView,
  scenarioOf,
  textOf,
} from '../support/ask';
import type { ScenarioFrame } from '../../shared/scenario';

// The scenario Swarm reads from the question, laid out to be read and corrected before anything is made: what each
// edit does to the rows that were there and to the rows that were not, where focus goes, what the bar at the foot
// says, and what the project is made from. Rules mode. Motion is reduced so that nothing is measured while it moves.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

const READ_DECISION = 'The harbour office doubles the mooring fee for visiting boats';
const BAR = bar;
const writes = (made: Parameters<typeof apiCalls>[0]): string[] =>
  apiCalls(made).filter((call) => !call.startsWith('GET '));

/** What every button that edits a name in a list of rows holds ("Change 1 name: mooring fee. Edit"), in order. */
const namesIn = async (scope: ReturnType<typeof part>, pattern: RegExp): Promise<string[]> =>
  (
    await scope
      .getByRole('button', { name: pattern })
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''))
  ).map((label) => label.replace(/^[^:]*: /u, '').replace(/\. Edit$/u, ''));

test.describe('the scenario that was read', () => {
  test('is laid out to be read and corrected, says how it was made, and has stored nothing yet', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const made = recordRequests(page);
    await openAsk(page);
    const before = await projectCount(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await readScenario(page);

    // The question is kept above what was made of it, and the scenario is a page, not a form.
    await expect(page.getByRole('main').locator('blockquote')).toHaveText(HARBOUR_QUESTION);
    await expect(page.getByRole('heading', { level: 2 })).toContainText(READ_DECISION);
    expect(await textOf(page, 'The decision or event')).toBe(READ_DECISION);
    for (const title of [
      'What changes',
      'If nothing changes',
      'Ways to do it',
      'Who is affected',
      'Assumed',
      'Swarm asks',
      'Evidence',
    ]) {
      await expect(part(page, title), title).toBeVisible();
    }
    expect(await textOf(part(page, 'What changes'), 'Change 1 name')).toBe('mooring fee');
    expect(await textOf(part(page, 'What changes'), 'Change 1, to')).toBe('doubled');

    // Who made it is said, and what the rules cannot know is said where the person can open it.
    await expect(page.getByText('Read by rules, not a model', { exact: true })).toBeVisible();
    const method = await openDisclosure(page, 'How it was read');
    await expect(method).toContainText('can miss or misread things: check every field');

    // Nothing was made: the bar says so, and the server has been asked to read and to nothing else.
    await expect(BAR(page)).toContainText('Nothing runs until you continue.');
    await expect(goOn(page)).toBeEnabled();
    expect(await projectCount(page)).toBe(before);
    expect(writes(made)).toEqual(['POST /api/scenario/parse']);
    expect(problems).toEqual([]);
  });

  test('says nothing that claims to predict', async ({ page }) => {
    await reviewHarbour(page);
    await openDisclosure(page, 'How it was read');
    const said = await textsOf(page.getByRole('main').locator('h2, h3, p, li, blockquote'));
    expect(said.flatMap(claimsAgainst), 'what the scenario says').toEqual([]);
  });

  test('every piece of text is edited where it stands: Enter keeps the edit, Escape drops it', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const scope = editable(page, 'What it affects');
    expect(await textOf(page, 'What it affects')).toBe('Harbour office');

    // Escape drops what was typed, and focus returns to the text it was on.
    await scope.focus();
    await scope.press('Enter');
    const field = page.getByRole('textbox', { name: 'What it affects', exact: true });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Harbour office');
    await field.fill('Something else');
    await field.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(scope).toBeFocused();
    expect(await textOf(page, 'What it affects')).toBe('Harbour office');

    // Enter keeps it, and focus returns to the text it was on.
    await scope.press('Enter');
    await field.fill('Harbour and marina');
    await field.press('Enter');
    await expect(scope).toBeFocused();
    expect(await textOf(page, 'What it affects')).toBe('Harbour and marina');

    // Leaving the field keeps what was typed too: nothing is lost by clicking away.
    await scope.click();
    await field.fill('Harbour, marina and slipway');
    await field.press('Tab');
    expect(await textOf(page, 'What it affects')).toBe('Harbour, marina and slipway');
  });

  test('a long text has lines of its own: Enter adds a line and Ctrl+Enter keeps the edit', async ({
    page,
  }) => {
    await reviewHarbour(page);
    await editable(page, 'The decision or event').click();
    const field = page.getByRole('textbox', { name: 'The decision or event', exact: true });
    await field.fill('Double the mooring fee');
    await field.press('Enter');
    await expect(field).toBeVisible();
    await field.pressSequentially('from the first of June');
    await expect(field).toHaveValue('Double the mooring fee\nfrom the first of June');
    await field.press('Control+Enter');
    await expect(field).toHaveCount(0);
    expect(await textOf(page, 'The decision or event')).toBe(
      'Double the mooring fee\nfrom the first of June',
    );
  });

  test('the first edit makes the scenario the person’s own, and the label says so', async ({
    page,
  }) => {
    await reviewHarbour(page);
    await expect(page.getByText('Read by rules, not a model', { exact: true })).toBeVisible();
    await editText(page, 'Where', 'Whitby');
    await expect(page.getByText('Edited by you', { exact: true })).toBeVisible();
    await expect(page.getByText('Read by rules, not a model', { exact: true })).toHaveCount(0);
  });

  test('a scenario without a decision cannot be used, and the bar says what is missing', async ({
    page,
  }) => {
    await reviewHarbour(page);
    await editText(page, 'The decision or event', '', { multiline: true });
    await expect(BAR(page)).toContainText('Say what decision or event you want to explore.');
    await expect(goOn(page)).toBeDisabled();
    await expect(BAR(page)).not.toContainText('Nothing runs until you continue.');

    await editText(page, 'The decision or event', READ_DECISION, { multiline: true });
    await expect(goOn(page)).toBeEnabled();
    await expect(BAR(page)).toContainText('Nothing runs until you continue.');

    await editText(page, 'What is expected without the change', '', { multiline: true });
    await expect(BAR(page)).toContainText('Say what is expected without the change.');
    await expect(goOn(page)).toBeDisabled();
  });
});

test.describe('changing what the scenario holds', () => {
  test('adds a way to do it: one more, named in place, and the bar waits for its name', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const ways = part(page, 'Ways to do it');
    await expect(ways.getByRole('button', { name: /^Alternative \d+ name:/u })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add a way' }).click();
    // The new way opens for its name, and until it has one it cannot be used.
    const name = page.getByRole('textbox', { name: 'Alternative 1 name', exact: true });
    await expect(name).toBeFocused();
    await expect(BAR(page)).toContainText('Give every alternative a name, or remove it.');
    await expect(goOn(page)).toBeDisabled();

    await name.fill('A notice period');
    await name.press('Enter');
    expect(await textOf(ways, 'Alternative 1 name')).toBe('A notice period');
    await expect(BAR(page)).toContainText('Nothing runs until you continue.');
    await expect(goOn(page)).toBeEnabled();

    await editText(ways, 'Alternative 1 description', 'Tell visiting skippers a month ahead.', {
      multiline: true,
    });
    expect(await textOf(ways, 'Alternative 1 description')).toBe(
      'Tell visiting skippers a month ahead.',
    );

    // A second way is added after the first, which is left as it was.
    await page.getByRole('button', { name: 'Add a way' }).click();
    await page
      .getByRole('textbox', { name: 'Alternative 2 name', exact: true })
      .fill('Half the increase');
    await page.getByRole('textbox', { name: 'Alternative 2 name', exact: true }).press('Enter');
    expect(await textOf(ways, 'Alternative 1 name')).toBe('A notice period');
    expect(await textOf(ways, 'Alternative 2 name')).toBe('Half the increase');
  });

  test('a way is given changes of its own, apart from the scenario’s', async ({ page }) => {
    await reviewHarbour(page);
    const ways = part(page, 'Ways to do it');
    await page.getByRole('button', { name: 'Add a way' }).click();
    const name = page.getByRole('textbox', { name: 'Alternative 1 name', exact: true });
    await name.fill('Seasonal fee');
    await name.press('Enter');

    const card = ways.getByRole('listitem').filter({ hasText: 'Seasonal fee' }).first();
    const changes = await openDisclosure(card, /^What it changes/u);
    await changes.getByRole('button', { name: 'Add change' }).click();
    const first = page.getByRole('textbox', { name: 'Change 1 name', exact: true });
    await expect(first).toBeFocused();
    await first.fill('Mooring fee');
    await first.press('Enter');
    await editText(changes, 'Change 1, from', 'a flat fee');
    await editText(changes, 'Change 1, to', 'a summer fee');
    expect(await textOf(changes, 'Change 1 name')).toBe('Mooring fee');

    // The scenario's own changes are what they were.
    await expect
      .poll(() => namesIn(part(page, 'What changes'), /^Change \d+ name:/u))
      .toEqual(['mooring fee']);
  });

  test('adds changes and takes one away: the rows that were there are left as they were', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const changes = part(page, 'What changes');
    const names = () => namesIn(changes, /^Change \d+ name:/u);
    const before = await names();
    expect(before).toEqual(['mooring fee']);

    // Each new row opens for its name, and the one added next is after it.
    await changes.getByRole('button', { name: 'Add change' }).click();
    const second = page.getByRole('textbox', { name: 'Change 2 name', exact: true });
    await expect(second).toBeFocused();
    await second.fill('Notice period');
    await second.press('Enter');
    await changes.getByRole('button', { name: 'Add change' }).click();
    const third = page.getByRole('textbox', { name: 'Change 3 name', exact: true });
    await expect(third).toBeFocused();
    await third.fill('Member discount');
    await third.press('Enter');
    await expect.poll(names).toEqual([...before, 'Notice period', 'Member discount']);

    // Taking one away takes that row and no other.
    await changes.getByRole('button', { name: 'Remove change 2' }).click();
    await expect(changes.getByRole('button', { name: /^Change 3 name:/u })).toHaveCount(0);
    await expect.poll(names).toEqual([...before, 'Member discount']);
  });

  test('a change with no name cannot be used, and the bar says so', async ({ page }) => {
    await reviewHarbour(page);
    await part(page, 'What changes').getByRole('button', { name: 'Add change' }).click();
    await expect(page.getByRole('textbox', { name: 'Change 2 name', exact: true })).toBeFocused();
    await expect(BAR(page)).toContainText('Name every change, or remove it.');
    await expect(goOn(page)).toBeDisabled();
    await part(page, 'What changes').getByRole('button', { name: 'Remove change 2' }).click();
    await expect(goOn(page)).toBeEnabled();
  });

  test('a group is added, renamed and taken away; typing one and clicking away keeps it', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const who = part(page, 'Who is affected');
    // A chip that is renamed or taken away is still on the screen for the moment it takes to leave, so what the
    // list holds is read once it has settled.
    const groups = () => namesIn(who, /^Group \d+:/u);
    await expect.poll(groups).toEqual(['harbour office']);

    const add = who.getByRole('textbox', { name: 'Add to group' });
    await add.fill('Visiting skippers');
    await add.press('Enter');
    await expect(add).toHaveValue('');
    await expect.poll(groups).toEqual(['harbour office', 'Visiting skippers']);

    // Typed and left, not entered: the group is kept, so that nothing a person wrote is lost.
    await add.fill('Sailing clubs');
    await add.blur();
    await expect.poll(groups).toEqual(['harbour office', 'Visiting skippers', 'Sailing clubs']);

    await editText(who, 'Group 2', 'Visiting skippers and crews');
    await expect
      .poll(groups)
      .toEqual(['harbour office', 'Visiting skippers and crews', 'Sailing clubs']);

    await who.getByRole('button', { name: 'Remove Sailing clubs' }).click();
    await expect.poll(groups).toEqual(['harbour office', 'Visiting skippers and crews']);

    // Emptying a group's name takes the group away.
    await editText(who, 'Group 1', '');
    await expect.poll(groups).toEqual(['Visiting skippers and crews']);
  });

  test('an assumption is added, edited and taken away, and one that was edited is the person’s own', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const assumed = part(page, 'Assumed');
    await expect(assumed.getByRole('img', { name: 'System assumption' })).toHaveCount(1);
    await expect(assumed.getByRole('img', { name: 'Yours' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add an assumption' }).click();
    const fresh = page.getByRole('textbox', { name: 'Assumption 2', exact: true });
    await expect(fresh).toBeFocused();
    await fresh.fill('Visiting skippers read the notice before they book.');
    await fresh.press('Control+Enter');
    await expect(assumed.getByRole('img', { name: 'Yours' })).toHaveCount(1);

    // Editing the one Swarm filled in makes it the person's.
    await editText(
      assumed,
      'Assumption 1',
      'The change is announced with a month’s notice, and nothing else changes.',
      { multiline: true },
    );
    await expect(assumed.getByRole('img', { name: 'Yours' })).toHaveCount(2);
    await expect(assumed.getByRole('img', { name: 'System assumption' })).toHaveCount(0);

    await assumed.getByRole('button', { name: 'Remove assumption 2' }).click();
    await expect(assumed.getByRole('img', { name: 'Yours' })).toHaveCount(1);
    await expect(assumed.getByRole('button', { name: /^Assumption 2:/u })).toHaveCount(0);
  });

  test('answering a question puts the answer where it belongs, and skipping takes the question away', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const asks = part(page, 'Swarm asks');
    await expect(asks.getByRole('listitem')).toHaveCount(3);

    // A period goes where the time is written.
    await answerQuestion(page, 'Over what period', 'the first twelve months');
    expect(await textOf(page, 'Over what time')).toBe('the first twelve months');
    await expect(asks.getByRole('listitem')).toHaveCount(2);

    // Groups go among those who are affected, one for each, and success becomes the person's own assumption.
    await answerQuestion(page, 'Which groups', 'Visiting skippers, Sailing clubs');
    await expect
      .poll(() => namesIn(part(page, 'Who is affected'), /^Group \d+:/u))
      .toEqual(['harbour office', 'Visiting skippers', 'Sailing clubs']);
    await answerQuestion(page, 'good outcome', 'Berths stay full in the shoulder season');
    await expect(
      part(page, 'Assumed').getByRole('button', {
        name: /Success is judged by: Berths stay full in the shoulder season/u,
      }),
    ).toBeVisible();
    await expect(part(page, 'Assumed').getByRole('img', { name: 'Yours' })).toHaveCount(1);

    // With nothing left to ask, the part that asks is gone.
    await expect(page.getByRole('heading', { level: 3, name: 'Swarm asks' })).toHaveCount(0);
  });

  test('a question that is skipped is not answered for the person', async ({ page }) => {
    await reviewHarbour(page);
    const asks = part(page, 'Swarm asks');
    await question(page, 'Over what period').getByRole('button', { name: 'Skip' }).click();
    await expect(asks.getByRole('listitem')).toHaveCount(2);
    expect(await textOf(page, 'Over what time')).toBe('');
    await expect(goOn(page)).toBeEnabled();
  });

  test('an answer needs some words: the button waits until there are', async ({ page }) => {
    await reviewHarbour(page);
    const item = question(page, 'Over what period');
    await expect(item.getByRole('button', { name: 'Answer', exact: true })).toBeDisabled();
    await item.getByRole('textbox').fill('   ');
    await expect(item.getByRole('button', { name: 'Answer', exact: true })).toBeDisabled();
    await item.getByRole('textbox').fill('a year');
    await expect(item.getByRole('button', { name: 'Answer', exact: true })).toBeEnabled();
  });
});

test.describe('going on from the scenario', () => {
  test('makes the project from the scenario that was edited, not from the one that was read', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await reviewHarbour(page);

    const decision = 'Double the mooring fee from the first of June';
    await editText(page, 'The decision or event', decision, { multiline: true });
    await answerQuestion(page, 'Over what period', 'the first twelve months');
    await answerQuestion(page, 'Which groups', 'Visiting skippers');
    await page.getByRole('button', { name: 'Add a way' }).click();
    const way = page.getByRole('textbox', { name: 'Alternative 1 name', exact: true });
    await way.fill('A notice period');
    await way.press('Enter');
    await page.getByRole('button', { name: 'Add an assumption' }).click();
    const assumption = page.getByRole('textbox', { name: 'Assumption 2', exact: true });
    await assumption.fill('Skippers book a month ahead.');
    await assumption.press('Control+Enter');

    const created = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/projects' && request.method() === 'POST',
    );
    const project = await groundIt(page);
    const sent = (await created).postDataJSON() as {
      question: string;
      documents: { name: string; content: string }[];
      scenario: ScenarioFrame;
    };
    expect(sent.question).toBe(HARBOUR_QUESTION);
    expect(sent.documents.map((document) => document.name)).toEqual([HARBOUR_NOTES.name]);
    expect(sent.scenario.decision).toBe(decision);

    // What the server keeps is the scenario as it was edited, and it is the person's.
    const stored = (await scenarioOf(page, project)).scenario;
    expect(stored?.decision).toBe(decision);
    expect(stored?.origin).toBe('user');
    expect(stored?.horizon).toBe('the first twelve months');
    expect(stored?.likelyStakeholders).toEqual(['harbour office', 'Visiting skippers']);
    expect(stored?.alternatives.map((alternative) => alternative.label)).toEqual([
      'A notice period',
    ]);
    expect(stored?.assumptions.map((item) => [item.text, item.origin])).toEqual([
      [
        'The change happens as the question describes it, and nothing else changes at the same time.',
        'system',
      ],
      ['Skippers book a month ahead.', 'user'],
    ]);
    expect(stored?.ambiguities.map((item) => item.field)).toEqual(['success']);
    expect(problems).toEqual([]);
  });

  test('the scenario as it was read is stored as read when nothing was changed', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const project = await groundIt(page);
    const stored = (await scenarioOf(page, project)).scenario;
    expect(stored?.decision).toBe(READ_DECISION);
    expect(stored?.origin).toBe('rules');
    expect(stored?.ambiguities).toHaveLength(3);
  });

  test('going back and on again shows the scenario that was edited, and does not read the question again', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await reviewHarbour(page);
    const decision = 'Double the mooring fee from the first of June';
    await editText(page, 'The decision or event', decision, { multiline: true });

    await page.getByRole('button', { name: 'Question', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await exploreButton(page).click();
    await expect(reviewHeading(page)).toBeVisible();
    expect(await textOf(page, 'The decision or event')).toBe(decision);
    await expect(page.getByText('Edited by you', { exact: true })).toBeVisible();
    expect(writes(made)).toEqual(['POST /api/scenario/parse']);
  });

  test('the sources of the scenario are those that were attached, and can be changed there', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[1]!);
    await readScenario(page);
    const evidence = part(page, 'Evidence');
    await expect(evidence.getByRole('listitem')).toHaveCount(EXAMPLES[1]!.documents.length);

    // Taking one away there takes it from what the project is made from.
    const gone = EXAMPLES[1]!.documents[0]!.name;
    await evidence.getByRole('button', { name: `Remove ${gone}` }).click();
    await expect(evidence.getByRole('listitem')).toHaveCount(EXAMPLES[1]!.documents.length - 1);
    const project = await groundIt(page);
    const kept = (await (await page.request.get(`/api/projects/${project}`)).json()) as {
      documents: { name: string }[];
    };
    expect(kept.documents.map((document) => document.name)).toEqual(
      EXAMPLES[1]!.documents.slice(1).map((document) => document.name),
    );
  });

  test('a project with every source taken away is not made, and the bar says why; a source brings it back', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const before = await projectCount(page);
    await part(page, 'Evidence')
      .getByRole('button', { name: `Remove ${HARBOUR_NOTES.name}` })
      .click();
    await goOn(page).click();
    await expect(BAR(page)).toContainText('Attach at least one source document');
    await expect(page).not.toHaveURL(/[?&]project=/u);
    expect(await projectCount(page)).toBe(before);
    // The way back is there: a source is attached and the same button goes on.
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await groundIt(page);
  });

  test('the bar stops saying a source is needed once one is attached', async ({ page }) => {
    await reviewHarbour(page);
    await part(page, 'Evidence')
      .getByRole('button', { name: `Remove ${HARBOUR_NOTES.name}` })
      .click();
    await goOn(page).click();
    await expect(BAR(page)).toContainText('Attach at least one source document');
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await expect(BAR(page)).not.toContainText('Attach at least one source document');
  });
});

test.describe('while the question is being read', () => {
  test('a reading that takes long is shown, with a way to stop it, and stopping leaves the question as it was', async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/scenario/parse', async (route) => {
      await gate;
      // The page has stopped waiting by then: the answer has nowhere to go.
      await route.continue().catch(() => undefined);
    });
    const made = recordRequests(page);
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await exploreButton(page).click();

    // The screen says what is going on, shows the question, and names the parts of a scenario it will be made of.
    const reading = readingView(page);
    await expect(reading).toBeVisible();
    await expect(reading).toContainText(HARBOUR_QUESTION);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await reading.getByRole('button', { name: 'Stop' }).click();

    // Stopped: the question and the source are as they were, nothing is shown as an error, and nothing was made.
    await expect(questionBox(page)).toHaveValue(HARBOUR_QUESTION);
    await expect(reading).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    release();
    await expect(exploreButton(page)).toBeEnabled();
    await expect(reviewHeading(page)).toHaveCount(0);
    expect(writes(made)).toEqual(['POST /api/scenario/parse']);
  });

  test('a reading that fails says why, keeps what was written, and offers to try again', async ({
    page,
  }) => {
    await page.route('**/api/scenario/parse', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The reader is busy.' } }),
      }),
    );
    const problems = watchPage(page, { refusals: true });
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await exploreButton(page).click();

    const failure = page.getByRole('alert').filter({ hasText: 'The question could not be read' });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('The reader is busy.');
    await expect(questionBox(page)).toHaveValue(HARBOUR_QUESTION);
    await expect(page.getByRole('button', { name: /^Read harbour-notes\.md/u })).toBeVisible();

    await page.unroute('**/api/scenario/parse');
    await failure.getByRole('button', { name: 'Try again' }).click();
    await expect(reviewHeading(page)).toBeVisible();
    expect(await textOf(page, 'The decision or event')).toBe(READ_DECISION);
    expect(problems.filter((problem) => !/status of 503/u.test(problem))).toEqual([]);
  });

  test('the reading is optional: going on without it makes a project that has no scenario, and the exploration goes on', async ({
    page,
  }) => {
    await page.route('**/api/scenario/parse', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The reader is busy.' } }),
      }),
    );
    const problems = watchPage(page, { refusals: true });
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await exploreButton(page).click();
    await page.getByRole('button', { name: 'Continue without reading' }).click();

    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    const project = projectOf(page);
    expect((await scenarioOf(page, project)).scenario).toBeNull();
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();
    expect(problems.filter((problem) => !/status of 503/u.test(problem))).toEqual([]);
  });
});

test.describe('the bar at the foot of the scenario', () => {
  for (const size of [
    { name: 'a laptop', width: 1440, height: 900 },
    { name: 'a phone', width: 390, height: 844 },
  ]) {
    test(`keeps the way forward in reach on ${size.name}, wherever the scenario is read`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openAsk(page);
      await chooseExample(page, EXAMPLES[0]!);
      await readScenario(page);
      await expect(goOn(page)).toBeInViewport({ ratio: 1 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(goOn(page)).toBeInViewport({ ratio: 1 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
      await expect(goOn(page)).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Question', exact: true })).toBeInViewport({
        ratio: 1,
      });
    });

    test(`never leaves the control that has focus under a bar on ${size.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openAsk(page);
      await chooseExample(page, EXAMPLES[0]!);
      await readScenario(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      // Every stop of the keyboard, from the first control of the scenario to the way forward.
      await editable(page, 'The decision or event').focus();
      for (let stops = 0; stops < 60; stops += 1) {
        expect(await coveredByBars(page), `stop ${stops}: ${await focusedElement(page)}`).toEqual(
          [],
        );
        if (await goOn(page).evaluate((button) => button === document.activeElement)) break;
        await page.keyboard.press('Tab');
      }
      await expect(goOn(page)).toBeFocused();
    });
  }
});

test.describe('where focus goes', () => {
  test('after the question is read, the keyboard is at the scenario and not left on the page', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await questionBox(page).press('Control+Enter');
    await expect(reviewHeading(page)).toBeVisible();
    await expect(focusIsIn(page), `focus is on ${await focusedElement(page)}`).toHaveCount(1);
  });

  test('after a change is taken away, the keyboard stays in the scenario', async ({ page }) => {
    await reviewHarbour(page);
    await part(page, 'What changes').getByRole('button', { name: 'Remove change 1' }).click();
    await expect(
      part(page, 'What changes').getByRole('button', { name: /^Change 1 name/u }),
    ).toHaveCount(0);
    await expect(focusIsIn(page), `focus is on ${await focusedElement(page)}`).toHaveCount(1);
  });

  test('after a way is taken away, the keyboard stays in the scenario', async ({ page }) => {
    await reviewHarbour(page);
    await page.getByRole('button', { name: 'Add a way' }).click();
    await page.getByRole('textbox', { name: 'Alternative 1 name', exact: true }).fill('A way');
    await page.getByRole('textbox', { name: 'Alternative 1 name', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Remove alternative 1' }).click();
    await expect(page.getByRole('button', { name: /^Alternative 1 name/u })).toHaveCount(0);
    await expect(focusIsIn(page), `focus is on ${await focusedElement(page)}`).toHaveCount(1);
  });

  test('after a group is taken away, the keyboard stays in the scenario', async ({ page }) => {
    await reviewHarbour(page);
    await part(page, 'Who is affected')
      .getByRole('button', { name: 'Remove harbour office' })
      .click();
    await expect(
      part(page, 'Who is affected').getByRole('button', { name: /^Group 1/u }),
    ).toHaveCount(0);
    await expect(focusIsIn(page), `focus is on ${await focusedElement(page)}`).toHaveCount(1);
  });

  test('after an assumption is taken away, the keyboard stays in the scenario', async ({
    page,
  }) => {
    await reviewHarbour(page);
    await part(page, 'Assumed').getByRole('button', { name: 'Remove assumption 1' }).click();
    await expect(part(page, 'Assumed').getByRole('button', { name: /^Assumption 1/u })).toHaveCount(
      0,
    );
    await expect(focusIsIn(page), `focus is on ${await focusedElement(page)}`).toHaveCount(1);
  });

  test('after a question is answered, the keyboard stays in the scenario', async ({ page }) => {
    await reviewHarbour(page);
    await answerQuestion(page, 'Over what period', 'a year');
    await expect(question(page, 'Over what period')).toHaveCount(0);
    await expect(focusIsIn(page), `focus is on ${await focusedElement(page)}`).toHaveCount(1);
  });
});

test.describe('the scenario on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('fits the screen, with nothing cut off and every line readable', async ({ page }) => {
    const problems = watchPage(page);
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await readScenario(page);
    await expectNoHorizontalOverflow(page);
    await expectNothingClipped(page, 'the scenario on a phone');
    await expectReadableText(page, 'the scenario on a phone');
    expect(problems).toEqual([]);
  });

  test('is made of 44px targets for a finger', async ({ page }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await readScenario(page);
    await expectTouchTargets(page, 'the scenario on a phone', 'main');
  });

  test('the screen that says the question is being read fits it, with a Stop that is a target for a finger', async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/scenario/parse', async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await openAsk(page);
    await chooseExample(page, EXAMPLES[1]!);
    await exploreButton(page).tap();
    await expect(readingView(page)).toBeVisible();
    await expect(readingView(page)).toContainText('Reading your question');
    await expectNoHorizontalOverflow(page);
    await expectNothingClipped(page, 'the question being read, on a phone');
    await expectReadableText(page, 'the question being read, on a phone');
    await expectTouchTargets(page, 'the question being read, on a phone', 'main');
    release();
    await expect(reviewHeading(page)).toBeVisible();
  });
});

for (const theme of ['light', 'dark', 'high-contrast'] as const) {
  test.describe(`the scenario in the ${theme} theme`, () => {
    async function read(page: Page) {
      await openAsk(page, { theme });
      await chooseExample(page, EXAMPLES[0]!);
      await readScenario(page);
    }

    test('is clean as it was read', async ({ page }) => {
      await read(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page, `${theme}: the scenario`);
    });

    test('is clean with a text open for editing and its method open', async ({ page }) => {
      await read(page);
      await openDisclosure(page, 'How it was read');
      await editable(page, 'The decision or event').click();
      await expect(
        page.getByRole('textbox', { name: 'The decision or event', exact: true }),
      ).toBeFocused();
      await expectNoAxeViolations(page, `${theme}: a text open, the method open`);
    });

    test('is clean with a way and an answered question added', async ({ page }) => {
      await read(page);
      await page.getByRole('button', { name: 'Add a way' }).click();
      const name = page.getByRole('textbox', { name: 'Alternative 1 name', exact: true });
      await name.fill('Staged opt-in rollout');
      await name.press('Enter');
      await answerQuestion(page, 'Over what period', 'the first year');
      await expectNoAxeViolations(page, `${theme}: the scenario with additions`);
    });

    test('is clean with the bar saying what is missing', async ({ page }) => {
      await read(page);
      await editText(page, 'The decision or event', '', { multiline: true });
      await expect(BAR(page)).toContainText('Say what decision or event you want to explore.');
      await expectNoAxeViolations(page, `${theme}: the bar with a problem`);
    });

    test('is clean with the evidence menu open on it', async ({ page }) => {
      await read(page);
      await page.getByRole('button', { name: 'Add evidence' }).click();
      await expect(page.getByRole('dialog', { name: 'Add evidence' })).toBeVisible();
      await expectNoAxeViolations(page, `${theme}: the evidence menu in the scenario`);
    });

    test('is clean while the question is being read', async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/api/scenario/parse', async (route) => {
        await gate;
        await route.continue().catch(() => undefined);
      });
      await openAsk(page, { theme });
      await chooseExample(page, EXAMPLES[0]!);
      await exploreButton(page).click();
      await expect(readingView(page)).toBeVisible();
      await expectNoAxeViolations(page, `${theme}: the question being read`);
      release();
      await expect(reviewHeading(page)).toBeVisible();
    });
  });
}

test.describe('the scenario at every size', () => {
  for (const size of viewports) {
    test(`fits ${size.name}, with nothing cut off and every line readable`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openAsk(page);
      await chooseExample(page, EXAMPLES[0]!);
      await readScenario(page);
      await expectNoHorizontalOverflow(page);
      await expectNothingClipped(page, `${size.name}: the scenario`);
      await expectReadableText(page, `${size.name}: the scenario`);
      await openDisclosure(page, 'How it was read');
      await expectReadableText(page, `${size.name}: the scenario, its method open`);
    });
  }
});
