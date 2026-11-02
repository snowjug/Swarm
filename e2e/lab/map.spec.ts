import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  TRAIT_KEYS,
  type StakeholderCategory,
} from '../../shared/stakeholders';
import { expectScene, openApp } from '../support/app';
import { openDisclosure, watchPage } from '../support/helpers';
import { claimsAgainst, squash } from '../support/lab-api';
import {
  CITY,
  FERRY,
  ORIGIN_WORDS,
  TRAIT_NAMES,
  actorsViewOf,
  apartFromDisclaimers,
  deleteMade,
  ecosystem,
  escapeRegExp,
  exampleSeed,
  expectSound,
  findWho,
  gapNodes,
  headline,
  inDocuments,
  inspector,
  live,
  makeProject,
  mapControls,
  mapRegion,
  ownSentences,
  party,
  pill,
  partyNames,
  partyNodes,
  passagesOf,
  recordOf,
  roster,
  rosterRow,
  stakeholdersViewOf,
  toast,
  traitSlider,
  unquoted,
} from '../support/ground-map';

// The Map scene, on the rules-mode server and through the real page: who is in play. The stakeholders are found by
// reading the text, so what the page shows is checked against what the server holds of the project (the stakeholders
// it found, the passages they cite, the documents those are cut from), never against a number from a fixture. Nothing
// here needs a model.

test.use({
  actionTimeout: 15_000,
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
});
test.afterEach(({ request }) => deleteMade(request));

const SHOP = exampleSeed('ecommerce-experience');
const SYNTHETIC =
  'Actors are synthetic stand-ins, not real people: every number is an assumption you can change.';

const labelOf = (category: StakeholderCategory): string => STAKEHOLDER_CATEGORY_LABELS[category];

