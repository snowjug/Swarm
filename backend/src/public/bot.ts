import type { PublicConfig } from './config.js';

/** Cloudflare Turnstile's verification endpoint: a constant, and the only host this module talks to. */
export const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface BotCheck {
  /** The site key the page needs to show the widget. */
  readonly siteKey: string;
  /** True when Cloudflare says the token is valid for this site. Unreachable or malformed answers are a no. */
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

/**
 * Bot protection, off unless both Turnstile keys are set. When it is on, starting a sign-in needs a token that the page
 * got from the widget, and the server checks it once against Cloudflare. It fails closed: an outage at Cloudflare stops
 * new sign-ins, and the owner can switch it off by unsetting the keys.
 */
export function createBotCheck(pub: PublicConfig, fetcher: typeof fetch = fetch): BotCheck | null {
  const turnstile = pub.turnstile;
  if (!turnstile) return null;
  return {
    siteKey: turnstile.siteKey,
    async verify(token, ip) {
      if (typeof token !== 'string' || token.length === 0 || token.length > 4_096) return false;
      try {
        const response = await fetcher(TURNSTILE_VERIFY, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body: new URLSearchParams({ secret: turnstile.secretKey, response: token, remoteip: ip }),
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { success?: unknown } | null;
        return body?.success === true;
      } catch {
        return false;
      }
    },
  };
}
