// @vitest-environment jsdom
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_SIGN_IN_PROBLEMS } from '../../../shared/public';
import Root from '../app/Root';
import { request } from '../api';
import { screen, waitFor, within } from '../test/dom';
import { bootEdition, isPublicEdition } from './edition';
import { holdsByokKey, setByokKey } from './byokStore';
import { SIGN_IN_WORDS } from './problems';
import { inPublicEdition, setPublicEdition } from './runtime';
import { parseSession } from './useGateSession';
import {
  accountView,
  guestAccountView,
  guestSession,
  signedInGuest,
  signedInSession,
  signedOutSession,
  statusView,
  TEST_KEY,
  usageView,
} from './test/fixtures';
import { failure, fakeServer, json } from './test/server';

// The application stands in for itself: what is under test is what decides to draw it, and what is around it.
vi.mock('../app/Application', async () => {
  const { createElement } = await import('react');
  return { Application: () => createElement('div', { 'data-testid': 'app' }, 'the application') };
});

function tagThePage(content = 'public') {
  const tag = document.createElement('meta');
  tag.setAttribute('name', 'swarm-edition');
  tag.setAttribute('content', content);
  document.head.append(tag);
}

const at = (address: string) => window.history.replaceState({}, '', address);

beforeEach(() => at('/'));

afterEach(() => {
  document.head.querySelectorAll('meta[name="swarm-edition"]').forEach((tag) => tag.remove());
  setPublicEdition(false);
  window.sessionStorage.clear();
  at('/');
  vi.unstubAllGlobals();
});

describe('which edition a page is', () => {
  it('is the pilot without the tag, and the public edition only with the tag saying so', () => {
    expect(isPublicEdition()).toBe(false);
    tagThePage('pilot');
    expect(isPublicEdition()).toBe(false);
    document.head.querySelector('meta')!.setAttribute('content', 'public');
    expect(isPublicEdition()).toBe(true);
  });

  it('turns the API client’s switch on at start-up only for a page that has the tag', () => {
    expect(bootEdition()).toBe(false);
    expect(inPublicEdition()).toBe(false);
    tagThePage();
    expect(bootEdition()).toBe(true);
    expect(inPublicEdition()).toBe(true);
  });
});

describe('a page without the tag, which is the pilot', () => {
  it('draws the application and makes no request of its own', async () => {
    const server = fakeServer({});
    render(<Root />);
    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(server.calls).toEqual([]);
    expect(inPublicEdition()).toBe(false);
  });

  it('draws nothing of the public edition at the addresses it owns', async () => {
    const server = fakeServer({});
    for (const path of ['/status', '/faq', '/legal/terms', '/admin']) {
      at(path);
      const { unmount } = render(<Root />);
      expect(await screen.findByTestId('app'), path).toBeTruthy();
      expect(screen.queryByTestId('landing'), path).toBeNull();
      expect(screen.queryByTestId('status-page'), path).toBeNull();
      expect(screen.queryByTestId('faq'), path).toBeNull();
      unmount();
    }
    expect(server.calls).toEqual([]);
  });

  it('explains a sign-in that failed as it always did, and ignores the reasons that only the public edition has', async () => {
    fakeServer({});
    at('/?signin=failed');
    const { unmount } = render(<Root />);
    expect(await screen.findByRole('heading', { name: 'Sign-in did not complete' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sign in with Microsoft/u }).getAttribute('href')).toBe(
      '/auth/login',
    );
    expect(screen.queryByTestId('app')).toBeNull();
    unmount();

    at('/?signin=closed');
    render(<Root />);
    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('signin-problem')).toBeNull();
  });
});

