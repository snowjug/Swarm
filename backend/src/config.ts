import { resolve } from 'node:path';
import { z } from 'zod';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, MAX_SURVEY_TARGETS } from '../../shared/guided.js';
import {
  MAX_DOCUMENTS,
  APP_VERSION,
  MAX_DOCUMENT_CHARS,
  MAX_PROJECTS,
  MAX_TOTAL_CHARS,
  type AppConfig,
  type ProviderAuthMode,
  type ProviderName,
} from '../../shared/types.js';

export type ProviderAuth = ProviderAuthMode;

export interface ProviderConfig {
  name: ProviderName;
  model: string | null;
  baseUrl: string | null;
  /** Only populated for `api-key` auth; Entra ID never stores a credential in configuration. */
  apiKey: string | null;
  auth: ProviderAuth;
  /** User-assigned managed identity client ID for hosted Entra auth (non-secret). */
  managedIdentityClientId: string | null;
  configured: boolean;
  reason: string;
  timeoutMs: number;
}

export interface SessionConfig {
  /** The application (client) ID of the Entra app registration that people sign in to. */
  clientId: string;
  /** Where Entra sends the browser back with the code: https, or http on a loopback host. */
  redirectUri: string;
  /** The tenant segment of the authority: the one allowed tenant, or `organizations` for several. */
  authorityTenant: string;
  /**
   * Optional credential of a confidential client, supplied by a secret store and never by source. The
   * flow is Authorization Code with PKCE either way, so a registration without a secret works.
   */
  clientSecret: string | null;
  /**
   * `managed-identity`: the token call is authenticated with a token of the application's managed
   * identity (workload identity federation) instead of a secret, so that nothing needs to be stored.
   * Needs a federated credential on the app registration; mutually exclusive with `clientSecret`.
   */
  clientAssertion: 'managed-identity' | null;
  /** A session ends after this long without a request. */
  idleMinutes: number;
  /** A session ends this long after sign-in, whatever is happening. */
  absoluteHours: number;
  /** Cookies are Secure and `__Host-` prefixed, except on a plain-http loopback redirect (development). */
  secureCookies: boolean;
}

export interface AuthConfig {
  /**
   * `none`: one local user, no sign-in (the default, meant for a loopback address).
   * `entra`: every API call needs a Microsoft Entra access token, or a session that was started by
   * signing in with Microsoft Entra through this server (`session`).
   */
  mode: 'none' | 'entra';
  /** Entra tenants whose tokens are accepted (lower-case GUIDs). Empty when `mode` is `none`. */
  tenants: ReadonlySet<string>;
  /** The `aud` claim a token must carry: this API's application ID URI or client ID. */
  audience: string | null;
  /** Where token signing keys are fetched. HTTPS only. Null when `mode` is `none`. */
  jwksUri: string | null;
  /** Browser sign-in. Null when only bearer tokens are accepted. */
  session: SessionConfig | null;
}

export interface ServerConfig {
  host: string;
  port: number;
  /** The SQLite file. Used when `databaseUrl` is null. */
  databasePath: string;
  /** A `postgres://` URL for the database of a hosted deployment. Never contains a password when `databaseAuth` is `entra`. */
  databaseUrl: string | null;
  /** `entra`: the password is a Microsoft Entra access token, fetched for each connection. */
  databaseAuth: 'password' | 'entra';
  allowedOrigins: Set<string>;
  allowedHosts: Set<string>;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'silent';
  provider: ProviderConfig;
  auth: AuthConfig;
  sourceUrl: string | null;
  storageWarning: string | null;
  /** Multiplies every per-IP request limit. Default 1; raise only for automated tests/load tests. */
  rateLimitScale: number;
  /**
   * How many reverse proxies sit in front of the server and are trusted to say who the caller is
   * (`X-Forwarded-For`). 0 (the default) trusts none: the caller is the peer address. Behind one proxy,
   * such as a container platform's ingress, set 1; otherwise every caller appears to be the proxy and
   * the per-address rate limit is shared by everyone. Never set it when the port can be reached directly.
   */
  trustedProxies: number;
  /**
   * What this process does with the job queue. `all` (the default) serves requests and runs jobs;
   * `api` serves requests and only queues jobs; `worker` runs jobs from the queue and answers health
   * probes. Any number of each may share one database.
   */
  role: 'all' | 'api' | 'worker';
  /** How long a worker may go without a heartbeat before its job is handed to another. */
  jobLeaseMs: number;
}

