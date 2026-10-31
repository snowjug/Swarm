import { expect } from '@playwright/test';

const identityProvider = `http://127.0.0.1:${process.env.E2E_SIGNIN_IDP_PORT || 3115}`;

/** The people of backend/test/support/signin-e2e-server.ts, and what Microsoft can do instead. */
export type Person = 'owner' | 'stranger' | 'norole' | 'colleague' | 'declines';

/**
 * Microsoft is a small identity provider on another loopback port (see
 * backend/test/support/signin-e2e-server.ts); the browser is redirected to it exactly as it would be
 * to Microsoft. This chooses who signs in at the next visit, and forgets earlier visits.
 */
export async function microsoftSignsIn(person: Person): Promise<void> {
  const response = await fetch(`${identityProvider}/__next`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ person }),
  });
  expect(response.status).toBe(204);
}

/** The authorize requests Microsoft has received since the last choice. */
export async function microsoftVisits(): Promise<Record<string, string>[]> {
  return (await (await fetch(`${identityProvider}/__visits`)).json()) as Record<string, string>[];
}
