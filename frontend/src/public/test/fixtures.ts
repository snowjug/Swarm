import type {
  AccountView,
  AdminUsageView,
  ByokConnectResult,
  PublicSession,
  PublicStatus,
  UsageView,
} from '../../../../shared/public';

/** The key used by the tests. It is long and has a shape no other text on the page has, so that a leak is easy to see. */
export const TEST_KEY = 'AIzaSyTESTKEY0123456789abcdefghij1234';

export const signedOutSession = (over: Partial<PublicSession> = {}): PublicSession => ({
  edition: 'public',
  signedIn: false,
  providers: [
    { id: 'google', label: 'Google' },
    { id: 'github', label: 'GitHub' },
  ],
  signupsOpen: true,
  bot: null,
  freeTier: { available: true, reason: null },
  byokEnabled: true,
  retentionDays: 30,
  legal: { terms: '/legal/terms', privacy: '/legal/privacy' },
  user: null,
  session: null,
  ...over,
});

export const signedInSession = (
  over: Partial<PublicSession> = {},
  user: Partial<NonNullable<PublicSession['user']>> = {},
): PublicSession =>
  signedOutSession({
    signedIn: true,
    user: {
      emailMasked: 'a***@example.com',
      provider: 'google',
      isAdmin: false,
      createdAt: '2026-11-01T09:00:00.000Z',
      ...user,
    },
    session: { idleExpiresAt: '2026-11-06T11:00:00.000Z', expiresAt: '2026-11-06T18:00:00.000Z' },
    ...over,
  });

export const usageView = (
  over: Partial<Omit<UsageView, 'free'>> & { free?: Partial<UsageView['free']> } = {},
): UsageView => {
  const { free, ...rest } = over;
  return {
    funding: 'free',
    free: {
      available: true,
      reason: null,
      resetsAt: '2026-11-07T00:00:00.000Z',
      today: {
        calls: 5,
        callLimit: 40,
        tokens: 12_000,
        tokenLimit: 60_000,
        runsLeft: 3,
        tokensPerRun: 15_000,
      },
      lifetime: { tokens: 45_000, limit: 300_000 },
      inFlight: { calls: 0, limit: 3 },
      ...free,
    },
    byok: { enabled: true, today: { calls: 0, tokens: 0 } },
    ...rest,
  };
};

export const accountView = (over: Partial<AccountView> = {}): AccountView => ({
  emailMasked: 'a***@example.com',
  provider: 'google',
  createdAt: '2026-11-01T09:00:00.000Z',
  isAdmin: false,
  projects: { count: 2, limit: 10 },
  storage: { usedBytes: 1_500_000, limitBytes: 20_971_520 },
  ...over,
});

export const statusView = (over: Partial<PublicStatus> = {}): PublicStatus => ({
  status: 'ok',
  freeTier: { available: true, reason: null, resetsAt: '2026-11-07T00:00:00.000Z' },
  byokEnabled: true,
  signupsOpen: true,
  message: null,
  checkedAt: '2026-11-06T10:00:00.000Z',
  ...over,
});

export const connectResult = (over: Partial<ByokConnectResult> = {}): ByokConnectResult => ({
  status: 'valid',
  message: 'Google accepted this key.',
  models: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  defaultModel: 'gemini-2.5-flash',
  ...over,
});

export const adminView = (over: Partial<AdminUsageView> = {}): AdminUsageView => ({
  days: [
    {
      day: '2026-11-06',
      calls: 12,
      tokens: 90_000,
      reasoningTokens: 0,
      costUsd: 0.0123,
      blocked: 2,
    },
    { day: '2026-11-05', calls: 30, tokens: 210_000, reasoningTokens: 0, costUsd: 0.5, blocked: 0 },
  ],
  topUsers: [
    { id: 'u_aaa111', emailMasked: 'a***@example.com', tokens: 55_000, calls: 9, disabled: false },
    { id: 'u_bbb222', emailMasked: 'b***@example.org', tokens: 20_000, calls: 3, disabled: false },
  ],
  blocked: { byReason: { 'user-cap': 4, 'global-cap': 1 } },
  switches: { freeTierEnv: true, freeTierRuntime: true, signups: true },
  today: {
    global: { calls: 12, tokens: 90_000, costUsd: 0.0123 },
    limits: { tokens: 2_000_000, costUsd: 5 },
  },
  ...over,
});
