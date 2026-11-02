import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiContext, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { PHONE, allOf, arrived, audit, expectPressable, forget, quiet } from '../support/shell';
import {
  BUS_RELATIONS,
  BUS_STAKEHOLDERS,
  compared,
  expectNoForecasts,
  roundSlider,
  seedByHand,
  showView,
  simulateAt,
  viewChoice,
  type AnalysisJson,
  type TheatreView,
} from '../support/simulate';

// A finished simulation as it is looked at: the four views of one real run (a story, the actors round by round, the
// network they sit in, the spread of every run over time), the scrubber that moves along its rounds, the actor chosen in
// the picture, and what each says about itself. Everything on show is read back from the run the engine saved.

let api: APIRequestContext;
let project = '';
interface Theatre extends Omit<AnalysisJson, 'representativeRun'> {
  actors: { id: string; name: string }[];
  relations: { from: string; to: string; type: string }[];
  representativeRun: {
    seed: number;
    rounds: { round: number; byActor: { actorId: string; stanceMean: number }[] }[];
    events: {
      id: string;
      round: number;
      kind: string;
      actorId: string | null;
      description: string;
    }[];
  };
}
let analysis: Theatre;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  project = await seedByHand(api, 'Theatre: regional bus fares', BUS_STAKEHOLDERS, BUS_RELATIONS);
  analysis = (await compared(api, project, { runsPerVariant: 10 })) as unknown as Theatre;
});

test.afterAll(async () => {
  await forget(api, [project]);
  await api.dispose();
});

const first = (): number => analysis.representativeRun.rounds[0]!.round;
const last = (): number => analysis.representativeRun.rounds.at(-1)!.round;
const changeRound = (): number =>
  analysis.config.variants.find((variant) => variant.kind === 'alternative')!.round;
const nameOf = (id: string): string => analysis.actors.find((actor) => actor.id === id)!.name;

/** Moves the scrubber to a round with the keys it answers to. */
async function goToRound(page: Page, round: number): Promise<void> {
  await roundSlider(page).focus();
  await page.keyboard.press('Home');
  for (let step = first(); step < round; step += 1) await page.keyboard.press('ArrowRight');
  await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(round));
}

const HEADINGS: Record<TheatreView, RegExp> = {
  Story: /simulated members|Nothing in the change can move anyone/u,
  Live: /^Watch it unfold$/u,
  Network: /^Who is connected$/u,
  Timeline: /^How it plays out$/u,
};

