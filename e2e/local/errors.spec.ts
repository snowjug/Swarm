import { expect, test, type Page } from '@playwright/test';
import { makePdf } from '../../backend/test/pdf-fixture';
import {
  advance,
  apiContext,
  createGuided,
  listProjects,
  seed,
  watchPage,
} from '../support/helpers';
import { expectScene, notices, projectOf } from '../support/app';
import {
  HARBOUR_NOTES,
  HARBOUR_QUESTION,
  apiCalls,
  bar,
  chooseStarter,
  closeEvidence,
  editText,
  evidenceButton,
  exploreButton,
  expectAttached,
  goOn,
  groundIt,
  menuProblem,
  openAsk,
  openEvidence,
  optionsButton,
  pasteSource,
  pill,
  questionBox,
  readScenario,
  recordRequests,
  reviewHarbour,
  reviewHeading,
  settledCount,
  tray,
  uploadFiles,
} from '../support/ask';

// What happens when making a project goes wrong, and what is left when it does: nothing misleading is created, what the
// person wrote is kept, the words say what happened and what can be done, and the way forward is never lost. The server
// is the local one (rules mode, no model). Motion is reduced so that nothing is measured while it moves.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

const alerts = (page: Page) => notices(page).getByRole('alert');
/** The notice that a project could not be opened: the alert that offers to try again, whatever its words. */
const openingFailed = (page: Page) =>
  page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Retry' }) });

