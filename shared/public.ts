import { z } from 'zod';

/**
 * What the browser and the server say to each other in the public edition (docs/public/DESIGN.md, section 9). Types
 * and constants only: nothing here depends on either side, so the page and the server are built to the same contract.
 */

/** Sent by the page on a request that may use a model. The server reads them in public mode only, then deletes them. */
export const BYOK_HEADERS = {
  provider: 'x-swarm-provider',
  key: 'x-swarm-provider-key',
  model: 'x-swarm-provider-model',
} as const;

/** The one provider a person can bring a key for. The seam allows more; only this one is built. */
export const BYOK_PROVIDER = 'gemini';

/** Where the page keeps what it holds about the person's key: `sessionStorage`, never `localStorage`. */
export const BYOK_STORAGE_KEYS = {
  key: 'swarm.byok.key',
  model: 'swarm.byok.model',
} as const;

/** What a person types to delete their account. */
export const DELETE_CONFIRMATION = 'delete my account';

/**
 * In public mode the server adds `<meta name="swarm-edition" content="public">` to `index.html`. The page makes no
 * public-edition request unless it finds it, so the pilot's page is exactly what it was, with no extra request.
 */
export const EDITION_META_NAME = 'swarm-edition';

export type PublicProviderId = 'google' | 'github';

/**
 * What an account was made with: a provider, or `guest` (no sign-in: a temporary private workspace that starts with
 * `POST /auth/guest` and is deleted after a period without use).
 */
export type PublicAccountProvider = PublicProviderId | 'guest';

export interface PublicProviderInfo {
  id: PublicProviderId;
  label: string;
}

/** Why the free tier cannot be used right now. null: it can. */
export type FreeTierReason = 'user-cap' | 'global-cap' | 'lifetime-cap' | 'disabled' | 'concurrent';

export interface FreeTierAvailability {
  available: boolean;
  reason: FreeTierReason | null;
}

/** `GET /api/public/session`: callable without a session. */
export interface PublicSession {
  edition: 'public';
  signedIn: boolean;
  /** Only the providers whose client ID and secret are configured. Empty is a site that is guest-only. */
  providers: PublicProviderInfo[];
  signupsOpen: boolean;
  /**
   * A visitor can start with no sign-in: `POST /auth/guest` (header `X-Swarm-CSRF: 1`) makes a temporary private
   * workspace and sets the session cookie. False when the owner has not turned guest mode on, or sign-ups are closed.
   */
  guestMode: boolean;
  /** How many hours without use a guest's data is kept before it is deleted. */
  guestRetentionHours: number;
  bot: { kind: 'turnstile'; siteKey: string } | null;
  freeTier: FreeTierAvailability;
  byokEnabled: boolean;
  /** How many days a keyed counter of a deleted account's free tokens is kept (0: nothing is kept), for the privacy text. */
  retentionDays: number;
  legal: { terms: string; privacy: string };
  user: {
    emailMasked: string;
    provider: PublicAccountProvider;
    /** A guest has no e-mail address and no provider: its data is temporary. */
    guest: boolean;
    isAdmin: boolean;
    createdAt: string;
  } | null;
  session: { idleExpiresAt: string; expiresAt: string } | null;
}

export type PublicHealth = 'ok' | 'degraded' | 'maintenance';

/** `GET /api/public/status`: for the status page. */
export interface PublicStatus {
  status: PublicHealth;
  freeTier: FreeTierAvailability & { resetsAt: string };
  byokEnabled: boolean;
  signupsOpen: boolean;
  message: string | null;
  checkedAt: string;
}

export type LegalDocument = 'terms' | 'privacy';

/** `GET /api/public/legal/:doc`. The text is shown as text, never as HTML. */
export interface LegalText {
  title: string;
  text: string;
  /** False while the owner's stub has not been replaced. */
  reviewed: boolean;
}

export const startSignInSchema = z
  .object({
    returnTo: z.string().max(600).optional(),
    turnstileToken: z.string().max(4_096).optional(),
  })
  .strict();
export type StartSignIn = z.infer<typeof startSignInSchema>;

/** `POST /auth/start/:provider`. The page navigates to `url`. */
export interface StartedSignIn {
  url: string;
}

/**
 * `POST /auth/guest` (header `X-Swarm-CSRF: 1`, no body needed). The session cookie is in the answer's headers; the page then
 * asks `GET /api/public/session` again. Refused with 403 `NOT_AVAILABLE` (guest mode off, or new visitors are not being
 * let in), 429 `RATE_LIMITED` (too many new guests from this address) or 403 `BOT_CHECK_FAILED`.
 */
export const startGuestSchema = z
  .object({ turnstileToken: z.string().max(4_096).optional() })
  .strict();
