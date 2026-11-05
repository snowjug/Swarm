import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BudgetView } from '../../../shared/budget';
import type {
  AuditEntry,
  CheckStage,
  CheckState,
  ProjectSummary,
  ProviderCheck,
} from '../../../shared/types';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { MotionRoot } from '../design/motion';
import { TooltipProvider } from '../design/ui';
import { INITIAL_PROVIDER_STATE } from '../hooks/useProviderStatus';
import type { AuditState } from '../hooks/useAudit';
import type { BudgetState } from '../hooks/useBudget';
import type { MembersState } from '../hooks/useMembers';
import type { ProjectRole } from '../lib/members';
import {
  checkFixture,
  expectNoSecretLikeText,
  localStatusFixture,
  realStatusFixture,
  visibleText,
} from '../test/provider';
import { AccessBody } from './AccessDialog';
import { AuditBody } from './AuditSheet';
import { BudgetPanel } from './BudgetDialog';
import { HistoryBody } from './HistorySheet';
import { ProviderPanelBody } from './ProviderStatus';
import { SignInProblem } from './SignInProblem';
import { projectScheme } from './accessView';

const render = (node: ReactNode): string =>
  renderToStaticMarkup(
    <MotionRoot>
      <TooltipProvider>{node}</TooltipProvider>
    </MotionRoot>,
  );
const words = (node: ReactNode): string => visibleText(render(node));
const noop = () => undefined;

const NOW = new Date(2026, 10, 15, 14, 30);

const project = (patch: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p-1',
  name: 'Copilot in Teams',
  workflow: 'guided',
  question: 'What could happen if the assistant is on by default?',
  status: 'completed',
  stage: 'report',
  progress: 100,
  mode: 'local',
  agentCount: 4,
  roundCount: 8,
  currentRound: 8,
  createdAt: new Date(2026, 10, 15, 9, 0).toISOString(),
  updatedAt: new Date(2026, 10, 15, 9, 30).toISOString(),
  error: null,
  parentId: null,
  ...patch,
});

const history = (patch: Partial<Parameters<typeof HistoryBody>[0]> = {}) => (
  <HistoryBody
    projects={[]}
    total={0}
    loading={false}
    error={null}
    selectedId={null}
    busy={false}
    whatIf
    onSelect={noop}
    onCompare={noop}
    onRefresh={noop}
    onDelete={noop}
    now={NOW}
    {...patch}
  />
);

describe('the history sheet', () => {
  it('lists explorations under their day, in words and not in codes', () => {
    const markup = words(
      history({
        projects: [
          project({ id: 'a', name: 'Copilot in Teams' }),
          project({
            id: 'b',
            name: 'Launch pricing',
            status: 'running',
            progress: 42,
            updatedAt: new Date(2026, 10, 14, 10).toISOString(),
          }),
        ],
        total: 2,
        selectedId: 'a',
      }),
    );
    for (const text of [
      'Today',
      'Yesterday',
      'Copilot in Teams',
      'Launch pricing',
      'Running 42%',
      'Complete',
      '2 explorations',
      'Local rules',
    ]) {
      expect(markup).toContain(text);
    }
  });

  it('offers to compare only where the server can, and never to delete what is running', () => {
    const list = [project({ id: 'a' }), project({ id: 'b', name: 'Busy', status: 'running' })];
    const on = render(history({ projects: list, total: 2 }));
    const off = render(history({ projects: list, total: 2, whatIf: false }));
    expect(on).toContain('aria-label="Compare Copilot in Teams"');
    expect(off).not.toContain('aria-label="Compare');
    expect(
      /aria-label="Delete Busy"[^>]*disabled/u.test(on) ||
        /disabled[^>]*aria-label="Delete Busy"/u.test(on),
    ).toBe(true);
    expect(/aria-label="Delete Copilot in Teams"[^>]*disabled/u.test(on)).toBe(false);
  });

  it('says what it cannot show: nothing yet, a failed read with a way to try again, a long wait', () => {
    expect(words(history())).toContain('Nothing yet');
    const failed = words(history({ error: 'The server did not answer.' }));
    expect(failed).toContain('The list could not be read');
    expect(failed).toContain('The server did not answer.');
    expect(failed).toContain('Retry');
    const loading = render(history({ loading: true }));
    expect(loading).toContain('sw-hist__skeleton');
    expect(loading).not.toContain('Nothing yet');
  });

  it('tells a person who is shown a part of a larger list so', () => {
    expect(words(history({ projects: [project()], total: 150 }))).toContain(
      'Showing 1 of 150 explorations',
    );
  });
});

