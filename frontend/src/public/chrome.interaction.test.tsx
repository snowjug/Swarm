// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { SettingsMenu, type ProjectTools } from '../app/SettingsMenu';
import { TopBar } from '../app/TopBar';
import { renderWithApp, screen, waitFor, within } from '../test/dom';
import { browser } from './browser';
import { clearByok, setByokKey } from './byokStore';
import { PublicChrome } from './PublicChrome';
import { setPublicEdition } from './runtime';
import { takeNote } from './tabState';
import { accountView, connectResult, signedInSession, TEST_KEY, usageView } from './test/fixtures';
import { failure, fakeServer, json, noContent, type Handler } from './test/server';

// The signed-in page: the meter in the bar, the account part of the menu, and what happens when a request is refused.
// The bar and the menu are the application's own; the public edition reaches them only through the slots it gives them.

const at = (address: string) => window.history.replaceState({}, '', address);

beforeEach(() => {
  setPublicEdition(true);
  at('/');
});

afterEach(() => {
  setPublicEdition(false);
  clearByok();
  window.sessionStorage.clear();
  at('/');
  vi.unstubAllGlobals();
});

function Shell({ withProject = false }: { withProject?: boolean }) {
  const tools: ProjectTools | null = withProject
    ? {
        onRefresh: vi.fn(),
        onAudit: vi.fn(),
        onDuplicate: vi.fn(),
        onSnapshot: vi.fn(),
        onBudget: null,
        onAccess: vi.fn(),
        busy: false,
      }
    : null;
  return (
    <TopBar
      steps={[]}
      scene="ask"
      hasProject={false}
      onGo={vi.fn()}
      onHome={vi.fn()}
      homeDisabled={false}
      historyTotal={null}
      onHistory={vi.fn()}
      onAsk={vi.fn()}
      onPalette={vi.fn()}
      status={null}
      menu={
        <SettingsMenu
          theme="system"
          onTheme={vi.fn()}
          mode="guided"
          onMode={vi.fn()}
          onPalette={vi.fn()}
          project={tools}
          account={{
            label: 'Signed in · Microsoft Entra',
            onPeople: vi.fn(),
            onSignOut: vi.fn(),
          }}
          version="0.3.0"
          sourceUrl={null}
        />
      }
    />
  );
}

const publicShell = (props: { withProject?: boolean } = {}) => (
  <PublicChrome session={signedInSession()}>
    <Shell {...props} />
  </PublicChrome>
);

const routes = (over: Record<string, Handler> = {}) =>
  fakeServer({
    'GET /api/usage': usageView(),
    'GET /api/account': accountView(),
    ...over,
  });

async function openMenu(user: ReturnType<typeof renderWithApp>['user']) {
  await user.click(screen.getByRole('button', { name: 'Settings and tools' }));
  return screen.findByRole('menu');
}

describe('the bar and the menu in the pilot', () => {
  it('have no meter, and the menu is what it was: the person’s role, People, Sign out and Who has access', async () => {
    const { user } = renderWithApp(<Shell withProject />);
    expect(screen.queryByTestId('usage-meter')).toBeNull();
    const menu = await openMenu(user);
    expect(within(menu).getByText('Signed in · Microsoft Entra')).toBeTruthy();
    for (const name of ['People', 'Sign out', 'Who has access']) {
      expect(within(menu).getByRole('menuitem', { name }), name).toBeTruthy();
    }
    for (const name of ['Account', 'Use your own Google key', 'Try a sample']) {
      expect(within(menu).queryByRole('menuitem', { name }), name).toBeNull();
    }
  });
});

