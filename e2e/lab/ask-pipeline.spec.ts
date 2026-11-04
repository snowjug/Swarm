import { expect, test, type Page } from '@playwright/test';
import { defaultConfidenceBasis, type Stakeholder } from '../../shared/stakeholders';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  watchPage,
} from '../support/helpers';
import { expectScene, step } from '../support/app';
import {
  CITY_BRIEFING,
  CITY_QUESTION,
  PACKS,
  actorsOf,
  claimsAgainst,
  getJson,
  isQuotedFrom,
  kindsOfCall,
  liveStakeholders,
  pipelineCalls,
  readPages,
  recordApi,
  squash,
  stakeholdersOf,
  textsOf,
  type ApiCall,
  type Pack,
} from '../support/lab-api';
import {
  POSITIONING,
  addPage,
  answerQuestion,
  chooseExample,
  editText,
  escapeRegExp,
  expectAttached,
  expectNothingClipped,
  groundIt,
  openAsk,
  part,
  pasteSource,
  pill,
  question,
  questionBox,
  readScenario,
  scenarioOf,
} from '../support/ask';

// The product's completion test for its first three scenes. The same pipeline, on the rules-mode server and through the
// real pages, has to serve the flagship demonstrations and a question that none of them knows, with a public page as
// evidence: the question and the evidence go in, and everything after, the scenario, the stakeholders and the actors,
// is made by code that knows no domain. Nothing here needs a model.
//
// The server (backend/test/support/lab-e2e-server.ts) is the real application. The pages a person fetches are fixtures
// on this machine that appear as public hosts, so the real fetcher, with all of its checks, is what reads them, and no
// page on the internet is reached.

const WEB = process.env.E2E_LAB_WEB_URL ?? 'http://127.0.0.1:3117';
/** What the person says would count as a good outcome, in answer to the question the reading asks. */
const SUCCESS =
  'That people can carry on as they do now and no complaint reaches the decision makers';
const PERIOD = 'the first twelve months';

