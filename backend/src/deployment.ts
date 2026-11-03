import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { APP_VERSION } from '../../shared/types.js';
import type { ServerConfig } from './config.js';
import { classifyAddress } from './ingest/url/policy.js';
import { observeDeployment } from './telemetry/product-signals.js';

/**
 * What kind of deployment this is, and the refusal to start one that is not what it says it is.
 *
 *   local       One person on their own machine. Exactly as permissive as it always was: nothing here
 *               adds a requirement to it.
 *   pilot       A controlled group on a hosted server. Starts only if it is safe to host.
 *   production  The same, and stricter where a pilot is allowed a choice.
 *
 * The rules are written as one function per topic that returns every problem it finds, so that a
 * start that is refused says everything to fix at once. The matrix, with the reason for each rule, is
 * in docs/production/identity.md. A message names a setting and what to do about it; it never repeats
 * a value, because a value can be a secret.
 */
export const DEPLOYMENT_MODES = ['local', 'pilot', 'production'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];
type Hosted = Exclude<DeploymentMode, 'local'>;
type Environment = Readonly<Record<string, string | undefined>>;

export interface DeploymentConfig {
  mode: DeploymentMode;
  /** What the product says about itself: shown to people, and never more than the deployment is. */
  label: string;
  build: { version: string; sha: string | null };
  /** Recommendations that did not stop the start; logged once when the application is built. */
  warnings: readonly string[];
}

/** Raised when a pilot or production deployment is configured in a way it must not run. */
export class DeploymentRefused extends Error {
  constructor(
    readonly mode: Hosted,
    readonly violations: readonly string[],
  ) {
    super(
      [
        `DEPLOYMENT_MODE=${mode} refuses to start: ${violations.length} unsafe setting${violations.length === 1 ? '' : 's'}.`,
        ...violations.map((violation, index) => `  ${index + 1}. ${violation}`),
        'Fix every item, or run with DEPLOYMENT_MODE=local on a machine that only you use. No credential, address or connection string is repeated above.',
      ].join('\n'),
    );
    this.name = 'DeploymentRefused';
  }
}

const MAX_LABEL = 80;
const DEFAULT_LABEL: Record<Exclude<DeploymentMode, 'production'>, string> = {
  local: 'LOCAL',
  pilot: 'PRODUCTION-CANDIDATE CONTROLLED PILOT',
};
/** The longest a hosted session may sit idle, and last in all. The application's own bounds are wider. */
const MAX_IDLE_MINUTES = 60;
const MAX_ABSOLUTE_HOURS = 12;
const MICROSOFT_KEYS_HOST = 'login.microsoftonline.com';
const TLS_MODES: ReadonlySet<string> = new Set(['require', 'verify-ca', 'verify-full']);
/** Names that exist only inside a network. They mirror `ingest/url/policy.ts`, and a test keeps them so. */
export const PRIVATE_SUFFIXES: readonly string[] = [
  'localhost',
  'local',
  'internal',
  'lan',
  'localdomain',
  'intranet',
  'corp',
  'home',
  'private',
  'home.arpa',
];

const OFF: ReadonlySet<string> = new Set(['', 'false', '0', 'no', 'off']);
/**
 * Whether a setting that loosens a rule is on. Anything that is not plainly "off" counts as on, so
 * that no spelling of it ("TRUE", " yes ", "1") slips past a check that looks for the word "true".
 */
const isOn = (value: string | undefined): boolean =>
  value !== undefined && !OFF.has(value.trim().toLowerCase());
/** Whether a setting that grants an exception is on. Only the plain word counts. */
const isTrue = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'true';

/** The names, in capitals, of the settings that match and are on, whatever the case they were written in. */
function activeSettings(environment: Environment, matches: (name: string) => boolean): string[] {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(environment)) {
    const name = key.toUpperCase();
    if (matches(name) && isOn(value)) names.add(name);
  }
  return [...names];
}

function readMode(environment: Environment): DeploymentMode {
  const raw = environment.DEPLOYMENT_MODE;
  if (raw === undefined) return 'local';
  const value = raw.trim().toLowerCase();
  const mode = DEPLOYMENT_MODES.find((candidate) => candidate === value);
  // A value that is not recognised is never read as local: that would be the permissive reading.
  if (!mode) {
    throw new Error(
      'Invalid server configuration: DEPLOYMENT_MODE must be local, pilot or production.',
    );
  }
  return mode;
}

