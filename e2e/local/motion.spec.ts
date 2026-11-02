import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openApp, step } from '../support/app';
import { apiContext, watchPage } from '../support/helpers';
import {
  arrived,
  chooseSetting,
  countFrames,
  framesAskedFor,
  forget,
  makeProject,
  motionOf,
  openSettings,
  rootAttribute,
  stored,
  type Made,
} from '../support/shell';

// Motion, in a real browser: a person who asks for less motion, in the device or in the menu, gets none that
// is not needed, and everything still works: the ecosystem is drawn and can be read, the replay can be played,
// stepped and scrubbed. "Full" gives the motion back even to a device that asks for less.

/** A transition or an animation of this long, or shorter, is as good as none. */
const INSTANT_MS = 2;

let brief: Made;
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  brief = await makeProject(api, 'brief', { name: 'Motion: brief' });
});

test.afterAll(async () => {
  await forget(api, [brief.id]);
  await api.dispose();
});

test.use({ viewport: { width: 1440, height: 900 } });

const slider = (page: Page) => page.getByRole('slider', { name: 'Round' });
const round = async (page: Page): Promise<number> =>
  Number(await slider(page).getAttribute('aria-valuenow'));
const lastRound = async (page: Page): Promise<number> =>
  Number(await slider(page).getAttribute('aria-valuemax'));

/** The first party on the map: where the arrow keys start, and a name to look for in what the inspector says. */
const firstParty = (page: Page) => page.getByRole('button', { name: /^Customers, / });

// ---------------------------------------------------------------------------------------------

