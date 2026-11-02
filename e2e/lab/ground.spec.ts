import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectLocked, expectScene, openApp, step, type ThemeName } from '../support/app';
import { expectTouchTargets, openDisclosure, viewports, watchPage } from '../support/helpers';
import { claimsAgainst, squash } from '../support/lab-api';
import {
  AGREE,
  FERRY,
  conflictCard,
  deleteMade,
  conflictsSection,
  documentTextOf,
  escapeRegExp,
  expectControlsInside,
  expectReachable,
  inDocuments,
  exampleSeed,
  expectSound,
  figure,
  figureValue,
  graph,
  hero,
  inAdvancedMode,
  makeLegacy,
  makeProject,
  openConflicts,
  operationsSection,
  ownSentences,
  passageButton,
  passagesOf,
  readProjectAs,
  recordOf,
  runStep,
  ledgerOf,
  sheet,
  sourcesSection,
  statementsSection,
  toast,
  topic,
  topicDetails,
  GROUND_VIEWS,
} from '../support/ground-map';

// The Ground scene, on the rules-mode server and through the real page: the evidence the exploration rests on. What
// is checked is what the server holds (the documents, the passages they were cut into, the graph, the conflicts),
// never a number from a fixture. Nothing here needs a model.

test.use({
  actionTimeout: 15_000,
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
});
test.afterEach(({ request }) => deleteMade(request));

const SHOP = exampleSeed('ecommerce-experience');
const THEMES: ThemeName[] = ['light', 'dark', 'high-contrast'];

test.describe('the states of the scene', () => {
  test('a project whose sources have not been read says so, and reading them is one press', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'draft');
    await openApp(page, { project: id, scene: 'ground' });

    const first = hero(page, FERRY);
    await expect(first.getByText('Not started', { exact: true })).toBeVisible();
    // The sources and the passages they were cut into are known when they are taken in; what the engine has not read is a dash.
    expect(await figureValue(page, 'Sources')).toBe(FERRY.documents.length);
    expect(await figureValue(page, 'Passages')).toBe((await passagesOf(request, id)).length);
    await expect(figure(page, 'Topics').getByRole('img', { name: 'Not known yet' })).toBeVisible();
    await expect(
      figure(page, 'Conflicts').getByRole('img', { name: 'Not known yet' }),
    ).toBeVisible();
    await expect(graph(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toHaveCount(0);
    await expectLocked(page, 'map');
    await expectSound(page, 'ground: not started');

    await page.getByRole('button', { name: 'Ground it', exact: true }).click();
    await expect(first.getByText('Ready', { exact: true })).toBeVisible();
    const record = await recordOf(request, id);
    await expect.poll(() => figureValue(page, 'Topics')).toBe(record.graph?.nodes.length);
    await expect.poll(() => figureValue(page, 'Conflicts')).toBe(1);
    await expect(graph(page)).toBeVisible();
    // The way on is now the next scene, and it is open.
    await expect(step(page, 'map')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Map the stakeholders' }).click();
    await expectScene(page, 'map');
    expect(problems).toEqual([]);
  });

  test('a project whose sources were read shows the counts the server holds, and one row for each source', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    const ledger = await ledgerOf(request, id);
    await openApp(page, { project: id, scene: 'ground' });

    await expect(hero(page, SHOP).getByText('Ready', { exact: true })).toBeVisible();
    expect(await figureValue(page, 'Sources')).toBe(record.documents.length);
    expect(await figureValue(page, 'Passages')).toBe(passages.length);
    expect(await figureValue(page, 'Topics')).toBe(record.graph?.nodes.length);
    expect(await figureValue(page, 'Conflicts')).toBe(openConflicts(ledger).length);
    // What a screen reader is told is the same.
    const nodes = record.graph?.nodes.length ?? 0;
    await expect(
      page.getByRole('status').filter({ hasText: `${record.documents.length} sources` }),
    ).toContainText(`${passages.length} passages, ${nodes} topics`);
    await expect(graph(page)).toHaveAccessibleName(
      new RegExp(`^Source graph: ${nodes} topics, ${record.graph?.edges.length} links\\.`, 'u'),
    );
    await expect(graph(page).getByRole('button')).toHaveCount(nodes);

    // One row for each source, with its own passages and its size.
    const rows = sourcesSection(page).getByRole('list', { name: 'Sources' }).getByRole('listitem');
    await expect(rows).toHaveCount(record.documents.length);
    for (const doc of record.documents) {
      const row = rows.filter({ has: page.getByRole('button', { name: doc.name, exact: true }) });
      await expect(row).toHaveCount(1);
      const own = passages.filter((passage) => passage.documentId === doc.id);
      await expect(row).toContainText(`${doc.content.length.toLocaleString('en-GB')} characters`);
      await expect(row.getByRole('button', { name: /^Passage S\d+,/u })).toHaveCount(own.length);
      // The examples are synthetic, and the page says so where a source is named.
      await expect(row).toContainText('Synthetic sample');
    }
    await expectSound(page, 'ground: ready');
    expect(problems).toEqual([]);
  });

  test('a saved record that the guided flow did not make is read, never run', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeLegacy(request, FERRY);
    await openApp(page, { project: id, scene: 'ground' });

    await expect(hero(page, FERRY).getByText('Saved record', { exact: true })).toBeVisible();
    // Nothing to start, restart or stop: whatever the record holds can be read.
    for (const name of ['Ground it', 'Try again', 'Start again', 'Stop']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    expect(await figureValue(page, 'Sources')).toBe(FERRY.documents.length);
    await expect(sourcesSection(page)).toBeVisible();
    await expect(conflictsSection(page)).toBeVisible();
    await expect(statementsSection(page)).toBeVisible();
    // The steps that need the guided flow say so.
    await expectLocked(page, 'map');
    await expect(step(page, 'map')).toHaveAccessibleName(/Not in this record/u);
    expect(problems).toEqual([]);
  });
});