// Letters, digits, punctuation, symbols and ordinary spaces: nothing that can hide text or move the
// cursor in a log or on a page (control, formatting and line-break characters are all refused), and
// no angle bracket, so that a label is never taken for markup.
const LABEL_CHARACTERS = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u;
const LABEL_MARKUP = /[<>]/u;
const LABEL_NAMES_PILOT = /\bpilot\b/iu;
const LABEL_CLAIMS_RELEASE =
  /\bproduction\b(?![\s-]candidate)|\bgeneral(?:ly)?[\s-]+availab|\bGA\b|\bpublic[\s-]+(?:production|release|launch)/iu;

/** The label to show, or what is wrong with the one given. It is judged as plain text, whatever its case or width. */
function readLabel(
  environment: Environment,
  mode: DeploymentMode,
): { label: string; problem: string | null } {
  const raw = environment.DEPLOYMENT_LABEL?.trim() ?? '';
  const fallback = mode === 'production' ? '' : DEFAULT_LABEL[mode];
  if (raw === '') {
    return {
      label: fallback,
      problem:
        mode === 'production'
          ? `DEPLOYMENT_LABEL is required in production: say in words what this deployment is, for the people who use it (up to ${MAX_LABEL} characters).`
          : null,
    };
  }
  const text = raw.normalize('NFKC').replace(/\s+/gu, ' ');
  if (!LABEL_CHARACTERS.test(raw) || LABEL_MARKUP.test(text) || text.length > MAX_LABEL) {
    return {
      label: fallback,
      problem: `DEPLOYMENT_LABEL must be plain text of 1 to ${MAX_LABEL} characters, with no control, formatting, line-break or angle-bracket characters.`,
    };
  }
  if (mode === 'pilot' && (!LABEL_NAMES_PILOT.test(text) || LABEL_CLAIMS_RELEASE.test(text))) {
    return {
      label: fallback,
      problem:
        'DEPLOYMENT_LABEL must say this is a pilot, and must not call it production, generally available or public: a pilot is never labelled as the broad public release. Leave it unset for the default.',
    };
  }
  if (mode === 'production' && LABEL_NAMES_PILOT.test(text)) {
    return {
      label: fallback,
      problem:
        'DEPLOYMENT_LABEL calls this production deployment a pilot: the label must describe the deployment as it is run.',
    };
  }
  return { label: text, problem: null };
}

const COMMIT = /^[0-9a-f]{7,40}$/u;

function readBuild(environment: Environment): { sha: string | null; malformed: boolean } {
  const raw = environment.BUILD_SHA?.trim().toLowerCase() ?? '';
  if (raw === '') return { sha: null, malformed: false };
  return COMMIT.test(raw) ? { sha: raw, malformed: false } : { sha: null, malformed: true };
}

interface Context {
  mode: Hosted;
  config: Omit<ServerConfig, 'deployment'>;
  environment: Environment;
}

function stripBrackets(host: string): string {
  return host.replace(/^\[(.*)\]$/u, '$1').replace(/\.$/u, '');
}

