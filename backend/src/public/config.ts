import { z } from 'zod';
import { MODEL_ROLES, type ModelRole } from '../models/task.js';

/**
 * Everything the public edition reads from the environment (docs/public/DESIGN.md, section 3). It is read only when
 * `SWARM_EDITION=public`; a pilot never calls it. A bad value stops the server from starting and names the variable,
 * never repeating its value: some of them are secrets.
 */

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface FreeTierConfig {
  /** The hard switch from the environment. False wins over the run-time switch. */
  enabled: boolean;
  userDailyTokens: number;
  userDailyCalls: number;
  userLifetimeTokens: number;
  userConcurrentRuns: number;
  userConcurrentCalls: number;
  globalDailyTokens: number;
  globalDailyCostUsd: number;
  /** Only for the meter: what one run is taken to cost. */
  tokensPerRun: number;
  /** At most this many output tokens for a call of the role, on the free tier. */
  roleMaxOutputTokens: Readonly<Partial<Record<ModelRole, number>>>;
  /** What a guest (a visitor who did not sign in) may use. The global caps above are shared by everyone. */
  guest: {
    dailyTokens: number;
    dailyCalls: number;
    lifetimeTokens: number;
    concurrentRuns: number;
    concurrentCalls: number;
    /** Only for the meter, as `tokensPerRun` is for a signed-in person. */
    tokensPerRun: number;
  };
}

export interface PublicConfig {
  /** `https://host` (or `http://localhost:port` in development): no path, no trailing slash. */
  baseUrl: string;
  /** The host name of `baseUrl`, lower case. */
  host: string;
  secureCookies: boolean;
  providers: { google: ProviderCredentials | null; github: ProviderCredentials | null };
  /** Verified e-mail addresses (lower case) that are platform administrators. */
  adminEmails: ReadonlySet<string>;
  signupsEnabled: boolean;
  /**
   * Visitors can start with no sign-in (`POST /auth/guest`): a temporary private workspace. Needs `signupsEnabled`, like
   * any new account. With it, Google and GitHub are optional.
   */
  guestMode: boolean;
  guests: {
    /** New guests one address may make in an hour. */
    perIpPerHour: number;
    /** New guests in all in an hour. */
    perHour: number;
    /** A guest's data is deleted after this many hours without use. */
    retentionHours: number;
  };
  blockedEmailDomains: ReadonlySet<string>;
  maxProjects: number;
  storageQuotaBytes: number;
  deletedAccountRetentionDays: number;
  allowResearch: boolean;
  /** The role row security is enforced on. */
  runtimeRole: string;
  allowUnsafeSqlite: boolean;
  /** SHA-256, hex, of the key the budget automation presents. Null: the endpoint is off. */
  opsKeySha256: string | null;
  /**
   * SHA-256, hex, of the owner's key, which turns the free tier or new visitors on or off and reads the usage with no
   * sign-in (`X-Swarm-Owner-Key`, header only). Null: those routes are off.
   */
  ownerKeySha256: string | null;
  /** Keys the hashes of addresses and of deleted accounts. A secret. */
  pepper: string;
  signups: { perIpPerDay: number; perHour: number };
  /**
   * What one account may do in a window, before the rate limit scale. An address may do three times as much, because a
   * household or an office shares one.
   */
  rates: {
    writesPer5Min: number;
    createPerHour: number;
    storePerHour: number;
    modelPerHour: number;
    fetchPerHour: number;
    extractPerHour: number;
  };
  free: FreeTierConfig;
  byok: { enabled: boolean; maxConcurrentCalls: number };
  /** A session ends after this long idle, and this long after sign-in whatever happens (`AUTH_SESSION_*`). */
  session: { idleMinutes: number; absoluteHours: number };
  turnstile: { siteKey: string; secretKey: string } | null;
  allowReasoningDeployment: boolean;
}

/** An empty setting is an unset one. */
const unset = (value: unknown): unknown => (value === '' ? undefined : value);

const flag = (fallback: boolean) =>
  z.preprocess((value) => {
    const word = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (word === undefined || word === '') return undefined;
    if (['1', 'true', 'on', 'yes'].includes(word as string)) return true;
    if (['0', 'false', 'off', 'no'].includes(word as string)) return false;
    return word;
  }, z.boolean().default(fallback));

const whole = (fallback: number, min: number, max: number) =>
  z.preprocess(unset, z.coerce.number().int().min(min).max(max).default(fallback));
const amount = (fallback: number, min: number, max: number) =>
  z.preprocess(unset, z.coerce.number().min(min).max(max).default(fallback));
const text = (max: number) => z.preprocess(unset, z.string().trim().min(1).max(max).optional());