const syncedFolders: readonly [string, RegExp][] = [
  ['OneDrive', /^onedrive(?: - .+)?$/iu],
  ['Dropbox', /^dropbox(?: .+)?$/iu],
  ['Google Drive', /^google ?drive$/iu],
  ['iCloud Drive', /^icloud ?drive$/iu],
];

/** Returns the cloud-sync product whose folder contains the path, if any. */
export function detectSyncedFolder(path: string): string | null {
  const segments = path.split(/[\\/]+/u);
  for (const [label, pattern] of syncedFolders) {
    if (segments.some((segment) => pattern.test(segment))) return label;
  }
  return null;
}

function storageWarning(databasePath: string): string | null {
  const provider = detectSyncedFolder(databasePath);
  if (!provider) return null;
  return (
    `DATA_DIR is inside a ${provider} synchronized folder. SQLite write-ahead files can conflict or ` +
    `corrupt there, and your source documents and results would be uploaded to that service. ` +
    `Set DATA_DIR to a local, non-synchronized directory.`
  );
}

/**
 * The PostgreSQL connection URL, checked so that a mistake fails at start-up and says which setting
 * is wrong, without ever repeating the URL (it can hold a password).
 */
function buildDatabaseUrl(value: string | undefined, auth: 'password' | 'entra'): string | null {
  if (!value) {
    if (auth === 'entra') throw new Error('DATABASE_AUTH=entra needs DATABASE_URL.');
    return null;
  }
  if (!/^postgres(?:ql)?:\/\//iu.test(value) || !URL.canParse(value)) {
    throw new Error('DATABASE_URL must be a postgres:// URL.');
  }
  const url = new URL(value);
  if (!url.hostname || url.pathname.length < 2 || !url.username) {
    throw new Error('DATABASE_URL must name a host, a database and a user.');
  }
  if (auth === 'entra' && url.password) {
    throw new Error(
      'DATABASE_AUTH=entra authenticates with a token: leave the password out of DATABASE_URL.',
    );
  }
  return value;
}

