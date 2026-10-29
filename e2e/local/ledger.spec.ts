import { expect, test, type Page } from '@playwright/test';
import {
  advance,
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  viewports,
} from '../support/helpers';

const COUNCIL =
  'Fictional briefing note for testing. Council counts show 412,000 one-way crossings in 2025. The council has not agreed any change to the winter timetable.';
const OPERATOR =
  'Fictional memo for testing. Our ticketing system recorded 365,000 one-way crossings in 2025. The operator is reviewing the winter timetable with the council.';

let id = '';

test.beforeAll(async ({ playwright }) => {
  const api = await apiContext(playwright);
  const response = await api.post('/api/projects', {
    data: {
      name: 'E2E conflicting sources',
      question: 'How might fictional ferry stakeholders respond to the proposed timetable?',
      workflow: 'guided',
      documents: [
        { name: 'council-note.md', content: COUNCIL },
        { name: 'operator-memo.md', content: OPERATOR },
      ],
      settings: { mode: 'local', agentCount: 6, rounds: 3, seed: 42, network: 'community' },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  id = ((await response.json()) as { id: string }).id;
  for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
    await advance(api, id, step);
  }
  await api.dispose();
});

test.afterAll(async ({ playwright }) => {
  const api = await apiContext(playwright);
  await api.delete(`/api/projects/${id}`);
  await api.dispose();
});

/** Below 900px the console shows one pane at a time; the reader (and the ledger) is the Report pane. */
async function showReader(page: Page, narrow: boolean): Promise<void> {
  if (narrow) {
    await page
      .getByRole('group', { name: 'Console pane' })
      .getByRole('button', { name: 'Report' })
      .click();
  }
}

async function openLedger(page: Page, narrow: boolean) {
  await page.goto(`/?project=${id}`);
  await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible();
  await showReader(page, narrow);
  const ledger = page.getByRole('region', { name: 'Evidence ledger' });
  await ledger.scrollIntoViewIfNeeded();
  return ledger;
}

// Layout is checked while the conflict is still open, before the interaction test changes it.
for (const viewport of viewports) {
  test.describe(`evidence ledger at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('shows a conflict between sources that fits, reads and passes axe', async ({
      page,
    }, testInfo) => {
      const ledger = await openLedger(page, viewport.width <= 900);
      await expect(
        ledger.getByRole('heading', { level: 2, name: 'Evidence ledger' }),
      ).toBeVisible();
      await expect(
        ledger.getByRole('heading', { level: 3, name: 'Conflicts between sources (1 open of 1)' }),
      ).toBeVisible();
      await expect(ledger).toContainText('council-note.md');
      await expect(ledger).toContainText('operator-memo.md');
      await expect(ledger).toContainText('412,000');
      await expect(ledger).toContainText('365,000');
      await expect(ledger).toContainText('Neither passage is declared true');
      await ledger.screenshot({ path: testInfo.outputPath(`ledger-${viewport.name}.png`) });
      await page.screenshot({ path: testInfo.outputPath(`ledger-${viewport.name}-viewport.png`) });
      await expectNoHorizontalOverflow(page);
      await expectReadableText(page, 'evidence ledger');
      await expectTargetSizes(page, 'evidence ledger');
      await expectNoAxeViolations(page, 'evidence ledger');
    });
  });
}

test('a conflict can be confirmed, then dismissed, and the decision survives a reload', async ({
  page,
  request,
}) => {
  const ledger = await openLedger(page, false);
  await ledger
    .getByLabel('Note (optional)')
    .fill('The council counts crossings; the operator counts tickets.');
  await ledger.getByRole('button', { name: 'Confirm conflict' }).click();
  await expect(ledger.getByText('Confirmed conflict', { exact: true })).toBeVisible();
  await expect(
    ledger.getByRole('heading', { level: 3, name: 'Conflicts between sources (1 open of 1)' }),
  ).toBeVisible();

  await ledger.getByRole('button', { name: 'Not a conflict' }).click();
  await expect(
    ledger.getByRole('heading', { level: 3, name: 'Conflicts between sources (0 open of 1)' }),
  ).toBeVisible();
  await expect(ledger.getByText('Dismissed', { exact: true })).toBeVisible();
  await expect(ledger.getByRole('button', { name: 'Confirm conflict' })).toHaveCount(0);

  await page.reload();
  const reloaded = page.getByRole('region', { name: 'Evidence ledger' });
  await reloaded.scrollIntoViewIfNeeded();
  await expect(
    reloaded.getByRole('heading', { level: 3, name: 'Conflicts between sources (0 open of 1)' }),
  ).toBeVisible();
  await expect(reloaded.getByText('Dismissed', { exact: true })).toBeVisible();
  await expectNoAxeViolations(page, 'evidence ledger after review');

  // Both decisions are in the tamper-evident audit trail, and the chain verifies.
  const audit = await request.get(`/api/projects/${id}/audit`);
  const actions = ((await audit.json()) as { events: { action: string }[] }).events.map(
    (event) => event.action,
  );
  expect(actions.filter((action) => action === 'conflict.reviewed')).toHaveLength(2);
  expect(((await (await request.get('/api/audit/verify')).json()) as { ok: boolean }).ok).toBe(
    true,
  );
});

test('the export carries the ledger, including the reviewed conflict', async ({ request }) => {
  const json = await request.get(`/api/projects/${id}/export?format=json`);
  const body = (await json.json()) as {
    ledger: { contradictions: { status: string }[] } | null;
  };
  expect(body.ledger?.contradictions.map((conflict) => conflict.status)).toEqual(['dismissed']);
  const markdown = await (await request.get(`/api/projects/${id}/export?format=markdown`)).text();
  expect(markdown).toContain('## Evidence ledger');
  expect(markdown).toContain('Dismissed');
});
