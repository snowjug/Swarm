import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderStatus } from '../../../shared/types';
import { INITIAL_PROVIDER_STATE } from '../hooks/useProviderStatus';
import type { ProviderMonitorState } from '../hooks/useProviderStatus';
import {
  expectNoSecretLikeText,
  localStatusFixture,
  realStatusFixture,
  visibleText,
} from '../test/provider';
import { ProviderBadge, ProviderPanel } from './ProviderBadge';

type Element = ReactElement<Record<string, unknown>>;

const state = (patch: Partial<ProviderMonitorState> = {}): ProviderMonitorState => ({
  ...INITIAL_PROVIDER_STATE,
  ...patch,
});

function badge(patch: Partial<ProviderMonitorState>, open = false): string {
  return renderToStaticMarkup(
    <ProviderBadge state={state(patch)} open={open} onToggle={() => {}} />,
  );
}

function panel(patch: Partial<ProviderMonitorState>, open = true): string {
  return renderToStaticMarkup(
    <ProviderPanel
      state={state(patch)}
      open={open}
      onVerify={() => {}}
      onRetry={() => {}}
      onClose={() => {}}
    />,
  );
}

function badgeButton(html: string) {
  const match = /<button\b([^>]*)>([\s\S]*?)<\/button>/u.exec(html);
  expect(match).not.toBeNull();
  return { attributes: match![1]!, text: visibleText(match![2]!), inner: match![2]! };
}

/** Components here are hook-free, so they can be called directly and their element tree inspected. */
function find(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  const found: Element[] = [];
  const walk = (current: ReactNode) =>
    Children.forEach(current, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return;
      if (predicate(child)) found.push(child);
      walk(child.props.children as ReactNode);
      walk(child.props.action as ReactNode);
    });
  walk(node);
  return found;
}
const button = (node: ReactNode, className?: string, text?: string): Element => {
  const [found] = find(
    node,
    (element) =>
      element.type === 'button' &&
      (!className || String(element.props.className).includes(className)) &&
      (!text || visibleText(renderToStaticMarkup(element)).includes(text)),
  );
  expect(found, `${className ?? ''} ${text ?? ''} button`).toBeDefined();
  return found!;
};
const click = (element: Element, detail = 1) =>
  (element.props.onClick as (event: { detail: number }) => void)({ detail });

const azure = (patch: Partial<ProviderStatus> = {}) => realStatusFixture(patch);
const busyCounters = {
  calls: 12,
  repairCalls: 1,
  failures: 2,
  inputTokens: 3400,
  outputTokens: 910,
  tokensReported: true,
};