const environmentSchema = z.object({
  HOST: z.enum(['127.0.0.1', 'localhost', '0.0.0.0', '::']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  DATA_DIR: z.string().trim().min(1).default('./data'),
  DATABASE_URL: z.string().trim().max(1_000).optional(),
  DATABASE_AUTH: z.enum(['password', 'entra']).default('password'),
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,[::1]'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  AI_PROVIDER: z.enum(['none', 'ollama', 'openai', 'azure']).default('none'),
  AI_MODEL: z.string().trim().max(150).default(''),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(120_000),
  AZURE_OPENAI_AUTH: z.enum(['entra', 'key']).default('entra'),
  AZURE_CLIENT_ID: z.uuid().optional(),
  SOURCE_URL: z.string().trim().default(''),
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(1_000).default(1),
  AUTH_MODE: z.enum(['none', 'entra']).default('none'),
  AUTH_ENTRA_TENANT_ID: z.uuid().optional(),
  AUTH_ENTRA_ALLOWED_TENANTS: z.string().optional(),
  AUTH_ENTRA_AUDIENCE: z.string().trim().min(1).max(200).optional(),
  AUTH_ENTRA_JWKS_URI: z.string().trim().optional(),
  AUTH_ENTRA_CLIENT_ID: z.uuid().optional(),
  AUTH_ENTRA_REDIRECT_URI: z.string().trim().optional(),
  AUTH_ENTRA_CLIENT_SECRET: z.string().trim().min(1).max(500).optional(),
  AUTH_ENTRA_CLIENT_ASSERTION: z.enum(['managed-identity']).optional(),
  AUTH_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
  AUTH_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  SWARM_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(30),
});

/** Microsoft publishes one signing-key set for all tenants; the token's own tenant is checked separately. */
const ENTRA_JWKS = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function buildSession(
  input: z.infer<typeof environmentSchema>,
  tenants: ReadonlySet<string>,
): SessionConfig | null {
  const clientId = input.AUTH_ENTRA_CLIENT_ID;
  const redirect = input.AUTH_ENTRA_REDIRECT_URI;
  if (!clientId && !redirect) return null;
  if (!clientId || !redirect) {
    throw new Error(
      'Browser sign-in needs both AUTH_ENTRA_CLIENT_ID and AUTH_ENTRA_REDIRECT_URI, or neither.',
    );
  }
  if (!URL.canParse(redirect)) throw new Error('AUTH_ENTRA_REDIRECT_URI must be a valid URL.');
  const url = new URL(redirect);
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(
      'AUTH_ENTRA_REDIRECT_URI must be an HTTPS URL (http is allowed only on localhost).',
    );
  }
  if (url.pathname !== '/auth/callback' || url.search || url.hash || url.username || url.password) {
    throw new Error(
      'AUTH_ENTRA_REDIRECT_URI must end in /auth/callback, with no query or credentials.',
    );
  }
  if (input.AUTH_ENTRA_CLIENT_SECRET && input.AUTH_ENTRA_CLIENT_ASSERTION) {
    throw new Error(
      'Use AUTH_ENTRA_CLIENT_SECRET or AUTH_ENTRA_CLIENT_ASSERTION, not both: a client authenticates one way.',
    );
  }
  return {
    clientId: clientId.toLowerCase(),
    redirectUri: url.toString(),
    authorityTenant: tenants.size === 1 ? [...tenants][0]! : 'organizations',
    clientSecret: input.AUTH_ENTRA_CLIENT_SECRET ?? null,
    clientAssertion: input.AUTH_ENTRA_CLIENT_ASSERTION ?? null,
    idleMinutes: input.AUTH_SESSION_IDLE_MINUTES,
    absoluteHours: input.AUTH_SESSION_ABSOLUTE_HOURS,
    secureCookies: url.protocol === 'https:',
  };
}

function buildAuth(input: z.infer<typeof environmentSchema>): AuthConfig {
  if (input.AUTH_MODE === 'none') {
    return { mode: 'none', tenants: new Set(), audience: null, jwksUri: null, session: null };
  }
  const listed = (input.AUTH_ENTRA_ALLOWED_TENANTS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (listed.some((tenant) => !z.uuid().safeParse(tenant).success)) {
    throw new Error('AUTH_ENTRA_ALLOWED_TENANTS must be a comma-separated list of tenant GUIDs.');
  }
  const tenants = new Set([
    ...(input.AUTH_ENTRA_TENANT_ID ? [input.AUTH_ENTRA_TENANT_ID.toLowerCase()] : []),
    ...listed,
  ]);
  // Failing closed: a server asked to authenticate must never start in a state that accepts anyone.
  if (tenants.size === 0) {
    throw new Error(
      'AUTH_MODE=entra needs AUTH_ENTRA_TENANT_ID (or AUTH_ENTRA_ALLOWED_TENANTS) so that a token’s tenant can be checked.',
    );
  }
  if (!input.AUTH_ENTRA_AUDIENCE) {
    throw new Error(
      'AUTH_MODE=entra needs AUTH_ENTRA_AUDIENCE, the application ID URI or client ID that tokens are issued for.',
    );
  }
  const jwksUri = input.AUTH_ENTRA_JWKS_URI || ENTRA_JWKS;
  if (!URL.canParse(jwksUri) || new URL(jwksUri).protocol !== 'https:') {
    throw new Error('AUTH_ENTRA_JWKS_URI must be an HTTPS URL.');
  }
  return {
    mode: 'entra',
    tenants,
    audience: input.AUTH_ENTRA_AUDIENCE,
    jwksUri,
    session: buildSession(input, tenants),
  };
}

type EndpointResult = { valid: true; url: string } | { valid: false; reason: string };

const AZURE_AI_HOSTS = [
  '.openai.azure.com',
  '.cognitiveservices.azure.com',
  '.services.ai.azure.com',
] as const;

function endpoint(value: string, provider: Exclude<ProviderName, 'none'>): EndpointResult {
  if (!URL.canParse(value)) {
    return { valid: false, reason: 'Use a valid absolute server URL.' };
  }
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    return {
      valid: false,
      reason: 'Endpoint credentials, query strings and fragments are not supported.',
    };
  }
  const localHosts = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'ollama'];
  const localOllama = provider === 'ollama' && localHosts.includes(url.hostname);
  if (url.protocol !== 'https:' && !(localOllama && url.protocol === 'http:')) {
    return { valid: false, reason: 'Use HTTPS, or a local HTTP endpoint for Ollama.' };
  }
  if (provider === 'azure') {
    // A Microsoft Entra bearer token is sent to this host, so only Azure AI endpoints are allowed.
    if (!AZURE_AI_HOSTS.some((suffix) => url.hostname.toLowerCase().endsWith(suffix))) {
      return {
        valid: false,
        reason: `Azure endpoints must be on ${AZURE_AI_HOSTS.join(', ')}.`,
      };
    }
    if (url.pathname === '/') {
      url.pathname = '/openai/v1/';
    } else if (!/^\/openai\/v1\/?$/u.test(url.pathname)) {
      return { valid: false, reason: 'Azure requires a resource root or an /openai/v1/ endpoint.' };
    }
  }
  if (provider === 'ollama' && url.pathname !== '/') {
    return { valid: false, reason: 'Ollama requires a server root URL without an API path.' };
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return { valid: true, url: url.toString() };
}

