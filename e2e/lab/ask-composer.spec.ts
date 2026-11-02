import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTouchTargets,
  viewports,
  watchPage,
} from '../support/helpers';
import { journey, projectOf, step } from '../support/app';
import { claimsAgainst, getJson, textsOf } from '../support/lab-api';
import {
  EXAMPLES,
  HARBOUR_NOTES,
  HARBOUR_QUESTION,
  HEADING,
  POSITIONING,
  READS_AT_OPEN,
  apiCalls,
  asked,
  assumptionsButton,
  bar,
  chipName,
  chooseExample,
  chooseStarter,
  closeEvidence,
  createProject,
  evidenceButton,
  evidenceDialog,
  examplesList,
  exploreButton,
  expectAttached,
  expectNothingClipped,
  focusedElement,
  goOn,
  groundIt,
  openAsk,
  openEvidence,
  optionsButton,
  part,
  pasteSource,
  question as questionAsked,
  questionBox,
  readScenario,
  recordRequests,
  reviewHarbour,
  reviewHeading,
  scenarioOf,
  textOf,
  timeFrameButton,
  tray,
} from '../support/ask';

// The first ten seconds: what a person sees before they have typed a word, what a keyboard reaches, what the
// first press asks of the server, and that it all holds on a phone. Rules mode: no model is called. Motion is
// reduced throughout, so that nothing is measured while it moves; the one test about motion says so.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

const writes = (made: Parameters<typeof apiCalls>[0]): string[] =>
  apiCalls(made).filter((call) => !call.startsWith('GET '));