describe('header provider badge states', () => {
  it('shows exactly LOCAL / RULES MODE in a neutral style, with no connectivity claim', () => {
    const html = badge({ status: localStatusFixture() });
    const { text, attributes } = badgeButton(html);
    expect(text).toBe('LOCAL / RULES MODE');
    expect(attributes).toContain('provider-badge-neutral');
    expect(attributes).not.toContain('provider-badge-real');
    expect(html).not.toContain('provider-chip');
    expect(html).toContain('No model calls happen in this mode.');
  });

  it.each([
    ['unverified', 'not verified yet', 'provider-chip-neutral'],
    ['ok', 'connected', 'provider-chip-ok'],
    ['failing', 'failing', 'provider-chip-failing'],
  ] as const)('shows REAL AZURE AI, the deployment and a %s chip', (connectivity, chip, tone) => {
    const html = badge({ status: azure({ connectivity }) });
    const { text, attributes } = badgeButton(html);
    expect(text).toBe(`REAL AZURE AI · swarm-dev-deployment ${chip}`);
    expect(attributes).toContain('provider-badge-real');
    expect(html).toContain(tone);
    expect(html).toContain('class="provider-badge-label">REAL AZURE AI</span>');
    expect(html).toContain('class="provider-badge-model">swarm-dev-deployment</span>');
  });

  it('shows REAL MODEL · OpenAI with its model', () => {
    const { text } = badgeButton(
      badge({
        status: azure({
          provider: 'openai',
          model: 'gpt-4.1-mini',
          auth: 'api-key',
          connectivity: 'ok',
        }),
      }),
    );
    expect(text).toBe('REAL MODEL · OpenAI · gpt-4.1-mini connected');
  });

  it('shows REAL MODEL · Ollama (local) and still calls it a real model', () => {
    const { text } = badgeButton(
      badge({ status: azure({ provider: 'ollama', model: 'llama3.2', auth: 'none' }) }),
    );
    expect(text).toBe('REAL MODEL · Ollama (local) · llama3.2 not verified yet');
    expect(text).not.toContain('LOCAL / RULES MODE');
  });

  it('says it is checking, without claiming a mode, until the first status arrives', () => {
    const { text } = badgeButton(badge({}));
    expect(text).toBe('MODEL PROVIDER checking…');
  });

  it('shows "status unavailable" when the status cannot be read, and never a mode', () => {
    const { text } = badgeButton(badge({ error: 'Cannot reach the local server.' }));
    expect(text).toBe('MODEL PROVIDER status unavailable');
  });

  it('keeps the last known provider but admits that its connectivity is unknown', () => {
    const { text } = badgeButton(
      badge({ status: azure({ connectivity: 'ok' }), error: 'Cannot reach the local server.' }),
    );
    expect(text).toBe('REAL AZURE AI · swarm-dev-deployment status unavailable');
  });

  it('names the control by its visible text only: no aria-label or title override', () => {
    for (const patch of [
      { status: localStatusFixture() },
      { status: azure() },
      { error: 'unreachable' },
      {},
    ]) {
      const { attributes } = badgeButton(badge(patch));
      expect(attributes).not.toContain('aria-label=');
      expect(attributes).not.toContain('title=');
      expect(attributes).not.toContain('aria-labelledby=');
    }
  });

  it('keeps the long explanation in a description that is never part of the name', () => {
    const html = badge({ status: azure() });
    const { attributes, text } = badgeButton(html);
    expect(attributes).toContain('aria-describedby="provider-badge-hint"');
    expect(html).toContain('id="provider-badge-hint" class="sr-only"');
    expect(text).not.toContain('Opens provider details');
  });
});

