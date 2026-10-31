import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import {
  createGuided,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  watchPage,
} from '../support/helpers';
import { microsoftSignsIn, type Person } from '../support/microsoft';

// Who may use the workspace and a project, managed from the page by the people who may. The rules are
// tested without a browser (backend/test/membership.test.ts); this is the page, in a real browser, on
// the real application with Microsoft replaced by a test identity provider
// (backend/test/support/signin-e2e-server.ts): that it offers the controls only to those the server
// would let, says what happened, and that what it does is what the server then holds to.

// The people of the sign-in test server, by the object ID that Microsoft gives them.
const OWNER = 'eeeeeee1-0000-4000-8000-000000000001';
const COLLEAGUE = 'eeeeeee4-0000-4000-8000-000000000004';
const THEMES = ['light', 'dark', 'high-contrast'] as const;

/** How the page names a person: the first eight characters of the object ID. */
const short = (id: string) => `${id.slice(0, 8)}…`;

const closers: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** Two frames have been drawn, so what the page was last told is on the screen. */
const rendered = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

interface SignedIn {
  context: BrowserContext;
  page: Page;
  /** What the page did that it must not do; a refusal the test provokes is not one of them. */
  problems: string[];
}

/** A browser of its own, signed in as this person, with the page's idea of their role already drawn. */
async function signedInAs(
  browser: Browser,
  person: Person,
  options: { path?: string; theme?: string } = {},
): Promise<SignedIn> {
  const context = await browser.newContext();
  closers.push(() => context.close());
  const theme = options.theme;
  if (theme) {
    await context.addInitScript(
      (value) => window.localStorage.setItem('swarm.theme', value),
      theme,
    );
  }
  const page = await context.newPage();
  const problems = watchPage(page, { refusals: true });
  // The page offers what it offers on the strength of this answer.
  const role = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/workspace',
  );
  await microsoftSignsIn(person);
  await page.goto(options.path ?? '/');
  await expect(page.getByText('SIGNED IN · MICROSOFT ENTRA')).toBeVisible();
  await role;
  await rendered(page);
  return { context, page, problems };
}

/** Changes made as the person who is signed in in that browser, with the header the page itself sends. */
async function changesAs(
  playwright: PlaywrightWorkerArgs['playwright'],
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<APIRequestContext> {
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await context.storageState(),
    extraHTTPHeaders: { 'X-Swarm-CSRF': '1' },
  });
  closers.push(() => api.dispose());
  return api;
}

const rowOf = (dialog: ReturnType<Page['locator']>, id: string) =>
  dialog.locator('tbody tr', { hasText: short(id) });

const roleOf = (dialog: ReturnType<Page['locator']>, id: string) =>
  dialog.getByLabel(`Role of ${short(id)}`, { exact: true });

const said = (dialog: ReturnType<Page['locator']>, text: string) =>
  dialog.getByRole('status').filter({ hasText: text });

const refusedWith = (dialog: ReturnType<Page['locator']>, text: string) =>
  dialog.getByRole('alert').filter({ hasText: 'That was not changed' }).filter({ hasText: text });

async function removing(dialog: ReturnType<Page['locator']>, id: string, confirm: boolean) {
  await dialog.getByRole('button', { name: `Remove ${short(id)}`, exact: true }).click();
  const group = dialog.getByRole('group', { name: `Remove ${short(id)}?` });
  await expect(group).toBeVisible();
  if (confirm) {
    await group.getByRole('button', { name: `Remove ${short(id)}`, exact: true }).click();
  } else {
    await group.getByRole('button', { name: 'Keep' }).click();
  }
  await expect(group).toHaveCount(0);
}