test.describe('the first screen', () => {
  test('says in one heading what Swarm is for, asks one question, and offers the way forward', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openAsk(page);

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await expect(
      page.getByText('What change do you want to explore?', { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Swarm | Explore what could happen next');

    // The one question box, empty, with the three things that can be done beside it.
    await expect(questionBox(page)).toBeVisible();
    await expect(questionBox(page)).toBeEditable();
    await expect(questionBox(page)).toHaveValue('');
    await expect(questionBox(page)).toBeInViewport({ ratio: 1 });
    await expectAttached(page, 0);
    await expect(optionsButton(page)).toBeVisible();
    await expect(exploreButton(page)).toBeInViewport({ ratio: 1 });
    await expect(exploreButton(page)).toBeEnabled();

    // Nothing is attached, and no project is open: there is no journey to follow yet.
    await expect(tray(page)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&](?:project|scene)=/u);

    // The whole path is promised, in order, as a list that is not a control.
    const path = page.getByRole('list', { name: 'How Swarm works' });
    await expect(path.getByRole('listitem')).toHaveCount(6);
    await expect(path.getByRole('listitem').locator('strong')).toHaveText([
      'Ask',
      'Ground',
      'Map',
      'Simulate',
      'Compare',
      'Decide',
    ]);
    await expect(path.getByRole('button')).toHaveCount(0);

    expect(problems).toEqual([]);
  });

  test('offers every example, and the fictional starter, as a chip that is a button', async ({
    page,
  }) => {
    await openAsk(page);
    await expect(examplesList(page).getByRole('listitem')).toHaveCount(EXAMPLES.length + 1);
    await expect(examplesList(page).getByRole('button')).toHaveCount(EXAMPLES.length + 1);
    await expect(examplesList(page).getByRole('button').last()).toHaveText('Library hours');
    // Choosing one is a choice: until then the question is empty.
    await expect(questionBox(page)).toHaveValue('');
  });

  test('keeps the responsible-use sentence in sight, and nothing on the screen claims to predict', async ({
    page,
  }) => {
    await openAsk(page);
    const sentence = page.getByText(POSITIONING, { exact: true });
    await expect(sentence).toBeVisible();
    // On a laptop the sentence is part of the first screen, not something to scroll to.
    await expect(sentence).toBeInViewport({ ratio: 1 });

    const said = await textsOf(page.getByRole('main').locator('h1, h2, p, li, button'));
    expect(said.flatMap(claimsAgainst), 'what the first screen says').toEqual([]);
    const whole = (await page.getByRole('main').innerText()).toLowerCase();
    expect(whole).not.toMatch(/\bpredicts?\b(?! real)/u);
    expect(whole).not.toMatch(/\bforecasts?\b|probab/u);
  });

  test('reaches the question, then what can be done with it, in reading order from the keyboard', async ({
    page,
  }) => {
    await openAsk(page);
    // The skip link is the first stop, and it leads to the page's content.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();

    // The question is within the first ten stops, and nothing in the page is reached ahead of it.
    let stops = 1;
    while (!(await questionBox(page).evaluate((box) => box === document.activeElement))) {
      expect(stops, 'tab stops before the question').toBeLessThan(10);
      await page.keyboard.press('Tab');
      stops += 1;
    }

    await page.keyboard.press('Tab');
    await expect(evidenceButton(page)).toBeFocused();
    // What can be said about the question comes next: the time it is judged over, and what is taken as given.
    await page.keyboard.press('Tab');
    await expect(timeFrameButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(assumptionsButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(optionsButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(exploreButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(examplesList(page).getByRole('button').first()).toBeFocused();
  });

  test('asks nothing of the server until the person asks, and never a model without being told to', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const made = recordRequests(page);
    await openAsk(page);
    // Opening reads three things and writes nothing; the page reaches only its own server.
    expect(apiCalls(made).sort()).toEqual([...READS_AT_OPEN].sort());
    expect(new Set(made.map((request) => request.url.origin))).toEqual(
      new Set([new URL(page.url()).origin]),
    );

    // Choosing an example, opening every menu and writing an address: still nothing is sent.
    await chooseExample(page, EXAMPLES[0]!);
    await openEvidence(page, 'Paste');
    await evidenceDialog(page)
      .getByRole('textbox', { name: 'Source text, not your question' })
      .fill(HARBOUR_NOTES.content);
    await openEvidence(page, 'Web page');
    await evidenceDialog(page)
      .getByRole('textbox', { name: 'Web address' })
      .fill('http://city-transport.example.org/central-zone-pilot');
    await expect(
      evidenceDialog(page).getByRole('button', { name: 'Fetch', exact: true }),
    ).toBeEnabled();
    await closeEvidence(page);
    await optionsButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Options' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(writes(made)).toEqual([]);

    // Where a model is not set up the choice of one is not on offer at all.
    await optionsButton(page).click();
    const options = page.getByRole('dialog', { name: 'Options' });
    const engine = options.getByRole('radiogroup', { name: 'Engine' });
    await expect(engine.getByRole('radio', { name: 'Local rules' })).toBeChecked();
    await expect(engine.getByRole('radio', { name: 'Model assisted' })).toBeDisabled();
    await expect(options).toContainText('Model assistance is off');
    await page.keyboard.press('Escape');

    // The first press is the first call, once, and it is the rules that read the question.
    const parsed = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/scenario/parse',
    );
    await exploreButton(page).click();
    const body = (await parsed).postDataJSON() as {
      question: string;
      useModel: boolean;
      documents: { name: string; characters: number; excerpt: string }[];
    };
    await expect(reviewHeading(page)).toBeVisible();
    expect(body.useModel).toBe(false);
    expect(body.question).toBe(EXAMPLES[0]!.question);
    expect(body.documents.map((document) => document.name)).toEqual(
      EXAMPLES[0]!.documents.map((document) => document.name),
    );
    expect(writes(made)).toEqual(['POST /api/scenario/parse']);
    expect(problems).toEqual([]);
  });
});

test.describe('asking', () => {
  test('a question that is too short is not read: the box says so, keeps what was typed, and asks nothing', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await questionBox(page).fill('Why?');
    await exploreButton(page).click();

    await expect(asked(page)).toContainText('Say a little more: a sentence is enough.');
    await expect(questionBox(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(questionBox(page)).toBeFocused();
    await expect(questionBox(page)).toHaveValue('Why?');
    // The box is named in the sentence that explains it, for a screen reader that lands on it.
    await expect(questionBox(page)).toHaveAccessibleDescription(/Say a little more/u);
    await expect(reviewHeading(page)).toHaveCount(0);
    expect(writes(made)).toEqual([]);

    // Writing on takes the complaint away: nothing is left saying the old thing.
    await questionBox(page).fill(HARBOUR_QUESTION);
    await expect(questionBox(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(asked(page).filter({ hasText: 'Say a little more' })).toHaveCount(0);
  });

  test('nine characters are too few for a question and ten are enough', async ({ page }) => {
    await openAsk(page);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await questionBox(page).fill('Why so fa');
    await exploreButton(page).click();
    await expect(asked(page)).toContainText('Say a little more');
    await expect(reviewHeading(page)).toHaveCount(0);

    await questionBox(page).fill('Why so far');
    await exploreButton(page).click();
    await expect(reviewHeading(page)).toBeVisible();
  });

  test('a pasted question longer than the limit is cut at 2,000 characters, not refused', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).focus();
    await page.keyboard.insertText('What could happen if the fee changes? '.repeat(70));
    const value = await questionBox(page).inputValue();
    expect(value.length).toBe(2000);
    await expect(asked(page).filter({ hasText: 'Say a little more' })).toHaveCount(0);
  });

  test('a question without a source asks for one, and opens the evidence menu where it is added', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await exploreButton(page).click();

    await expect(asked(page)).toContainText(
      'Add a source to ground it: a file, pasted notes or a public page.',
    );
    await expect(evidenceDialog(page)).toBeVisible();
    expect(writes(made)).toEqual([]);

    // Once a source is attached the same press reads the question.
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await readScenario(page);
    expect(writes(made)).toEqual(['POST /api/scenario/parse']);
  });

  test('the request for a source is gone once a source is attached, not left saying the opposite', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await exploreButton(page).click();
    await expect(asked(page)).toContainText('Add a source to ground it');

    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await expectAttached(page, 1);
    await expect(asked(page).filter({ hasText: 'Add a source' })).toHaveCount(0);
  });

  test('Ctrl+Enter in the question box explores it, and Enter alone only adds a line', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await chooseExample(page, EXAMPLES[1]!);
    await expect(questionBox(page)).toBeFocused();

    await questionBox(page).press('End');
    await questionBox(page).press('Enter');
    await expect(reviewHeading(page)).toHaveCount(0);
    expect(writes(made)).toEqual([]);
    await expect(questionBox(page)).toHaveValue(`${EXAMPLES[1]!.question}\n`);

    await questionBox(page).press('Control+Enter');
    await expect(reviewHeading(page)).toBeVisible();
    // The question that was read is the one that was written, without the line that was added.
    await expect(page.getByRole('main').locator('blockquote')).toHaveText(EXAMPLES[1]!.question);
    expect(writes(made)).toEqual(['POST /api/scenario/parse']);
  });

  test('keeps the question and every source while the person goes to the scenario and back', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await readScenario(page);

    await page.getByRole('button', { name: 'Question', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await expect(questionBox(page)).toHaveValue(HARBOUR_QUESTION);
    await expect(tray(page).getByRole('listitem')).toHaveCount(1);
    await expectAttached(page, 1);
  });

  test('going back from the scenario puts the keyboard in the question box', async ({ page }) => {
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await readScenario(page);

    await page.getByRole('button', { name: 'Question', exact: true }).click();
    await expect(questionBox(page)).toBeVisible();
    await expect(questionBox(page), `focus is on ${await focusedElement(page)}`).toBeFocused();
  });

  test('a question that is read again after it changed gives a new scenario, and the old one is not used', async ({
    page,
  }) => {
    const made = recordRequests(page);
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await readScenario(page);
    await expect(page.getByRole('main').locator('blockquote')).toHaveText(HARBOUR_QUESTION);

    // The same question, read again, is not read twice; a changed one is.
    await page.getByRole('button', { name: 'Question', exact: true }).click();
    await exploreButton(page).click();
    await expect(reviewHeading(page)).toBeVisible();
    expect(writes(made)).toEqual(['POST /api/scenario/parse']);

    const other =
      'What could happen if the harbour office halves the mooring fee for sailing clubs?';
    await page.getByRole('button', { name: 'Question', exact: true }).click();
    await questionBox(page).fill(other);
    await exploreButton(page).click();
    await expect(reviewHeading(page)).toBeVisible();
    await expect(page.getByRole('main').locator('blockquote')).toHaveText(other);
    expect(writes(made)).toEqual(['POST /api/scenario/parse', 'POST /api/scenario/parse']);
  });
});

test.describe('options', () => {
  test('name the project and size its deep dive, and the project is made with them', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);

    await optionsButton(page).click();
    const options = page.getByRole('dialog', { name: 'Options' });
    await expect(options.getByRole('radio', { name: 'Local rules' })).toBeChecked();
    // The deep dive is for the person who wants it: its numbers are one press away, and out of the way until then.
    const deep = options.getByRole('button', { name: 'Deep dive' });
    await expect(deep).toHaveAttribute('aria-expanded', 'false');
    await deep.click();
    await expect(deep).toHaveAttribute('aria-expanded', 'true');
    await expect(options.getByRole('spinbutton', { name: 'Proxies' })).toHaveValue('12');
    await expect(options.getByRole('spinbutton', { name: 'Rounds' })).toHaveValue('8');
    await expect(options.getByRole('spinbutton', { name: 'Seed' })).toHaveValue('42');
    await options.getByRole('textbox', { name: 'Name' }).fill('Mooring fee, summer');
    await options.getByRole('spinbutton', { name: 'Proxies' }).fill('8');
    await options.getByRole('spinbutton', { name: 'Rounds' }).fill('5');
    await options.getByRole('spinbutton', { name: 'Seed' }).fill('7');
    await page.keyboard.press('Escape');
    await expect(options).toBeHidden();
    // Closing the menu returns to the button that opened it.
    await expect(optionsButton(page)).toBeFocused();

    await readScenario(page);
    const project = await groundIt(page);
    const made = await getJson<{
      name: string;
      settings: { mode: string; agentCount: number; rounds: number; seed: number };
    }>(page, `/api/projects/${project}`);
    expect(made.name).toBe('Mooring fee, summer');
    expect(made.settings).toMatchObject({ mode: 'local', agentCount: 8, rounds: 5, seed: 7 });
    expect(problems).toEqual([]);
  });

  test('a project that is given no name is named from the start of the question', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    await readScenario(page);
    const project = await groundIt(page);
    const made = await getJson<{ name: string; question: string }>(
      page,
      `/api/projects/${project}`,
    );
    expect(made.question).toBe(HARBOUR_QUESTION);
    // Cut at a word when the question is long, with a mark that it was cut.
    expect(made.name.length).toBeLessThanOrEqual(81);
    expect(HARBOUR_QUESTION.startsWith(made.name.replace(/…$/u, ''))).toBe(true);
    expect(made.name.length).toBeGreaterThan(40);
  });
});

