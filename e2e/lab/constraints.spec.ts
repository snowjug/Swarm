import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Analysis } from '../../shared/analysis';
import type { ConstraintsView } from '../../shared/constraints';
import { openApp } from '../support/app';
import { expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { claimsAgainst } from '../support/lab-api';
import {
  apartFromDisclaimers,
  deleteMade,
  exampleSeed,
  expectSound,
  inDocuments,
  makeProject,
  ownSentences,
} from '../support/ground-map';

// The Constraints view of the Map, on the rules-mode server and through the real page: what limits the decision,
// read from the sources, reviewed by a person, and the gate that says whether a simulation may start. What the page
// shows is checked against what the server holds (the constraints it read, the quotes it kept, the documents those
// are cut from), never against a figure in a fixture. Nothing here needs a model.

test.use({
  actionTimeout: 15_000,
  reducedMotion: 'reduce',
  viewport: { width: 1440, height: 900 },
});
test.afterEach(({ request }) => deleteMade(request));

const PRICE = exampleSeed('regional-price-change');

/** Where screenshots go when a person asks for them (E2E_SHOTS): never into the repository. */
const SHOTS = process.env.E2E_SHOTS;
async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}

/** A project the way the pages leave it before the simulation: the sources read, the actors made, the scenario read. */
async function makeReady(api: APIRequestContext): Promise<string> {
  const id = await makeProject(api, PRICE, 'actors');
  const parsed = await api.post('/api/scenario/parse', { data: { question: PRICE.question } });
  expect(parsed.ok(), await parsed.text()).toBe(true);
  const { frame } = (await parsed.json()) as { frame: unknown };
  const saved = await api.put(`/api/projects/${id}/scenario`, {
    data: { scenario: frame, expectedRevision: 0 },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  return id;
}

const constraintsOf = async (api: APIRequestContext, id: string): Promise<ConstraintsView> =>
  (await (await api.get(`/api/projects/${id}/constraints`)).json()) as ConstraintsView;

const gateRegion = (page: Page) => page.getByRole('region', { name: 'Constraint coverage' });
const items = (page: Page) =>
  page.getByRole('listitem').filter({ has: page.locator('.sw-con__statement') });

/** Reads the sources through the page, as a person does, and waits for what it found. */
async function readSources(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Read my sources for constraints' }).click();
  await expect(gateRegion(page)).toBeVisible({ timeout: 30_000 });
}

test.describe('reading the sources for constraints', () => {
  test('starts empty and honest, then shows each constraint with where it came from, and an inference never as a fact', async ({
    page,
    request,
  }) => {
    const problems = watchPage(page);
    const id = await makeReady(request);
    await openApp(page, { project: id, scene: 'map', view: 'constraints' });

    await expect(
      page.getByRole('heading', { level: 1, name: 'What limits the decision' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'No constraints have been read yet' }),
    ).toBeVisible();
    await expect(page.getByText(/Until you do, simulations run without any\./u)).toBeVisible();
    // This server has no model, so the page says so and offers one way to read.
    await expect(page.getByRole('button', { name: /Ask the model/u })).toHaveCount(0);
    await shoot(page, '01-empty');

    await readSources(page);
    const view = await constraintsOf(request, id);
    const set = view.constraints!;
    expect(set.constraints.length).toBeGreaterThan(2);
    // Everything that was just read waits for a person: nothing is validated, reviewed or run by being proposed.
    for (const constraint of set.constraints) {
      expect(constraint.review).toBe('proposed');
      expect(constraint.validation === 'unvalidated' || constraint.validation === 'assumed').toBe(
        true,
      );
    }
    await expect(items(page)).toHaveCount(set.constraints.length);

    // What a source says is labelled the source's, and its quote is in the document, word for word.
    const quoted = set.constraints.filter((constraint) => constraint.source === 'extracted');
    expect(quoted.length).toBeGreaterThan(0);
    for (const constraint of quoted) {
      for (const ref of constraint.evidenceRefs) {
        expect(inDocuments(ref.quote ?? '', PRICE.documents), ref.quote ?? '').toBe(true);
      }
    }
    const first = items(page).filter({ hasText: 'From evidence' }).first();
    await expect(first.getByText('Not yet validated')).toBeVisible();
    await first.getByRole('button', { name: /^Evidence \(\d+\): / }).click();
    const popover = page.getByRole('dialog', { name: /Where this came from: From evidence/u });
    await expect(popover.locator('blockquote').first()).toBeVisible();
    const shown = (await popover.locator('blockquote').first().textContent()) ?? '';
    expect(inDocuments(shown, PRICE.documents), shown).toBe(true);
    await shoot(page, '02-evidence-popover');
    await page.keyboard.press('Escape');

    // What only follows from who is involved is a suggestion: it says so, and is never marked confirmed.
    const inferred = items(page).filter({ hasText: 'Inferred' });
    for (let at = 0; at < (await inferred.count()); at += 1) {
      await expect(inferred.nth(at).getByText('Not yet validated')).toBeVisible();
      await expect(inferred.nth(at).getByText('Confirmed', { exact: true })).toHaveCount(0);
      await expect(inferred.nth(at).getByText('Read, not modelled')).toBeVisible();
    }
    await expect(
      page.getByText(/An inferred constraint is a suggestion until you confirm it\./u),
    ).toBeVisible();

    // The page makes no claim about the world, and says what it is in the simulation's words.
    const sentences = await ownSentences(page.getByRole('main'));
    const { rest } = apartFromDisclaimers(sentences);
    expect(rest.flatMap((sentence) => claimsAgainst(sentence))).toEqual([]);
    await shoot(page, '03-first-reading');
    await expectSound(page, 'the constraints, first read');
    expect(problems).toEqual([]);
  });

  test('puts at most three questions at a time, with four things to do about each, and keeps an unknown unknown', async ({
    page,
    request,
  }) => {
    const id = await makeReady(request);
    await openApp(page, { project: id, scene: 'map', view: 'constraints' });
    await readSources(page);

    const view = await constraintsOf(request, id);
    const asked = view.open.length;
    test.skip(asked === 0, 'The sources settled everything the page knows to ask.');
    expect(asked).toBeLessThanOrEqual(3);
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: /missing constraints? that could materially change the outcome\./u,
      }),
    ).toBeVisible();
    const first = page.locator('.sw-cask__item').first();
    await expect(first.getByText(/Why it is asked:/u)).toBeVisible();
    const group = first.getByRole('group');
    await expect(group.getByRole('button')).toHaveText([
      'Answer',
      'Mark unknown',
      'Use an assumption',
      'Exclude',
    ]);
    await shoot(page, '04-questions');

    // Marking it unknown is an answer the page keeps: it is not applied and not treated as true.
    const question = view.open[0]!;
    await group.getByRole('button', { name: 'Mark unknown' }).click();
    await expect
      .poll(
        async () =>
          (await constraintsOf(request, id)).constraints!.clarifications.find(
            (item) => item.id === question.id,
          )?.status,
      )
      .toBe('unknown');
    expect((await constraintsOf(request, id)).constraints!.constraints).toHaveLength(
      view.constraints!.constraints.length,
    );

    // An assumption is written down as a constraint that is the person's own, labelled assumed.
    const next = (await constraintsOf(request, id)).open[0];
    if (next) {
      await page
        .locator('.sw-cask__item')
        .first()
        .getByRole('button', { name: 'Use an assumption' })
        .click();
      await expect
        .poll(
          async () =>
            (await constraintsOf(request, id)).constraints!.clarifications.find(
              (item) => item.id === next.id,
            )?.status,
        )
        .toBe('assumed');
      const assumed = (await constraintsOf(request, id)).constraints!.constraints.find(
        (item) => item.validation === 'assumed' && item.source === 'user',
      );
      expect(assumed?.statement).toMatch(
        /^Assumed for now: no .* limit applies to this decision\.$/u,
      );
      await expect(page.getByText(assumed!.statement)).toBeVisible();
    }
  });
});