const environmentSchema = z.object({
  PUBLIC_BASE_URL: text(300),
  PUBLIC_GOOGLE_CLIENT_ID: text(300),
  PUBLIC_GOOGLE_CLIENT_SECRET: text(500),
  PUBLIC_GITHUB_CLIENT_ID: text(300),
  PUBLIC_GITHUB_CLIENT_SECRET: text(500),
  PUBLIC_ADMIN_EMAILS: z.preprocess(unset, z.string().max(2_000).optional()),
  PUBLIC_SIGNUPS_ENABLED: flag(true),
  PUBLIC_GUEST_MODE: flag(false),
  PUBLIC_GUESTS_PER_IP_PER_HOUR: whole(10, 1, 1_000),
  PUBLIC_GUESTS_PER_HOUR: whole(300, 1, 100_000),
  PUBLIC_GUEST_RETENTION_HOURS: whole(24, 1, 168),
  PUBLIC_BLOCKED_EMAIL_DOMAINS: z.preprocess(unset, z.string().max(4_000).optional()),
  PUBLIC_MAX_PROJECTS: whole(10, 1, 100),
  PUBLIC_STORAGE_QUOTA_MB: whole(20, 1, 1_000),
  PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS: whole(30, 0, 365),
  PUBLIC_ALLOW_RESEARCH: flag(false),
  PUBLIC_DB_RUNTIME_ROLE: z.preprocess(
    unset,
    z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/u)
      .default('swarm_app'),
  ),
  PUBLIC_ALLOW_UNSAFE_SQLITE: flag(false),
  PUBLIC_ALLOW_REASONING_DEPLOYMENT: flag(false),
  PUBLIC_OPS_KEY_SHA256: z.preprocess(
    unset,
    z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
  ),
  PUBLIC_OWNER_KEY_SHA256: z.preprocess(
    unset,
    z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
  ),
  PUBLIC_PEPPER: z.preprocess(unset, z.string().min(32).max(500).optional()),
  PUBLIC_SIGNUPS_PER_IP_PER_DAY: whole(5, 1, 1_000),
  PUBLIC_SIGNUPS_PER_HOUR: whole(60, 1, 100_000),
  PUBLIC_RATE_WRITES_PER_5MIN: whole(300, 10, 1_000_000),
  PUBLIC_RATE_CREATE_PER_HOUR: whole(20, 1, 100_000),
  PUBLIC_RATE_STORE_PER_HOUR: whole(60, 1, 100_000),
  PUBLIC_RATE_MODEL_PER_HOUR: whole(120, 1, 100_000),
  PUBLIC_RATE_FETCH_PER_HOUR: whole(30, 1, 100_000),
  PUBLIC_RATE_EXTRACT_PER_HOUR: whole(30, 1, 100_000),
  FREE_TIER_ENABLED: flag(true),
  FREE_USER_DAILY_TOKENS: whole(60_000, 0, 100_000_000),
  FREE_USER_DAILY_CALLS: whole(40, 0, 100_000),
  FREE_USER_LIFETIME_TOKENS: whole(300_000, 0, 1_000_000_000),
  FREE_USER_CONCURRENT_RUNS: whole(1, 1, 20),
  FREE_USER_CONCURRENT_CALLS: whole(3, 1, 50),
  FREE_GLOBAL_DAILY_TOKENS: whole(2_000_000, 0, 10_000_000_000),
  FREE_GLOBAL_DAILY_COST_USD: amount(5, 0, 100_000),
  FREE_TOKENS_PER_RUN: whole(15_000, 1_000, 10_000_000),
  FREE_GUEST_DAILY_TOKENS: whole(80_000, 0, 100_000_000),
  FREE_GUEST_DAILY_CALLS: whole(60, 0, 100_000),
  FREE_GUEST_LIFETIME_TOKENS: whole(240_000, 0, 1_000_000_000),
  FREE_GUEST_CONCURRENT_RUNS: whole(2, 1, 20),
  FREE_GUEST_CONCURRENT_CALLS: whole(4, 1, 50),
  FREE_GUEST_TOKENS_PER_RUN: whole(15_000, 1_000, 10_000_000),
  FREE_ROLE_MAX_OUTPUT_TOKENS: z.preprocess(unset, z.string().max(2_000).optional()),
  BYOK_ENABLED: flag(true),
  BYOK_MAX_CONCURRENT_CALLS: whole(4, 1, 50),
  AUTH_SESSION_IDLE_MINUTES: whole(30, 5, 480),
  AUTH_SESSION_ABSOLUTE_HOURS: whole(8, 1, 24),
  TURNSTILE_SITE_KEY: text(200),
  TURNSTILE_SECRET_KEY: text(200),
});

/** The most output tokens a role gets on the free tier unless the operator says otherwise. */
export const DEFAULT_ROLE_MAX_OUTPUT_TOKENS: Readonly<Record<ModelRole, number>> = {
  'research-planner': 1_000,
  extraction: 1_500,
  actor: 1_200,
  scenario: 1_500,
  critic: 1_500,
  synthesis: 2_000,
};

