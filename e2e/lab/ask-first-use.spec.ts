import { expect, test, type Page, type Route } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { projectOf } from '../support/app';
import {
  HARBOUR_QUESTION,
  HEADING,
  PROMPTS,
  SUPPORT_LINE,
  TAGLINE,
  advancedButton,
  atRest,
  exploreButton,
  goOn,
  openAsk,
  optionsButton,
  questionBox,
  readScenario,
  researchSwitch,
  reviewHeading,
  siteBox,
  templatesList,
} from '../support/ask';

// The first-use task test: a person who has never seen the screen, and is told nothing, wants to find out what
// would happen if a harbour office doubled its fee. What they need is on the screen: what Swarm does, what to type,
// what it does by itself, why to trust it, and that it explores and does not predict. They type one question and
// press the one button; Swarm reads the question into a scenario they can correct, and one more press starts.
//
// What the first screen draws is what the server says it can do, so each test here says which server it is about.
// The first is about any server. Most are about the one the suite starts, which is the default: research is on, and no
// search provider is behind it, so a question alone has nothing to read and waits, calmly, for a source (they say so
// and stop where the server is otherwise). The ones that tell the page what the server says (`told`) are about what the
// page claims for a server that has what the suite's server has not: a search provider, or no constraints. The first
// screen of a server where research is off is ask-composer.spec.ts, and what research does with a site that is named,
// beside the sources that were added, is ask-research.spec.ts.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });

/** The most the person does between the screen opening and research starting: write, press Explore, press Ground it. */
const INTERACTIONS = 3;
/** The most words the hero may say before the question: the heading and the sentence under it. */
const HERO_WORDS = 25;

const words = (text: string): string[] => text.split(/\s+/u).filter(Boolean);

interface Told {
  research: boolean;
  /** The server can look for sources from a question alone: a search provider is behind it. */
  discovery: boolean;
  constraints: boolean;
}

/** What the server under test says it does about research, as the page reads it. */
async function serverResearch(page: Page): Promise<{ researches: boolean; discovers: boolean }> {
  const config = (await (await page.request.get('/api/config')).json()) as {
    research?: { enabled?: unknown; discovery?: { available?: unknown } };
  };
  return {
    researches: config.research?.enabled === true,
    discovers: config.research?.discovery?.available === true,
  };
}

/**
 * Says to the page that the server has what later work adds, and nothing else about it changes. A server that is told
 * it researches has no search provider unless it is told that it has.
 */
async function told(page: Page, what: Partial<Told>): Promise<void> {
  await page.route('**/api/config', async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    if (what.research) {
      body.research = {
        enabled: true,
        discovery: { available: what.discovery === true, provider: null, message: 'Told.' },
      };
    }
    if (what.constraints !== undefined) body.features = { constraints: what.constraints };
    await route.fulfill({ response, json: body });
  });
}

/** What the review says research does for a question alone, by whether a search provider is behind the server. */
const FOR_A_QUESTION_ALONE = {
  searches:
    /Automatic research is on\. After you continue, Swarm looks for public sources, and lists every page it reads\./u,
  cannot:
    /This server cannot look for sources from a question alone\. After you continue, Swarm asks you to name a website or add a source\./u,
};

/**
 * What the page sends to make the project, captured as it is sent: the request carries what was asked, and the server
 * answers it as it does.
 */
function capturingCreation(page: Page): { body: Record<string, unknown> | null } {
  const sent: { body: Record<string, unknown> | null } = { body: null };
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects') {
      sent.body = request.postDataJSON() as Record<string, unknown>;
    }
  });
  return sent;
}

/**
 * Says that a test is about the server the suite starts by default: research is on (a server researches unless it is
 * set not to) and no search provider is behind it. Where the server is otherwise the test stops, and says why.
 */
async function aServerThatResearchesAndCannotSearch(page: Page): Promise<void> {
  const { researches, discovers } = await serverResearch(page);
  test.skip(!researches, 'This server does not research.');
  test.skip(discovers, 'This server can search for sources, and this is about one that cannot.');
}

