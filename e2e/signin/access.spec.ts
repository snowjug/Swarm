import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  createGuided,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
} from '../support/helpers';
import {
  expectPressable,
  quiet,
  historyDialog,
  openHistory,
  openSettings,
  settingsButton,
} from '../support/shell';
import { COLLEAGUE, OWNER, changesAs, shortId, signedInAs } from '../support/signin';

// Who may use the workspace and a project, managed from the page by the people who may. The rules are tested without a
// browser (backend/test/membership.test.ts); this is the page, in a real browser, on the real application with
// Microsoft replaced by a test identity provider (backend/test/support/signin-e2e-server.ts): that it offers the
// controls only to those the server would let, says what happened, and that what it does is what the server then holds to.

const THEMES = ['light', 'dark', 'high-contrast'] as const;

const closers: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** The dialog of the people of the workspace or of the project, opened as a person opens it: from the settings menu. */
async function openPeople(
  page: Page,
  item: 'People' | 'Who has access',
  title: string,
): Promise<Locator> {
  const menu = await openSettings(page);
  await menu.getByRole('menuitem', { name: item, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}
const openWorkspace = (page: Page) => openPeople(page, 'People', 'People in this workspace');
const openProject = (page: Page) => openPeople(page, 'Who has access', 'Who has access');

const rowOf = (dialog: Locator, id: string) =>
  dialog.getByRole('listitem').filter({ hasText: shortId(id) });

/** The button that says what role a person has and opens the roles to choose from. */
const roleOf = (dialog: Locator, id: string) =>
  dialog.getByRole('button', { name: new RegExp(`^Role of ${shortId(id)}: `, 'u') });

/** What a role menu offers, by role label: the menu is drawn into the end of the page, not into the dialog. */
const choice = (page: Page, label: string) =>
  page.getByRole('menuitemradio', { name: new RegExp(`^${label}`, 'u') });

const said = (dialog: Locator, text: string) =>
  dialog.getByRole('status').filter({ hasText: text });

const refusedWith = (dialog: Locator, text: string) =>
  dialog.getByRole('alert').filter({ hasText: 'That was not changed' }).filter({ hasText: text });

async function removing(dialog: Locator, id: string, confirm: boolean) {
  await dialog.getByRole('button', { name: `Remove ${shortId(id)}`, exact: true }).click();
  const group = dialog.getByRole('group', { name: `Remove ${shortId(id)}?` });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: confirm ? 'Remove' : 'Keep', exact: true }).click();
  await expect(group).toHaveCount(0);
}

