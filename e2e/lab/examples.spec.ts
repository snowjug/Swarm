import { expect, test, type Page } from '@playwright/test';
import { STATEMENT_ORIGINS, type DecisionBrief } from '../../shared/brief';
import type { Stakeholder } from '../../shared/stakeholders';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  watchPage,
} from '../support/helpers';
import {
  CITY_BRIEFING,
  CITY_QUESTION,
  PACKS,
  actorsOf,
  addFetchedPage,
  analysisOf,
  approveAndMakeActors,
  briefDocument,
  briefOf,
  build,
  chooseExample,
  claimsAgainst,
  comparisonPanel,
  compareScenarios,
  editSource,
  editStakeholder,
  expandBrief,
  fetchPage,
  findStakeholders,
  inspectPassage,
  isQuotedFrom,
  kindsOfCall,
  liveStakeholders,
  openReport,
  openRegion,
  openStage,
  openStakeholder,
  pasteSource,
  pipelineCalls,
  questionField,
  readPages,
  readScenario,
  recordApi,
  reviewPanel,
  scenarioIntake,
  seedThroughActors,
  sourceMaterial,
  squash,
  stages,
  stakeholderPanel,
  stakeholdersOf,
  ownWordsOf,
  textsOf,
  urlPanel,
  type ApiCall,
  type FetchedPage,
  type Pack,
} from '../support/lab';

// The product's completion test. The same pipeline, on the rules-mode server and through the real
// pages, has to serve the flagship demonstrations and a question that none of them knows, with a public
// page as evidence: the question and the evidence go in, and everything else, the scenario, the
// stakeholders, the actors, the comparison, the critique and the brief, is made by code that knows no
// domain. Nothing here needs a model.
//
// The server (backend/test/support/lab-e2e-server.ts) is the real application. The pages a person
// fetches are fixtures on this machine that appear as public hosts, so the real fetcher, with all of
// its checks, is what reads them, and no page on the internet is reached.

const WEB = process.env.E2E_LAB_WEB_URL ?? 'http://127.0.0.1:3117';
const FIXTURES = process.env.E2E_LAB_WEB_FIXTURE_URL ?? 'http://127.0.0.1:3118';
/** What the person says would count as a good outcome, in answer to the question the reading asks. */
const SUCCESS =
  'That people can carry on as they do now and no complaint reaches the decision makers';

test.use({ baseURL: WEB, viewport: { width: 1440, height: 900 } });

interface Outcome {
  pack: Pack;
  project: string;
  calls: ApiCall[];
  stakeholders: Stakeholder[];
  findings: string[];
  briefText: string;
}

