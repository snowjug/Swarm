import { useCallback, useEffect, useState } from 'react';
import type {
  PublicAccountProvider,
  PublicProviderId,
  PublicSession,
} from '../../../shared/public';
import { guestHours } from './guest';
import { fetchSession } from './publicApi';
import { sitePath, PAGE_PATHS } from './pages';
import { isFreeTierReason, type NoteKind } from './problems';
import { onPublicSignal } from './runtime';
import { takeNote } from './tabState';

/** Where the gate stands: reading the session, or one of the four things the answer can be. */
export type Gate =
  | { phase: 'loading' }
  | { phase: 'ready'; session: PublicSession; note: NoteKind | null }
  | { phase: 'maintenance' }
  | { phase: 'unreachable' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads the answer of `/api/public/session` into the shape the page uses, or null when it is not that answer (a page
 * from a proxy, or a server of the other edition). A field that is missing takes the value that hides nothing: no
 * guest mode, and the default number of hours a guest's data is kept.
 */
export function parseSession(raw: unknown): PublicSession | null {
  if (!isRecord(raw) || raw.edition !== 'public' || typeof raw.signedIn !== 'boolean') return null;
  const providers = (Array.isArray(raw.providers) ? raw.providers : []).flatMap((item: unknown) =>
    isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string'
      ? [{ id: item.id as PublicProviderId, label: item.label }]
      : [],
  );
  const bot =
    isRecord(raw.bot) && raw.bot.kind === 'turnstile' && typeof raw.bot.siteKey === 'string'
      ? ({ kind: 'turnstile', siteKey: raw.bot.siteKey } as const)
      : null;
  const free = isRecord(raw.freeTier) ? raw.freeTier : {};
  const legal = isRecord(raw.legal) ? raw.legal : {};
  const user =
    raw.signedIn && isRecord(raw.user)
      ? {
          emailMasked: String(raw.user.emailMasked ?? ''),
          provider: String(raw.user.provider ?? '') as PublicAccountProvider,
          guest: raw.user.guest === true || raw.user.provider === 'guest',
          isAdmin: raw.user.isAdmin === true,
          createdAt: String(raw.user.createdAt ?? ''),
        }
      : null;
  const lifetime = raw.signedIn && isRecord(raw.session) ? raw.session : null;
  return {
    edition: 'public',
    signedIn: raw.signedIn,
    providers,
    signupsOpen: raw.signupsOpen !== false,
    guestMode: raw.guestMode === true,
    guestRetentionHours: guestHours(raw.guestRetentionHours),
    bot,
    freeTier: {
      available: free.available !== false,
      reason: isFreeTierReason(free.reason) ? free.reason : null,
    },
    byokEnabled: raw.byokEnabled !== false,
    // The days the counter of a deleted account is kept for; the default until the server says, so that nothing is hidden.
    retentionDays:
      typeof raw.retentionDays === 'number' &&
      Number.isInteger(raw.retentionDays) &&
      raw.retentionDays >= 0 &&
      raw.retentionDays <= 365
        ? raw.retentionDays
        : 30,
    legal: {
      terms: sitePath(legal.terms, PAGE_PATHS.terms),
      privacy: sitePath(legal.privacy, PAGE_PATHS.privacy),
    },
    user,
    session: lifetime
      ? {
          idleExpiresAt: String(lifetime.idleExpiresAt ?? ''),
          expiresAt: String(lifetime.expiresAt ?? ''),
        }
      : null,
  };
}

/**
 * Asks the server once who the visitor is. Nothing else in the public edition is asked before this answer is in, and it
 * is a plain request: a visitor who is not signed in is an answer to read, not a failure.
 */
export function useGateSession(): {
  gate: Gate;
  retry: () => void;
  startedAsGuest: () => Promise<boolean>;
} {
  const [gate, setGate] = useState<Gate>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setGate((old) => (old.phase === 'ready' ? old : { phase: 'loading' }));
    void fetchSession().then((reply) => {
      if (cancelled) return;
      if (!reply.ok) {
        setGate({ phase: reply.status === 503 ? 'maintenance' : 'unreachable' });
        return;
      }
      const session = parseSession(reply.data);
      setGate(
        session
          ? { phase: 'ready', session, note: session.signedIn ? null : takeNote() }
          : { phase: 'unreachable' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The API client says the person is no longer signed in: the gate goes back to the landing page.
  useEffect(
    () =>
      onPublicSignal((signal) => {
        if (signal.kind !== 'signed-out') return;
        setGate((old) =>
          old.phase === 'ready'
            ? {
                phase: 'ready',
                session: { ...old.session, signedIn: false, user: null, session: null },
                note: signal.reason,
              }
            : old,
        );
      }),
    [],
  );

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  /**
   * The visitor has just started a guest session: reads the session again, so that the gate shows the application.
   * False when the server answers and says nobody is signed in (the browser did not keep the cookie). An answer that
   * cannot be read at all is left to the gate's own screens, which can ask again.
   */
  const startedAsGuest = useCallback(async (): Promise<boolean> => {
    const reply = await fetchSession();
    const session = reply.ok ? parseSession(reply.data) : null;
    if (session?.signedIn) {
      setGate({ phase: 'ready', session, note: null });
      return true;
    }
    if (session) return false;
    setAttempt((count) => count + 1);
    return true;
  }, []);

  return { gate, retry, startedAsGuest };
}