test.describe('the gate and the start of a simulation', () => {
  test('refuses a comparison while the constraints are unsettled, in words that say what to do, and runs it provisionally once they have been reviewed', async ({
    page,
    request,
  }) => {
    const id = await makeReady(request);
    await openApp(page, { project: id, scene: 'map', view: 'constraints' });
    await readSources(page);

    const refused = await request.post(`/api/projects/${id}/analysis`, {
      data: { runsPerVariant: 8, sensitivity: false },
    });
    expect(refused.status()).toBe(409);
    const refusal = (await refused.json()) as { error: { code: string; message: string } };
    expect(['CONSTRAINTS_BLOCKED', 'CONSTRAINTS_UNREVIEWED']).toContain(refusal.error.code);
    expect(refusal.error.message).toMatch(/Open the Map, go to Constraints/u);
    await shoot(page, '05-gate-before-review');

    // A careful person settles the hard ones first: what the gate stops on is a hard legal, regulatory or safety limit.
    const unsettled = (await constraintsOf(request, id)).constraints!.constraints.filter(
      (constraint) =>
        constraint.hardness === 'hard' &&
        ['legal', 'regulatory', 'safety'].includes(constraint.category),
    );
    for (const constraint of unsettled) {
      await page.getByRole('button', { name: `Confirm: ${constraint.statement}` }).click();
      await expect
        .poll(
          async () =>
            (await constraintsOf(request, id)).constraints!.constraints.find(
              (item) => item.id === constraint.id,
            )?.validation,
        )
        .toBe('confirmed');
    }
    const accept = page.getByRole('button', { name: /^Accept the \d+ that waits?$/u });
    if (await accept.count()) await accept.click();
    // Having been through every one is what a review is: nothing waits, and the page says it is confirmed.
    await expect(page.getByRole('button', { name: 'Review confirmed' })).toBeVisible();

    const gate = (await constraintsOf(request, id)).gate!;
    expect(gate.reviewed).toBe(true);
    expect(gate.status).not.toBe('blocked');
    await shoot(page, '06-gate-reviewed');

    const started = await request.post(`/api/projects/${id}/analysis`, {
      data: { runsPerVariant: 8, sensitivity: false },
    });
    expect(started.status(), await started.text()).toBe(202);
    const { analysis } = (await started.json()) as { analysis: Analysis };
    await expect
      .poll(
        async () =>
          (
            (await (await request.get(`/api/projects/${id}/analysis/${analysis.id}`)).json()) as {
              analysis: Analysis;
            }
          ).analysis.status,
        { timeout: 120_000 },
      )
      .toBe('completed');
    const done = (
      (await (await request.get(`/api/projects/${id}/analysis/${analysis.id}`)).json()) as {
        analysis: Analysis;
      }
    ).analysis;
    // The comparison says which constraints the simulation applied, which it only read, and that it was provisional.
    expect(done.constraints?.status).toBe(gate.status === 'clear' ? 'clear' : 'provisional');
    if (gate.status === 'provisional') {
      expect(done.constraints?.label).toMatch(/^Provisional/u);
      expect(done.fidelity.caveats).toContain(done.constraints?.label);
    }
    for (const item of done.constraints?.notApplied ?? []) expect(item.reason).toBeTruthy();

    // A change to the constraints after it ran makes the comparison out of date, and the page says where it matters.
    const stale = await constraintsOf(request, id);
    expect(done.inputRevisions?.constraints).toBe(stale.revision);
  });

  test('lets a person add a constraint of their own, with what the simulation does about it, and shows it applied', async ({
    page,
    request,
  }) => {
    const id = await makeReady(request);
    await openApp(page, { project: id, scene: 'map', view: 'constraints' });
    await readSources(page);
    await page.getByRole('button', { name: 'Add a constraint' }).click();
    const form = page.getByRole('form', { name: 'Add a constraint' });
    await form
      .getByLabel('What is the limit?')
      .fill('Customers need ninety days of notice before any change to their terms.');
    await form.getByRole('radio', { name: 'Hard' }).click();
    await form.getByLabel('What the simulation does with it').selectOption('delay');
    await form.getByLabel('Rounds of delay').fill('3');
    await shoot(page, '07-editor');
    await form.getByRole('button', { name: 'Add the constraint' }).click();

    const added = items(page).filter({ hasText: 'Customers need ninety days of notice' });
    await expect(added).toBeVisible();
    await expect(added.getByText('You', { exact: true })).toBeVisible();
    await expect(added.getByText('Confirmed')).toBeVisible();
    await expect(added.getByText('Applied in the simulation')).toBeVisible();
    await expect(added.getByText(/Delays the change by 3 rounds/u)).toBeVisible();
    const stored = (await constraintsOf(request, id)).constraints!.constraints.find((item) =>
      item.statement.startsWith('Customers need ninety days'),
    );
    // It is the person's own: no source, no evidence, whatever the form was given.
    expect(stored).toMatchObject({
      source: 'user',
      evidenceRefs: [],
      review: 'added',
      enforcement: 'enforced',
    });
  });

  test('runs the views of the proposed change, each with what moved it, and says why one was not run', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const id = await makeReady(request);
    await openApp(page, { project: id, scene: 'map', view: 'constraints' });
    await readSources(page);
    await page.getByRole('button', { name: /What if one thing were different/u }).click();
    await page.getByRole('button', { name: 'Run the views' }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible({ timeout: 120_000 });
    await expect(table.locator('tbody tr')).toHaveCount(7);
    const rows = await table.locator('tbody tr').all();
    for (const row of rows) {
      const text = ((await row.textContent()) ?? '').replace(/\s+/gu, ' ');
      expect(text.includes('Not run:') || /[+−]\d+ points|No difference/u.test(text), text).toBe(
        true,
      );
    }
    await shoot(page, '08-views');
    const sentences = await ownSentences(page.getByRole('main'));
    expect(
      apartFromDisclaimers(sentences).rest.flatMap((sentence) => claimsAgainst(sentence)),
    ).toEqual([]);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('keeps every part of the page inside the screen, with a name on every control', async ({
    page,
    request,
  }) => {
    const id = await makeReady(request);
    await openApp(page, { project: id, scene: 'map', view: 'constraints' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'What limits the decision' }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, '09-phone-empty', false);
    await readSources(page);
    await expectNoHorizontalOverflow(page);
    await shoot(page, '10-phone-reading', false);
    await page.getByRole('region', { name: 'Constraint coverage' }).scrollIntoViewIfNeeded();
    await shoot(page, '11-phone-gate', false);
    await expect(
      page.getByRole('radiogroup', { name: 'Show as' }).getByRole('radio', { name: 'Constraints' }),
    ).toBeChecked();
    await expectSound(page, 'the constraints on a phone');
  });
});
