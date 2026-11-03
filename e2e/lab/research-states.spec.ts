import { expect, test, type Locator, type Page } from '@playwright/test';
import { RESEARCH_STAGES, RESEARCH_STAGE_LABELS } from '../../shared/research';
import { expectScene, openApp, projectOf, type ThemeName } from '../support/app';
import {
  exploreButton,
  goOn,
  openAsk,
  questionBox,
  readScenario,
  reviewHeading,
} from '../support/ask';
import {
  expectNoBrokenFigures,
  expectTouchTargets,
  viewports,
  watchPage,
} from '../support/helpers';
import { claimsAgainst, recordApi } from '../support/lab-api';
import {
  FERRY,
  conflictsSection,
  deleteMade,
  expectControlsInside,
  expectReachable,
  expectSound,
  makeProject,
  sheet,
  sourcesSection,
} from '../support/ground-map';
import {
  QUESTION,
  fakeResearch,
  pagesRead,
  runAt,
  viewOf,
  type FakeResearch,
} from '../support/research-fake';

// The research surface on the Ground page, in every state it has. The project and everything about it is the real
// server's; what the server says of the research is a stand-in (support/research-fake.ts), so that a run can be put at
// any stage with any pages and every request made of it is recorded. The research itself (a question that finds its
// own sources, on a server that reads the web) is research-journey.spec.ts.

test.use({
  actionTimeout: 15_000,
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
});
test.afterEach(async ({ request }) => {
  await deleteMade(request);
});

const THEMES: ThemeName[] = ['light', 'dark', 'high-contrast'];

const chip = (page: Page): Locator => page.locator('[data-moment]');
const researchSection = (page: Page): Locator => page.getByRole('region', { name: /^Research/u });
const tracker = (page: Page): Locator => page.getByRole('list', { name: 'Research progress' });
const stage = (page: Page, name: (typeof RESEARCH_STAGES)[number]): Locator =>
  tracker(page).locator(`[data-stage="${name}"]`);
const pagesList = (page: Page): Locator => page.getByRole('list', { name: 'Pages' });
const pageRow = (page: Page, text: string): Locator =>
  pagesList(page).getByRole('listitem').filter({ hasText: text });
const figureOf = (page: Page, label: string): Locator =>
  page.locator('.sw-ground__figures > li').filter({ hasText: label });
const siteField = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Site or page to add' });
const press = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

/**
 * A fixture names the documents its used pages became by their place (D1 is the first the project holds); the server's
 * documents have ids of their own, and a page links to one only when the project holds it.
 */
async function withDocumentsOf(
  request: Parameters<typeof makeProject>[0],
  id: string,
  held: ReturnType<typeof viewOf>,
): Promise<ReturnType<typeof viewOf>> {
  if (!held.run) return held;
  const project = (await (await request.get(`/api/projects/${id}`)).json()) as {
    documents: { id: string }[];
  };
  const sources = held.run.sources.map((source) => {
    const place = /^D(\d+)$/u.exec(source.documentId ?? '')?.[1];
    const document = place ? project.documents[Number(place) - 1] : undefined;
    return document ? { ...source, documentId: document.id } : source;
  });
  return { ...held, run: { ...held.run, sources } };
}

/**
 * A project whose sources the page has been told it does not have, and the research the server holds of it. Where
 * `project` is given it is that one again, so that a test that looks at several states makes one project, not one each.
 */
async function open(
  page: Page,
  request: Parameters<typeof makeProject>[0],
  held: ReturnType<typeof viewOf>,
  options: {
    questionOnly?: boolean;
    theme?: ThemeName;
    enabled?: boolean;
    project?: string;
    firstReadDelayMs?: number;
  } = {},
): Promise<{ id: string; fake: FakeResearch }> {
  const questionOnly = options.questionOnly ?? true;
  // The page that was open stops asking, and what it was told before is not what it is told now.
  await page.goto('/api/health');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const id =
    options.project ?? (await makeProject(request, FERRY, questionOnly ? 'draft' : 'ground'));
  const fake = await fakeResearch(
    page,
    questionOnly ? held : await withDocumentsOf(request, id, held),
    { questionOnly, enabled: options.enabled, firstReadDelayMs: options.firstReadDelayMs },
  );
  await openApp(page, { project: id, scene: 'ground', theme: options.theme });
  return { id, fake };
}