test.describe('deep links', () => {
  for (const view of GROUND_VIEWS.filter((name) => name !== 'trace')) {
    test(`?view=${view} opens the page at its part, and the part has the focus`, async ({
      page,
      request,
    }) => {
      const problems = watchPage(page);
      const id = await makeProject(request, FERRY, 'ground');
      await openApp(page, { project: id, scene: 'ground', view });
      await expectAt(page, view);
      expect(problems).toEqual([]);
    });
  }
});

test.describe('the graph', () => {
  test('is one tab stop, and can be walked, opened and closed from the keyboard', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    const total = record.graph?.nodes.length ?? 0;
    await openApp(page, { project: id, scene: 'ground' });
    await expect(graph(page).getByRole('button')).toHaveCount(total);

    // Exactly one topic takes the focus from Tab; the next Tab leaves the graph.
    await expect(graph(page).locator('[tabindex="0"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Method' }).focus();
    await page.keyboard.press('Tab');
    const entered = await focusedLabel(page);
    expect(entered).toMatch(/, Topic, cited in \d+ of \d+ documents$/u);
    await page.keyboard.press('Tab');
    expect(await focusedLabel(page)).not.toMatch(/, Topic, cited in/u);
    await page.keyboard.press('Shift+Tab');
    expect(await focusedLabel(page)).toBe(entered);

    // [ and ] walk through every topic, once each, and come round to where they began.
    const seen = new Set<string>([entered]);
    for (let at = 0; at < total - 1; at += 1) {
      await page.keyboard.press(']');
      seen.add(await focusedLabel(page));
    }
    expect(seen.size).toBe(total);
    await page.keyboard.press(']');
    expect(await focusedLabel(page)).toBe(entered);
    await page.keyboard.press('[');
    await page.keyboard.press(']');
    expect(await focusedLabel(page)).toBe(entered);

    // Enter opens what the topic is; Escape closes it and the focus stays on the topic.
    const label = entered.split(', ')[0]!;
    await page.keyboard.press('Enter');
    await expect(topicDetails(page, label)).toBeVisible();
    await expect(topic(page, label)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(topicDetails(page, label)).toHaveCount(0);
    await expect(topic(page, label)).toBeFocused();

    // Plus and minus zoom, the arrows pan and R fits the graph in the view again.
    const [first, second] = [...seen].map((name) => topic(page, name.split(', ')[0]!)).slice(0, 2);
    const apart = async () => distance(await centre(first!), await centre(second!));
    const before = await apart();
    const at = await centre(first!);
    await page.keyboard.press('+');
    await expect.poll(apart).toBeGreaterThan(before * 1.1);
    await page.keyboard.press('R');
    await expect.poll(apart).toBeCloseTo(before, 0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await centre(first!)).x).toBeLessThan(at.x - 20);
    await page.keyboard.press('R');
    await expect.poll(async () => (await centre(first!)).x).toBeCloseTo(at.x, 0);
    expect(problems).toEqual([]);
  });

  test('a topic says what it is, which passages it rests on and which sources they sit in', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    const graphData = record.graph!;
    const node = [...graphData.nodes].sort((a, b) => b.weight - a.weight)[0]!;
    const docIds = [
      ...new Set(
        node.sourceIds.map((cited) => passages.find((item) => item.id === cited)?.documentId),
      ),
    ];
    const links = graphData.edges.filter(
      (edge) => edge.source === node.id || edge.target === node.id,
    );
    await openApp(page, { project: id, scene: 'ground' });

    await topic(page, node.label).click();
    const details = topicDetails(page, node.label);
    await expect(details).toBeVisible();
    await expect(details.getByRole('heading', { level: 2, name: node.label })).toBeVisible();
    await expect(details).toContainText(
      `in ${docIds.length} of ${record.documents.length} sources`,
    );
    // The engine's own account of the topic is shown as it is, including that it is not a finding.
    await expect(details).toContainText(node.summary);
    const cited = details.getByRole('region', { name: 'Passages' }).getByRole('button');
    await expect(cited).toHaveText(node.sourceIds);
    const sources = details.getByRole('region', { name: 'Cited in' }).getByRole('button');
    await expect(sources).toHaveCount(docIds.length);
    for (const docId of docIds) {
      await expect(
        sources.filter({ hasText: record.documents.find((d) => d.id === docId)!.name }),
      ).toHaveCount(1);
    }

    // Its links: as many as the graph holds for it, and one opens the link with the passages that join the two.
    const linked = details.getByRole('button', {
      name: `Linked to ${links.length} ${links.length === 1 ? 'topic' : 'topics'}`,
    });
    await linked.click();
    const joined = details.getByRole('list').last().getByRole('button');
    await expect(joined).toHaveCount(links.length);
    await joined.first().click();
    const link = page.getByRole('region', { name: 'Link: details' });
    await expect(link).toBeVisible();
    await expect(link).toContainText('Shared passages');
    await expect(
      link.getByRole('region', { name: 'Passages' }).getByRole('button'),
    ).not.toHaveCount(0);

    // A passage it cites opens in the sheet, with the words of the passage as the server holds them.
    await topic(page, node.label).click();
    const chip = topicDetails(page, node.label)
      .getByRole('region', { name: 'Passages' })
      .getByRole('button', { name: node.sourceIds[0]!, exact: true });
    await chip.click();
    const passage = passages.find((item) => item.id === node.sourceIds[0])!;
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole('heading', { level: 2, name: passage.id })).toBeVisible();
    await expect(sheet(page).locator('blockquote')).toHaveText(passage.text);
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(chip).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('can be searched by name, and its links narrowed to the stronger ones', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    const edges = record.graph!.edges;
    const nodes = [...record.graph!.nodes].sort(
      (a, b) => b.weight - a.weight || a.label.localeCompare(b.label),
    );
    await openApp(page, { project: id, scene: 'ground' });

    await page.getByRole('button', { name: 'Find a topic' }).click();
    const box = page.getByRole('searchbox', { name: 'Find in the graph' });
    const wanted = nodes[3]!;
    await box.fill(wanted.label.slice(0, 4).toLowerCase());
    const first = nodes.find((node) =>
      node.label.toLowerCase().includes(wanted.label.slice(0, 4).toLowerCase()),
    )!;
    await box.press('Enter');
    await expect(topicDetails(page, first.label)).toBeVisible();
    await expect(topic(page, first.label)).toBeFocused();
    await page.getByRole('button', { name: 'Find a topic' }).click();
    await page.getByRole('searchbox', { name: 'Find in the graph' }).fill('zzzzzz');
    await expect(page.getByText('Nothing matches.')).toBeVisible();
    await page.keyboard.press('Escape');

    // The weakest link that is shown: every link is there until the slider is moved, and fewer after.
    await page.getByRole('button', { name: 'Graph options' }).click();
    const options = page.getByRole('dialog', { name: 'Graph options' });
    const slider = options.getByRole('slider', { name: 'Weakest link shown' });
    await expect(options).toContainText(`${edges.length} of ${edges.length}`);
    await slider.focus();
    await page.keyboard.press('End');
    const strongest = Number(await slider.getAttribute('aria-valuenow'));
    const kept = edges.filter((edge) => edge.weight >= strongest).length;
    await expect(options).toContainText(`${kept} of ${edges.length}`);
    expect(kept).toBeLessThan(edges.length);
    await page.keyboard.press('Home');
    await expect(options).toContainText(`${edges.length} of ${edges.length}`);
    expect(problems).toEqual([]);
  });

  test('what is pointed at lights what it rests on and what rests on it, in the graph and in the sources', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    const nodes = record.graph!.nodes;
    await openApp(page, { project: id, scene: 'ground' });

    // A passage lights the topics that cite it, and dims the others.
    const some = passages.find((candidate) => {
      const citing = nodes.filter((node) => node.sourceIds.includes(candidate.id));
      return citing.length > 0 && citing.length < nodes.length;
    })!;
    await passageButton(page, some.id).hover();
    for (const node of nodes) {
      const lit = node.sourceIds.includes(some.id);
      if (lit) await expect(topic(page, node.label)).toHaveAttribute('data-lit', '');
      else await expect(topic(page, node.label)).toHaveAttribute('data-dim', '');
    }

    // A topic lights the passages it cites.
    const node = nodes.find((candidate) => candidate.sourceIds.length < passages.length)!;
    await page.mouse.move(0, 0);
    await topic(page, node.label).hover({ force: true });
    for (const passage of passages) {
      const own = node.sourceIds.includes(passage.id);
      if (own) await expect(passageButton(page, passage.id)).toHaveAttribute('data-lit', '');
      else await expect(passageButton(page, passage.id)).not.toHaveAttribute('data-lit');
    }
    expect(problems).toEqual([]);
  });

  test('a document chosen in the key keeps its topics in the light until it is let go', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    await openApp(page, { project: id, scene: 'ground' });

    const doc = record.documents[0]!;
    const citing = record.graph!.nodes.filter((node) =>
      node.sourceIds.some((cited) => passages.find((p) => p.id === cited)?.documentId === doc.id),
    );
    const chip = page.getByRole('button', {
      name: `${doc.id}: ${doc.name}, cited by ${citing.length} topics`,
    });
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0);
    for (const node of record.graph!.nodes) {
      const lit = citing.some((other) => other.id === node.id);
      if (lit) await expect(topic(page, node.label)).toHaveAttribute('data-lit', '');
      else await expect(topic(page, node.label)).toHaveAttribute('data-dim', '');
    }
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(topic(page, citing[0]!.label)).not.toHaveAttribute('data-dim');
    expect(problems).toEqual([]);
  });
});

