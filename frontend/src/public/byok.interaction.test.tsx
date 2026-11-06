// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ByokStatus } from '../../../shared/public';
import { renderWithApp, screen, waitFor, within } from '../test/dom';
import { ByokPanel } from './ByokPanel';
import { byokModel, clearByok, holdsByokKey, setByokKey } from './byokStore';
import { setPublicEdition } from './runtime';
import { connectResult, TEST_KEY } from './test/fixtures';
import { failure, fakeServer } from './test/server';

// The panel for a person's own key: what they are told, what is kept and where, and that the key is never shown, written
// or said anywhere but in the header of a request.

const NOTICE =
  'Your key is used only for your requests and is never saved. Use a key with a spend limit.';

beforeEach(() => setPublicEdition(true));

afterEach(() => {
  setPublicEdition(false);
  clearByok();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

function panel(options: { byokEnabled?: boolean } = {}) {
  const onOpenChange = vi.fn();
  const onChanged = vi.fn();
  const rendered = renderWithApp(
    <ByokPanel
      open
      onOpenChange={onOpenChange}
      byokEnabled={options.byokEnabled ?? true}
      onChanged={onChanged}
    />,
  );
  const field = () => screen.getByTestId('byok-key') as HTMLInputElement;
  const connectButton = () => screen.getByTestId('byok-connect') as HTMLButtonElement;
  const status = () => screen.getByTestId('byok-status');
  const paste = async (text: string) => {
    await rendered.user.click(field());
    await rendered.user.paste(text);
  };
  const connect = async (text = TEST_KEY) => {
    await paste(text);
    await rendered.user.click(connectButton());
  };
  return { ...rendered, onOpenChange, onChanged, field, connectButton, status, paste, connect };
}

describe('the panel for a person’s own key', () => {
  it('has a field that shows dots, the notice in its exact words, and nothing to connect until there is a key', async () => {
    const { field, connectButton } = panel();
    expect(await screen.findByRole('dialog', { name: 'Use your own Google key' })).toBeTruthy();
    expect(field().type).toBe('password');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(screen.getByTestId('byok-notice').textContent).toBe(NOTICE);
    expect(connectButton().textContent).toBe('Connect');
    expect(connectButton().disabled).toBe(true);
    for (const id of ['byok-hint', 'byok-model', 'byok-forget']) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
    expect(screen.getByRole('link', { name: 'Google AI Studio' }).getAttribute('rel')).toContain(
      'noreferrer',
    );
  });

  it('is switched off, in words, where the site does not take keys', async () => {
    const { field, connectButton } = panel({ byokEnabled: false });
    expect(await screen.findByText('Using your own key is switched off right now.')).toBeTruthy();
    expect(field().disabled).toBe(true);
    expect(connectButton().disabled).toBe(true);
  });
});

describe('connecting a key', () => {
  const ANSWERS: [ByokStatus, string][] = [
    ['valid', 'Google accepted this key.'],
    ['invalid', 'Google did not accept this key. Make a new one in AI Studio.'],
    ['rate-limited', 'Your Google quota is used up for the moment. Wait a minute.'],
    ['quota', 'Your Google quota or billing does not allow this.'],
    ['region', 'Google does not offer this key’s service from where the server is.'],
    ['unreachable', 'We could not reach Google just now.'],
    ['disabled', 'Using your own key is switched off right now.'],
  ];

  it.each(ANSWERS)(
    'shows the server’s message for “%s”, and keeps the key only when it is valid',
    async (statusName, message) => {
      const server = fakeServer({
        'POST /api/byok/connect': connectResult({
          status: statusName,
          message,
          ...(statusName === 'valid' ? {} : { models: [], defaultModel: null }),
        }),
      });
      const { connect, status, onChanged } = panel();
      await screen.findByRole('dialog');
      await connect();
      await waitFor(() => expect(status().getAttribute('data-status')).toBe(statusName));
      expect(status().textContent).toBe(message);

      const [call] = server.calls;
      expect(call).toMatchObject({ method: 'POST', path: '/api/byok/connect' });
      expect(call!.headers['x-swarm-provider']).toBe('gemini');
      expect(call!.headers['x-swarm-provider-key']).toBe(TEST_KEY);
      expect(call!.headers['x-swarm-provider-model']).toBeUndefined();
      expect(call!.headers['x-swarm-csrf']).toBe('1');
      expect(call!.body).toBeUndefined();

      expect(holdsByokKey()).toBe(statusName === 'valid');
      expect(screen.queryByTestId('byok-hint') !== null).toBe(statusName === 'valid');
      expect(onChanged).toHaveBeenCalledTimes(statusName === 'valid' ? 1 : 0);
    },
  );

  it('shows only the last four characters of the key, and no more of it anywhere', async () => {
    fakeServer({ 'POST /api/byok/connect': connectResult() });
    const { connect, field } = panel();
    await screen.findByRole('dialog');
    await connect();
    const hint = await screen.findByTestId('byok-hint');
    expect(hint.textContent).toBe('…1234');
    expect(field().value).toBe('');
    expect(document.body.textContent).not.toContain(TEST_KEY);
    expect(document.body.textContent).not.toContain(TEST_KEY.slice(0, -4));
    expect(document.body.innerHTML).not.toContain(TEST_KEY);
  });

  it('offers the models the key can use, with the server’s default chosen, and sends the one the person picks', async () => {
    const server = fakeServer({
      'POST /api/byok/connect': connectResult(),
      'POST /api/projects/p/pause': {},
    });
    const { connect, user } = panel();
    await screen.findByRole('dialog');
    await connect();
    const picker = (await screen.findByTestId('byok-model')) as HTMLSelectElement;
    expect([...picker.options].map((option) => [option.value, option.textContent])).toEqual([
      ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
      ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ]);
    expect(picker.value).toBe('gemini-2.5-flash');
    expect(byokModel()).toBe('gemini-2.5-flash');

    await user.selectOptions(picker, 'gemini-2.5-pro');
    expect(byokModel()).toBe('gemini-2.5-pro');
    expect(window.sessionStorage.getItem('swarm.byok.model')).toBe('gemini-2.5-pro');

    const { api } = await import('../api');
    await api.pause('p');
    const pause = server.to('POST /api/projects/p/pause')[0]!;
    expect(pause.headers['x-swarm-provider-model']).toBe('gemini-2.5-pro');
    expect(pause.headers['x-swarm-provider-key']).toBe(TEST_KEY);
  });

  it('keeps the model chosen when the same key is checked again, and checks the held key when the field is empty', async () => {
    const server = fakeServer({ 'POST /api/byok/connect': connectResult() });
    setByokKey(TEST_KEY, 'gemini-2.5-pro', connectResult().models);
    const { connectButton, user, status } = panel();
    await screen.findByRole('dialog');
    expect(connectButton().textContent).toBe('Check key again');
    expect(connectButton().disabled).toBe(false);
    expect(screen.getByTestId('byok-hint').textContent).toBe('…1234');
    expect(status().textContent).toBe('A key is connected.');
    await user.click(connectButton());
    await waitFor(() => expect(status().textContent).toBe('Google accepted this key.'));
    expect(server.calls[0]!.headers['x-swarm-provider-key']).toBe(TEST_KEY);
    expect(byokModel()).toBe('gemini-2.5-pro');
  });

  it('checks the key for a shape before anything is sent', async () => {
    const server = fakeServer({});
    const { connect, status, paste, connectButton, user, field } = panel();
    await screen.findByRole('dialog');
    await connect('short');
    expect(status().textContent).toBe(
      'That does not look like a key. Copy the whole key from Google AI Studio, with no spaces.',
    );
    await user.clear(field());
    await paste('has some spaces in it 12345');
    await user.click(connectButton());
    expect(status().textContent).toMatch(/does not look like a key/u);
    expect(server.calls).toEqual([]);
    expect(holdsByokKey()).toBe(false);
  });

  it('never shows a key that a server repeated, whatever it said', async () => {
    fakeServer({
      'POST /api/byok/connect': connectResult({
        status: 'invalid',
        message: `Bad key ${TEST_KEY}.`,
      }),
    });
    const { connect, status } = panel();
    await screen.findByRole('dialog');
    await connect();
    await waitFor(() => expect(status().getAttribute('data-status')).toBe('invalid'));
    expect(status().textContent).toBe('Bad key ….');
    expect(document.body.textContent).not.toContain(TEST_KEY);
  });

  it('says what a refusal of the request itself was, without the key, and keeps nothing', async () => {
    fakeServer({
      'POST /api/byok/connect': failure(429, 'RATE_LIMITED', 'Too many tries. Wait a while.'),
    });
    const { connect, status } = panel();
    await screen.findByRole('dialog');
    await connect();
    await waitFor(() => expect(status().textContent).toContain('Too many tries. Wait a while.'));
    expect(status().getAttribute('data-status')).toBe('local');
    expect(holdsByokKey()).toBe(false);
    expect(document.body.textContent).not.toContain(TEST_KEY);
  });

  it('says it cannot reach the service when there is no answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const { connect, status } = panel();
    await screen.findByRole('dialog');
    await connect();
    await waitFor(() => expect(status().textContent).toMatch(/can't reach the service/u));
    expect(holdsByokKey()).toBe(false);
  });
});

describe('taking the key back, and where it is kept', () => {
  it('forgets it on the press of a button: the tab’s storage, the memory, the server’s copy, and what the page says', async () => {
    const server = fakeServer({
      'POST /api/byok/connect': connectResult(),
      'DELETE /api/byok': null,
    });
    const { connect, user, onChanged, status } = panel();
    await screen.findByRole('dialog');
    await connect();
    await user.click(await screen.findByTestId('byok-forget'));
    expect(holdsByokKey()).toBe(false);
    await waitFor(() =>
      expect(status().textContent).toBe(
        'Your key was removed from this tab, and the server was told to drop its copy.',
      ),
    );
    expect(status().getAttribute('data-status')).toBe('forgotten');
    expect(screen.queryByTestId('byok-hint')).toBeNull();
    expect(screen.queryByTestId('byok-model')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(onChanged).toHaveBeenCalledTimes(2);
    // The server is asked once, and the request does not carry the key it is asking the server to drop.
    const told = server.to('DELETE /api/byok');
    expect(told).toHaveLength(1);
    expect(told[0]!.headers['x-swarm-csrf']).toBe('1');
    expect(
      Object.keys(told[0]!.headers).filter((name) => name.startsWith('x-swarm-provider')),
    ).toEqual([]);
    expect(JSON.stringify(told[0])).not.toContain(TEST_KEY);
  });

  it('says so when the server could not be told, and the key is gone from the tab all the same', async () => {
    fakeServer({
      'POST /api/byok/connect': connectResult(),
      'DELETE /api/byok': failure(503, 'INTERNAL_ERROR'),
    });
    const { connect, user, status } = panel();
    await screen.findByRole('dialog');
    await connect();
    await user.click(await screen.findByTestId('byok-forget'));
    expect(holdsByokKey()).toBe(false);
    await waitFor(() => expect(status().textContent).toMatch(/could not be told just now/u));
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps it in the tab’s session storage and in memory, and survives a reload of the tab', async () => {
    fakeServer({ 'POST /api/byok/connect': connectResult() });
    const { connect } = panel();
    await screen.findByRole('dialog');
    await connect();
    await screen.findByTestId('byok-hint');
    expect(window.sessionStorage.getItem('swarm.byok.key')).toBe(TEST_KEY);
    expect(window.sessionStorage.getItem('swarm.byok.model')).toBe('gemini-2.5-flash');
    expect(window.localStorage.length).toBe(0);

    vi.resetModules();
    const reloaded = await import('./byokStore');
    expect(reloaded.holdsByokKey()).toBe(true);
    expect(reloaded.byokModel()).toBe('gemini-2.5-flash');
    expect(reloaded.byokModels().map((model) => model.id)).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);
  });

  it('writes the key to no storage but the tab’s, and says it in no console line, from the first keystroke to the last', async () => {
    const writes: { area: 'local' | 'session'; value: string }[] = [];
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      name: string,
      value: string,
    ) {
      writes.push({ area: this === window.localStorage ? 'local' : 'session', value });
      return original.call(this, name, value);
    });
    const logged: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    fakeServer({
      'POST /api/byok/connect': connectResult(),
      'POST /api/projects/p/pause': failure(429, 'BYOK_KEY_REJECTED'),
      'DELETE /api/byok': null,
    });
    const { connect, user } = panel();
    await screen.findByRole('dialog');
    await connect();
    await user.selectOptions(await screen.findByTestId('byok-model'), 'gemini-2.5-pro');
    const { api } = await import('../api');
    await api.pause('p').catch(() => undefined);
    await user.click(screen.getByTestId('byok-forget'));

    const withKey = writes.filter((write) => write.value.includes(TEST_KEY));
    expect(withKey.length).toBeGreaterThan(0);
    expect(withKey.every((write) => write.area === 'session')).toBe(true);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TEST_KEY);
    expect(JSON.stringify(logged)).not.toContain(TEST_KEY);
    expect(logged).toEqual([]);
    expect(window.location.href).not.toContain(TEST_KEY);
    expect(within(document.body).queryByDisplayValue(TEST_KEY)).toBeNull();
  });
});