test('an owner adds a person to the workspace by object ID, changes their role, and removes them', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const { context, page, problems } = await signedInAs(browser, 'owner');
  const api = await changesAs(playwright, context, baseURL);
  await api.delete(`/api/workspace/members/${COLLEAGUE}`);

  const refusals: string[] = [];
  let changes = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT') changes += 1;
  });
  page.on('response', (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith('/api/') && response.status() >= 400) {
      refusals.push(`${response.status()} ${response.request().method()} ${pathname}`);
    }
  });

  await page.getByRole('button', { name: 'People', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'People in this workspace' });
  await expect(dialog).toBeVisible();

  await test.step('lists the owner, who cannot be removed while nobody else owns the workspace', async () => {
    await expect(roleOf(dialog, OWNER)).toHaveValue('owner');
    await removing(dialog, OWNER, true);
    await expect(refusedWith(dialog, 'A workspace must keep at least one owner')).toBeVisible();
    await expect(rowOf(dialog, OWNER)).toBeVisible();
  });

  await test.step('does not ask the server about text that is not an object ID, and says what one looks like', async () => {
    await dialog.getByLabel('Object ID').fill('Alice');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    const notice = dialog.getByRole('alert').filter({ hasText: 'That is not an object ID' });
    await expect(notice).toContainText('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
    await expect(dialog.getByLabel('Object ID')).toHaveAttribute('aria-invalid', 'true');
    expect(changes).toBe(0);
    // Typing again takes the complaint away.
    await dialog.getByLabel('Object ID').fill('');
    await expect(notice).toHaveCount(0);
  });

  await test.step('adds a person by object ID, as a member, in lower case whatever was typed', async () => {
    await dialog.getByLabel('Object ID').fill(COLLEAGUE.toUpperCase());
    await expect(dialog.getByLabel('Role', { exact: true })).toHaveValue('member');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(said(dialog, 'Person added as Member.')).toBeVisible();
    await expect(rowOf(dialog, COLLEAGUE)).toBeVisible();
    await expect(roleOf(dialog, COLLEAGUE)).toHaveValue('member');
    await expect(dialog.getByLabel('Object ID')).toHaveValue('');
    const listed = (await (await api.get('/api/workspace/members')).json()) as {
      members: { principalId: string; role: string }[];
    };
    expect(listed.members.find((member) => member.principalId === COLLEAGUE)?.role).toBe('member');
  });

  await test.step('offers the person for removal only after asking, and keeps them if told to', async () => {
    await removing(dialog, COLLEAGUE, false);
    await expect(rowOf(dialog, COLLEAGUE)).toBeVisible();
  });

  await test.step('changes their role, and the server holds to it', async () => {
    await roleOf(dialog, COLLEAGUE).selectOption('admin');
    await expect(said(dialog, 'Role changed to Workspace admin.')).toBeVisible();
    await expect(roleOf(dialog, COLLEAGUE)).toHaveValue('admin');
    const listed = (await (await api.get('/api/workspace/members')).json()) as {
      members: { principalId: string; role: string }[];
    };
    expect(listed.members.find((member) => member.principalId === COLLEAGUE)?.role).toBe('admin');
  });

  await test.step('removes them, and says that they no longer have access', async () => {
    await removing(dialog, COLLEAGUE, true);
    await expect(said(dialog, 'Person removed. They no longer have access.')).toBeVisible();
    await expect(rowOf(dialog, COLLEAGUE)).toHaveCount(0);
    const listed = (await (await api.get('/api/workspace/members')).json()) as {
      members: { principalId: string }[];
    };
    expect(listed.members.map((member) => member.principalId)).not.toContain(COLLEAGUE);
  });

  await test.step('closes from the keyboard, and the focus returns to where it was', async () => {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'People', exact: true })).toBeFocused();
  });

  // The one change the server refused is the one the test asked for.
  expect(refusals).toEqual([`409 DELETE /api/workspace/members/${OWNER}`]);
  expect(problems).toEqual([]);
});