test.use({ baseURL: WEB, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

interface Outcome {
  pack: Pack;
  project: string;
  calls: ApiCall[];
  stakeholders: Stakeholder[];
  quotes: string[];
}

const stored = (page: Page, project: string) =>
  getJson<{ documents: { name: string; content: string }[] }>(page, `/api/projects/${project}`);

/** A stakeholder as the list of the Map shows it: a button whose name begins with the stakeholder's own. */
const inList = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}\\s`, 'u') }).first();

async function toMap(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Map the stakeholders' }).click();
  await expectScene(page, 'map');
}

async function findStakeholders(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Find who is affected' }).click();
  await expect(page.getByText('Stakeholders found. They are on the map.')).toBeAttached({
    timeout: 60_000,
  });
}

/** The pill that says the actors are made. The one that is leaving while it arrives is not it. */
const ready = (page: Page) =>
  page.getByRole('group', { name: 'Next' }).filter({ hasText: /actors? ready/u });

async function approve(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Approve & create actors' }).click();
  await expect(ready(page)).toBeVisible({ timeout: 60_000 });
}

/** One person's whole way from the first screen to the actors, with what is checked at each step. */
async function journeyToActors(
  page: Page,
  pack: Pack,
): Promise<{ outcome: Outcome; seen: string[] }> {
  const problems = watchPage(page);
  const calls = recordApi(page);
  const fetched: { name: string; url: string }[] = [];
  const seen: string[] = [];
  let attached = 0;

  await test.step('landing: what Swarm answers, and what it is not', async () => {
    await openAsk(page);
    await expect(page.getByText(POSITIONING, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Local rules' })).toBeVisible();
  });

  await test.step('question and evidence: an example, typed words, pasted text, a public page', async () => {
    if (pack.example) {
      await chooseExample(page, pack.example);
      attached += pack.example.documents.length;
    } else {
      await questionBox(page).fill(pack.question);
    }
    for (const source of pack.pasted) {
      await pasteSource(page, source.name, source.content);
      attached += 1;
    }
    for (const address of pack.urls) {
      fetched.push(await addPage(page, address));
      attached += 1;
    }
    await expectAttached(page, attached);
    await expect(questionBox(page)).toHaveValue(pack.question);
  });

  await test.step('scenario: read from the question, checked and edited by the person', async () => {
    await readScenario(page);
    const decision = await page.getByRole('heading', { level: 2 }).first().innerText();
    expect(decision).toMatch(pack.about);

    await editText(page, 'Over what time', PERIOD);
    // A way is added after those that were read, whatever their number, and named in place.
    const read = await part(page, 'Ways to do it')
      .getByRole('button', { name: /^Alternative \d+ name:/u })
      .count();
    await page.getByRole('button', { name: 'Add a way' }).click();
    const way = page.getByRole('textbox', { name: `Alternative ${read + 1} name`, exact: true });
    await way.fill(pack.alternative);
    await way.press('Enter');
    const group = part(page, 'Who is affected').getByRole('textbox', { name: 'Add to group' });
    await group.fill(pack.group);
    await group.press('Enter');
    if (await question(page, 'good outcome').count()) {
      await answerQuestion(page, 'good outcome', SUCCESS);
    } else {
      await page.getByRole('button', { name: 'Add an assumption' }).click();
      const assumption = page.getByRole('textbox', { name: /^Assumption \d+$/u });
      await assumption.fill(`Success is judged by: ${SUCCESS}`);
      await assumption.press('Control+Enter');
    }

    // The scenario the person has just edited is usable as it stands. These are looked at and reported when the
    // journey is over, so that what is wrong with the page does not stop the journey from being followed.
    const softly = async (what: string, check: () => Promise<void>) => {
      try {
        await check();
      } catch (error) {
        const lines = (error as Error).message.split('\n');
        const found = lines.filter((line) => /^\s*\+\s+"/u.test(line)).map((line) => line.trim());
        seen.push(`${what}: ${lines[0]} ${found.join(' ')}`.trim());
      }
    };
    await softly('axe', () => expectNoAxeViolations(page, `${pack.title}: the scenario`));
    await softly('overflow', () => expectNoHorizontalOverflow(page));
    await softly('clipped', () => expectNothingClipped(page, `${pack.title}: the scenario`));
    await softly('readable', () => expectReadableText(page, `${pack.title}: the scenario`));
    await softly('targets', () => expectTargetSizes(page, `${pack.title}: the scenario`));
  });

  const project =
    await test.step('ground: every document is in the evidence, and the project says it is ready', async () => {
      const id = await groundIt(page);
      const sources = page.getByRole('list', { name: 'Sources' });
      await expect(page.getByRole('status').filter({ hasText: /^Ready\./u })).toContainText(
        new RegExp(`Ready\\. ${attached} sources?`, 'u'),
        { timeout: 60_000 },
      );
      await expect(sources.getByRole('listitem')).toHaveCount(attached);
      for (const { name } of (await stored(page, id)).documents) {
        // A source row names itself by its number and its name ("D1 01-it-office-brief.md"): the name is what is looked for.
        await expect(
          sources.getByRole('listitem').filter({ hasText: name }).first(),
          name,
        ).toBeVisible();
      }
      return id;
    });

  const documents = (await stored(page, project)).documents;
  const quotes: string[] = [];

  const first =
    await test.step('stakeholders: found in the evidence, each with the passage it came from', async () => {
      await toMap(page);
      await findStakeholders(page);
      await expect(
        page.getByText('Actors are synthetic stand-ins, not real people', { exact: false }).first(),
      ).toBeVisible();

      const live = liveStakeholders(await stakeholdersOf(page, project));
      expect(live.length, 'enough stakeholders for a comparison').toBeGreaterThanOrEqual(3);
      const cited = live.filter((stakeholder) => stakeholder.evidence.length > 0);
      expect(cited.length, 'stakeholders that cite a passage').toBeGreaterThanOrEqual(2);
      for (const stakeholder of live) {
        for (const reference of stakeholder.evidence) {
          expect(
            isQuotedFrom(reference.quote ?? '', documents),
            `${stakeholder.name}: "${reference.quote}" is not word for word in the evidence`,
          ).toBe(true);
          quotes.push(reference.quote ?? '');
        }
      }

      // What the person said in the scenario is a stakeholder of its own, and says where it came from.
      expect(live.some((stakeholder) => stakeholder.origin === 'scenario')).toBe(true);
      expect(live.map((stakeholder) => stakeholder.name.toLowerCase())).toContain(
        pack.group.toLowerCase(),
      );

      // The list of the Map has every one of them, by name, and says what each rests on: quotes of the evidence.
      await page.getByRole('radio', { name: 'List' }).click();
      await expect(page).toHaveURL(/[?&]view=list(?:&|$)/u);
      for (const stakeholder of live) {
        await expect(inList(page, stakeholder.name), stakeholder.name).toBeVisible();
      }
      await expect(inList(page, cited[0]!.name)).toContainText(/\d+ quotes?/u);

      // The evidence is in the page: one stakeholder's quotes are opened and read there. One whose name is not the
      // start of another's is chosen, so that the row pressed is the one meant.
      const alone = (stakeholder: Stakeholder) =>
        !live.some(
          (other) =>
            other !== stakeholder &&
            other.name.toLowerCase().startsWith(stakeholder.name.toLowerCase()),
        );
      const chosen =
        cited.find((stakeholder) => stakeholder.priority === 'key' && alone(stakeholder)) ??
        cited.find(alone) ??
        cited[0]!;
      await inList(page, chosen.name).click();
      const inspector = page.getByRole('complementary', { name: chosen.name, exact: true });
      await expect(inspector).toBeVisible();
      const shown = await inspector.locator('blockquote').allInnerTexts();
      expect(shown.length).toBeGreaterThan(0);
      for (const text of shown) {
        expect(isQuotedFrom(text.replace(/^[“"]|[”"]$/gu, ''), documents), text).toBe(true);
      }
      return chosen;
    });

  await test.step('actors: approved by the person, synthetic, one for each stakeholder', async () => {
    await approve(page);
    await expect(ready(page)).toContainText('Synthetic stand-ins');
    const cast = (await actorsOf(page, project)).actors?.actors ?? [];
    const approved = liveStakeholders(await stakeholdersOf(page, project));
    expect(cast.map((actor) => actor.stakeholderId).sort()).toEqual(
      approved.map((stakeholder) => stakeholder.id).sort(),
    );
    expect(approved.map((stakeholder) => stakeholder.id)).toContain(first.id);
    // Every number an actor carries says where it came from.
    for (const actor of cast) {
      expect(actor.traits.impact.origin, actor.name).toBeTruthy();
    }
  });

  await test.step('reload: nothing is lost, and the journey says how far the person got', async () => {
    await page.reload();
    await expectScene(page, 'map');
    await expect(ready(page)).toBeVisible();
    await expect(step(page, 'simulate')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(step(page, 'compare')).toHaveAttribute('aria-disabled', 'true');
  });

  expect(problems, 'what the page logged or failed at').toEqual([]);
  expect(readPages(calls), 'pages read').toBe(pack.urls.length);
  const scenario = (await scenarioOf(page, project)).scenario;
  expect(scenario?.horizon).toBe(PERIOD);
  expect(scenario?.alternatives.map((alternative) => alternative.label)).toContain(
    pack.alternative,
  );
  expect(fetched.map((page_) => page_.url)).toEqual([...pack.urls]);
  return {
    seen,
    outcome: {
      pack,
      project,
      calls,
      stakeholders: liveStakeholders(await stakeholdersOf(page, project)),
      quotes,
    },
  };
}

test.describe('the same pipeline serves every question', () => {
  const FLAGSHIPS = [
    ['teams', 'flagship 1: deeper Copilot integration in Teams'],
    ['aws', 'flagship 2: an AWS regional service-price change'],
    ['shop', 'flagship 3: a public website, customers and a fetched page'],
    ['city', 'flagship 4: a congestion charge, which no example knows'],
  ] as const;

  // One test, because what it proves is a comparison between the four: each journey is the person's own, in a
  // browser of its own, and one that goes wrong is reported where it did and does not stop the others.
  test('no domain is hard-coded: four journeys make the same calls, and different stakeholders from different evidence', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const all: Outcome[] = [];
    const failures: string[] = [];

    for (const [key, label] of FLAGSHIPS) {
      try {
        await test.step(label, async () => {
          const context = await browser.newContext({
            baseURL: WEB,
            viewport: { width: 1440, height: 900 },
            reducedMotion: 'reduce',
          });
          try {
            const { outcome, seen } = await journeyToActors(await context.newPage(), PACKS[key]);
            all.push(outcome);
            if (seen.length) failures.push(`${label}: ${seen.join(' | ')}`);
          } finally {
            await context.close();
          }
        });
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message.split('\n').slice(0, 6).join(' ')}`);
      }
    }
    // The journeys that finished are compared even when something was wrong on the way, and everything that is wrong
    // is reported together at the end.
    expect.soft(all, 'all four journeys finished').toHaveLength(4);
    const [first, ...rest] = all;
    if (first) {
      // What the person asked the application to do is the same, in the same order, whatever the question.
      expect
        .soft(pipelineCalls(first.calls))
        .toEqual([
          'POST /api/scenario/parse',
          'POST /api/projects',
          'POST /api/projects/:id/steps/knowledge',
          'POST /api/projects/:id/stakeholders/propose',
          'POST /api/projects/:id/stakeholders/approve',
          'POST /api/projects/:id/actors/generate',
        ]);
      for (const other of rest) {
        const against = `${other.pack.title} against ${first.pack.title}`;
        expect.soft(pipelineCalls(other.calls), against).toEqual(pipelineCalls(first.calls));
        expect.soft(kindsOfCall(other.calls), against).toEqual(kindsOfCall(first.calls));
      }

      // What each one found is its own: names that no other journey found (a plural is the same name), and quotes
      // that are in its own evidence and nobody else's.
      const stem = (name: string) => name.toLowerCase().replace(/s$/u, '');
      const namesOf = (outcome: Outcome) =>
        outcome.stakeholders.map((stakeholder) => stem(stakeholder.name));
      for (const outcome of all) {
        const elsewhere = new Set(all.filter((other) => other !== outcome).flatMap(namesOf));
        const mine = namesOf(outcome).filter((name) => !elsewhere.has(name));
        expect
          .soft(
            mine.length,
            `${outcome.pack.title} has stakeholders that only its own evidence gives`,
          )
          .toBeGreaterThan(0);
        for (const other of all.filter((candidate) => candidate !== outcome)) {
          expect
            .soft(namesOf(outcome), `${outcome.pack.title} against ${other.pack.title}`)
            .not.toEqual(namesOf(other));
          expect
            .soft(outcome.quotes, `${outcome.pack.title} against ${other.pack.title}`)
            .not.toEqual(other.quotes);
        }
      }
      // Only a person who asks for a page makes the application read one.
      expect
        .soft(all.map((outcome) => readPages(outcome.calls)))
        .toEqual(all.map((outcome) => outcome.pack.urls.length));
    }
    expect(failures, 'what went wrong on the way').toEqual([]);
  });
});