test.describe('finding who is affected', () => {
  test('before anything is found the page says what it will do, that no model is used, and what its actors are', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    await openApp(page, { project: id, scene: 'map' });

    await expect(page.getByRole('heading', { level: 1, name: 'Who is in play?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find who is affected' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add one yourself' })).toBeVisible();
    // Without a model on offer there is one way to find them, and the page does not pretend to have two.
    await expect(page.getByRole('button', { name: 'Read the text instead' })).toHaveCount(0);
    await expect(page.getByText(SYNTHETIC)).toBeVisible();
    await expect(partyNodes(page)).toHaveCount(0);

    const how = await openDisclosure(page, 'How stakeholders are found');
    await expect(how).toContainText('Reading the text for roles');
    await expect(how).toContainText('No model is used.');
    await expect(how).toContainText('it misses groups it has no word for');
    await expect(how).toContainText('This project runs without a model');
    await expect(how).toContainText('Swarm explores scenarios; it does not predict');

    await expectSound(page, 'map: before anything is found');
    // What the page says of itself is not a forecast: its denial of one is set apart, and kept.
    const { disclaimers, rest } = apartFromDisclaimers(await ownSentences(page.getByRole('main')));
    expect(disclaimers.join(' ')).toContain('does not predict');
    expect(claimsAgainst(rest.join('\n'))).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('finding them reads the text: one party for each stakeholder the engine found, as many as need review', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'ground');
    await openApp(page, { project: id, scene: 'map' });

    await findWho(page);
    const view = await stakeholdersViewOf(request, id);
    const found = live(view);
    expect(found.length).toBeGreaterThanOrEqual(5);

    // One party for each stakeholder that is not removed, named as the engine named it.
    expect((await partyNames(page)).sort()).toEqual(found.map((item) => item.name).sort());
    await expect
      .poll(() => headline(page))
      .toEqual({
        total: found.length,
        key: found.filter((item) => item.priority === 'key').length,
        toReview: found.filter((item) => item.status === 'proposed').length,
      });
    expect(found.every((item) => item.status === 'proposed')).toBe(true);

    // How they were found, said in the engine's own words and with what it could not do.
    await page.getByRole('button', { name: 'Read from your text' }).click();
    const how = page.getByRole('dialog').filter({ hasText: 'How these were found' });
    await expect(how).toContainText('Swarm read your text for role words');
    await expect(how).toContainText('No model was used.');
    await expect(how).toContainText(view.stakeholders!.discovery.note);
    await page.keyboard.press('Escape');

    // The place of a kind of party that nobody was found for is a gap on the map, to be filled by hand.
    const wanted = gapsShown(
      view.stakeholders!.gaps,
      found.map((item) => item.category),
    );
    await expect(gapNodes(page)).toHaveCount(wanted.length);
    for (const label of wanted) {
      await expect(
        mapRegion(page).getByRole('button', { name: `Nobody found for ${label}. Add one` }),
      ).toBeVisible();
    }
    expect(problems).toEqual([]);
  });

  test('after it finds them the keyboard is not left on nothing: the button that was pressed is gone', async ({
    page,
    request,
  }) => {
    const id = await makeProject(request, SHOP, 'ground');
    await openApp(page, { project: id, scene: 'map' });
    await page.getByRole('button', { name: 'Find who is affected' }).focus();
    await page.keyboard.press('Enter');
    await expect(ecosystem(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find who is affected' })).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Stakeholders found.' }),
    ).toBeAttached();
    // Two frames on, so that nothing that is still on its way out can be what has the focus.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(page.locator('body')).not.toBeFocused();
    await expect(page.locator('main :focus')).toHaveCount(1);
  });

  test('every stakeholder that cites a passage cites words that really are in the sources, and the others say they are assumed', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const record = await recordOf(request, id);
    const passages = await passagesOf(request, id);
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map', view: 'list' });

    for (const stakeholder of found) {
      // What the server holds: each quote is in a source, and the passage it names holds it.
      for (const ref of stakeholder.evidence) {
        if (!ref.quote) continue;
        const cited = passages.find((passage) => passage.id === ref.passageId);
        expect(cited?.documentName, `${stakeholder.name} cites ${ref.passageId}`).toBe(
          ref.documentName,
        );
        expect(inDocuments(ref.quote, record.documents), `“${ref.quote}” is in a source`).toBe(
          true,
        );
      }
      // What the page shows of it.
      await rosterRow(page, stakeholder.name).click();
      const open = inspector(page, stakeholder.name);
      // The panel changes over from one party to the next: what is read is read once it is this party's.
      await expect(open.getByRole('heading', { level: 2, name: stakeholder.name })).toBeVisible();
      const quotes = open.locator('blockquote');
      const withQuote = stakeholder.evidence.filter((ref) => ref.quote);
      if (stakeholder.evidence.length > 0) {
        const evidence = await openDisclosure(
          open,
          new RegExp(`^Evidence ${stakeholder.evidence.length}$`, 'u'),
        );
        await expect(quotes).toHaveCount(withQuote.length);
        for (const text of await quotes.allInnerTexts()) {
          expect(inDocuments(unquoted(text), record.documents), `“${text}” is in a source`).toBe(
            true,
          );
        }
        for (const ref of stakeholder.evidence) {
          await expect(evidence).toContainText(ref.documentName);
          await expect(evidence).toContainText(ref.passageId);
        }
      } else {
        await expect(open).toContainText('Assumption, not evidence.');
      }
    }
    expect(problems).toEqual([]);
  });

  for (const [name, seed] of [
    ['Copilot in Teams', exampleSeed('copilot-in-teams')],
    ['a regional price change', exampleSeed('regional-price-change')],
    ['an online store', SHOP],
    ['a city congestion charge, which no example knows', CITY],
  ] as const) {
    test(`works for any domain: ${name}`, async ({ page, request }) => {
      const problems = watchPage(page);
      const id = await makeProject(request, seed, 'ground');
      const record = await recordOf(request, id);
      await openApp(page, { project: id, scene: 'map' });

      await findWho(page);
      const found = live(await stakeholdersViewOf(request, id));
      expect(found.length).toBeGreaterThanOrEqual(3);
      await expect.poll(async () => (await partyNames(page)).length).toBe(found.length);
      // Whatever the domain, what a stakeholder cites is in the project's own sources, and a party that was found by
      // reading the text is a party the text names.
      const text = squash([seed.question, ...record.documents.map((doc) => doc.content)].join(' '));
      for (const stakeholder of found) {
        for (const ref of stakeholder.evidence) {
          if (ref.quote) expect(inDocuments(ref.quote, record.documents)).toBe(true);
        }
        if (stakeholder.origin === 'rules' || stakeholder.origin === 'scenario') {
          for (const word of squash(stakeholder.name).split(' ')) {
            expect(text, `the sources name “${stakeholder.name}”`).toContain(
              word.replace(/(?:ies|es|s)$/u, ''),
            );
          }
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

test.describe('the picture of who is in play', () => {
  test('a party is chosen by pressing it, shows what it is, and is let go by its close button or by pressing the background', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    const sellers = found.find((item) => item.name === 'Sellers')!;
    await party(page, 'Sellers').click();
    await expect(party(page, 'Sellers')).toHaveAttribute('aria-pressed', 'true');
    const open = inspector(page, 'Sellers');
    await expect(open.getByRole('heading', { level: 2, name: 'Sellers' })).toBeVisible();
    await expect(open).toContainText(`${labelOf(sellers.category)} · Key actor`);

    // Another party takes its place; the first is no longer pressed.
    await party(page, 'Buyers').click();
    await expect(party(page, 'Buyers')).toHaveAttribute('aria-pressed', 'true');
    await expect(party(page, 'Sellers')).toHaveAttribute('aria-pressed', 'false');
    await expect(
      inspector(page, 'Buyers').getByRole('heading', { level: 2, name: 'Buyers' }),
    ).toBeVisible();

    // Its close button lets it go, and the focus goes back to the party on the map.
    await inspector(page, 'Buyers').getByRole('button', { name: 'Close' }).click();
    await expect(inspector(page, 'Buyers')).toHaveCount(0);
    await expect(party(page, 'Buyers')).toBeFocused();
    await expect(party(page, 'Buyers')).toHaveAttribute('aria-pressed', 'false');

    // Pressing the empty background lets go too.
    await party(page, 'Sellers').click();
    await expect(inspector(page, 'Sellers')).toBeVisible();
    await ecosystem(page).click({ position: { x: 12, y: 160 } });
    await expect(inspector(page, 'Sellers')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('from the keyboard the map is one tab stop, the arrows move between parties, Enter and Space choose and Escape lets go', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    // Exactly one party takes the focus from Tab.
    await expect(ecosystem(page).locator('[tabindex="0"]')).toHaveCount(1);
    const start = party(page, 'Customers');
    await start.focus();
    await expect(start).toBeFocused();

    // An arrow goes to the nearest party in that direction, and never to one the other way.
    let moved = 0;
    for (const [key, toward] of [
      ['ArrowRight', (a: Point, b: Point) => b.x > a.x],
      ['ArrowLeft', (a: Point, b: Point) => b.x < a.x],
      ['ArrowDown', (a: Point, b: Point) => b.y > a.y],
      ['ArrowUp', (a: Point, b: Point) => b.y < a.y],
    ] as const) {
      const from = await focusedNode(page);
      const before = await centreOf(from);
      await page.keyboard.press(key);
      const after = await focusedNode(page);
      if ((await after.getAttribute('aria-label')) === (await from.getAttribute('aria-label')))
        continue;
      moved += 1;
      expect(toward(before, await centreOf(after)), `${key} goes that way`).toBe(true);
      // The way back is a different party's choice, but the focus is always on one party, and only one.
      await expect(ecosystem(page).locator('[tabindex="0"]')).toHaveCount(1);
    }
    expect(moved).toBeGreaterThanOrEqual(3);

    // Enter chooses, Space lets go (it is the same press), Escape lets go of a chosen party.
    const here = await focusedNode(page);
    const name = ((await here.getAttribute('aria-label')) ?? '').split(', ')[0]!;
    await page.keyboard.press('Enter');
    await expect(inspector(page, name)).toBeVisible();
    await expect(here).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(inspector(page, name)).toHaveCount(0);
    await expect(here).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await expect(inspector(page, name)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inspector(page, name)).toHaveCount(0);
    await expect(here).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('focus mode keeps the chosen party and what it is connected to in the light, and F turns it on and off', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const view = await stakeholdersViewOf(request, id);
    const found = live(view);
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    const focusMode = mapControls(page).getByRole('button', { name: 'Focus on what is connected' });
    // Nothing is chosen, so there is nothing to focus on.
    await expect(focusMode).toBeDisabled();

    // A party with relations: the parties in the light are it and those it is connected to, as the server holds them.
    const chosen = found.find((item) => item.name === 'Customers')!;
    const connected = new Set<string>();
    for (const relation of view.stakeholders!.relations) {
      if (relation.from === chosen.id) connected.add(relation.to);
      if (relation.to === chosen.id) connected.add(relation.from);
    }
    const lit = [chosen.id, ...connected].map(
      (partyId) => found.find((item) => item.id === partyId)!.name,
    );
    await party(page, chosen.name).click();
    await expect(focusMode).toBeEnabled();
    await expect(focusMode).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => inTheLight(page)).toEqual(lit.sort());
    const connections = await openDisclosure(
      inspector(page, chosen.name),
      new RegExp(`^Connections ${connected.size}$`, 'u'),
    );
    await expect(connections.getByRole('button')).toHaveCount(connected.size);

    await page.keyboard.press('f');
    await expect(focusMode).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => inTheLight(page)).toEqual(found.map((item) => item.name).sort());
    await page.keyboard.press('f');
    await expect(focusMode).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => inTheLight(page)).toEqual(lit.sort());
    expect(problems).toEqual([]);
  });

  test('the groups can be hidden one by one, on the map and in the list, and shown again', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    await mapControls(page).getByRole('button', { name: 'Groups', exact: true }).click();
    const groups = page.getByRole('dialog').getByRole('switch');
    const labels = await groups.allInnerTexts();
    expect(labels.length).toBeGreaterThanOrEqual(3);
    // The counts of the groups add up to the parties found.
    const counts = labels.map((text) => Number(/(\d+)\s*$/u.exec(text.trim())?.[1]));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(found.length);
    await expect(groups.first()).toHaveAttribute('aria-checked', 'true');

    const hidden = counts[0]!;
    await groups.first().click();
    await expect(groups.first()).toHaveAttribute('aria-checked', 'false');
    await expect(partyNodes(page)).toHaveCount(found.length - hidden);
    await page.keyboard.press('Escape');
    await expect(mapControls(page).getByRole('button', { name: 'Groups, 1 hidden' })).toBeVisible();

    // The list leaves the group out too, and the picture says nothing is lost: showing all brings them back.
    await mapControls(page).getByRole('radio', { name: 'List' }).click();
    await expect(page).toHaveURL(/[?&]view=list(?:&|$)/u);
    const headings = roster(page).getByRole('heading', { level: 2 });
    await expect(headings).toHaveCount(labels.length - 1 + (await gapGroup(page)));
    await mapControls(page).getByRole('button', { name: 'Groups, 1 hidden' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Show all' }).click();
    await page.keyboard.press('Escape');
    await mapControls(page).getByRole('radio', { name: 'Map' }).click();
    await expect(partyNodes(page)).toHaveCount(found.length);
    await expect(
      mapControls(page).getByRole('button', { name: 'Groups', exact: true }),
    ).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe('the list, which is the map without a pointer', () => {
  test('has the same parties as the map, in groups, and a row opens the same detail', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const view = await stakeholdersViewOf(request, id);
    const found = live(view);
    const removed = view.stakeholders!.stakeholders.filter((item) => item.status === 'removed');
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    // What is chosen on the map is still chosen in the list.
    await party(page, 'Sellers').click();
    await mapControls(page).getByRole('radio', { name: 'List' }).click();
    await expect(page).toHaveURL(/[?&]view=list(?:&|$)/u);
    await expect(mapControls(page).getByRole('radio', { name: 'List' })).toBeChecked();
    await expect(partyNodes(page)).toHaveCount(0);
    await expect(rosterRow(page, 'Sellers')).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector(page, 'Sellers')).toBeVisible();

    // One row for each party on the map, named the same, and the groups hold as many as there are.
    for (const stakeholder of found) await expect(rosterRow(page, stakeholder.name)).toHaveCount(1);
    const headings = await roster(page).getByRole('heading', { level: 2 }).allInnerTexts();
    const grouped = headings
      .map((text) => /(\d+)\s*$/u.exec(text.trim())?.[1])
      .filter((count): count is string => count !== undefined)
      .map(Number);
    expect(grouped.reduce((sum, count) => sum + count, 0)).toBe(found.length);

    // A press on another row opens that party in its place.
    await rosterRow(page, 'Buyers').click();
    await expect(
      inspector(page, 'Buyers').getByRole('heading', { level: 2, name: 'Buyers' }),
    ).toBeVisible();
    await expect(rosterRow(page, 'Buyers')).toHaveAttribute('aria-pressed', 'true');
    await expect(rosterRow(page, 'Sellers')).toHaveAttribute('aria-pressed', 'false');

    // Where nobody was found, the list says so and offers to add one; what was removed can be restored.
    const gaps = gapsShown(
      view.stakeholders!.gaps,
      found.map((item) => item.category),
    );
    const missing = roster(page).getByRole('region', { name: 'Nobody found for' });
    for (const label of gaps) {
      await expect(missing.getByRole('button', { name: `Add ${label}` })).toBeVisible();
    }
    expect(removed.length).toBeGreaterThan(0);
    const away = await openDisclosure(roster(page), `Removed ${removed.length}`);
    for (const stakeholder of removed) {
      await expect(away).toContainText(`${stakeholder.name}Removed. Any of them can be restored.`);
    }

    // Back to the map: the choice is still there.
    await mapControls(page).getByRole('radio', { name: 'Map' }).click();
    await expect(page).not.toHaveURL(/[?&]view=/u);
    await expect(party(page, 'Buyers')).toHaveAttribute('aria-pressed', 'true');
    expect(problems).toEqual([]);
  });

  test('a row that is pressed takes the focus to the party it opens, also when another party was open', async ({
    page,
    request,
  }) => {
    const id = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: id, scene: 'map', view: 'list' });

    await rosterRow(page, 'Sellers').click();
    await expect(
      inspector(page, 'Sellers').getByRole('heading', { level: 2, name: 'Sellers' }),
    ).toBeFocused();
    await rosterRow(page, 'Buyers').click();
    const heading = inspector(page, 'Buyers').getByRole('heading', { level: 2, name: 'Buyers' });
    await expect(heading).toBeVisible();
    // Once the panel has changed over, the focus is on the new party, not on the one that left.
    await expect(heading).toBeFocused();
  });

  test('a second press on the row of the party that is open puts it away, and the focus stays on the row', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: id, scene: 'map', view: 'list' });

    const row = rosterRow(page, 'Sellers');
    await row.click();
    await expect(inspector(page, 'Sellers')).toBeVisible();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await row.click();
    await expect(inspector(page, 'Sellers')).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await expect(row).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('can be opened by its address, and its rows are reached one by one with Tab', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map', view: 'list' });
    await expect(roster(page)).toBeVisible();
    await expect(mapControls(page).getByRole('radio', { name: 'List' })).toBeChecked();

    // Each party is a button of its own in the list, which the map spares a keyboard (it has one tab stop).
    await mapControls(page).getByRole('radio', { name: 'List' }).focus();
    const rows = roster(page).getByRole('list').getByRole('button').filter({ hasNotText: /^Add / });
    expect(await rows.count()).toBeGreaterThanOrEqual(found.length);
    await rosterRow(page, found[0]!.name).focus();
    await page.keyboard.press('Enter');
    await expect(inspector(page, found[0]!.name)).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe('the detail of a party', () => {
  test('says who it is, how the change lands on it and how sure Swarm is, from what the engine holds of it', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const view = await stakeholdersViewOf(request, id);
    const found = live(view);
    await openApp(page, { project: id, scene: 'map', view: 'list' });

    for (const name of ['Sellers', 'Buyers', 'Phone users', 'Delivery partners']) {
      const stakeholder = found.find((item) => item.name === name)!;
      await rosterRow(page, name).click();
      const open = inspector(page, name);
      await expect(open.getByRole('heading', { level: 2, name })).toBeVisible();
      await expect(open).toContainText(
        `${labelOf(stakeholder.category)} · ${stakeholder.priority === 'key' ? 'Key actor' : 'Cohort'}`,
      );
      await expect(open).toContainText('Proposed');
      const about = open.getByRole('region', { name: 'About this stakeholder' });
      // The way the change lands, and where that reading came from: an assumption or the wording of a cited sentence.
      const direction = {
        harmed: 'Harmed',
        benefited: 'Benefits',
        mixed: 'Mixed',
        unclear: 'Unclear',
      }[stakeholder.expectedImpact.direction];
      await expect(about).toContainText(direction);
      await expect(about).toContainText(
        stakeholder.expectedImpact.origin === 'evidence' ? 'read from the wording' : 'assumption',
      );
      await expect(about).toContainText(
        stakeholder.directness === 'direct' ? 'Direct' : 'Indirect',
      );
      const priority = {
        key: 'Key actor',
        standard: 'Standard cohort',
        background: 'Background cohort',
      }[stakeholder.priority];
      await expect(about.getByRole('radio', { name: priority })).toBeChecked();
      const confidence = { low: 'high', medium: 'medium', high: 'low' }[
        stakeholder.uncertainty.level
      ];
      await expect(about.getByRole('img', { name: `Confidence: ${confidence}` })).toBeVisible();

      // Why it is here, in full, with what it does not mean.
      const why = await openDisclosure(open, 'Why they are here');
      await expect(why).toContainText(stakeholder.uncertainty.reason);
      await expect(why).toContainText('Found by reading the text.');
      if (stakeholder.priority !== 'key') {
        await expect(why).toContainText(
          `Stands for about ${stakeholder.populationSize.toLocaleString('en-GB')}: a modelling assumption, not a count.`,
        );
      }
      for (const assumption of stakeholder.assumptions) await expect(why).toContainText(assumption);
    }
    expect(problems).toEqual([]);
  });

  test('lists its connections, as many as the engine holds, and a connection opens the party at its other end', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const view = await stakeholdersViewOf(request, id);
    const found = live(view);
    await openApp(page, { project: id, scene: 'map', view: 'list' });

    const chosen = found.find((item) => item.name === 'Sellers')!;
    const relations = view.stakeholders!.relations.filter(
      (relation) =>
        (relation.from === chosen.id || relation.to === chosen.id) &&
        found.some(
          (item) => item.id === (relation.from === chosen.id ? relation.to : relation.from),
        ),
    );
    await rosterRow(page, chosen.name).click();
    const open = inspector(page, chosen.name);
    const connections = await openDisclosure(open, `Connections ${relations.length}`);
    const links = connections.getByRole('button');
    await expect(links).toHaveCount(Math.min(12, relations.length));
    // Each connection says what the other party is to this one, and how strongly.
    for (const relation of relations) {
      const other = found.find(
        (item) => item.id === (relation.from === chosen.id ? relation.to : relation.from),
      )!;
      const link = links.filter({ hasText: other.name });
      await expect(link).toHaveAccessibleName(
        new RegExp(
          `${escapeRegExp(other.name)} strength ${Math.round(relation.strength * 100)} of 100$`,
          'u',
        ),
      );
    }
    const first = relations[0]!;
    const next = found.find(
      (item) => item.id === (first.from === chosen.id ? first.to : first.from),
    )!;
    await links.filter({ hasText: next.name }).first().click();
    await expect(
      inspector(page, next.name).getByRole('heading', { level: 2, name: next.name }),
    ).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe('changing the list of stakeholders', () => {
  test('a stakeholder can be edited: nothing is saved until Save, and what is saved is marked as the person’s own', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map', view: 'list' });

    await rosterRow(page, 'Buyers').click();
    const edit = inspector(page, 'Buyers').getByRole('button', { name: 'Edit Buyers' });
    await edit.click();
    const form = page.getByRole('dialog', { name: 'Edit stakeholder' });
    const name = form.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Buyers');

    // An empty name is refused beside the field, and nothing is sent.
    await name.fill('');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form.getByText('Give the stakeholder a name.')).toBeVisible();
    // Closing it without saving changes nothing.
    await name.fill('Something else entirely');
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    expect(live(await stakeholdersViewOf(request, id)).map((item) => item.name)).toEqual(
      found.map((item) => item.name),
    );

    await edit.click();
    await form.getByRole('textbox', { name: 'Name' }).fill('Frequent buyers');
    await form
      .getByRole('radiogroup', { name: 'How the change lands on them' })
      .getByRole('radio', { name: 'Harmed' })
      .check();
    await form
      .getByRole('textbox', { name: 'Why you think the change lands that way' })
      .fill('The team told us they lose some convenience.');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form).toHaveCount(0);

    // The party carries its new name and says it was edited, and that the direction is the person's.
    const open = inspector(page, 'Frequent buyers');
    await expect(open.getByRole('heading', { level: 2, name: 'Frequent buyers' })).toBeVisible();
    await expect(open).toContainText('Edited by you');
    await expect(open.getByRole('region', { name: 'About this stakeholder' })).toContainText(
      'Harmed',
    );
    await expect(open.getByRole('region', { name: 'About this stakeholder' })).toContainText(
      'set by you',
    );
    await expect(open.locator(':focus')).toHaveCount(1);
    await expect
      .poll(async () => (await headline(page)).toReview)
      .toBe(found.filter((item) => item.status === 'proposed').length - 1);

    // What the server holds is what the page shows.
    const saved = live(await stakeholdersViewOf(request, id)).find((item) => item.id === 'buyers')!;
    expect(saved).toMatchObject({
      name: 'Frequent buyers',
      status: 'edited',
      expectedImpact: {
        direction: 'harmed',
        rationale: 'The team told us they lose some convenience.',
        origin: 'user',
      },
    });
    expect(problems).toEqual([]);
  });

  test('a form that is closed without saving puts the keyboard back on the control that opened it', async ({
    page,
    request,
  }) => {
    const id = await makeProject(request, SHOP, 'proposed');
    await openApp(page, { project: id, scene: 'map', view: 'list' });

    await rosterRow(page, 'Buyers').click();
    const edit = inspector(page, 'Buyers').getByRole('button', { name: 'Edit Buyers' });
    for (const close of ['Escape', 'Cancel'] as const) {
      await edit.click();
      const form = page.getByRole('dialog', { name: 'Edit stakeholder' });
      await expect(form).toBeVisible();
      if (close === 'Escape') await page.keyboard.press('Escape');
      else await form.getByRole('button', { name: 'Cancel' }).click();
      await expect(form).toHaveCount(0);
      await expect(edit, `after ${close}`).toBeFocused();
    }

    const add = mapControls(page).getByRole('button', { name: 'Add a stakeholder' });
    await add.click();
    await expect(page.getByRole('dialog', { name: 'Add a stakeholder' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add a stakeholder' })).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('one can be added by hand, with no evidence, and it says so; a gap on the map is a place to add one', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const view = await stakeholdersViewOf(request, id);
    const found = live(view);
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    await mapControls(page).getByRole('button', { name: 'Add a stakeholder' }).click();
    const form = page.getByRole('dialog', { name: 'Add a stakeholder' });
    await expect(form.getByRole('textbox', { name: 'Name' })).toBeFocused();
    await form.getByRole('button', { name: 'Add stakeholder' }).click();
    await expect(form.getByText('Give the stakeholder a name.')).toBeVisible();
    await form.getByRole('textbox', { name: 'Name' }).fill('Neighbourhood association');
    await form.getByRole('combobox', { name: 'Kind of party' }).selectOption('influencer');
    await form.getByRole('button', { name: 'Add stakeholder' }).click();
    await expect(form).toHaveCount(0);

    await expect(party(page, 'Neighbourhood association')).toHaveAttribute('aria-pressed', 'true');
    const open = inspector(page, 'Neighbourhood association');
    await expect(open).toContainText(`${labelOf('influencer')} · `);
    await expect(open).toContainText('Added by you');
    await openDisclosure(open, 'Evidence 0');
    await expect(open).toContainText('Assumption, not evidence.');
    await expect(open).toContainText(
      'Added by you. Evidence comes from your sources, so none is attached.',
    );
    await expect.poll(async () => (await headline(page)).total).toBe(found.length + 1);
    const added = live(await stakeholdersViewOf(request, id)).find(
      (item) => item.name === 'Neighbourhood association',
    )!;
    expect(added).toMatchObject({
      origin: 'user',
      status: 'added',
      category: 'influencer',
      evidence: [],
    });

    // A place where nobody was found: pressing it starts the form with that kind of party. The map keeps the new party
    // in the light while it is chosen, so it is let go first to see the whole map again.
    await inspector(page, 'Neighbourhood association')
      .getByRole('button', { name: 'Close' })
      .click();
    expect(await gapNodes(page).count()).toBeGreaterThan(0);
    await page
      .getByRole('button', { name: `Nobody found for ${labelOf('decision-maker')}. Add one` })
      .click();
    const second = page.getByRole('dialog', { name: 'Add a stakeholder' });
    await expect(second.getByRole('combobox', { name: 'Kind of party' })).toHaveValue(
      'decision-maker',
    );
    await second.getByRole('textbox', { name: 'Name' }).fill('Programme sponsor');
    await second.getByRole('button', { name: 'Add stakeholder' }).click();
    await expect(second).toHaveCount(0);
    await expect(party(page, 'Programme sponsor')).toBeVisible();
    // The kind has somebody now, so the place for it is gone.
    await expect(
      page.getByRole('button', { name: `Nobody found for ${labelOf('decision-maker')}. Add one` }),
    ).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('one can be removed, which keeps it in the record, and brought back from the message or from the list', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const view = await stakeholdersViewOf(request, id);
    const found = live(view);
    const before = view.stakeholders!.stakeholders.filter(
      (item) => item.status === 'removed',
    ).length;
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    await party(page, 'Specialist').click();
    await inspector(page, 'Specialist').getByRole('button', { name: 'Remove Specialist' }).click();
    await expect(toast(page, 'Removed Specialist')).toBeVisible();
    await expect(party(page, 'Specialist')).toHaveCount(0);
    await expect(partyNodes(page)).toHaveCount(found.length - 1);
    await expect(ecosystem(page).locator(':focus')).toHaveCount(1);
    const gone = (await stakeholdersViewOf(request, id)).stakeholders!.stakeholders.find(
      (item) => item.name === 'Specialist',
    )!;
    expect(gone.status).toBe('removed');

    // The message takes it back.
    await page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('button', { name: 'Undo' })
      .click();
    await expect(party(page, 'Specialist')).toBeVisible();
    await expect(partyNodes(page)).toHaveCount(found.length);
    expect(
      (await stakeholdersViewOf(request, id)).stakeholders!.stakeholders.find(
        (item) => item.name === 'Specialist',
      )!.status,
    ).not.toBe('removed');

    // Or the list does: what was removed is under "Removed", and any of it can be restored. The party that was brought
    // back is the one that is chosen, so it is removed from where it is.
    await expect(party(page, 'Specialist')).toHaveAttribute('aria-pressed', 'true');
    await inspector(page, 'Specialist').getByRole('button', { name: 'Remove Specialist' }).click();
    await mapControls(page).getByRole('radio', { name: 'List' }).click();
    const away = await openDisclosure(roster(page), `Removed ${before + 1}`);
    await away.getByRole('button', { name: /^Specialist/u }).click();
    const open = inspector(page, 'Specialist');
    await expect(open).toContainText('Removed');
    await open.getByRole('button', { name: 'Restore' }).click();
    await expect(rosterRow(page, 'Specialist')).toBeVisible();
    await expect(roster(page).getByRole('button', { name: `Removed ${before}` })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('one can be merged into another, which keeps it in the record under Removed, and the merge can be taken back', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    await party(page, 'Developer').click();
    await inspector(page, 'Developer')
      .getByRole('button', { name: 'Merge Developer into another' })
      .click();
    // Every other live stakeholder is a place to merge into, and the party itself is not.
    const targets = page.getByRole('menu').getByRole('menuitem');
    await expect(targets).toHaveCount(found.length - 1);
    await expect(targets.filter({ hasText: /^Developer$/u })).toHaveCount(0);
    await targets.filter({ hasText: /^Staff$/u }).click();

    await expect(toast(page, 'Merged Developer into Staff')).toBeVisible();
    await expect(party(page, 'Developer')).toHaveCount(0);
    await expect(party(page, 'Staff')).toHaveAttribute('aria-pressed', 'true');
    const after = (await stakeholdersViewOf(request, id)).stakeholders!.stakeholders;
    expect(after.find((item) => item.id === 'developer')?.status).toBe('removed');
    expect(after.find((item) => item.id === 'staff')?.mergedFrom).toContain('developer');
    const why = await openDisclosure(inspector(page, 'Staff'), 'Why they are here');
    await expect(why).toContainText(
      'Merged from 1 other stakeholder; they stay in the record as removed.',
    );

    // The record keeps it, says where it went, and the merge can be undone from there.
    await mapControls(page).getByRole('radio', { name: 'List' }).click();
    const away = await openDisclosure(roster(page), /^Removed \d+$/u);
    await away.getByRole('button', { name: /^Developer/u }).click();
    await expect(inspector(page, 'Developer')).toContainText(
      'Merged into Staff. It stays in the record.',
    );
    await inspector(page, 'Developer').getByRole('button', { name: 'Undo the merge' }).click();
    await expect(rosterRow(page, 'Developer')).toBeVisible();
    const undone = (await stakeholdersViewOf(request, id)).stakeholders!.stakeholders;
    expect(undone.find((item) => item.id === 'developer')?.status).not.toBe('removed');
    expect(undone.find((item) => item.id === 'staff')?.mergedFrom).not.toContain('developer');
    expect(problems).toEqual([]);
  });
});

test.describe('approving the list and making the actors', () => {
  test('approving needs two or more stakeholders, and says so until there are', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, FERRY, 'proposed');
    expect(live(await stakeholdersViewOf(request, id))).toHaveLength(1);
    await openApp(page, { project: id, scene: 'map' });

    const approve = pill(page).getByRole('button', { name: 'Approve & create actors' });
    await expect(pill(page)).toContainText('Keep or add two or more');
    await expect(approve).toBeDisabled();

    await mapControls(page).getByRole('button', { name: 'Add a stakeholder' }).click();
    const form = page.getByRole('dialog', { name: 'Add a stakeholder' });
    await form.getByRole('textbox', { name: 'Name' }).fill('Harbour authority');
    await form.getByRole('button', { name: 'Add stakeholder' }).click();
    await expect(form).toHaveCount(0);
    await expect(approve).toBeEnabled();
    await expect(pill(page)).not.toContainText('Keep or add two or more');
    // Nothing is approved until the person approves it: there are no actors yet.
    expect((await actorsViewOf(request, id)).actors).toBeNull();
    expect(problems).toEqual([]);
  });

  test('the person reviews one party at a time from the pill, approves, and the actors are made from exactly what was approved', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);

    // The pill counts what is left to review and opens the next party.
    const left = found.length;
    const reviewing = (count: number) =>
      pill(page).getByRole('button', { name: new RegExp(`^${count} to review, next`, 'iu') });
    const nextOne = reviewing(left);
    await nextOne.click();
    const open = page.getByRole('complementary');
    await expect(open).toBeVisible();
    const first = (await open.getByRole('heading', { level: 2 }).innerText()).trim();
    await expect(open).toContainText('Proposed');
    await open.getByRole('button', { name: 'Accept' }).click();
    await expect(open).toContainText('Accepted');
    await expect(reviewing(left - 1)).toBeVisible();
    // Another press goes to a party that nobody has looked at, not back to the one just accepted.
    await reviewing(left - 1).click();
    await expect(page.getByRole('complementary').getByRole('heading', { level: 2 })).not.toHaveText(
      first,
    );

    // Approving accepts what was only proposed, and makes one actor for each party.
    await pill(page).getByRole('button', { name: 'Approve & create actors' }).click();
    await expect(toast(page, 'Approved')).toBeVisible();
    const simulate = pill(page).getByRole('button', { name: 'Simulate' });
    await expect(pill(page)).toContainText(`${found.length} actors ready`);
    await expect(pill(page)).toContainText('Synthetic stand-ins');
    await expect(simulate).toBeFocused();
    const view = await stakeholdersViewOf(request, id);
    expect(view.stakeholders!.approvedAt).not.toBeNull();
    expect(live(view).every((item) => item.status === 'accepted')).toBe(true);
    const actors = (await actorsViewOf(request, id)).actors!.actors;
    expect(actors.map((actor) => actor.id).sort()).toEqual(found.map((item) => item.id).sort());
    for (const actor of actors) {
      const stakeholder = found.find((item) => item.id === actor.id)!;
      expect(actor.kind).toBe(stakeholder.priority === 'key' ? 'key' : 'cohort');
    }

    // The picture is now of the actors; the stakeholders are still one press away.
    await expect(mapControls(page).getByRole('radio', { name: 'Actors' })).toBeChecked();
    await expect(ecosystem(page)).toHaveAccessibleName('Actors and how they relate');
    await mapControls(page).getByRole('radio', { name: 'Stakeholders' }).click();
    await expect(ecosystem(page)).toHaveAccessibleName('Stakeholders and how they relate');
    await mapControls(page).getByRole('radio', { name: 'Actors' }).click();
    await expect.poll(async () => (await headline(page)).total).toBe(found.length);
    await simulate.click();
    await expectScene(page, 'simulate');
    expect(problems).toEqual([]);
  });
});

test.describe('what the page says about its actors', () => {
  test('wherever actors are shown it says they are synthetic stand-ins, and nothing it says of them is a forecast', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'actors');
    await openApp(page, { project: id, scene: 'map' });
    const seen: string[] = [];

    // The picture and the pill.
    await expect(page.getByText(SYNTHETIC)).toBeVisible();
    await expect(pill(page)).toContainText('Synthetic stand-ins');
    await page.getByRole('button', { name: 'How to read this map' }).click();
    const legend = page.getByRole('dialog');
    await expect(legend).toContainText('Actors are synthetic stand-ins, not real people.');
    await expect(legend).toContainText('Every number is an assumption you can change.');
    seen.push(...(await ownSentences(legend)));
    await page.keyboard.press('Escape');

    // An actor, with its traits open, and the list of actors.
    await party(page, 'Customers').click();
    await openDisclosure(inspector(page, 'Customers'), 'Traits 11');
    seen.push(...(await ownSentences(page.getByRole('main'))));
    await mapControls(page).getByRole('radio', { name: 'List' }).click();
    seen.push(...(await ownSentences(page.getByRole('main'))));

    const { rest } = apartFromDisclaimers(seen);
    expect(rest.length).toBeGreaterThan(20);
    expect(claimsAgainst(rest.join('\n'))).toEqual([]);
    // A cohort stands for a number that is a weight, and the page says it is not a count of real people.
    await rosterRow(page, 'Buyers').click();
    await openDisclosure(inspector(page, 'Buyers'), 'Traits 11');
    await expect(inspector(page, 'Buyers')).toContainText(
      'An assumption, not a count of real people.',
    );
    expect(problems).toEqual([]);
  });
});

test.describe('the actors', () => {
  test('an actor shows where it stands and every number the engine will use for it, each with where it came from and why', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'actors');
    const actors = (await actorsViewOf(request, id)).actors!.actors;
    const customers = actors.find((actor) => actor.name === 'Customers')!;
    await openApp(page, { project: id, scene: 'map' });
    await expect(mapControls(page).getByRole('radio', { name: 'Actors' })).toBeChecked();

    await party(page, 'Customers').click();
    const open = inspector(page, 'Customers');
    await expect(open).toContainText(`${labelOf(customers.category)} · Key actor`);
    // Where it stands: three gauges, with the numbers the engine holds, and how sure the reading is.
    const stands = open.getByRole('region', { name: 'Where this actor stands' });
    for (const [name, value] of [
      ['Effect', customers.traits.impact.value],
      ['Stance', customers.traits.priorStance.value],
      ['Influence', customers.traits.influence.value],
    ] as const) {
      const gauge = stands.getByRole('meter', { name });
      expect(Number(await gauge.getAttribute('aria-valuenow'))).toBeCloseTo(value, 2);
    }
    const sure = { low: 'high', medium: 'medium', high: 'low' }[customers.uncertainty.level];
    await expect(stands.getByRole('img', { name: `Confidence: ${sure}` })).toBeVisible();
    // What it wants is an assumption, and the page says so.
    await expect(open).toContainText(
      'What it wants and fears is assumed from its category, or read by a model. It is not found in the sources.',
    );

    // Every trait: its name, where the number came from, the number, and why.
    const traits = await openDisclosure(open, 'Traits 11');
    const list = traits.getByRole('list', {
      name: 'Traits of Customers, with where each came from and why',
    });
    await expect(list.getByRole('listitem')).toHaveCount(TRAIT_KEYS.length);
    for (const key of TRAIT_KEYS) {
      const trait = customers.traits[key];
      const row = list.getByRole('listitem').filter({ hasText: TRAIT_NAMES[key] }).first();
      await expect(row).toContainText(ORIGIN_WORDS[trait.origin]);
      if (trait.rationale) await expect(row).toContainText(trait.rationale.slice(0, 60));
      expect(
        Number(await traitSlider(page, key, 'Customers').getAttribute('aria-valuenow')),
      ).toBeCloseTo(trait.value, 2);
    }
    expect(problems).toEqual([]);
  });

  test('a trait can be moved, which is held until it is saved, marked as the person’s own, and can be discarded', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'actors');
    const before = (await actorsViewOf(request, id)).actors!.actors.find(
      (actor) => actor.name === 'Customers',
    )!;
    await openApp(page, { project: id, scene: 'map' });

    await party(page, 'Customers').click();
    const open = inspector(page, 'Customers');
    await openDisclosure(open, 'Traits 11');
    const slider = traitSlider(page, 'influence', 'Customers');
    const was = Number(await slider.getAttribute('aria-valuenow'));
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
      .toBeCloseTo(was + 0.05, 2);
    const row = open
      .getByRole('listitem')
      .filter({ hasText: 'Influence' })
      .filter({ hasText: 'Changed by you; not saved yet.' });
    await expect(row).toContainText('you');
    await expect(pill(page)).toContainText('1 actor changed');
    await expect(pill(page)).toContainText('Not saved yet');
    // Nothing has reached the server.
    expect(
      (await actorsViewOf(request, id)).actors!.actors.find((actor) => actor.name === 'Customers')!
        .traits.influence.value,
    ).toBeCloseTo(before.traits.influence.value, 5);

    await pill(page).getByRole('button', { name: 'Discard' }).click();
    await expect
      .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
      .toBeCloseTo(was, 2);
    await expect(pill(page)).toContainText(
      `${(await actorsViewOf(request, id)).actors!.actors.length} actors ready`,
    );

    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await pill(page).getByRole('button', { name: 'Save' }).click();
    await expect(pill(page)).toContainText('actors ready');
    const saved = (await actorsViewOf(request, id)).actors!.actors.find(
      (actor) => actor.name === 'Customers',
    )!;
    expect(saved.edited).toBe(true);
    expect(saved.traits.influence.value).toBeCloseTo(before.traits.influence.value + 0.05, 2);
    expect(saved.traits.influence.origin).toBe('user');
    // The rest of the actors are as they were.
    const others = (await actorsViewOf(request, id)).actors!.actors.filter(
      (actor) => actor.name !== 'Customers',
    );
    expect(others.every((actor) => !actor.edited)).toBe(true);

    // And it is still there when the page is read again.
    await page.reload();
    await party(page, 'Customers').click();
    await expect(inspector(page, 'Customers')).toContainText('Edited by you');
    expect(problems).toEqual([]);
  });

  test('a cohort cannot simulate more members than it stands for, and the page will not save it', async ({
    page,
    request,
  }) => {
    const id = await makeProject(request, SHOP, 'actors');
    await openApp(page, { project: id, scene: 'map' });

    await party(page, 'Buyers').click();
    const open = inspector(page, 'Buyers');
    await openDisclosure(open, 'Traits 11');
    await open.getByRole('spinbutton', { name: 'Stands for about' }).fill('5');
    await expect(open).toContainText('A cohort cannot simulate more members than it stands for.');
    await expect(pill(page).getByRole('button', { name: 'Save' })).toBeDisabled();
    await open.getByRole('spinbutton', { name: 'Stands for about' }).fill('500');
    await expect(open).not.toContainText(
      'A cohort cannot simulate more members than it stands for.',
    );
    await expect(pill(page).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('"Make them again" makes every actor again from the stakeholders as they are now, after asking', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'actors');
    const before = (await actorsViewOf(request, id)).actors!;
    await openApp(page, { project: id, scene: 'map' });

    await mapControls(page).getByRole('radio', { name: 'Stakeholders' }).click();
    await party(page, 'Buyers').click();
    await inspector(page, 'Buyers').getByRole('button', { name: 'Edit Buyers' }).click();
    const form = page.getByRole('dialog', { name: 'Edit stakeholder' });
    await form.getByRole('textbox', { name: 'Name' }).fill('Frequent buyers');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form).toHaveCount(0);
    await mapControls(page).getByRole('radio', { name: 'Actors' }).click();

    const notice = page.getByRole('status').filter({ hasText: 'The actors are out of date' });
    await notice.getByRole('button', { name: 'Make them again' }).click();
    await page
      .getByRole('dialog', { name: 'Reset all actors?' })
      .getByRole('button', { name: 'Reset every actor' })
      .click();
    await expect(toast(page, 'Actors reset')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('The actors are out of date')).toHaveCount(0);
    const after = await actorsViewOf(request, id);
    expect(after.stale).toBe(false);
    expect(after.actors!.generatedAt).not.toBe(before.generatedAt);
    expect(after.actors!.actors.some((actor) => actor.name === 'Frequent buyers')).toBe(true);
    expect(problems).toEqual([]);
  });

  test('when the stakeholders change after the actors were made, the page says the actors are out of date and how to make them again', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'actors');
    const count = (await actorsViewOf(request, id)).actors!.actors.length;
    await openApp(page, { project: id, scene: 'map' });
    await expect(page.getByText('The actors are out of date')).toHaveCount(0);

    // Change one of the stakeholders.
    await mapControls(page).getByRole('radio', { name: 'Stakeholders' }).click();
    await party(page, 'Buyers').click();
    await inspector(page, 'Buyers').getByRole('button', { name: 'Edit Buyers' }).click();
    const form = page.getByRole('dialog', { name: 'Edit stakeholder' });
    await form.getByRole('textbox', { name: 'Name' }).fill('Frequent buyers');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form).toHaveCount(0);
    await expect.poll(async () => (await actorsViewOf(request, id)).stale).toBe(true);

    await mapControls(page).getByRole('radio', { name: 'Actors' }).click();
    const notice = page.getByRole('status').filter({ hasText: 'The actors are out of date' });
    await expect(notice).toContainText(
      'The stakeholders changed after they were made. The simulation uses the actors as they are now.',
    );
    // Making them again asks first, because it replaces what the person changed.
    await notice.getByRole('button', { name: 'Make them again' }).click();
    const ask = page.getByRole('dialog', { name: 'Reset all actors?' });
    await expect(ask).toContainText('This makes every actor again from the approved stakeholders');
    await ask.getByRole('button', { name: 'Keep the actors' }).click();
    await expect(ask).toHaveCount(0);
    expect((await actorsViewOf(request, id)).stale).toBe(true);

    // Approving the list again makes them again from what it holds now.
    await pill(page).getByRole('button', { name: 'Approve & create actors' }).click();
    await expect(toast(page, 'Approved')).toBeVisible();
    await expect(page.getByText('The actors are out of date')).toHaveCount(0);
    const after = await actorsViewOf(request, id);
    expect(after.stale).toBe(false);
    expect(after.actors!.actors).toHaveLength(count);
    expect(after.actors!.actors.some((actor) => actor.name === 'Frequent buyers')).toBe(true);
    expect(problems).toEqual([]);
  });
});

test.describe('with motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the picture still moves to what is chosen, by the keyboard, and the panel, the list and the pill work as they do without it', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeProject(request, SHOP, 'proposed');
    const found = live(await stakeholdersViewOf(request, id));
    await openApp(page, { project: id, scene: 'map' });
    await expect(partyNodes(page)).toHaveCount(found.length);
    await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'reduced');

    // The keyboard does not depend on where things are while they settle.
    await party(page, 'Customers').focus();
    await page.keyboard.press('Enter');
    await expect(
      inspector(page, 'Customers').getByRole('heading', { level: 2, name: 'Customers' }),
    ).toBeVisible();
    await expect(party(page, 'Customers')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(inspector(page, 'Customers')).toHaveCount(0);

    await mapControls(page).getByRole('radio', { name: 'List' }).click();
    await rosterRow(page, 'Buyers').click();
    await expect(inspector(page, 'Buyers')).toBeVisible();
    await pill(page).getByRole('button', { name: 'Approve & create actors' }).click();
    await expect(toast(page, 'Approved')).toBeVisible();
    await expect(pill(page)).toContainText(`${found.length} actors ready`);
    expect(problems).toEqual([]);
  });
});