test('a person added to one project sees that project and no other, can read who has access, and cannot change it', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const owner = await signedInAs(browser, 'owner');
  const ownerApi = await changesAs(playwright, owner.context, baseURL);
  await ownerApi.delete(`/api/workspace/members/${COLLEAGUE}`);
  const shared = await createGuided(ownerApi, { name: 'Access: the shared project' });
  const unshared = await createGuided(ownerApi, { name: 'Access: the private project' });

  await test.step('the owner, who made the project, is its lead, and adds the colleague as a viewer', async () => {
    await owner.page.goto(`/?project=${shared}`);
    await owner.page.getByRole('button', { name: 'Access', exact: true }).click();
    const dialog = owner.page.getByRole('dialog', { name: 'Who has access to this project' });
    await expect(roleOf(dialog, OWNER)).toHaveValue('lead');
    await dialog.getByLabel('Object ID').fill(COLLEAGUE);
    // The least that is useful is what is offered first.
    await expect(dialog.getByLabel('Role', { exact: true })).toHaveValue('viewer');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(said(dialog, 'Person added as Viewer.')).toBeVisible();
    await expect(roleOf(dialog, COLLEAGUE)).toHaveValue('viewer');
    await owner.page.keyboard.press('Escape');
  });

  const colleague = await signedInAs(browser, 'colleague', { path: `/?project=${shared}` });
  const colleagueApi = await changesAs(playwright, colleague.context, baseURL);

  await test.step('the colleague is a member of the workspace, but not someone who manages it', async () => {
    const workspace = await (await colleagueApi.get('/api/workspace')).json();
    expect(workspace).toMatchObject({ role: 'member', platformAdmin: false });
    await expect(colleague.page.getByRole('button', { name: 'People', exact: true })).toHaveCount(
      0,
    );
    await expect(colleague.page.getByRole('button', { name: 'Access', exact: true })).toBeVisible();
  });

  await test.step('the colleague reads who has access and is offered no way to change it', async () => {
    await colleague.page.getByRole('button', { name: 'Access', exact: true }).click();
    const dialog = colleague.page.getByRole('dialog', { name: 'Who has access to this project' });
    await expect(rowOf(dialog, OWNER)).toContainText('Project lead');
    await expect(rowOf(dialog, COLLEAGUE)).toContainText('Viewer');
    await expect(
      dialog.getByText(
        'Only a project lead, or a workspace owner or administrator, changes who has access.',
      ),
    ).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await expect(dialog.getByLabel('Object ID')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Remove/u })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add person' })).toHaveCount(0);
    await colleague.page.keyboard.press('Escape');
  });

  await test.step('the colleague’s history holds the shared project and not the private one', async () => {
    await colleague.page.getByRole('button', { name: /^History/u }).click();
    const history = colleague.page.getByRole('dialog', { name: 'Project history · 1' });
    await expect(history.getByText('Access: the shared project')).toBeVisible();
    await expect(history.getByText('Access: the private project')).toHaveCount(0);
    await colleague.page.keyboard.press('Escape');
    const listed = (await (await colleagueApi.get('/api/projects')).json()) as {
      projects: { id: string }[];
    };
    expect(listed.projects.map((project) => project.id)).toEqual([shared]);
  });

  await test.step('the server holds to what the page showed: the private project does not exist for them, and a viewer cannot promote themselves', async () => {
    const hidden = await colleagueApi.get(`/api/projects/${unshared}`);
    expect(hidden.status()).toBe(404);
    expect(((await hidden.json()) as { error: { code: string } }).error.code).toBe(
      'PROJECT_NOT_FOUND',
    );
    const promote = await colleagueApi.put(`/api/projects/${shared}/members/${COLLEAGUE}`, {
      data: { role: 'lead' },
    });
    expect(promote.status()).toBe(403);
    expect(((await promote.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    const members = (await (await ownerApi.get(`/api/projects/${shared}/members`)).json()) as {
      members: { principalId: string; role: string }[];
    };
    expect(members.members.find((member) => member.principalId === COLLEAGUE)?.role).toBe('viewer');
  });

  await test.step('the owner takes the colleague off the project, and the project is gone for them at once', async () => {
    await owner.page.getByRole('button', { name: 'Access', exact: true }).click();
    const dialog = owner.page.getByRole('dialog', { name: 'Who has access to this project' });
    await removing(dialog, COLLEAGUE, true);
    await expect(said(dialog, 'Person removed. They no longer have access.')).toBeVisible();
    const gone = await colleagueApi.get(`/api/projects/${shared}`);
    expect(gone.status()).toBe(404);
    const listed = (await (await colleagueApi.get('/api/projects')).json()) as {
      projects: unknown[];
    };
    expect(listed.projects).toEqual([]);
  });

  await ownerApi.delete(`/api/workspace/members/${COLLEAGUE}`);
  expect(owner.problems).toEqual([]);
  expect(colleague.problems).toEqual([]);
});

test('a workspace administrator manages the members, and is offered no way to touch an owner', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const owner = await signedInAs(browser, 'owner');
  const ownerApi = await changesAs(playwright, owner.context, baseURL);
  const made = await ownerApi.put(`/api/workspace/members/${COLLEAGUE}`, {
    data: { role: 'admin' },
  });
  expect(made.status(), await made.text()).toBe(200);

  const admin = await signedInAs(browser, 'colleague');
  const adminApi = await changesAs(playwright, admin.context, baseURL);
  await admin.page.getByRole('button', { name: 'People', exact: true }).click();
  const dialog = admin.page.getByRole('dialog', { name: 'People in this workspace' });
  await expect(dialog).toBeVisible();

  await test.step('the owner is listed, with no control to change or remove them', async () => {
    await expect(rowOf(dialog, OWNER)).toContainText('Workspace owner');
    await expect(rowOf(dialog, OWNER).getByRole('combobox')).toHaveCount(0);
    await expect(rowOf(dialog, OWNER).getByRole('button')).toHaveCount(0);
    await expect(roleOf(dialog, COLLEAGUE)).toHaveValue('admin');
  });

  await test.step('the owner role is not among the roles that can be given', async () => {
    const roles = dialog.getByLabel('Role', { exact: true }).locator('option');
    await expect(roles).toHaveText(['Workspace admin', 'Member']);
  });

  await test.step('the server refuses the same change if it is asked for another way', async () => {
    const change = await adminApi.put(`/api/workspace/members/${OWNER}`, {
      data: { role: 'member' },
    });
    expect(change.status()).toBe(403);
    expect(((await change.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    const remove = await adminApi.delete(`/api/workspace/members/${OWNER}`);
    expect(remove.status()).toBe(403);
    const listed = (await (await ownerApi.get('/api/workspace/members')).json()) as {
      members: { principalId: string; role: string }[];
    };
    expect(listed.members.find((member) => member.principalId === OWNER)?.role).toBe('owner');
  });

  await ownerApi.delete(`/api/workspace/members/${COLLEAGUE}`);
  expect(owner.problems).toEqual([]);
  expect(admin.problems).toEqual([]);
});

for (const theme of THEMES) {
  test(`the access dialogs are readable in the ${theme} theme, and on a phone`, async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const { context, page, problems } = await signedInAs(browser, 'owner', { theme });
    const api = await changesAs(playwright, context, baseURL);
    await api.put(`/api/workspace/members/${COLLEAGUE}`, { data: { role: 'member' } });
    const id = await createGuided(api, { name: `Access: ${theme} theme` });
    const added = await api.put(`/api/projects/${id}/members/${COLLEAGUE}`, {
      data: { role: 'analyst' },
    });
    expect(added.status(), await added.text()).toBe(200);

    for (const viewport of [
      { width: 1360, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/?project=${id}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const [button, title] of [
        ['People', 'People in this workspace'],
        ['Access', 'Who has access to this project'],
      ] as const) {
        await page.getByRole('button', { name: button, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: title });
        await expect(dialog).toBeVisible();
        await expect(rowOf(dialog, COLLEAGUE)).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Add person' })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page, `${theme} ${viewport.width}px: ${title}`);
        if (theme !== 'light') {
          await expectNoBrowserPaintedControls(page, `${theme}: ${title}`);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
    }

    await api.delete(`/api/workspace/members/${COLLEAGUE}`);
    expect(problems).toEqual([]);
  });
}
