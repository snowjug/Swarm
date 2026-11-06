import {
  freeTierReasonOf,
  PUBLIC_SIGN_IN_PROBLEMS,
  type FreeTierReason,
  type PublicErrorCode,
  type PublicSignInProblem,
} from '../../../shared/public';

/**
 * Every word the public edition says about a limit, a refusal or a sign-in that did not work. The page decides what to
 * show from an error's code and never from the server's message, and each code has one calm sentence and one next step.
 */

export const SERVICE_UNREACHABLE = "We can't reach the service right now.";
export const NETWORK_WORDS = `${SERVICE_UNREACHABLE} Check your connection, then try again.`;

/** What a next step does. The page owns what each one opens. */
export type ProblemAction =
  | { kind: 'byok'; label: string }
  | { kind: 'recheck'; label: string }
  | { kind: 'dismiss'; label: string };

export interface Problem {
  code: PublicErrorCode;
  /** The word the page puts in `data-reason`: the free-tier reason, or the code in lower case with hyphens. */
  reason: string;
  title: string;
  message: string;
  action: ProblemAction;
}

export interface FreeTierWords {
  /** For the chip in the bar. */
  short: string;
  title: string;
  message: string;
}

export const FREE_TIER_WORDS: Record<FreeTierReason, FreeTierWords> = {
  'user-cap': {
    short: 'No free runs left today',
    title: 'No free runs left today',
    message:
      "You have used today's free runs. They come back at 00:00 UTC, or use your own key now.",
  },
  'global-cap': {
    short: 'Free tier used up for today',
    title: 'The free tier is used up for today',
    message: 'The free tier is used up for today. Bring your own key, or come back tomorrow.',
  },
  'lifetime-cap': {
    short: 'Free allowance used up',
    title: 'Your free allowance is used up',
    message: 'You have used the free allowance for this account. Bring your own key to keep going.',
  },
  disabled: {
    short: 'Free tier is switched off',
    title: 'The free tier is switched off',
    message: 'The free tier is switched off right now. You can still use your own key.',
  },
  concurrent: {
    short: 'A run is in progress',
    title: 'A run is already in progress',
    message: 'A run is already in progress. It will finish soon.',
  },
};

export function isFreeTierReason(value: unknown): value is FreeTierReason {
  return typeof value === 'string' && Object.hasOwn(FREE_TIER_WORDS, value);
}

export function freeTierAction(reason: FreeTierReason): ProblemAction {
  return reason === 'concurrent'
    ? { kind: 'recheck', label: 'Check again' }
    : { kind: 'byok', label: 'Use your own key' };
}

const DISMISS: ProblemAction = { kind: 'dismiss', label: 'Okay' };
const change = (label: string): ProblemAction => ({ kind: 'byok', label });

type Words = Pick<Problem, 'title' | 'message' | 'action'>;

const OTHER: Record<Exclude<PublicErrorCode, `FREE_TIER_${string}`>, Words> = {
  BYOK_KEY_NEEDED: {
    title: 'Your key is not saved',
    message: 'Your key is not saved, so the run paused. Add your key again to continue.',
    action: change('Add your key'),
  },
  BYOK_KEY_REJECTED: {
    title: 'Google did not accept the key',
    message:
      'Google did not accept this key. Check that you copied all of it, or make a new one in AI Studio.',
    action: change('Change key'),
  },
  BYOK_RATE_LIMITED: {
    title: 'Your Google quota is busy',
    message:
      'Your Google quota is used up for the moment. Wait a minute, or try a different model.',
    action: change('Choose a model'),
  },
  BYOK_QUOTA: {
    title: 'Your Google plan does not allow this',
    message: 'Your Google quota or billing does not allow this. Check your plan in AI Studio.',
    action: change('Check my key'),
  },
  BYOK_REGION: {
    title: 'Not available from here',
    message: "Google does not offer this key's service from where the server is. Try another key.",
    action: change('Change key'),
  },
  BYOK_MODEL_NOT_FOUND: {
    title: 'That model is not available',
    message: 'That model is not available for your key. Pick another model.',
    action: change('Choose a model'),
  },
  BYOK_BLOCKED: {
    title: 'Google blocked the request',
    message: 'Google blocked this request for safety reasons. Change the text and try again.',
    action: DISMISS,
  },
  PROJECT_LIMIT: {
    title: 'Project limit reached',
    message:
      'This account has reached the number of explorations it can keep. Delete one you no longer need in History, then try again.',
    action: DISMISS,
  },
  STORAGE_LIMIT: {
    title: 'Storage limit reached',
    message:
      'This account has used all of its storage. Delete an exploration you no longer need in History, then try again.',
    action: DISMISS,
  },
  RUN_IN_PROGRESS: {
    title: 'A run is already going',
    message:
      'A run is already in progress for this account. Wait for it to finish, then try again.',
    action: DISMISS,
  },
  BOT_CHECK_FAILED: {
    title: 'We could not check you',
    message: 'We could not check that you are a person. Please try again.',
    action: DISMISS,
  },
  NOT_AVAILABLE: {
    title: 'Not available',
    message: 'That is not available on this site.',
    action: DISMISS,
  },
  ACCOUNT_DISABLED: {
    title: 'This account is switched off',
    message:
      'This account has been switched off. If you think this is a mistake, contact the site owner.',
    action: DISMISS,
  },
};

