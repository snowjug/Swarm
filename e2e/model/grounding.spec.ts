import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import {
  PUBLICATION_STATUS_LABELS,
  PUBLICATION_STATUSES,
  REVIEW_RESULT_LABELS,
  STATEMENT_TYPE_LABELS,
  SUPPORT_CLASSES,
  SUPPORT_CLASS_LABELS,
  type ClaimRecord,
  type Ledger,
  type SupportClass,
} from '../../shared/evidence';
import { openApp } from '../support/app';
import { openDisclosure, viewports, watchPage } from '../support/helpers';
import { squash } from '../support/lab-api';
import {
  LIBRARY,
  deleteMade,
  expectSound,
  graph,
  groundStatus,
  hero,
  figure,
  figureValue,
  inDocuments,
  ledgerOf,
  makeProject,
  passagesOf,
  readProjectAs,
  recordOf,
  runStep,
  sheet,
  statementsSection,
  topic,
  topicDetails,
} from '../support/ground-map';

// Statements, verdicts and conflicts, and the way a model's reading of the sources is shown, through the real page, on a
// server whose model is the fake provider (e2e/support/fake-provider.ts): a protocol-faithful stand-in, not evidence of
// what any real model would write. The fake answers from each request (a quote it copies from the passage it is given),
// so what the server verifies and what the page shows is real; what is not real is the model's quality.

test.use({
  actionTimeout: 15_000,
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
});
test.afterEach(({ request }) => deleteMade(request));

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;

/** Puts the fake provider back as it was and sets how long it keeps each request. */
async function provider(
  playwright: {
    request: { newContext: (options: { baseURL: string }) => Promise<APIRequestContext> };
  },
  controls: { latencyMs?: number; failKind?: string | null } = {},
): Promise<void> {
  const api = await playwright.request.newContext({ baseURL: providerUrl });
  await api.post('/__reset');
  await api.post('/__control', { data: { latencyMs: 0, ...controls } });
  await api.dispose();
}

test.beforeEach(async ({ playwright }) => provider(playwright));

const MODEL = { mode: 'llm', agents: 4, rounds: 3 } as const;

/** A project read by the model, taken through the report, so that the ledger holds the statements the report makes. */
async function reportOf(request: APIRequestContext): Promise<string> {
  const id = await makeProject(request, LIBRARY, 'ground', MODEL);
  for (const step of ['environment', 'simulation', 'report'] as const) {
    await runStep(request, id, step);
  }
  return id;
}

const SUFFICIENCY_WORDS = {
  sufficient: 'Supports a recommendation',
  limited: 'Limited: treat as tentative',
  insufficient: 'Not enough yet',
} as const;

const statementRow = (page: Page, claim: Pick<ClaimRecord, 'id'>) =>
  page.locator(`#ground-claim-${claim.id}`);

