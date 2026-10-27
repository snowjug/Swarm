import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiContext, getProject, listProjects } from '../support/helpers';

test.describe('guided journey on the deterministic local engine', () => {
  test('input → graph → environment → simulation → pause-state branch → intervention → resume → compare → report → citations → interaction → export → history', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const before = (await listProjects(api)).length;

    await test.step('an empty submission is validated in the page and sends nothing', async () => {
      await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
      await expect(page.getByText('Cannot build this project')).toBeVisible();
      expect((await listProjects(api)).length).toBe(before);
    });

    await test.step('Graph Build: starter input, bounded settings, real graph', async () => {
      await page.getByRole('button', { name: 'Load fictional starter input' }).click();
      await page.getByRole('spinbutton', { name: 'Fictional proxies' }).fill('8');
      await page.getByRole('spinbutton', { name: 'Rounds / platform' }).fill('4');
      await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
      await expect(page.getByRole('button', { name: /Prepare environment/ })).toBeVisible();
      expect((await listProjects(api)).length).toBe(before + 1);
      const nodes = page.getByRole('button', { name: /source Topic\. Inspect/ });
      expect(await nodes.count()).toBeGreaterThanOrEqual(5);
    });

    await test.step('node inspection works from the keyboard-accessible list and closes with Escape', async () => {
      await page.getByRole('combobox', { name: /Inspect node/ }).selectOption({ index: 1 });
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    await test.step('Environment Setup: Save is honest (disabled until something changes)', async () => {
      await page.getByRole('button', { name: /Prepare environment/ }).click();
      const save = page.getByRole('button', { name: 'Save environment' });
      await expect(save).toBeDisabled();
      await page.getByLabel('Scenario minutes / round').fill('45');
      await expect(save).toBeEnabled();
      await save.click();
      await expect(save).toBeDisabled();
    });

    const parentId = new URL(page.url()).searchParams.get('project');
    expect(parentId).toMatch(/^[0-9a-f-]{36}$/u);

    await test.step('Simulation: both independent platforms and a recorded trajectory', async () => {
      await page.getByRole('button', { name: 'Start Simulation' }).click();
      await expect(page.getByRole('button', { name: /Generate Report/ })).toBeVisible();
      await expect(page.getByText('Info Plaza').first()).toBeVisible();
      await expect(page.getByText('Topic Community').first()).toBeVisible();
      await expect(page.getByRole('img', { name: /trajectory/i }).first()).toBeVisible();
      const parent = await getProject(api, parentId!);
      expect(parent.rounds).toHaveLength(4);
    });

    await test.step('Branch from round 2 with a declared intervention; the branch opens paused', async () => {
      await page.getByRole('button', { name: 'Branch from here' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Last round to copy unchanged').selectOption('2');
      await dialog.getByRole('radio', { name: 'Replace with a future intervention' }).check();
      await dialog.getByLabel('Apply before round').selectOption('3');
      await dialog
        .getByLabel(/Intervention label/)
        .fill('Assumed announcement of extended evening hours');
      await dialog.getByLabel(/Assumed stance/).fill('0.9');
      await dialog.getByLabel(/Assumed strength/).fill('0.8');
      await dialog.getByLabel(/New project name/).fill('Evening hours announcement');
      await dialog.getByRole('button', { name: 'Create branch and open it' }).click();
      await expect(page.getByText(/Branched from .* at round 2/).first()).toBeVisible();
      await expect(page.getByText(/Paused after round 2 of 4/).first()).toBeVisible();
      const childId = new URL(page.url()).searchParams.get('project');
      expect(childId).not.toBe(parentId);
      const child = await getProject(api, childId!);
      expect(child.parentId).toBe(parentId);
      expect(child.rounds).toHaveLength(2);
      expect((await getProject(api, parentId!)).rounds).toHaveLength(4);
    });

    await test.step('Resume simulates only the remaining rounds', async () => {
      await page.getByRole('button', { name: /^Resume/ }).click();
      await expect(page.getByRole('button', { name: /Generate Report/ })).toBeVisible();
      const childId = new URL(page.url()).searchParams.get('project')!;
      expect((await getProject(api, childId)).rounds).toHaveLength(4);
    });

    await test.step('Compare with the parent: identical until the branch point, then diverging', async () => {
      await page.getByRole('button', { name: 'Compare with parent' }).click();
      await expect(page.getByRole('heading', { name: 'Compare recorded runs' })).toBeVisible();
      await expect(page.getByText('Identical through round 2')).toBeVisible();
      await expect(
        page.getByRole('img', { name: /recorded run comparison/ }).first(),
      ).toBeVisible();
      await expect(page.getByRole('table', { name: /Per-round recorded values/ })).toBeVisible();
      await expect(page.getByText(/not forecasts/).first()).toBeVisible();
      const childId = new URL(page.url()).searchParams.get('project')!;
      const comparison = await (
        await api.get(`/api/projects/${childId}/compare?with=${parentId}`)
      ).json();
      expect(comparison.identicalThroughRound).toBe(2);
      expect(comparison.rounds[2].delta.meanOpinion).not.toBe(0);
      await page.getByRole('button', { name: 'Back to current stage' }).click();
    });

    await test.step('Report: generated from recorded data, with inspectable source citations', async () => {
      await page.getByRole('button', { name: /Generate Report/ }).click();
      await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible();
      await expect(page.getByText(/rule-based rounds/).first()).toBeVisible();
      await page
        .getByRole('button', { name: /^S\d+$/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/library/i);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    await test.step('Export Markdown records lineage, limitations and the forecast disclaimer', async () => {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export Markdown' }).first().click();
      const file = await download;
      const markdown = await readFile(await file.path(), 'utf8');
      expect(file.suggestedFilename()).toMatch(/^swarm-lab-.*\.md$/u);
      expect(markdown).toContain('## Scenario lineage');
      expect(markdown).toContain(parentId!);
      expect(markdown).toContain('Synthetic scenario, not a calibrated forecast');
      expect(markdown).toContain('## Limitations');
    });

    await test.step('Export JSON preserves lineage, evidence and the full recorded state', async () => {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^swarm-lab-.*\.json$/u);
      const snapshot = JSON.parse(await readFile(await file.path(), 'utf8')) as {
        schemaVersion: number;
        project: {
          rounds: unknown[];
          console: { branch: { parentId: string; fromRound: number } };
        };
        evidence: unknown[];
      };
      expect(snapshot.schemaVersion).toBe(2);
      expect(snapshot.project.console.branch).toMatchObject({ parentId, fromRound: 2 });
      expect(snapshot.project.rounds).toHaveLength(4);
      expect(snapshot.evidence.length).toBeGreaterThan(0);
    });

    await test.step('Interaction: evidence lookup (no persona speaks) and a recorded-state survey', async () => {
      await page.getByRole('button', { name: /Open Interaction/ }).click();
      await page.getByRole('tab', { name: /Report chat/ }).click();
      await page
        .getByRole('textbox', { name: /Question for the report/ })
        .fill('evening opening hours');
      await page.getByRole('button', { name: 'Look up evidence' }).click();
      await expect(page.getByRole('region', { name: 'Saved conversation messages' })).toContainText(
        /evening|library/i,
      );

      await page.getByRole('tab', { name: /Any fictional agent/ }).click();
      await expect(page.getByText(/no persona speaking/i).first()).toBeVisible();

      await page.getByRole('tab', { name: /Survey/ }).click();
      await page.getByLabel(/Snapshot question/).fill('Where does each selected proxy stand?');
      const targets = page.getByRole('group', { name: /fictional proxies/i });
      await targets.getByRole('checkbox').nth(0).check();
      await targets.getByRole('checkbox').nth(1).check();
      await page.getByRole('button', { name: /Record state snapshot/ }).click();
      await expect(page.getByText(/supportive|opposing|undecided/i).first()).toBeVisible();
    });

    await test.step('History keeps both runs, labels the branch, and deletes only the chosen one', async () => {
      await page.getByRole('button', { name: /History/ }).click();
      const history = page.getByRole('dialog');
      await expect(history.getByText('Evening hours announcement')).toBeVisible();
      await expect(history.getByText('Branch of Fictional library-hours scenario')).toBeVisible();
      await history.getByRole('button', { name: 'Delete Evening hours announcement' }).click();
      await history.getByRole('button', { name: 'Delete permanently' }).click();
      await expect(history.getByText('Evening hours announcement')).toHaveCount(0);
      const remaining = await listProjects(api);
      expect(remaining.some((project) => project.id === parentId)).toBe(true);
      expect(remaining.some((project) => project.name === 'Evening hours announcement')).toBe(
        false,
      );
    });
  });
});
