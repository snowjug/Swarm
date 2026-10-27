import { expect, test, type Page, type Route } from '@playwright/test';
import {
  emptyVerdictCounts,
  type GroundedClaim,
  type GroundingReview,
} from '../../shared/grounding';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  seed,
  viewports,
} from '../support/helpers';

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const ids = { report: '', graph: '' };

test.beforeAll(async ({ playwright }) => {
  const provider = await playwright.request.newContext({ baseURL: providerUrl });
  await provider.post('/__reset');
  await provider.post('/__control', { data: { latencyMs: 0 } });
  const api = await apiContext(playwright);
  const options = { mode: 'llm', agents: 4, rounds: 3 } as const;
  ids.report = await seed(api, 'report', { name: 'Grounding UI: report', ...options });
  ids.graph = await seed(api, 'knowledge', { name: 'Grounding UI: graph', ...options });
  await provider.post('/__reset');
  await provider.dispose();
});

const HOSTILE = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script>';
const LONG = 'Unbroken'.repeat(60);

function claim(
  index: number,
  section: string,
  kind: GroundedClaim['kind'],
  verdict: GroundedClaim['verdict'],
  extra: Partial<GroundedClaim> = {},
): GroundedClaim {
  return {
    id: `C${index}`,
    section,
    text: `Statement ${index} of kind ${kind}, judged ${verdict}.`,
    kind,
    verdict,
    sourceIds: ['S1'],
    memoryIds: [],
    quote: null,
    checks: { quote: null, overlap: 0.4, numbers: null, entailment: null },
    reason: `The server judged this ${verdict} from the checks it ran.`,
    ...extra,
  };
}

/** Every kind and verdict, plus the awkward cases: no citation, an unknown id, hostile and very long text. */
function richReview(firstChapter: string): GroundingReview {
  const hostile = `Hostile ${HOSTILE} chapter`;
  const found = { quote: 'found', overlap: 0.9, numbers: null, entailment: 'supports' } as const;
  const claims = [
    claim(1, firstChapter, 'source-fact', 'supported', {
      quote: 'The Library Service proposes opening until nine in the evening',
      checks: found,
    }),
    claim(2, firstChapter, 'source-fact', 'contradicted', {
      quote: 'No survey has measured support',
      checks: { ...found, entailment: 'contradicts' },
    }),
    claim(3, firstChapter, 'extracted-claim', 'partial'),
    claim(4, firstChapter, 'extracted-claim', 'unsupported', { sourceIds: [] }),
    claim(5, firstChapter, 'user-assumption', 'unchecked', { sourceIds: [] }),
    claim(6, firstChapter, 'ai-hypothesis', 'unchecked', { sourceIds: [] }),
    claim(7, hostile, 'simulated-event', 'supported', { sourceIds: [], memoryIds: ['M1'] }),
    claim(8, hostile, 'analytical-conclusion', 'supported', {
      sourceIds: [],
      text: `Mean opinion moved to 0.31 ${LONG}`,
    }),
    claim(9, hostile, 'source-fact', 'contradicted', {
      text: `${HOSTILE} ${LONG}`,
      quote: `${HOSTILE} ${LONG}`,
      sourceIds: ['S1', 'S999'],
      reason: `${HOSTILE} ${LONG}`,
      checks: { quote: 'not-found', overlap: 0.1, numbers: 'mismatch', entailment: 'contradicts' },
    }),
    claim(10, 'A chapter that is not in the report', 'extracted-claim', 'partial'),
  ];
  const counts = emptyVerdictCounts();
  for (const item of claims) counts[item.verdict] += 1;
  return {
    checkedAt: '2026-01-01T12:00:00.000Z',
    method: 'deterministic',
    claims,
    counts,
    unverifiedFigures: [{ section: hostile, figures: ['47%', '$1.2M', LONG] }],
    notes: [
      `The independent model check did not run. ${LONG}`,
      'Only the first 30 statements are checked.',
    ],
  };
}

async function withRichReview(page: Page, id: string): Promise<void> {
  await page.route(`**/api/projects/${id}`, async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      report: { sections: { title: string }[]; grounding?: GroundingReview };
    };
    body.report.grounding = richReview(body.report.sections[0]?.title ?? 'Findings');
    await route.fulfill({ response, json: body });
  });
}

async function expectFits(page: Page, label: string): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectReadableText(page, label);
  await expectTargetSizes(page, label);
  await expectNoAxeViolations(page, label);
}

/** Below 900px the console shows one pane at a time; the reader (and the review) is the Report pane. */
async function showReader(page: Page, narrow: boolean): Promise<void> {
  if (narrow) {
    await page
      .getByRole('group', { name: 'Console pane' })
      .getByRole('button', { name: 'Report' })
      .click();
  }
}