/** The calm version of an error code of the public edition, or null for any other code. */
export function problemOf(code: string | null | undefined): Problem | null {
  if (!code) return null;
  const reason = freeTierReasonOf(code);
  if (reason) {
    const words = FREE_TIER_WORDS[reason];
    return {
      code: code as PublicErrorCode,
      reason,
      title: words.title,
      message: words.message,
      action: freeTierAction(reason),
    };
  }
  if (!Object.hasOwn(OTHER, code)) return null;
  const known = code as keyof typeof OTHER;
  return { code: known, reason: known.toLowerCase().replaceAll('_', '-'), ...OTHER[known] };
}

/** Whether a refusal with this code is told to the person in a card of its own, on top of the message it carries. */
export function raisesNotice(code: string): boolean {
  return (
    problemOf(code) !== null &&
    !['ACCOUNT_DISABLED', 'BOT_CHECK_FAILED', 'NOT_AVAILABLE'].includes(code)
  );
}

export interface SignInWords {
  title: string;
  body: string;
  /** Whether trying again can work: it cannot for an account that has been switched off. */
  retry: boolean;
}

export const SIGN_IN_WORDS: Record<PublicSignInProblem, SignInWords> = {
  failed: {
    title: 'Sign-in did not complete',
    body: 'Your sign-in was cancelled, ran out of time or could not be confirmed, so nobody was signed in. Nothing about the attempt was kept. Try again.',
    retry: true,
  },
  closed: {
    title: 'New accounts are closed for now',
    body: 'This site is not taking new accounts at the moment. People who already have an account can still sign in. Try again later.',
    retry: true,
  },
  unverified: {
    title: 'Your e-mail address is not verified',
    body: 'Your sign-in account has no verified e-mail address, so we could not sign you in. Verify the address with your provider, then try again.',
    retry: true,
  },
  disabled: {
    title: 'This account is switched off',
    body: 'The site owner has switched this account off, so it cannot sign in. If you think this is a mistake, contact the site owner.',
    retry: false,
  },
  blocked: {
    title: 'This sign-in was blocked',
    body: 'We could not accept this sign-in. This can happen when an e-mail address is on a block list, or when many accounts are made from one place. Try again later, or use a different account.',
    retry: true,
  },
};

/** The problem a sign-in that did not produce a session left on the address, if any. */
export function publicSignInProblem(search: string): PublicSignInProblem | null {
  const value = new URLSearchParams(search).get('signin');
  return (PUBLIC_SIGN_IN_PROBLEMS as readonly string[]).includes(value ?? '')
    ? (value as PublicSignInProblem)
    : null;
}

/** Why the person is looking at the landing page again. */
export type NoteKind = 'expired' | 'disabled' | 'deleted' | 'signed-out';

export const NOTE_WORDS: Record<NoteKind, string> = {
  expired: 'Your session ended. Sign in again to continue.',
  disabled:
    'This account has been switched off. If you think this is a mistake, contact the site owner.',
  deleted: 'Your account and all your data were deleted.',
  'signed-out': 'You are signed out.',
};

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === 'string' && Object.hasOwn(NOTE_WORDS, value);
}

/** What went wrong with the request that starts a sign-in, in words. */
export function signInFailure(reply: {
  status: number;
  code: string | null;
  network: boolean;
}): string {
  if (reply.network) return NETWORK_WORDS;
  if (reply.code === 'BOT_CHECK_FAILED') return OTHER.BOT_CHECK_FAILED.message;
  if (reply.status === 429)
    return 'Too many sign-in attempts from here. Wait a minute, then try again.';
  if (reply.status === 404) return 'That way of signing in is not available.';
  if (reply.status === 503) return 'The service is down for maintenance. Try again later.';
  return 'Sign-in could not start. Try again.';
}