test.describe('a question that is being researched', () => {
  test('goes through the six stages in order, each shown only when the run has reached it, the counters those of the run', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const { fake } = await open(page, request, viewOf(runAt('planning')));

    // The head of the page is the run's: its stage as the status, its figures, its controls; nothing of the evidence's.
    await expect(chip(page)).toHaveText('Planning');
    await expect(press(page, 'Pause')).toBeVisible();
    await expect(press(page, 'Ground it')).toHaveCount(0);
    await expect(page.getByText('No source text')).toHaveCount(0);
    await expect(figureOf(page, 'Pages read')).toContainText('0');

    const reached: string[] = [];
    for (const [index, name] of RESEARCH_STAGES.entries()) {
      fake.put(viewOf(runAt(name)));
      if (name === 'ready') break;
      // The page reads the run every second or two: what it shows is the stage that was put, and the ones before it done.
      await expect(chip(page)).toHaveText(RESEARCH_STAGE_LABELS[name], { timeout: 10_000 });
      reached.push(name);
      await expect(stage(page, name)).toHaveAttribute('data-state', 'active');
      await expect(stage(page, name)).toHaveAttribute('aria-current', 'step');
      for (const earlier of RESEARCH_STAGES.slice(0, index)) {
        await expect(stage(page, earlier)).toHaveAttribute('data-state', 'done');
      }
      for (const later of RESEARCH_STAGES.slice(index + 1)) {
        await expect(stage(page, later)).toHaveAttribute('data-state', 'waiting');
      }
    }
    expect(reached).toEqual(RESEARCH_STAGES.slice(0, 5));

    // Reading: the pages that were read, in the order they were, and the run's own counts.
    fake.put(viewOf(runAt('reading')));
    await expect(figureOf(page, 'Pages read')).toContainText('4', { timeout: 10_000 });
    await expect(figureOf(page, 'Sources used')).toContainText('0');
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(4);
    // The plan's sites are suggestions, and a site is named once the research has stopped: a site is a run of its own.
    await expect(researchSection(page)).toContainText('once the research has stopped');
    await expect(press(page, 'Add this site: regulator.example.org')).toHaveCount(0);
    await expect(siteField(page)).toHaveCount(0);
    // A count that the run has not reached is a dash.
    await expect(
      figureOf(page, 'Conflicts').getByRole('img', { name: 'Not known yet' }),
    ).toBeVisible();

    // Once the run has compared what it read, the count is known, and says that something conflicts.
    fake.put(viewOf(runAt('checking-conflicts', { conflictCount: 1 })));
    await expect(figureOf(page, 'Conflicts')).toContainText('1', { timeout: 10_000 });
    expect(problems).toEqual([]);
  });

  test('pauses, resumes and finishes early, the page following the server each time; cancelling asks first', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const { fake } = await open(page, request, viewOf(runAt('reading')));

    await press(page, 'Pause').click();
    await expect(chip(page)).toHaveText('Paused');
    await expect(press(page, 'Resume')).toBeVisible();
    await expect(stage(page, 'reading')).toHaveAttribute('data-state', 'paused');
    await expect(researchSection(page)).toContainText('Nothing is read while it is paused');

    await press(page, 'Resume').click();
    await expect(chip(page)).toHaveText('Reading');
    await expect(press(page, 'Pause')).toBeVisible();

    // Cancelling is asked about, and "keep going" goes on.
    await press(page, 'Cancel').click();
    const asking = page.getByRole('dialog', { name: 'Cancel the research' });
    await expect(asking).toBeVisible();
    await expect(asking).toContainText(
      'Finish early stops reading and goes on with what was found',
    );
    await asking.getByRole('button', { name: 'Keep going' }).click();
    await expect(asking).toHaveCount(0);
    await expect(press(page, 'Cancel')).toBeFocused();
    expect(fake.calls.filter((call) => call.startsWith('POST'))).toEqual([
      'POST pause',
      'POST resume',
    ]);

    // Cancelling, when told to, stops the run: the pages read stay listed.
    await press(page, 'Cancel').click();
    await page
      .getByRole('dialog', { name: 'Cancel the research' })
      .getByRole('button', { name: 'Cancel research' })
      .click();
    await expect(chip(page)).toHaveText('Stopped');
    await expect(researchSection(page)).toContainText('Research was stopped');
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(4);
    await expect(press(page, 'Research again')).toBeVisible();

    // Another run, and finishing it early goes on with what was found.
    await press(page, 'Research again').click();
    await expect(chip(page)).toHaveText('Queued');
    fake.put(viewOf(runAt('reading')));
    await expect(press(page, 'Finish early')).toBeVisible({ timeout: 10_000 });
    await press(page, 'Finish early').click();
    await expect(stage(page, 'ready')).toHaveAttribute('data-state', 'done');
    await expect(researchSection(page)).toContainText('Why it stopped');
    expect(problems).toEqual([]);
  });

  test('offers only what the server says a person may do', async ({ page, request }) => {
    await open(
      page,
      request,
      viewOf(runAt('reading'), { start: false, pause: false, cancel: false }),
    );
    await expect(tracker(page)).toBeVisible();
    for (const name of ['Pause', 'Resume', 'Finish early', 'Cancel', 'Start research']) {
      await expect(press(page, name)).toHaveCount(0);
    }
    await expect(siteField(page)).toHaveCount(0);
  });

  test('says that updates have paused when the server cannot be read, keeps what was read, and carries on when it can be', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page, { refusals: true });
    const { fake } = await open(page, request, viewOf(runAt('reading')));
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(4);

    fake.breakReads();
    const notice = researchSection(page)
      .locator('.sw-notice')
      .filter({ hasText: 'Updates have paused' });
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText('Showing what was last read');
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(4);
    await expectSound(page, 'research: updates paused');

    fake.mend();
    fake.put(viewOf(runAt('extracting-evidence')));
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(chip(page)).toHaveText('Extracting evidence');
    expect(problems.filter((problem) => !/\b50\d\b/u.test(problem))).toEqual([]);
  });
});