test.describe('the sources', () => {
  test('a source opens in a sheet with its whole text exactly as it was given, and its passages marked', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    await openApp(page, { project: id, scene: 'ground' });

    const doc = record.documents[0]!;
    const own = passages.filter((passage) => passage.documentId === doc.id);
    const opener = sourcesSection(page).getByRole('button', { name: doc.name, exact: true });
    await opener.click();
    const dialog = sheet(page);
    await expect(dialog.getByRole('heading', { level: 2, name: doc.name })).toBeVisible();
    await expect(dialog).toContainText(`Document · ${doc.id}`);
    await expect(dialog).toContainText(
      `${doc.content.length.toLocaleString('en-GB')} characters · ${own.length} passages`,
    );
    // What is drawn is the text of the source, character for character (the passage numbers between the words are marks, not text).
    expect(squash(await documentTextOf(dialog))).toBe(squash(doc.content));
    // A sample says what it is, wherever its words are read.
    await expect(dialog).toContainText('Illustrative text, not real information.');

    const chips = dialog
      .getByRole('list', { name: 'Passages in this document' })
      .getByRole('button');
    await expect(chips).toHaveText(own.map((passage) => passage.id));
    await chips.first().click();
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expectSound(page, 'ground: a source open in the sheet');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('a passage chosen in the sheet can be let go again, and the page carries on', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    await openApp(page, { project: id, scene: 'ground' });
    const doc = (await recordOf(request, id)).documents[0]!;
    await sourcesSection(page).getByRole('button', { name: doc.name, exact: true }).click();
    const chip = sheet(page)
      .getByRole('list', { name: 'Passages in this document' })
      .getByRole('button')
      .first();
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await chip.click();
    await expect(page.getByRole('heading', { name: /didn.t render correctly/u })).toHaveCount(0);
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(sheet(page).getByRole('heading', { level: 2, name: doc.name })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a passage opens with the words that were quoted marked in it, in the passage and in the whole source', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'ground');
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    const conflict = (await ledgerOf(request, id)).contradictions[0]!;
    await openApp(page, { project: id, scene: 'ground' });

    // The passage is opened from the conflict's own side, and from the list of sources, to the same words.
    const card = conflictCard(page, conflict.id);
    await card
      .getByRole('button', { name: `${conflict.left.documentName} ${conflict.left.passageId}` })
      .click();
    const dialog = sheet(page);
    const passage = passages.find((item) => item.id === conflict.left.passageId)!;
    await expect(dialog.getByRole('heading', { level: 2, name: passage.id })).toBeVisible();
    await expect(dialog).toContainText(`Passage · ${passage.documentName}`);
    expect(squash(await dialog.locator('blockquote').innerText())).toBe(squash(passage.text));
    await expect(dialog.locator('mark')).toHaveText(conflict.left.quote!);
    await expect(dialog).toContainText('The marked words are in it exactly as written.');
    // It says where the passage is used: the conflict it is in.
    await expect(
      dialog.getByRole('region', { name: 'Where it is used' }).getByRole('button', {
        name: `Conflict ${conflict.id}`,
      }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Read in the document' }).click();
    const doc = record.documents.find((item) => item.id === passage.documentId)!;
    await expect(dialog.getByRole('heading', { level: 2, name: doc.name })).toBeVisible();
    await expect(dialog.locator('mark')).toHaveText(conflict.left.quote!);
    expect(squash(await documentTextOf(dialog))).toBe(squash(doc.content));
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog.getByRole('heading', { level: 2, name: passage.id })).toBeVisible();
    await expectSound(page, 'ground: a passage with its quote marked');

    expect(problems).toEqual([]);
  });

  test('a passage in the list of sources leads to the conflict it is in, and the focus goes there too', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'ground');
    const conflict = (await ledgerOf(request, id)).contradictions[0]!;
    await openApp(page, { project: id, scene: 'ground' });

    await passageButton(page, conflict.left.passageId).click();
    await sheet(page)
      .getByRole('button', { name: `Conflict ${conflict.id}` })
      .click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(conflictCard(page, conflict.id)).toBeInViewport();
    await expect(conflictCard(page, conflict.id)).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('a passage can be found by its number or by a word, and one that is not there says so', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const passages = await passagesOf(request, id);
    await openApp(page, { project: id, scene: 'ground' });

    await figure(page, 'Passages').click();
    const dialog = sheet(page);
    await expect(
      dialog.getByRole('heading', { level: 2, name: 'Search the sources' }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      `${passages.length} passages, numbered S1 to S${passages.length}.`,
    );
    const hits = dialog.getByRole('list').getByRole('listitem');
    await expect(hits).toHaveCount(passages.length);

    const search = dialog.getByRole('searchbox', { name: 'Search the passages' });
    const wanted = passages[2]!;
    await search.fill(wanted.id);
    await search.press('Enter');
    await expect(hits).toHaveCount(1);
    await expect(hits.first()).toContainText(wanted.documentName);
    await hits.first().getByRole('button').click();
    await expect(dialog.getByRole('heading', { level: 2, name: wanted.id })).toBeVisible();
    expect(squash(await dialog.locator('blockquote').innerText())).toBe(squash(wanted.text));
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(
      dialog.getByRole('heading', { level: 2, name: 'Search the sources' }),
    ).toBeVisible();

    // A word: every passage that holds it is found, and a word that no passage holds finds nothing.
    const word = /\b(?:delivery|checkout)\b/iu.exec(wanted.text)?.[0]?.toLowerCase() ?? 'delivery';
    await search.fill(word);
    await search.press('Enter');
    // The server answers with the best few, never more than five: each of them holds the word.
    const holding = passages.filter((passage) => passage.text.toLowerCase().includes(word));
    await expect(hits).toHaveCount(Math.min(5, holding.length));
    for (const hit of await hits.all()) {
      await expect(hit).toContainText(new RegExp(escapeRegExp(word), 'iu'));
    }
    await search.fill('zzzzzzzz');
    await search.press('Enter');
    await expect(dialog.getByText('Nothing matched')).toBeVisible();
    await expect(hits).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('an id the record cannot place is a passage that says it is not there, not a blank', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'ground');
    // A topic that cites a passage nobody cut: the page must say so rather than show nothing.
    await page.route(`**/api/projects/${id}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        graph: { nodes: { sourceIds: string[] }[] };
      };
      body.graph.nodes[0]!.sourceIds = [...body.graph.nodes[0]!.sourceIds, 'S999'];
      await route.fulfill({ response, json: body });
    });
    await openApp(page, { project: id, scene: 'ground' });
    const first = (await recordOf(request, id)).graph!.nodes[0]!;
    await topic(page, first.label).click();
    await topicDetails(page, first.label)
      .getByRole('region', { name: 'Passages' })
      .getByRole('button', { name: 'S999', exact: true })
      .click();
    const dialog = sheet(page);
    await expect(dialog.getByRole('heading', { level: 2, name: 'S999 is not here' })).toBeVisible();
    await expect(dialog).toContainText('No passage with that name is recorded for this project.');
    await expectSound(page, 'ground: a passage that is not in the record');
    expect(problems).toEqual([]);
  });
});

test.describe('conflicts between sources', () => {
  test('a conflict shows both sides with their figures and the words they are in, taken from the sources', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'ground');
    const record = await recordOf(request, id);
    const conflict = (await ledgerOf(request, id)).contradictions[0]!;
    await openApp(page, { project: id, scene: 'ground' });

    const card = conflictCard(page, conflict.id);
    await expect(card).toHaveAccessibleName(
      `${conflict.id}: ${conflict.leftValue} against ${conflict.rightValue}`,
    );
    await expect(card).toContainText('Possible conflict');
    await expect(card).toContainText('Different figures');
    for (const side of [conflict.left, conflict.right]) {
      const figureOfSide = card.getByRole('figure', {
        name: `${side.documentName} ${side.passageId}`,
      });
      const value = side === conflict.left ? conflict.leftValue! : conflict.rightValue!;
      await expect(figureOfSide).toContainText(value);
      await expect(figureOfSide.locator('mark')).toHaveText(value);
      // What the card quotes is in the source, word for word.
      const words = await figureOfSide.locator('blockquote').innerText();
      expect(inDocuments(words, record.documents), `“${words}” is in a source`).toBe(true);
    }
    await expect(conflictsSection(page)).toContainText(
      'Found from wording alone. Neither side is declared true.',
    );

    // How it was found, in the engine's own terms.
    await card.getByRole('button', { name: 'How it was found' }).click();
    const how = page.getByRole('dialog', { name: 'How this conflict was found' });
    await expect(how).toContainText('Found by wording alone');
    await expect(how).toContainText(`${Math.round(conflict.confidence * 100)}% alike`);
    for (const word of conflict.topic.split(/\s+/u)) await expect(how).toContainText(word);
    await expect(how).toContainText('Neither is declared true.');
    expect(problems).toEqual([]);
  });

  test('a conflict can be confirmed, then dismissed, and the decision survives a reload', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'ground');
    await openApp(page, { project: id, scene: 'ground' });
    const card = conflictCard(page, 'X1');
    const heading = (open: number) =>
      page.getByRole('heading', { level: 2, name: `Conflicts ${open}` });

    await card.getByRole('button', { name: 'Add a note' }).click();
    await card
      .getByRole('textbox', { name: 'Note' })
      .fill('The council counts crossings; the operator counts tickets.');
    await card.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(card.getByText('Confirmed conflict', { exact: true })).toBeVisible();
    await expect(card).toContainText('The council counts crossings; the operator counts tickets.');
    await expect(toast(page, 'X1 reviewed')).toBeVisible();
    // A confirmed conflict is still open: it weighs on the statements until it is resolved.
    await expect(heading(1)).toBeVisible();
    await expect(page.locator('#ground-conflicts')).toBeFocused();
    expect((await ledgerOf(request, id)).contradictions[0]).toMatchObject({
      status: 'confirmed',
      note: 'The council counts crossings; the operator counts tickets.',
    });

    await card.getByRole('button', { name: 'Not a conflict' }).click();
    await expect(heading(0)).toBeVisible();
    await expect(conflictsSection(page)).toContainText('All reviewed');
    const reviewed = conflictsSection(page).getByRole('button', { name: /^Reviewed · 1/u });
    await expect(reviewed).toHaveAttribute('aria-expanded', 'true');
    await expect(card.getByText('Dismissed', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expect(figure(page, 'Conflicts')).toContainText('all reviewed');
    expect(await figureValue(page, 'Conflicts')).toBe(0);
    await expectSound(page, 'ground: a conflict that was dismissed');

    // The decision is the server's, not the page's.
    await page.reload();
    await expect(heading(0)).toBeVisible();
    await expect(conflictCard(page, 'X1').getByText('Dismissed', { exact: true })).toBeVisible();
    expect(await figureValue(page, 'Conflicts')).toBe(0);
    await expect(figure(page, 'Conflicts')).toContainText('all reviewed');
    expect((await ledgerOf(request, id)).contradictions.map((item) => item.status)).toEqual([
      'dismissed',
    ]);
    expect(problems).toEqual([]);
  });

  test('a decision can be changed, and the trail and the export carry every one of them', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'ground');
    await openApp(page, { project: id, scene: 'ground' });
    const card = conflictCard(page, 'X1');

    await card.getByRole('button', { name: 'Not a conflict' }).click();
    await expect(card.getByText('Dismissed', { exact: true })).toBeVisible();
    // Changing a decision asks for it again: the buttons are back, with a way out.
    await card.getByRole('button', { name: 'Change decision' }).click();
    await expect(card.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await card.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(card.getByText('Resolved', { exact: true })).toBeVisible();
    expect((await ledgerOf(request, id)).contradictions[0]?.status).toBe('resolved');

    // Both decisions are in the tamper-evident trail of the project, and the chain of the trail holds.
    const audit = await request.get(`/api/projects/${id}/audit`);
    const actions = ((await audit.json()) as { events: { action: string }[] }).events.map(
      (event) => event.action,
    );
    expect(actions.filter((action) => action === 'conflict.reviewed')).toHaveLength(2);
    const verified = await request.get('/api/audit/verify');
    expect(((await verified.json()) as { ok: boolean }).ok).toBe(true);

    // The export is the record: the ledger with the conflict as it was decided last. A project has one once its report
    // is written, so the rest of the guided steps are taken over HTTP.
    for (const next of ['environment', 'simulation', 'report'] as const) {
      await runStep(request, id, next);
    }
    const json = await request.get(`/api/projects/${id}/export?format=json`);
    const body = (await json.json()) as { ledger: { contradictions: { status: string }[] } | null };
    expect(body.ledger?.contradictions.map((conflict) => conflict.status)).toEqual(['resolved']);
    const markdown = await (await request.get(`/api/projects/${id}/export?format=markdown`)).text();
    expect(markdown).toContain('## Evidence ledger');
    expect(markdown).toContain('Resolved');
    expect(problems).toEqual([]);
  });

  test('the arc between two sources leads to the conflict it stands for', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'ground');
    const conflict = (await ledgerOf(request, id)).contradictions[0]!;
    await openApp(page, { project: id, scene: 'ground' });

    const arc = sourcesSection(page)
      .getByRole('group', { name: 'Conflicts between documents' })
      .getByRole('button');
    await expect(arc).toHaveAccessibleName(
      `${conflict.id}: ${conflict.leftValue} against ${conflict.rightValue}, possible conflict, between ${conflict.left.documentName} and ${conflict.right.documentName}. Show conflict.`,
    );
    // The two passages it joins carry the mark of a conflict that is not settled.
    for (const side of [conflict.left, conflict.right]) {
      await expect(passageButton(page, side.passageId)).toHaveAccessibleName(
        /in a conflict that is not settled$/u,
      );
    }
    await arc.focus();
    await page.keyboard.press('Enter');
    await expect(conflictCard(page, conflict.id)).toBeFocused();
    await expect(page).toHaveURL(/[?&]view=conflicts(?:&|$)/u);
    expect(problems).toEqual([]);
  });

  test('sources that agree have nothing to settle, and the page says what it compared and what it can miss', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, AGREE, 'ground');
    expect((await ledgerOf(request, id)).contradictions).toEqual([]);
    await openApp(page, { project: id, scene: 'ground' });

    expect(await figureValue(page, 'Conflicts')).toBe(0);
    await expect(figure(page, 'Conflicts')).toContainText('none found');
    await expect(conflictsSection(page)).toContainText('No conflicts found between the sources');
    await expect(conflictsSection(page)).toContainText(
      'A disagreement that needs interpretation can be missed.',
    );
    await expect(
      sourcesSection(page).getByRole('group', { name: 'Conflicts between documents' }),
    ).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});

test.describe('the engine’s record and the method', () => {
  test('how the sources were read is one press away, in the engine’s own terms and with its own notes', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    const record = await recordOf(request, id);
    await openApp(page, { project: id, scene: 'ground' });

    await page.getByRole('button', { name: 'Method' }).click();
    const how = page.getByRole('dialog', { name: 'How this was read' });
    await expect(how).toContainText('The sources are cut into numbered passages, S1, S2 and on.');
    await expect(how).toContainText('co-occurrence, not meaning');
    await expect(how).toContainText(
      'Sample evidence is synthetic: illustrative, not real information.',
    );
    const notes = await openDisclosure(how, 'Notes from the engine');
    for (const note of record.graph!.notes) await expect(notes).toContainText(note);
    await expectSound(page, 'ground: the method open');
    expect(problems).toEqual([]);
  });

  test('the operations behind the page are listed in Advanced mode, and only there', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    await runStep(request, id, 'environment');
    const record = await recordOf(request, id);
    const traces = (record.console?.traces ?? []).filter((trace) => trace.step === 'knowledge');
    const all = record.console?.traces ?? [];

    // Guided: the page shows what was found, not the log of how.
    await openApp(page, { project: id, scene: 'ground' });
    await expect(operationsSection(page)).toHaveCount(0);

    await inAdvancedMode(page);
    await openApp(page, { project: id, scene: 'ground', view: 'trace' });
    await expect(page.locator('#ground-trace')).toBeFocused();
    const section = operationsSection(page);
    const body = await openDisclosure(section, `Operations · ${traces.length} recorded`);
    const rows = body.getByRole('button', { expanded: false });
    await expect(rows).toHaveCount(traces.length);
    for (const trace of traces) {
      const row = body.getByRole('button', { name: new RegExp(escapeRegExp(trace.name), 'u') });
      await expect(row).toContainText(trace.kind);
      await expect(row).toContainText(trace.status === 'completed' ? 'Completed' : 'Failed');
    }
    // A row opens to what went in and what came out, exactly as the engine recorded them.
    const first = traces[0]!;
    const row = body.getByRole('button', { name: new RegExp(escapeRegExp(first.name), 'u') });
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    const item = body.getByRole('listitem').filter({
      has: page.getByRole('button', { name: new RegExp(escapeRegExp(first.name), 'u') }),
    });
    await expect(item.locator('pre').first()).toHaveText(JSON.stringify(first.input, null, 2));
    // Every step's operations, not only this one's.
    await body.getByText('All steps', { exact: true }).click();
    await expect(section.getByRole('button', { name: /^Operations ·/u })).toBeVisible();
    await expect(body.locator('li[data-status]')).toHaveCount(all.length);
    // The events the engine recorded, oldest first.
    const events = body.getByRole('log', { name: 'Recorded events' }).getByRole('listitem');
    await expect(events).toHaveCount(Math.min(record.events.length, 120));
    await expectSound(page, 'ground: the operations open');
    expect(problems).toEqual([]);
  });

  test('the page says what its figures are and what they are not, and never says what will happen', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    await openApp(page, { project: id, scene: 'ground' });
    await topic(page, 'Delivery').click();

    const sentences = await ownSentences(page.getByRole('main'));
    expect(sentences.length).toBeGreaterThan(10);
    expect(claimsAgainst(sentences.join('\n'))).toEqual([]);
    // What a number is, where it is read: an excerpt count, a co-occurrence, a wording match.
    await expect(page.getByText('Shared passages, not meaning')).toBeVisible();
    await expect(conflictsSection(page)).toContainText('Neither side is declared true.');
    expect(problems).toEqual([]);
  });
});

test.describe('while the engine is at work, and when it was not able to finish', () => {
  test('a step that is under way shows the engine’s own steps, and what it has not said is a dash', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'draft');
    const stop = await readProjectAs(page, id, (project) => {
      const started = new Date(Date.now() - 5_000).toISOString();
      const later = new Date(Date.now() - 4_000).toISOString();
      project.console!.steps.knowledge = 'running';
      project.graph = null;
      project.events = [
        {
          id: 1,
          projectId: id,
          stage: 'knowledge',
          message: 'knowledge started. This stage runs independently and persists its result.',
          createdAt: started,
        },
      ];
      project.console!.traces = [
        {
          id: 'trace-1',
          step: 'knowledge',
          kind: 'model',
          name: 'Ontology definition',
          status: 'completed',
          startedAt: started,
          completedAt: later,
          input: {},
          output: {},
          error: null,
        },
        {
          id: 'trace-2',
          step: 'knowledge',
          kind: 'model',
          name: 'Source graph construction',
          status: 'running',
          startedAt: later,
          completedAt: null,
          input: {},
          output: null,
          error: null,
        },
      ];
    });
    await openApp(page, { project: id, scene: 'ground' });

    await expect(hero(page, SHOP).getByText('Reading', { exact: true })).toBeVisible();
    const progress = page.getByRole('list', { name: 'Progress' });
    await expect(progress.getByRole('listitem')).toHaveCount(3);
    await expect(progress.getByRole('listitem').nth(0)).toContainText('Entity types');
    await expect(progress.getByRole('listitem').nth(0)).toContainText('done');
    await expect(progress.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(progress.getByRole('listitem').nth(1)).toContainText('in progress');
    await expect(progress.getByRole('listitem').nth(2)).toContainText('waiting');
    await expect(
      page.getByRole('status').filter({ hasText: 'Reading the sources.' }),
    ).toBeAttached();
    // What is known (the sources and their passages) is a number; what the engine has not read yet is a dash.
    expect(await figureValue(page, 'Sources')).toBe(SHOP.documents.length);
    await expect(figure(page, 'Topics').getByRole('img', { name: 'Not known yet' })).toBeVisible();
    await expect(
      figure(page, 'Conflicts').getByRole('img', { name: 'Not known yet' }),
    ).toBeVisible();
    await expect(graph(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ground it', exact: true })).toHaveCount(0);
    await expectSound(page, 'ground: working');

    // When the server says the step is done the page shows the result, without being reloaded.
    await stop();
    await expect(hero(page, SHOP).getByText('Ready', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(problems).toEqual([]);
  });

  test('a step that failed says why, in the engine’s words, and trying again really does it again', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'draft');
    const reason = 'The model could not be reached, so the sources were not read.';
    const restore = await readProjectAs(page, id, (project) => {
      project.console!.steps.knowledge = 'failed';
      project.error = reason;
    });
    await openApp(page, { project: id, scene: 'ground' });

    await expect(hero(page, SHOP).getByText('Failed', { exact: true })).toBeVisible();
    const alert = hero(page, SHOP).getByRole('alert');
    await expect(alert).toContainText('Reading the sources failed');
    await expect(alert).toContainText(reason);
    await expectLocked(page, 'map');
    await expectSound(page, 'ground: failed');

    await restore();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(hero(page, SHOP).getByText('Ready', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect((await recordOf(request, id)).console?.steps.knowledge).toBe('ready');
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a step that was stopped says so, and offers to start again', async ({ page, request }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'draft');
    await readProjectAs(page, id, (project) => {
      project.console!.steps.knowledge = 'cancelled';
    });
    await openApp(page, { project: id, scene: 'ground' });

    await expect(hero(page, SHOP).getByText('Stopped', { exact: true })).toBeVisible();
    await expect(hero(page, SHOP)).toContainText('Stopped before it finished');
    await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toHaveCount(0);
    await expectSound(page, 'ground: stopped');
    expect(problems).toEqual([]);
  });
});

test.describe('on every screen', () => {
  for (const viewport of viewports) {
    test(`fits at ${viewport.name}: nothing runs off the screen, the text reads, and axe is clean in every theme`, async ({
      page,
      request,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const id = await makeProject(request, FERRY, 'ground');
      const record = await recordOf(request, id);
      const label = (what: string, theme: string) =>
        `ground at ${viewport.name}, ${theme}: ${what}`;

      for (const theme of THEMES) {
        await openApp(page, { project: id, scene: 'ground', theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(graph(page)).toBeVisible();
        await expectSound(page, label('the page', theme));
        if (theme === 'light') {
          // The panel of a topic, and a conflict that was settled.
          const first = record.graph!.nodes[0]!;
          await topic(page, first.label).click();
          await expect(topicDetails(page, first.label)).toBeVisible();
          await expectSound(page, label('a topic open', theme));
          await page.keyboard.press('Escape');
        }
        // The sheet that reads a source.
        await sourcesSection(page)
          .getByRole('button', { name: record.documents[0]!.name, exact: true })
          .click();
        await expect(sheet(page)).toBeVisible();
        await expectSound(page, label('a source open in the sheet', theme));
        await expect(sheet(page).getByRole('button', { name: 'Done' })).toBeInViewport();
        await page.keyboard.press('Escape');
      }
      expect(problems).toEqual([]);
    });
  }

  test('every control a pointer has to reach is large enough: on the page, in the panel of a topic and in the sheet', async ({
    page,
    request,
  }) => {
    const id = await makeProject(request, FERRY, 'ground');
    const first = (await recordOf(request, id)).graph!.nodes[0]!;
    await openApp(page, { project: id, scene: 'ground' });
    await expectReachable(page, 'ground: the page');
    await topic(page, first.label).click();
    await expectReachable(page, 'ground: a topic open');
    await page.keyboard.press('Escape');
    await passageButton(page, 'S1').click();
    await expectReachable(page, 'ground: a passage open in the sheet');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the page, the panel of a topic and the sheet fit the screen, and the sheet comes from the bottom', async ({
      page,
      request,
    }) => {
      const problems = watchPage(page);
      const id = await makeProject(request, FERRY, 'ground');
      const record = await recordOf(request, id);
      await openApp(page, { project: id, scene: 'ground' });
      await expectSound(page, 'ground on a phone: the page');
      await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible();

      const first = record.graph!.nodes[0]!;
      await topic(page, first.label).tap({ force: true });
      const details = topicDetails(page, first.label);
      await expect(details).toBeVisible();
      await expectControlsInside(details, 'the panel of a topic on a phone');
      await expectSound(page, 'ground on a phone: a topic open');
      await page.getByRole('button', { name: 'Close', exact: true }).tap();

      await passageButton(page, 'S1').tap();
      await expect(sheet(page)).toBeVisible();
      const box = (await sheet(page).boundingBox())!;
      // A sheet on a phone sits at the bottom edge and spans the width.
      expect(box.x).toBeLessThanOrEqual(1);
      expect(box.x + box.width).toBeGreaterThanOrEqual(389);
      expect(box.y + box.height).toBeGreaterThanOrEqual(843);
      await expectControlsInside(sheet(page), 'the sheet on a phone');
      await expectSound(page, 'ground on a phone: a passage open');
      expect(problems).toEqual([]);
    });

    test('every control is large enough for a finger: on the page and in the sheet', async ({
      page,
      request,
    }) => {
      const id = await makeProject(request, FERRY, 'ground');
      await openApp(page, { project: id, scene: 'ground' });
      await expectTouchTargets(page, 'ground on a phone: the page', 'main');
      await passageButton(page, 'S1').tap();
      await expect(sheet(page)).toBeVisible();
      await expectTouchTargets(page, 'ground on a phone: the sheet', '[role="dialog"]');
    });
  });
});

/** The accessible name of the element that has the focus. */
const focusedLabel = (page: Page): Promise<string> =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');

const centre = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The element is not drawn.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** The part of the page a link named is in the screen; where it is a part with a heading, the heading has the focus. */
async function expectAt(page: Page, view: (typeof GROUND_VIEWS)[number]): Promise<void> {
  if (view === 'graph') {
    await expect(graph(page)).toBeInViewport({ ratio: 0.5 });
    return;
  }
  const anchor = page.locator(`#ground-${view}`);
  await expect(anchor).toBeFocused();
  await expect(anchor).toBeInViewport();
}