function buildProvider(
  name: ProviderName,
  model: string,
  timeoutMs: number,
  environment: Record<string, string | undefined>,
  azureAuth: 'entra' | 'key',
  managedIdentityClientId: string | null,
): ProviderConfig {
  const base: ProviderConfig = {
    name,
    model: model || null,
    baseUrl: null,
    apiKey: null,
    auth: 'none',
    managedIdentityClientId: null,
    configured: false,
    reason: 'Local engine only. Configure a provider to enable model-assisted runs.',
    timeoutMs,
  };
  if (name === 'none') return base;
  if (!model) return { ...base, reason: 'Set AI_MODEL in the backend environment.' };
  const auth: ProviderAuth =
    name === 'ollama' ? 'none' : name === 'azure' && azureAuth === 'entra' ? 'entra' : 'api-key';
  const rawUrl =
    name === 'azure'
      ? environment.AZURE_OPENAI_ENDPOINT
      : name === 'ollama'
        ? environment.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
        : environment.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const key = name === 'azure' ? environment.AZURE_OPENAI_API_KEY : environment.OPENAI_API_KEY;
  if (!rawUrl) return { ...base, reason: 'Set AZURE_OPENAI_ENDPOINT in the backend environment.' };
  if (auth === 'api-key' && !key?.trim()) {
    return {
      ...base,
      reason: `Set ${name === 'azure' ? 'AZURE_OPENAI_API_KEY' : 'OPENAI_API_KEY'} in the backend environment.`,
    };
  }
  const checked = endpoint(rawUrl, name);
  if (!checked.valid) return { ...base, reason: `Invalid provider endpoint: ${checked.reason}` };
  return {
    ...base,
    baseUrl: checked.url,
    apiKey: auth === 'api-key' ? key?.trim() || null : null,
    auth,
    managedIdentityClientId: auth === 'entra' ? managedIdentityClientId : null,
    configured: true,
    // Describes configuration only. Whether the provider answers is the status endpoint's job, so
    // this text must stay true both before and after a successful connection check.
    reason:
      auth === 'entra'
        ? 'Microsoft Entra ID sign-in will be used (no API key). The signed-in identity needs the "Cognitive Services OpenAI User" role on the resource.'
        : 'Provider settings are present on the server.',
  };
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): ServerConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(
      `Invalid server configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}.`,
    );
  }
  const input = result.data;
  const origins = (
    input.ALLOWED_ORIGINS ??
    `http://localhost:5173,http://127.0.0.1:5173,http://localhost:${input.PORT},http://127.0.0.1:${input.PORT}`
  )
    .split(',')
    .map((value) => value.trim());
  for (const origin of origins) {
    if (!URL.canParse(origin))
      throw new Error('ALLOWED_ORIGINS must contain valid exact HTTP(S) origins.');
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths.');
    }
  }
  const hosts = input.ALLOWED_HOSTS.split(',').map((value) => value.trim().toLowerCase());
  if (hosts.some((host) => !host || /[/\\\s@?#]/u.test(host))) {
    throw new Error('ALLOWED_HOSTS must contain hostnames, not URLs or paths.');
  }
  let sourceUrl: string | null = null;
  if (input.SOURCE_URL) {
    if (!URL.canParse(input.SOURCE_URL))
      throw new Error('SOURCE_URL must be a valid public HTTPS URL.');
    const url = new URL(input.SOURCE_URL);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('SOURCE_URL must be a public HTTPS URL without embedded credentials.');
    }
    sourceUrl = url.toString();
  }
  const auth = buildAuth(input);
  if (auth.session && !hosts.includes(new URL(auth.session.redirectUri).hostname)) {
    throw new Error(
      'ALLOWED_HOSTS must include the host of AUTH_ENTRA_REDIRECT_URI, or Entra’s redirect would be refused.',
    );
  }
  const databasePath = resolve(input.DATA_DIR, 'swarm-lab.sqlite');
  const databaseUrl = buildDatabaseUrl(input.DATABASE_URL, input.DATABASE_AUTH);
  return {
    host: input.HOST,
    port: input.PORT,
    databasePath,
    databaseUrl,
    databaseAuth: input.DATABASE_AUTH,
    allowedOrigins: new Set(origins),
    allowedHosts: new Set(hosts),
    logLevel: input.LOG_LEVEL,
    provider: buildProvider(
      input.AI_PROVIDER,
      input.AI_MODEL,
      input.AI_TIMEOUT_MS,
      environment,
      input.AZURE_OPENAI_AUTH,
      input.AZURE_CLIENT_ID ?? null,
    ),
    sourceUrl,
    auth,
    storageWarning: databaseUrl ? null : storageWarning(databasePath),
    rateLimitScale: input.RATE_LIMIT_SCALE,
    trustedProxies: input.TRUST_PROXY,
    role: input.SWARM_ROLE,
    jobLeaseMs: input.JOB_LEASE_SECONDS * 1_000,
  };
}