test.describe('a device that asks for less motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('makes every transition and animation as short as a millisecond, and lets nothing loop by itself', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await countFrames(page);
    await openApp(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await rootAttribute(page, 'data-motion'), 'the menu is on "Follow device"').toBeNull();
    const first = await motionOf(page);
    expect(
      first.longestMs,
      'the first screen: the longest transition or animation',
    ).toBeLessThanOrEqual(INSTANT_MS);
    expect(first.looping, 'the first screen: elements that animate for ever').toBe(0);
    expect(first.running, 'the first screen: animations that never end').toBe(0);
    // The drifting swarm behind the question is drawn once and left: it asks for no frames of its own.
    expect(
      await framesAskedFor(page),
      'frames the first screen asks for by itself',
    ).toBeLessThanOrEqual(2);

    // And on a scene, which has more that moves.
    await openApp(page, { project: brief.id, scene: 'compare' });
    const compare = await motionOf(page);
    expect(compare.longestMs, 'a scene: the longest transition or animation').toBeLessThanOrEqual(
      INSTANT_MS,
    );
    expect(compare.looping).toBe(0);
    expect(problems).toEqual([]);
  });

  test('draws the ecosystem where it rests, and a party can be chosen, read and let go from the keyboard', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: brief.id, scene: 'map' });
    const party = firstParty(page);
    await expect(party).toBeVisible();

    // It does not drift: two looks, some frames apart, find it in the same place.
    const where = async () => {
      const box = await party.boundingBox();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let frames = 0;
            const tick = () => (++frames >= 10 ? resolve() : requestAnimationFrame(tick));
            requestAnimationFrame(tick);
          }),
      );
      const later = await party.boundingBox();
      return box && later ? [box.x === later.x, box.y === later.y] : [false, false];
    };
    await expect.poll(where, { timeout: 15_000 }).toEqual([true, true]);

    // Chosen with the keyboard, which is how a person who asked for less motion may well be working.
    await party.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Customers' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Customers' })).toHaveCount(0);
    await expect(party).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('does not play the replay at a person, and plays, steps and scrubs it when asked', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: brief.id, scene: 'simulate' });
    await arrived(page);
    await expect(slider(page)).toBeVisible();
    // Opened for the first time, a run is replayed for someone who allows motion. Here it is at its end, to read.
    const last = await lastRound(page);
    expect(await round(page)).toBe(last);
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();

    await page.getByRole('button', { name: 'Previous round' }).click();
    expect(await round(page)).toBe(last - 1);
    await expect(page.getByRole('complementary', { name: `Round ${last - 1}` })).toBeVisible();

    // The keyboard scrubs: Home goes to the first round, End to the last, the arrows step.
    await slider(page).focus();
    await page.keyboard.press('Home');
    const first = await round(page);
    expect(first).toBeLessThan(last);
    await page.keyboard.press('ArrowRight');
    expect(await round(page)).toBe(first + 1);
    await page.keyboard.press('End');
    expect(await round(page)).toBe(last);

    // Played, it goes round by round; paused, it stays where it is.
    await page.getByRole('button', { name: 'Play again' }).click();
    await expect.poll(() => round(page), { timeout: 15_000 }).toBeGreaterThan(first + 1);
    await page.getByRole('button', { name: 'Pause' }).click();
    const stopped = await round(page);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(await round(page)).toBe(stopped);
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the motion setting in the menu', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('Reduced does what a device that asks for less does, keeps the choice, and Follow device gives control back', async ({
    page,
  }) => {
    await countFrames(page);
    await openApp(page, { project: brief.id, scene: 'ground' });
    // Allowed motion: the ambient light loops.
    expect((await motionOf(page)).looping).toBeGreaterThan(0);

    await chooseSetting(page, 'Reduced');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    expect(await stored(page, 'swarm.motion')).toBe('reduced');
    await expect
      .poll(async () => (await motionOf(page)).longestMs, { timeout: 15_000 })
      .toBeLessThanOrEqual(INSTANT_MS);
    const reduced = await motionOf(page);
    expect(reduced.looping).toBe(0);
    expect(reduced.running).toBe(0);
    expect(await framesAskedFor(page), 'frames the page asks for by itself').toBeLessThanOrEqual(2);

    // A run that has not been seen is not replayed at the person who asked for less: it is at its end, to read.
    await step(page, 'simulate').click();
    await arrived(page);
    await expect(slider(page)).toBeVisible();
    expect(await round(page)).toBe(await lastRound(page));

    // The choice is kept.
    await page.reload();
    await arrived(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    const menu = await openSettings(page);
    await expect(menu.getByRole('menuitemradio', { name: 'Reduced' })).toBeChecked();

    // Follow device: the attribute goes, and so does the choice.
    await menu.getByRole('menuitemradio', { name: 'Follow device' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-motion', /./u);
    expect(await stored(page, 'swarm.motion')).toBe('system');
    await expect.poll(async () => (await motionOf(page)).looping).toBeGreaterThan(0);
  });

  test('Full plays the motion even for a device that asks for less, and a run that has not been seen is replayed', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await countFrames(page);
    await openApp(page);
    expect((await motionOf(page)).longestMs, 'the device asks for less').toBeLessThanOrEqual(
      INSTANT_MS,
    );
    expect(await framesAskedFor(page), 'the swarm is drawn once').toBeLessThanOrEqual(2);

    await chooseSetting(page, 'Full');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
    expect(await stored(page, 'swarm.motion')).toBe('full');
    await expect.poll(async () => (await motionOf(page)).longestMs).toBeGreaterThan(50);
    // The swarm behind the question is alive again: it draws a frame of its own in each.
    await expect.poll(() => framesAskedFor(page)).toBeGreaterThanOrEqual(6);

    // A run that has not been seen is replayed, from where it begins, by itself.
    await openApp(page, { project: brief.id, scene: 'simulate' });
    await arrived(page);
    await expect(slider(page)).toBeVisible();
    const last = await lastRound(page);
    await expect.poll(() => round(page), { timeout: 15_000 }).toBeLessThan(last);
    const started = await round(page);
    await expect.poll(() => round(page), { timeout: 15_000 }).toBeGreaterThan(started);
  });
});
