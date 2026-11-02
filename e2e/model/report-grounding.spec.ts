import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
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
  viewports,
  watchPage,
} from '../support/helpers';
import { expectPressable, forget, quiet } from '../support/shell';
import { modelReport } from '../support/decide';

// The statement checks of a detailed report written by a model, in a real browser, against the protocol-faithful
// fake of the provider (e2e/support/fake-provider.ts): what the server checked is said in words and numbers, a
// passage is one press away, and nothing the server sends is read as markup or breaks the page. The fake says nothing
// about how a live model writes.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const HOSTILE = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script>';
const LONG = 'Unbroken'.repeat(60);

test.use({ reducedMotion: 'reduce', actionTimeout: 30_000 });

let api: APIRequestContext;
let reportId = '';

test.beforeAll(async ({ playwright }) => {
  const provider = await playwright.request.newContext({ baseURL: providerUrl });
  await provider.post('/__reset');
  await provider.post('/__control', { data: { latencyMs: 0 } });
  api = await apiContext(playwright);
  reportId = await modelReport(api, 'Grounding UI: report');
  await provider.post('/__reset');
  await provider.dispose();
});

test.afterAll(async () => {
  await forget(api, [reportId]);
  await api.dispose();
});

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
    try {
      const response = await route.fetch();
      const body = (await response.json()) as {
        report: { sections: { title: string }[]; grounding?: GroundingReview };
      };
      body.report.grounding = richReview(body.report.sections[0]?.title ?? 'Findings');
      await route.fulfill({ response, json: body });
    } catch {
      // A read still on its way when the page goes is not a failure of the page.
      await route.abort().catch(() => undefined);
    }
  });
}

async function fits(page: Page, label: string): Promise<void> {
  await quiet(page);
  await expectNoHorizontalOverflow(page);
  await expectReadableText(page, label);
  await expectPressable(page, label);
  await expectNoAxeViolations(page, label);
}

/** The detailed report, scrolled to the checks of its statements. */
async function openChecks(page: Page, id: string) {
  await page.goto(`/?project=${id}&scene=decide&view=report`);
  const review = page.getByRole('region', { name: 'What was checked' });
  await expect(review).toBeAttached();
  await review.scrollIntoViewIfNeeded();
  await expect(review.getByRole('heading', { level: 2, name: 'What was checked' })).toBeVisible();
  return review;
}

for (const viewport of viewports) {
  test.describe(`statement checks at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('a model report shows its checks, says what they are, and names the passages', async ({
      page,
    }, testInfo) => {
      const problems = watchPage(page);
      const project = (await (await api.get(`/api/projects/${reportId}`)).json()) as {
        report: { grounding?: { claims: unknown[] } };
      };
      expect(
        project.report.grounding?.claims.length ?? 0,
        'the fake provider wrote statements that were checked',
      ).toBeGreaterThan(0);

      const review = await openChecks(page, reportId);
      await expect(review).toContainText(/\d+\s*statements? checked/u);
      await expect(review).toContainText(
        'plus an independent model check that had to quote real text',
      );
      await review.screenshot({ path: testInfo.outputPath(`checks-real-${viewport.name}.png`) });
      await fits(page, 'the checks of a model report');

      await review.getByRole('button', { name: 'What the kinds and verdicts mean' }).click();
      await expect(review.getByText('Backed by the cited passage.', { exact: true })).toBeVisible();
      await expect(review).toContainText('It does not show that the passage itself is true');
      await fits(page, 'the checks of a model report, legend open');

      // A citation opens the passage it names, and says that a passage is input, not a fact.
      await review
        .getByRole('button', { name: /^Source passage S\d+$/u })
        .first()
        .click();
      const passage = page.getByRole('dialog', { name: /^Source passage S\d+$/u });
      await expect(passage).toContainText('characters');
      await expect(passage).toContainText('not that it is true');
      expect(problems).toEqual([]);
    });

    test('every verdict and kind renders inertly, fits, and stays accessible', async ({
      page,
    }, testInfo) => {
      const problems = watchPage(page);
      await withRichReview(page, reportId);
      const review = await openChecks(page, reportId);

      await expect(review).toContainText(/10\s*statements checked/u);
      await expect(review).toContainText('Deterministic checks only');
      await expect(review).toContainText('the independent model check did not run');
      await expect(review.getByText('Contradicted by the sources (2)')).toBeVisible();
      await expect(
        review.getByRole('heading', { level: 3, name: 'Figures with nothing behind them' }),
      ).toBeVisible();
      await expect(review).toContainText(
        'No source or simulated record is cited for this statement',
      );
      await expect(
        review.getByRole('heading', { level: 3, name: 'A chapter that is not in the report' }),
      ).toBeVisible();
      await review.screenshot({ path: testInfo.outputPath(`checks-rich-${viewport.name}.png`) });

      // Hostile strings are text, never markup, and nothing in the review overflows its column.
      expect(await review.locator('img, script, iframe').count()).toBe(0);
      expect(
        await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
      ).toBeUndefined();
      expect(await review.getByText('onerror=').count()).toBeGreaterThan(0);
      await fits(page, 'rich checks');

      await review.getByRole('button', { name: 'What the kinds and verdicts mean' }).click();
      await fits(page, 'rich checks, legend open');

      // A filter shows only what it names, and says how many of how many.
      await review.getByRole('button', { name: /Contradicted$/u }).click();
      await expect(review.getByRole('status')).toContainText('Showing 2 of 10');
      await fits(page, 'rich checks, filtered');
      await review.getByRole('button', { name: 'Show all' }).click();
      await quiet(page);

      // An unknown passage id is a visible chip that opens an honest answer, not a crash.
      await review.getByRole('button', { name: 'Source passage S999' }).first().click();
      const unknown = page.getByRole('dialog', { name: 'Source passage S999' });
      await expect(unknown).toContainText('is not in this project');
      await quiet(page);
      await expectNoAxeViolations(page, 'the answer for an unknown passage');
      expect(problems).toEqual([]);
    });
  });
}
