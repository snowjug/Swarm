import type { PublicSession } from '../../../shared/public';
import { NETWORK_WORDS, NOTE_WORDS, problemOf, type NoteKind } from './problems';

/**
 * What the public edition says and decides about guests: visitors who start with one press and no sign-in. Only the
 * public page reaches this module. The pilot's own modules do not import it.
 */

/** How long a guest's data is kept without use, until the server says otherwise. */
export const DEFAULT_GUEST_HOURS = 24;

const MAX_GUEST_HOURS = 24 * 365;

/** Whether a visitor can start without signing in. A field the server leaves out is no guest mode: nothing new shows. */
export function guestModeOf(session: Partial<Pick<PublicSession, 'guestMode'>> | null): boolean {
  return session?.guestMode === true;
}

/** The hours without use after which a guest's data is deleted: what the server says, or the default if it says nothing sensible. */
export function guestHours(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_GUEST_HOURS
    ? value
    : DEFAULT_GUEST_HOURS;
}

/** "24 hours", "1 hour". */
export const hoursPhrase = (hours: number): string => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

/** Under the button that starts a guest session: what "temporary" means. */
export const guestNoteWords = (hours: number): string =>
  `Guest data is temporary: it is deleted after ${hoursPhrase(hours)} without use, and you can delete it yourself at any time.`;

/** In the guest's account panel and menu. */
export const guestReminderWords = (hours: number): string =>
  `Your data is temporary (deleted after ${hoursPhrase(hours)} without use).`;

const SESSION_ENDED = 'Your session ended. Press Try it now to start again.';
const SESSION_ENDED_OR_SIGN_IN =
  'Your session ended. Press Try it now to start again, or sign in again if you have an account.';

/**
 * The line the landing page shows for a note. On a site that lets visitors in as guests, an ended session does not ask
 * for a sign-in that a guest never made.
 */
export function noteWords(
  kind: NoteKind,
  site: Pick<PublicSession, 'providers'> & Partial<Pick<PublicSession, 'guestMode'>>,
): string {
  if (kind === 'expired' && guestModeOf(site)) {
    return site.providers.length > 0 ? SESSION_ENDED_OR_SIGN_IN : SESSION_ENDED;
  }
  return NOTE_WORDS[kind];
}

/** What went wrong with the request that starts a guest session, in words. The server's own message is never shown. */
export function guestFailure(reply: {
  status: number;
  code: string | null;
  network: boolean;
}): string {
  if (reply.network) return NETWORK_WORDS;
  if (reply.code === 'BOT_CHECK_FAILED') return problemOf('BOT_CHECK_FAILED')!.message;
  if (reply.code === 'NOT_AVAILABLE') {
    return 'Guest access is not available right now. Please try again later.';
  }
  if (reply.code === 'RATE_LIMITED' || reply.status === 429) {
    return 'Too many people have started from your network lately. Wait a few minutes, then try again.';
  }
  if (reply.status === 503) return 'The service is down for maintenance. Try again later.';
  return 'We could not start your session. Please try again.';
}