test('an owner adds a person to the workspace by object ID, changes their role, and removes them', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const { context, page, problems } = await signedInAs(browser, 'owner', closers);
  const api = await changesAs(playwright, context, baseURL, closers);
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

  const dialog = await openWorkspace(page);

  await test.step('lists the owner, who cannot be removed while nobody else owns the workspace', async () => {
    await expect(roleOf(dialog, OWNER)).toHaveAccessibleName(
      `Role of ${shortId(OWNER)}: Workspace owner`,
    );
    await removing(dialog, OWNER, true);
    await expect(refusedWith(dialog, 'A workspace must keep at least one owner')).toBeVisible();
    await expect(rowOf(dialog, OWNER)).toBeVisible();
  });

  await test.step('does not ask the server about text that is not an object ID, and says what one looks like', async () => {
    const field = dialog.getByRole('textbox', { name: 'Object ID' });
    await field.fill('Alice');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    const notice = dialog.getByRole('alert').filter({ hasText: 'An object ID looks like' });
    await expect(notice).toContainText('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(changes).toBe(0);
    // Typing again takes the complaint away.
    await field.fill('');
    await expect(notice).toHaveCount(0);
  });

  await test.step('adds a person by object ID, as a member, in lower case whatever was typed', async () => {
    await dialog.getByRole('textbox', { name: 'Object ID' }).fill(COLLEAGUE.toUpperCase());
    await expect(dialog.getByRole('button', { name: /^Role to give: Member/u })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(said(dialog, 'Person added as Member.')).toBeVisible();
    await expect(rowOf(dialog, COLLEAGUE)).toBeVisible();
    await expect(roleOf(dialog, COLLEAGUE)).toHaveAccessibleName(
      `Role of ${shortId(COLLEAGUE)}: Member`,
    );
    await expect(dialog.getByRole('textbox', { name: 'Object ID' })).toHaveValue('');
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
    await roleOf(dialog, COLLEAGUE).click();
    await choice(page, 'Workspace admin').click();
    await expect(said(dialog, 'Role changed to Workspace admin.')).toBeVisible();
    await expect(roleOf(dialog, COLLEAGUE)).toHaveAccessibleName(
      `Role of ${shortId(COLLEAGUE)}: Workspace admin`,
    );
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
    await expect(settingsButton(page)).toBeFocused();
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
  const owner = await signedInAs(browser, 'owner', closers);
  const ownerApi = await changesAs(playwright, owner.context, baseURL, closers);
  await ownerApi.delete(`/api/workspace/members/${COLLEAGUE}`);
  const shared = await createGuided(ownerApi, { name: 'Access: the shared project' });
  const unshared = await createGuided(ownerApi, { name: 'Access: the private project' });

  await test.step('the owner, who made the project, is its lead, and adds the colleague as a viewer', async () => {
    await owner.page.goto(`/?project=${shared}`);
    const dialog = await openProject(owner.page);
    await expect(roleOf(dialog, OWNER)).toHaveAccessibleName(
      `Role of ${shortId(OWNER)}: Project lead`,
    );
    await dialog.getByRole('textbox', { name: 'Object ID' }).fill(COLLEAGUE);
    // The least that is useful is what is offered first.
    await expect(dialog.getByRole('button', { name: /^Role to give: Viewer/u })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(said(dialog, 'Person added as Viewer.')).toBeVisible();
    await expect(roleOf(dialog, COLLEAGUE)).toHaveAccessibleName(
      `Role of ${shortId(COLLEAGUE)}: Viewer`,
    );
    await owner.page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  const colleague = await signedInAs(browser, 'colleague', closers, {
    path: `/?project=${shared}`,
  });
  const colleagueApi = await changesAs(playwright, colleague.context, baseURL, closers);

  await test.step('the colleague is a member of the workspace, but not someone who manages it', async () => {
    const workspace = await (await colleagueApi.get('/api/workspace')).json();
    expect(workspace).toMatchObject({ role: 'member', platformAdmin: false });
    const menu = await openSettings(colleague.page);
    await expect(menu.getByRole('menuitem', { name: 'People', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Who has access', exact: true })).toBeVisible();
    await colleague.page.keyboard.press('Escape');
  });

  await test.step('the colleague reads who has access and is offered no way to change it', async () => {
    const dialog = await openProject(colleague.page);
    await expect(rowOf(dialog, OWNER)).toContainText('Project lead');
    await expect(rowOf(dialog, COLLEAGUE)).toContainText('Viewer');
    await expect(
      dialog.getByText(
        'Only a project lead, or a workspace owner or administrator, changes who has access.',
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /^(?:Role of|Remove|Role to give)/u }),
    ).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Object ID' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
    await colleague.page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  await test.step('the colleague’s history holds the shared project and not the private one', async () => {
    const history = await openHistory(colleague.page);
    await expect(
      history.getByRole('button', { name: /^Access: the shared project/u }),
    ).toBeVisible();
    await expect(history.getByText('Access: the private project')).toHaveCount(0);
    await colleague.page.keyboard.press('Escape');
    await expect(historyDialog(colleague.page)).toBeHidden();
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
    const dialog = await openProject(owner.page);
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
  const owner = await signedInAs(browser, 'owner', closers);
  const ownerApi = await changesAs(playwright, owner.context, baseURL, closers);
  const made = await ownerApi.put(`/api/workspace/members/${COLLEAGUE}`, {
    data: { role: 'admin' },
  });
  expect(made.status(), await made.text()).toBe(200);

  const admin = await signedInAs(browser, 'colleague', closers);
  const adminApi = await changesAs(playwright, admin.context, baseURL, closers);
  const dialog = await openWorkspace(admin.page);

  await test.step('the owner is listed, with no control to change or remove them, and the reason is there to read', async () => {
    await expect(rowOf(dialog, OWNER)).toContainText('Workspace owner');
    await expect(
      rowOf(dialog, OWNER).getByRole('button', { name: /^(?:Role of|Remove) /u }),
    ).toHaveCount(0);
    await expect(
      rowOf(dialog, OWNER).getByRole('img', { name: 'Only an owner changes an owner.' }),
    ).toBeVisible();
    await expect(roleOf(dialog, COLLEAGUE)).toHaveAccessibleName(
      `Role of ${shortId(COLLEAGUE)}: Workspace admin`,
    );
  });

  await test.step('the owner role is shown among the roles but cannot be given', async () => {
    await dialog.getByRole('button', { name: /^Role to give: / }).click();
    await expect(choice(admin.page, 'Workspace owner')).toHaveAttribute('aria-disabled', 'true');
    await expect(choice(admin.page, 'Workspace admin')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(choice(admin.page, 'Member')).not.toHaveAttribute('aria-disabled', 'true');
    await admin.page.keyboard.press('Escape');
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
    const { context, page, problems } = await signedInAs(browser, 'owner', closers, { theme });
    const api = await changesAs(playwright, context, baseURL, closers);
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
      for (const [item, title] of [
        ['People', 'People in this workspace'],
        ['Who has access', 'Who has access'],
      ] as const) {
        const dialog = await openPeople(page, item, title);
        await expect(rowOf(dialog, COLLEAGUE)).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await quiet(page);
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

test('on a phone the people dialogs can be used with a thumb: every control is 44px, and focus comes back', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const { context, page, problems } = await signedInAs(browser, 'owner', closers, { phone: true });
  const api = await changesAs(playwright, context, baseURL, closers);
  await api.put(`/api/workspace/members/${COLLEAGUE}`, { data: { role: 'member' } });
  const id = await createGuided(api, { name: 'Access: a phone' });
  const added = await api.put(`/api/projects/${id}/members/${COLLEAGUE}`, {
    data: { role: 'analyst' },
  });
  expect(added.status(), await added.text()).toBe(200);
  await page.goto(`/?project=${id}`);
  for (const [item, title] of [
    ['People', 'People in this workspace'],
    ['Who has access', 'Who has access'],
  ] as const) {
    const dialog = await openPeople(page, item, title);
    await expect(rowOf(dialog, COLLEAGUE)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await quiet(page);
    await expectPressable(page, `phone: ${title}`, { min: 44, scope: '[role="dialog"]' });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(settingsButton(page)).toBeFocused();
  }
  await api.delete(`/api/workspace/members/${COLLEAGUE}`);
  expect(problems).toEqual([]);
});