test.describe('error conditions are specific, actionable, and never create misleading state', () => {
  test('unsupported, corrupt and oversized uploads explain themselves and create nothing', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const before = (await listProjects(api)).length;
    await openAsk(page);

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

    await uploadFiles(page, [
      { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2_100_000, 'a') },
    ]);
    await expect(menuProblem(page)).toContainText(
      'big.pdf: PDF files must be at most 2 MB before extraction.',
    );

    // None of the three became a source, and no project was made.
    await expect(tray(page)).toHaveCount(0);
    await expectAttached(page, 0);
    expect((await listProjects(api)).length).toBe(before);
  });

  test('an empty submit shows its own validation, not a stale upload error, and a valid PDF is then accepted', async ({
    page,
  }) => {
    await openAsk(page);
    await uploadFiles(page, [
      { name: 'old-failure.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
    ]);
    await expect(menuProblem(page)).toContainText('old-failure.exe');
    await closeEvidence(page);

    // The person presses Explore with nothing written: the box says what it needs, and the old failure is gone.
    await exploreButton(page).click();
    await expect(page.getByText('Say a little more: a sentence is enough.')).toBeVisible();
    await expect(page.getByText(/old-failure\.exe/u)).toHaveCount(0);
    await openEvidence(page);
    await expect(menuProblem(page)).toHaveCount(0);

    await uploadFiles(page, [
      {
        name: 'library-notes.pdf',
        mimeType: 'application/pdf',
        buffer: makePdf(
          'A fictional notes file about library opening hours, with enough characters to be accepted as source material for the scenario.',
        ),
      },
    ]);
    await expect(pill(page, 'library-notes.pdf')).toBeVisible();
    await expect(page.getByText(/not supported|malformed/u)).toHaveCount(0);
  });

  test('an unreachable API is reported with a retry that recovers without a reload', async ({
    page,
  }) => {
    await page.route('**/api/config', (route) => route.abort());
    await openAsk(page);
    const failure = page
      .getByRole('alert')
      .filter({ hasText: /The server.s settings could not be read/u });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(
      'Starting a question and model assistance wait until they can.',
    );
    // The question can still be written, and what the server has not said it offers is not offered.
    await expect(questionBox(page)).toBeEditable();
    await evidenceButton(page).click();
    await expect(page.getByRole('radio', { name: 'Web page' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.unroute('**/api/config');
    await failure.getByRole('button', { name: 'Retry' }).click();
    await expect(failure).toHaveCount(0);
    await evidenceButton(page).click();
    await expect(page.getByRole('radio', { name: 'Web page' })).toBeVisible();
  });
});

test.describe('making the project is refused or fails', () => {
  const refusals = [
    {
      what: 'rate-limited',
      status: 429,
      body: JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Wait a minute before retrying.',
        },
      }),
      says: 'Too many requests. Wait a minute before retrying.',
    },
    {
      what: 'refused as invalid',
      status: 400,
      body: JSON.stringify({
        error: {
          code: 'INVALID_INPUT',
          message: 'Enter a research question of 10–2,000 characters.',
        },
      }),
      says: 'Enter a research question of 10–2,000 characters.',
    },
    {
      what: 'answered with a page and not a message',
      status: 502,
      body: '<html>Bad gateway</html>',
      says: 'The request failed (502). Please retry.',
    },
  ] as const;

  for (const refusal of refusals) {
    test(`when it is ${refusal.what}, the input is kept, nothing is made, the words say why, and the same press tries again`, async ({
      page,
      playwright,
    }) => {
      const api = await apiContext(playwright);
      await page.route('**/api/projects', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: refusal.status,
              contentType: 'application/json',
              body: refusal.body,
            })
          : route.continue(),
      );
      await reviewHarbour(page);
      const decision = 'Double the mooring fee from the first of June';
      await editText(page, 'The decision or event', decision, { multiline: true });
      const before = (await listProjects(api)).length;

      await goOn(page).click();
      await expect(bar(page)).toContainText(refusal.says);
      // Where the person was is where they are: the scenario, with the edit, and the way to go on again.
      await expect(page).not.toHaveURL(/[?&]project=/u);
      await expect(reviewHeading(page)).toBeVisible();
      await expect(
        page.getByRole('button', { name: new RegExp(`^The decision or event: ${decision}`, 'u') }),
      ).toBeVisible();
      await expect(goOn(page)).toBeEnabled();
      expect((await listProjects(api)).length).toBe(before);

      await page.unroute('**/api/projects');
      await goOn(page).click();
      await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
      expect((await listProjects(api)).length).toBe(before + 1);
    });
  }

  test('one refusal is told once, not once for every time the page was drawn again', async ({
    page,
  }) => {
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Wait a minute before retrying.',
              },
            }),
          })
        : route.continue(),
    );
    await reviewHarbour(page);
    await goOn(page).click();
    await expect(bar(page)).toContainText('Too many requests. Wait a minute before retrying.');
    await expect(goOn(page)).toBeEnabled();
    // Told in the bar, and in at most one notice besides: never again for every time the page was drawn.
    expect(await settledCount(alerts(page)), 'the notices that tell it').toBeLessThanOrEqual(1);
  });

  test('a refusal does not say that something was saved, when nothing was', async ({ page }) => {
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Wait a minute before retrying.',
              },
            }),
          })
        : route.continue(),
    );
    await reviewHarbour(page);
    await goOn(page).click();
    await expect(bar(page)).toContainText('Too many requests. Wait a minute before retrying.');
    await settledCount(alerts(page));
    const said = (await alerts(page).allInnerTexts()).join('\n');
    expect(said).not.toMatch(/what is saved|saved has been read/iu);
  });

  test('when the server cannot be reached, it says so, keeps the input, and recovers when it can', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST' ? route.abort() : route.continue(),
    );
    await openAsk(page);
    await chooseStarter(page);
    await readScenario(page);
    const before = (await listProjects(api)).length;
    await goOn(page).click();
    await expect(bar(page)).toContainText(
      'Cannot reach the local server. Check that the backend is running, then retry.',
    );
    await expect(reviewHeading(page)).toBeVisible();
    expect((await listProjects(api)).length).toBe(before);

    await page.unroute('**/api/projects');
    await goOn(page).click();
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    expect((await listProjects(api)).length).toBe(before + 1);
  });

  test('when the project is made but reading its evidence cannot be started, the draft is kept and the way to start it is on the screen', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    await page.route('**/steps/knowledge', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL', message: 'The worker is not answering.' },
        }),
      }),
    );
    await openAsk(page);
    await chooseStarter(page);
    await readScenario(page);
    const before = (await listProjects(api)).length;
    await goOn(page).click();

    // The draft exists and the page is on it, so nothing the person wrote is lost.
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    const project = projectOf(page);
    expect((await listProjects(api)).length).toBe(before + 1);
    // The person is told what went wrong, with the reason the server gave.
    await expect(alerts(page).first()).toContainText('The worker is not answering.');
    await expect(alerts(page).first()).toContainText(/draft|saved/iu);

    // The way forward is on the scene, and works once the server does.
    await page.unroute('**/steps/knowledge');
    await goOn(page).click();
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();
    expect(projectOf(page)).toBe(project);
  });

  test('that failure is told once, and in the words of the product, not of a stage it no longer has', async ({
    page,
  }) => {
    await page.route('**/steps/knowledge', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL', message: 'The worker is not answering.' },
        }),
      }),
    );
    await reviewHarbour(page);
    await goOn(page).click();
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    await expect(alerts(page).first()).toContainText('The worker is not answering.');
    expect(await settledCount(alerts(page)), 'the notices that tell it').toBe(1);
    expect(await alerts(page).first().innerText()).not.toMatch(/Graph Build/u);
  });

  test('while the project is being made the person cannot make it twice, and cannot walk away from it', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await gate;
      return route.continue();
    });
    await openAsk(page);
    await chooseStarter(page);
    await readScenario(page);
    const made = recordRequests(page);
    const before = (await listProjects(api)).length;

    await goOn(page).click();
    // The button says so (as a status inside it) and cannot be pressed again, and the ways out are shut.
    await expect(goOn(page)).toBeDisabled();
    await expect(goOn(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Starting' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Question', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Swarm: start a new question' })).toBeDisabled();
    await goOn(page).click({ force: true });
    release();
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    expect(apiCalls(made).filter((call) => call === 'POST /api/projects')).toHaveLength(1);
    expect((await listProjects(api)).length).toBe(before + 1);
  });

  test('a double-clicked Ground it creates exactly one project', async ({ page, playwright }) => {
    const api = await apiContext(playwright);
    const made = recordRequests(page);
    await openAsk(page);
    await chooseStarter(page);
    await readScenario(page);
    const before = (await listProjects(api)).length;
    await goOn(page).dblclick();
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();
    expect((await listProjects(api)).length).toBe(before + 1);
    expect(apiCalls(made).filter((call) => call === 'POST /api/projects')).toHaveLength(1);
  });

  test('the answer to a question that could not be read can be given up on: the project is made without it', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    await page.route('**/api/scenario/parse', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The reader is busy.' } }),
      }),
    );
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
    const before = (await listProjects(api)).length;
    await exploreButton(page).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'The question could not be read' }),
    ).toBeVisible();
    // Failing to read is not failing to make: nothing was made, and the person decides.
    expect((await listProjects(api)).length).toBe(before);
    await page.getByRole('button', { name: 'Continue without reading' }).click();
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    expect((await listProjects(api)).length).toBe(before + 1);
  });
});

