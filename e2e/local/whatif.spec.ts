import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  advance,
  apiContext,
  expectNoAxeViolations,
  getProject,
  seed,
  watchPage,
} from '../support/helpers';
import { audit, makeProject, openSettings } from '../support/shell';
import {
  branchSheet,
  compareAt,
  createBranch,
  deepStrip,
  openBranch,
  openDeep,
  openProjectId,
  trackTo,
} from '../support/simulate';

// What-if lives in the deep dive of a project the engine ran (`?view=deep`, on its Run tab): the assumed event, the branch
// from a checkpoint with the proxies it changes, the restart that asks first, and the comparison of two recorded runs
// (`?scene=compare&view=runs`). Rules mode on the seeded library scenario: nothing here needs a model, and every run is
// the engine's.

interface Comparison {
  identicalThroughRound: number;
  declaredChanges: { kind: string; field?: string; agentId?: string }[];
  rounds: { delta: { meanOpinion: number } | null }[];
}

interface Detail {
  agents: { id: string; name: string }[];
  rounds: { round: number; intervention: unknown }[];
  settings: { intervention: { round: number; label: string } | null };
  console: { branch: { fromRound: number; changes: { kind: string }[] } | null } | null;
}

test.describe('what-if in the deep dive of a run', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a proxy change made in a branch applies only after the checkpoint, and the branch declares it', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', { name: 'What-if parent', rounds: 6 });
    await openDeep(page, parentId);
    const sheet = await openBranch(page);
    await expect(sheet).toContainText('Rounds 1 to 5 are copied unchanged.');
    await trackTo(sheet.getByRole('slider', { name: 'Last round to copy unchanged' }), 3);
    await expect(sheet).toContainText(
      'Rounds 1 to 3 are copied unchanged. What you change applies from round 4.',
    );
    await sheet.getByRole('textbox', { name: /^Name of the branch/u }).fill('Proxy edit branch');
    await sheet.getByRole('button', { name: 'Change a proxy' }).click();
    await sheet.getByLabel('Influence', { exact: true }).fill('2');
    await sheet.getByLabel('Inclination', { exact: true }).fill('-1');
    await expect(sheet.getByRole('status')).toContainText(
      'Copies rounds 1 to 3 unchanged. Changes one proxy.',
    );
    await expectNoAxeViolations(page, 'the sheet that branches a run, with a proxy changed');
    await createBranch(sheet).click();

    // The branch is open on its own, waiting at the checkpoint, and says what it is.
    await expect(branchSheet(page)).toHaveCount(0);
    await expect.poll(() => openProjectId(page)).not.toBe(parentId);
    const childId = openProjectId(page);
    await expect(deepStrip(page)).toContainText('Branch ready');
    await expect(deepStrip(page)).toContainText('Copied through round 3 of 6');
    const lineage = page.getByRole('region', { name: 'A branch of What-if parent' });
    await expect(lineage).toContainText('Left after round 3. Rounds 1 to 3 were copied unchanged.');
    await expect(lineage).toContainText('Declared changes are assumptions, not proof of a cause.');
    await expect(lineage).toContainText('2 declared changes');
    await expect(lineage).toContainText(/influence: [\d.]+ → 2\.00\./u);
    await expect(lineage).toContainText(/inclination: -?[\d.]+ → -1\.00\./u);

    await deepStrip(page)
      .getByRole('button', { name: /^Resume — simulate rounds 4–6/u })
      .click();
    await expect(deepStrip(page)).toContainText('Finished', { timeout: 60_000 });

    const comparison = (await (
      await api.get(`/api/projects/${childId}/compare?with=${parentId}`)
    ).json()) as Comparison;
    expect(comparison.identicalThroughRound).toBe(3);
    expect(
      comparison.declaredChanges.map((change) => `${change.kind}:${change.field}`).sort(),
    ).toEqual(['agent:influence', 'agent:opinion']);
    expect(comparison.rounds[3]?.delta?.meanOpinion).not.toBe(0);
    expect((await getProject(api, parentId)).rounds).toHaveLength(6);
    expect(problems, 'what the page logged or failed at').toEqual([]);
  });

  test('branching from the start begins a fresh run, a proxy is changed once, and nothing is created until something differs', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', {
      name: 'Round zero parent',
      rounds: 4,
      agents: 4,
    });
    await openDeep(page, parentId);
    const sheet = await openBranch(page);
    await trackTo(sheet.getByRole('slider', { name: 'Last round to copy unchanged' }), 0);
    await expect(sheet).toContainText('Start again from round 1. No rounds are copied.');

    // Only four proxies exist: the button stops offering once every one of them has a row.
    const add = sheet.getByRole('button', { name: /^Change (a|another) proxy$/u });
    for (let index = 0; index < 4; index += 1) await add.click();
    await expect(add).toBeDisabled();
    await expect(sheet.getByRole('group', { name: /^Proxy change \d$/u })).toHaveCount(4);

    // A change that changes nothing is not accepted: the sheet says what is missing and does not offer to create.
    await expect(createBranch(sheet)).toBeDisabled();
    await expect(sheet.getByRole('status')).toContainText(
      'Change at least one of influence, openness or inclination.',
    );

    const removals = sheet.getByRole('button', { name: /^Remove the change to / });
    for (let left = 4; left > 1; left -= 1) await removals.last().click();
    await expect(sheet.getByRole('group', { name: /^Proxy change \d$/u })).toHaveCount(1);
    await sheet.getByLabel('Inclination', { exact: true }).fill('0.9');
    await sheet.getByRole('textbox', { name: /^Name of the branch/u }).fill('Fresh run branch');
    await expect(createBranch(sheet)).toBeEnabled();
    await createBranch(sheet).click();

    await expect.poll(() => openProjectId(page)).not.toBe(parentId);
    await expect(deepStrip(page)).toContainText('Ready to start');
    await expect(page.getByRole('region', { name: 'A branch of Round zero parent' })).toContainText(
      'No rounds were copied; this branch starts from scratch.',
    );
    await expect(
      deepStrip(page).getByRole('button', { name: 'Start the simulation' }),
    ).toBeVisible();
    const child = await getProject(api, openProjectId(page));
    expect(child.rounds).toHaveLength(0);
    expect(child.console?.steps.simulation).toBe('pending');
  });

  test('an assumed event is scheduled in a paused branch, can be replaced and removed, and lands in the round it names', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', { name: 'Event parent', rounds: 6 });
    const made = await api.post(`/api/projects/${parentId}/branches`, { data: { fromRound: 2 } });
    const childId = ((await made.json()) as { id: string }).id;
    await openDeep(page, childId);

    const section = page.getByRole('region', { name: 'An assumed event' });
    await expect(section).toContainText('No event is scheduled.');
    const when = section.getByRole('slider', { name: 'Round the event is applied before' });
    const schedule = async (round: number, what: string): Promise<void> => {
      await trackTo(when, round);
      await section.getByRole('textbox', { name: 'What happens' }).fill(what);
      await section.getByRole('spinbutton', { name: 'Stance' }).fill('0.8');
      await section.getByRole('spinbutton', { name: 'Strength' }).fill('0.7');
      await section.getByRole('button', { name: /^(Schedule|Replace) the event$/u }).click();
    };

    await schedule(4, 'The council announces longer weekday hours');
    await expect(section).toContainText('Scheduled before round 4');
    await expect(section).toContainText('“The council announces longer weekday hours”');
    await expect(section).toContainText('stance +0.80 · strength 0.70');
    await expect(
      page.getByText('The flag marks the assumed event: scheduled before round 4.'),
    ).toBeVisible();
    expect(
      (await api.get(`/api/projects/${childId}`).then((r) => r.json())).settings,
    ).toMatchObject({
      intervention: { round: 4, label: 'The council announces longer weekday hours' },
    });

    // Another round and another sentence replace it: there is only ever the one.
    await schedule(5, 'Residents are told the hours will be reviewed');
    await expect(section).toContainText('Scheduled before round 5');
    await expect(section).toContainText('“Residents are told the hours will be reviewed”');
    await section.getByRole('button', { name: 'Remove it' }).click();
    await expect(section).toContainText('No event is scheduled.');
    expect(
      ((await (await api.get(`/api/projects/${childId}`)).json()) as Detail).settings.intervention,
    ).toBeNull();

    await schedule(4, 'The council announces longer weekday hours');
    await expect(section).toContainText('Scheduled before round 4');
    await deepStrip(page)
      .getByRole('button', { name: /^Resume — simulate rounds 3–6/u })
      .click();
    await expect(deepStrip(page)).toContainText('Finished', { timeout: 60_000 });

    // It landed in round 4 and in no other, and the page says so; a finished run is never rewritten.
    const done = (await (await api.get(`/api/projects/${childId}`)).json()) as Detail;
    expect(done.rounds.filter((round) => round.intervention !== null).map((r) => r.round)).toEqual([
      4,
    ]);
    await expect(section).toContainText('Applied in round 4');
    await expect(section).toContainText(
      'A finished run is never rewritten. Branch it to try a different event.',
    );
    await expect(section.getByRole('button', { name: 'Schedule the event' })).toHaveCount(0);

    // The run that was branched from still has no event, and all its rounds.
    const parent = (await (await api.get(`/api/projects/${parentId}`)).json()) as Detail;
    expect(parent.settings.intervention).toBeNull();
    expect(parent.rounds).toHaveLength(6);
  });

  test('a branch is set against the run it came from: one press on the branch opens the comparison of the two, where they part', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    // The comparison of two runs opens with the comparison of scenarios, so the run that is branched has one.
    const { id: parentId } = await makeProject(api, 'compared', { name: 'Compared parent' });
    await advance(api, parentId, 'environment');
    await advance(api, parentId, 'simulation');
    const parent = (await (await api.get(`/api/projects/${parentId}`)).json()) as Detail;
    const made = await api.post(`/api/projects/${parentId}/branches`, {
      data: {
        fromRound: 2,
        name: 'Compared branch',
        intervention: { round: 3, label: 'A new service is announced', stance: 0.9, strength: 0.9 },
        agentEdits: [{ id: parent.agents[0]!.id, influence: 2, opinion: -1 }],
      },
    });
    expect(made.status(), await made.text()).toBe(201);
    const childId = ((await made.json()) as { id: string }).id;
    await advance(api, childId, 'simulation', true);

    // The branch is a project of its own and has not compared scenarios: its way to the comparison goes through its parent.
    await openDeep(page, childId);
    await page
      .getByRole('region', { name: 'A branch of Compared parent' })
      .getByRole('button', { name: /^Compare with the parent/u })
      .click();
    await expect(page).toHaveURL(/scene=compare/u);
    await expect(page).toHaveURL(/view=runs/u);
    await expect.poll(() => openProjectId(page)).toBe(parentId);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText('Compared parent');
    await expect(heading).toContainText('is the parent run of');
    await expect(heading).toContainText('Compared branch');
    await expect(page.getByText('Identical through round 2')).toBeVisible();
    const changes = page.getByRole('region', { name: 'What was declared changed' });
    await expect(changes).toContainText(
      'Scheduled intervention: none → round 3: “A new service is announced”',
    );
    await expect(changes).toContainText(/influence: [\d.]+ → 2\.00\./u);
    await expect(changes).toContainText(/inclination: -?[\d.]+ → -1\.00\./u);
    await expect(
      page.getByText(
        'Recorded values of two simulations under their stated assumptions. Not a forecast, and not a cause.',
      ),
    ).toBeVisible();
    await audit(page, 'the comparison of two recorded runs');

    // Each run opens in its own deep dive, and the parent's list of what to do offers the same comparison.
    await page.getByRole('button', { name: 'Open this run' }).last().click();
    await expect(page).toHaveURL(/view=deep/u);
    await openDeep(page, parentId);
    await page.getByRole('button', { name: /^Compare two recorded runs/u }).click();
    await expect(page).toHaveURL(/view=runs/u);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('is the parent run of');
    await page.goto(compareAt(parentId, 'runs'));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Compared branch');
  });

  test('where the scenarios have not been compared, the comparison of two runs says it is not open yet and does nothing', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', { name: 'Not compared parent', rounds: 4 });
    const made = await api.post(`/api/projects/${parentId}/branches`, { data: { fromRound: 2 } });
    const childId = ((await made.json()) as { id: string }).id;
    await openDeep(page, childId);

    const lineage = page.getByRole('region', { name: 'A branch of Not compared parent' });
    await expect(lineage).toContainText(
      'Comparing the two runs opens once the scenarios have been compared.',
    );
    await expect(lineage.getByRole('button', { name: /^Compare with the parent/u })).toHaveCount(0);
    const row = page.getByRole('button', { name: /^Compare two recorded runs/u });
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toContainText('Opens once the scenarios have been compared.');
    // A row that is not open is not a control that fails: pressing it, even by force, changes nothing.
    await row.click({ force: true });
    await expect(page).toHaveURL(/view=deep/u);
    await expect(deepStrip(page)).toBeVisible();
  });

  test('a restart from a paused checkpoint asks first, names what it discards, and can be declined', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', { name: 'Restart parent', rounds: 6 });
    const branch = await api.post(`/api/projects/${parentId}/branches`, { data: { fromRound: 2 } });
    const childId = ((await branch.json()) as { id: string }).id;
    await openDeep(page, childId);

    // A paused run has no report, but a snapshot of what it holds can be taken.
    const download = page.waitForEvent('download');
    await (await openSettings(page)).getByRole('menuitem', { name: 'Export snapshot' }).click();
    const snapshot = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
      project: { rounds: unknown[]; console: { steps: { simulation: string } } };
    };
    expect(snapshot.project.console.steps.simulation).toBe('paused');
    expect(snapshot.project.rounds).toHaveLength(2);

    const restart = page.getByRole('button', { name: /^Restart from round 1/u });
    await restart.click();
    const dialog = page.getByRole('dialog', { name: 'Restart from round 1?' });
    await expect(dialog).toContainText('This discards 2 saved rounds');
    await expect(dialog).toContainText('It is not a resume.');
    await dialog.getByRole('button', { name: 'Keep the saved rounds' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await getProject(api, childId)).rounds).toHaveLength(2);

    await restart.click();
    await page.getByRole('button', { name: 'Discard 2 saved rounds' }).click();
    await expect(deepStrip(page)).toContainText('Finished', { timeout: 60_000 });
    expect((await getProject(api, childId)).rounds).toHaveLength(6);
  });
});
