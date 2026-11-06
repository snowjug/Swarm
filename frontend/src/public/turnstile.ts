/**
 * The bot check of the public sign-in (Cloudflare Turnstile). Its script is fetched only when the server says the check
 * is on, and only through this module, so that a test can replace the loader with a fake and nothing ever contacts
 * Cloudflare from a test.
 */

export interface TurnstileOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  theme?: 'auto' | 'light' | 'dark';
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

export type TurnstileLoader = () => Promise<TurnstileApi>;

let pending: Promise<TurnstileApi> | null = null;

const fromCloudflare: TurnstileLoader = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  pending ??= new Promise<TurnstileApi>((resolve, reject) => {
    const fail = () => {
      pending = null;
      reject(new Error('The person check could not be loaded.'));
    };
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : fail());
    script.onerror = () => {
      script.remove();
      fail();
    };
    document.head.append(script);
  });
  return pending;
};

let loader: TurnstileLoader = fromCloudflare;

/** For tests: what loads the script. Pass null to put the real one back. */
export function setTurnstileLoader(next: TurnstileLoader | null): void {
  loader = next ?? fromCloudflare;
}

export function loadTurnstile(): Promise<TurnstileApi> {
  return loader();
}