test.describe('a project that has not been researched', () => {
  test('says that it is reading while the first answer is on its way, and then shows it', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    await open(page, request, viewOf(runAt('reading')), { firstReadDelayMs: 3_000 });
    const section = researchSection(page);
    await expect(section).toHaveAttribute('data-research', 'loading');
    await expect(section.locator('[aria-busy="true"]')).toBeVisible();
    // Nothing is said of a run that the page has not been told of.
    await expect(tracker(page)).toHaveCount(0);
    await expect(press(page, 'Pause')).toHaveCount(0);
    await expectSound(page, 'research: reading the first answer');
    await expect(tracker(page)).toBeVisible({ timeout: 10_000 });
    await expect(chip(page)).toHaveText('Reading');
    expect(problems).toEqual([]);
  });

  test('shows what would happen, none of it reached, and starts on one press', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const { fake } = await open(page, request, viewOf(null));
    await expect(chip(page)).toHaveText('Not started');
    await expect(tracker(page).locator('[data-state="waiting"]')).toHaveCount(6);
    await expect(page.getByText('No source text')).toHaveCount(0);
    // Finding sources from a question alone needs a provider: the page says so before anything is asked of it.
    await expect(researchSection(page)).toContainText('not set up here');
    await expectSound(page, 'research: not started');

    await press(page, 'Start research').click();
    await expect(chip(page)).toHaveText('Queued');
    expect(fake.calls.filter((call) => call.startsWith('POST'))).toEqual(['POST start']);
    expect(problems).toEqual([]);
  });

  test('is made from a question alone: the project is made, its research is started and not its evidence, and Ground opens on the run', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const calls = recordApi(page);
    const fake = await fakeResearch(page, viewOf(null), {
      questionOnly: true,
      makesQuestionOnly: true,
    });
    try {
      await openAsk(page);
      await questionBox(page).fill(QUESTION);
      await readScenario(page);
      await expect(reviewHeading(page)).toBeVisible();
      await goOn(page).click();
      await expect(page).toHaveURL(/[?&]project=/u);
      await expectScene(page, 'ground');

      // What the page sent: a question and the intake for research, and no document.
      expect(fake.created?.question).toBe(QUESTION);
      expect(fake.created?.documents).toEqual([]);
      expect(fake.created?.research).toMatchObject({ auto: true });
      // What it did: made the project, started its research, and did not start the reading of evidence there is none of.
      const asked = calls
        .filter((call) => call.method === 'POST' && call.shape.startsWith('/api/projects'))
        .map((call) => call.shape);
      expect(asked).toEqual(['/api/projects', '/api/projects/:id/research']);
      expect(projectOf(page)).toBeTruthy();
      await expect(chip(page)).toHaveText('Queued');
      await expect(press(page, 'Cancel')).toBeVisible();
      expect(problems).toEqual([]);
    } finally {
      for (const id of fake.made) await request.delete(`/api/projects/${id}`);
    }
  });
});

