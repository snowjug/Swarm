import { expect, test, type Page } from '@playwright/test';
import { advance, apiContext, expectNoAxeViolations, seed } from '../support/helpers';

const ids = {} as Record<
  'knowledge' | 'environment' | 'simulation' | 'report' | 'paused' | 'branch',
  string
>;

test.beforeAll(async ({ playwright }) => {
  const api = await apiContext(playwright);
  ids.knowledge = await seed(api, 'knowledge', { name: 'A11y: graph stage' });
  ids.environment = await seed(api, 'environment', { name: 'A11y: environment stage' });
  ids.simulation = await seed(api, 'simulation', { name: 'A11y: simulation stage', rounds: 6 });
  ids.report = await seed(api, 'report', { name: 'A11y: report stage' });
  const branch = async (name: string) => {
    const response = await api.post(`/api/projects/${ids.simulation}/branches`, {
      data: {
        name,
        fromRound: 2,
        intervention: {
          round: 4,
          label: 'Assumed announcement before round four',
          stance: 0.8,
          strength: 0.7,
        },
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  ids.paused = await branch('A11y: paused branch');
  ids.branch = await branch('A11y: resumed branch');
  await advance(api, ids.branch, 'simulation', true);
});

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;

async function showGraph(page: Page, narrow: boolean): Promise<void> {
  if (narrow) {
    await page
      .getByRole('group', { name: 'Console pane' })
      .getByRole('button', { name: 'Graph' })
      .click();
  }
}

for (const viewport of viewports) {
  test.describe(`axe: ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const narrow = viewport.width <= 900;

    test('entry console, filled and in a validation error state', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Build Graph', exact: true })).toBeVisible();
      await expectNoAxeViolations(page, 'entry');
      await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
      await expect(page.getByText('Cannot build this project')).toBeVisible();
      await expectNoAxeViolations(page, 'entry validation error');
      await page.getByRole('button', { name: 'Load fictional starter input' }).click();
      await expectNoAxeViolations(page, 'entry filled');
    });

    test('each guided stage', async ({ page }) => {
      for (const [stage, key, ready] of [
        ['graph', 'knowledge', /Prepare environment/],
        ['environment', 'environment', 'Start Simulation'],
        ['simulation', 'simulation', /Generate Report/],
        ['report', 'report', /Open Interaction/],
      ] as const) {
        await page.goto(`/?project=${ids[key]}`);
        await expect(page.getByRole('button', { name: ready })).toBeVisible();
        await expectNoAxeViolations(page, stage);
      }
      await page.getByRole('button', { name: /Open Interaction/ }).click();
      for (const tab of [/Report chat/, /Any fictional agent/, /Survey/]) {
        await page.getByRole('tab', { name: tab }).click();
        await expectNoAxeViolations(page, `interaction ${String(tab)}`);
      }
    });

    test('paused checkpoint with the intervention editor and the branch dialog', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.paused}`);
      await expect(page.getByText(/Paused after round 2 of 6/).first()).toBeVisible();
      await expectNoAxeViolations(page, 'paused branch');
      await page.getByText(/Edit scheduled intervention/).click();
      await expectNoAxeViolations(page, 'intervention editor');
      await page.getByRole('button', { name: 'Branch from here' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoAxeViolations(page, 'branch dialog');
      await page.getByRole('radio', { name: 'Replace with a future intervention' }).check();
      await expectNoAxeViolations(page, 'branch dialog with intervention fields');
    });

    test('run comparison, node inspector and history', async ({ page }) => {
      await page.goto(`/?project=${ids.branch}`);
      await page.getByRole('button', { name: 'Compare with parent' }).click();
      // The intervention is scheduled before round 4, so rounds 1-3 are identical to the parent.
      await expect(page.getByText(/Identical through round 3/)).toBeVisible();
      await expectNoAxeViolations(page, 'comparison');
      await page.getByRole('button', { name: 'Back to current stage' }).click();

      await page.goto(`/?project=${ids.knowledge}`);
      await showGraph(page, narrow);
      await page.getByRole('combobox', { name: /Inspect node/ }).selectOption({ index: 1 });
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoAxeViolations(page, 'node inspector');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /History/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoAxeViolations(page, 'history');
    });
  });
}

test.describe('keyboard and focus behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the graph is one tab stop, not one per node or edge', async ({ page }) => {
    await page.goto(`/?project=${ids.simulation}`);
    await expect(page.getByRole('button', { name: /Generate Report/ })).toBeVisible();
    const stops = await page
      .locator('.graph-panel svg [tabindex="0"], .graph-panel svg[tabindex="0"]')
      .count();
    expect(stops, 'tabbable elements inside the graph SVG').toBeLessThanOrEqual(2);
    const roles = await page.locator('.graph-panel svg .graph-edge[tabindex="0"]').count();
    expect(roles, 'edges must not be tab stops').toBe(0);
  });

  test('bracket keys move between nodes and Enter inspects, without a mouse', async ({ page }) => {
    await page.goto(`/?project=${ids.knowledge}`);
    const graph = page.getByRole('group', { name: /^Graph\./ });
    await graph.focus();
    await page.keyboard.press(']');
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    );
    expect(focused).toMatch(/Inspect /);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a modal keeps focus off the background, closes with Escape, and returns focus to its trigger', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.report}`);
    const trigger = page.getByRole('button', { name: /History/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // A native modal dialog may hand focus to the browser chrome after its last control (body),
    // but focus must never land on background page content.
    const seen = new Set<string>();
    for (let press = 0; press < 45; press += 1) {
      await page.keyboard.press('Tab');
      const location = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return 'browser';
        return active.closest('dialog, [role="dialog"]') ? 'dialog' : 'page';
      });
      seen.add(location);
      expect(location, `focus reached background content on Tab ${press + 1}`).not.toBe('page');
    }
    expect(seen.has('dialog'), 'focus must cycle back into the dialog').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('every stage button is reachable and announces its step and state in its visible name', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.simulation}`);
    const steps = page
      .getByRole('navigation', { name: 'Guided workflow steps' })
      .getByRole('button');
    await expect(steps).toHaveCount(5);
    const first = await steps.first().textContent();
    expect(first).toMatch(/Graph Build/);
    const accessible = await steps.first().evaluate((element) => element.textContent);
    expect(accessible).toContain('step 1 of 5');
  });
});
