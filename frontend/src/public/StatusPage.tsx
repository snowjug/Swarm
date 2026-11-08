import { useEffect, useState } from 'react';
import { CircleCheck, TriangleAlert, WifiOff, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Notice, Skeleton } from '../design/ui';
import type { PublicHealth, PublicSession, PublicStatus } from '../../../shared/public';
import { formatLocal } from './format';
import { guestModeOf } from './guest';
import { FREE_TIER_WORDS, SERVICE_UNREACHABLE } from './problems';
import { fetchStatus } from './publicApi';
import { PublicFrame } from './PublicFrame';
import { useDocumentTitle } from './useDocumentTitle';

const HEALTH: Record<PublicHealth, { words: string; Icon: LucideIcon }> = {
  ok: { words: 'Everything is working.', Icon: CircleCheck },
  degraded: { words: 'Some things are limited right now.', Icon: TriangleAlert },
  maintenance: { words: 'Swarm is down for maintenance.', Icon: Wrench },
};

type State = { phase: 'loading' } | { phase: 'ready'; status: PublicStatus } | { phase: 'failed' };

/** Whether the service is up, what is limited, and when the free runs come back, for anyone to read. */
export function StatusPage({ session }: { session: PublicSession | null }) {
  useDocumentTitle('Status | Swarm');
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    void fetchStatus().then((reply) => {
      if (cancelled) return;
      setState(
        reply.ok && reply.data && typeof reply.data === 'object' && 'status' in reply.data
          ? { phase: 'ready', status: reply.data }
          : { phase: 'failed' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const status = state.phase === 'ready' ? state.status : null;
  const health = status ? (HEALTH[status.status] ?? HEALTH.degraded) : null;
  return (
    <PublicFrame session={session}>
      <section
        className="sw-pub-status"
        data-testid="status-page"
        data-status={status ? status.status : state.phase === 'failed' ? 'unreachable' : 'loading'}
      >
        <h1 className="sw-title">Service status</h1>
        {state.phase === 'loading' && (
          <div className="sw-pub-status__wait" aria-busy="true">
            <span className="sr-only" role="status">
              Reading the status
            </span>
            <Skeleton height="2rem" width="60%" />
            <Skeleton height="1.2rem" width="80%" />
            <Skeleton height="1.2rem" width="70%" />
          </div>
        )}
        {state.phase === 'failed' && (
          <div className="sw-pub-status__headline" data-health="unreachable">
            <WifiOff size={22} aria-hidden="true" />
            <div>
              <p className="sw-pub-status__word" role="alert">
                {SERVICE_UNREACHABLE}
              </p>
              <p className="sw-caption">Check your connection, then try again.</p>
              <Button size="sm" variant="glass" onClick={() => setAttempt((count) => count + 1)}>
                Try again
              </Button>
            </div>
          </div>
        )}
        {status && health && (
          <>
            <div className="sw-pub-status__headline" data-health={status.status}>
              <health.Icon size={22} aria-hidden="true" />
              <p className="sw-pub-status__word">{health.words}</p>
            </div>
            {status.message && (
              <Notice tone="info" title="A note from the site owner">
                {status.message}
              </Notice>
            )}
            <dl className="sw-pub-status__list">
              <div className="sw-pub-status__row" data-testid="status-free-tier">
                <dt>Free tier</dt>
                <dd>
                  {status.freeTier.available
                    ? 'Available'
                    : status.freeTier.reason
                      ? FREE_TIER_WORDS[status.freeTier.reason].title
                      : 'Not available right now'}
                </dd>
              </div>
              <div className="sw-pub-status__row" data-testid="status-resets">
                <dt>Free runs reset</dt>
                <dd>
                  <time dateTime={status.freeTier.resetsAt}>
                    {formatLocal(status.freeTier.resetsAt)}
                  </time>
                  <span className="sw-caption"> in your local time</span>
                </dd>
              </div>
              <div className="sw-pub-status__row" data-testid="status-byok">
                <dt>Your own Google key</dt>
                <dd>{status.byokEnabled ? 'Available' : 'Switched off right now'}</dd>
              </div>
              <div className="sw-pub-status__row" data-testid="status-signups">
                <dt>{guestModeOf(session) ? 'New visitors' : 'New accounts'}</dt>
                <dd>{status.signupsOpen ? 'Open' : 'Closed for now'}</dd>
              </div>
              <div className="sw-pub-status__row">
                <dt>Last checked</dt>
                <dd>
                  <time dateTime={status.checkedAt}>{formatLocal(status.checkedAt)}</time>
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>
    </PublicFrame>
  );
}