export type StartGuest = z.infer<typeof startGuestSchema>;
export interface StartedGuest {
  started: true;
}

/** The reasons `/?signin=` carries after a sign-in that did not produce a session. */
export const PUBLIC_SIGN_IN_PROBLEMS = [
  'failed',
  'closed',
  'unverified',
  'disabled',
  'blocked',
] as const;
export type PublicSignInProblem = (typeof PUBLIC_SIGN_IN_PROBLEMS)[number];

/** `GET /api/account`. */
export interface AccountView {
  /** `guest` for a guest: it has no address. */
  emailMasked: string;
  provider: PublicAccountProvider;
  /** A guest's data is temporary: it is deleted after `guestRetentionHours` without use, or when the guest says so. */
  guest: boolean;
  createdAt: string;
  isAdmin: boolean;
  projects: { count: number; limit: number };
  storage: { usedBytes: number; limitBytes: number };
}

export const deleteAccountSchema = z.object({ confirm: z.literal(DELETE_CONFIRMATION) }).strict();

export type Funding = 'free' | 'byok';

/** `GET /api/usage`. `funding` is what this request would use: BYOK when it carries a key, else the free tier. */
export interface UsageView {
  funding: Funding;
  free: FreeTierAvailability & {
    resetsAt: string;
    today: {
      calls: number;
      callLimit: number;
      tokens: number;
      tokenLimit: number;
      /** About how many more runs of `tokensPerRun` today's tokens allow. For the meter only. */
      runsLeft: number;
      tokensPerRun: number;
    };
    lifetime: { tokens: number; limit: number };
    inFlight: { calls: number; limit: number };
  };
  byok: { enabled: boolean; today: { calls: number; tokens: number } };
}

export type ByokStatus =
  'valid' | 'invalid' | 'rate-limited' | 'quota' | 'region' | 'unreachable' | 'disabled';

export interface ByokModel {
  id: string;
  label: string;
}

/** `POST /api/byok/connect`. HTTP 200 for every status. The key is never in it. */
export interface ByokConnectResult {
  status: ByokStatus;
  message: string;
  models: ByokModel[];
  defaultModel: string | null;
}

/** `GET /api/admin/usage`. */
export interface AdminUsageView {
  days: {
    day: string;
    calls: number;
    tokens: number;
    reasoningTokens: number;
    costUsd: number;
    blocked: number;
  }[];
  topUsers: {
    id: string;
    emailMasked: string;
    tokens: number;
    calls: number;
    /** The account is switched off, so that the table says so after a reload. */
    disabled: boolean;
  }[];
  blocked: { byReason: Record<string, number> };
  switches: { freeTierEnv: boolean; freeTierRuntime: boolean; signups: boolean };
  today: {
    global: { calls: number; tokens: number; costUsd: number };
    limits: { tokens: number; costUsd: number };
  };
}

export interface AdminSwitches {
  freeTierEnv: boolean;
  freeTierRuntime: boolean;
  signups: boolean;
}

/**
 * The error codes of the public edition, in addition to the ones every route can answer. The page decides what to show
 * from the code and never from the message.
 */
export const PUBLIC_ERROR_CODES = [
  // The free tier is not available to this request; the code says why, and the status is 429.
  'FREE_TIER_USER_CAP',
  'FREE_TIER_GLOBAL_CAP',
  'FREE_TIER_LIFETIME_CAP',
  'FREE_TIER_DISABLED',
  'FREE_TIER_CONCURRENT',
  // The person's own key, on a run.
  'BYOK_KEY_NEEDED',
  'BYOK_KEY_REJECTED',
  'BYOK_RATE_LIMITED',
  'BYOK_QUOTA',
  'BYOK_REGION',
  'BYOK_MODEL_NOT_FOUND',
  'BYOK_BLOCKED',
  // Limits that are not about a model.
  'PROJECT_LIMIT',
  'STORAGE_LIMIT',
  'RUN_IN_PROGRESS',
  'BOT_CHECK_FAILED',
  'NOT_AVAILABLE',
  'ACCOUNT_DISABLED',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

/** The free-tier reason that an error code stands for, or null for any other code. */
export function freeTierReasonOf(code: string | undefined): FreeTierReason | null {
  switch (code) {
    case 'FREE_TIER_USER_CAP':
      return 'user-cap';
    case 'FREE_TIER_GLOBAL_CAP':
      return 'global-cap';
    case 'FREE_TIER_LIFETIME_CAP':
      return 'lifetime-cap';
    case 'FREE_TIER_DISABLED':
      return 'disabled';
    case 'FREE_TIER_CONCURRENT':
      return 'concurrent';
    default:
      return null;
  }
}
