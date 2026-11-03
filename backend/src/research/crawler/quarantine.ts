import type { QuarantineReason } from '../../../../shared/research.js';
import type { Extraction } from '../extract/index.js';

export interface Quarantine {
  reason: QuarantineReason;
  /** A fixed sentence, for a person. It never holds what the page said. */
  detail: string;
}

/** The point at which a page is too short to be evidence, in characters of its own text. */
export const EMPTY_CHARS = 100;
const THIN_CHARS = 300;
/** Pages longer than these, in characters of their own text, are not taken for the kind of page that is short. */
export const LIMITS = {
  login: 1_500,
  loginByTitle: 800,
  consent: 700,
  paywall: 2_500,
  paywallMarked: 3_000,
  error: 700,
  errorWeak: 300,
  errorBody: 500,
} as const;
/** The share of a page that reads like instructions to an AI, in blocks or in characters, at which it is set aside. */
export const INJECTION_SHARE = 0.5;

export const DETAILS = {
  empty: 'The page has almost no text of its own.',
  emptyScripted: 'The page shows its text only with scripts, which Swarm does not run.',
  login: 'The page asks readers to sign in, so there was nothing public to read.',
  consent: 'The page shows a cookie or consent notice and almost nothing else.',
  paywall: 'The page asks readers to subscribe or sign in before its text is shown.',
  error: 'The page says that what was asked for cannot be found or shown.',
  malformed:
    'The page could not be read to its end: it is larger or more deeply built than Swarm reads.',
  injection: 'Most of the page reads like instructions to an AI system, so it was set aside.',
} as const;

const LOGIN_TITLE = /\b(?:sign|log)[ -]?in\b|\blogin\b|\bsign[ -]?up\b|\bregister\b|\bauthenticat/u;
const LOGIN_WORDS = /\b(?:password|username|e-?mail address)\b/u;

const CONSENT: readonly RegExp[] = [
  /\bcookies?\b/u,
  /\b(?:accept|allow|agree to) (?:all|cookies)\b/u,
  /\b(?:manage|customi[sz]e|change) (?:your )?(?:cookie |privacy )?(?:preferences|settings|choices)\b/u,
  /\b(?:reject|decline|deny) all\b/u,
  /\b(?:we|our partners|this (?:site|website)) (?:use|uses|store)\b.{0,60}\b(?:cookies|similar technologies|device identifiers)\b/u,
  /\b(?:gdpr|tcf|consent)\b/u,
];

const PAYWALL: readonly RegExp[] = [
  /\bsubscribe (?:now )?to (?:continue|read|unlock|access|view)\b/u,
  /\b(?:sign|log) in to (?:continue|read|view|access|unlock)\b/u,
  /\b(?:create|register for) (?:a |an )?(?:free )?account to (?:continue|read|view|access)\b/u,
  /\byou(?:'ve| have) (?:reached|used|read) (?:your|the) (?:free|monthly|article|premium)\b/u,
  /\b(?:this|the) (?:article|story|content|page) is (?:only )?(?:available|reserved|for) (?:to |for )?(?:our )?(?:subscribers|members|premium)\b/u,
  /\balready a (?:subscriber|member)\b/u,
  /\b(?:become|join as) a (?:subscriber|member)\b/u,
  /\bunlock (?:this|the|full) (?:article|story|content)\b/u,
  /\bpaywall\b/u,
];

const ERROR_STRONG =
  /\b(?:404|403|410|500|503)\b|\bnot found\b|\bcan(?:no|')t be found\b|\bdoes(?: not|n't) exist\b|\bno longer (?:available|exists?)\b|\baccess denied\b|\bforbidden\b|\bsomething went wrong\b/u;
const ERROR_WEAK = /\b(?:error|oops|unavailable|temporarily down)\b/u;
const ERROR_BODY =
  /\b(?:the )?(?:page|content|article|file) (?:you (?:were|are) looking for|you requested|requested)\b.{0,40}\b(?:not (?:be )?found|no longer|does(?: not|n't) exist|has been (?:removed|moved))\b|\bsorry, we (?:could not|couldn't|can't|cannot) find\b/u;

const hits = (patterns: readonly RegExp[], text: string): number =>
  patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);

const plain = (text: string): string => text.toLowerCase().replace(/[\u2018\u2019]/gu, "'");

/** The file is labelled as text and its bytes say otherwise. `kind` is the phrase `sniff.ts` gives. */
export const binaryAsText = (kind: string): Quarantine => ({
  reason: 'binary-as-text',
  detail: `The file is labelled as text, but its bytes look like ${kind}.`,
});

/**
 * Whether a page that was read is set aside instead of being used as evidence, and why. The checks
 * are deterministic and look at what the page showed and how it is built; they are guesses, so a page
 * that is set aside is listed with its reason, never silently dropped. Order matters: what is most
 * dangerous is judged first.
 */
export function quarantineOf(extraction: Extraction): Quarantine | null {
  const { document, signals } = extraction;
  if (signals.problem) return { reason: signals.problem.kind, detail: signals.problem.detail };
  const prose = signals.proseChars;
  const { flaggedBlocks, totalBlocks, flaggedChars, totalChars } = document.injection;
  if (
    flaggedBlocks > 0 &&
    (flaggedChars >= totalChars * INJECTION_SHARE || flaggedBlocks >= totalBlocks * INJECTION_SHARE)
  ) {
    return { reason: 'prompt-injection', detail: DETAILS.injection };
  }
  const text = plain(document.text.slice(0, 20_000));
  const heads = plain(`${document.title ?? ''} ${signals.headline ?? ''}`);
  const around = `${plain(signals.leftOutSample)}\n${text}`;

  if (
    (signals.passwordField && prose < LIMITS.login) ||
    (LOGIN_TITLE.test(heads) && LOGIN_WORDS.test(text) && prose < LIMITS.loginByTitle)
  ) {
    return { reason: 'login-page', detail: DETAILS.login };
  }
  if (hits(CONSENT, around) >= 3 && prose < LIMITS.consent) {
    return { reason: 'consent-wall', detail: DETAILS.consent };
  }
  if (
    (hits(PAYWALL, around) >= 1 && prose < LIMITS.paywall) ||
    (signals.paywallMarked && prose < LIMITS.paywallMarked)
  ) {
    return { reason: 'paywall', detail: DETAILS.paywall };
  }
  if (
    (ERROR_STRONG.test(heads) && prose < LIMITS.error) ||
    (ERROR_WEAK.test(heads) && prose < LIMITS.errorWeak) ||
    (ERROR_BODY.test(text) && prose < LIMITS.errorBody)
  ) {
    return { reason: 'error-page', detail: DETAILS.error };
  }
  if (signals.cutShort && prose < THIN_CHARS) {
    return { reason: 'malformed', detail: DETAILS.malformed };
  }
  if (prose < EMPTY_CHARS) {
    const scripted = signals.scripted || signals.noscript;
    return { reason: 'empty', detail: scripted ? DETAILS.emptyScripted : DETAILS.empty };
  }
  return null;
}
