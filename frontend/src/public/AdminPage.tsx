import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { errorMessage, isAbort } from '../api';
import { Button, EmptyState, Notice, Skeleton } from '../design/ui';
import type { AdminSwitches, AdminUsageView, PublicSession } from '../../../shared/public';
import { count } from '../lib/format';
import { formatUsd } from './format';
import { PageLink } from './PageLink';
import { publicApi } from './publicApi';
import { PublicFrame } from './PublicFrame';
import { useDocumentTitle } from './useDocumentTitle';

type Load =
  | { phase: 'loading' }
  | { phase: 'ready'; view: AdminUsageView }
  | { phase: 'failed'; message: string };

/** The platform administrator's numbers and switches. Plain tables; the server decides who may read them. */
function AdminBody() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [switches, setSwitches] = useState<AdminSwitches | null>(null);
  const [disabled, setDisabled] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ phase: 'loading' });
    publicApi.adminUsage(14, controller.signal).then(
      (view) => {
        setSwitches(view.switches);
        // What the server says, so that an account that was switched off earlier is shown as it is.
        setDisabled(Object.fromEntries(view.topUsers.map((user) => [user.id, user.disabled])));
        setLoad({ phase: 'ready', view });
      },
      (failure: unknown) => {
        if (!isAbort(failure)) setLoad({ phase: 'failed', message: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const act = useCallback(async (name: string, run: () => Promise<void>) => {
    setBusy(name);
    setProblem(null);
    try {
      await run();
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }, []);

  if (load.phase === 'loading') {
    return (
      <div className="sw-pub-status__wait" aria-busy="true" data-testid="admin-loading">
        <span className="sr-only" role="status">
          Reading the usage
        </span>
        <Skeleton height="2rem" width="40%" />
        <Skeleton height="1.2rem" width="80%" />
        <Skeleton height="1.2rem" width="70%" />
      </div>
    );
  }
  if (load.phase === 'failed' || !switches) {
    return (
      <Notice
        tone="error"
        title="The usage could not be read"
        action={
          <Button size="sm" variant="glass" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        }
      >
        {load.phase === 'failed' ? load.message : 'The server sent nothing to show.'}
      </Notice>
    );
  }

  const { view } = load;
  const freeTierOn = switches.freeTierEnv && switches.freeTierRuntime;
  return (
    <div className="sw-pub-admin" data-testid="admin-page">
      <h1 className="sw-title">Usage</h1>
      {problem && (
        <Notice tone="error" title="That was not done">
          {problem}
        </Notice>
      )}

      <section aria-labelledby="sw-admin-today" className="sw-pub-admin__block">
        <h2 id="sw-admin-today" className="sw-heading">
          Today, all free users together
        </h2>
        <dl className="sw-pub-status__list" data-testid="admin-today">
          <div className="sw-pub-status__row">
            <dt>Tokens</dt>
            <dd>
              {count(view.today.global.tokens)} of {count(view.today.limits.tokens)}
            </dd>
          </div>
          <div className="sw-pub-status__row">
            <dt>Estimated cost</dt>
            <dd>
              {formatUsd(view.today.global.costUsd)} of {formatUsd(view.today.limits.costUsd)}
            </dd>
          </div>
          <div className="sw-pub-status__row">
            <dt>Model calls</dt>
            <dd>{count(view.today.global.calls)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="sw-admin-switches" className="sw-pub-admin__block">
        <h2 id="sw-admin-switches" className="sw-heading">
          Switches
        </h2>
        <div
          className="sw-pub-admin__switch"
          data-testid="admin-free-tier-row"
          data-on={freeTierOn}
        >
          <div>
            <p className="sw-pub-admin__name">Free tier is {freeTierOn ? 'on' : 'off'}</p>
            {!switches.freeTierEnv && (
              <p className="sw-caption">
                It is switched off in the server settings. This page cannot turn it back on.
              </p>
            )}
          </div>
          <Button
            variant="glass"
            size="sm"
            data-testid="admin-free-tier"
            busy={busy === 'free-tier'}
            busyLabel="Saving"
            disabled={!switches.freeTierEnv}
            onClick={() =>
              void act('free-tier', async () =>
                setSwitches(await publicApi.setFreeTier(!switches.freeTierRuntime)),
              )
            }
          >
            {switches.freeTierRuntime ? 'Turn the free tier off' : 'Turn the free tier on'}
          </Button>
        </div>
        <div
          className="sw-pub-admin__switch"
          data-testid="admin-signups-row"
          data-on={switches.signups}
        >
          <div>
            <p className="sw-pub-admin__name">
              New accounts are {switches.signups ? 'open' : 'closed'}
            </p>
            <p className="sw-caption">People who already have an account can sign in either way.</p>
          </div>
          <Button
            variant="glass"
            size="sm"
            data-testid="admin-signups"
            busy={busy === 'signups'}
            busyLabel="Saving"
            onClick={() =>
              void act('signups', async () =>
                setSwitches(await publicApi.setSignups(!switches.signups)),
              )
            }
          >
            {switches.signups ? 'Close new accounts' : 'Open new accounts'}
          </Button>
        </div>
      </section>

      <section aria-labelledby="sw-admin-days" className="sw-pub-admin__block">
        <h2 id="sw-admin-days" className="sw-heading">
          Spend by day
        </h2>
        <div
          className="sw-pub-admin__scroll"
          tabIndex={0}
          role="region"
          aria-label="Spend by day, scrollable table"
        >
          <table className="sw-pub-table" data-testid="admin-days">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Calls</th>
                <th scope="col">Tokens</th>
                <th scope="col">Hidden reasoning</th>
                <th scope="col">Cost</th>
                <th scope="col">Blocked</th>
              </tr>
            </thead>
            <tbody>
              {view.days.map((day) => (
                <tr key={day.day}>
                  <th scope="row">{day.day}</th>
                  <td>{count(day.calls)}</td>
                  <td>{count(day.tokens)}</td>
                  <td>{count(day.reasoningTokens)}</td>
                  <td>{formatUsd(day.costUsd)}</td>
                  <td>{count(day.blocked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view.days.length === 0 && <p className="sw-caption">No days to show yet.</p>}
      </section>

      <section aria-labelledby="sw-admin-users" className="sw-pub-admin__block">
        <h2 id="sw-admin-users" className="sw-heading">
          Top accounts
        </h2>
        <div
          className="sw-pub-admin__scroll"
          tabIndex={0}
          role="region"
          aria-label="Top accounts, scrollable table"
        >
          <table className="sw-pub-table" data-testid="admin-users">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">E-mail</th>
                <th scope="col">Tokens</th>
                <th scope="col">Calls</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {view.topUsers.map((user) => (
                <tr key={user.id} data-disabled={disabled[user.id] || undefined}>
                  <th scope="row" className="sw-mono">
                    {user.id}
                  </th>
                  <td>{user.emailMasked}</td>
                  <td>{count(user.tokens)}</td>
                  <td>{count(user.calls)}</td>
                  <td>
                    {confirming === user.id ? (
                      <span className="sw-pub-admin__confirm">
                        <Button
                          size="sm"
                          variant="danger"
                          data-testid={`admin-disable-confirm-${user.id}`}
                          busy={busy === `user-${user.id}`}
                          busyLabel="Saving"
                          onClick={() =>
                            void act(`user-${user.id}`, async () => {
                              await publicApi.disableUser(user.id, true);
                              setDisabled((old) => ({ ...old, [user.id]: true }));
                              setConfirming(null);
                            })
                          }
                        >
                          Yes, disable
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : disabled[user.id] ? (
                      <span className="sw-pub-admin__confirm">
                        <span>Disabled</span>
                        <Button
                          size="sm"
                          variant="glass"
                          data-testid={`admin-enable-${user.id}`}
                          busy={busy === `user-${user.id}`}
                          busyLabel="Saving"
                          onClick={() =>
                            void act(`user-${user.id}`, async () => {
                              await publicApi.disableUser(user.id, false);
                              setDisabled((old) => ({ ...old, [user.id]: false }));
                            })
                          }
                        >
                          Enable again
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="glass"
                        data-testid={`admin-disable-${user.id}`}
                        onClick={() => setConfirming(user.id)}
                      >
                        Disable
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view.topUsers.length === 0 && (
          <p className="sw-caption">No accounts have used the free tier yet.</p>
        )}
      </section>

      <section aria-labelledby="sw-admin-blocked" className="sw-pub-admin__block">
        <h2 id="sw-admin-blocked" className="sw-heading">
          Blocked requests
        </h2>
        <table className="sw-pub-table" data-testid="admin-blocked">
          <thead>
            <tr>
              <th scope="col">Reason</th>
              <th scope="col">Requests</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(view.blocked.byReason).map(([reason, total]) => (
              <tr key={reason}>
                <th scope="row">{reason}</th>
                <td>{count(total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(view.blocked.byReason).length === 0 && (
          <p className="sw-caption">Nothing has been blocked.</p>
        )}
      </section>
    </div>
  );
}

/** `/admin`: for a platform administrator only. Anyone else is told so, and the server refuses the data anyway. */
export function AdminPage({ session }: { session: PublicSession }) {
  useDocumentTitle('Usage | Swarm');
  const allowed = session.signedIn && session.user?.isAdmin === true;
  return (
    <PublicFrame
      session={session}
      wide
      action={
        <PageLink to="/" className="sw-btn sw-btn--ghost sw-btn--sm">
          <span className="sw-btn__label">Back to Swarm</span>
        </PageLink>
      }
    >
      {allowed ? (
        <AdminBody />
      ) : (
        <div data-testid="admin-denied">
          <EmptyState
            level={1}
            icon={<ShieldAlert size={22} aria-hidden="true" />}
            title="This page is for the site's administrators"
          >
            {session.signedIn
              ? 'Your account is not one of them.'
              : 'Sign in with an administrator account to see it.'}
          </EmptyState>
        </div>
      )}
    </PublicFrame>
  );
}