/** One person's whole way from the first screen to the brief, with what is checked at each step. */
async function journey(page: Page, pack: Pack): Promise<Outcome> {
  const problems = watchPage(page);
  const calls = recordApi(page);
  const documents: { name: string; content: string }[] = [];
  const fetched: FetchedPage[] = [];

  await test.step('landing: what Swarm answers, and what it is not', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('What could happen if…?');
    await expect(
      page.getByText(
        'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText('LOCAL / RULES MODE')).toBeVisible();
  });

  await test.step('question and evidence: an example, typed words, pasted text, a public page', async () => {
    if (pack.example) {
      await chooseExample(page, pack.example);
      documents.push(...pack.example.documents.map(({ name, content }) => ({ name, content })));
    } else {
      await questionField(page).fill(pack.question);
    }
    for (const source of pack.pasted) {
      await pasteSource(page, source.name, source.content);
      documents.push(source);
    }
    for (const address of pack.urls) {
      const answer = await fetchPage(page, address);
      expect(answer.status(), `fetching ${address}`).toBe(200);
      const document = await addFetchedPage(page, answer);
      expect(document.provenance).toMatchObject({ kind: 'url', fetchedByServer: true });
      fetched.push(document);
      documents.push(document);
    }
    await expect(sourceMaterial(page)).toContainText(`${documents.length}/10 FILES`);
    await expect(questionField(page)).toHaveValue(pack.question);
  });

  await test.step('scenario: read from the question, checked and edited by the person', async () => {
    const decision = await readScenario(page, {
      period: 'the first twelve months',
      alternative: pack.alternative,
      group: pack.group,
      success: SUCCESS,
    });
    expect(decision).toMatch(pack.about);
    // The form the person has just filled in, with the scenario used, is usable as it stands.
    await expectNoAxeViolations(page, `${pack.title}: the entry form with its scenario`);
    await expectNoHorizontalOverflow(page);
    await expectReadableText(page, `${pack.title}: the entry form`);
    await expectTargetSizes(page, `${pack.title}: the entry form`);
  });

  const project =
    await test.step('build: the source graph, with every document in it', async () => {
      const id = await build(page);
      await expect(page.locator('.stats-grid').filter({ hasText: 'SOURCE FILES' })).toContainText(
        String(documents.length),
      );
      for (const document of documents) {
        const name = new RegExp(document.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u');
        await expect(page.getByRole('button', { name })).toBeVisible();
      }
      return id;
    });

  const edited =
    await test.step('stakeholders: found in the evidence, each with the passage it came from', async () => {
      await openStage(page, /Env Setup/u);
      await findStakeholders(page);
      const panel = stakeholderPanel(page);
      await expect(panel).toContainText('Found by reading the text, not by a model');
      await expect(panel).toContainText('not real people');

      const live = liveStakeholders(await stakeholdersOf(page, project));
      expect(live.length, 'enough stakeholders for a comparison').toBeGreaterThanOrEqual(3);
      for (const stakeholder of live) {
        await expect(
          panel.getByRole('listitem', { name: stakeholder.name, exact: true }),
        ).toBeVisible();
        for (const reference of stakeholder.evidence) {
          expect(
            isQuotedFrom(reference.quote ?? '', documents),
            `${stakeholder.name}: "${reference.quote}" is not word for word in the evidence`,
          ).toBe(true);
        }
      }
      const cited = live.filter((stakeholder) => stakeholder.evidence.length > 0);
      expect(cited.length, 'stakeholders that cite a passage').toBeGreaterThanOrEqual(2);

      // The evidence is in the page: one stakeholder's quotes are opened and read there.
      const first = cited[0]!;
      const row = await openStakeholder(page, first.name);
      await expect(row.locator('blockquote').first()).toBeVisible();

      // What the person said in the scenario is a stakeholder of its own, and says where it came from.
      expect(live.some((stakeholder) => stakeholder.origin === 'scenario')).toBe(true);
      return cited.find((stakeholder) => stakeholder.priority === 'key') ?? first;
    });

  await test.step('review: the person changes one stakeholder, and the change is theirs', async () => {
    await editStakeholder(page, edited.name, {
      why: `Edited in the ${pack.title} journey.`,
      direction: 'harmed',
      because: 'The person judges that the change costs this group more than it gives.',
    });
    const after = (await stakeholdersOf(page, project)).stakeholders?.stakeholders ?? [];
    const changed = after.find((stakeholder) => stakeholder.id === edited.id);
    expect(changed?.status).toBe('edited');
    expect(changed?.expectedImpact.origin).toBe('user');
    await expect(stakeholderPanel(page)).toContainText(/1 edited by you/u);
  });

  await test.step('actors: approved by the person, synthetic, every trait with an origin', async () => {
    await approveAndMakeActors(page);
    const panel = stakeholderPanel(page);
    await expect(panel.getByRole('region', { name: 'Actors' })).toContainText(
      'These actors are synthetic',
    );
    const cast = (await actorsOf(page, project)).actors?.actors ?? [];
    const approved = liveStakeholders(await stakeholdersOf(page, project));
    expect(cast.map((actor) => actor.stakeholderId).sort()).toEqual(
      approved.map((stakeholder) => stakeholder.id).sort(),
    );
    const mine = cast.find((actor) => actor.stakeholderId === edited.id);
    expect(mine?.traits.impact.origin, 'the person set this actor’s impact').toBe('user');
    expect(mine?.traits.impact.value).toBeLessThan(0);
    await expect(panel.getByRole('listitem', { name: edited.name, exact: true })).toBeVisible();
  });

  await test.step('comparison: the baseline, the proposed change, an alternative and an intervention', async () => {
    await openStage(page, /Simulation/u);
    await compareScenarios(page, { runs: '10', intervention: pack.intervention });
    const panel = comparisonPanel(page);
    for (const heading of [
      'What this comparison says',
      'The spread of outcomes',
      'What held across the seeded runs',
      'Which assumptions the result is sensitive to',
      'Second-order effects in one typical run',
      'How far to rely on this',
    ]) {
      await expect(panel.getByRole('heading', { name: heading })).toBeVisible();
    }
    await expect(panel).toContainText('none of it is a rate of anything real');
    await expect(panel).toContainText('0 model calls');
    const analysis = await analysisOf(page, project);
    const labels = analysis.config.variants.map((variant) => variant.label);
    // The question may bring alternatives of its own, so the person's two are found by name: the one
    // from the scenario somewhere among them, the intervention they designed here last.
    expect(labels.slice(0, 2)).toEqual(['No change', 'Proposed change']);
    expect(labels).toContain(pack.alternative);
    expect(labels.at(-1)).toBe(pack.intervention.name);
    const mine = analysis.config.variants.find(
      (variant) => variant.label === pack.intervention.name,
    );
    expect(mine).toMatchObject({ kind: 'alternative', round: 4, intensity: 0.3 });
    expect(mine?.description).toContain('was set by you');
    expect(analysis.fidelity.engine).toBe('rules');
    expect(analysis.findings.length).toBeGreaterThan(0);
    expect(analysis.sensitivity.length).toBeGreaterThan(0);
    // The spread, the stability of what held and the sensitivity are each in the page, with their words.
    await expect(panel.getByText(/95% interval \d+–\d+%/u).first()).toBeVisible();
    await expect(
      panel.getByText(/^(?:Repeatable|Mostly repeatable|Unstable|Rare)/u).first(),
    ).toBeVisible();
    const strongest = [...analysis.sensitivity].sort(
      (a, b) => Math.abs(b.shift) - Math.abs(a.shift),
    )[0]!;
    await expect(panel.getByText(strongest.label, { exact: false }).first()).toBeVisible();
    const chain = panel.getByRole('heading', { name: 'Second-order effects in one typical run' });
    await expect(chain.locator('xpath=..')).toContainText(/Because|No simulated follow-on events/u);
    // What the page says of its results counts simulated members and seeded runs, and predicts nothing.
    const said = await textsOf(panel.locator('p, li'));
    expect(said.flatMap(claimsAgainst), 'what the comparison says').toEqual([]);
    await expectNoAxeViolations(page, `${pack.title}: the comparison`);
    await expectReadableText(page, `${pack.title}: the comparison`);
  });

  const analysed = await analysisOf(page, project);
  const findings = analysed.findings.map((finding) => finding.statement);
  // Each finding about a group is about one of this journey's own actors, and says its name.
  const cast = new Map(analysed.actors.map((actor) => [actor.id, actor]));
  for (const finding of analysed.findings.filter((candidate) => candidate.actorId !== null)) {
    const actor = cast.get(finding.actorId ?? '');
    expect(actor, `the actor of finding "${finding.statement}"`).toBeDefined();
    expect(finding.statement.toLowerCase()).toContain((actor?.name ?? '').toLowerCase());
  }

  await test.step('critique: an independent review that challenges the comparison', async () => {
    await openReport(page);
    const review = reviewPanel(page);
    await review.getByRole('button', { name: 'Run independent review', exact: true }).click();
    await expect(review.getByRole('heading', { name: 'What the review found' })).toBeVisible();
    await expect(review).toContainText('Deterministic checks only');
    await expect(review).toContainText('A criticism is a challenge, not a verdict');
    const first = review.getByRole('article').first();
    await expect(first).toContainText('What it rests on');
    await expect(first).toContainText('Effect on the conclusion, if it stands');
    await first.getByText('Respond to this criticism').click();
    await first
      .getByLabel('Your response', { exact: true })
      .fill('Noted: the person will check this against the evidence.');
    await first.getByRole('button', { name: 'Respond', exact: true }).click();
    await expect(first).toContainText('Responded');
  });

  const briefText =
    await test.step('decision brief: the answer first, every statement labelled', async () => {
      await page.getByRole('button', { name: 'Generate decision brief' }).click();
      const brief = briefDocument(page);
      await expect(brief).toBeVisible();
      // The reference sections are closed when the page opens; these checks read all of them.
      await expandBrief(page);
      await expect(brief.getByRole('heading', { level: 3 }).first()).toHaveText('Executive answer');
      const answer = brief.locator('.brief-answer');
      await expect(answer.locator('.brief-headline')).toContainText(/simulated members/u);
      await expect(answer.locator('.brief-headline')).toContainText(/seeded runs/u);
      await expect(answer).toContainText('neither rates nor forecasts');
      await expect(answer).toContainText('Produced by: Rules');
      await expect(brief).toContainText('It does not predict the future');

      expect(await brief.locator('li.brief-statement').count(), 'statements').toBeGreaterThan(20);
      await expect(brief.locator('li.brief-statement:not(:has(.brief-origin))')).toHaveCount(0);
      expect((await textsOf(brief.locator('.brief-text'))).flatMap(claimsAgainst)).toEqual([]);
      expect((await briefOf(page, project)).brief?.question).toBe(pack.question);

      // Who did what is said as it was: the person changed one stakeholder and removed none, set the
      // intervention, and what the pages said is labelled as retrieved, not as supplied.
      await expect(brief).not.toContainText('The person removed');
      const statements = brief.locator('li.brief-statement');
      // What the person wrote into the scenario is in the brief as theirs, and is not listed as open.
      const scenario = statements.filter({ has: page.locator('.brief-origin-user-assumption') });
      await expect(scenario.filter({ hasText: 'horizon “the first twelve months”' })).toHaveCount(
        1,
      );
      await expect(
        scenario.filter({ hasText: `Alternative named in the scenario: “${pack.alternative}”` }),
      ).toHaveCount(1);
      await expect(brief).not.toContainText('does not say over what period to look');
      await expect(brief).not.toContainText('does not name the groups that are affected');
      await expect(brief).not.toContainText('does not say how a good outcome would be judged');
      // The answer the person gave to a question is one of the scenario's assumptions, and theirs.
      await expect(
        scenario.filter({ hasText: `Scenario assumption “Success is judged by: ${SUCCESS}”` }),
      ).not.toHaveCount(0);
      const own = statements.filter({ hasText: `“${edited.name}”` });
      await expect(own.locator('.brief-origin-user-assumption').first()).toBeVisible();
      const setByPerson = statements
        .filter({ has: page.locator('.brief-origin-user-assumption') })
        .filter({
          hasText: `“${pack.intervention.name}” (alternative, lands in round 4 at strength 0.30`,
        });
      await expect(setByPerson).toHaveCount(1);
      const retrieved = statements.filter({
        has: page.locator('.brief-origin-retrieved-public-evidence'),
      });
      if (pack.urls.length === 0) {
        await expect(retrieved).toHaveCount(0);
      } else {
        for (const document of fetched) {
          await expect(
            retrieved.filter({ hasText: document.provenance.url ?? '' }),
          ).not.toHaveCount(0);
        }
      }
      // The answer keeps its own statements behind "How this answer is made", so only what is on show counts.
      await expect(
        brief
          .locator('li.brief-statement:visible')
          .filter({ has: page.locator('.brief-origin-supplied-evidence') })
          .first(),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `${pack.title}: the brief`);
      await expectTargetSizes(page, `${pack.title}: the brief`);
      return (await textsOf(brief)).join('\n');
    });

  await test.step('recommendations and a validation plan: what to do, and how to check it in the world', async () => {
    const brief = briefDocument(page);
    const recommendations = brief.getByRole('region', { name: 'Recommendations', exact: true });
    expect(await recommendations.locator('tbody tr').count(), 'recommendations').toBeGreaterThan(0);
    await expect(recommendations.locator('tbody tr:not(:has(.brief-origin))')).toHaveCount(0);
    const plan = brief.getByRole('region', { name: 'Validation plan', exact: true });
    await expect(plan).toContainText('none of which has been run');
    expect(await plan.locator('tbody tr').count(), 'real-world checks').toBeGreaterThan(0);
    const cells = brief.locator('.brief-recommendations tbody td, .brief-validation tbody td');
    // A figure in a passage quoted from a source is the source's, so only the brief's own words are read.
    expect((await ownWordsOf(cells)).flatMap(claimsAgainst)).toEqual([]);
  });

  await test.step('export: the brief can be taken away, as Markdown, as JSON and as a printable page', async () => {
    const brief = briefDocument(page);
    const read = async (name: string) => {
      const href = await brief.getByRole('link', { name }).getAttribute('href');
      return page.request.get(href ?? '/missing');
    };
    const markdown = await read('Markdown');
    expect(markdown.status()).toBe(200);
    expect(markdown.headers()['content-disposition']).toContain('attachment');
    const text = await markdown.text();
    expect(text).toContain('It does not predict the future');
    expect(text).toContain('none is a measured population rate');
    expect(text).toMatch(/\*\*Simulation aggregation/u);

    const json = await read('JSON');
    expect(json.status()).toBe(200);
    const { brief: exported } = (await json.json()) as { brief: DecisionBrief };
    const statements = exported.sections.flatMap((section) => section.statements);
    expect(statements.length).toBeGreaterThan(20);
    for (const statement of statements) expect(STATEMENT_ORIGINS).toContain(statement.origin);
    expect(statements.flatMap((statement) => claimsAgainst(statement.text))).toEqual([]);

    const printable = await read('Printable');
    expect(printable.status()).toBe(200);
    expect(printable.headers()['content-type']).toContain('text/html');
    expect(printable.headers()['content-security-policy']).toContain("default-src 'none'");
  });

  await test.step('inspect: the evidence and the assumption behind a statement', async () => {
    const brief = briefDocument(page);
    // The answer keeps its own statements behind "How this answer is made", so only what is on show counts.
    const statements = brief.locator('li.brief-statement:visible');
    const evidence = statements
      .filter({ has: page.locator('.brief-origin-supplied-evidence') })
      .filter({ has: page.locator('details.brief-refs q') })
      .first();
    await evidence.getByText(/^What this rests on/u).click();
    const passage = evidence
      .locator('details.brief-refs li')
      .filter({ has: page.locator('q') })
      .first();
    const quote = (await passage.locator('q').textContent()) ?? '';
    const id = (await passage.locator('code').textContent()) ?? '';
    expect(isQuotedFrom(quote, documents), `"${quote}" is in the evidence`).toBe(true);

    const assumption = statements
      .filter({ has: page.locator('.brief-origin-system-assumption') })
      .filter({ has: page.locator('details.brief-refs') })
      .first();
    await assumption.getByText(/^What this rests on/u).click();
    await expect(assumption.locator('details.brief-refs')).toContainText(
      /Assumption|Seeded runs of|Finding/u,
    );

    // The passage the brief cites is the one the evidence browser holds under that id.
    await inspectPassage(page, id, quote);
  });

  await test.step('reload: nothing is lost, and the stages say how far the person got', async () => {
    const headline = (await briefOf(page, project)).brief?.headline ?? '';
    expect(headline.length).toBeGreaterThan(20);
    await page.reload();
    const path = stages(page);
    await expect(path.getByRole('button', { name: /Env Setup actors ready/u })).toBeVisible();
    await expect(path.getByRole('button', { name: /Simulation compared/u })).toBeVisible();
    await expect(path.getByRole('button', { name: /Report brief written/u })).toBeVisible();

    await openStage(page, /Env Setup/u);
    await expect(stakeholderPanel(page)).toContainText(/1 edited by you/u);
    await openRegion(page, 'Actors');
    await expect(stakeholderPanel(page).getByRole('region', { name: 'Actors' })).toBeVisible();
    await openStage(page, /Simulation/u);
    await expect(
      comparisonPanel(page).getByRole('heading', { name: 'What this comparison says' }),
    ).toBeVisible();
    await openStage(page, /Report/u);
    expect(squash(await briefDocument(page).locator('.brief-headline').innerText())).toBe(
      squash(headline),
    );
    const byStatus = reviewPanel(page).getByRole('list', { name: 'Criticisms by status' });
    await expect(byStatus.getByRole('listitem').filter({ hasText: /Responded\s*1/u })).toHaveCount(
      1,
    );
  });

  expect(problems, 'what the page logged or failed at').toEqual([]);
  expect(readPages(calls), 'pages read').toBe(pack.urls.length);
  const view = await stakeholdersOf(page, project);
  return {
    pack,
    project,
    calls,
    stakeholders: liveStakeholders(view),
    findings,
    briefText,
  };
}

test.describe('the same pipeline serves every question', () => {
  test.describe.configure({ mode: 'serial' });
  const outcomes: Partial<Record<keyof typeof PACKS, Outcome>> = {};

  for (const [key, label] of [
    ['teams', 'flagship 1: deeper Copilot integration in Teams'],
    ['aws', 'flagship 2: an AWS regional service-price change'],
    ['shop', 'flagship 3: a public website, customers and a fetched page'],
    ['city', 'flagship 4: a congestion charge, which no example knows'],
  ] as const) {
    test(label, async ({ page }) => {
      outcomes[key] = await journey(page, PACKS[key]);
    });
  }

  test('no domain is hard-coded: the same calls, and different stakeholders from different evidence', () => {
    const all = Object.values(outcomes);
    expect(all, 'all four journeys finished').toHaveLength(4);
    const [first, ...rest] = all as [Outcome, ...Outcome[]];
    for (const other of rest) {
      const against = `${other.pack.title} against ${first.pack.title}`;
      expect(pipelineCalls(other.calls), against).toEqual(pipelineCalls(first.calls));
      expect(kindsOfCall(other.calls), against).toEqual(kindsOfCall(first.calls));
    }

    // What each one found is its own: names that no other journey found (a plural is the same name),
    // and findings that are about them.
    const stem = (name: string) => name.toLowerCase().replace(/s$/u, '');
    const namesOf = (outcome: Outcome) =>
      outcome.stakeholders.map((stakeholder) => stem(stakeholder.name));
    const mentions = (text: string, name: string) =>
      new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}s?\\b`, 'iu').test(text);
    for (const outcome of all) {
      const elsewhere = new Set(all.filter((other) => other !== outcome).flatMap(namesOf));
      const mine = namesOf(outcome).filter((name) => !elsewhere.has(name));
      expect(
        mine.length,
        `${outcome.pack.title} has stakeholders that only its own evidence gives`,
      ).toBeGreaterThan(0);
      const said = outcome.findings.join('\n');
      expect(
        mine.some((name) => mentions(said, name)),
        `${outcome.pack.title}'s findings are about groups found in its own evidence (${mine.join(', ')})`,
      ).toBe(true);
      expect(outcome.briefText).toContain(outcome.pack.question);
      for (const other of all.filter((candidate) => candidate !== outcome)) {
        expect(outcome.briefText).not.toContain(other.pack.question);
        expect(outcome.findings, `${outcome.pack.title} against ${other.pack.title}`).not.toEqual(
          other.findings,
        );
      }
    }
    // Only a person who asks for a page makes the application read one.
    expect(all.map((outcome) => readPages(outcome.calls))).toEqual(
      all.map((outcome) => outcome.pack.urls.length),
    );
  });
});

