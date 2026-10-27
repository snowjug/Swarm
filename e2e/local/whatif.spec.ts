import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiContext, getProject, seed } from '../support/helpers';

interface Comparison {
  identicalThroughRound: number;
  declaredChanges: { kind: string; field?: string; agentId?: string }[];
  rounds: { delta: { meanOpinion: number } | null }[];
}

test.describe('what-if controls beyond the main journey', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a proxy assumption edit applies only after the branch point and is declared in the lineage', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', { name: 'What-if parent', rounds: 6 });
    await page.goto(`/?project=${parentId}`);
    await page.getByRole('button', { name: 'Branch from here' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Last round to copy unchanged').selectOption('3');
    await dialog.getByLabel(/New project name/).fill('Proxy edit branch');

    await dialog.getByRole('button', { name: 'Add proxy assumption edit' }).click();
    await dialog.getByLabel('Influence (0.1–2)').fill('2');
    await dialog.getByLabel('Inclination (−1 to +1)').fill('-1');
    await dialog.getByRole('button', { name: 'Create branch and open it' }).click();

    await expect(page.getByText(/Branched from What-if parent at round 3/).first()).toBeVisible();
    const childId = new URL(page.url()).searchParams.get('project')!;
    await expect(page.getByText(/declared assumption changes/).first()).toBeVisible();
    await page.getByRole('button', { name: /^Resume/ }).click();
    await expect(page.getByRole('button', { name: /Generate Report/ })).toBeVisible();

    const comparison = (await (
      await api.get(`/api/projects/${childId}/compare?with=${parentId}`)
    ).json()) as Comparison;
    expect(comparison.identicalThroughRound).toBe(3);
    expect(
      comparison.declaredChanges.map((change) => `${change.kind}:${change.field}`).sort(),
    ).toEqual(['agent:influence', 'agent:opinion']);
    expect(comparison.rounds[3]?.delta?.meanOpinion).not.toBe(0);
    expect((await getProject(api, parentId)).rounds).toHaveLength(6);
  });

  test('branching from round 0 starts a fresh run, and the dialog refuses a duplicate proxy row', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', {
      name: 'Round zero parent',
      rounds: 4,
      agents: 4,
    });
    await page.goto(`/?project=${parentId}`);
    await page.getByRole('button', { name: 'Branch from here' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Last round to copy unchanged').selectOption('0');
    await expect(dialog.getByText(/No simulation rounds are copied/)).toBeVisible();

    // Only four proxies exist: the add button disables once every proxy is used, so duplicates are impossible.
    const add = dialog.getByRole('button', { name: 'Add proxy assumption edit' });
    for (let index = 0; index < 4; index += 1) await add.click();
    await expect(add).toBeDisabled();
    await expect(dialog.getByText(/Duplicate proxy rows are not allowed/)).toBeVisible();

    // An edit that changes nothing is rejected in the page before any request is sent.
    await dialog.getByRole('button', { name: 'Create branch and open it' }).click();
    await expect(dialog.getByText('Branch was not created')).toBeVisible();

    for (let index = 4; index > 1; index -= 1)
      await dialog.getByRole('button', { name: `Remove proxy edit ${index}` }).click();
    await dialog.getByLabel('Inclination (−1 to +1)').fill('0.9');
    await dialog.getByLabel(/New project name/).fill('Fresh run branch');
    await dialog.getByRole('button', { name: 'Create branch and open it' }).click();

    await expect(
      page.getByText(/Branched from Round zero parent at round 0/).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Simulation/ })).toBeVisible();
    const child = await getProject(api, new URL(page.url()).searchParams.get('project')!);
    expect(child.rounds).toHaveLength(0);
    expect(child.console?.steps.simulation).toBe('pending');
  });

  test('restart from a paused checkpoint asks first, names what is discarded, and can be declined', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const parentId = await seed(api, 'simulation', { name: 'Restart parent', rounds: 6 });
    const branch = await api.post(`/api/projects/${parentId}/branches`, { data: { fromRound: 2 } });
    const childId = ((await branch.json()) as { id: string }).id;
    await page.goto(`/?project=${childId}`);

    // A paused run cannot export Markdown (no report), but its JSON snapshot must work.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const snapshot = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
      project: { rounds: unknown[]; status: string; console: { steps: { simulation: string } } };
    };
    expect(snapshot.project.console.steps.simulation).toBe('paused');
    expect(snapshot.project.rounds).toHaveLength(2);

    await page.getByRole('button', { name: /^Restart from round 1/ }).click();
    const dialog = page.getByRole('dialog', { name: /Restart simulation from round 1/ });
    await expect(dialog).toContainText('discards 2 saved rounds');
    await dialog.getByRole('button', { name: 'Keep saved rounds' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await getProject(api, childId)).rounds).toHaveLength(2);

    await page.getByRole('button', { name: /^Restart from round 1/ }).click();
    await page.getByRole('button', { name: /^Discard 2 saved rounds and restart/ }).click();
    await expect(page.getByRole('button', { name: /Generate Report/ })).toBeVisible({
      timeout: 30_000,
    });
    expect((await getProject(api, childId)).rounds).toHaveLength(6);
  });
});