test.describe('the scenario read is optional', () => {
  test('a question and its evidence alone reach the actors, and the project says there was no scenario', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.route('**/api/scenario/parse', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The reader is busy.' } }),
      }),
    );
    const problems = watchPage(page, { refusals: true });
    await openAsk(page);
    await chooseExample(page, PACKS.teams.example);
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await page.getByRole('button', { name: 'Continue without reading' }).click();
    await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
    const project = new URL(page.url()).searchParams.get('project')!;
    expect((await scenarioOf(page, project)).scenario).toBeNull();

    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();
    await toMap(page);
    await findStakeholders(page);
    await approve(page);
    const live = liveStakeholders(await stakeholdersOf(page, project));
    // With no scenario, nothing is a stakeholder because the person said so.
    expect(live.some((stakeholder) => stakeholder.origin === 'scenario')).toBe(false);
    expect((await actorsOf(page, project)).actors?.actors.length).toBe(live.length);
    expect(problems.filter((problem) => !/status of 503/u.test(problem))).toEqual([]);
  });
});

test.describe('the evidence is what discovery reads', () => {
  test.describe.configure({ timeout: 240_000 });

  const REMOVED =
    'Delivery contractors ask whether vans will pay the full charge, and taxi operators ask for the same exemption that buses receive.';
  const ADDED =
    'Independent auditors check the cameras each quarter, and taxi operators ask for the same exemption that buses receive.';

  async function discover(page: Page, content: string): Promise<Stakeholder[]> {
    await openAsk(page);
    await questionBox(page).fill(CITY_QUESTION);
    await pasteSource(page, CITY_BRIEFING.name, CITY_BRIEFING.content);
    if (content !== CITY_BRIEFING.content) {
      await pill(page, CITY_BRIEFING.name).click();
      const sheet = page.getByRole('dialog', { name: CITY_BRIEFING.name });
      await sheet.getByRole('textbox', { name: 'The text Swarm will work from' }).fill(content);
      await sheet.getByRole('button', { name: 'Done' }).click();
    }
    await readScenario(page);
    const project = await groundIt(page);
    await expect(page.getByRole('status').filter({ hasText: /^Ready\./u })).toBeVisible({
      timeout: 60_000,
    });
    await toMap(page);
    await findStakeholders(page);
    return liveStakeholders(await stakeholdersOf(page, project));
  }

  test('editing a source changes which groups are found, and each one is in the words that changed', async ({
    page,
  }) => {
    expect(CITY_BRIEFING.content).toContain(REMOVED);
    const before = await discover(page, CITY_BRIEFING.content);
    const after = await discover(page, CITY_BRIEFING.content.replace(REMOVED, ADDED));
    const names = (list: Stakeholder[]) => new Set(list.map((stakeholder) => stakeholder.name));
    const gone = before.filter((stakeholder) => !names(after).has(stakeholder.name));
    const came = after.filter((stakeholder) => !names(before).has(stakeholder.name));
    // A group that the evidence names carries the passage that names it. One that a role pattern adds (the owner, the
    // other side of a contract, a missing voice) carries none, and says it is an assumption: it can come and go with
    // the text, but it is never a finding.
    const named = (list: Stakeholder[]) =>
      list.filter((stakeholder) => stakeholder.evidence.length > 0);
    expect(
      named(gone).map((stakeholder) => stakeholder.name),
      'groups only the old words gave',
    ).not.toEqual([]);
    expect(
      named(came).map((stakeholder) => stakeholder.name),
      'groups only the new words give',
    ).not.toEqual([]);
    // What disappeared was in the sentence that was taken out, and what appeared is in the sentence that was put in.
    for (const [list, sentence] of [
      [gone, REMOVED],
      [came, ADDED],
    ] as const) {
      for (const stakeholder of named(list)) {
        for (const reference of stakeholder.evidence) {
          expect(squash(sentence), stakeholder.name).toContain(squash(reference.quote ?? ''));
        }
      }
    }
    for (const stakeholder of [...before, ...after]) {
      if (stakeholder.evidence.length === 0) {
        expect(
          defaultConfidenceBasis(stakeholder),
          `${stakeholder.name} rests on no passage`,
        ).not.toBe('source-quote');
      }
    }
  });
});

