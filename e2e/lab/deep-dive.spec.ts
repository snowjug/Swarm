import { expect, test } from '@playwright/test';
import type { ActorsView } from '../../shared/stakeholders';
import {
  advance,
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  seed,
  watchPage,
} from '../support/helpers';
import { PHONE, allOf, audit, expectPressable, makeProject, quiet } from '../support/shell';
import { deepStrip, openBranch, openDeep, openProjectId } from '../support/simulate';

// The agent-by-agent engine that was there before the lab is the deep dive of a lab project (`?view=deep`). It runs on
// the key actors a person approved, in stages that were already there, and the report it writes is a page of the
// decision scene, one press from the brief. Rules mode: no model is called.

test.use({ viewport: { width: 1440, height: 900 } });

interface Detail {
  agents: { name: string }[];
  rounds: unknown[];
  mode: string;
  execution: { modelCalls: number } | null;
  report: { title: string } | null;
}

test.describe('the deep dive of a lab project', () => {
  test('is made from the actors that were approved, runs them with no model, and writes a report one press from the brief', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const api = await apiContext(playwright);
    const { id } = await makeProject(api, 'brief', { name: 'Deep dive from approved actors' });
    const cast = ((await (await api.get(`/api/projects/${id}/actors`)).json()) as ActorsView).actors
      ?.actors;
    const actorNames = new Set((cast ?? []).map((actor) => actor.name));
    expect((cast ?? []).filter((actor) => actor.kind === 'key').length).toBeGreaterThan(0);

    await openDeep(page, id, 'Setup');
    await expect(deepStrip(page)).toContainText('Not prepared');

    await test.step('the cast is made from the approved actors, not from a list of its own', async () => {
      await deepStrip(page).getByRole('button', { name: 'Prepare the environment' }).click();
      await expect(deepStrip(page)).toContainText('Ready to start');
      const ready = (await (await api.get(`/api/projects/${id}`)).json()) as Detail;
      expect(ready.agents.length).toBeGreaterThan(0);
      expect(ready.agents.length).toBeLessThanOrEqual(6);
      for (const agent of ready.agents) {
        // A cohort stands in the engine by one representative, named for its group.
        const name = agent.name.replace(/ \(cohort representative\)$/u, '');
        expect(actorNames.has(name), `agent "${agent.name}" is an approved actor`).toBe(true);
        await expect(page.getByRole('main').getByText(agent.name, { exact: true })).toBeVisible();
      }
    });

    await test.step('the engine runs its rounds on them, with no model', async () => {
      await deepStrip(page).getByRole('button', { name: 'Start the simulation' }).click();
      await expect(deepStrip(page)).toContainText('Finished', { timeout: 60_000 });
      await expect(deepStrip(page)).toContainText('4 rounds on 2 platforms.');
      const ran = (await (await api.get(`/api/projects/${id}`)).json()) as Detail;
      expect(ran.mode).toBe('local');
      expect(ran.rounds).toHaveLength(4);
      expect(ran.execution?.modelCalls ?? 0).toBe(0);
    });

    await test.step('its report is written, and opens beside the brief, which is one press away', async () => {
      await deepStrip(page).getByRole('button', { name: 'Write the detailed report' }).click();
      await expect(
        deepStrip(page).getByRole('button', { name: 'Open the detailed report' }),
      ).toBeVisible({ timeout: 60_000 });
      const title = ((await (await api.get(`/api/projects/${id}`)).json()) as Detail).report!.title;
      expect(title).toBeTruthy();
      await deepStrip(page).getByRole('button', { name: 'Open the detailed report' }).click();
      await expect(page).toHaveURL(/scene=decide/u);
      await expect(page).toHaveURL(/view=report/u);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
      const here = page.getByRole('navigation', { name: 'Where you are' });
      await expect(here.locator('[aria-current="page"]')).toHaveText('Detailed report');
      await audit(page, 'the detailed report written by the deep dive');
      await here.getByRole('button', { name: 'Decision brief' }).click();
      await expect(page).not.toHaveURL(/view=report/u);
      await expect(here).toHaveCount(0);
    });
    expect(openProjectId(page)).toBe(id);
    expect(problems, 'what the page logged or failed at').toEqual([]);
  });

  test('can be run before the scenarios are compared, and says that its report opens with the decision page', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const { id } = await makeProject(api, 'actors', { name: 'Deep dive before the comparison' });
    await advance(api, id, 'environment');
    await advance(api, id, 'simulation');
    await advance(api, id, 'report');
    await openDeep(page, id);
    await expect(deepStrip(page)).toContainText('Finished');

    // The report exists, but the page it opens on does not yet: the strip and the list of what to do say so, and the
    // way to open it is the way to compare the scenarios, not a press that does nothing.
    await expect(deepStrip(page)).toContainText(
      'The report is written. It opens with the decision page, once the scenarios have been compared.',
    );
    await expect(
      deepStrip(page).getByRole('button', { name: 'Open the detailed report' }),
    ).toHaveCount(0);
    const row = page.getByRole('button', { name: /^Open the detailed report/u });
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await deepStrip(page).getByRole('button', { name: 'Set up the comparison' }).click();
    await expect(page).toHaveURL(/view=setup/u);
  });
});

// ---------------------------------------------------------------------------------------------
// The deep dive of a finished run, tab by tab, at the sizes people use and in every theme
// ---------------------------------------------------------------------------------------------

const TABS = ['Setup', 'Run', 'Rounds', 'Memory'] as const;

for (const [label, viewport, themes, touch] of [
  ['a desktop', { width: 1440, height: 900 }, ['light', 'dark', 'high-contrast'], false],
  ['a tablet', { width: 768, height: 1024 }, ['light'], true],
  ['a phone', PHONE.viewport, ['light', 'dark'], true],
] as const) {
  test.describe(`on ${label}`, () => {
    test.use({ viewport, hasTouch: touch, reducedMotion: 'reduce' });

    test(`every tab of a finished run, and the sheet that branches it, pass axe in ${themes.join(', ')}, fit the page and are made for ${touch ? 'a finger' : 'a pointer'}`, async ({
      page,
      playwright,
    }) => {
      const problems = watchPage(page);
      const api = await apiContext(playwright);
      const id = await seed(api, 'simulation', { name: `Deep dive at ${label}`, rounds: 4 });
      for (const theme of themes) {
        await page.addInitScript(
          (value) => window.localStorage.setItem('swarm.theme', value),
          theme,
        );
        for (const tab of TABS) {
          await openDeep(page, id, tab);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await audit(page, `the ${tab} tab of the deep dive, ${theme}, ${label}`);
          if (theme !== themes[0]) continue;
          await quiet(page);
          await allOf({
            'no horizontal scroll': () => expectNoHorizontalOverflow(page),
            'controls of 24px or more': () =>
              expectPressable(page, `the ${tab} tab ${label}`, { min: 24, scope: 'main' }),
            ...(touch
              ? {
                  'controls a finger wide': () =>
                    expectPressable(page, `the ${tab} tab ${label}`, { min: 44, scope: 'main' }),
                }
              : {}),
          });
        }
        await openDeep(page, id, 'Run');
        const sheet = await openBranch(page);
        await expectNoAxeViolations(page, `the sheet that branches a run, ${theme}, ${label}`);
        if (theme === themes[0] && touch)
          await expectPressable(page, `the branch sheet ${label}`, {
            min: 44,
            scope: '[role=dialog]',
          });
        await sheet.getByRole('button', { name: 'Keep the source run unchanged' }).click();
        await expect(sheet).toHaveCount(0);
      }
      expect(problems).toEqual([]);
    });
  });
}