const entry = (seq: number, action: string, patch: Partial<AuditEntry> = {}): AuditEntry => ({
  seq,
  at: new Date(2026, 10, 15, 9, seq).toISOString(),
  actor: 'alice',
  action,
  targetType: 'project',
  targetId: 'p-1',
  projectId: 'p-1',
  detail: {},
  prevHash: 'a',
  hash: 'b',
  ...patch,
});

const audit = (patch: Partial<AuditState> = {}): AuditState => ({
  entries: [],
  loading: false,
  error: null,
  reload: noop,
  verification: { state: 'idle' },
  verify: noop,
  ...patch,
});

describe('the audit log', () => {
  it('shows the newest first with plain titles, and the action code only as a tooltip', () => {
    const markup = render(
      <AuditBody
        state={audit({
          entries: [
            entry(1, 'project.created'),
            entry(2, 'project.budget.updated', { detail: { callLimit: 40 } }),
          ],
        })}
        now={NOW}
      />,
    );
    expect(markup.indexOf('#2')).toBeLessThan(markup.indexOf('#1'));
    expect(markup).toContain('title="project.budget.updated"');
    expect(visibleText(markup)).not.toContain('project.budget.updated');
    expect(visibleText(markup)).toContain('call limit');
  });

  it('says whether the chain was checked, and where it broke', () => {
    const entries = [
      entry(1, 'project.created'),
      entry(2, 'project.updated'),
      entry(3, 'project.updated'),
    ];
    const verified = words(
      <AuditBody
        state={audit({
          entries,
          verification: { state: 'done', result: { ok: true, checked: 3, brokenAt: null } },
        })}
        now={NOW}
      />,
    );
    expect(verified).toMatch(/intact|verified|matches/iu);
    const broken = words(
      <AuditBody
        state={audit({
          entries,
          verification: { state: 'done', result: { ok: false, checked: 3, brokenAt: 2 } },
        })}
        now={NOW}
      />,
    );
    expect(broken).toMatch(/#2/u);
    const failed = words(
      <AuditBody
        state={audit({ entries, verification: { state: 'failed', error: 'No answer.' } })}
        now={NOW}
      />,
    );
    expect(failed).toContain('Integrity could not be checked');
  });

  it('has a word for an empty log, an unreadable one and a long wait', () => {
    expect(words(<AuditBody state={audit()} now={NOW} />)).toContain('No recorded actions yet');
    expect(
      words(<AuditBody state={audit({ entries: null, error: 'Down.' })} now={NOW} />),
    ).toContain('The audit log could not be read');
    expect(
      render(<AuditBody state={audit({ entries: null, loading: true })} now={NOW} />),
    ).toContain('sw-audit__skeleton');
  });
});

const view = (patch: Partial<BudgetView> = {}): BudgetView => ({
  calls: 4,
  inputTokens: 1_000,
  outputTokens: 200,
  callLimit: 5,
  tokenLimit: 0,
  own: { callLimit: null, tokenLimit: null },
  defaults: { callLimit: 5, tokenLimit: 0 },
  state: 'warning',
  may: { edit: true },
  ...patch,
});

const budget = (patch: Partial<BudgetState> = {}): BudgetState => ({
  budget: view(),
  loading: false,
  error: null,
  saving: false,
  saveError: null,
  saved: false,
  reload: noop,
  save: () => Promise.resolve(true),
  ...patch,
});

describe('the model budget', () => {
  it('shows the use against the limit, with the state in words as well as colour', () => {
    const markup = words(<BudgetPanel state={budget()} onClose={noop} />);
    expect(markup).toContain('Running low');
    expect(markup).toMatch(/4 of 5/u);
  });

  it('gives the means to change the limits only to those who may', () => {
    const editable = render(<BudgetPanel state={budget()} onClose={noop} />);
    const readonly = render(
      <BudgetPanel state={budget({ budget: view({ may: { edit: false } }) })} onClose={noop} />,
    );
    expect(editable).toMatch(/type="submit"/u);
    expect(readonly).not.toMatch(/type="submit"/u);
    expect(visibleText(readonly)).toMatch(/owner|administrator/iu);
  });

  it('says when it is out, cannot be read, or has nothing to show yet', () => {
    expect(
      words(
        <BudgetPanel
          state={budget({ budget: view({ state: 'exhausted', calls: 5 }) })}
          onClose={noop}
        />,
      ),
    ).toContain('Used up');
    const failed = words(
      <BudgetPanel state={budget({ budget: null, error: 'No answer.' })} onClose={noop} />,
    );
    expect(failed).toContain('The model budget could not be read');
    expect(failed).toContain('Retry');
    expect(
      render(<BudgetPanel state={budget({ budget: null, loading: true })} onClose={noop} />),
    ).toContain('aria-busy');
  });
});

const people = (patch: Partial<MembersState<ProjectRole>> = {}): MembersState<ProjectRole> => ({
  members: [
    {
      principalId: '1c7ffa13-0b1d-4ec6-b1c1-8cf7f1b8b78e',
      role: 'lead',
      addedBy: 'owner',
      addedAt: new Date(2026, 10, 10).toISOString(),
    },
    {
      principalId: 'bob@example.com',
      role: 'viewer',
      addedBy: 'owner',
      addedAt: new Date(2026, 10, 11).toISOString(),
    },
  ],
  mayManage: true,
  loading: false,
  error: null,
  result: null,
  working: null,
  reload: noop,
  add: () => Promise.resolve(true),
  change: () => Promise.resolve(true),
  remove: () => Promise.resolve(true),
  ...patch,
});

describe('who has access', () => {
  it('lists people with their roles, shortening only opaque identifiers', () => {
    const markup = words(<AccessBody state={people()} scheme={projectScheme} />);
    expect(markup).toContain('1c7ffa13…');
    expect(markup).toContain('bob@example.com');
    expect(markup).toContain('What the roles mean');
  });

  it('offers to add and remove only to those who may manage', () => {
    const mayManage = render(<AccessBody state={people()} scheme={projectScheme} />);
    const readOnly = render(
      <AccessBody state={people({ mayManage: false })} scheme={projectScheme} />,
    );
    expect(mayManage).toMatch(/Remove/u);
    expect(readOnly).not.toMatch(/Remove/u);
    expect(visibleText(readOnly)).toContain('Only a project lead');
    // The form that adds someone is for those who may add, and is not drawn for the rest.
    expect(visibleText(mayManage)).toContain('Add a person');
    expect(visibleText(readOnly)).not.toContain('Add a person');
  });

  it('says an empty list is empty, and an unreadable one is unreadable', () => {
    expect(words(<AccessBody state={people({ members: [] })} scheme={projectScheme} />)).toContain(
      'Nobody has been added to this project by name.',
    );
    expect(
      words(
        <AccessBody
          state={people({ members: null, error: 'No answer.' })}
          scheme={projectScheme}
        />,
      ),
    ).toContain('The list could not be read');
  });
});

describe('the provider popover', () => {
  const body = (status = localStatusFixture(), error: string | null = null) =>
    words(
      <ProviderPanelBody
        state={{ ...INITIAL_PROVIDER_STATE, status, error }}
        onVerify={noop}
        onRetry={noop}
      />,
    );

  it('says plainly that rules call no model, and offers nothing to verify', () => {
    const text = body();
    expect(text).toContain('No model in use');
    expect(text).toMatch(/Nothing to verify/u);
    expect(
      render(
        <ProviderPanelBody
          state={{ ...INITIAL_PROVIDER_STATE, status: localStatusFixture() }}
          onVerify={noop}
          onRetry={noop}
        />,
      ),
    ).not.toMatch(/>\s*Verify/u);
  });

  it('names a real model and its deployment without showing anything that looks like a secret', () => {
    const text = body(realStatusFixture());
    expect(text).toMatch(/Azure|OpenAI|model/iu);
    expectNoSecretLikeText(text);
  });

  it('says when the status could not be read', () => {
    expect(body(realStatusFixture(), 'The server did not answer.')).toContain('Status unavailable');
  });

  describe('what a connection check found', () => {
    const stage = (state: CheckState, detail: string | null = null): CheckStage => ({
      state,
      detail,
    });
    const after = (check: ProviderCheck, status = realStatusFixture()) =>
      words(
        <ProviderPanelBody
          state={{
            ...INITIAL_PROVIDER_STATE,
            status: { ...status, check },
            verification: { phase: 'checked', at: check.checkedAt, latencyMs: 140, check },
          }}
          onVerify={noop}
          onRetry={noop}
        />,
      );

    it('says all four things, apart, when it passed', () => {
      const text = after(checkFixture(), realStatusFixture({ connectivity: 'ok' }));
      expect(text).toContain('Connection verified');
      for (const label of ['Reachable', 'Authenticated', 'Deployment found', 'Structured output']) {
        expect(text).toContain(`${label} confirmed`);
      }
      expect(text).toContain('strict JSON schema');
      expect(text).not.toContain('Connection check failed');
    });

    it('does not call a working connection a failed check: it says what failed, which is the structured output', () => {
      const cut = checkFixture({
        structuredOutput: stage(
          'failed',
          'a tiny request was cut off at its limit, asked again once',
        ),
        code: 'MODEL_TRUNCATED',
      });
      const text = after(cut, realStatusFixture({ connectivity: 'ok' }));
      // The chip's heading and the check agree: connected, and structured output is what is not working.
      expect(text).toContain('Connected');
      expect(text).toContain('Connected, but structured output is not working');
      expect(text).toContain('Structured output failed');
      expect(text).toContain('Reachable confirmed');
      expect(text).toContain('Authenticated confirmed');
      expect(text).toContain('Deployment found confirmed');
      expect(text).toContain('cut off at its limit');
      expect(text).not.toContain('Connection check failed');
      expect(text).not.toContain('Connection verified');
    });

    it('says a connection that failed failed, with the thing that did and what was not checked after it', () => {
      const rejected = checkFixture({
        authenticated: stage('failed', 'The provider rejected the API key.'),
        deploymentFound: stage(
          'unknown',
          'not checked: the provider did not accept the credentials',
        ),
        structuredOutput: stage(
          'unknown',
          'not checked: the provider did not accept the credentials',
        ),
        code: 'MODEL_AUTH',
      });
      const text = after(rejected, realStatusFixture({ connectivity: 'failing' }));
      expect(text).toContain('Connection check failed');
      expect(text).toContain('Authenticated failed');
      expect(text).toContain('The provider rejected the API key');
      expect(text).toContain('Reachable confirmed');
      expect(text).toContain('Deployment found not confirmed');
      expect(text).toContain('Structured output not confirmed');
      expect(text).not.toContain('Connection verified');
    });

    it('names each deployment when there are several, and shows the last check again after a reload', () => {
      const first = checkFixture();
      const check: ProviderCheck = {
        ...first,
        deployments: [
          ...first.deployments,
          { ...first.deployments[0]!, deployment: 'critic-deployment' },
        ],
      };
      const text = words(
        <ProviderPanelBody
          state={{
            ...INITIAL_PROVIDER_STATE,
            status: realStatusFixture({ connectivity: 'ok', check }),
          }}
          onVerify={noop}
          onRetry={noop}
        />,
      );
      expect(text).toContain('swarm-dev-deployment');
      expect(text).toContain('critic-deployment');
      expect(text).toContain('Connection verified');
    });

    it('says a check that could not be made is that, and not a failed connection', () => {
      const text = words(
        <ProviderPanelBody
          state={{
            ...INITIAL_PROVIDER_STATE,
            status: realStatusFixture(),
            verification: {
              phase: 'error',
              at: '2026-01-01T00:00:10.000Z',
              message: 'No model is configured.',
            },
          }}
          onVerify={noop}
          onRetry={noop}
        />,
      );
      expect(text).toContain('The connection check could not be made');
      expect(text).toContain('No model is configured.');
      expect(text).not.toContain('Connection check failed');
    });

    it('keeps saying one real round trip completed for a server that sent no check', () => {
      const text = words(
        <ProviderPanelBody
          state={{
            ...INITIAL_PROVIDER_STATE,
            status: realStatusFixture({ connectivity: 'ok' }),
            verification: {
              phase: 'checked',
              at: '2026-01-01T00:00:10.000Z',
              latencyMs: 90,
              check: null,
            },
          }}
          onVerify={noop}
          onRetry={noop}
        />,
      );
      expect(text).toContain('Connection verified: one real round trip completed in 90 ms');
    });

    it('counts a reply that was cut off, and one that was not accepted, apart from failures', () => {
      const status = realStatusFixture({
        connectivity: 'ok',
        counters: {
          ...realStatusFixture().counters,
          failures: 5,
          truncated: 3,
          schemaInvalid: 2,
          tokensReported: true,
          reasoningTokens: 7_400,
        },
      });
      const text = body(status);
      expect(text).toContain('Cut off at the output limit 3');
      expect(text).toContain('Whole replies not accepted 2');
      expect(text).toContain('Hidden reasoning tokens 7,400');
    });
  });
});

describe('the sign-in problem screen', () => {
  it('says what happened and offers one way forward, with exactly one page heading', () => {
    for (const kind of ['failed', 'norole'] as const) {
      const markup = render(<SignInProblem kind={kind} />);
      expect(markup.match(/<h1[ >]/gu)).toHaveLength(1);
      expect(markup).toContain('role="alert"');
      expect(markup.match(/<a[ >]/gu)).toHaveLength(1);
      expect(markup).toContain('href="/auth/login"');
      expect(markup).toContain('Sign in with Microsoft');
      // The only way forward is the server's own sign-in address, with no return address to leak or loop.
      expect(markup).not.toContain('returnTo');
    }
    expect(words(<SignInProblem kind="norole" />)).toContain(
      'You are signed in, but have no Swarm role',
    );
    expect(words(<SignInProblem kind="failed" />)).toContain('Sign-in did not complete');
  });
});

describe('the error boundary', () => {
  const failed = (error: unknown): string => {
    const boundary = new ErrorBoundary({ children: <p>the application</p> });
    boundary.state = ErrorBoundary.getDerivedStateFromError(error);
    return renderToStaticMarkup(<>{boundary.render()}</>);
  };

  it('passes what it wraps through until something fails', () => {
    const boundary = new ErrorBoundary({ children: <p>the application</p> });
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe('<p>the application</p>');
  });

  it('stands alone when it fails: one heading, a way to reload, a way home, and what was said', () => {
    const markup = failed(new Error('Cannot read properties of undefined'));
    expect(markup).not.toContain('the application');
    expect(markup.match(/<h1[ >]/gu)).toHaveLength(1);
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('Reload');
    expect(markup).toContain('href="/"');
    expect(markup).toContain('Cannot read properties of undefined');
  });

  it('copes with something thrown that is not an error, and with an error that said nothing', () => {
    expect(failed('just a string')).toContain('just a string');
    expect(failed(new Error(''))).not.toContain('<details');
  });
});