test.describe('what a model read from the sources', () => {
  test('its entities carry the quote the server checked against the passage, and the page says it may be incomplete', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, LIBRARY, 'ground', MODEL);
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    await openApp(page, { project: id, scene: 'ground' });

    // The page reads out what it found, in sentences that are right for one source and one passage.
    await expect(page.getByRole('status').filter({ hasText: /^Ready\./u })).toContainText(
      `Ready. 1 source, 1 passage, ${record.graph!.nodes.length} entities.`,
    );
    // The figure counts entities, not topics, and the graph says where it comes from.
    expect(record.graph?.method).toBe('llm');
    expect(await figureValue(page, 'Entities')).toBe(record.graph!.nodes.length);
    await expect(graph(page)).toHaveAccessibleName(
      new RegExp(
        `^Source graph: ${record.graph!.nodes.length} entities, ${record.graph!.edges.length} links\\.`,
        'u',
      ),
    );
    await expect(page.getByText('Extracted by a model · may be incomplete')).toBeVisible();
    await page.getByRole('button', { name: 'Method' }).click();
    await expect(page.getByRole('dialog', { name: 'How this was read' })).toContainText(
      'A model proposed the entities and links. Each quote was checked word for word against its passage. It may be incomplete.',
    );
    await page.keyboard.press('Escape');

    // An entity: its type, what it says, and the quote, which is in the passage it cites, word for word.
    const entity = record.graph!.nodes.find((node) => node.quote)!;
    await topic(page, entity.label).click();
    const details = topicDetails(page, entity.label);
    await expect(details).toContainText(entity.entityType ?? '');
    await expect(details).toContainText(entity.summary);
    await expect(details.locator('blockquote')).toHaveText(entity.quote!);
    await expect(details).toContainText(
      `Quote checked character for character against ${entity.sourceIds.join(', ')}`,
    );
    const cited = passages.find((passage) => passage.id === entity.sourceIds[0])!;
    expect(squash(cited.text)).toContain(squash(entity.quote!));
    await expectSound(page, 'ground: an entity open');

    // The types are a filter: leaving one out takes its entities off the graph.
    const type = record.graph!.nodes[0]!.entityType!;
    const onType = record.graph!.nodes.filter((node) => node.entityType === type).length;
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: new RegExp(`^${type}\\s*${onType}$`, 'u') }).click();
    await expect(graph(page).getByRole('button')).toHaveCount(record.graph!.nodes.length - onType);
    expect(problems).toEqual([]);
  });

  test('a citation the record cannot place is a passage that says it is not there', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, LIBRARY, 'ground', MODEL);
    const first = (await recordOf(request, id)).graph!.nodes[0]!;
    await readProjectAs(page, id, (project) => {
      project.graph!.nodes[0]!.sourceIds = [...project.graph!.nodes[0]!.sourceIds, 'S999'];
    });
    await openApp(page, { project: id, scene: 'ground' });
    await topic(page, first.label).click();
    await topicDetails(page, first.label)
      .getByRole('button', { name: 'S999', exact: true })
      .click();
    await expect(
      sheet(page).getByRole('heading', { level: 2, name: 'S999 is not here' }),
    ).toBeVisible();
    await expectSound(page, 'ground: a citation that is not in the record');
    expect(problems).toEqual([]);
  });
});

