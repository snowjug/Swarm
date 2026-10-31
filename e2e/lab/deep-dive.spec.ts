import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { CITY_BRIEFING, CITY_QUESTION, actorsOf, getJson, seedThroughActors } from '../support/lab';

// The agent-by-agent engine that was there before the lab is the deep dive of a lab project. It runs
// on the key actors a person approved, in the stages that were already there, and the report it
// writes sits below the decision brief. Rules mode: no model is called.

test.use({ viewport: { width: 1440, height: 900 } });

interface Project {
  agents: { name: string }[];
  rounds: unknown[];
  mode: string;
  execution: { modelCalls: number } | null;
  report: { title: string } | null;
}

test('the deep dive runs on the approved key actors, and its report sits below the decision brief', async ({
  page,
}) => {
  const problems = watchPage(page);
  const project = await seedThroughActors(page, {
    title: 'Deep dive from approved actors',
    question: CITY_QUESTION,
    documents: [CITY_BRIEFING],
  });
  const cast = (await actorsOf(page, project)).actors?.actors ?? [];
  const actorNames = new Set(cast.map((actor) => actor.name));
  expect(cast.filter((actor) => actor.kind === 'key').length).toBeGreaterThan(0);

  await page.goto(`/?project=${project}`);
  await test.step('Env Setup is built from the approved actors, not from a list of its own', async () => {
    await page.getByRole('button', { name: /Prepare environment/u }).click();
    await expect(page.getByRole('button', { name: 'Start Simulation' })).toBeInViewport();
    const ready = await getJson<Project>(page, `/api/projects/${project}`);
    expect(ready.agents.length).toBeGreaterThan(0);
    expect(ready.agents.length).toBeLessThanOrEqual(6);
    for (const agent of ready.agents) {
      // A cohort stands in the engine by one representative, named for its group.
      const name = agent.name.replace(/ \(cohort representative\)$/u, '');
      expect(actorNames.has(name), `agent "${agent.name}" is an approved actor`).toBe(true);
    }
  });

  await test.step('the engine runs its rounds on them with no model', async () => {
    await page.getByRole('button', { name: 'Start Simulation' }).click();
    await expect(page.getByRole('button', { name: /Generate Report/u })).toBeVisible({
      timeout: 60_000,
    });
    const ran = await getJson<Project>(page, `/api/projects/${project}`);
    expect(ran.mode).toBe('local');
    expect(ran.rounds).toHaveLength(4);
    expect(ran.execution?.modelCalls ?? 0).toBe(0);
  });

  await test.step('its report is written, and the decision brief is still the first thing on the page', async () => {
    await page.getByRole('button', { name: /Generate Report/u }).click();
    await expect
      .poll(async () => (await getJson<Project>(page, `/api/projects/${project}`)).report?.title, {
        timeout: 60_000,
      })
      .toBeTruthy();
    const title = (await getJson<Project>(page, `/api/projects/${project}`)).report!.title;
    await expect(page.getByRole('heading', { name: 'Recorded report plan' })).toBeVisible();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    const brief = page.getByRole('region', { name: 'Decision brief' });
    const detailed = page.getByRole('heading', { name: 'Detailed report' });
    await expect(brief).toBeVisible();
    await expect(detailed).toBeVisible();
    const [above, below] = await Promise.all([brief.boundingBox(), detailed.boundingBox()]);
    expect(above!.y, 'the brief comes before the detailed report').toBeLessThan(below!.y);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page, 'report with the deep dive and the decision brief');
  });

  expect(problems, 'what the page logged or failed at').toEqual([]);
});
