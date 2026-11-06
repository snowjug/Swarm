/**
 * What the browser tests of the public edition and their server agree on. Nothing here starts anything, so a spec may
 * import it (`backend/test/support/public-e2e-server.ts` is the server, and starts one).
 */

/** The ports of the application and of the server's control interface; `E2E_PUBLIC_PORT` and `E2E_PUBLIC_CONTROL_PORT` move them. */
export const PUBLIC_E2E_PORTS = { app: 3119, control: 3120 } as const;

/** The one key the fake Gemini accepts. It is a fake: the tests hold it so that they can look for it. */
export const E2E_KEY = 'AIzaSyD-canary0123456789abcdefghijklmn_';

/** The model the fake Gemini lists first among those that suit, and so the one chosen for a key that was just connected. */
export const E2E_KEY_MODEL = 'gemini-2.5-flash';

/** What the control interface says each fake model was asked (`GET /__seen`). */
export interface Seen {
  foundry: { url: string; deployment: unknown }[];
  gemini: {
    method: string;
    host: string;
    path: string;
    authorization: string | null;
    bodyHasKey: boolean;
  }[];
}