test.describe('the statements a report makes', () => {
  test('each statement says how well the sources back it in words and an icon, and the counts are the server’s', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await reportOf(request);
    const ledger = await ledgerOf(request, id);
    expect(ledger.claims.length).toBeGreaterThan(0);
    await openApp(page, { project: id, scene: 'ground' });

    const section = statementsSection(page);
    await expect(
      section.getByRole('heading', { level: 2, name: `Statements ${ledger.claims.length}` }),
    ).toBeVisible();
    // The bar and the chips are the ledger's own counts, one chip for each kind of support that occurs.
    const counts = SUPPORT_CLASSES.map((support) => ({
      support,
      count: ledger.claims.filter((claim) => claim.supportClass === support).length,
    })).filter((entry) => entry.count > 0);
    await expect(
      section.getByRole('img', { name: new RegExp(`^${ledger.claims.length} statements: `, 'u') }),
    ).toHaveAccessibleName(
      `${ledger.claims.length} statements: ${counts
        .map((entry) => `${entry.count} ${SUPPORT_CLASS_LABELS[entry.support].toLowerCase()}`)
        .join(', ')}`,
    );
    const chips = section.getByRole('list', { name: 'Filter by how well backed' });
    for (const entry of counts) {
      await expect(
        chips.getByRole('button', {
          name: `${SUPPORT_CLASS_LABELS[entry.support]} ${entry.count}`,
        }),
      ).toBeVisible();
    }

    // A verdict is never colour alone: each row has its words and a mark that is a shape, and each chip has a shape too.
    for (const claim of ledger.claims) {
      const row = statementRow(page, claim);
      await expect(row).toContainText(claim.text);
      await expect(row).toContainText(SUPPORT_CLASS_LABELS[claim.supportClass]);
      await expect(row).toContainText(STATEMENT_TYPE_LABELS[claim.statementType]);
      await expect(row).toContainText(PUBLICATION_STATUS_LABELS[claim.publication.status]);
      await expect(row.locator('svg').first()).toBeVisible();
    }
    for (const chip of await chips.getByRole('button').all()) {
      if ((await chip.innerText()).startsWith('More filters')) continue;
      await expect(chip.locator('svg').first()).toBeVisible();
    }
    await expectSound(page, 'ground: the statements');
    expect(problems).toEqual([]);
  });

  test('is the evidence enough? is answered by a fixed rule, in words, with its reasons', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await reportOf(request);
    const { sufficiency } = await ledgerOf(request, id);
    await openApp(page, { project: id, scene: 'ground' });

    await statementsSection(page)
      .getByRole('button', { name: SUFFICIENCY_WORDS[sufficiency.level] })
      .click();
    const why = page.getByRole('dialog', { name: 'Is the evidence enough' });
    if (sufficiency.directlySupportedShare !== null) {
      await expect(why).toContainText(
        `${Math.round(sufficiency.directlySupportedShare * 100)}% of the statements that rest on a source are directly supported by it.`,
      );
    }
    for (const reason of sufficiency.reasons) await expect(why).toContainText(reason);
    await expect(why).toContainText('Decided by a fixed rule, never by a model.');
    expect(problems).toEqual([]);
  });

  test('the statements can be narrowed by how well backed they are, by whether they were reviewed and by the assumption they rest on, and cleared', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await reportOf(request);
    const ledger = await ledgerOf(request, id);
    const total = ledger.claims.length;
    await openApp(page, { project: id, scene: 'ground' });
    const section = statementsSection(page);
    const shown = section
      .getByRole('list')
      .filter({ has: page.locator('[id^="ground-claim-"]') })
      .getByRole('listitem');
    await expect(shown).toHaveCount(total);

    const support = ledger.claims[0]!.supportClass;
    const withSupport = ledger.claims.filter((claim) => claim.supportClass === support).length;
    await section
      .getByRole('list', { name: 'Filter by how well backed' })
      .getByRole('button', { name: `${SUPPORT_CLASS_LABELS[support]} ${withSupport}` })
      .click();
    await expect(shown).toHaveCount(withSupport);
    await expect(section).toContainText(`${withSupport} of ${total} shown`);
    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect(shown).toHaveCount(total);

    // What nobody has reviewed yet; and what rests on an assumption, which counts the statements that would fall with it.
    await section.getByRole('button', { name: 'More filters' }).click();
    const filters = page.getByRole('dialog', { name: 'More filters' });
    await filters.getByRole('switch', { name: 'Not yet reviewed' }).click();
    await expect(shown).toHaveCount(
      ledger.claims.filter((claim) => claim.review.result === 'pending').length,
    );
    await filters.getByRole('switch', { name: 'Not yet reviewed' }).click();
    const assumption = ledger.assumptions.find((item) =>
      ledger.claims.some((claim) => claim.assumptionIds.includes(item.id)),
    )!;
    const resting = ledger.claims.filter((claim) =>
      claim.assumptionIds.includes(assumption.id),
    ).length;
    await filters
      .getByRole('button', { name: new RegExp(`^${assumption.id}\\s*${resting}$`, 'u') })
      .click();
    await expect(shown).toHaveCount(resting);
    await page.keyboard.press('Escape');
    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect(shown).toHaveCount(total);

    // The assumptions behind the results are inputs, not findings, and each says how many statements rest on it.
    const assumptions = await openDisclosure(section, `Assumptions · ${ledger.assumptions.length}`);
    for (const item of ledger.assumptions) {
      await expect(assumptions).toContainText(item.statement);
      await expect(assumptions).toContainText(item.id);
    }
    expect(problems).toEqual([]);
  });

  test('a statement opens with the passage it rests on and the words that were quoted, and says how it was checked', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await reportOf(request);
    const record = await recordOf(request, id);
    const ledger = await ledgerOf(request, id);
    const claim = ledger.claims.find((item) => item.supporting.some((ref) => ref.quote))!;
    const ref = claim.supporting.find((item) => item.quote)!;
    await openApp(page, { project: id, scene: 'ground' });

    await statementRow(page, claim).click();
    const dialog = sheet(page);
    await expect(
      dialog.getByRole('heading', { level: 2, name: `Statement ${claim.id}` }),
    ).toBeVisible();
    await expect(dialog).toContainText(claim.text);
    await expect(dialog).toContainText(SUPPORT_CLASS_LABELS[claim.supportClass]);
    await expect(dialog).toContainText(PUBLICATION_STATUS_LABELS[claim.publication.status]);
    await expect(dialog).toContainText(REVIEW_RESULT_LABELS[claim.review.result]);
    // The evidence: the passage, with the words that were quoted marked, and those words are in the source.
    const evidence = dialog.getByRole('region', { name: 'Cited passages' });
    await expect(evidence).toContainText('Supporting');
    await expect(evidence.locator('mark').first()).toHaveText(ref.quote!);
    expect(inDocuments(ref.quote!, record.documents)).toBe(true);
    await expect(evidence).toContainText('The marked words are in it exactly as written.');
    await expect(evidence).toContainText(`${ref.documentName} · ${ref.passageId}`);

    // How it was checked, by the engine's own account.
    const checks = await openDisclosure(dialog, 'How it was checked');
    await expect(checks).toContainText(
      claim.verification.method === 'deterministic+model'
        ? 'Automatic checks, then an independent model check'
        : 'Automatic checks only',
    );
    await expect(checks).toContainText(claim.verification.reason);
    if (claim.verification.quote === 'found')
      await expect(checks).toContainText('Found in the passage');
    await expectSound(page, 'ground: a statement open');
    expect(problems).toEqual([]);
  });

  test('a review is recorded with its note, is the server’s, and the focus goes back to the row', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await reportOf(request);
    const claim = (await ledgerOf(request, id)).claims[0]!;
    await openApp(page, { project: id, scene: 'ground' });
    const row = statementRow(page, claim);

    await row.click();
    const dialog = sheet(page);
    await expect(dialog).toContainText(
      'Accepting only records that you reviewed it: it does not make it better supported.',
    );
    await dialog.getByRole('textbox', { name: 'Note' }).fill('Needs a second source before use.');
    await dialog.getByRole('button', { name: 'Needs revision' }).click();
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByText('Review saved'),
    ).toBeVisible();
    await expect(dialog).toContainText(REVIEW_RESULT_LABELS['needs-revision']);
    await expect(dialog).toContainText('Needs a second source before use.');
    const saved = (await ledgerOf(request, id)).claims.find((item) => item.id === claim.id)!;
    expect(saved.review).toMatchObject({
      result: 'needs-revision',
      note: 'Needs a second source before use.',
    });
    // What a reviewer does is in the history of the statement, and never changes how well it is backed.
    expect(saved.supportClass).toBe(claim.supportClass);
    const history = await openDisclosure(dialog, /^History · \d+$/u);
    await expect(history).toContainText('Reviewer');

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    await expect(row).toContainText(REVIEW_RESULT_LABELS['needs-revision']);

    // The review is stored on the server, not just on the screen.
    await page.reload();
    await expect(statementRow(page, claim)).toContainText(REVIEW_RESULT_LABELS['needs-revision']);
    expect(problems).toEqual([]);
  });

  test('a statement that cites no passage says so, and says what it depends on', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await reportOf(request);
    const ledger = await ledgerOf(request, id);
    const claim = ledger.claims.find(
      (item) => item.supporting.length + item.contradicting.length === 0,
    )!;
    await openApp(page, { project: id, scene: 'ground' });

    await statementRow(page, claim).click();
    const dialog = sheet(page);
    await expect(dialog).toContainText('No source passage is cited for this statement.');
    await expect(dialog).toContainText(SUPPORT_CLASS_LABELS[claim.supportClass]);
    const resting = ledger.assumptions.filter((item) => claim.assumptionIds.includes(item.id));
    if (resting.length > 0) {
      const depends = dialog.getByRole('region', { name: 'Assumptions' });
      for (const item of resting) {
        await expect(depends).toContainText(item.id);
        await expect(depends).toContainText(item.statement);
      }
    }
    expect(problems).toEqual([]);
  });
});

