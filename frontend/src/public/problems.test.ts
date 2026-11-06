import { describe, expect, it } from 'vitest';
import {
  freeTierReasonOf,
  PUBLIC_ERROR_CODES,
  PUBLIC_SIGN_IN_PROBLEMS,
} from '../../../shared/public';
import { signInProblem } from '../lib/signIn';
import {
  FREE_TIER_WORDS,
  NETWORK_WORDS,
  problemOf,
  publicSignInProblem,
  raisesNotice,
  SIGN_IN_WORDS,
  signInFailure,
} from './problems';

describe('what the public edition says about an error code', () => {
  it('has one calm sentence and one next step for every code of the public edition', () => {
    for (const code of PUBLIC_ERROR_CODES) {
      const problem = problemOf(code);
      expect(problem, code).not.toBeNull();
      expect(problem!.code).toBe(code);
      expect(problem!.message.length, code).toBeGreaterThan(20);
      expect(problem!.message, code).toMatch(/[.]$/u);
      // The code is for the page to decide with. It is never shown to the person.
      expect(problem!.message, code).not.toMatch(/[A-Z]{2,}_[A-Z_]+/u);
      expect(problem!.title, code).not.toMatch(/[A-Z]{2,}_[A-Z_]+/u);
      expect(problem!.action.label.length, code).toBeGreaterThan(1);
    }
  });

  it('says what the design says for each free-tier state, from the reason the code stands for', () => {
    const design = {
      FREE_TIER_USER_CAP:
        "You have used today's free runs. They come back at 00:00 UTC, or use your own key now.",
      FREE_TIER_GLOBAL_CAP:
        'The free tier is used up for today. Bring your own key, or come back tomorrow.',
      FREE_TIER_LIFETIME_CAP:
        'You have used the free allowance for this account. Bring your own key to keep going.',
      FREE_TIER_DISABLED:
        'The free tier is switched off right now. You can still use your own key.',
      FREE_TIER_CONCURRENT: 'A run is already in progress. It will finish soon.',
    } as const;
    for (const [code, message] of Object.entries(design)) {
      const reason = freeTierReasonOf(code);
      expect(reason, code).not.toBeNull();
      expect(problemOf(code)).toMatchObject({ reason, message });
      expect(FREE_TIER_WORDS[reason!].message).toBe(message);
    }
  });

  it('offers the way to use their own key wherever that is the way on, and a second look where it is only a wait', () => {
    for (const code of [
      'FREE_TIER_USER_CAP',
      'FREE_TIER_GLOBAL_CAP',
      'FREE_TIER_LIFETIME_CAP',
      'FREE_TIER_DISABLED',
    ]) {
      expect(problemOf(code)!.action.kind, code).toBe('byok');
    }
    expect(problemOf('FREE_TIER_CONCURRENT')!.action.kind).toBe('recheck');
  });

  it('tells a person whose key was not kept that the run paused, and where to add it again', () => {
    expect(problemOf('BYOK_KEY_NEEDED')).toMatchObject({
      message: 'Your key is not saved, so the run paused. Add your key again to continue.',
      action: { kind: 'byok' },
    });
  });

  it('knows no other code, and cannot be fooled by a name that every object has', () => {
    for (const code of ['STEP_LOCKED', 'FORBIDDEN', 'SIGN_IN_REQUIRED', '', undefined, null]) {
      expect(problemOf(code), String(code)).toBeNull();
    }
    for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(problemOf(code), code).toBeNull();
    }
  });

  it('puts a refusal in a card of its own, except the three that are told another way', () => {
    for (const code of PUBLIC_ERROR_CODES) {
      const aside = ['ACCOUNT_DISABLED', 'BOT_CHECK_FAILED', 'NOT_AVAILABLE'].includes(code);
      expect(raisesNotice(code), code).toBe(!aside);
    }
    expect(raisesNotice('STEP_LOCKED')).toBe(false);
  });
});

describe('what a sign-in that did not produce a session says', () => {
  it('reads each of the five reasons from the address, and nothing else', () => {
    for (const kind of PUBLIC_SIGN_IN_PROBLEMS) {
      expect(publicSignInProblem(`?signin=${kind}`)).toBe(kind);
    }
    for (const search of ['', '?signin=', '?signin=norole', '?signin=nope', '?other=failed']) {
      expect(publicSignInProblem(search), search).toBeNull();
    }
  });

  it('leaves the pilot’s own reading of the address exactly as it was', () => {
    expect(signInProblem('?signin=failed')).toBe('failed');
    expect(signInProblem('?signin=norole')).toBe('norole');
    for (const kind of ['closed', 'unverified', 'disabled', 'blocked']) {
      expect(signInProblem(`?signin=${kind}`), kind).toBeNull();
    }
  });

  it('has a plain title and explanation for each reason, and no way to try again for an account that is off', () => {
    for (const kind of PUBLIC_SIGN_IN_PROBLEMS) {
      const words = SIGN_IN_WORDS[kind];
      expect(words.title.length, kind).toBeGreaterThan(10);
      expect(words.body, kind).toMatch(/[.]$/u);
      expect(words.retry, kind).toBe(kind !== 'disabled');
    }
  });

  it('says what went wrong with starting one, from the answer', () => {
    expect(signInFailure({ status: 0, code: null, network: true })).toBe(NETWORK_WORDS);
    expect(signInFailure({ status: 403, code: 'BOT_CHECK_FAILED', network: false })).toMatch(
      /check that you are a person/u,
    );
    expect(signInFailure({ status: 429, code: null, network: false })).toMatch(
      /Too many sign-in attempts/u,
    );
    expect(signInFailure({ status: 404, code: null, network: false })).toMatch(/not available/u);
    expect(signInFailure({ status: 503, code: null, network: false })).toMatch(/maintenance/u);
    expect(signInFailure({ status: 500, code: null, network: false })).toBe(
      'Sign-in could not start. Try again.',
    );
  });
});