test.describe('a page that tries to instruct the analysis', () => {
  test('is only text all the way to the stakeholders it is quoted for', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = watchPage(page);
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await openAsk(page);
    await questionBox(page).fill(CITY_QUESTION);
    await addPage(page, 'http://city-transport.example.org/zone-notice');
    await readScenario(page);
    const project = await groundIt(page);
    await toMap(page);
    await findStakeholders(page);

    // A stakeholder was found in the sentence that has markup in it, and the markup is shown as the text it is.
    const quoted = liveStakeholders(await stakeholdersOf(page, project)).find((stakeholder) =>
      stakeholder.evidence.some((reference) => (reference.quote ?? '').includes('<img')),
    );
    expect(quoted, 'a stakeholder quoted from the sentence that has markup in it').toBeDefined();
    await page.getByRole('radio', { name: 'List' }).click();
    await inList(page, quoted!.name).click();
    const inspector = page.getByRole('complementary', { name: quoted!.name });
    await expect(
      inspector.locator('blockquote').filter({ hasText: '<img src=x onerror=' }),
    ).toBeVisible();
    await approve(page);

    // Nothing the page said ran, and none of it became an element.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
    expect(dialogs).toBe(0);
    const said = await textsOf(page.getByRole('main').locator('h1, h2, p'));
    expect(said.flatMap(claimsAgainst), 'what the Map says').toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('what the product may not claim', () => {
  test('is caught: a prediction, and a rate in the world that is not the simulation’s', () => {
    for (const claim of [
      'Conversion will increase by 12% after the change.',
      'Customers will switch to a competitor.',
      'The company is going to lose market share.',
      'The change is expected to raise churn.',
      'It lifts conversion by 8% across the shop.',
      'An adoption rate of 40% is reached within a year.',
    ]) {
      expect(claimsAgainst(claim), claim).not.toEqual([]);
    }
  });

  test('lets through what the product says: simulated counts and shares, seeded runs, and what others wrote', () => {
    for (const fine of [
      'About 22 simulated members ended up looking for an alternative or resisting under “Proposed change”.',
      'The mean share of simulated members looking for an alternative or resisting was about 24 in 100 under “Proposed change” against 1 in 100 under “No change”, counting each simulated actor equally.',
      'In 10 of 10 seeded runs, the share of simulated members looking for an alternative or resisting, counting each actor equally and not each member, reached at least 30 in 100 at some round.',
      'In 10 of 10 seeded runs, at least 30% of simulated members were looking for an alternative.',
      'It does not predict the future, and the counts above are neither rates nor forecasts, and nor are the shares of simulated members.',
      'The poll gives “44%” and the partner’s notes give “16%”.',
      'Moving it by +0.25 changed the outcome measure by -0.03 on the same seeds.',
      'The finding held in 9 of 10 seeded runs (Wilson interval 0.60 to 0.98).',
    ]) {
      expect(claimsAgainst(fine), fine).toEqual([]);
    }
  });
});