describe('the bar and the menu in the public edition', () => {
  it('put the meter in the bar, read from the server with nothing but what a read carries', async () => {
    const server = routes();
    renderWithApp(publicShell());
    expect((await screen.findByTestId('usage-meter')).textContent).toBe('3 free runs left today');
    expect(server.to('GET /api/usage')).toHaveLength(1);
    expect(server.to('GET /api/usage')[0]!.headers['x-swarm-provider-key']).toBeUndefined();
  });

  it('replace the account part of the menu, and show no People, no Who has access and no Microsoft, whatever the shell passes', async () => {
    routes();
    const { user } = renderWithApp(publicShell({ withProject: true }));
    const menu = await openMenu(user);
    expect(within(menu).getByText('Signed in')).toBeTruthy();
    expect(within(menu).getByTestId('menu-email').textContent).toBe('a***@example.com');
    for (const name of ['Account', 'Use your own Google key', 'Try a sample', 'Sign out']) {
      expect(within(menu).getByRole('menuitem', { name }), name).toBeTruthy();
    }
    for (const name of ['People', 'Who has access']) {
      expect(within(menu).queryByRole('menuitem', { name }), name).toBeNull();
    }
    expect(menu.textContent).not.toMatch(/Entra|Microsoft|Share/u);
    // The rest of the menu is as it was.
    expect(within(menu).getByRole('menuitem', { name: /Audit log/u })).toBeTruthy();
  });

  it('open the account panel and the panel for the key from the menu', async () => {
    routes();
    const { user } = renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Account' }));
    expect(await screen.findByRole('dialog', { name: 'Your account' })).toBeTruthy();
    expect(await screen.findByTestId('account-panel')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // A dialog gives the focus back a moment after it closes, and a menu opened before then is dismissed by that.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Settings and tools' }),
      ),
    );

    await user.click(
      within(await openMenu(user)).getByRole('menuitem', { name: 'Use your own Google key' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Use your own Google key' })).toBeTruthy();
  });

  it('sign out from the menu: the session ends, the key goes first, and the page returns to the landing page', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const server = routes({ 'POST /auth/logout': noContent() });
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    const { user } = renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(server.to('POST /auth/logout')[0]!.headers['x-swarm-provider-key']).toBeUndefined();
    expect(window.sessionStorage.getItem('swarm.byok.key')).toBeNull();
    expect(takeNote()).toBe('signed-out');
  });

  it('say so in a toast when the sign-out is not confirmed, and stay signed in', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    routes({ 'POST /auth/logout': failure(500, 'INTERNAL', 'Could not end it.') });
    const { user } = renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText('Could not sign out')).toBeTruthy();
    expect(screen.getByText(/You are still signed in\./u)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('the meter reads the server again', () => {
  it('with the person’s own key in the header, once one is held', async () => {
    const server = routes();
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    const [read] = server.to('GET /api/usage');
    expect(read!.headers['x-swarm-provider']).toBe('gemini');
    expect(read!.headers['x-swarm-provider-key']).toBe(TEST_KEY);
    expect(read!.headers['x-swarm-provider-model']).toBe('gemini-2.5-flash');
  });

  it('after each change the server accepts, and when the key is added or forgotten', async () => {
    const server = routes({ 'POST /api/projects/p/pause': {} });
    renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    expect(server.to('GET /api/usage')).toHaveLength(1);

    await api.pause('p');
    await waitFor(() => expect(server.to('GET /api/usage').length).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    });

    server.set('GET /api/usage', usageView({ funding: 'byok' }));
    const before = server.to('GET /api/usage').length;
    setByokKey(TEST_KEY, null);
    await waitFor(() =>
      expect(screen.getByTestId('usage-meter').textContent).toBe('Using your own key'),
    );
    expect(server.to('GET /api/usage').length).toBeGreaterThan(before);
    expect(server.to('GET /api/usage').at(-1)!.headers['x-swarm-provider-key']).toBe(TEST_KEY);

    server.set('GET /api/usage', usageView());
    clearByok();
    await waitFor(() =>
      expect(screen.getByTestId('usage-meter').textContent).toBe('3 free runs left today'),
    );
    expect(server.to('GET /api/usage').at(-1)!.headers['x-swarm-provider-key']).toBeUndefined();
  });

  it('keeps showing the last answer, and says when nothing has ever been read', async () => {
    const server = routes({ 'GET /api/usage': failure(500, 'INTERNAL') });
    renderWithApp(publicShell());
    const chip = await screen.findByTestId('usage-meter');
    expect(chip.textContent).toBe('Free runs: not available');
    expect(chip.getAttribute('data-usage')).toBe('unknown');
    expect(server.unexpected).toEqual([]);
  });
});

describe('when a request is refused', () => {
  async function refuse(code: string, status = 429) {
    const server = routes({
      'POST /api/projects/p/steps/simulation': failure(status, code, 'RAW SERVER MESSAGE'),
    });
    const rendered = renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    const error = await api.step('p', 'simulation').catch((e: unknown) => e);
    return { ...rendered, server, error: error as Error };
  }

  it('tells a person who has used the day’s free runs in a card with one step, and opens the panel for their own key', async () => {
    const { user, error, server } = await refuse('FREE_TIER_USER_CAP');
    const card = await screen.findByTestId('limit-reached');
    expect(card.getAttribute('data-reason')).toBe('user-cap');
    expect(card.getAttribute('data-code')).toBe('FREE_TIER_USER_CAP');
    expect(card.textContent).toContain(
      "You have used today's free runs. They come back at 00:00 UTC, or use your own key now.",
    );
    expect(card.textContent).not.toContain('RAW SERVER MESSAGE');
    // The page that asked is told the same words, not the code and not the server's.
    expect(error.message).toBe(
      "You have used today's free runs. They come back at 00:00 UTC, or use your own key now.",
    );
    expect(within(card).getAllByRole('button')).toHaveLength(2);
    expect(within(card).getByRole('button', { name: 'Use your own key' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    // The meter is read again, so that what it says is what the server says now.
    await waitFor(() => expect(server.to('GET /api/usage').length).toBeGreaterThanOrEqual(2));

    await user.click(within(card).getByTestId('limit-action'));
    expect(await screen.findByRole('dialog', { name: 'Use your own Google key' })).toBeTruthy();
  });

  it('puts the test id of the limit state on one card at a time, not on the card and the meter together', async () => {
    const server = routes({
      'GET /api/usage': usageView({ free: { available: false, reason: 'user-cap' } }),
      'POST /api/projects/p/steps/simulation': failure(429, 'FREE_TIER_USER_CAP'),
    });
    const { user } = renderWithApp(publicShell());
    const chip = await screen.findByTestId('usage-meter');
    await user.click(chip);
    expect(await screen.findAllByTestId('limit-reached')).toHaveLength(1);
    await user.keyboard('{Escape}');
    await api.step('p', 'simulation').catch(() => undefined);
    await screen.findByTestId('limit-reached');
    await user.click(screen.getByTestId('usage-meter'));
    await screen.findByRole('dialog', { name: 'Free runs' });
    expect(screen.getAllByTestId('limit-reached')).toHaveLength(1);
    expect(server.unexpected).toEqual([]);
  });

  it('says the run paused when the key is not saved, and asks for it again where the key is added; connecting it dismisses the card', async () => {
    const { user } = await refuse('BYOK_KEY_NEEDED', 409);
    const card = await screen.findByTestId('limit-reached');
    expect(card.getAttribute('data-reason')).toBe('byok-key-needed');
    expect(card.textContent).toContain(
      'Your key is not saved, so the run paused. Add your key again to continue.',
    );
    expect(within(card).getByTestId('limit-action').textContent).toBe('Add your key');
    fakeServer({
      'POST /api/byok/connect': connectResult(),
      'GET /api/usage': usageView(),
      'GET /api/account': accountView(),
    });
    await user.click(within(card).getByTestId('limit-action'));
    await screen.findByRole('dialog', { name: 'Use your own Google key' });
    await user.click(screen.getByTestId('byok-key'));
    await user.paste(TEST_KEY);
    await user.click(screen.getByTestId('byok-connect'));
    await screen.findByTestId('byok-hint');
    await waitFor(() => expect(screen.queryByTestId('limit-reached')).toBeNull());
  });

  it.each([
    ['PROJECT_LIMIT', 400, 'project-limit'],
    ['STORAGE_LIMIT', 400, 'storage-limit'],
    ['RUN_IN_PROGRESS', 409, 'run-in-progress'],
    ['BYOK_BLOCKED', 422, 'byok-blocked'],
  ])(
    'tells a person about %s with one step that only closes the card',
    async (code, status, reason) => {
      const { user } = await refuse(code, status);
      const card = await screen.findByTestId('limit-reached');
      expect(card.getAttribute('data-reason')).toBe(reason);
      expect(
        within(card)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Okay']);
      await user.click(within(card).getByTestId('limit-action'));
      expect(screen.queryByTestId('limit-reached')).toBeNull();
    },
  );

  it('reads the meter again, and closes the card, for a run that is only waiting for another', async () => {
    const { user, server } = await refuse('FREE_TIER_CONCURRENT');
    const card = await screen.findByTestId('limit-reached');
    expect(card.getAttribute('data-reason')).toBe('concurrent');
    const before = server.to('GET /api/usage').length;
    await user.click(within(card).getByTestId('limit-action'));
    await waitFor(() => expect(server.to('GET /api/usage').length).toBeGreaterThan(before));
    expect(screen.queryByTestId('limit-reached')).toBeNull();
  });

  it.each(['NOT_AVAILABLE', 'BOT_CHECK_FAILED'])(
    'does not raise a card for %s, which is told in place',
    async (code) => {
      const { error } = await refuse(code, 404);
      expect(error.message.length).toBeGreaterThan(10);
      expect(screen.queryByTestId('limit-reached')).toBeNull();
    },
  );

  it('leaves every other refusal alone, in the server’s words, with no card', async () => {
    const { error } = await refuse('STEP_LOCKED', 409);
    expect(error.message).toBe('RAW SERVER MESSAGE');
    expect(screen.queryByTestId('limit-reached')).toBeNull();
  });

  it('reads the meter once for a refusal that comes again and again, and again for another', async () => {
    const server = routes({
      'POST /api/projects/p/steps/simulation': failure(429, 'FREE_TIER_USER_CAP'),
      'POST /api/projects/p/pause': failure(409, 'RUN_IN_PROGRESS'),
    });
    renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    const reads = () => server.to('GET /api/usage').length;
    expect(reads()).toBe(1);

    await api.step('p', 'simulation').catch(() => undefined);
    await waitFor(() => expect(reads()).toBe(2));
    for (let again = 0; again < 3; again += 1) {
      await api.step('p', 'simulation').catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(reads()).toBe(2);

    await api.pause('p').catch(() => undefined);
    await waitFor(() => expect(reads()).toBe(3));
  });
});

describe('the sample, for an account with nothing in it', () => {
  const noProjects = () => accountView({ projects: { count: 0, limit: 10 } });
  const created = { id: 'p1', name: 'Sample: Launch pricing' };

  function sampleRoutes(over: Record<string, Handler> = {}) {
    return fakeServer({
      'GET /api/usage': usageView(),
      'GET /api/account': noProjects(),
      'POST /api/projects': json(created, 201),
      'POST /api/projects/p1/steps/knowledge': json(created, 202),
      ...over,
    });
  }

  it('is offered on the first screen, and says that it runs on the app’s own rules and uses no model', async () => {
    sampleRoutes();
    renderWithApp(publicShell());
    const card = await screen.findByTestId('welcome');
    expect(within(card).getByText(/runs on Swarm's own rules and uses no model/u)).toBeTruthy();
    expect(within(card).getByText(/so it costs nothing/u)).toBeTruthy();
    expect(within(card).getByTestId('try-sample').textContent).toBe('Try a sample');
  });

  it('makes a project on the rules engine only, reads its evidence, and opens it, with no free runs and no key', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    // The free tier is used up, and there is no key: the sample does not care.
    const server = sampleRoutes({
      'GET /api/usage': usageView({ free: { available: false, reason: 'global-cap' } }),
    });
    const { user } = renderWithApp(publicShell());
    await user.click(await screen.findByTestId('try-sample'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/?project=p1'));

    const [create] = server.to('POST /api/projects');
    const input = create!.body as {
      name: string;
      question: string;
      workflow: string;
      settings: { mode: string };
      documents: unknown[];
      scenario?: unknown;
    };
    expect(input.settings.mode).toBe('local');
    expect(input.workflow).toBe('guided');
    expect(input.name).toBe('Sample: Launch pricing');
    expect(input.question).toMatch(/What could happen if we launch the new plan/u);
    expect(input.documents.length).toBeGreaterThan(0);
    expect(input).not.toHaveProperty('scenario');
    expect(create!.headers['x-swarm-csrf']).toBe('1');
    expect(create!.headers['x-swarm-provider-key']).toBeUndefined();
    expect(server.to('POST /api/projects/p1/steps/knowledge')).toHaveLength(1);
    // Only these changes: nothing that could use a model, nothing sent to a model endpoint.
    expect(server.calls.filter((call) => call.method !== 'GET').map((call) => call.path)).toEqual([
      '/api/projects',
      '/api/projects/p1/steps/knowledge',
    ]);
    expect(server.unexpected).toEqual([]);
  });

  it('is also in the menu, with its own test id', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    sampleRoutes({ 'GET /api/account': accountView() });
    const { user } = renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    expect(screen.queryByTestId('welcome')).toBeNull();
    await user.click(within(await openMenu(user)).getByTestId('try-sample-menu'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/?project=p1'));
  });

  it('is not offered to an account that has projects, nor on a page that has one open, nor again once it was put away', async () => {
    const withProjects = sampleRoutes({ 'GET /api/account': accountView() });
    const first = renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    await waitFor(() => expect(withProjects.to('GET /api/account')).toHaveLength(1));
    expect(screen.queryByTestId('welcome')).toBeNull();
    first.unmount();

    const open = sampleRoutes();
    at('/?project=p9');
    const second = renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    expect(open.to('GET /api/account')).toEqual([]);
    expect(screen.queryByTestId('welcome')).toBeNull();
    second.unmount();

    at('/');
    sampleRoutes();
    const third = renderWithApp(publicShell());
    await third.user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('welcome')).toBeNull();
    third.unmount();
    const again = sampleRoutes();
    renderWithApp(publicShell());
    await screen.findByTestId('usage-meter');
    expect(again.to('GET /api/account')).toEqual([]);
    expect(screen.queryByTestId('welcome')).toBeNull();
  });

  it('goes away once any exploration is started', async () => {
    sampleRoutes();
    renderWithApp(publicShell());
    await screen.findByTestId('welcome');
    await api.create({ name: 'Mine', question: 'What could happen if?', documents: [] });
    await waitFor(() => expect(screen.queryByTestId('welcome')).toBeNull());
  });

  it('says in a toast when the sample could not be made, and in the card of limits when the account is full', async () => {
    const server = sampleRoutes({ 'POST /api/projects': failure(500, 'INTERNAL', 'It broke.') });
    const { user } = renderWithApp(publicShell());
    await user.click(await screen.findByTestId('try-sample'));
    expect(await screen.findByText('The sample could not be opened')).toBeTruthy();
    expect(screen.getByText(/It broke\./u)).toBeTruthy();
    expect(screen.queryByTestId('limit-reached')).toBeNull();

    server.set('POST /api/projects', failure(409, 'PROJECT_LIMIT'));
    await user.click(screen.getByTestId('try-sample'));
    const card = await screen.findByTestId('limit-reached');
    expect(card.getAttribute('data-reason')).toBe('project-limit');
    expect(screen.queryAllByText('The sample could not be opened')).toHaveLength(1);
  });
});