test.describe('a search from a question alone that cannot go on', () => {
  const blocked = () =>
    viewOf(
      runAt('finding-sources', {
        status: 'blocked',
        stoppedBecause: 'discovery-unconfigured',
        sources: [],
      }),
    );

  test('says plainly why, with the server’s words, never searches on its own, and keeps the manual ways open', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page, { refusals: true });
    const { fake } = await open(page, request, blocked());
    await expect(chip(page)).toHaveText('Blocked');
    const section = researchSection(page);
    await expect(section).toContainText('Swarm cannot find sources from a question alone');
    await expect(section).toContainText('does not search the web on its own');
    await expect(section).toContainText('No search provider is configured');
    await expect(stage(page, 'finding-sources')).toHaveAttribute('data-state', 'blocked');
    await expect(stage(page, 'finding-sources')).toContainText('Needs a search provider');
    await expect(pagesList(page)).toHaveCount(0);
    await expectSound(page, 'research: blocked');

    // A suggestion is added when a person says so, and never on its own.
    expect(fake.calls).not.toContain('POST sources');
    await press(page, 'Add this site: regulator.example.org').click();
    // What is named is a run of its own: the page follows it, and nothing else can be named until it has stopped.
    await expect(chip(page)).toHaveText('Queued');
    expect(fake.calls).toContain('POST sources');
    await expect(siteField(page)).toHaveCount(0);
    await expect(press(page, 'Add this site: regulator.example.org')).toHaveCount(0);
    fake.put(blocked());
    await expect(chip(page)).toHaveText('Blocked', { timeout: 10_000 });

    // The head of the page offers the way on that is open: the field that names a site.
    await press(page, 'Add a site or page').click();
    await expect(siteField(page)).toBeFocused();
    await siteField(page).fill('10.0.0.5');
    await press(page, 'Add').click();
    await expect(section.getByRole('alert')).toContainText('private or local network');
    await expect(siteField(page)).toHaveValue('10.0.0.5');
    await siteField(page).fill('javascript:alert(1)');
    await press(page, 'Add').click();
    await expect(section.getByRole('alert')).toContainText('does not look like a web address');
    await siteField(page).fill('operator.example.org');
    await press(page, 'Add').click();
    await expect(chip(page)).toHaveText('Queued');
    expect(fake.calls.filter((call) => call === 'POST sources')).toHaveLength(3);
    expect(problems.filter((problem) => !/\b422\b/u.test(problem))).toEqual([]);
  });

  test('opens the question again with room for sources of one’s own: paste, attach or add a page', async ({
    page,
    request,
  }) => {
    await open(page, request, blocked());
    await press(page, 'Open the question to add sources').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'See how a decision could unfold.',
    );
    await expect(questionBox(page)).toHaveValue(FERRY.question);
    await expect(exploreButton(page)).toBeEnabled();
  });
});

