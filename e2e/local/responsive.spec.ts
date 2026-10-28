import { expect, test, type Page } from '@playwright/test';
import {
  apiContext,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  renderedSvgTextPx,
  seed,
  svgLabelCollisions,
  svgLabelsUnderMarkers,
  viewports,
} from '../support/helpers';

const ids = {} as Record<'knowledge' | 'environment' | 'simulation' | 'report' | 'dense', string>;

test.beforeAll(async ({ playwright }) => {
  const api = await apiContext(playwright);
  ids.knowledge = await seed(api, 'knowledge', { name: 'Responsive: graph stage' });
  ids.environment = await seed(api, 'environment', { name: 'Responsive: environment stage' });
  ids.simulation = await seed(api, 'simulation', {
    name: 'Responsive: simulation stage',
    rounds: 6,
  });
  ids.report = await seed(api, 'report', { name: 'Responsive: report stage' });
  // Many simulated actors and recorded memories around the source graph, like a real model run.
  ids.dense = await seed(api, 'simulation', {
    name: 'Responsive: dense graph',
    agents: 20,
    rounds: 6,
  });
});

async function openGraphPane(page: Page, narrow: boolean): Promise<void> {
  if (narrow) {
    await page
      .getByRole('group', { name: 'Console pane' })
      .getByRole('button', { name: 'Graph' })
      .click();
  }
  await expect(page.getByRole('group', { name: /^Graph\./ })).toBeVisible();
}

for (const viewport of viewports) {
  test.describe(`${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const narrow = viewport.width <= 900;
    const desktop = viewport.width >= 1366;

    test('entry console: no overflow, readable text, usable targets', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Build Graph', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `entry ${viewport.name}`);
      await expectTargetSizes(page, `entry ${viewport.name}`);
      await page.getByRole('button', { name: 'Load fictional starter input' }).click();
      await expectNoHorizontalOverflow(page);
    });

    test('graph stage: one view control, primary action on screen, nothing overlays the stage, every node reachable', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.knowledge}`);
      const prepare = page.getByRole('button', { name: /Prepare environment/ });
      await expect(prepare).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `graph ${viewport.name}`);
      await expectTargetSizes(page, `graph ${viewport.name}`);

      // Exactly one view switcher is rendered, and no two visible buttons share the name "Graph".
      await expect(page.getByRole('group', { name: /^Console (view|pane)$/ })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Graph', exact: true })).toHaveCount(1);

      if (desktop) await expect(prepare).toBeInViewport();

      const position = await page
        .locator('.diagnostic-log')
        .evaluate((element) => getComputedStyle(element).position);
      expect(['static', 'relative']).toContain(position);

      await openGraphPane(page, narrow);
      const nodes = page.getByRole('button', { name: /source Topic\. Inspect/ });
      const total = await nodes.count();
      expect(total).toBeGreaterThanOrEqual(5);
      for (let index = 0; index < total; index += 1) {
        await nodes.nth(index).scrollIntoViewIfNeeded();
        // A trial click fails if another element would receive the pointer event.
        await nodes.nth(index).click({ trial: true });
      }
      const labelPx = await renderedSvgTextPx(page, '.graph-panel svg');
      expect(labelPx.length).toBeGreaterThan(0);
      expect(
        Math.min(...labelPx),
        'graph labels must render at 11px or more',
      ).toBeGreaterThanOrEqual(11);
    });

    // Captured from a live model run: 13 source entities and 6 simulated actors fitted into a small
    // panel left labels piled on top of each other (4 overlaps at 1440x900, 14 at 390x844).
    test('graph labels never overlap, even with many simulated actors and recorded memories', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.dense}`);
      await openGraphPane(page, narrow);
      await expect(page.locator('.graph-panel svg text').first()).toBeVisible();
      expect(await svgLabelCollisions(page, '.graph-panel svg'), 'overlapping labels').toEqual([]);
      // A marker is never painted over a name: labels sit in a layer above every node.
      expect(
        await svgLabelsUnderMarkers(page, '.graph-panel svg'),
        'labels painted under a node marker',
      ).toEqual([]);
      // Hiding a label never hides its node: every node keeps its accessible name.
      const named = await page.locator('.graph-panel svg [data-node-id]').count();
      const drawn = await page.locator('.graph-panel svg .graph-labels text').count();
      expect(drawn).toBeGreaterThan(0);
      expect(named).toBeGreaterThan(drawn);
    });

    test('environment stage: primary action on screen at desktop sizes, no overflow, 24px targets', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.environment}`);
      const start = page.getByRole('button', { name: 'Start Simulation' });
      await expect(start).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `environment ${viewport.name}`);
      await expectTargetSizes(page, `environment ${viewport.name}`);
      if (desktop) await expect(start).toBeInViewport();
      await page
        .locator('summary')
        .filter({ hasText: /Synthetic/ })
        .first()
        .click();
      await expectNoHorizontalOverflow(page);
      await expectTargetSizes(page, `environment persona ${viewport.name}`);
    });

    test('simulation stage: charts legible, graph and memories usable, nothing clipped', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.simulation}`);
      const next = page.getByRole('button', { name: /Generate Report/ });
      await expect(next).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `simulation ${viewport.name}`);
      await expectTargetSizes(page, `simulation ${viewport.name}`);
      if (desktop) await expect(next).toBeInViewport();

      const chartPx = await renderedSvgTextPx(page, '.chart, [class*="chart"]');
      expect(chartPx.length).toBeGreaterThan(0);
      expect(Math.min(...chartPx), 'chart text must render at 11px or more').toBeGreaterThanOrEqual(
        11,
      );
      const chart = page.getByRole('img', { name: /trajectory/i }).first();
      const box = await chart.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);

      await openGraphPane(page, narrow);
      const labelPx = await renderedSvgTextPx(page, '.graph-panel svg');
      expect(Math.min(...labelPx)).toBeGreaterThanOrEqual(11);
    });

    test('report stage: reader and evidence panel fit without horizontal scrolling', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.report}`);
      await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, `report ${viewport.name}`);
      await expectTargetSizes(page, `report ${viewport.name}`);
      await page.getByRole('button', { name: /Open Interaction/ }).click();
      await expect(page.getByRole('tab', { name: /Survey/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTargetSizes(page, `interaction ${viewport.name}`);
    });
  });
}