test.describe('beside the question', () => {
  test('a time frame and what is assumed are said before the question is read, and are the person’s own in the scenario', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);

    await timeFrameButton(page).click();
    const frame = page.getByRole('dialog', { name: 'Time frame' });
    await frame.getByRole('button', { name: '3 years', exact: true }).click();
    await expect(frame.getByRole('button', { name: '3 years', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(frame.getByRole('textbox', { name: 'Or in your own words' })).toHaveValue(
      '3 years',
    );
    await frame.getByRole('button', { name: 'Done' }).click();
    await expect(frame).toBeHidden();
    await expect(timeFrameButton(page)).toHaveAccessibleName('Time frame 3 years');
    await expect(
      timeFrameButton(page),
      'focus returns to the button that was pressed',
    ).toBeFocused();

    await assumptionsButton(page).click();
    const assumed = page.getByRole('dialog', { name: 'Assumptions' });
    const field = assumed.getByRole('textbox', { name: 'Your assumption' });
    await field.fill('Visiting boats keep coming at the same rate.');
    await field.press('Enter');
    await expect(
      assumed.getByRole('list', { name: 'Your assumptions' }).getByRole('listitem'),
    ).toHaveCount(1);
    await expect(field, 'the field is ready for the next one').toHaveValue('');
    await assumed.getByRole('button', { name: 'Done' }).click();
    await expect(assumptionsButton(page)).toHaveAccessibleName('Assumptions 1');

    // What is read is the question and the notes. What the person assumes is not sent to be read by anyone.
    const [exchange] = await Promise.all([
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/scenario/parse',
      ),
      exploreButton(page).click(),
    ]);
    const sent = exchange.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['documents', 'question', 'useModel']);
    expect(exchange.request().postData()).not.toContain('Visiting boats keep coming');

    await expect(reviewHeading(page)).toBeVisible();
    await expect(goOn(page)).toBeVisible();
    expect(await textOf(page, 'Over what time')).toBe('3 years');
    await expect(
      questionAsked(page, 'Over what period'),
      'the question about the period has been answered',
    ).toHaveCount(0);
    const listed = part(page, 'Assumed');
    await expect(listed).toContainText('Visiting boats keep coming at the same rate.');
    await expect(listed.getByRole('img', { name: 'Yours' })).toHaveCount(1);

    const project = await groundIt(page);
    const kept = (await scenarioOf(page, project)).scenario;
    expect(kept?.horizon).toBe('3 years');
    expect(
      kept?.assumptions
        .filter((assumption) => assumption.origin === 'user')
        .map((assumption) => assumption.text),
    ).toEqual(['Visiting boats keep coming at the same rate.']);
    expect(problems).toEqual([]);
  });

  test('what was said is part of what a reading is made from: unchanged it is kept, changed it is read again', async ({
    page,
  }) => {
    await openAsk(page);
    const made = recordRequests(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    const reads = () => apiCalls(made).filter((call) => call === 'POST /api/scenario/parse');

    await readScenario(page);
    expect(reads()).toHaveLength(1);
    await bar(page).getByRole('button', { name: 'Question' }).click();
    await exploreButton(page).click();
    await expect(reviewHeading(page)).toBeVisible();
    expect(reads(), 'nothing changed, so nothing is asked again').toHaveLength(1);

    await bar(page).getByRole('button', { name: 'Question' }).click();
    await timeFrameButton(page).click();
    await page
      .getByRole('dialog', { name: 'Time frame' })
      .getByRole('textbox', { name: 'Or in your own words' })
      .fill('the next two quarters');
    await page.keyboard.press('Escape');
    await exploreButton(page).click();
    await expect(reviewHeading(page)).toBeVisible();
    await expect(goOn(page)).toBeVisible();
    expect(reads(), 'a time frame was added, so the question is read again').toHaveLength(2);
    expect(await textOf(page, 'Over what time')).toBe('the next two quarters');
  });
});