/** A statement with another kind of support, as the server would write it, for the page to be read at its widest. */
function withSupport(
  claim: ClaimRecord,
  index: number,
  support: SupportClass,
  text: string,
): ClaimRecord {
  return {
    ...claim,
    id: `C${index + 1}`,
    text,
    supportClass: support,
    publication: {
      ...claim.publication,
      status: PUBLICATIONS[support],
      qualification:
        support === 'partially-supported' ? 'The sources back only part of this.' : null,
    },
    review: { result: index % 3 === 0 ? 'accepted' : 'pending', note: null, reviewedAt: null },
  };
}
const PUBLICATIONS: Record<SupportClass, (typeof PUBLICATION_STATUSES)[number]> = {
  'directly-supported': 'finding',
  'partially-supported': 'qualified',
  contradicted: 'contradiction-shown',
  unsupported: 'labelled-hypothesis',
  'not-applicable': 'input',
  'not-checkable': 'labelled-unverified',
  'simulation-derived': 'labelled-simulation',
  'assumption-dependent': 'qualified',
};

const HOSTILE = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script>';
const LONG = 'Unbroken'.repeat(60);

/** The ledger as it would be with a statement of every kind, and awkward text: hostile markup and a very long unbroken word. */
function richLedger(real: Ledger): Ledger {
  const base = real.claims[0]!;
  const claims = SUPPORT_CLASSES.map((support, index) =>
    withSupport(
      base,
      index,
      support,
      `Statement of kind ${support}. ${index === 1 ? `${HOSTILE} ${LONG}` : ''}`.trim(),
    ),
  );
  return { ...real, claims };
}