describe('provider badge disclosure semantics', () => {
  it('is a button that controls the panel and starts collapsed', () => {
    const { attributes } = badgeButton(badge({ status: azure() }));
    expect(attributes).toContain('type="button"');
    expect(attributes).toContain('aria-expanded="false"');
    expect(attributes).toContain('aria-controls="provider-panel"');
    expect(attributes).toContain('id="provider-badge"');
  });

  it('reports the expanded state', () => {
    expect(badgeButton(badge({ status: azure() }, true)).attributes).toContain(
      'aria-expanded="true"',
    );
  });

  it('always renders the controlled panel so aria-controls resolves, hidden while collapsed', () => {
    const closed = panel({ status: azure() }, false);
    expect(closed).toMatch(/<section id="provider-panel"[^>]*hidden=""/u);
    expect(closed).toContain('aria-labelledby="provider-panel-title"');
    const open = panel({ status: azure() }, true);
    expect(open).toMatch(/<section id="provider-panel"/u);
    expect(open).not.toMatch(/<section id="provider-panel"[^>]*hidden/u);
    expect(open).toContain('<h2 id="provider-panel-title">Model provider</h2>');
  });

  it('opens by click and by keyboard activation, which a native button turns into a click', () => {
    const onToggle = vi.fn();
    const element = ProviderBadge({ state: state({ status: azure() }), open: false, onToggle });
    const toggle = button(element, 'provider-badge');
    expect(toggle.type).toBe('button');
    click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    // Enter and Space are not intercepted, so the browser's own button activation applies.
    const keyDown = toggle.props.onKeyDown as (event: { key: string }) => void;
    keyDown({ key: 'Enter' });
    keyDown({ key: ' ' });
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('is not hover-dependent: no hover handlers and no tooltip carrying the content', () => {
    const element = ProviderBadge({
      state: state({ status: azure() }),
      open: false,
      onToggle: vi.fn(),
    });
    const toggle = button(element, 'provider-badge');
    expect(toggle.props.onMouseEnter).toBeUndefined();
    expect(toggle.props.onMouseOver).toBeUndefined();
    expect(toggle.props.title).toBeUndefined();
  });

  it('collapses with Escape only while it is open', () => {
    const onToggle = vi.fn();
    const closed = ProviderBadge({ state: state({ status: azure() }), open: false, onToggle });
    (button(closed, 'provider-badge').props.onKeyDown as (e: { key: string }) => void)({
      key: 'Escape',
    });
    expect(onToggle).not.toHaveBeenCalled();
    const open = ProviderBadge({ state: state({ status: azure() }), open: true, onToggle });
    (button(open, 'provider-badge').props.onKeyDown as (e: { key: string }) => void)({
      key: 'Escape',
    });
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('closes the panel with Escape from anywhere inside it', () => {
    const onClose = vi.fn();
    const element = ProviderPanel({
      state: state({ status: azure() }),
      open: true,
      onVerify: vi.fn(),
      onRetry: vi.fn(),
      onClose,
    });
    const keyDown = element.props.onKeyDown as (event: { key: string }) => void;
    keyDown({ key: 'Tab' });
    expect(onClose).not.toHaveBeenCalled();
    keyDown({ key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('announces a change through one polite, atomic live region and is silent otherwise', () => {
    const silent = badge({ status: azure() });
    expect(silent).toMatch(
      /<span class="sr-only" role="status" aria-live="polite" aria-atomic="true"><\/span>/u,
    );
    const spoken = badge({
      status: azure({ connectivity: 'failing' }),
      announcement: 'Model provider connectivity is now failing.',
    });
    expect(spoken).toMatch(
      /role="status" aria-live="polite" aria-atomic="true">Model provider connectivity is now failing\.<\/span>/u,
    );
    expect(spoken.match(/aria-live=/gu)).toHaveLength(1);
  });
});

describe('provider panel contents', () => {
  const full = azure({
    connectivity: 'ok',
    lastCheckedAt: '2026-01-01T00:00:05.000Z',
    lastLatencyMs: 412,
    lastError: { code: 'MODEL_RATE_LIMIT', message: 'The provider is rate limiting requests.' },
    counters: busyCounters,
  });

  it('lists provider, deployment, authentication, connectivity, last check, counters and last error', () => {
    const html = panel({ status: full });
    const text = visibleText(html);
    expect(text).toContain('Provider Azure AI');
    expect(text).toContain('Deployment / model swarm-dev-deployment');
    expect(text).toContain('Authentication Microsoft Entra ID — no API key');
    expect(text).toContain('Connectivity connected');
    expect(text).toContain('412 ms');
    expect(html).toContain('<time dateTime="2026-01-01T00:00:05.000Z">');
    expect(text).toContain('Model calls 12');
    expect(text).toContain('Repair calls 1');
    expect(text).toContain('Failures 2');
    expect(text).toContain(
      `Input / output tokens ${(3400).toLocaleString()} / ${(910).toLocaleString()}`,
    );
    expect(text).toContain('Last error MODEL_RATE_LIMIT The provider is rate limiting requests.');
    expect(text).toContain('since the server started on');
  });

  it.each([
    ['entra', 'Microsoft Entra ID — no API key'],
    ['api-key', 'API key (kept on the server)'],
    ['none', 'none'],
  ] as const)('describes %s authentication as "%s"', (auth, expected) => {
    expect(visibleText(panel({ status: azure({ auth }) }))).toContain(`Authentication ${expected}`);
  });

  it('never shows a bare zero for tokens a provider has not reported', () => {
    const text = visibleText(
      panel({ status: azure({ counters: { ...busyCounters, tokensReported: false } }) }),
    );
    expect(text).toContain(
      'Input / output tokens not reported by provider — zero does not mean zero cost',
    );
    expect(text).not.toMatch(/Input \/ output tokens \d/u);
  });

  it('shows "none" for a last error that never happened and a last check that never ran', () => {
    const text = visibleText(panel({ status: azure() }));
    expect(text).toContain('Last error none');
    expect(text).toContain('Last check none since the server started');
  });

  it('explains local mode and keeps real-model claims out of it', () => {
    const text = visibleText(panel({ status: localStatusFixture() }));
    expect(text).toContain('No model calls happen in this mode.');
    expect(text).toContain('Provider none: local rules only');
    expect(text).toContain('Connectivity not applicable: no model is configured');
    expect(text).toContain('Input / output tokens none: no model is called');
    expect(text).not.toContain('Credentials stay on the server');
    expect(text).not.toContain('not reported by provider');
  });

  it('states that Local rules projects never call a real provider, and that credentials stay on the server', () => {
    const text = visibleText(panel({ status: azure() }));
    expect(text).toContain('Local rules projects never call it.');
    expect(text).toContain('Credentials stay on the server and are never shown here.');
  });
});

describe('Verify connection', () => {
  it('is disabled in local mode with a visible reason that the button points to', () => {
    const html = panel({ status: localStatusFixture() });
    const verify = /<button\b[^>]*provider-verify-button[^>]*>/u.exec(html)![0];
    expect(verify).toContain('disabled=""');
    expect(verify).toContain('aria-describedby="provider-verify-reason"');
    expect(html).toContain(
      '<p id="provider-verify-reason" class="field-help">Nothing to verify: no model provider is configured, so no model call can happen.</p>',
    );
  });

  it('is disabled with a reason until the status is known', () => {
    const html = panel({});
    expect(/<button\b[^>]*provider-verify-button[^>]*>/u.exec(html)![0]).toContain('disabled=""');
    expect(visibleText(html)).toContain(
      'Verification needs the provider status, which is not available yet.',
    );
  });

  it('is enabled for a real model, with no reason shown', () => {
    const html = panel({ status: azure() });
    const verify = /<button\b[^>]*provider-verify-button[^>]*>/u.exec(html)![0];
    expect(verify).not.toContain('disabled');
    expect(verify).not.toContain('aria-describedby');
    expect(verify).toContain('aria-busy="false"');
    expect(html).not.toContain('provider-verify-reason');
    expect(visibleText(html)).toContain('Verify connection');
  });

  it('shows a spinner, marks the button busy and keeps a role=status result while pending', () => {
    const html = panel({ status: azure(), verification: { phase: 'pending' } });
    const verify = /<button\b[^>]*provider-verify-button[^>]*>([\s\S]*?)<\/button>/u.exec(html)!;
    expect(verify[0]).toContain('aria-busy="true"');
    expect(verify[0]).toContain('aria-disabled="true"');
    expect(verify[0]).not.toContain('disabled=""');
    expect(verify[1]).toMatch(/class="[^"]*\bspin\b[^"]*"/u);
    expect(html).toMatch(
      /<div class="provider-result" role="status">[\s\S]*Verifying: sending one real request to the provider…<\/div>/u,
    );
  });

  it('reports a successful round trip in a role=status region', () => {
    const html = panel({
      status: azure({ connectivity: 'ok' }),
      verification: { phase: 'success', at: '2026-01-01T00:00:09.000Z', latencyMs: 412 },
    });
    expect(html).toMatch(/<div class="provider-result" role="status">/u);
    expect(visibleText(html)).toContain(
      'Connection verified: one real round trip completed in 412 ms at',
    );
    expect(html).toContain('<time dateTime="2026-01-01T00:00:09.000Z">');
    expect(html).not.toContain('role="alert"');
  });

  it('shows the server message in an alert on failure and leaves the status region empty', () => {
    const html = panel({
      status: azure({ connectivity: 'failing' }),
      verification: {
        phase: 'error',
        at: '2026-01-01T00:00:09.000Z',
        message: 'The provider endpoint could not be reached. Request ID: req-5',
      },
    });
    expect(html).toMatch(/role="alert"/u);
    expect(html).toContain('Connection check failed');
    expect(visibleText(html)).toContain(
      'The provider endpoint could not be reached. Request ID: req-5',
    );
    expect(html).toContain('<div class="provider-result" role="status"></div>');
  });

  it('calls onVerify for a click and ignores the second click of a double click', () => {
    const onVerify = vi.fn();
    const element = ProviderPanel({
      state: state({ status: azure() }),
      open: true,
      onVerify,
      onRetry: vi.fn(),
      onClose: vi.fn(),
    });
    const verify = button(element, 'provider-verify-button');
    click(verify, 0);
    click(verify, 1);
    expect(onVerify).toHaveBeenCalledTimes(2);
    click(verify, 2);
    click(verify, 3);
    expect(onVerify).toHaveBeenCalledTimes(2);
  });

  it('ignores every click while a verification is pending', () => {
    const onVerify = vi.fn();
    const element = ProviderPanel({
      state: state({ status: azure(), verification: { phase: 'pending' } }),
      open: true,
      onVerify,
      onRetry: vi.fn(),
      onClose: vi.fn(),
    });
    click(button(element, 'provider-verify-button'), 1);
    expect(onVerify).not.toHaveBeenCalled();
  });
});

describe('provider status unavailable', () => {
  it('offers a retry and explains the failure without breaking the panel', () => {
    const onRetry = vi.fn();
    const element = ProviderPanel({
      state: state({ error: 'Cannot reach the local server. Check that the backend is running.' }),
      open: true,
      onVerify: vi.fn(),
      onRetry,
      onClose: vi.fn(),
    });
    const html = renderToStaticMarkup(element);
    expect(visibleText(html)).toContain('Provider status unavailable');
    expect(visibleText(html)).toContain('Cannot reach the local server.');
    expect(html).not.toContain('Reading provider status');
    click(button(element, 'button-small', 'Retry status'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps showing the last known details, labelled as stale', () => {
    const text = visibleText(
      panel({
        status: azure({ connectivity: 'ok' }),
        error: 'The request failed (503). Please retry.',
      }),
    );
    expect(text).toContain('Showing the last values read from the server');
    expect(text).toContain('Deployment / model swarm-dev-deployment');
    expect(text).toContain('Connectivity status unavailable');
  });

  it('shows a reading state before the first answer', () => {
    expect(visibleText(panel({}))).toContain('Reading provider status…');
  });
});

describe('no key, token or endpoint is ever rendered', () => {
  const states: [string, Partial<ProviderMonitorState>][] = [
    ['local', { status: localStatusFixture() }],
    ['azure with Entra', { status: azure({ connectivity: 'ok', counters: busyCounters }) }],
    [
      'openai with a key on the server',
      { status: azure({ provider: 'openai', model: 'gpt-4.1-mini', auth: 'api-key' }) },
    ],
    ['ollama', { status: azure({ provider: 'ollama', model: 'llama3.2', auth: 'none' }) }],
    [
      'a failing provider',
      {
        status: azure({
          connectivity: 'failing',
          lastError: {
            code: 'MODEL_AUTH',
            message: 'The provider rejected or could not obtain credentials.',
          },
        }),
        verification: {
          phase: 'error',
          at: '2026-01-01T00:00:00.000Z',
          message: 'The provider rejected or could not obtain credentials.',
        },
      },
    ],
    [
      'an unreachable server',
      { error: 'Cannot reach the local server. Check that the backend is running.' },
    ],
  ];

  it.each(states)(
    'renders nothing that looks like a credential or endpoint (%s)',
    (_name, patch) => {
      const text = visibleText(badge(patch, true) + panel(patch, true));
      expectNoSecretLikeText(text);
    },
  );

  it('renders only the documented fields, even if a server wrongly sent secrets', () => {
    const hostile = {
      ...azure({ connectivity: 'ok' }),
      endpoint: 'https://example-resource.openai.azure.com/',
      apiKey: 'canary-not-a-real-key-0123456789',
      token: 'eyJhbGciOiJSUzI1NiJ9.payload.signature',
      authorization: 'Bearer abcdef0123456789',
    } as ProviderStatus;
    const html = badge({ status: hostile }, true) + panel({ status: hostile }, true);
    for (const secret of [
      'example-resource',
      'openai.azure.com',
      'canary-not-a-real-key',
      'eyJhbGci',
      'Bearer',
      'authorization',
      'apiKey',
    ]) {
      expect(html).not.toContain(secret);
    }
  });
});