test.describe('starting over', () => {
  test('the mark leads to a new, empty question, and the project that was left is listed to come back to', async ({
    page,
  }) => {
    const project = await createProject(page, { name: 'Mooring fee, left behind' });
    await page.goto(`/?project=${project}&scene=ground`);
    await expect(journey(page)).toBeVisible();

    await page.getByRole('button', { name: 'Swarm: start a new question' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await expect(questionBox(page)).toHaveValue('');
    await expect(page).not.toHaveURL(/[?&]project=/u);
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);

    const recent = page.getByRole('region', { name: 'Continue' });
    await expect(recent.getByRole('button', { name: /^Mooring fee, left behind/u })).toBeVisible();
  });

  test('the first step of the journey does the same', async ({ page }) => {
    const project = await createProject(page);
    await page.goto(`/?project=${project}&scene=ground`);
    await step(page, 'ask').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await expect(questionBox(page)).toHaveValue('');
    await expect(page).not.toHaveURL(/[?&]project=/u);
  });

  test('a link that names a scene but no project opens the first screen, not a scene with nothing in it', async ({
    page,
  }) => {
    for (const address of ['/?scene=decide', '/?scene=map&view=list', '/?scene=nonsense']) {
      await page.goto(address);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
      await expect(questionBox(page)).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);
    }
  });

  test('the browser’s Back and Forward buttons move between the first screen and the exploration that was made', async ({
    page,
  }) => {
    await reviewHarbour(page);
    const project = await groundIt(page);

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await expect(page).not.toHaveURL(/[?&]project=/u);
    await expect(questionBox(page)).toHaveValue('');
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`[?&]project=${project}`, 'u'));
    await expect(journey(page)).toBeVisible();
    await expect(step(page, 'ground')).toHaveAttribute('aria-current', 'step');
  });

  test('opens a recent exploration, and "All explorations" opens the history', async ({ page }) => {
    const id = await createProject(page, { name: 'Mooring fee, to come back to' });
    await page.goto('/');
    const recent = page.getByRole('region', { name: 'Continue' });
    const item = recent.getByRole('button', { name: /^Mooring fee, to come back to/u });
    await expect(item).toBeVisible();
    // What is said of it: its question, and where it stands.
    await expect(item).toContainText(HARBOUR_QUESTION);
    await expect(item).toContainText(/draft|ready|running|queued|completed/u);
    await item.click();
    await expect(page).toHaveURL(new RegExp(`[?&]project=${id}`, 'u'));
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    expect(projectOf(page)).toBe(id);

    await page.getByRole('button', { name: 'Swarm: start a new question' }).click();
    await recent.getByRole('button', { name: 'All explorations' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('"Duplicate as a new question" brings back the question, the evidence and the settings, and nothing that was run', async ({
    page,
  }) => {
    const project = await createProject(page);
    await page.goto(`/?project=${project}&scene=ground`);
    await page.getByRole('button', { name: 'Settings and tools' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate as a new question' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await expect(questionBox(page)).toHaveValue(HARBOUR_QUESTION);
    await expect(tray(page).getByRole('listitem')).toHaveCount(1);
    await expect(
      tray(page).getByRole('button', { name: /^Read harbour-notes\.md/u }),
    ).toBeVisible();
    await expect(
      page.getByText('Only the question, evidence and settings were copied. Nothing that was run.'),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]project=/u);
  });

  test('an exploration list that cannot be read says so and recovers on Retry, without a reload', async ({
    page,
  }) => {
    await createProject(page, { name: 'Mooring fee, kept' });
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'GET' ? route.abort() : route.continue(),
    );
    await page.goto('/');
    const failure = page
      .getByRole('alert')
      .filter({ hasText: 'Your explorations could not be read' });
    await expect(failure).toBeVisible();
    // The question can still be asked while the list is down.
    await expect(questionBox(page)).toBeEditable();
    await page.unroute('**/api/projects');
    await failure.getByRole('button', { name: 'Retry' }).click();
    await expect(failure).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'Continue' })
        .getByRole('button', { name: /^Mooring fee, kept/u }),
    ).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the question, its evidence and Explore are on the first screen, and the page does not scroll sideways', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openAsk(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
    await expect(questionBox(page)).toBeInViewport({ ratio: 1 });
    await expect(evidenceButton(page)).toBeInViewport({ ratio: 1 });
    await expect(optionsButton(page)).toBeInViewport({ ratio: 1 });
    await expect(exploreButton(page)).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
    await expectNothingClipped(page, 'the first screen on a phone');
    await expectReadableText(page, 'the first screen on a phone');
    expect(problems).toEqual([]);
  });

  test('every control of the first screen is a 44px target for a finger', async ({ page }) => {
    await openAsk(page);
    await expectTouchTargets(page, 'the first screen on a phone', 'main');
  });

  test('a question that is refused is explained where the person is looking', async ({ page }) => {
    await openAsk(page);
    await questionBox(page).fill('Why?');
    await exploreButton(page).tap();
    await expect(asked(page)).toContainText('Say a little more');
    await expect(asked(page)).toBeInViewport({ ratio: 1 });
    await expect(exploreButton(page)).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
    await expectNothingClipped(page, 'a refused question on a phone');
  });

  test('the note that says what an example brought is a 44px target too', async ({ page }) => {
    await openAsk(page);
    await chooseExample(page, EXAMPLES[0]!);
    await expectTouchTargets(page, 'an example loaded on a phone', 'main');
  });

  test('the bar above the first screen is made of 44px targets too', async ({ page }) => {
    await openAsk(page);
    await expectTouchTargets(page, 'the bar on a phone', 'header');
  });

  test('an example is chosen by touch, fills the composer, and leaves Explore within reach', async ({
    page,
  }) => {
    await openAsk(page);
    await examplesList(page).getByRole('button', { name: 'Copilot in Teams' }).tap();
    await expect(tray(page).getByRole('listitem')).toHaveCount(EXAMPLES[0]!.documents.length);
    await expect(questionBox(page)).toHaveValue(EXAMPLES[0]!.question);
    await expectNoHorizontalOverflow(page);
    await expectNothingClipped(page, 'an example loaded on a phone');
    await exploreButton(page).scrollIntoViewIfNeeded();
    await expect(exploreButton(page)).toBeInViewport({ ratio: 1 });
    await exploreButton(page).tap();
    await expect(reviewHeading(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNothingClipped(page, 'the scenario on a phone');
    await expectReadableText(page, 'the scenario on a phone');
  });

  // A long name in the note under the composer must not make the composer wider than the screen.
  for (const example of EXAMPLES) {
    test(`the composer with "${chipName(example)}" loaded fits the screen: nothing is cut off`, async ({
      page,
    }) => {
      await openAsk(page);
      await chooseExample(page, example);
      await expectNoHorizontalOverflow(page);
      await expectNothingClipped(page, `${chipName(example)} loaded on a phone`);
    });
  }

  test('the composer with the fictional starter loaded fits the screen: nothing is cut off', async ({
    page,
  }) => {
    await openAsk(page);
    await chooseStarter(page);
    await expectNothingClipped(page, 'the starter loaded on a phone');
  });

  test('the evidence menu fits the screen and can be closed again', async ({ page }) => {
    await openAsk(page);
    await evidenceButton(page).tap();
    const dialog = evidenceDialog(page);
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x, 'the menu starts on the screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'the menu ends on the screen').toBeLessThanOrEqual(390 + 1);
    await expectNoHorizontalOverflow(page);
    await closeEvidence(page);
  });

  test('the evidence menu is made of 44px targets', async ({ page }) => {
    await openAsk(page);
    const dialog = await openEvidence(page, 'Files');
    await expectTouchTargets(page, 'the evidence menu, files', '[role=dialog]');
    await openEvidence(page, 'Paste');
    await expectTouchTargets(page, 'the evidence menu, paste', '[role=dialog]');
    await openEvidence(page, 'Web page');
    await expectTouchTargets(page, 'the evidence menu, web page', '[role=dialog]');
    await expect(dialog).toBeVisible();
  });

  test('the time frame and the assumptions open from the foot of the screen, and are made of 44px targets', async ({
    page,
  }) => {
    await openAsk(page);
    await expectTouchTargets(page, 'the first screen on a phone', 'main');
    for (const [button, name] of [
      [timeFrameButton(page), 'Time frame'],
      [assumptionsButton(page), 'Assumptions'],
    ] as const) {
      await button.tap();
      const dialog = page.getByRole('dialog', { name });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x, `${name}: starts on the screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name}: ends on the screen`).toBeLessThanOrEqual(390 + 1);
      expect(box.y + box.height, `${name}: rests on the foot of the screen`).toBeGreaterThanOrEqual(
        844 - 2,
      );
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page, `${name} on a phone`, '[role=dialog]');
      await dialog.getByRole('button', { name: 'Done' }).tap();
      await expect(dialog).toBeHidden();
      await expect(button).toBeFocused();
    }
  });

  test('the options fit the screen and are made of 44px targets', async ({ page }) => {
    await openAsk(page);
    await optionsButton(page).tap();
    const dialog = page.getByRole('dialog', { name: 'Options' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page, 'the options on a phone', '[role=dialog]');
  });
});