/** What a person can read and press before scrolling, counted as the eye does: words in view, and the controls in view. */
async function whatIsOnTheFirstView(page: Page) {
  return page.evaluate(() => {
    const shown = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        box.width > 1 &&
        box.height > 1 &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        !element.closest('[inert], [hidden], .sr-only')
      );
    };
    const inView = (element: Element): boolean =>
      element.getBoundingClientRect().top < window.innerHeight;

    let words = 0;
    const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (text && parent && shown(parent) && inView(parent)) words += text.split(/\s+/u).length;
    }
    // A radio or a switch is drawn by its label, and the input itself is kept small: it still counts.
    const controls = [
      ...document.querySelectorAll(
        'main button, main input:not([type=hidden]), main textarea, main select, main a[href]',
      ),
    ].filter(
      (element) =>
        (shown(element) || element.matches('input[type=radio], input[role=switch]')) &&
        inView(element),
    );
    return { controls: controls.length, words };
  });
}

test.describe('the first ten seconds, with nothing explained', () => {
  test('say what Swarm does, what to type, what it does by itself, why to trust it, and that it explores and does not predict', async ({
    page,
  }, info) => {
    const problems = watchPage(page);
    await openAsk(page);

    // What it does: the heading, and one sentence, which together are a few words and all the hero says.
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(HEADING);
    const sentence = heading.locator('xpath=following-sibling::p[1]');
    await expect(sentence).toHaveText(SUPPORT_LINE);
    const hero = words(`${await heading.innerText()} ${await sentence.innerText()}`);
    expect(
      hero.length,
      `the hero says ${hero.length} words: ${hero.join(' ')}`,
    ).toBeLessThanOrEqual(HERO_WORDS);

    // What to type: one box, named for what it is for, and showing a question as an example while it is empty.
    await expect(page.getByText('Your what-if question', { exact: true })).toBeVisible();
    await expect(questionBox(page)).toBeInViewport({ ratio: 1 });
    const suggested = await Promise.all(
      PROMPTS.map((prompt) =>
        page.getByText(prompt, { exact: true }).filter({ visible: true }).count(),
      ),
    );
    expect(
      suggested.some((count) => count > 0),
      'a question is suggested in the empty box',
    ).toBe(true);
    // And templates to start from, a click each.
    await expect(templatesList(page).getByRole('button')).toHaveCount(7);

    // The one action: visible, named, enabled, and the only button that submits.
    await expect(exploreButton(page)).toBeVisible();
    await expect(exploreButton(page)).toBeEnabled();
    await expect(exploreButton(page)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('main button[type="submit"]')).toHaveCount(1);

    // What Swarm does by itself, and what the person controls at each step, one press away.
    await expect(researchSwitch(page)).toBeVisible();
    const steps = page.getByRole('list', { name: 'How Swarm works' }).getByRole('button');
    await expect(steps).toHaveCount(5);
    await expect(steps.first()).toBeInViewport({ ratio: 1 });
    await expect(
      page
        .getByRole('region', { name: 'How Swarm works' })
        .getByText(/^Swarm\s+reads your question/u),
    ).toBeVisible();

    // Why to trust it: what every exploration includes, said in words and not in numbers.
    const signals = page.getByRole('list', { name: 'What every exploration includes' });
    await expect(signals).toBeVisible();
    await expect(signals.getByRole('listitem').first()).toHaveText('Evidence linked');

    // That it explores and does not predict.
    await expect(page.getByText(TAGLINE, { exact: true })).toBeVisible();

    // Counts for the record: how much there is to read and to use before the person has done anything.
    const first = await whatIsOnTheFirstView(page);
    info.annotations.push(
      { type: 'hero words', description: String(hero.length) },
      { type: 'controls in the first view', description: String(first.controls) },
      { type: 'words in the first view', description: String(first.words) },
    );
    console.log(
      `first view: hero ${hero.length} words, ${first.words} words in all, ${first.controls} controls`,
    );
    expect(first.words, 'words in the first view').toBeLessThan(220);
    expect(first.controls, 'controls in the first view').toBeLessThanOrEqual(30);
    expect(problems).toEqual([]);
  });

  test('on a server that researches draws the switch on and in reach, with what it does here, and needs no source to be asked', async ({
    page,
  }) => {
    await aServerThatResearchesAndCannotSearch(page);
    await openAsk(page);

    // On, and in reach; and what it says is what it does here: it reads the website that is named, and asks for a source
    // when none is. It says nothing of a search, because nothing here can search.
    await expect(researchSwitch(page)).toBeEnabled();
    await expect(researchSwitch(page)).toBeChecked();
    await expect(page.getByText('Reads the site you name, or asks for one.')).toBeVisible();
    await expect(siteBox(page)).toBeEnabled();
    await expect(
      page.getByText(/finds and reads public sources|looks for public sources/u),
    ).toHaveCount(0);

    // A question is enough to ask: nothing has to be attached first.
    await questionBox(page).fill(HARBOUR_QUESTION);
    await expect(exploreButton(page)).toBeEnabled();
    await expect(page.getByText('Add a source', { exact: true })).toHaveCount(0);
  });

  test('one question reaches the start of research in three interactions, with no documentation, and the time to the first action is logged', async ({
    page,
  }, info) => {
    await aServerThatResearchesAndCannotSearch(page);
    const sent = capturingCreation(page);
    const problems = watchPage(page);

    // Nothing is read before the first press: no page of documentation, no help, no dialog.
    const opened: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) opened.push(new URL(frame.url()).pathname);
    });
    await page.addInitScript(() => {
      window.addEventListener(
        'input',
        () => {
          (window as unknown as { firstInput?: number }).firstInput ??= performance.now();
        },
        { once: true, capture: true },
      );
    });

    const started = Date.now();
    await openAsk(page);
    const ready = Date.now() - started;
    await expect(page.getByRole('dialog')).toHaveCount(0);

    let interactions = 0;
    const act = async (what: string, action: () => Promise<unknown>): Promise<void> => {
      interactions += 1;
      info.annotations.push({ type: `interaction ${interactions}`, description: what });
      await action();
    };

    // 1. Write the question. Nothing else is asked: not a source, not a time frame, not a place.
    await act('write the question', async () => {
      await questionBox(page).click();
      await page.keyboard.insertText(HARBOUR_QUESTION);
    });
    const firstAction = Date.now() - started;
    const inPage = await page.evaluate(
      () => (window as unknown as { firstInput?: number }).firstInput ?? null,
    );
    await expect(exploreButton(page)).toBeEnabled();

    // 2. The one button reads the question into a scenario, and says that nothing runs yet.
    await act('press Explore', () => exploreButton(page).click());
    await expect(reviewHeading(page)).toBeVisible();
    await expect(goOn(page)).toBeVisible();
    await expect(page.getByText('Nothing runs until you continue.')).toBeVisible();
    // What research will do is what this server can do: it cannot look for sources from a question alone, and says so.
    await expect(page.getByText(FOR_A_QUESTION_ALONE.cannot)).toBeVisible();

    // 3. Going on starts it: the request carries a question and the intake for research, and no document.
    await act('press Ground it', () => goOn(page).click());
    await expect(page).toHaveURL(/[?&]project=/u);
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    expect(projectOf(page)).toBeTruthy();
    const total = Date.now() - started;

    expect(sent.body, 'the page made the project').not.toBeNull();
    expect(sent.body!.question).toBe(HARBOUR_QUESTION);
    expect(sent.body!.research).toEqual({ auto: true });
    expect(sent.body!.scenario, 'the scenario the person confirmed').toBeTruthy();
    expect(sent.body!.documents).toEqual([]);

    expect(interactions).toBeLessThanOrEqual(INTERACTIONS);
    expect(
      opened.every((path) => path === '/'),
      `pages visited: ${opened.join(', ')}`,
    ).toBe(true);
    expect(problems.filter((problem) => !/status of 4\d\d/u.test(problem))).toEqual([]);

    const record = `ready ${ready} ms, first action ${firstAction} ms (${inPage === null ? 'n/a' : `${Math.round(inPage)} ms in the page`}), research started ${total} ms, ${interactions} interactions`;
    info.annotations.push({ type: 'time to first action', description: record });
    console.log(`first use: ${record}`);

    // A question alone is not an error where nothing can search: it waits for a source, which the person can give.
    await expect(page.locator('[data-moment]')).toHaveText('Needs a source', { timeout: 120_000 });
  });

  test('is done from the keyboard alone, from a cold load to the press that asks', async ({
    page,
  }) => {
    await aServerThatResearchesAndCannotSearch(page);
    await openAsk(page);

    // From the top of the page: the skip link, the bar, and the question, which is the first thing in the page.
    let stops = 0;
    do {
      stops += 1;
      expect(stops, 'tab stops before the question').toBeLessThanOrEqual(10);
      await page.keyboard.press('Tab');
    } while (!(await questionBox(page).evaluate((box) => box === document.activeElement)));
    await page.keyboard.insertText(HARBOUR_QUESTION);

    // What can be said beside it, in reading order, each one stop: the website, how far ahead, research, the tools.
    const order = [
      siteBox(page),
      page.getByRole('radio', { name: 'Not sure' }),
      researchSwitch(page),
      page.getByRole('button', { name: /^Evidence\b/u }),
      advancedButton(page),
      optionsButton(page),
      exploreButton(page),
    ];
    for (const control of order) {
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(reviewHeading(page)).toBeVisible();
    // The press that reads is what asks: the scenario is where the keyboard is.
    await expect(reviewHeading(page)).toBeFocused();
  });

  test('can be asked from the question box with Ctrl+Enter, and from the website field', async ({
    page,
  }) => {
    await aServerThatResearchesAndCannotSearch(page);
    await openAsk(page);
    await questionBox(page).fill(HARBOUR_QUESTION);
    await siteBox(page).fill('harbour.example.org');
    await siteBox(page).press('Control+Enter');
    await expect(reviewHeading(page)).toBeVisible();
    await expect(
      page.getByText(
        'Automatic research is on. After you continue, Swarm reads harbour.example.org and the pages it links to, and lists every page it reads.',
      ),
    ).toBeVisible();
  });
});