describe('a page with the tag: the gate', () => {
  beforeEach(() => tagThePage());

  it('asks once who the visitor is, with a plain request that carries nothing else', async () => {
    const server = fakeServer({ 'GET /api/public/session': signedOutSession() });
    render(<Root />);
    expect(await screen.findByTestId('landing')).toBeTruthy();
    expect(server.fetch).toHaveBeenCalledTimes(1);
    expect(server.fetch.mock.calls[0]![0]).toBe('/api/public/session');
    expect(server.fetch.mock.calls[0]![1]!.headers).toEqual({ Accept: 'application/json' });
    expect(server.fetch.mock.calls[0]![1]!.method).toBeUndefined();
    expect(inPublicEdition()).toBe(true);
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('shows a signed-in person the application, and the public edition’s additions around it', async () => {
    const server = fakeServer({
      'GET /api/public/session': signedInSession(),
      'GET /api/usage': usageView(),
      'GET /api/account': accountView(),
    });
    render(<Root />);
    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('landing')).toBeNull();
    await waitFor(() => expect(server.to('GET /api/usage')).toHaveLength(1));
    expect(server.unexpected).toEqual([]);
  });

  it('says the service is down for maintenance when the session answer is 503', async () => {
    fakeServer({ 'GET /api/public/session': failure(503, 'MAINTENANCE', 'Down.') });
    render(<Root />);
    const screenOfIt = await screen.findByTestId('maintenance');
    expect(within(screenOfIt).getByRole('heading', { name: /down for maintenance/u })).toBeTruthy();
    expect(within(screenOfIt).getByRole('link', { name: 'See the status' })).toBeTruthy();
    expect(screen.queryByTestId('landing')).toBeNull();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('says it cannot reach the service when there is no answer, or an answer that is not the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const first = render(<Root />);
    expect(
      await screen.findByRole('heading', { name: "We can't reach the service right now." }),
    ).toBeTruthy();
    first.unmount();

    fakeServer({ 'GET /api/public/session': { edition: 'pilot' } });
    render(<Root />);
    expect(await screen.findByTestId('unreachable')).toBeTruthy();
  });

  it('asks again when the person presses Try again', async () => {
    const server = fakeServer({ 'GET /api/public/session': failure(503, 'MAINTENANCE') });
    const user = userEvent.setup();
    render(<Root />);
    await screen.findByTestId('maintenance');
    server.set('GET /api/public/session', signedOutSession());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('landing')).toBeTruthy();
    expect(server.to('GET /api/public/session')).toHaveLength(2);
  });

  it.each(PUBLIC_SIGN_IN_PROBLEMS)(
    'explains a sign-in that ended in “%s” in plain words, on a screen of its own',
    async (kind) => {
      fakeServer({ 'GET /api/public/session': signedOutSession() });
      at(`/?signin=${kind}`);
      render(<Root />);
      const card = await screen.findByTestId('signin-problem');
      expect(card.getAttribute('data-problem')).toBe(kind);
      expect(within(card).getByRole('heading', { name: SIGN_IN_WORDS[kind].title })).toBeTruthy();
      expect(within(card).getByText(SIGN_IN_WORDS[kind].body)).toBeTruthy();
      expect(screen.queryByTestId('landing')).toBeNull();
      // A person whose account is off has nothing to try again; everyone else has the way in on the same screen.
      expect(screen.queryByTestId('signin-card') === null).toBe(kind === 'disabled');
    },
  );

  it('does not leave a sign-in problem on the address of a person who did get in', async () => {
    fakeServer({
      'GET /api/public/session': signedInSession(),
      'GET /api/usage': usageView(),
      'GET /api/account': accountView(),
    });
    at('/?signin=failed&project=p1');
    render(<Root />);
    expect(await screen.findByTestId('app')).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe('?project=p1'));
    expect(screen.queryByTestId('signin-problem')).toBeNull();
  });

  it('goes back to the landing page, with a line about it, when the server says the session ended, and forgets the key', async () => {
    fakeServer({
      'GET /api/public/session': signedInSession(),
      'GET /api/usage': usageView(),
      'GET /api/account': accountView(),
      'GET /api/config': failure(401, 'SIGN_IN_REQUIRED'),
    });
    render(<Root />);
    expect(await screen.findByTestId('app')).toBeTruthy();
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    void request('/api/config');
    const note = await screen.findByTestId('landing-note');
    expect(note.getAttribute('data-kind')).toBe('expired');
    expect(note.textContent).toBe('Your session ended. Sign in again to continue.');
    expect(screen.getByTestId('landing')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
    expect(holdsByokKey()).toBe(false);
  });

  it('tells a person whose account was switched off so, on the landing page', async () => {
    fakeServer({
      'GET /api/public/session': signedInSession(),
      'GET /api/usage': usageView(),
      'GET /api/account': accountView(),
      'POST /api/projects': failure(403, 'ACCOUNT_DISABLED'),
    });
    render(<Root />);
    await screen.findByTestId('app');
    void request('/api/projects', { method: 'POST' }).catch(() => undefined);
    const note = await screen.findByTestId('landing-note');
    expect(note.getAttribute('data-kind')).toBe('disabled');
    expect(note.textContent).toMatch(/switched off/u);
  });

  it('lets a visitor in as a guest with one press: no sign-in, a session started, the session read again, then the application', async () => {
    let started = false;
    const server = fakeServer({
      'GET /api/public/session': () => (started ? signedInGuest() : guestSession()),
      'POST /auth/guest': () => {
        started = true;
        return { started: true };
      },
      'GET /api/usage': usageView(),
      'GET /api/account': guestAccountView(),
    });
    at('/?project=gone');
    const user = userEvent.setup();
    render(<Root />);
    await user.click(await screen.findByTestId('try-it-now'));
    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('landing')).toBeNull();
    expect(server.to('POST /auth/guest')).toHaveLength(1);
    expect(server.to('POST /auth/guest')[0]!.headers['x-swarm-csrf']).toBe('1');
    expect(server.to('GET /api/public/session')).toHaveLength(2);
    await waitFor(() => expect(server.to('GET /api/usage')).toHaveLength(1));
    expect(server.unexpected).toEqual([]);
    expect(window.location.search).toBe('');
  });

  it('says so, and stays on the landing page, when the browser does not keep the session that was started', async () => {
    const server = fakeServer({
      'GET /api/public/session': guestSession(),
      'POST /auth/guest': { started: true },
    });
    const user = userEvent.setup();
    render(<Root />);
    await user.click(await screen.findByTestId('try-it-now'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/allows cookies/u);
    expect(screen.getByTestId('landing')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
    expect(server.to('POST /auth/guest')).toHaveLength(1);
    expect(server.to('GET /api/public/session')).toHaveLength(2);
  });

  it('hands the page to the gate’s own screens, which can ask again, when the session cannot be read after a guest session was started', async () => {
    let started = false;
    fakeServer({
      'GET /api/public/session': () => (started ? failure(503, 'MAINTENANCE') : guestSession()),
      'POST /auth/guest': () => {
        started = true;
        return { started: true };
      },
    });
    const user = userEvent.setup();
    render(<Root />);
    await user.click(await screen.findByTestId('try-it-now'));
    expect(await screen.findByTestId('maintenance')).toBeTruthy();
    expect(screen.queryByTestId('landing')).toBeNull();
  });

  it('sends a guest whose session ended to the landing page, where “Try it now” is, and forgets the key', async () => {
    fakeServer({
      'GET /api/public/session': signedInGuest(),
      'GET /api/usage': usageView(),
      'GET /api/account': guestAccountView(),
      'GET /api/config': failure(401, 'SIGN_IN_REQUIRED'),
    });
    render(<Root />);
    expect(await screen.findByTestId('app')).toBeTruthy();
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    void request('/api/config');
    const note = await screen.findByTestId('landing-note');
    expect(note.getAttribute('data-kind')).toBe('expired');
    expect(note.textContent).toBe('Your session ended. Press Try it now to start again.');
    expect(screen.getByTestId('try-it-now')).toBeTruthy();
    expect(screen.getByTestId('guest-note')).toBeTruthy();
    expect(holdsByokKey()).toBe(false);
  });

  it('shows the pages that need no session whatever the answer to the session is', async () => {
    const server = fakeServer({
      'GET /api/public/session': failure(503, 'MAINTENANCE'),
      'GET /api/public/status': statusView({ status: 'maintenance' }),
    });
    at('/status');
    render(<Root />);
    const page = await screen.findByTestId('status-page');
    await waitFor(() => expect(page.getAttribute('data-status')).toBe('maintenance'));
    expect(screen.queryByTestId('maintenance')).toBeNull();
    expect(server.to('GET /api/public/session')).toHaveLength(1);
  });

  it('serves the FAQ and the legal texts at their own paths, and the usage page only to an administrator', async () => {
    fakeServer({
      'GET /api/public/session': signedInSession(),
      'GET /api/public/legal/terms': { title: 'Terms of use', text: 'Be kind.', reviewed: true },
      'GET /api/usage': usageView(),
      'GET /api/account': accountView(),
    });
    at('/faq');
    const first = render(<Root />);
    expect(await screen.findByTestId('faq')).toBeTruthy();
    first.unmount();
    at('/legal/terms');
    const second = render(<Root />);
    expect(await screen.findByTestId('legal-page')).toBeTruthy();
    second.unmount();
    at('/admin');
    render(<Root />);
    expect(await screen.findByTestId('admin-denied')).toBeTruthy();
  });
});

describe('a person who answers a page of the public edition with json', () => {
  it('is read defensively: a field the server leaves out takes the value that hides nothing', async () => {
    tagThePage();
    fakeServer({
      'GET /api/public/session': json({ edition: 'public', signedIn: false }),
    });
    render(<Root />);
    expect(await screen.findByTestId('landing')).toBeTruthy();
    expect(screen.getByTestId('try-it-free')).toBeTruthy();
  });

  it('reads the days a counter is kept for from the server, and takes the default when it says nothing sensible', () => {
    const answer = (retentionDays: unknown) =>
      parseSession({ edition: 'public', signedIn: false, retentionDays })?.retentionDays;
    expect(answer(7)).toBe(7);
    expect(answer(0)).toBe(0);
    for (const odd of [undefined, '7', -1, 1.5, 1000, null])
      expect(answer(odd), String(odd)).toBe(30);
  });

  it('reads guest mode and the hours a guest’s data is kept, and takes what hides nothing when they are missing or odd', () => {
    const read = (fields: Record<string, unknown>) =>
      parseSession({ edition: 'public', signedIn: false, ...fields })!;
    expect(read({})).toMatchObject({ guestMode: false, guestRetentionHours: 24 });
    expect(read({ guestMode: true, guestRetentionHours: 12 })).toMatchObject({
      guestMode: true,
      guestRetentionHours: 12,
    });
    for (const odd of ['true', 1, null]) expect(read({ guestMode: odd }).guestMode).toBe(false);
    for (const odd of [undefined, '12', 0, -1, null, 1e9])
      expect(read({ guestRetentionHours: odd }).guestRetentionHours, String(odd)).toBe(24);
  });

  it('reads a guest as a guest, and everyone else as not one', () => {
    const user = (fields: Record<string, unknown>) =>
      parseSession({
        edition: 'public',
        signedIn: true,
        user: {
          emailMasked: 'x',
          isAdmin: false,
          createdAt: '2026-11-01T09:00:00.000Z',
          ...fields,
        },
      })!.user!;
    expect(user({ provider: 'guest', guest: true })).toMatchObject({ guest: true });
    expect(user({ provider: 'guest' }).guest).toBe(true);
    expect(user({ provider: 'google', guest: false }).guest).toBe(false);
    expect(user({ provider: 'google' }).guest).toBe(false);
  });
});