test.describe('a run that did not finish', () => {
  test('failed: says it, with the last thing the run said as text, and starts again on one press', async ({
    page,
    request,
  }) => {
    const { fake } = await open(
      page,
      request,
      viewOf(
        runAt('extracting-evidence', {
          status: 'failed',
          events: [
            {
              at: '2026-03-14T10:29:20.000Z',
              stage: 'extracting-evidence',
              level: 'block',
              message: 'The reader stopped on a page it could not take apart.',
            },
          ],
        }),
      ),
    );
    await expect(chip(page)).toHaveText('Failed');
    await expect(stage(page, 'extracting-evidence')).toHaveAttribute('data-state', 'failed');
    await expect(researchSection(page)).toContainText('Research could not finish');
    await expect(researchSection(page)).toContainText(
      'The reader stopped on a page it could not take apart.',
    );
    await expectSound(page, 'research: failed');
    await press(page, 'Try again').click();
    await expect(chip(page)).toHaveText('Queued');
    expect(fake.calls).toContain('POST start');
  });

  test('stopped by a person: the pages that were read stay, and the way to do it again is one press', async ({
    page,
    request,
  }) => {
    await open(
      page,
      request,
      viewOf(runAt('reading', { status: 'cancelled', stoppedBecause: 'cancelled' })),
    );
    await expect(chip(page)).toHaveText('Stopped');
    await expect(researchSection(page)).toContainText('A person stopped the research');
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(4);
    await expect(press(page, 'Research again')).toBeVisible();
    await expectSound(page, 'research: stopped');
  });
});