function roleCaps(value: string | undefined): Partial<Record<ModelRole, number>> {
  if (value === undefined) return { ...DEFAULT_ROLE_MAX_OUTPUT_TOKENS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid server configuration: FREE_ROLE_MAX_OUTPUT_TOKENS.');
  }
  const schema = z.partialRecord(z.enum(MODEL_ROLES), z.int().min(100).max(16_000));
  const checked = schema.safeParse(parsed);
  if (!checked.success)
    throw new Error('Invalid server configuration: FREE_ROLE_MAX_OUTPUT_TOKENS.');
  return { ...DEFAULT_ROLE_MAX_OUTPUT_TOKENS, ...checked.data };
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function baseUrl(value: string | undefined): { url: string; secure: boolean; host: string } {
  if (!value) {
    throw new Error('SWARM_EDITION=public needs PUBLIC_BASE_URL, the https address people open.');
  }
  if (!URL.canParse(value)) throw new Error('Invalid server configuration: PUBLIC_BASE_URL.');
  const url = new URL(value);
  const local = LOCAL_HOSTS.has(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      'PUBLIC_BASE_URL must be an https origin with no path, query or credentials (http is allowed only on localhost).',
    );
  }
  return { url: url.origin, secure: url.protocol === 'https:', host: url.hostname.toLowerCase() };
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

/**
 * The public edition's configuration. `environment` is the process environment. Everything that must hold for the
 * edition to be safe to start is checked here, so that a mistake fails at start-up and says which setting is wrong.
 */
export function loadPublicConfig(environment: Record<string, string | undefined>): PublicConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(
      `Invalid server configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}.`,
    );
  }
  const input = parsed.data;
  const base = baseUrl(input.PUBLIC_BASE_URL);

  const pair = (
    id: string | undefined,
    secret: string | undefined,
    name: string,
  ): ProviderCredentials | null => {
    if (id === undefined && secret === undefined) return null;
    if (id === undefined || secret === undefined) {
      throw new Error(
        `${name}_CLIENT_ID and ${name}_CLIENT_SECRET must be set together, or neither.`,
      );
    }
    return { clientId: id, clientSecret: secret };
  };
  const providers = {
    google: pair(input.PUBLIC_GOOGLE_CLIENT_ID, input.PUBLIC_GOOGLE_CLIENT_SECRET, 'PUBLIC_GOOGLE'),
    github: pair(input.PUBLIC_GITHUB_CLIENT_ID, input.PUBLIC_GITHUB_CLIENT_SECRET, 'PUBLIC_GITHUB'),
  };
  if (!providers.google && !providers.github && !input.PUBLIC_GUEST_MODE) {
    throw new Error(
      'SWARM_EDITION=public needs a way to sign in, or guest mode: set PUBLIC_GOOGLE_CLIENT_ID and _CLIENT_SECRET, or PUBLIC_GITHUB_CLIENT_ID and _CLIENT_SECRET, or PUBLIC_GUEST_MODE=true (visitors then need no sign-in).',
    );
  }
  if (!input.PUBLIC_PEPPER) {
    throw new Error(
      'SWARM_EDITION=public needs PUBLIC_PEPPER, a secret of at least 32 characters that keys the hashes of addresses and deleted accounts.',
    );
  }
  if ((input.TURNSTILE_SITE_KEY === undefined) !== (input.TURNSTILE_SECRET_KEY === undefined)) {
    throw new Error(
      'TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together, or neither.',
    );
  }
  const free: FreeTierConfig = {
    enabled: input.FREE_TIER_ENABLED,
    userDailyTokens: input.FREE_USER_DAILY_TOKENS,
    userDailyCalls: input.FREE_USER_DAILY_CALLS,
    userLifetimeTokens: input.FREE_USER_LIFETIME_TOKENS,
    userConcurrentRuns: input.FREE_USER_CONCURRENT_RUNS,
    userConcurrentCalls: input.FREE_USER_CONCURRENT_CALLS,
    globalDailyTokens: input.FREE_GLOBAL_DAILY_TOKENS,
    globalDailyCostUsd: input.FREE_GLOBAL_DAILY_COST_USD,
    tokensPerRun: input.FREE_TOKENS_PER_RUN,
    roleMaxOutputTokens: roleCaps(input.FREE_ROLE_MAX_OUTPUT_TOKENS),
    guest: {
      dailyTokens: input.FREE_GUEST_DAILY_TOKENS,
      dailyCalls: input.FREE_GUEST_DAILY_CALLS,
      lifetimeTokens: input.FREE_GUEST_LIFETIME_TOKENS,
      concurrentRuns: input.FREE_GUEST_CONCURRENT_RUNS,
      concurrentCalls: input.FREE_GUEST_CONCURRENT_CALLS,
      tokensPerRun: input.FREE_GUEST_TOKENS_PER_RUN,
    },
  };
  return {
    host: base.host,
    baseUrl: base.url,
    secureCookies: base.secure,
    providers,
    adminEmails: new Set(list(input.PUBLIC_ADMIN_EMAILS)),
    signupsEnabled: input.PUBLIC_SIGNUPS_ENABLED,
    guestMode: input.PUBLIC_GUEST_MODE,
    guests: {
      perIpPerHour: input.PUBLIC_GUESTS_PER_IP_PER_HOUR,
      perHour: input.PUBLIC_GUESTS_PER_HOUR,
      retentionHours: input.PUBLIC_GUEST_RETENTION_HOURS,
    },
    blockedEmailDomains: new Set(list(input.PUBLIC_BLOCKED_EMAIL_DOMAINS)),
    maxProjects: input.PUBLIC_MAX_PROJECTS,
    storageQuotaBytes: input.PUBLIC_STORAGE_QUOTA_MB * 1_000_000,
    deletedAccountRetentionDays: input.PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS,
    allowResearch: input.PUBLIC_ALLOW_RESEARCH,
    runtimeRole: input.PUBLIC_DB_RUNTIME_ROLE,
    allowUnsafeSqlite: input.PUBLIC_ALLOW_UNSAFE_SQLITE,
    opsKeySha256: input.PUBLIC_OPS_KEY_SHA256 ?? null,
    ownerKeySha256: input.PUBLIC_OWNER_KEY_SHA256 ?? null,
    pepper: input.PUBLIC_PEPPER,
    signups: {
      perIpPerDay: input.PUBLIC_SIGNUPS_PER_IP_PER_DAY,
      perHour: input.PUBLIC_SIGNUPS_PER_HOUR,
    },
    rates: {
      writesPer5Min: input.PUBLIC_RATE_WRITES_PER_5MIN,
      createPerHour: input.PUBLIC_RATE_CREATE_PER_HOUR,
      storePerHour: input.PUBLIC_RATE_STORE_PER_HOUR,
      modelPerHour: input.PUBLIC_RATE_MODEL_PER_HOUR,
      fetchPerHour: input.PUBLIC_RATE_FETCH_PER_HOUR,
      extractPerHour: input.PUBLIC_RATE_EXTRACT_PER_HOUR,
    },
    free,
    byok: { enabled: input.BYOK_ENABLED, maxConcurrentCalls: input.BYOK_MAX_CONCURRENT_CALLS },
    session: {
      idleMinutes: input.AUTH_SESSION_IDLE_MINUTES,
      absoluteHours: input.AUTH_SESSION_ABSOLUTE_HOURS,
    },
    turnstile:
      input.TURNSTILE_SITE_KEY !== undefined && input.TURNSTILE_SECRET_KEY !== undefined
        ? { siteKey: input.TURNSTILE_SITE_KEY, secretKey: input.TURNSTILE_SECRET_KEY }
        : null,
    allowReasoningDeployment: input.PUBLIC_ALLOW_REASONING_DEPLOYMENT,
  };
}