// The keyboard of a phone leaves about half of the screen. Nothing in the first screen is fixed to the bottom,
// so the screen scrolls; what must hold is that a control that takes focus is never left under the bar.
test.describe('with the keyboard of a phone open', () => {
  test.use({ viewport: { width: 390, height: 420 }, hasTouch: true });

  test('the question and Explore are reached by scrolling, and focus never lands under the bar', async ({
    page,
  }) => {
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);

    const trouble = (): Promise<string[]> =>
      page.evaluate(() => {
        const bar = document.querySelector('header')!.getBoundingClientRect();
        const element = document.activeElement as HTMLElement;
        const box = element.getBoundingClientRect();
        const found: string[] = [];
        if (box.top < bar.bottom - 1 && box.bottom > 0) {
          found.push(
            `starts at ${Math.round(box.top)}px, under the bar that ends at ${Math.round(bar.bottom)}px`,
          );
        }
        if (box.bottom > innerHeight + 1)
          found.push(`ends at ${Math.round(box.bottom)}px, below the ${innerHeight}px screen`);
        return found;
      });

    // Forwards to Explore, then backwards to the question: each direction scrolls the page to the control. The
    // stops between them are the source and what can be said about the question: a handful.
    await questionBox(page).focus();
    for (let stops = 0; stops < 10; stops += 1) {
      await page.keyboard.press('Tab');
      expect(await trouble(), `Tab to ${await focusedElement(page)}`).toEqual([]);
      if (await exploreButton(page).evaluate((button) => button === document.activeElement)) break;
    }
    await expect(exploreButton(page)).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    for (let stops = 0; stops < 10; stops += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await trouble(), `Shift+Tab to ${await focusedElement(page)}`).toEqual([]);
      if (await questionBox(page).evaluate((box) => box === document.activeElement)) break;
    }
    await expect(questionBox(page)).toBeFocused();

    await exploreButton(page).scrollIntoViewIfNeeded();
    await exploreButton(page).tap();
    await expect(reviewHeading(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  const shown = async (page: import('@playwright/test').Page): Promise<string[]> => {
    const found: string[] = [];
    for (const example of EXAMPLES) {
      // The lines are also set out of sight, to know which are shown whole: only what a person can see is counted.
      const seen = page.getByText(example.question, { exact: true }).filter({ visible: true });
      if ((await seen.count()) > 0) found.push(example.question);
    }
    return found;
  };

  test('the example question in the empty box rotates, and holds still for a person who asks for less motion', async ({
    page,
  }) => {
    await page.clock.install();
    await openAsk(page);
    await expect.poll(() => shown(page)).toHaveLength(1);
    const first = (await shown(page))[0];

    await page.clock.runFor(5_400);
    await expect.poll(async () => (await shown(page))[0]).not.toBe(first);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.clock.install();
    await expect(questionBox(page)).toBeVisible();
    await expect.poll(() => shown(page)).toHaveLength(1);
    const still = (await shown(page))[0];
    await page.clock.runFor(16_000);
    expect(await shown(page)).toEqual([still]);
  });
});

for (const theme of ['light', 'dark', 'high-contrast'] as const) {
  test.describe(`the first screen in the ${theme} theme`, () => {
    test('is clean with nothing written', async ({ page }) => {
      await openAsk(page, { theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page, `${theme}: the first screen`);
    });

    test('is clean with an example loaded', async ({ page }) => {
      await openAsk(page, { theme });
      await chooseExample(page, EXAMPLES[0]!);
      await expectNoAxeViolations(page, `${theme}: an example loaded`);
    });

    test('is clean with each way of adding evidence open', async ({ page }) => {
      await openAsk(page, { theme });
      for (const way of ['Files', 'Paste', 'Web page'] as const) {
        await openEvidence(page, way);
        await expectNoAxeViolations(page, `${theme}: the evidence menu, ${way}`);
      }
    });

    test('is clean with the options open', async ({ page }) => {
      await openAsk(page, { theme });
      await optionsButton(page).click();
      await expect(page.getByRole('dialog', { name: 'Options' })).toBeVisible();
      await expectNoAxeViolations(page, `${theme}: the options`);
    });

    test('is clean with a time frame and an assumption said, and each of them open', async ({
      page,
    }) => {
      await openAsk(page, { theme });
      await timeFrameButton(page).click();
      const frame = page.getByRole('dialog', { name: 'Time frame' });
      await frame.getByRole('button', { name: '1 year', exact: true }).click();
      await expectNoAxeViolations(page, `${theme}: the time frame open`);
      await frame.getByRole('button', { name: 'Done' }).click();
      await assumptionsButton(page).click();
      const assumed = page.getByRole('dialog', { name: 'Assumptions' });
      const field = assumed.getByRole('textbox', { name: 'Your assumption' });
      await field.fill('Demand stays flat.');
      await field.press('Enter');
      await expectNoAxeViolations(page, `${theme}: the assumptions open`);
      await assumed.getByRole('button', { name: 'Done' }).click();
      await expect(assumed).toBeHidden();
      await expect(timeFrameButton(page)).toHaveAccessibleName('Time frame 1 year');
      await expectNoAxeViolations(page, `${theme}: both said`);
    });

    test('is clean with a question that was refused', async ({ page }) => {
      await openAsk(page, { theme });
      await questionBox(page).fill('Why?');
      await exploreButton(page).click();
      await expect(asked(page)).toContainText('Say a little more');
      await expectNoAxeViolations(page, `${theme}: the question refused`);
    });
  });
}

test.describe('the first screen at every size', () => {
  // 320 is the width a page must still be usable at when it is zoomed to 400%.
  for (const size of [...viewports, { name: '320x568', width: 320, height: 568 }]) {
    test(`fits ${size.name} with nothing written, with an example loaded and with a menu open`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openAsk(page);
      await expectNoHorizontalOverflow(page);
      await expectNothingClipped(page, `${size.name}: the first screen`);
      await expectReadableText(page, `${size.name}: the first screen`);
      await expect(questionBox(page)).toBeVisible();
      await expect(exploreButton(page)).toBeVisible();

      await chooseExample(page, EXAMPLES[0]!);
      await expectNoHorizontalOverflow(page);
      await expectNothingClipped(page, `${size.name}: an example loaded`);
      await expectReadableText(page, `${size.name}: an example loaded`);

      await openEvidence(page, 'Web page');
      const box = (await evidenceDialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      await expectNoHorizontalOverflow(page);
      await expectNothingClipped(page, `${size.name}: the evidence menu`, '[role=dialog]');
      await expectReadableText(page, `${size.name}: the evidence menu`);
    });
  }
});