type Point = { x: number; y: number };

const centreOf = async (locator: Locator): Promise<Point> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The party is not drawn.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** The party that has the focus. */
const focusedNode = async (page: Page): Promise<Locator> => {
  const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  return ecosystem(page).getByRole('button', { name: label, exact: true });
};

/** The parties the map shows in the light: none is dimmed. A party is dimmed when focus mode leaves it out. */
const inTheLight = async (page: Page): Promise<string[]> =>
  (
    await partyNodes(page).evaluateAll((nodes) =>
      nodes
        .filter((node) => !node.parentElement?.classList.contains('is-dim'))
        .map((node) => node.getAttribute('aria-label') ?? ''),
    )
  )
    .map((label) => label.split(', ')[0]!)
    .sort();

/** One more heading in the list where a place that nobody was found for is offered. */
const gapGroup = async (page: Page): Promise<number> =>
  (await roster(page).getByRole('heading', { name: 'Nobody found for', level: 2 }).count()) > 0
    ? 1
    : 0;

/** The kinds of party that are shown as a gap: the ones nobody was found for, at most five, the first ones. */
function gapsShown(gaps: readonly string[], present: readonly StakeholderCategory[]): string[] {
  const labels: string[] = [];
  for (const raw of gaps) {
    const gap = raw.trim();
    const known = gap in STAKEHOLDER_CATEGORY_LABELS;
    if (known && present.includes(gap as StakeholderCategory)) continue;
    const label = known
      ? labelOf(gap as StakeholderCategory)
      : gap.length > 26
        ? `${gap.slice(0, 25)}…`
        : gap;
    if (!labels.includes(label)) labels.push(label);
    if (labels.length === 5) break;
  }
  return labels;
}