test.describe('every kind of statement, and text that is not what it looks like', () => {
  test('every verdict and kind renders inertly and fits at every size, with a shape as well as words', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const problems = watchPage(page);
    const id = await reportOf(request);
    const real = await ledgerOf(request, id);
    const rich = richLedger(real);
    const passages = await passagesOf(request, id);
    await page.route(`**/api/projects/${id}/ledger`, (route: Route) =>
      route.fulfill({ json: rich }),
    );
    await page.route(new RegExp(`/api/projects/${id}/claims/C\\d+$`), (route: Route) => {
      const wanted = route.request().url().split('/').pop()!;
      const claim = rich.claims.find((item) => item.id === wanted)!;
      return route.fulfill({
        json: {
          claim,
          passages: passages.filter((passage) =>
            [...claim.supporting, ...claim.contradicting].some(
              (ref) => ref.passageId === passage.id,
            ),
          ),
          memories: [],
          assumptions: rich.assumptions,
        },
      });
    });

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openApp(page, { project: id, scene: 'ground', view: 'statements' });
      const section = statementsSection(page);
      await expect(
        section.getByRole('heading', { level: 2, name: `Statements ${rich.claims.length}` }),
      ).toBeVisible();
      // Every kind has its own words, and a shape beside them.
      for (const claim of rich.claims) {
        const row = statementRow(page, claim);
        await expect(row).toContainText(SUPPORT_CLASS_LABELS[claim.supportClass]);
        await expect(row.locator('svg').first()).toBeVisible();
      }
      // Hostile strings are text, never markup, and nothing runs.
      expect(await section.locator('img, script, iframe').count()).toBe(0);
      expect(
        await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
      ).toBeUndefined();
      await expect(section.getByText('onerror=', { exact: false }).first()).toBeAttached();
      await expectSound(page, `ground at ${viewport.name}: a statement of every kind`);
    }

    // The statement with the hostile words, opened.
    await statementRow(page, rich.claims[1]!).click();
    await expect(
      sheet(page).getByRole('heading', { level: 2, name: 'Statement C2' }),
    ).toBeVisible();
    expect(await sheet(page).locator('img, script, iframe').count()).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    await expectSound(page, 'ground: a statement with hostile words, open');
    expect(problems).toEqual([]);
  });
});