test.describe('a link to a project that cannot be opened', () => {
  const unknown = '00000000-0000-4000-8000-000000000000';

  for (const [what, id, reason] of [
    ['one that does not exist', unknown, /not found|does not exist|no longer exists/iu],
    [
      'one that is not a project link at all',
      'not-a-uuid',
      /not valid|invalid|not a valid|malformed/iu,
    ],
  ] as const) {
    test(`${what} fails with a notice and a retry, not a blank page`, async ({ page }) => {
      const problems = watchPage(page, { refusals: true });
      await page.goto(`/?project=${id}`);
      const failure = openingFailed(page);
      await expect(failure).toBeVisible();
      await expect(failure.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(page.getByRole('banner')).toBeVisible();
      expect(problems.filter((problem) => !/status of 4\d\d/u.test(problem))).toEqual([]);
    });

    test(`${what} says what is wrong with the link`, async ({ page }) => {
      await page.goto(`/?project=${id}`);
      const failure = openingFailed(page);
      await expect(failure).toBeVisible();
      // In the server's words or the page's own, a person is told why Retry would not help.
      await expect(failure).toContainText(reason);
    });

    test(`${what} leaves the way out: the mark leads to a new question`, async ({ page }) => {
      await page.goto(`/?project=${id}`);
      await expect(openingFailed(page)).toBeVisible();
      await page.getByRole('button', { name: 'Swarm: start a new question' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'See how a decision could unfold.',
      );
      await expect(page).not.toHaveURL(/[?&]project=/u);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }

  test('the failure is laid out inside the page, with its retry reachable', async ({ page }) => {
    await page.goto(`/?project=${unknown}`);
    const failure = openingFailed(page);
    await expect(failure).toBeVisible();
    const box = (await failure.boundingBox())!;
    expect(box.x, 'the notice starts inside the page, not at its edge').toBeGreaterThanOrEqual(8);
    const retry = (await failure.getByRole('button', { name: 'Retry' }).boundingBox())!;
    expect(retry.x + retry.width, 'the retry ends inside the page').toBeLessThanOrEqual(1440 - 8);
  });

  test('a project that could not be read for a moment is opened by Retry, without a reload', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const id = await createGuided(api, { name: 'Opened by retry' });
    let failing = true;
    await page.route(`**/api/projects/${id}`, (route) =>
      failing && route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'INTERNAL', message: 'Try again in a moment.' },
            }),
          })
        : route.continue(),
    );
    const problems = watchPage(page, { refusals: true });
    await page.goto(`/?project=${id}&scene=ground`);
    const failure = openingFailed(page);
    await expect(failure).toBeVisible();
    failing = false;
    await failure.getByRole('button', { name: 'Retry' }).click();
    await expect(failure).toHaveCount(0);
    await expectScene(page, 'ground');
    expect(problems.filter((problem) => !/status of 5\d\d/u.test(problem))).toEqual([]);
  });
});