for (const viewport of viewports) {
  test.describe(`model UI at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const narrow = viewport.width <= 900;

    test('a real model report shows its statement checks and names its provider', async ({
      page,
    }, testInfo) => {
      await page.goto(`/?project=${ids.report}`);
      await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^REAL MODEL · Ollama \(local\)/ }),
      ).toBeVisible();
      await showReader(page, narrow);

      const review = page.getByRole('region', { name: 'Grounding review' });
      await review.scrollIntoViewIfNeeded();
      await expect(
        review.getByRole('heading', { level: 2, name: 'Grounding review' }),
      ).toBeVisible();
      await expect(review).toContainText(/\d+ statements? checked/);
      await expect(review).toContainText(
        'plus an independent model check that had to quote real text',
      );
      await expect(review).toContainText('do not show that the passage itself is true');
      await review.screenshot({ path: testInfo.outputPath(`review-real-${viewport.name}.png`) });
      await expectFits(page, 'real grounding review');

      await review.getByText('What the kinds and verdicts mean').click();
      await expect(
        review
          .locator('.grounding-legend')
          .getByText('Backed by the cited passage.', { exact: true }),
      ).toBeVisible();
      await expectFits(page, 'real grounding review, legend open');

      await review.locator('.source-chip').first().click();
      await expect(page.getByRole('dialog')).toContainText('Source excerpt');
    });

    test('every verdict and kind renders inertly, fits, and stays accessible', async ({
      page,
    }, testInfo) => {
      await withRichReview(page, ids.report);
      await page.goto(`/?project=${ids.report}`);
      await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible();
      await showReader(page, narrow);
      const review = page.getByRole('region', { name: 'Grounding review' });
      await review.scrollIntoViewIfNeeded();

      await expect(review).toContainText('10 statements checked');
      await expect(review).toContainText('Deterministic checks only');
      await expect(review).toContainText('the independent model check did not run');
      await expect(
        review.getByRole('heading', { level: 3, name: /Contradicted by the sources \(2\)/ }),
      ).toBeVisible();
      await expect(
        review.getByRole('heading', { level: 3, name: 'Figures with nothing behind them' }),
      ).toBeVisible();
      await expect(review).toContainText(
        'No source or simulated memory is cited for this statement',
      );
      await expect(review).toContainText('A chapter that is not in the report');
      await review.screenshot({ path: testInfo.outputPath(`review-rich-${viewport.name}.png`) });

      // Hostile strings are text, never markup, and nothing in the review overflows its column.
      expect(await review.locator('img, script, iframe').count()).toBe(0);
      expect(
        await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
      ).toBeUndefined();
      expect(await review.getByText('onerror=').count()).toBeGreaterThan(0);
      await expectFits(page, 'rich grounding review');

      await review.getByText('What the kinds and verdicts mean').click();
      await expectFits(page, 'rich grounding review, legend open');

      // An unknown passage id is a visible chip that opens an honest inspector, not a crash.
      await review.getByRole('button', { name: 'S999' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoAxeViolations(page, 'inspector for an unknown passage');
    });

    test('the provider panel states what is real and verifies with one real round trip', async ({
      page,
    }) => {
      await page.goto('/');
      const badge = page.getByRole('button', { name: /^REAL MODEL · Ollama \(local\)/ });
      await expect(badge).toBeVisible();
      await badge.click();
      const panel = page.getByRole('region', { name: 'Model provider' });
      await expect(panel).toContainText(
        'Projects created in Model assisted mode send bounded context',
      );
      // Real requests already succeeded while the fixtures were seeded, so the entry card and the
      // badge must agree that the provider is connected, not repeat a stale "not yet verified".
      await expect(page.locator('.readiness')).toContainText('Connected');
      await expect(page.locator('.readiness')).not.toContainText(
        'Configured is not a connectivity check',
      );
      await expectFits(page, 'provider panel');
      await panel.getByRole('button', { name: 'Verify connection' }).click();
      await expect(panel).toContainText('Connection verified: one real round trip completed');
      await expect(panel).toContainText('connected');
      await expectFits(page, 'provider panel after verification');
    });

    test('a model graph node shows the verified source quote', async ({ page }) => {
      await page.goto(`/?project=${ids.graph}`);
      await expect(page.getByRole('button', { name: /Prepare environment/ })).toBeVisible();
      if (narrow) {
        await page
          .getByRole('group', { name: 'Console pane' })
          .getByRole('button', { name: 'Graph' })
          .click();
      }
      await page.getByRole('combobox', { name: /Inspect node/ }).selectOption({ index: 1 });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(/Source quote \(checked verbatim against S\d/);
      // The fake provider copies the start of the cited passage, which is what the server verified.
      await expect(dialog.locator('blockquote')).toContainText('This is a fictional scenario');
      await expectNoAxeViolations(page, 'node inspector with a source quote');
    });
  });
}