test.describe('when the model is at work, and when it could not do it', () => {
  test('a step that is under way shows the engine’s own steps as it records them, and finishes without a reload', async ({
    page,
    request,
    playwright,
  }) => {
    test.setTimeout(240_000);
    const problems = watchPage(page);
    const id = await makeProject(request, LIBRARY, 'draft', MODEL);
    // The model keeps each request for a while, so that the step is under way long enough to be seen.
    await provider(playwright, { latencyMs: 2500 });
    const started = await request.post(`/api/projects/${id}/steps/knowledge`, { data: {} });
    expect(started.status()).toBe(202);
    await openApp(page, { project: id, scene: 'ground' });

    const progress = page.getByRole('list', { name: 'Progress' });
    await expect(progress).toBeVisible();
    await expect(progress.getByRole('listitem')).toHaveCount(4);
    await expect(groundStatus(page, /^(?:Reading|Queued)$/u)).toBeVisible();
    // The first thing the engine does is under way while the second waits; then the first is done and the second under way.
    await expect(progress.getByRole('listitem').nth(0)).toContainText('Reading');
    await expect(progress.getByRole('listitem').nth(0)).toContainText('in progress');
    await expect(progress.getByRole('listitem').nth(1)).toContainText('Extracting');
    await expect(progress.getByRole('listitem').nth(1)).toContainText('waiting');
    await expect(progress.getByRole('listitem').nth(0)).toContainText('done', { timeout: 30_000 });
    await expect(progress.getByRole('listitem').nth(1)).toContainText('in progress');
    // Until the model has answered there is no graph, so the third figure is still the one every graph has: topics.
    await expect(figure(page, 'Topics').getByRole('img', { name: 'Not known yet' })).toBeVisible();
    await expectSound(page, 'ground: the model at work');

    await expect(groundStatus(page, /^Ready$/u)).toBeVisible({
      timeout: 60_000,
    });
    expect(await figureValue(page, 'Entities')).toBe(
      (await recordOf(request, id)).graph!.nodes.length,
    );
    await expect(graph(page)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a step the model could not do says why, in the engine’s words, and trying again does it', async ({
    page,
    request,
    playwright,
  }) => {
    test.setTimeout(240_000);
    const problems = watchPage(page);
    const id = await makeProject(request, LIBRARY, 'draft', MODEL);
    await provider(playwright, { failKind: 'graph' });
    const started = await request.post(`/api/projects/${id}/steps/knowledge`, { data: {} });
    expect(started.status()).toBe(202);
    await expect
      .poll(async () => (await recordOf(request, id)).console?.steps.knowledge, { timeout: 60_000 })
      .toBe('failed');
    const reason = (await recordOf(request, id)).error?.trim();
    expect(reason).toBeTruthy();

    await openApp(page, { project: id, scene: 'ground' });
    await expect(groundStatus(page, /^Failed$/u)).toBeVisible();
    const alert = hero(page, LIBRARY).getByRole('alert');
    await expect(alert).toContainText('Reading the sources failed');
    await expect(alert).toContainText(reason!);
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toHaveCount(0);
    await expectSound(page, 'ground: the model could not read the sources');

    // The model is back; trying again is a real second attempt, and it works.
    await provider(playwright);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(groundStatus(page, /^Ready$/u)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