test.describe('the website a person names', () => {
  test('is understood as a site or as a page, and a mistake is met with a hint and not with a refusal from the server', async ({
    page,
  }) => {
    await aServerThatResearchesAndCannotSearch(page);
    await openAsk(page);
    await expect(siteBox(page)).toBeEnabled();
    await questionBox(page).fill(HARBOUR_QUESTION);

    await siteBox(page).fill('https://Harbour.Example.org/');
    await expect(page.getByText('Site', { exact: true })).toBeVisible();
    await siteBox(page).fill('harbour.example.org/fees/2025');
    await expect(page.getByText('Page', { exact: true })).toBeVisible();

    // Nothing is fetched by the page, whatever is typed: only its own server is ever called.
    const outside: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== new URL(page.url()).origin) outside.push(request.url());
    });
    await siteBox(page).fill('harbour');
    await questionBox(page).click();
    await expect(page.getByText(/does not look like a website yet/u)).toBeVisible();
    await exploreButton(page).click();
    await expect(siteBox(page)).toBeFocused();
    await expect(reviewHeading(page)).toHaveCount(0);
    expect(outside).toEqual([]);
  });

  test('is out of reach where research is off, and says why, with the switch', async ({ page }) => {
    await aServerThatResearchesAndCannotSearch(page);
    await openAsk(page);
    await researchSwitch(page).click();
    await expect(researchSwitch(page)).not.toBeChecked();
    await expect(page.getByText('Manual sources only: Swarm reads what you add.')).toBeVisible();
    await expect(siteBox(page)).toBeDisabled();
    await expect(page.getByText('used by automatic research', { exact: true })).toBeVisible();
    await expect(page.getByText('Used by automatic research, which is off.')).toBeVisible();
  });
});

