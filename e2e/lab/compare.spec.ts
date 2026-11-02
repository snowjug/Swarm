import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { apiContext, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { PHONE, allOf, arrived, audit, expectPressable, forget, quiet } from '../support/shell';
import {
  BUS_RELATIONS,
  BUS_STAKEHOLDERS,
  compared,
  compareAt,
  expectNoForecasts,
  freezeImpacts,
  seedByHand,
  simulateAt,
  type AnalysisJson,
} from '../support/simulate';

// The comparison of scenarios, set side by side: what it says first, every future at a glance, who moves, how the runs
// spread, what held, what the result depends on, what the typical run set off, and how far to rely on any of it. Every
// figure is read back from the saved comparison; nothing here is said of the world.

interface Run {
  responseShares: Record<string, number>;
}
interface Compared extends Omit<AnalysisJson, 'variants' | 'findings' | 'config'> {
  config: AnalysisJson['config'] & { rounds: number };
  variants: { variantId: string; runs: Run[] }[];
  findings: { id: string; holdsIn: number; of: number; statement: string }[];
  sensitivity: unknown[];
  fidelity: { label: string; caveats: string[] };
  representativeRun: { seed: number; events: { round: number; kind: string }[] } | null;
}

let api: APIRequestContext;
const ids = {} as Record<'bus' | 'still', string>;
let analysis: Compared;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  ids.bus = await seedByHand(api, 'Compare: regional bus fares', BUS_STAKEHOLDERS, BUS_RELATIONS);
  analysis = (await compared(api, ids.bus, { runsPerVariant: 10 })) as unknown as Compared;
  const unclear = BUS_STAKEHOLDERS.map((stakeholder) => ({
    ...stakeholder,
    direction: 'unclear' as const,
  }));
  ids.still = await seedByHand(api, 'Compare: nothing can move anyone', unclear);
  await freezeImpacts(api, ids.still);
  await compared(api, ids.still, { runsPerVariant: 10 });
});

test.afterAll(async () => {
  await forget(api, Object.values(ids));
  await api.dispose();
});

const labels = (): string[] => analysis.config.variants.map((variant) => variant.label);

/** The share of simulated members who look for an alternative or resist, averaged over the runs of a scenario. */
function adverse(variantId: string): number {
  const runs = analysis.variants.find((variant) => variant.variantId === variantId)!.runs;
  return (
    runs.reduce((sum, run) => sum + run.responseShares.switch! + run.responseShares.resist!, 0) /
    runs.length
  );
}

/** A share as the page says it: a whole number or one decimal. */
const shareWords = (value: number): RegExp => {
  const tenth = (value * 100).toFixed(1);
  const whole = String(Math.round(value * 100));
  return new RegExp(`(${tenth.replace('.', '\\.')}|${whole})%`, 'u');
};

const section = (page: Page, name: string): Locator => page.getByRole('region', { name });

async function openAll(page: Page): Promise<void> {
  const closed = page.getByRole('main').getByRole('button', {
    name: /^(Data|What this means and how it was tested)$/u,
    expanded: false,
  });
  // Each opened disclosure leaves the set, so the first one is always the next.
  for (let count = await closed.count(); count > 0; count = await closed.count())
    await closed.first().click();
}