test.describe('what became of each page', () => {
  const finished = () =>
    viewOf(
      runAt('ready', {
        sources: pagesRead().map((source, index) =>
          source.outcome === 'used' ? { ...source, documentId: `D${index + 1}` } : source,
        ),
      }),
    );

  test('says it in plain words for every page, with the reason of each that was set aside, and judges none', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    await open(page, request, finished(), { questionOnly: false });
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(8);
    const used = pageRow(page, 'Council fares review: summary of the evidence').first();
    await expect(used).toContainText('Used');
    await expect(used).toContainText('Authority estimate: High');
    await expect(pageRow(page, 'members.example.org')).toContainText(
      'It asks for a sign-in, so there was nothing to read.',
    );
    await expect(pageRow(page, 'Fares explained')).toContainText('Instruction-like text');
    await expect(pageRow(page, 'private.example.org')).toContainText(
      'robots.txt asks not to be read',
    );
    await expect(pageRow(page, 'slow.example.org')).toContainText(
      'The site took too long to answer.',
    );
    await expect(pageRow(page, '(print version)')).toContainText(
      'It repeats a page that was already read.',
    );
    // An estimate, said once above the pages: it is no verdict.
    await expect(researchSection(page)).toContainText('says nothing about whether a page is right');

    const text = (await researchSection(page).innerText()).replace(/\n+/gu, '. ');
    expect(claimsAgainst(text)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('says where a page came from in a popover that closes with Escape and gives focus back', async ({
    page,
    request,
  }) => {
    await open(page, request, finished(), { questionOnly: false });
    const open_ = press(page, /^Provenance: Riders talk about cheaper evening crossings/u);
    await open_.click();
    const card = page.getByRole('dialog', { name: /^Provenance of Riders talk/u });
    await expect(card).toBeVisible();
    await expect(card).toContainText('https://forum.example.org/threads/evening-fares');
    await expect(card).toContainText('SHA-256');
    await expect(card).toContainText('The site’s robots.txt allows it.');
    await expect(card).toContainText('Only the first page of the thread was read.');
    await expect(card.getByRole('link', { name: /Open the page/u })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expectSound(page, 'research: provenance open');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(open_).toBeFocused();
  });

  test('shows the pages that were used, or those that were not, when asked', async ({
    page,
    request,
  }) => {
    await open(page, request, finished(), { questionOnly: false });
    await page.getByRole('radio', { name: /^Used 2/u }).click();
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(2);
    await page.getByRole('radio', { name: /^Not used 6/u }).click();
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(6);
    await page.getByRole('radio', { name: /^All 8/u }).click();
    await expect(pagesList(page).getByRole('listitem')).toHaveCount(8);
  });

  test('is text and nothing else: markup in a title is shown as it was written, and a script is no link', async ({
    page,
    request,
  }) => {
    const hostile = viewOf(
      runAt('reading', {
        sources: [
          {
            ...pagesRead()[2]!,
            title: '<img src=x onerror="window.__pwned = 1"> <script>window.__pwned = 2</script>',
            requestedUrl: 'javascript:window.__pwned=3',
            finalUrl: 'javascript:window.__pwned=3',
          },
        ],
      }),
    );
    await open(page, request, hostile);
    await expect(pagesList(page)).toContainText('<img src=x onerror="window.__pwned = 1">');
    await expect(pagesList(page).locator('img, script')).toHaveCount(0);
    await page.getByRole('button', { name: /^Provenance: / }).click();
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
  });
});

test.describe('finished research in a project that has its sources', () => {
  const finished = () =>
    viewOf(
      runAt('ready', {
        finishedAt: new Date(Date.now() - 3_600_000).toISOString(),
        updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
        sources: pagesRead().map((source, index) =>
          source.outcome === 'used' ? { ...source, documentId: `D${index + 1}` } : source,
        ),
      }),
    );

  test('is the record of how the sources were found, after them; the head of the page is the evidence’s', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    await open(page, request, finished(), { questionOnly: false });
    await expect(sourcesSection(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();
    await expect(chip(page)).toHaveText('Ready');
    // Settled research comes after the sources it found, as the record of how they were found.
    const [sources, research] = [
      (await sourcesSection(page).boundingBox())!,
      (await researchSection(page).boundingBox())!,
    ];
    expect(research.y).toBeGreaterThan(sources.y);
    await expectSound(page, 'research: finished, in a project that has its sources');
    expect(problems).toEqual([]);
  });

  test('links a page that was used to the document it became, and its conflicts to the conflicts', async ({
    page,
    request,
  }) => {
    await open(page, request, finished(), { questionOnly: false });
    // The conflicts that the run found are the ledger's: the link goes there.
    await researchSection(page).getByRole('button', { name: 'Review it' }).click();
    await expect(page).toHaveURL(/[?&]view=conflicts(?:&|$)/u);
    await expect(conflictsSection(page)).toBeInViewport();

    await press(page, /^Council fares review: summary of the evidence, open the source/u).click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('says that it may be out of date when the question moves and the research is old', async ({
    page,
    request,
  }) => {
    const old = finished();
    const days = 30;
    const at = new Date(Date.now() - days * 86_400_000).toISOString();
    old.run = { ...old.run!, finishedAt: at, updatedAt: at };
    const { fake } = await open(page, request, old, { questionOnly: false });
    await expect(researchSection(page)).toContainText('This research may be out of date');
    await expect(researchSection(page)).toContainText(`It finished ${days} days ago`);
    await researchSection(page).getByRole('button', { name: 'Research again' }).click();
    expect(fake.calls).toContain('POST start');
  });

  test('is not drawn at all where the server does not research, and the page is as it was', async ({
    page,
    request,
  }) => {
    const { fake } = await open(page, request, finished(), { questionOnly: false, enabled: false });
    await expect(sourcesSection(page)).toBeVisible();
    await expect(researchSection(page)).toHaveCount(0);
    await expect(chip(page)).toHaveText('Ready');
    expect(fake.calls).toEqual([]);
  });
});

test.describe('on every screen', () => {
  const reading = () => viewOf(runAt('reading'));
  const everything = () =>
    viewOf(
      runAt('ready', {
        sources: pagesRead().map((source, index) =>
          source.outcome === 'used' ? { ...source, documentId: `D${index + 1}` } : source,
        ),
        finishedAt: new Date(Date.now() - 3_600_000).toISOString(),
        updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    );

  for (const viewport of viewports) {
    test(`fits at ${viewport.name}: nothing runs off the screen, the text reads, and axe is clean in every theme`, async ({
      page,
      request,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const project = await makeProject(request, FERRY, 'ground');
      for (const theme of THEMES) {
        await open(page, request, reading(), { theme, project });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(tracker(page)).toBeVisible();
        const label = (what: string) => `research at ${viewport.name}, ${theme}: ${what}`;
        await expectSound(page, label('running'));
        await expectNoBrokenFigures(page);
        await expectControlsInside(page.locator('.sw-ground__hero'), label('the head of the page'));

        // A page's provenance, open.
        await press(page, /^Provenance: Council fares review/u).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectSound(page, label('provenance open'));
        await page.keyboard.press('Escape');

        // And finished, in a project that has its sources.
        await open(page, request, everything(), { theme, questionOnly: false, project });
        await expect(sourcesSection(page)).toBeVisible();
        await expectSound(page, label('finished'));
      }
      expect(problems).toEqual([]);
    });
  }

  test('every control a pointer has to reach is large enough, in a run, a blocked search and finished research', async ({
    page,
    request,
  }) => {
    const { id: project } = await open(page, request, reading());
    await expectReachable(page, 'research: running');
    await press(page, 'Cancel').click();
    await expectReachable(page, 'research: the question before cancelling');
    await page.keyboard.press('Escape');
    await open(
      page,
      request,
      viewOf(
        runAt('finding-sources', {
          status: 'blocked',
          stoppedBecause: 'discovery-unconfigured',
          sources: [],
        }),
      ),
      { project },
    );
    await expectReachable(page, 'research: blocked');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the controls of a run share the first screen, and every control is large enough for a finger', async ({
      page,
      request,
    }) => {
      await open(page, request, reading());
      await expectSound(page, 'research on a phone: running');
      // The three controls sit on one row, and the stages begin on the first screen.
      const boxes = await Promise.all(
        ['Pause', 'Finish early', 'Cancel'].map(
          async (name) => (await press(page, name).boundingBox())!,
        ),
      );
      expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1);
      expect(boxes.every((box) => box.x + box.width <= 390)).toBe(true);
      expect((await tracker(page).boundingBox())!.y).toBeLessThan(844);
      await expectTouchTargets(page, 'research on a phone: running', 'main');

      await press(page, /^Provenance: Council fares review/u).tap();
      const card = page.getByRole('dialog');
      await expect(card).toBeVisible();
      await expectControlsInside(card, 'the provenance of a page on a phone');
      await expectTouchTargets(page, 'research on a phone: provenance', '[role="dialog"]');
    });

    test('a finished run, and one that is blocked, fit the screen', async ({ page, request }) => {
      const { id: project } = await open(page, request, everything(), { questionOnly: false });
      await expect(chip(page)).toHaveText('Ready');
      await expectSound(page, 'research on a phone: finished');
      await expectTouchTargets(page, 'research on a phone: finished', 'main');
      await open(
        page,
        request,
        viewOf(
          runAt('finding-sources', {
            status: 'blocked',
            stoppedBecause: 'discovery-unconfigured',
            sources: [],
          }),
        ),
        { project },
      );
      await expect(chip(page)).toHaveText('Blocked');
      await expectSound(page, 'research on a phone: blocked');
      await expectTouchTargets(page, 'research on a phone: blocked', 'main');
    });
  });

  test.describe('with forced colours', () => {
    test('every state is drawn in the system’s colours, and still reads', async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await open(page, request, reading());
      await expect(tracker(page)).toBeVisible();
      await expectSound(page, 'research in forced colours: running');
      // A stage is said in words, never in a colour alone.
      await expect(stage(page, 'reading')).toContainText('in progress');
      await expect(stage(page, 'planning')).toContainText('done');
      await expect(stage(page, 'ready')).toContainText('waiting');
    });
  });
});