test.describe('a finished simulation, looked at', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens on the run, plays it by itself the first time, and can be played again', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto(simulateAt(project));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Watch it unfold');
    // It is the run the engine kept: its seed and the scenario it played are said.
    await expect(page.getByRole('main')).toContainText(`seed ${analysis.representativeRun.seed}`);
    await expect(page.getByRole('main')).toContainText('One typical run of 10');
    // It plays by itself from the first round to the last and stops there.
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(last()), {
      timeout: 60_000,
    });
    const again = page.getByRole('button', { name: 'Play again' });
    await expect(again).toBeVisible();
    await again.click();
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(first()));
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test.describe('for someone who asked for less motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('opens on the last round and moves only when it is moved', async ({ page }) => {
      await page.goto(simulateAt(project));
      await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(last()));
      await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
      await goToRound(page, first());
      await page.keyboard.press('ArrowRight');
      await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(first() + 1));
      // Nothing played in between: the round is where it was put.
      await page.waitForTimeout(1_500);
      await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(first() + 1));
    });
  });

  test('the scrubber is a real slider: the keys, a press on the track and the buttons all move the same round', async ({
    page,
  }) => {
    await page.goto(simulateAt(project));
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(last()), {
      timeout: 60_000,
    });
    const slider = roundSlider(page);
    await expect(slider).toHaveAttribute('aria-valuemin', String(first()));
    await expect(slider).toHaveAttribute('aria-valuemax', String(last()));
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', `Round ${first()} of ${last()}`);
    await page.keyboard.press('PageUp');
    await expect(slider).toHaveAttribute('aria-valuenow', String(first() + 3));
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', String(last()));
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', String(last() - 1));
    // Space plays from where it is and pauses again; moving it by hand always stops it.
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    // The buttons beside it.
    await goToRound(page, first());
    await page.getByRole('button', { name: 'Next round' }).click();
    await expect(slider).toHaveAttribute('aria-valuenow', String(first() + 1));
    await page.getByRole('button', { name: 'Previous round' }).click();
    await expect(slider).toHaveAttribute('aria-valuenow', String(first()));
    await expect(page.getByRole('button', { name: 'Previous round' })).toBeDisabled();
    // A press on the track goes to the round under it.
    const box = (await slider.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    const middle = Number(await slider.getAttribute('aria-valuenow'));
    expect(middle).toBeGreaterThan(first());
    expect(middle).toBeLessThan(last());
  });

  test('says in each round what the run recorded in it: where it starts, where the change lands, what was set off', async ({
    page,
  }) => {
    await page.goto(simulateAt(project));
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(last()), {
      timeout: 60_000,
    });
    const playback = page.getByRole('region', { name: 'Playback' });
    await goToRound(page, first());
    await expect(playback).toContainText('Where each actor starts');

    // The change lands in the round the scenario says, with its strength as set.
    const proposed = analysis.config.variants.find((variant) => variant.kind === 'alternative')!;
    await goToRound(page, changeRound());
    await expect(playback).toContainText(/The change lands on \d+ actors?/u);
    await expect(playback).toContainText(`strength ${proposed.intensity.toFixed(2)}`);
    await expect(page.getByRole('complementary', { name: `Round ${changeRound()}` })).toContainText(
      'The change lands',
    );

    // What was set off is the engine's own record: who, what kind, and in its own words.
    const event = analysis.representativeRun.events[0]!;
    expect(event, 'the run the engine kept has an event to read back').toBeDefined();
    await goToRound(page, event.round);
    const card = page.getByRole('complementary', { name: `Round ${event.round}` });
    await expect(card.getByRole('region', { name: 'Set off in this round' })).toContainText(
      event.kind,
    );
    await expect(card.getByRole('region', { name: 'Set off in this round' })).toContainText(
      event.description,
    );
    if (event.actorId)
      await expect(playback).toContainText(`${nameOf(event.actorId)} set something off`);

    // A round in which nothing was set off says that, and never shows an event it does not have.
    const quietRound = analysis.representativeRun.rounds
      .map((entry) => entry.round)
      .find(
        (round) =>
          round !== changeRound() &&
          !analysis.representativeRun.events.some((entry) => entry.round === round),
      )!;
    await goToRound(page, quietRound);
    await expect(page.getByRole('complementary', { name: `Round ${quietRound}` })).toContainText(
      'Nothing was set off in this round.',
    );
  });

  test('an actor chosen in the picture says where it stands and how it got there, and lets go again', async ({
    page,
  }) => {
    await page.goto(simulateAt(project));
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(last()), {
      timeout: 60_000,
    });
    const target = analysis.actors.find((actor) => actor.name === 'Weekday commuters')!;
    const node = page.getByRole('button', { name: new RegExp(`^${target.name}, stance`, 'u') });
    await node.focus();
    await page.keyboard.press('Enter');
    const trace = page.getByRole('region', { name: target.name });
    await expect(trace).toBeVisible();
    await expect(trace.getByRole('heading', { name: target.name })).toBeVisible();
    await expect(trace.getByRole('img', { name: /^Stance by round\./u })).toBeVisible();
    await expect(trace).toContainText('simulated members');
    // Its figure is the engine's: the mean stance of the actor in the round shown.
    const stance = analysis.representativeRun.rounds
      .at(-1)!
      .byActor.find((entry) => entry.actorId === target.id)!.stanceMean;
    await expect(trace).toContainText(`${stance > 0 ? '+' : ''}${stance.toFixed(2)}`);
    await trace.getByRole('button', { name: 'Close' }).click();
    await expect(trace).toHaveCount(0);
  });

  test('the picture can be zoomed in and out and fitted again, from its buttons, and the view is not lost', async ({
    page,
  }) => {
    await page.goto(simulateAt(project));
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(last()), {
      timeout: 60_000,
    });
    // The picture is one group that moves and scales as a whole: its scale is the zoom.
    const scale = (): Promise<number> =>
      page.evaluate(() => {
        const group = document.querySelector(
          'main svg[role="group"] .sw-eco__nodes',
        )?.parentElement;
        return Number(/scale\(([\d.]+)\)/u.exec(group?.getAttribute('transform') ?? '')?.[1]);
      });
    const view = page.getByRole('group', { name: 'View' });
    await expect.poll(scale).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    const start = await scale();

    await view.getByRole('button', { name: 'Zoom in' }).click();
    await view.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(scale).toBeGreaterThan(start * 1.4);
    await view.getByRole('button', { name: 'Zoom out' }).click();
    await view.getByRole('button', { name: 'Zoom out' }).click();
    await view.getByRole('button', { name: 'Zoom out' }).click();
    await view.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(scale).toBeLessThan(start * 0.8);
    await view.getByRole('button', { name: 'Fit everything' }).click();
    await expect.poll(scale).toBeCloseTo(start, 1);

    // The actors are still all there, and the round has not moved.
    await expect(page.getByRole('button', { name: /, stance .*, in round \d+$/u })).toHaveCount(
      analysis.actors.length,
    );
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(last()));
  });

  test('each view has its own heading, its address, and says that it is not a prediction', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto(simulateAt(project));
    await arrived(page);
    for (const view of ['Story', 'Live', 'Network', 'Timeline'] as const) {
      await showView(page, view);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADINGS[view]);
      await expect(page).toHaveURL(
        view === 'Live' ? /^(?!.*view=)/u : new RegExp(`view=${view.toLowerCase()}`, 'u'),
      );
      await expect(
        page
          .getByRole('main')
          .getByText(/Not a prediction/u)
          .locator('visible=true')
          .first(),
      ).toBeVisible();
      await expectNoForecasts(page, `the ${view} view`);
    }
    // An address names a view, and opening it shows that view.
    await page.goto(simulateAt(project, 'timeline'));
    await expect(viewChoice(page, 'Timeline')).toBeChecked();
    expect(problems).toEqual([]);
  });

  test('the network says who moved most from the run itself, and what each actor is joined to', async ({
    page,
  }) => {
    await page.goto(simulateAt(project, 'network'));
    await arrived(page);
    // Who moved most is read from the run: the largest change of mean stance from the first round to the last.
    const moved = analysis.actors
      .map((actor) => {
        const stance = (round: number) =>
          analysis.representativeRun.rounds
            .find((entry) => entry.round === round)!
            .byActor.find((entry) => entry.actorId === actor.id)?.stanceMean ?? 0;
        return { name: actor.name, move: stance(last()) - stance(first()) };
      })
      .filter((entry) => Math.abs(entry.move) >= 0.005)
      .sort((a, b) => Math.abs(b.move) - Math.abs(a.move) || a.name.localeCompare(b.name));
    const list = page.getByRole('region', { name: 'Who moved most' });
    await expect(list.getByRole('button').first()).toHaveText(moved[0]!.name);
    await expect(list).toContainText(
      `${moved[0]!.move > 0 ? '+' : ''}${moved[0]!.move.toFixed(2)}`,
    );

    // The relations are the ones the comparison used, by kind, each with how many there are.
    const kinds = page.getByRole('list', { name: 'Relations to show' });
    const byKind = new Map<string, number>();
    for (const relation of analysis.relations)
      byKind.set(relation.type, (byKind.get(relation.type) ?? 0) + 1);
    await expect(kinds.getByRole('button')).toHaveCount(byKind.size);
    const some = kinds.getByRole('button').first();
    await expect(some).toHaveAttribute('aria-pressed', 'true');
    await some.click();
    await expect(some).toHaveAttribute('aria-pressed', 'false');
    await some.click();

    // Choosing an actor in the picture says what it is joined to, with the relation in words, from the relations used.
    const operator = analysis.actors.find((actor) => actor.name === 'Bus operator')!;
    await page.getByRole('button', { name: new RegExp(`^${operator.name}, `, 'u') }).focus();
    await page.keyboard.press('Enter');
    const joined = page.getByRole('region', { name: 'Connected to' });
    await expect(joined).toBeVisible();
    const theirs = analysis.relations.filter(
      (relation) => relation.from === operator.id || relation.to === operator.id,
    );
    expect(theirs.length).toBeGreaterThan(1);
    await expect(joined.getByRole('listitem')).toHaveCount(theirs.length);
    for (const relation of theirs) {
      const other = relation.from === operator.id ? relation.to : relation.from;
      await expect(joined.getByRole('button', { name: nameOf(other), exact: true })).toBeVisible();
    }

    // The colours can show how far each moved instead of where it ended.
    await page.getByRole('radio', { name: 'How far it moved' }).click();
    await expect(page.getByRole('radio', { name: 'How far it moved' })).toBeChecked();
    await expect(page.getByRole('main')).toContainText(
      'Lines are the relations the comparison used. They stay the same through the run',
    );
  });

  test('the timeline spreads every run over the rounds, lays the watched run over it, and has the figures as a table', async ({
    page,
  }) => {
    await page.goto(simulateAt(project, 'timeline'));
    await arrived(page);
    const chart = page.getByRole('slider', { name: /^Overall stance by round/u });
    await expect(chart).toBeVisible();
    // Both scenarios are drawn, and the run that was watched can be taken off the picture and put back.
    const legend = page.getByRole('list', { name: 'Scenarios' });
    await expect(legend.getByRole('button', { name: /^No change: shown/u })).toBeVisible();
    await expect(legend.getByRole('button', { name: /^Proposed change: shown/u })).toBeVisible();
    await expect(legend.getByRole('button', { name: /: shown$/u })).toHaveCount(
      analysis.config.variants.length + 1,
    );
    const watched = legend.getByRole('button', { name: /^The run you watched: shown/u });
    await expect(watched).toBeVisible();
    await watched.click();
    await expect(
      legend.getByRole('button', { name: /^The run you watched: hidden/u }),
    ).toBeVisible();
    // Scenarios can be taken off the picture one by one, but not the last one: there is always something drawn.
    const names = analysis.config.variants.map((variant) => variant.label);
    for (const name of names.slice(0, -1))
      await legend.getByRole('button', { name: `${name}: shown`, exact: true }).click();
    const lastName = names.at(-1)!;
    await legend.getByRole('button', { name: `${lastName}: shown`, exact: true }).click();
    await expect(
      legend.getByRole('button', { name: `${lastName}: shown`, exact: true }),
    ).toBeVisible();
    for (const name of names.slice(0, -1))
      await legend.getByRole('button', { name: `${name}: hidden`, exact: true }).click();

    // The cursor moves with the keys, and the readout under the picture follows it.
    await chart.focus();
    await page.keyboard.press('Home');
    await expect(chart).toHaveAttribute('aria-valuenow', String(first()));
    await page.keyboard.press('End');
    await expect(chart).toHaveAttribute('aria-valuenow', String(last()));
    await expect(page.getByText(`Round ${last()}`, { exact: true })).toBeVisible();

    // The same figures are a table: every round, each scenario's middle run and the range most runs fall in.
    await page.getByRole('button', { name: 'The figures' }).click();
    const table = page.getByRole('table', { name: /Overall stance by round/u });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(last() - first() + 2);
    for (const variant of analysis.config.variants)
      await expect(table.getByRole('columnheader', { name: variant.label })).toBeVisible();
    // The note under the picture says what it is and what it is not.
    await expect(page.getByRole('main')).toContainText('not a forecast');
  });

  test('plays the cursor along the timeline from its own button', async ({ page }) => {
    await page.goto(simulateAt(project, 'timeline'));
    await arrived(page);
    const chart = page.getByRole('slider', { name: /^Overall stance by round/u });
    await chart.focus();
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Play the rounds' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(chart).toHaveAttribute('aria-valuenow', String(last()), { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// Every view, at the sizes people use and in every theme: nothing wrong for axe, nothing off the page, text and controls
// of a size that can be read and pressed.
// ---------------------------------------------------------------------------------------------

const VIEWS: readonly TheatreView[] = ['Story', 'Live', 'Network', 'Timeline'];

for (const [label, viewport, themes, touch] of [
  ['a desktop', { width: 1440, height: 900 }, ['light', 'dark', 'high-contrast'], false],
  ['a laptop', { width: 1366, height: 768 }, ['light'], false],
  ['a tablet', { width: 768, height: 1024 }, ['light'], true],
  ['a phone', PHONE.viewport, ['light', 'dark'], true],
] as const) {
  test.describe(`on ${label}`, () => {
    test.use({ viewport, hasTouch: touch, reducedMotion: 'reduce' });

    for (const view of VIEWS) {
      test(`the ${view} view passes axe in ${themes.join(', ')}, fits the page and is made for ${touch ? 'a finger' : 'a pointer'}`, async ({
        page,
      }) => {
        const problems = watchPage(page);
        for (const theme of themes) {
          await page.addInitScript(
            (value) => window.localStorage.setItem('swarm.theme', value),
            theme,
          );
          await page.goto(simulateAt(project, view === 'Live' ? undefined : view.toLowerCase()));
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await audit(page, `${view}, ${theme}, ${label}`);
          if (theme !== themes[0]) continue;
          await quiet(page);
          await allOf({
            'no horizontal scroll': () => expectNoHorizontalOverflow(page),
            'controls of 24px or more': () =>
              expectPressable(page, `${view} ${label}`, { min: 24, scope: 'main' }),
            ...(touch
              ? {
                  'controls a finger wide': () =>
                    expectPressable(page, `${view} ${label}`, { min: 44, scope: 'main' }),
                }
              : {}),
          });
        }
        expect(problems).toEqual([]);
      });
    }
  });
}