test.describe('the comparison of a finished simulation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('says first what happened, why and how sure, and that it is not a forecast', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toContainText('simulated members end up');
    await expect(title).toContainText(/less favourable|more favourable|about the same/u);
    // The sentence is about the proposed change against no change, on the same seeds, and says how often it held.
    await expect(title).toContainText('Proposed change');
    await expect(title).toContainText('No change');
    await expect(page.getByRole('main')).toContainText(
      /It held in \d+ of \d+ seeded runs, on the same seeds\./u,
    );
    await expect(page.getByRole('main')).toContainText('An exploration, not a forecast.');
    // Why and how sure, one press from the detail they come from.
    const why = page.getByRole('complementary', { name: 'Why, and how sure' });
    await expect(why.getByRole('link', { name: /^Moves most/u })).toBeVisible();
    await expect(why.getByRole('link', { name: /^Sets off/u })).toBeVisible();
    await expect(why.getByRole('link', { name: /^How sure/u })).toContainText(
      'It is not a likelihood.',
    );
    await why.getByRole('link', { name: /^Moves most/u }).click();
    await expect(section(page, 'Who moves, and how far')).toBeInViewport();
    expect(problems).toEqual([]);
  });

  test('sets every scenario’s response next to the others, from the saved runs', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const futures = section(page, 'Where simulated members end up');
    const list = futures.getByRole('list', { name: 'Scenarios' });
    await expect(list.getByRole('listitem')).toHaveCount(analysis.config.variants.length);
    for (const [index, variant] of analysis.config.variants.entries()) {
      const item = list.getByRole('listitem').nth(index);
      await expect(item.getByRole('heading', { level: 3 })).toContainText(variant.label);
      // Each bar says its six responses in words, and the figure beside it is the saved runs' mean.
      await expect(item.getByRole('img')).toHaveAccessibleName(
        new RegExp(`^${variant.label.replace(/[()]/gu, '\\$&')}: Go along`, 'u'),
      );
      await expect(item).toContainText(shareWords(adverse(variant.id)));
      await expect(item).toContainText('of simulated members look for an alternative or resist.');
    }
    // The reference is said to be the reference, and the one set against it is said so.
    await expect(list.getByRole('listitem').first()).toContainText('Reference');
    await expect(list.getByRole('listitem').nth(1)).toContainText('Set against');
    // What each response means is one press away, never only a colour.
    await futures.getByRole('button', { name: 'What each response means' }).click();
    await expect(
      page
        .getByRole('dialog')
        .or(page.getByText(/Final stance is clearly favourable/u))
        .first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // The same figures are tables: the mean of each response, and each seed's share in each scenario.
    await futures.getByRole('button', { name: 'Data' }).click();
    const means = futures.getByRole('table').first();
    await expect(means.getByRole('row')).toHaveCount(analysis.config.variants.length + 1);
    const seeds = futures.getByRole('table').nth(1);
    await expect(seeds.getByRole('row')).toHaveCount(analysis.config.runsPerVariant + 1);
  });

  test('any two scenarios can be set against each other, from the sentence and from the bar', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const title = page.getByRole('heading', { level: 1 });
    const [reference, proposed, smaller, larger] = labels();
    expect(larger).toBeDefined();

    // The sentence is the control: the name of the scenario set against the reference opens the choice.
    await title.getByRole('button', { name: proposed! }).click();
    const choice = page.getByRole('group', { name: 'Set against' });
    await choice
      .getByRole('radio', { name: new RegExp(smaller!.replace(/[()]/gu, '\\$&'), 'u') })
      .check();
    await expect(title).toContainText(smaller!);
    await expect(title).toContainText(reference!);
    await page.keyboard.press('Escape');
    // The figures follow the pair: the difference is the smaller change's, set against no change.
    const futures = section(page, 'Where simulated members end up');
    await expect(futures.getByRole('listitem').nth(2)).toContainText('Set against');

    // The bar says the pair and offers the same choice, with a way to swap them.
    const bar = page.getByRole('toolbar', { name: 'Compare controls' });
    await expect(bar).toContainText(reference!);
    await expect(bar).toContainText(smaller!);
    await bar.getByRole('button', { name: new RegExp(`^${reference} against`, 'u') }).click();
    await page.getByRole('button', { name: 'Swap' }).click();
    await expect(title).toContainText(`Under ${reference}`);
    await page.keyboard.press('Escape');
    expect(problems).toEqual([]);
  });

  test('shows who moves, the ones that moved most first, from the saved actors’ summaries', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const movers = section(page, 'Who moves, and how far');
    const list = movers.getByRole('list', { name: 'Actors, those who moved most first' });
    const first = list.getByRole('listitem').first();
    // Each actor says its stance in both scenarios and the difference, in words, and its mix of responses in each.
    await expect(first.getByRole('button').first()).toHaveAccessibleName(
      /stance .* under .*, .* under .*, a difference of /u,
    );
    await expect(first.getByRole('img')).toHaveCount(2);
    await expect(first).toContainText('simulated');
    // A group of actors can be asked for alone, and everyone again.
    const groups = movers.getByRole('group', { name: 'Show actors of a group' });
    await expect(groups.getByRole('button', { name: /^All \d+$/u })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const some = groups.getByRole('button').nth(1);
    await some.click();
    await expect(some).toHaveAttribute('aria-pressed', 'true');
    await groups.getByRole('button', { name: /^All \d+$/u }).click();
    // The rest of the actors are one press away, and the figures are a table.
    await movers.getByRole('button', { name: /^Show all \d+$/u }).click();
    await expect(list.getByRole('listitem')).toHaveCount(
      Number(/\d+/u.exec(await groups.getByRole('button', { name: /^All \d+$/u }).innerText())![0]),
    );
    await expect(movers).toContainText('Actors are synthetic');
  });

  test('reads how the runs spread over the rounds, with a scale to choose and a cursor to move', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const time = section(page, 'How it unfolds');
    await expect(time.getByRole('img').first()).toHaveAccessibleName(
      /The overall simulated stance round by round, for /u,
    );
    for (const name of labels())
      await expect(time.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    // The scale can be zoomed in to the data or opened to its full range, which is said.
    await expect(time.getByRole('radio', { name: 'Zoomed in' })).toBeChecked();
    await time.getByRole('radio', { name: '−1 to +1' }).click();
    await expect(time.getByRole('radio', { name: '−1 to +1' })).toBeChecked();
    // The round to read is a real slider.
    const slider = time.getByRole('slider', { name: 'Round to read' });
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(slider).toHaveValue('1');
    await page.keyboard.press('End');
    await expect(slider).toHaveValue(String(analysis.config.rounds));
    // A scenario can be left out, and the same figures are a table.
    const [, second] = labels();
    await time.getByRole('button', { name: second!, exact: true }).click();
    await expect(time.getByRole('button', { name: second!, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await time.getByRole('button', { name: 'Data' }).click();
    await expect(time.getByRole('table').getByRole('row')).toHaveCount(analysis.config.rounds + 1);
  });

  test('lists what held, the steadiest first, with the others one press away, and says repeatable is not a likelihood', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const holds = section(page, 'What holds across the seeded runs');
    await expect(holds).toContainText(
      'Repeatable means steady under the simulation’s own randomness. It is not a likelihood.',
    );
    const list = holds.getByRole('list', { name: 'Findings, the steadiest first' });
    const shown = await list.getByRole('listitem').count();
    expect(shown).toBeGreaterThan(0);
    // Each says how many of the seeded runs it held in, the numbers the engine saved.
    const direction = analysis.findings.find((finding) => finding.statement.startsWith('In '))!;
    expect(direction).toBeDefined();
    const more = holds.getByRole('button', { name: /^Show the other \d+$/u });
    const others = Number(/\d+/u.exec(await more.innerText())![0]);
    await more.click();
    await expect(list.getByRole('listitem')).toHaveCount(shown + others);
    await expect(
      list.getByText(`${direction.holdsIn} of ${direction.of} runs`).first(),
    ).toBeVisible();
    // What a finding means and how it was tested is one press away; it is never a likelihood.
    await list
      .getByRole('button', { name: 'What this means and how it was tested' })
      .first()
      .click();
    await expect(list.getByText(/Tested as /u).first()).toBeVisible();
    // Findings of every scenario, not only the pair, can be asked for.
    await holds.getByRole('radio', { name: /^All \d+ scenarios$/u }).click();
    await expect(holds.getByRole('radio', { name: /^All \d+ scenarios$/u })).toBeChecked();
  });

  test('says what the result depends on, one assumption at a time, and which have no evidence behind them', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const depends = section(page, 'What the result depends on');
    await expect(depends).toContainText('The headline when one assumption is moved at a time.');
    await expect(depends).toContainText(
      /\d+ of \d+ assumptions? clearly changes? the result when moved\./u,
    );
    const list = depends.getByRole('list', {
      name: 'Assumptions, those that moved the result most first',
    });
    await expect(list.getByRole('listitem').first().getByRole('img')).toHaveAccessibleName(
      /moved by .*noise/u,
    );
    // Every row says where its assumption came from, and a result that rests on assumptions with no evidence says so.
    await expect(depends.getByRole('status')).toContainText(
      'rests on assumptions with no evidence behind them',
    );
    // The same figures are a table, with each row's shift and its noise.
    await depends.getByRole('button', { name: 'Data' }).click();
    await expect(depends.getByRole('table').getByRole('row')).toHaveCount(
      analysis.sensitivity.length + 1,
    );
  });

  test('reads back what the typical run set off, as one run and not the answer', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const sets = section(page, 'What it sets off');
    await expect(sets).toContainText(`seed ${analysis.representativeRun!.seed}`);
    await expect(sets).toContainText('It is not the answer');
    const events = analysis.representativeRun!.events;
    const list = sets.getByRole('list', { name: 'Events of the run, in order' });
    await expect(list.getByRole('listitem')).toHaveCount(events.length);
    await expect(list.getByRole('listitem').first()).toContainText(
      new RegExp(`Round\\s*${events[0]!.round}`, 'u'),
    );
    await expect(list.getByRole('listitem').first()).toContainText(
      /Because the simulated “[a-z-]+” signal/u,
    );
    // How often each kind of event occurred is among the findings, across all the runs.
    await expect(
      sets.getByRole('heading', { name: 'How often, across all the runs' }),
    ).toBeVisible();
    await expect(sets).toContainText(
      /seeded runs, a simulated “[a-z-]+” event by .+ occurred under /u,
    );
  });

  test('says how far to rely on it: what drove the behaviour, which seeds, what it cost, and that no model was called', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const rely = section(page, 'How far to rely on this');
    await expect(rely).toContainText(analysis.fidelity.label);
    for (const caveat of analysis.fidelity.caveats) await expect(rely).toContainText(caveat);
    const seeds = analysis.config.baseSeed;
    await expect(rely).toContainText(
      `seeds ${seeds} to ${seeds + analysis.config.runsPerVariant - 1}, the same for every scenario`,
    );
    await expect(rely).toContainText(
      /\d[\d,]* simulated runs of [\d,]+ simulated members in .+; 0 model calls/u,
    );
    await expect(rely).toContainText('Rules: outcomes follow from the declared assumptions');
  });

  test('says nothing of a direction where nothing in the change can move anyone', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.still));
    await arrived(page);
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).not.toContainText(/less favourable|more favourable/u);
    await expect(page.getByRole('main')).toContainText(
      /Nothing in the change can move anyone|cannot move anyone|no effect to test/iu,
    );
    await expect(page.getByRole('main')).toContainText('No effect to test');
    await expect(page.getByRole('main').getByText('Robust', { exact: true })).toHaveCount(0);
    await expectNoForecasts(page, 'a change that cannot move anyone');
  });

  test('the bar says where to go next: the decision, the method, and the setup again', async ({
    page,
  }) => {
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    const bar = page.getByRole('toolbar', { name: 'Compare controls' });
    // The method is a sheet that gives focus back to the button that opened it.
    const method = bar.getByRole('button', { name: 'Method' });
    await method.click();
    const sheet = page.getByRole('dialog', { name: 'Method' });
    await expect(sheet).toContainText(`${analysis.config.runsPerVariant} times`);
    await expect(sheet).toContainText('same for every scenario');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(method).toBeFocused();
    // Running again opens the setup, with the way back to these results.
    await bar.getByRole('button', { name: 'Run again' }).click();
    await expect(page).toHaveURL(/scene=simulate&view=setup/u);
    await expect(page.getByRole('button', { name: 'Back to the results' })).toBeVisible();
    // And the decision is the next scene.
    await page.goto(compareAt(ids.bus));
    await arrived(page);
    await page
      .getByRole('toolbar', { name: 'Compare controls' })
      .getByRole('button', { name: 'Decide' })
      .click();
    await expect(page).toHaveURL(/scene=decide/u);
    // The simulation it came from is one press back.
    await page.goto(simulateAt(ids.bus));
    await expect(page.getByRole('region', { name: 'Simulation' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// The whole page, with every disclosure opened, at the sizes people use and in every theme.
// ---------------------------------------------------------------------------------------------

for (const [label, viewport, themes, touch] of [
  ['a desktop', { width: 1440, height: 900 }, ['light', 'dark', 'high-contrast'], false],
  ['a laptop', { width: 1366, height: 768 }, ['light'], false],
  ['a tablet', { width: 768, height: 1024 }, ['light'], true],
  ['a phone', PHONE.viewport, ['light', 'dark'], true],
] as const) {
  test.describe(`on ${label}`, () => {
    test.use({ viewport, hasTouch: touch, reducedMotion: 'reduce' });

    test(`the comparison, every disclosure opened, passes axe in ${themes.join(', ')}, fits the page and is made for ${touch ? 'a finger' : 'a pointer'}`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      for (const theme of themes) {
        await page.addInitScript(
          (value) => window.localStorage.setItem('swarm.theme', value),
          theme,
        );
        await page.goto(compareAt(ids.bus));
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await arrived(page);
        await openAll(page);
        await audit(page, `comparison, ${theme}, ${label}`);
        if (theme !== themes[0]) continue;
        await quiet(page);
        await allOf({
          'no horizontal scroll': () => expectNoHorizontalOverflow(page),
          'controls of 24px or more': () =>
            expectPressable(page, `comparison ${label}`, { min: 24, scope: 'main' }),
          ...(touch
            ? {
                'controls a finger wide': () =>
                  expectPressable(page, `comparison ${label}`, { min: 44, scope: 'main' }),
              }
            : {}),
        });
      }
      expect(problems).toEqual([]);
    });
  });
}
