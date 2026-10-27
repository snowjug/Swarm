import { expect, test } from '@playwright/test';
import { makePdf } from '../../backend/test/pdf-fixture';
import { advance, apiContext, createGuided, listProjects, seed } from '../support/helpers';

const SEARCH_TEXT =
  'A fictional notes file about library opening hours, with enough characters to be accepted as source material for the scenario.';

test.describe('error conditions are specific, actionable, and never create misleading state', () => {
  test('unsupported, corrupt and oversized uploads explain themselves and create nothing', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const before = (await listProjects(api)).length;
    await page.goto('/');
    const input = page.locator('input[type=file]');

    await input.setInputFiles({
      name: 'malware.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ binary'),
    });
    await expect(
      page.getByText(/malware\.exe: Use UTF-8 TXT, Markdown, or a text-based PDF/),
    ).toBeVisible();

    await input.setInputFiles({
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nthis is not a real pdf'),
    });
    await expect(
      page.getByText(/broken\.pdf: The PDF is malformed, encrypted, or not supported/),
    ).toBeVisible();
    await expect(page.getByText(/Request ID:/).first()).toBeVisible();

    await input.setInputFiles({
      name: 'big.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(2_100_000, 'a'),
    });
    await expect(page.getByText(/big\.pdf: PDF files must be at most 2 MB/)).toBeVisible();
    expect((await listProjects(api)).length).toBe(before);
  });

  test('an empty submit shows validation, not a stale upload error; a valid PDF is then accepted', async ({
    page,
  }) => {
    await page.goto('/');
    const input = page.locator('input[type=file]');
    await input.setInputFiles({
      name: 'old-failure.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await expect(page.getByText(/old-failure\.exe/)).toBeVisible();
    await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
    await expect(page.getByText('Cannot build this project')).toBeVisible();
    await expect(page.getByText(/old-failure\.exe/)).toHaveCount(0);

    await input.setInputFiles({
      name: 'library-notes.pdf',
      mimeType: 'application/pdf',
      buffer: makePdf(SEARCH_TEXT),
    });
    await expect(page.getByText(/library-notes\.pdf/).first()).toBeVisible();
    await expect(page.getByText(/not supported|malformed/)).toHaveCount(0);
  });

  test('an unreachable API is reported with a retry that recovers without a reload', async ({
    page,
  }) => {
    await page.route('**/api/config', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByText('Server configuration unavailable')).toBeVisible();
    await page.unroute('**/api/config');
    await page.getByRole('button', { name: 'Retry config' }).click();
    await expect(page.getByRole('button', { name: 'Build Graph', exact: true })).toBeVisible();
    await expect(page.getByText('Server configuration unavailable')).toHaveCount(0);
  });

  test('a rate-limited creation keeps the operator’s input and says it was not confirmed', async ({
    page,
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const before = (await listProjects(api)).length;
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Wait a minute before retrying.',
          },
        }),
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Load fictional starter input' }).click();
    await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
    await expect(page.getByText('Operation not confirmed')).toBeVisible();
    await expect(page.getByText(/Too many requests/).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: /question/i }).first()).not.toHaveValue('');
    expect((await listProjects(api)).length).toBe(before);
  });

  test('unknown and malformed project links fail clearly with a retry, not a blank page', async ({
    page,
  }) => {
    await page.goto('/?project=00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Project refresh failed')).toBeVisible();
    await expect(page.getByText(/does not exist/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry refresh/ })).toBeVisible();

    await page.goto('/?project=not-a-uuid');
    await expect(page.getByText('Project refresh failed')).toBeVisible();
    await expect(page.getByText(/Invalid UUID/)).toBeVisible();
  });

  test('a double-clicked Build Graph creates exactly one project', async ({ page, playwright }) => {
    const api = await apiContext(playwright);
    const before = (await listProjects(api)).length;
    await page.goto('/');
    await page.getByRole('button', { name: 'Load fictional starter input' }).click();
    await page.getByRole('button', { name: 'Build Graph', exact: true }).dblclick();
    await expect(page.getByRole('button', { name: /Prepare environment/ })).toBeVisible();
    expect((await listProjects(api)).length).toBe(before + 1);
  });
});

test.describe('API error contracts', () => {
  test('state-machine violations are rejected with actionable codes', async ({ playwright }) => {
    const api = await apiContext(playwright);
    const unknown = '00000000-0000-4000-8000-000000000000';
    const code = async (response: Awaited<ReturnType<typeof api.post>>) =>
      ((await response.json()) as { error: { code: string } }).error.code;

    expect(await code(await api.post(`/api/projects/${unknown}/pause`))).toBe('RUN_NOT_PAUSABLE');

    const draft = await createGuided(api);
    expect(await code(await api.post(`/api/projects/${draft}/steps/simulation`))).toBe(
      'STEP_PREREQUISITE',
    );
    await advance(api, draft, 'knowledge');
    await advance(api, draft, 'environment');
    expect(
      await code(
        await api.post(`/api/projects/${draft}/steps/simulation`, { data: { resume: true } }),
      ),
    ).toBe('NO_CHECKPOINT');
    expect(
      await code(
        await api.put(`/api/projects/${draft}/intervention`, {
          data: {
            round: 3,
            label: 'Assumed event before any round exists',
            stance: 0,
            strength: 0.5,
          },
        }),
      ),
    ).toBe('INTERVENTION_LOCKED');
    expect(
      await code(await api.post(`/api/projects/${draft}/branches`, { data: { fromRound: 1 } })),
    ).toBe('BRANCH_NOT_READY');
    expect((await api.get(`/api/projects/${draft}/compare?with=${draft}`)).status()).toBe(400);
  });

  test('hostile requests are refused: foreign origin, oversized body, wrong content type', async ({
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const foreign = await api.post('/api/projects', {
      headers: { origin: 'https://evil.example' },
      data: { name: 'x' },
    });
    expect(foreign.status()).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      'ORIGIN_NOT_ALLOWED',
    );

    const oversized = await api.post('/api/projects', { data: { padding: 'x'.repeat(700_000) } });
    expect(oversized.status()).toBe(413);

    const wrongType = await api.post('/api/projects', {
      headers: { 'content-type': 'text/plain' },
      data: 'name=x',
    });
    expect(wrongType.status()).toBeGreaterThanOrEqual(400);
    expect(wrongType.status()).toBeLessThan(500);
  });

  test('a seeded project survives and is readable after all the failures above', async ({
    playwright,
  }) => {
    const api = await apiContext(playwright);
    const id = await seed(api, 'simulation');
    const response = await api.get(`/api/projects/${id}`);
    expect(response.ok()).toBe(true);
  });
});