export function publicConfig(config: ServerConfig): AppConfig {
  const { name, model, configured, reason, auth } = config.provider;
  return {
    version: APP_VERSION,
    // The endpoint, its host and any key stay server-side; only the auth *mode* is public.
    provider: { name, model, configured, reason, auth },
    limits: {
      maxDocuments: MAX_DOCUMENTS,
      maxDocumentChars: MAX_DOCUMENT_CHARS,
      maxTotalChars: MAX_TOTAL_CHARS,
      maxProjects: MAX_PROJECTS,
      maxQueuedRuns: 3,
      localMaxAgents: 24,
      localMaxRounds: 24,
      modelMaxAgents: 10,
      modelMaxRounds: 10,
      maxPdfBytes: MAX_PDF_BYTES,
      maxPdfPages: MAX_PDF_PAGES,
      maxSurveyTargets: MAX_SURVEY_TARGETS,
    },
    sourceUrl: config.sourceUrl,
    storage: { warning: config.storageWarning },
    capabilities: {
      local: true,
      modelAssisted: configured,
      fileTypes: ['txt', 'md', 'markdown', 'pdf'],
      pdf: true,
      webRetrieval: false,
      guidedConsole: true,
      surveys: true,
      whatIf: true,
      authentication:
        config.auth.mode === 'none'
          ? 'local-single-user'
          : config.auth.session
            ? 'entra-session'
            : 'entra',
    },
  };
}