/** Names that identify a model family that reasons: a deployment with one of them is refused for the free tier. */
const REASONING_FAMILIES = /(?:^|[-_.])(?:o[1-9](?:[-_.]|$)|gpt-5)/iu;

/**
 * What the free tier must not be configured with. A deployment that reasons spends hidden tokens against its output
 * limit, and one with no price cannot be held to a cost cap. Returns the problems, in words for the operator.
 */
export function freeTierModelProblems(input: {
  freeEnabled: boolean;
  configured: boolean;
  deployment: string | null;
  declaredReasoning: boolean;
  reasoningDeploymentSet: boolean;
  priced: boolean;
  allowReasoning: boolean;
}): string[] {
  const problems: string[] = [];
  if (input.reasoningDeploymentSet) {
    problems.push(
      'FOUNDRY_DEPLOYMENT_REASONING is set. The public edition does not use a reasoning deployment for anyone: unset it.',
    );
  }
  if (!input.freeEnabled || !input.configured) return problems;
  if (!input.deployment) {
    problems.push('AI_MODEL is empty: the free tier needs the name of a non-reasoning deployment.');
  } else if (
    !input.allowReasoning &&
    (input.declaredReasoning || REASONING_FAMILIES.test(input.deployment))
  ) {
    problems.push(
      'The free tier’s deployment is a reasoning model (declared in FOUNDRY_DEPLOYMENT_PROFILES, or by its name). Use a non-reasoning deployment such as gpt-4.1-mini.',
    );
  }
  if (!input.priced) {
    problems.push(
      'The free tier’s deployment has no price in MODEL_PRICES. A cost cap is never enforced from a guessed price.',
    );
  }
  return problems;
}