test.describe('hostile input', () => {
  const MARKUP = '<img src=x onerror="window.__pwned = 1"> <script>window.__pwned = 2</script>';

  test('markup in a question, a source and a name is only text wherever it is shown, and never runs', async ({
    page,
  }) => {
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    const problems = watchPage(page);
    const name = '<b>Bold</b><img src=x onerror=window.__pwned=3>';
    const question = `What could happen to the harbour fee ${MARKUP} if visiting boats stay longer?`;
    const source = '<b onclick=alert(1)>notes.txt';

    await openAsk(page);
    await questionBox(page).fill(question);
    await pasteSource(page, source, `${HARBOUR_NOTES.content}\n${MARKUP}`);
    await optionsButton(page).click();
    await page
      .getByRole('dialog', { name: 'Options' })
      .getByRole('textbox', { name: 'Name' })
      .fill(name);
    await page.keyboard.press('Escape');
    await readScenario(page);
    await expect(page.getByRole('main').locator('blockquote')).toHaveText(question);
    await groundIt(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('<img src=x onerror=');

    // Back on the first screen, the list of explorations shows the name and the question as the text they are.
    await page.getByRole('button', { name: 'Swarm: start a new question' }).click();
    const recent = page.getByRole('region', { name: 'Continue' });
    await expect(recent.getByRole('listitem').first()).toContainText('<b>Bold</b>');

    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator('main b', { hasText: 'Bold' })).toHaveCount(0);
    await expect(page.locator('main script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
    expect(dialogs).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a question typed in the scenario’s own fields is read back as text too', async ({
    page,
  }) => {
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await reviewHarbour(page);
    await editText(page, 'Where', '<img src=x onerror="window.__pwned = 4">');
    await expect(page.getByRole('button', { name: /^Where: <img src=x onerror=/u })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
    expect(dialogs).toBe(0);
  });
});

test.describe('API error contracts', () => {
  test('state-machine violations are rejected with actionable codes', async ({ playwright }) => {
    const api = await apiContext(playwright);
    const unknown = '00000000-0000-4000-8000-000000000000';
    const code = async (response: Awaited<ReturnType<typeof api.post>>) =>
      ((await response.json()) as { error: { code: string } }).error.code;

    expect(await code(await api.post(`/api/projects/${unknown}/pause`))).toBe('RUN_NOT_PAUSABLE');

    const draft = await createGuided(api);
    expect(await code(await api.post(`/api/projects/${draft}/steps/simulation`))).toBe(
      'STEP_PREREQUISITE',
    );
    await advance(api, draft, 'knowledge');
    await advance(api, draft, 'environment');
    expect(
      await code(
        await api.post(`/api/projects/${draft}/steps/simulation`, { data: { resume: true } }),
      ),
    ).toBe('NO_CHECKPOINT');
    expect(
      await code(
        await api.put(`/api/projects/${draft}/intervention`, {
          data: {
            round: 3,
            label: 'Assumed event before any round exists',
            stance: 0,
            strength: 0.5,
          },
        }),
      ),
    ).toBe('INTERVENTION_LOCKED');
    expect(
      await code(await api.post(`/api/projects/${draft}/branches`, { data: { fromRound: 1 } })),
    ).toBe('BRANCH_NOT_READY');
    expect((await api.get(`/api/projects/${draft}/compare?with=${draft}`)).status()).toBe(400);
  });

  test('hostile requests are refused: foreign origin, oversized body, wrong content type', async ({
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const foreign = await api.post('/api/projects', {
      headers: { origin: 'https://evil.example' },
      data: { name: 'x' },
    });
    expect(foreign.status()).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      'ORIGIN_NOT_ALLOWED',
    );

    const oversized = await api.post('/api/projects', { data: { padding: 'x'.repeat(700_000) } });
    expect(oversized.status()).toBe(413);

    const wrongType = await api.post('/api/projects', {
      headers: { 'content-type': 'text/plain' },
      data: 'name=x',
    });
    expect(wrongType.status()).toBeGreaterThanOrEqual(400);
    expect(wrongType.status()).toBeLessThan(500);
  });

  test('a seeded project survives and is readable after all the failures above', async ({
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const id = await seed(api, 'simulation');
    const response = await api.get(`/api/projects/${id}`);
    expect(response.ok()).toBe(true);
  });
});