/** Names that a machine's own hosts file points at itself, besides `localhost`. */
const LOOPBACK_ALIASES: ReadonlySet<string> = new Set([
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

/** An address that only this machine can be reached at: a loopback name or address, or the unspecified one. */
function loopback(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (host === 'localhost' || host.endsWith('.localhost') || LOOPBACK_ALIASES.has(host))
    return true;
  if (isIP(host) === 0) return false;
  const verdict = classifyAddress(host);
  return !verdict.allowed && (verdict.reason === 'loopback' || verdict.reason === 'unspecified');
}

function authViolations({ config }: Context): string[] {
  const { auth } = config;
  if (auth.mode !== 'entra') {
    return [
      'AUTH_MODE is "none", so nobody would have to sign in. Set AUTH_MODE=entra with AUTH_ENTRA_TENANT_ID, AUTH_ENTRA_AUDIENCE, AUTH_ENTRA_CLIENT_ID and AUTH_ENTRA_REDIRECT_URI.',
    ];
  }
  const found: string[] = [];
  const { session } = auth;
  if (!session) {
    found.push(
      'AUTH_ENTRA_CLIENT_ID and AUTH_ENTRA_REDIRECT_URI are not set, so people could not sign in from the page and only API clients that hold an access token could get in. Set both.',
    );
  } else {
    if (!session.secureCookies) {
      found.push(
        'AUTH_ENTRA_REDIRECT_URI is not an https address, so the session cookie would not be Secure. Use https://<the address people open>/auth/callback.',
      );
    }
    if (loopback(new URL(session.redirectUri).hostname)) {
      found.push(
        'AUTH_ENTRA_REDIRECT_URI names a loopback address. Use the address people open, derived from the deployed host name.',
      );
    }
    if (session.idleMinutes > MAX_IDLE_MINUTES) {
      found.push(
        `AUTH_SESSION_IDLE_MINUTES is ${session.idleMinutes}: a hosted session may sit idle for at most ${MAX_IDLE_MINUTES} minutes.`,
      );
    }
    if (session.absoluteHours > MAX_ABSOLUTE_HOURS) {
      found.push(
        `AUTH_SESSION_ABSOLUTE_HOURS is ${session.absoluteHours}: a hosted session may last at most ${MAX_ABSOLUTE_HOURS} hours in all.`,
      );
    }
  }
  if (auth.jwksUri && new URL(auth.jwksUri).hostname.toLowerCase() !== MICROSOFT_KEYS_HOST) {
    found.push(
      'AUTH_ENTRA_JWKS_URI is not Microsoft’s key endpoint, so tokens signed by keys fetched from anywhere else would be accepted. Leave it unset.',
    );
  }
  return found;
}

const MODEL_KEYS = ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY'] as const;
const ENDPOINT_SETTING = {
  azure: 'AZURE_OPENAI_ENDPOINT',
  openai: 'OPENAI_BASE_URL',
  ollama: 'OLLAMA_BASE_URL',
} as const;

function modelViolations({ mode, config, environment }: Context): string[] {
  const { provider } = config;
  const found: string[] = [];
  const keyed =
    provider.name === 'openai' ||
    provider.auth === 'api-key' ||
    (provider.name === 'azure' && environment.AZURE_OPENAI_AUTH === 'key');
  if (keyed && mode === 'production') {
    found.push(
      'The model provider is set up with an API key (AI_PROVIDER=openai, or AZURE_OPENAI_AUTH=key). Production uses Microsoft Entra and a managed identity only: set AI_PROVIDER=azure with AZURE_OPENAI_AUTH=entra, or AI_PROVIDER=none. ALLOW_MODEL_API_KEY does not apply here.',
    );
  } else if (keyed && !isTrue(environment.ALLOW_MODEL_API_KEY)) {
    found.push(
      'The model provider is set up with an API key (AI_PROVIDER=openai, or AZURE_OPENAI_AUTH=key). Use AI_PROVIDER=azure with AZURE_OPENAI_AUTH=entra, or record the decision to accept a key in a pilot with ALLOW_MODEL_API_KEY=true.',
    );
  }
  if (!keyed && mode === 'production') {
    const present = MODEL_KEYS.filter((name) => (environment[name] ?? '').trim() !== '');
    if (present.length > 0) {
      found.push(
        `${present.join(' and ')} ${present.length === 1 ? 'is' : 'are'} set although no model key is used. A production process holds no model credential: remove ${present.length === 1 ? 'it' : 'them'}.`,
      );
    }
  }
  if (provider.name !== 'none' && provider.baseUrl && !provider.baseUrl.startsWith('https://')) {
    found.push(
      `${ENDPOINT_SETTING[provider.name]} is not an https address, so model traffic would not be encrypted. Use https://.`,
    );
  }
  return found;
}

function databaseViolations({ mode, config }: Context): string[] {
  if (config.databaseUrl === null) {
    return mode === 'production'
      ? [
          'DATABASE_URL is not set, so storage would be a SQLite file on one machine. Production needs PostgreSQL: set DATABASE_URL to a postgres:// address with sslmode=require.',
        ]
      : [];
  }
  const found: string[] = [];
  const modes = new URL(config.databaseUrl).searchParams
    .getAll('sslmode')
    .map((value) => value.trim().toLowerCase());
  if (modes.length !== 1 || !TLS_MODES.has(modes[0] ?? '')) {
    found.push(
      'DATABASE_URL does not require TLS. Add sslmode=require (or verify-ca, or verify-full): disable, allow, prefer, a repeated sslmode and no sslmode at all are refused.',
    );
  }
  if (mode === 'production' && config.databaseAuth !== 'entra') {
    found.push(
      'DATABASE_AUTH is "password". Production signs in to the database with a managed identity: set DATABASE_AUTH=entra and leave the password out of DATABASE_URL.',
    );
  }
  return found;
}

function hostViolations({ config, environment }: Context): string[] {
  const found: string[] = [];
  if (environment.ALLOWED_HOSTS === undefined) {
    found.push(
      'ALLOWED_HOSTS is not set, so only localhost would be served. List the host names people open, and nothing else.',
    );
  } else {
    const kinds = { wildcard: false, loopback: false, invalid: false };
    for (const entry of config.allowedHosts) {
      if (entry.includes('*')) {
        kinds.wildcard = true;
        continue;
      }
      try {
        const { hostname } = new URL(`https://${entry}`);
        if (hostname === '') kinds.invalid = true;
        else if (loopback(hostname)) kinds.loopback = true;
      } catch {
        kinds.invalid = true;
      }
    }
    if (kinds.wildcard) {
      found.push(
        'ALLOWED_HOSTS has a wildcard. List the exact host names; a wildcard would also accept a name an attacker points at this server.',
      );
    }
    if (kinds.loopback) {
      found.push(
        'ALLOWED_HOSTS lists localhost or a loopback address. A hosted deployment serves its own host names only.',
      );
    }
    if (kinds.invalid) {
      found.push('ALLOWED_HOSTS has an entry that is not a host name or an IP address.');
    }
  }
  if (environment.ALLOWED_ORIGINS === undefined) {
    found.push(
      'ALLOWED_ORIGINS is not set, so only http://localhost origins would be allowed. List the https origin people open.',
    );
  } else {
    const origins = [...config.allowedOrigins].map((origin) => new URL(origin));
    if (origins.some((origin) => origin.protocol !== 'https:')) {
      found.push('ALLOWED_ORIGINS has an origin that is not https. List https origins only.');
    }
    if (origins.some((origin) => loopback(origin.hostname))) {
      found.push(
        'ALLOWED_ORIGINS lists localhost or a loopback address. A hosted deployment allows its own origin only.',
      );
    }
    const session = config.auth.session;
    if (session && !config.allowedOrigins.has(new URL(session.redirectUri).origin)) {
      found.push(
        'ALLOWED_ORIGINS does not include the origin of AUTH_ENTRA_REDIRECT_URI, so every change made from the page would be refused. List that origin.',
      );
    }
  }
  if (config.trustedProxies < 1) {
    found.push(
      'TRUST_PROXY is 0. Behind the platform’s ingress every caller would look like the proxy and share one rate limit. Set it to the number of proxies in front of the server (1 behind one ingress).',
    );
  }
  return found;
}

const APPLICATION_INSIGHTS =
  /^InstrumentationKey=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:;[A-Za-z]+=[^;\s]+)*;?$/iu;
/** Settings that let a page be read over plain HTTP, or from a private address, however they are spelt. */
const INSECURE_FETCH =
  /^(?:RESEARCH|URL_INGEST(?:ION)?|CRAWL(?:ER)?|FETCH(?:ER)?)_ALLOW_(?:HTTP|INSECURE|PLAINTEXT|CLEARTEXT|DOWNGRADE|PRIVATE|LOOPBACK|LOCALHOST|INTERNAL|METADATA)(?:_\w+)?$/u;
const SEAM_PREFIXES = [
  'SWARM_TEST_',
  'SWARM_DEMO_',
  'SWARM_SEED_',
  'SWARM_E2E_',
  'SWARM_FIXTURE_',
  'SWARM_FAKE_',
  'E2E_',
] as const;
const SEAM_NAMES: ReadonlySet<string> = new Set([
  'DEMO_MODE',
  'DEMO_ENDPOINTS',
  'ENABLE_DEMO',
  'ENABLE_DEMO_ENDPOINTS',
  'SEED_ENDPOINTS',
  'ENABLE_SEED_ENDPOINTS',
  'ENABLE_TEST_ROUTES',
  'ENABLE_TEST_ENDPOINTS',
]);

const privateSuffix = (host: string): string | undefined =>
  PRIVATE_SUFFIXES.find((suffix) => {
    const name = host.replace(/^\*\./u, '');
    return name === suffix || name.endsWith(`.${suffix}`);
  });

function ingestViolations({ config, environment }: Context): string[] {
  const found: string[] = [];
  if (
    environment.URL_INGEST_ALLOWED_PORTS !== undefined &&
    config.urlIngestion.allowedPorts.includes(80)
  ) {
    found.push(
      'URL_INGEST_ALLOWED_PORTS includes 80, which reads pages over plain HTTP, where anyone on the path can change them before they become evidence. Use 443.',
    );
  }
  for (const name of activeSettings(environment, (candidate) => INSECURE_FETCH.test(candidate))) {
    found.push(
      `${name} is on, which lets pages be read over plain HTTP or from a private address. Remove it, or set it to false.`,
    );
  }
  const internal = [...new Set(config.urlIngestion.allowedHosts.map(privateSuffix))].filter(
    (suffix): suffix is string => suffix !== undefined,
  );
  if (internal.length > 0) {
    found.push(
      `URL_INGEST_ALLOWED_HOSTS lists names under a private suffix (${internal.map((suffix) => `.${suffix}`).join(', ')}). Such names never resolve to a public address; list public host names only.`,
    );
  }
  return found;
}

function operationViolations({ mode, config, environment }: Context): string[] {
  const found: string[] = [];
  const connection = environment.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim() ?? '';
  if (connection === '') {
    found.push(
      'APPLICATIONINSIGHTS_CONNECTION_STRING is not set. A pilot or production deployment must be observable: set it.',
    );
  } else if (!APPLICATION_INSIGHTS.test(connection)) {
    found.push(
      'APPLICATIONINSIGHTS_CONNECTION_STRING is not a valid Application Insights connection string, so no telemetry would be sent.',
    );
  }
  if (mode === 'production' && config.logLevel === 'debug') {
    found.push('LOG_LEVEL is debug. Production logs at info or above.');
  }
  if (config.rateLimitScale > 1) {
    found.push(
      `RATE_LIMIT_SCALE is ${config.rateLimitScale}. It must be 1: a larger value removes the per-address limits and exists only for load tests and automated browser tests.`,
    );
  }
  const seams = activeSettings(
    environment,
    (name) => SEAM_NAMES.has(name) || SEAM_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
  for (const name of seams) {
    found.push(
      `${name} is set. It exists for tests or demonstrations and must not be set in a hosted deployment.`,
    );
  }
  const verification = environment.NODE_TLS_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (verification === '0' || verification === 'false') {
    found.push(
      'NODE_TLS_REJECT_UNAUTHORIZED switches certificate checking off for every outgoing connection. Remove it.',
    );
  }
  return found;
}

/** Every reason this configuration must not run as `mode`; empty when it is safe to host. */
export function deploymentViolations(
  mode: Hosted,
  config: Omit<ServerConfig, 'deployment'>,
  environment: Environment,
): string[] {
  const context: Context = { mode, config, environment };
  return [
    ...authViolations(context),
    ...modelViolations(context),
    ...databaseViolations(context),
    ...hostViolations(context),
    ...ingestViolations(context),
    ...operationViolations(context),
  ];
}

/**
 * A local run that is set up like a hosted one has probably been given no mode by mistake, and then
 * none of the pilot or production checks ran. It still starts, exactly as it always did, and says so.
 */
function hostedLooking(config: Omit<ServerConfig, 'deployment'>): string[] {
  const signs: string[] = [];
  const elsewhere = (host: string): boolean => {
    try {
      return !loopback(new URL(`https://${host}`).hostname);
    } catch {
      return true;
    }
  };
  if ([...config.allowedHosts].some(elsewhere))
    signs.push('ALLOWED_HOSTS names a host that is not this machine');
  if (config.auth.session?.secureCookies) signs.push('AUTH_ENTRA_REDIRECT_URI is an https address');
  if (config.databaseUrl && elsewhere(new URL(config.databaseUrl).hostname)) {
    signs.push('DATABASE_URL names another machine');
  }
  return signs.length === 0
    ? []
    : [
        `This looks like a hosted deployment (${signs.join('; ')}) but DEPLOYMENT_MODE is local, so none of the pilot or production checks ran. Set DEPLOYMENT_MODE=pilot or production.`,
      ];
}

function warningsOf(config: Context['config'], environment: Environment): string[] {
  const found: string[] = [];
  if (config.databaseUrl === null) {
    found.push(
      'Storage is a SQLite file, which one instance can use. Production needs PostgreSQL.',
    );
  } else if (config.databaseAuth !== 'entra') {
    found.push(
      'DATABASE_AUTH is "password". Signing in to the database with a managed identity (DATABASE_AUTH=entra) is recommended, and production requires it.',
    );
  }
  if (config.provider.auth === 'api-key') {
    found.push('A model API key is in use (ALLOW_MODEL_API_KEY=true). Production refuses one.');
  } else if (MODEL_KEYS.some((name) => (environment[name] ?? '').trim() !== '')) {
    found.push(
      'A model API key is set although none is used. Remove it: production refuses to start with one.',
    );
  }
  if (config.auth.session?.clientSecret) {
    found.push(
      'AUTH_ENTRA_CLIENT_SECRET is in use. AUTH_ENTRA_CLIENT_ASSERTION=managed-identity needs no stored secret and is preferred.',
    );
  }
  if (config.logLevel === 'silent') {
    found.push('LOG_LEVEL is silent, so a failure would leave no log line.');
  }
  if ((environment.BUILD_SHA ?? '').trim() === '') {
    found.push('BUILD_SHA is not set, so the running build cannot be matched to a commit.');
  }
  return found;
}

/**
 * A pilot or production deployment reads pages over HTTPS only, unless it was told otherwise (and
 * then it is refused). Local keeps the ports it has always had.
 */
function hostedDefaults(
  config: Omit<ServerConfig, 'deployment'>,
  environment: Environment,
): Omit<ServerConfig, 'deployment'> {
  if (environment.URL_INGEST_ALLOWED_PORTS !== undefined) return config;
  return { ...config, urlIngestion: { ...config.urlIngestion, allowedPorts: [443] } };
}

/**
 * Applies the deployment mode to a configuration that has been read and checked as it always was.
 * `local` returns it as it is, with its name. A pilot or production configuration is refused, with
 * every violation in one error, or accepted with the defaults of a hosted deployment.
 */
export function withDeployment(
  environment: Environment,
  load: () => Omit<ServerConfig, 'deployment'>,
): ServerConfig {
  const mode = readMode(environment);
  const labelled = readLabel(environment, mode);
  const build = readBuild(environment);
  const base = load();
  const identity = { version: APP_VERSION, sha: build.sha };
  if (mode === 'local') {
    if (labelled.problem) throw new Error(labelled.problem);
    return {
      ...base,
      deployment: { mode, label: labelled.label, build: identity, warnings: hostedLooking(base) },
    };
  }
  const config = hostedDefaults(base, environment);
  const violations = [
    ...(labelled.problem ? [labelled.problem] : []),
    ...(build.malformed
      ? ['BUILD_SHA is not a commit id: use 7 to 40 hexadecimal characters, or leave it unset.']
      : []),
    ...deploymentViolations(mode, config, environment),
  ];
  if (violations.length > 0) throw new DeploymentRefused(mode, violations);
  return {
    ...config,
    deployment: {
      mode,
      label: labelled.label,
      build: identity,
      warnings: warningsOf(config, environment),
    },
  };
}

/**
 * Tells the log what this process is, and the monitoring too (`swarm.deployment.info`). A local run
 * says nothing, as it never did; a hosted one says what it is and what was recommended and not done.
 */
export function registerDeployment(app: FastifyInstance, deployment: DeploymentConfig): void {
  if (deployment.mode !== 'local') {
    app.log.info(
      {
        mode: deployment.mode,
        label: deployment.label,
        version: deployment.build.version,
        build: deployment.build.sha ?? 'unknown',
      },
      'Deployment.',
    );
  }
  for (const warning of deployment.warnings) app.log.warn(warning);
  const stop = observeDeployment(() => ({
    mode: deployment.mode,
    version: deployment.build.version,
    sha: deployment.build.sha,
  }));
  app.addHook('onClose', async () => stop());
}