test.describe('what the page claims, by what the server says it can do', () => {
  test('promises a search for sources only where a search provider is behind the server', async ({
    page,
  }) => {
    await told(page, { research: true, discovery: false });
    await openAsk(page);
    await expect(page.getByText('Reads the site you name, or asks for one.')).toBeVisible();
    await expect(page.getByText(/finds and reads public sources/u)).toBeHidden();

    const searching = await page.context().newPage();
    await told(searching, { research: true, discovery: true });
    await openAsk(searching);
    await expect(
      searching.getByText('Swarm finds and reads public sources for you.'),
    ).toBeVisible();
    await searching
      .getByRole('list', { name: 'How Swarm works' })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(
      searching
        .getByRole('region', { name: 'How Swarm works' })
        .getByText(/^Swarm\s+finds and reads public sources/u),
    ).toBeVisible();

    // And in the review, for the question alone: it says what is to come, and no more.
    await questionBox(searching).fill(HARBOUR_QUESTION);
    await readScenario(searching);
    await expect(searching.getByText(FOR_A_QUESTION_ALONE.searches)).toBeVisible();
    await questionBox(page).fill(HARBOUR_QUESTION);
    await readScenario(page);
    await expect(page.getByText(FOR_A_QUESTION_ALONE.cannot)).toBeVisible();
  });

  test('draws four signals and four steps of what Swarm does, and five where constraints are kept', async ({
    page,
  }) => {
    await told(page, { constraints: false });
    await openAsk(page);
    const signals = page.getByRole('list', { name: 'What every exploration includes' });
    await expect(signals.getByRole('listitem')).toHaveText([
      'Evidence linked',
      'Assumptions visible',
      'Alternatives compared',
      'Human approval before simulation',
    ]);
    await expect(
      page.getByRole('list', { name: 'How Swarm works' }).getByRole('button').nth(2),
    ).toHaveAccessibleName('People');

    const kept = await page.context().newPage();
    await told(kept, { research: true, constraints: true });
    await openAsk(kept);
    await expect(
      kept.getByRole('list', { name: 'What every exploration includes' }).getByRole('listitem'),
    ).toHaveText([
      'Evidence linked',
      'Assumptions visible',
      'Alternatives compared',
      'Constraints considered',
      'Human approval before simulation',
    ]);
    await expect(
      kept.getByRole('list', { name: 'How Swarm works' }).getByRole('button').nth(2),
    ).toHaveAccessibleName('People and constraints');
  });

  test('says what Swarm does at each step, and what the person controls, when a step is pressed or reached by the arrows', async ({
    page,
  }) => {
    await told(page, { research: true, constraints: true });
    await openAsk(page);
    const steps = page.getByRole('list', { name: 'How Swarm works' }).getByRole('button');
    const flow = page.getByRole('region', { name: 'How Swarm works' });
    await steps.nth(1).click();
    await expect(steps.nth(1)).toHaveAttribute('aria-expanded', 'true');
    // Told that it researches and has no search provider, which is how a server is today: what is read is what is named.
    await expect(
      flow.getByText(/^Swarm\s+reads the website you name and the files you add/u),
    ).toBeVisible();
    await expect(
      flow.getByText(
        /^You\s+name a site to start from and add your own files; see every source it used\./u,
      ),
    ).toBeVisible();
    await expect(flow.getByText(/finds and reads public sources/u)).toBeHidden();

    await steps.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(steps.nth(2)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(flow.getByText(/^Swarm\s+proposes who matters/u)).toBeVisible();
    await expect(
      flow.getByText(/^You\s+review, edit and approve them before any simulation runs/u),
    ).toBeVisible();
  });
});

for (const theme of ['light', 'dark', 'high-contrast'] as const) {
  test(`the first screen is clean in the ${theme} theme where research and constraints are on, and holds at every size`, async ({
    page,
  }) => {
    await told(page, { research: true, constraints: true });
    await openAsk(page, { theme });
    await atRest(page);
    await expectNoAxeViolations(page, `${theme}: research and constraints on`);
    for (const size of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await expectNoHorizontalOverflow(page);
      await expect(exploreButton(page)).toBeVisible();
      await expect(questionBox(page)).toBeInViewport();
      await expect(exploreButton(page)).toBeInViewport({
        ratio: 1,
      });
    }
  });
}

test.describe('templates and the demonstration are quiet', () => {
  test('the page does not look like a demonstration launcher: one link, after everything that matters', async ({
    page,
  }) => {
    await openAsk(page);
    await expect(
      page.getByRole('button', { name: /^Try a (?:recorded demonstration|sample case)$/u }),
    ).toHaveCount(1);
    await expect(page.getByText(/demonstration|demo\b/iu)).toHaveCount(0);
    const [link, action] = await Promise.all([
      page.getByRole('button', { name: /^Try a/u }).boundingBox(),
      exploreButton(page).boundingBox(),
    ]);
    expect(link!.y, 'the link is below the one action').toBeGreaterThan(action!.y + action!.height);
  });

  test('a template fills the box to be written over, and a question that is only the template is not read', async ({
    page,
  }) => {
    await told(page, { research: true });
    await openAsk(page);
    await templatesList(page).getByRole('button', { name: 'Product launch' }).click();
    await expect(questionBox(page)).toHaveValue(/^What could happen if we launch \[/u);
    await exploreButton(page).click();
    await expect(
      page.getByText(/^Replace \[a product, service or programme\] with your own words\.$/u),
    ).toBeVisible();
    await expect(reviewHeading(page)).toHaveCount(0);
  });
});