test.describe('the scenario read is optional', () => {
  test('a question and its evidence alone reach a labelled brief, which says there was no scenario', async ({
    page,
  }) => {
    const problems = watchPage(page);
    const { example, intervention } = PACKS.teams;
    await page.goto('/');
    await chooseExample(page, example);
    await expect(scenarioIntake(page)).toContainText('(optional)');
    const project = await build(page);
    await openStage(page, /Env Setup/u);
    await findStakeholders(page);
    await approveAndMakeActors(page);
    await openStage(page, /Simulation/u);
    await compareScenarios(page, { runs: '10', intervention });
    const labels = (await analysisOf(page, project)).config.variants.map(
      (variant) => variant.label,
    );
    expect(labels).toEqual(['No change', 'Proposed change', intervention.name]);

    await openReport(page);
    const review = reviewPanel(page);
    await review.getByRole('button', { name: 'Run independent review', exact: true }).click();
    await expect(review.getByRole('heading', { name: 'What the review found' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate decision brief' }).click();
    const brief = briefDocument(page);
    await expect(brief.getByRole('heading', { level: 3 }).first()).toHaveText('Executive answer');
    await expect(brief.locator('.brief-headline')).toContainText(/simulated members/u);
    await expect(brief).toContainText('No structured scenario was recorded');
    await expect(brief.locator('li.brief-statement:not(:has(.brief-origin))')).toHaveCount(0);
    expect((await textsOf(brief.locator('.brief-text'))).flatMap(claimsAgainst)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('a public web page as evidence', () => {
  const NOT_PUBLIC = /Swarm reads only public web pages|web address Swarm can read/u;
  const NOT_FOUND_PUBLIC = /could not find .* on the public web/u;
  const attempts = async (request: { get(url: string): Promise<{ json(): Promise<unknown> }> }) =>
    (
      (await (await request.get(`${FIXTURES}/__attempts`)).json()) as {
        attempts: { host: string; path: string }[];
      }
    ).attempts;
  const projectCount = async (page: Page): Promise<number> =>
    ((await (await page.request.get('/api/projects')).json()) as { projects: unknown[] }).projects
      .length;

  const refusals: [string, string, RegExp][] = [
    ['a loopback address', 'http://127.0.0.1/', NOT_PUBLIC],
    ['the cloud metadata service', 'http://169.254.169.254/latest/meta-data/', NOT_PUBLIC],
    ['a private network', 'http://10.0.0.5/admin', NOT_PUBLIC],
    ['localhost', 'http://localhost/', NOT_PUBLIC],
    ['an address written as one number', 'http://2130706433/', NOT_PUBLIC],
    // A name that leads inside a network is answered exactly like one that does not exist, so the
    // answer cannot be used to learn which names are in use there.
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
      'http://reader:hunter2@city-transport.example.org/central-zone-pilot',
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

  test('an address that is not public is refused, in words, and nothing is kept or even contacted', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page, { refusals: true });
    await request.post(`${FIXTURES}/__reset`);
    await page.goto('/');
    const projectsBefore = await projectCount(page);
    await questionField(page).fill(CITY_QUESTION);
    const panel = urlPanel(page);

    for (const [what, address, reason] of refusals) {
      await test.step(`${what} is not read`, async () => {
        const response = await fetchPage(page, address);
        expect(response.status(), address).toBeGreaterThanOrEqual(400);
        expect(response.status(), address).toBeLessThan(500);
        const alert = panel.getByRole('alert');
        await expect(alert).toContainText('The page could not be read');
        await expect(alert).toContainText(reason);
        await expect(alert).toContainText('You can paste the text instead.');
        // A person is told what is wrong, not how the server found out, and is never read back their
        // own address or password.
        const said = (await alert.innerText()).toLowerCase();
        for (const leak of ['hunter2', '/etc/passwd', '169.254', 'econn', 'getaddrinfo', 'stack']) {
          expect(said, address).not.toContain(leak);
        }
        await expect(panel.getByRole('article', { name: 'The fetched page' })).toHaveCount(0);
        await expect(sourceMaterial(page)).toContainText('0/10 FILES · 0 CHARS');
      });
    }

    // The fetcher never so much as tried a private address. The only connections made were to the one
    // public host that a page was asked of: for its robots.txt, and for the page that was not there.
    // The page its robots.txt forbids was never requested.
    const made = await attempts(request);
    expect(made.length, 'connections made').toBeGreaterThan(0);
    for (const attempt of made) {
      expect(attempt.host, JSON.stringify(attempt)).toBe('city-transport.example.org');
      expect(['/robots.txt', '/nothing-here'], JSON.stringify(attempt)).toContain(attempt.path);
    }

    // Nothing was made or stored, and the panel still works for a page that is public.
    expect(await projectCount(page)).toBe(projectsBefore);
    const answer = await fetchPage(page, PACKS.city.urls[0]);
    expect(answer.status()).toBe(200);
    await expect(panel.getByRole('article', { name: 'The fetched page' })).toBeVisible();
    await panel.getByRole('button', { name: 'Discard' }).click();
    await expect(sourceMaterial(page)).toContainText('0/10 FILES · 0 CHARS');
    expect(problems).toEqual([]);
  });

  test('a person can cancel while Swarm waits for a page, and nothing is kept', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto('/');
    await questionField(page).fill(CITY_QUESTION);
    const panel = urlPanel(page);
    await panel.getByLabel('Web address').fill('http://city-transport.example.org/never-answers');
    await panel.getByRole('button', { name: 'Fetch page' }).click();
    const waiting = panel.getByText(/This can take a few seconds/u);
    await expect(waiting).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Fetch page' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(waiting).toHaveCount(0);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Fetch page' })).toBeEnabled();
    await expect(sourceMaterial(page)).toContainText('0/10 FILES · 0 CHARS');
    // The panel is not left waiting: the next page is read.
    expect((await fetchPage(page, PACKS.city.urls[0])).status()).toBe(200);
    expect(problems).toEqual([]);
  });

  test('pressing Enter in the address fetches the page, and does not build the project', async ({
    page,
  }) => {
    await page.goto('/');
    const projectsBefore = await projectCount(page);
    await questionField(page).fill(CITY_QUESTION);
    const address = urlPanel(page).getByLabel('Web address');
    await address.fill(PACKS.city.urls[0]);
    const answered = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/evidence/url',
    );
    await address.press('Enter');
    expect((await answered).status()).toBe(200);
    await expect(urlPanel(page).getByRole('article', { name: 'The fetched page' })).toBeVisible();
    await expect(page).not.toHaveURL(/project=/u);
    // The question is still there: the page was not reloaded either.
    await expect(questionField(page)).toHaveValue(CITY_QUESTION);
    expect(await projectCount(page)).toBe(projectsBefore);
  });

  test('a page that tries to run something, or to instruct the analysis, is only text all the way to the brief', async ({
    page,
  }) => {
    const problems = watchPage(page);
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await page.goto('/');
    await questionField(page).fill(CITY_QUESTION);
    const answer = await fetchPage(page, 'http://city-transport.example.org/zone-notice');
    expect(answer.status()).toBe(200);
    const preview = urlPanel(page).getByRole('article', { name: 'The fetched page' });
    await expect(preview).toContainText('reads like instructions to an AI system');
    const document = await addFetchedPage(page, answer);
    // The markup the page wrote out is the text it is, and the instruction to an AI is kept as text.
    expect(document.content).toContain('<img src=x onerror="window.__pwned = 1">');
    expect(document.content).toContain('ignore all previous instructions');

    const project = await build(page);
    await openStage(page, /Env Setup/u);
    await findStakeholders(page);
    const quoted = liveStakeholders(await stakeholdersOf(page, project)).find((stakeholder) =>
      stakeholder.evidence.some((reference) => (reference.quote ?? '').includes('<img')),
    );
    expect(quoted, 'a stakeholder quoted from the sentence that has markup in it').toBeDefined();
    const row = await openStakeholder(page, quoted?.name ?? '');
    await expect(
      row.locator('blockquote').filter({ hasText: '<img src=x onerror=' }),
    ).toBeVisible();

    await approveAndMakeActors(page);
    await openStage(page, /Simulation/u);
    await compareScenarios(page, { runs: '10', intervention: PACKS.city.intervention });
    await openReport(page);
    const review = reviewPanel(page);
    await review.getByRole('button', { name: 'Run independent review', exact: true }).click();
    await expect(review.getByRole('heading', { name: 'What the review found' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate decision brief' }).click();
    await expect(briefDocument(page)).toBeVisible();
    await expect(briefDocument(page)).toContainText('Retrieved public evidence');

    // Nothing the page said ran, and none of it became an element.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
    expect(dialogs).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a page that the person then changes is no longer called a retrieved page', async ({
    page,
  }) => {
    await page.goto('/');
    await questionField(page).fill(CITY_QUESTION);
    const answer = await fetchPage(page, PACKS.city.urls[0]);
    const document = await addFetchedPage(page, answer);
    await editSource(
      page,
      document.name,
      `${document.content}\nAn extra sentence the person added.`,
    );
    const project = await build(page);
    const made = (await (await page.request.get(`/api/projects/${project}`)).json()) as {
      documents: { name: string; provenance?: { kind: string } }[];
    };
    const kept = made.documents.find((candidate) => candidate.name === document.name);
    expect(kept?.provenance?.kind).not.toBe('url');
  });
});

test.describe('the evidence is what discovery reads', () => {
  const REMOVED =
    'Delivery contractors ask whether vans will pay the full charge, and taxi operators ask for the same exemption that buses receive.';
  const ADDED =
    'Independent auditors check the cameras each quarter, and taxi operators ask for the same exemption that buses receive.';

  async function discover(page: Page, content: string): Promise<Stakeholder[]> {
    await page.goto('/');
    await questionField(page).fill(CITY_QUESTION);
    await pasteSource(page, CITY_BRIEFING.name, CITY_BRIEFING.content);
    if (content !== CITY_BRIEFING.content) await editSource(page, CITY_BRIEFING.name, content);
    const project = await build(page);
    await openStage(page, /Env Setup/u);
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
    expect(
      gone.map((stakeholder) => stakeholder.name),
      'groups only the old words gave',
    ).not.toEqual([]);
    expect(
      came.map((stakeholder) => stakeholder.name),
      'groups only the new words give',
    ).not.toEqual([]);
    // A group is found only where the evidence says it, so what disappeared was in the sentence that
    // was taken out, and what appeared is in the sentence that was put in.
    for (const [list, sentence] of [
      [gone, REMOVED],
      [came, ADDED],
    ] as const) {
      for (const stakeholder of list) {
        expect(stakeholder.evidence.length, stakeholder.name).toBeGreaterThan(0);
        for (const reference of stakeholder.evidence) {
          expect(squash(sentence), stakeholder.name).toContain(squash(reference.quote ?? ''));
        }
      }
    }
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

test.describe('the workspace follows what the lab has done, and the scenario read lists its evidence', () => {
  test('the Report stage opens by itself when a comparison finishes, and the brief marks the path as done', async ({
    page,
  }) => {
    // A comparison started on the page is not in the project the workspace holds, so the workspace
    // looks for the change itself: it reads the project again while a comparison runs and until the
    // brief is written. No reload and no Refresh press is needed.
    const project = await seedThroughActors(page, {
      title: 'Journey gates: the Report stage',
      question: CITY_QUESTION,
      documents: [CITY_BRIEFING],
    });
    await page.goto(`/?project=${project}`);
    await openStage(page, /Simulation/u);
    await page.getByRole('button', { name: 'Compare scenarios', exact: true }).click();
    await expect(
      comparisonPanel(page).getByRole('heading', { name: 'What this comparison says' }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'See the decision brief' })).toBeVisible({
      timeout: 8_000,
    });
    await expect(stages(page).getByRole('button', { name: /Simulation compared/u })).toBeVisible();
    await expect(
      stages(page).getByRole('button', { name: /Report ready to write/u }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'See the decision brief' }).click();
    // A keyboard or screen reader user starts at the brief, not at the end of the page.
    await expect(page.locator('#report-brief')).toBeFocused();
    await page.getByRole('button', { name: 'Generate decision brief' }).click();
    await expect(briefDocument(page)).toBeVisible();
    // The button that made the brief goes with its panel: focus stays in the brief that replaces it.
    await expect(page.locator('#report-brief')).toBeFocused();
    await expect(stages(page).getByRole('button', { name: /Report brief written/u })).toBeVisible({
      timeout: 8_000,
    });
    await expect(
      page
        .getByRole('group', { name: 'Your path through the scenario' })
        .locator('.journey-step.done')
        .filter({ hasText: 'Export' }),
    ).toHaveCount(1);
  });

  test('the scenario read lists the documents that are attached when the question is read', async ({
    page,
  }) => {
    // The page sends the names and sizes of the attached documents with the question, so that the
    // scenario keeps a list of the evidence the person had and the start of each document is checked
    // for text aimed at an AI.
    const parsed = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/scenario/parse',
    );
    await page.goto('/');
    const { example } = PACKS.teams;
    await chooseExample(page, example);
    await page.getByRole('button', { name: 'Understand my question' }).click();
    const sent = (await parsed).postDataJSON() as { documents: { name: string }[] };
    expect(sent.documents.map((document) => document.name)).toEqual(
      example.documents.map((document) => document.name),
    );
    const review = page.locator('.intake-review');
    await review.getByText('More detail (optional)').click();
    const attached = review.locator('fieldset', { hasText: 'Evidence you attached' });
    for (const document of example.documents) {
      await expect(attached).toContainText(document.name);
    }
    await expect(attached).not.toContainText('No documents were attached');
  });
});
