import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { loadConfig, publicConfig } from '../src/config.js';
import { APPLICATION_INSIGHTS, DeploymentRefused, PRIVATE_SUFFIXES } from '../src/deployment.js';
import { validateUrl } from '../src/ingest/url/policy.js';
import { Repository } from '../src/storage/repository.js';
import { TENANT_A, authorization, idp } from './support/entra-idp.js';
import { telemetryHarness } from './support/telemetry-harness.js';

const telemetry = telemetryHarness();

type Environment = Record<string, string | undefined>;
type Hosted = 'pilot' | 'production';

const HOST = 'swarm.example.test';
const CLIENT = 'cccccccc-0000-4000-8000-0000000000aa';
const INSIGHTS =
  'InstrumentationKey=00000000-0000-4000-8000-0000000000aa;IngestionEndpoint=https://eastus2-0.in.applicationinsights.azure.com/';
const DATABASE = 'postgres://swarm-identity@db.example.test:5432/swarm';

/** A configuration that a pilot or production deployment may start with: every rule is met. */
function hosted(mode: Hosted, change: Environment = {}): Environment {
  const environment: Environment = {
    DEPLOYMENT_MODE: mode,
    DEPLOYMENT_LABEL: mode === 'production' ? 'Strategy desk decision lab' : undefined,
    AUTH_MODE: 'entra',
    AUTH_ENTRA_TENANT_ID: TENANT_A,
    AUTH_ENTRA_AUDIENCE: 'api://swarm-test',
    AUTH_ENTRA_CLIENT_ID: CLIENT,
    AUTH_ENTRA_REDIRECT_URI: `https://${HOST}/auth/callback`,
    ALLOWED_HOSTS: HOST,
    ALLOWED_ORIGINS: `https://${HOST}`,
    TRUST_PROXY: '1',
    DATABASE_URL: `${DATABASE}?sslmode=require`,
    DATABASE_AUTH: 'entra',
    AI_PROVIDER: 'azure',
    AI_MODEL: 'a-deployment',
    AZURE_OPENAI_ENDPOINT: 'https://swarm-dev.openai.azure.com',
    APPLICATIONINSIGHTS_CONNECTION_STRING: INSIGHTS,
    LOG_LEVEL: 'info',
    BUILD_SHA: 'a1b2c3d4e5f6',
    ...change,
  };
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete environment[name];
  }
  return environment;
}

/** What a start with this configuration is refused for; empty when it starts. */
function refusals(environment: Environment): string[] {
  try {
    loadConfig(environment);
  } catch (error) {
    if (error instanceof DeploymentRefused) return [...error.violations];
    throw error;
  }
  return [];
}

describe('the deployment mode', () => {
  it('is local unless it is named, and a local run carries only its name', () => {
    expect(loadConfig({}).deployment).toEqual({
      mode: 'local',
      label: 'LOCAL',
      build: { version: APP_VERSION, sha: null },
      warnings: [],
    });
  });

  it.each([
    ['PRODUCTION', 'production'],
    [' Pilot ', 'pilot'],
  ] as const)('reads %j whatever its case or spacing', (written, mode) => {
    expect(loadConfig(hosted(mode, { DEPLOYMENT_MODE: written })).deployment.mode).toBe(mode);
    expect(loadConfig({ DEPLOYMENT_MODE: ' LOCAL ' }).deployment.mode).toBe('local');
  });

  it.each(['', '  ', 'prod', 'staging', 'production\u200b', 'pro\u0434uction', 'local,pilot'])(
    'never reads %j as local: a mode that is not recognised stops the start',
    (written) => {
      expect(() => loadConfig({ DEPLOYMENT_MODE: written })).toThrow('DEPLOYMENT_MODE');
      expect(() => loadConfig(hosted('pilot', { DEPLOYMENT_MODE: written }))).toThrow(
        'DEPLOYMENT_MODE',
      );
    },
  );
});

describe('a local run', () => {
  // Each of these was accepted before the deployment mode existed, and is exactly what a pilot or
  // production deployment must refuse. A local run still has to start with all of them.
  const permissive: [string, Environment][] = [
    ['no sign-in on every interface', { HOST: '0.0.0.0', AUTH_MODE: 'none' }],
    [
      'the loopback allow-lists written out',
      { ALLOWED_HOSTS: 'localhost,127.0.0.1,[::1]', ALLOWED_ORIGINS: 'http://localhost:5173' },
    ],
    ['a raised rate limit', { RATE_LIMIT_SCALE: '1000' }],
    ['debug logs', { LOG_LEVEL: 'debug' }],
    [
      'a database without TLS',
      { DATABASE_URL: 'postgres://user:canary-pw@localhost:5432/swarm?sslmode=disable' },
    ],
    [
      'a model API key',
      {
        AI_PROVIDER: 'openai',
        AI_MODEL: 'm',
        OPENAI_API_KEY: 'canary-key',
        OPENAI_BASE_URL: 'https://api.openai.example/v1',
      },
    ],
    ['a local model over http', { AI_PROVIDER: 'ollama', AI_MODEL: 'm' }],
    ['no proxy trusted', { TRUST_PROXY: '0' }],
    [
      'plain HTTP pages and a private suffix',
      { URL_INGEST_ALLOWED_PORTS: '80,443', URL_INGEST_ALLOWED_HOSTS: 'printer.local' },
    ],
    [
      'a plain-HTTP research switch and a test seam',
      { RESEARCH_ALLOW_HTTP: 'true', SWARM_TEST_DATABASE: 'pglite' },
    ],
    ['certificate checking off', { NODE_TLS_REJECT_UNAUTHORIZED: '0' }],
    ['a malformed build id', { BUILD_SHA: 'not-a-commit' }],
  ];

  it.each(permissive)('still starts with %s', (_name, environment) => {
    const config = loadConfig(environment);
    expect(config.deployment.mode).toBe('local');
    expect(config.deployment.warnings).toEqual([]);
    // The same configuration, with the mode said out loud, is the same configuration.
    expect(loadConfig({ ...environment, DEPLOYMENT_MODE: 'local' })).toEqual(config);
  });

  it('keeps every value it was given and every default it always had', () => {
    const config = loadConfig({
      RATE_LIMIT_SCALE: '50',
      TRUST_PROXY: '0',
      LOG_LEVEL: 'debug',
      AUTH_MODE: 'none',
      URL_INGEST_ALLOWED_PORTS: '80',
    });
    expect(config.rateLimitScale).toBe(50);
    expect(config.trustedProxies).toBe(0);
    expect(config.logLevel).toBe('debug');
    expect(config.auth.mode).toBe('none');
    expect(config.urlIngestion.allowedPorts).toEqual([80]);
    const defaults = loadConfig({});
    expect(defaults.urlIngestion.allowedPorts).toEqual([80, 443]);
    expect([...defaults.allowedHosts]).toEqual(['localhost', '127.0.0.1', '[::1]']);
    expect([...defaults.allowedOrigins]).toContain('http://127.0.0.1:3001');
    expect(defaults.host).toBe('127.0.0.1');
  });

  it('judges the one new setting that can stop it, the label, as plain text', () => {
    expect(loadConfig({ DEPLOYMENT_LABEL: 'My laptop' }).deployment.label).toBe('My laptop');
    for (const label of [
      'a'.repeat(81),
      'two\nlines',
      'hidden\u202etext',
      'zero\u200bwidth',
      '<b>bold</b>',
      '＜script＞',
    ])
      expect(() => loadConfig({ DEPLOYMENT_LABEL: label })).toThrow('DEPLOYMENT_LABEL');
  });

  it('starts, and says so, when it is set up like a hosted deployment but was given no mode', () => {
    const forgotten = hosted('pilot', { DEPLOYMENT_MODE: undefined });
    const config = loadConfig(forgotten);
    expect(config.deployment.mode).toBe('local');
    expect(config.deployment.warnings).toEqual([
      expect.stringMatching(
        /^This looks like a hosted deployment \(ALLOWED_HOSTS names a host that is not this machine; AUTH_ENTRA_REDIRECT_URI is an https address; DATABASE_URL names another machine\) but DEPLOYMENT_MODE is local, so none of the pilot or production checks ran\. Set DEPLOYMENT_MODE=pilot or production\.$/u,
      ),
    ]);
    // It is still exactly as permissive as before: nothing is refused.
    expect(
      loadConfig({ ...forgotten, AUTH_MODE: 'none', RATE_LIMIT_SCALE: '50' }).rateLimitScale,
    ).toBe(50);
    expect(loadConfig({ ALLOWED_HOSTS: 'swarm.example.test' }).deployment.warnings).toEqual([
      expect.stringContaining('(ALLOWED_HOSTS names a host that is not this machine)'),
    ]);
    expect(loadConfig({ ALLOWED_HOSTS: 'localhost,127.0.0.1,[::1]' }).deployment.warnings).toEqual(
      [],
    );
    expect(JSON.stringify(config.deployment.warnings)).not.toMatch(
      /swarm\.example\.test|db\.example\.test/u,
    );
  });

  it('ignores a build id it cannot read instead of refusing to start', () => {
    expect(loadConfig({ BUILD_SHA: 'v1.2' }).deployment.build.sha).toBeNull();
    expect(loadConfig({ BUILD_SHA: ' A1B2C3D ' }).deployment.build.sha).toBe('a1b2c3d');
  });
});

describe('the baseline that the guards are measured against', () => {
  it.each(['pilot', 'production'] as const)('is accepted as %s, with nothing to refuse', (mode) => {
    expect(refusals(hosted(mode))).toEqual([]);
    expect(loadConfig(hosted(mode)).deployment.mode).toBe(mode);
  });
});

interface Rule {
  name: string;
  /** The modes that refuse it. */
  modes: readonly Hosted[];
  /** Applied to the baseline. */
  change: Environment;
  /** What the refusal says: the setting, and what is wrong. */
  says: RegExp;
  /** How many things this change is refused for in all. */
  count?: number;
  /** Changes to the baseline, each of which makes the same setting acceptable. */
  fixed: Environment[];
}

const BOTH: readonly Hosted[] = ['pilot', 'production'];
const PRODUCTION: readonly Hosted[] = ['production'];
const sslmode = (value: string): Environment => ({ DATABASE_URL: `${DATABASE}?sslmode=${value}` });
const openai: Environment = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'a-model',
  OPENAI_API_KEY: 'canary-api-key',
  OPENAI_BASE_URL: 'https://api.openai.example/v1',
};
const withoutOpenai: Environment = {
  AI_PROVIDER: 'none',
  AI_MODEL: undefined,
  AZURE_OPENAI_ENDPOINT: undefined,
};

const RULES: Rule[] = [
  {
    name: 'sign-in is off',
    modes: BOTH,
    change: { AUTH_MODE: 'none' },
    says: /AUTH_MODE is "none"/u,
    fixed: [{ AUTH_MODE: 'entra' }],
  },
  {
    name: 'sign-in was never set up',
    modes: BOTH,
    change: { AUTH_MODE: undefined },
    says: /AUTH_MODE is "none"/u,
    fixed: [{}],
  },
  {
    name: 'people cannot sign in from the page',
    modes: BOTH,
    change: { AUTH_ENTRA_CLIENT_ID: undefined, AUTH_ENTRA_REDIRECT_URI: undefined },
    says: /AUTH_ENTRA_CLIENT_ID and AUTH_ENTRA_REDIRECT_URI are not set/u,
    fixed: [{}],
  },
  {
    name: 'the session cookie would not be Secure, and the redirect is a loopback address',
    modes: BOTH,
    change: {
      AUTH_ENTRA_REDIRECT_URI: 'http://localhost:3001/auth/callback',
      ALLOWED_HOSTS: `${HOST},localhost`,
    },
    says: /AUTH_ENTRA_REDIRECT_URI is not an https address/u,
    // Not https; loopback; the host list holds localhost; the origin list lacks the sign-in origin.
    count: 4,
    fixed: [{}],
  },
  {
    name: 'a session may idle for too long',
    modes: BOTH,
    change: { AUTH_SESSION_IDLE_MINUTES: '61' },
    says: /AUTH_SESSION_IDLE_MINUTES is 61/u,
    fixed: [{ AUTH_SESSION_IDLE_MINUTES: '60' }, { AUTH_SESSION_IDLE_MINUTES: '5' }],
  },
  {
    name: 'a session may last too long',
    modes: BOTH,
    change: { AUTH_SESSION_ABSOLUTE_HOURS: '13' },
    says: /AUTH_SESSION_ABSOLUTE_HOURS is 13/u,
    fixed: [{ AUTH_SESSION_ABSOLUTE_HOURS: '12' }, { AUTH_SESSION_ABSOLUTE_HOURS: '1' }],
  },
  ...[
    'https://keys.example.test/jwks',
    'https://login.microsoftonline.com.evil.example.test/keys',
    'https://login.microsoftonline.com@evil.example.test/keys',
  ].map((keys): Rule => ({
    name: `the signing keys are fetched from ${keys}`,
    modes: BOTH,
    change: { AUTH_ENTRA_JWKS_URI: keys },
    says: /AUTH_ENTRA_JWKS_URI is not Microsoft/u,
    fixed: [
      { AUTH_ENTRA_JWKS_URI: undefined },
      { AUTH_ENTRA_JWKS_URI: 'https://LOGIN.MICROSOFTONLINE.COM/common/discovery/v2.0/keys' },
    ],
  })),
  {
    name: 'the model uses an API key through the OpenAI-compatible provider',
    modes: BOTH,
    change: openai,
    says: /set up with an API key/u,
    fixed: [{ ...withoutOpenai, OPENAI_API_KEY: undefined }],
  },
  {
    name: 'the model uses an API key through Azure',
    modes: BOTH,
    change: { AZURE_OPENAI_AUTH: 'key', AZURE_OPENAI_API_KEY: 'canary-azure-key' },
    says: /set up with an API key/u,
    fixed: [{ AZURE_OPENAI_AUTH: 'entra', AZURE_OPENAI_API_KEY: undefined }],
  },
  {
    name: 'a key-based provider has not been given its key yet',
    modes: BOTH,
    change: { AI_PROVIDER: 'openai', AI_MODEL: 'a-model' },
    says: /set up with an API key/u,
    fixed: [withoutOpenai],
  },
  ...['http://127.0.0.1:11434', 'HTTP://LOCALHOST:11434'].map((endpoint): Rule => ({
    name: `the model endpoint is ${endpoint}`,
    modes: BOTH,
    change: { AI_PROVIDER: 'ollama', AI_MODEL: 'a-model', OLLAMA_BASE_URL: endpoint },
    says: /OLLAMA_BASE_URL is not an https address/u,
    fixed: [
      {
        AI_PROVIDER: 'ollama',
        AI_MODEL: 'a-model',
        OLLAMA_BASE_URL: 'https://models.example.test',
      },
    ],
  })),
  ...[
    '',
    'disable',
    'allow',
    'prefer',
    'no-verify',
    'require&sslmode=disable',
    'disable&sslmode=require',
  ].map((mode): Rule => ({
    name: `the database is asked for sslmode=${mode || '(nothing)'}`,
    modes: BOTH,
    change: sslmode(mode),
    says: /DATABASE_URL does not require TLS/u,
    fixed: [
      sslmode('require'),
      sslmode('verify-ca'),
      sslmode('verify-full'),
      sslmode('%20VERIFY-FULL'),
    ],
  })),
  {
    name: 'the database is given no sslmode at all',
    modes: BOTH,
    change: { DATABASE_URL: DATABASE },
    says: /DATABASE_URL does not require TLS/u,
    fixed: [{}],
  },
  {
    name: 'the database is a SQLite file',
    modes: PRODUCTION,
    change: { DATABASE_URL: undefined, DATABASE_AUTH: 'password' },
    says: /DATABASE_URL is not set/u,
    fixed: [{}],
  },
  {
    name: 'the database is signed in to with a password',
    modes: PRODUCTION,
    change: {
      DATABASE_AUTH: 'password',
      DATABASE_URL: 'postgres://swarm:canary-password@db.example.test:5432/swarm?sslmode=require',
    },
    says: /DATABASE_AUTH is "password"/u,
    fixed: [{}],
  },
  {
    name: 'the allowed hosts were never set (and nor was sign-in, which would have named one)',
    modes: BOTH,
    change: {
      ALLOWED_HOSTS: undefined,
      AUTH_ENTRA_CLIENT_ID: undefined,
      AUTH_ENTRA_REDIRECT_URI: undefined,
    },
    says: /ALLOWED_HOSTS is not set/u,
    count: 2,
    fixed: [{}],
  },
  ...[`${HOST},*`, `${HOST},*.example.test`].map((hosts): Rule => ({
    name: `the allowed hosts hold a wildcard (${hosts})`,
    modes: BOTH,
    change: { ALLOWED_HOSTS: hosts },
    says: /ALLOWED_HOSTS has a wildcard/u,
    fixed: [{}],
  })),
  ...[
    'localhost',
    'LOCALHOST',
    'app.localhost',
    '127.0.0.1',
    '127.1',
    '2130706433',
    '0x7f.0.0.1',
    '[::1]',
    '[::ffff:127.0.0.1]',
    '0.0.0.0',
    'localhost.localdomain',
    'IP6-LOCALHOST',
    'ip6-loopback',
  ].map((host): Rule => ({
    name: `the allowed hosts hold a loopback address (${host})`,
    modes: BOTH,
    change: { ALLOWED_HOSTS: `${HOST},${host}` },
    says: /ALLOWED_HOSTS lists localhost or a loopback address/u,
    fixed: [{ ALLOWED_HOSTS: `${HOST},other.example.test` }],
  })),
  {
    name: 'the allowed origins were never set',
    modes: BOTH,
    change: { ALLOWED_ORIGINS: undefined },
    says: /ALLOWED_ORIGINS is not set/u,
    fixed: [{}],
  },
  {
    name: 'an allowed origin is not https',
    modes: BOTH,
    change: { ALLOWED_ORIGINS: `https://${HOST},http://other.example.test` },
    says: /ALLOWED_ORIGINS has an origin that is not https/u,
    fixed: [{ ALLOWED_ORIGINS: `https://${HOST},https://other.example.test` }],
  },
  ...['https://localhost', 'https://127.0.0.1:8443', 'https://[::1]'].map((origin): Rule => ({
    name: `an allowed origin is loopback (${origin})`,
    modes: BOTH,
    change: { ALLOWED_ORIGINS: `https://${HOST},${origin}` },
    says: /ALLOWED_ORIGINS lists localhost or a loopback address/u,
    fixed: [{}],
  })),
  {
    name: 'the sign-in origin is not among the allowed origins',
    modes: BOTH,
    change: { ALLOWED_ORIGINS: 'https://other.example.test' },
    says: /does not include the origin of AUTH_ENTRA_REDIRECT_URI/u,
    fixed: [{ ALLOWED_ORIGINS: `https://other.example.test,https://${HOST}` }],
  },
  {
    name: 'no proxy is trusted',
    modes: BOTH,
    change: { TRUST_PROXY: '0' },
    says: /TRUST_PROXY is 0/u,
    fixed: [{ TRUST_PROXY: '1' }, { TRUST_PROXY: '2' }],
  },
  {
    name: 'no telemetry is configured',
    modes: BOTH,
    change: { APPLICATIONINSIGHTS_CONNECTION_STRING: undefined },
    says: /APPLICATIONINSIGHTS_CONNECTION_STRING is not set/u,
    fixed: [{}],
  },
  {
    name: 'the telemetry connection string is not one',
    modes: BOTH,
    change: {
      APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=canary-not-a-guid;Secret=canary',
    },
    says: /APPLICATIONINSIGHTS_CONNECTION_STRING is not a valid/u,
    fixed: [{}],
  },
  ...['80,443', ' 443 , 80 ', '80'].map((ports): Rule => ({
    name: `pages may be read over plain HTTP (URL_INGEST_ALLOWED_PORTS=${JSON.stringify(ports)})`,
    modes: BOTH,
    change: { URL_INGEST_ALLOWED_PORTS: ports },
    says: /URL_INGEST_ALLOWED_PORTS includes 80/u,
    fixed: [
      { URL_INGEST_ALLOWED_PORTS: '443' },
      { URL_INGEST_ALLOWED_PORTS: ' 443, 8443 ' },
      { URL_INGEST_ALLOWED_PORTS: undefined },
    ],
  })),
  ...['true', 'TRUE', ' True ', '1', 'yes', 'on', 'enabled', 'y', 'tru'].map((value): Rule => ({
    name: `research may downgrade to HTTP (RESEARCH_ALLOW_HTTP=${JSON.stringify(value)})`,
    modes: BOTH,
    change: { RESEARCH_ALLOW_HTTP: value },
    says: /RESEARCH_ALLOW_HTTP is on/u,
    fixed: [
      { RESEARCH_ALLOW_HTTP: undefined },
      ...['false', 'FALSE', ' false ', '0', 'no', 'off', ''].map((off) => ({
        RESEARCH_ALLOW_HTTP: off,
      })),
    ],
  })),
  {
    name: 'a switch in another spelling lets a page be read from a private address',
    modes: BOTH,
    change: { url_ingest_allow_private: 'true' },
    says: /URL_INGEST_ALLOW_PRIVATE is on/u,
    fixed: [{ url_ingest_allow_private: 'false' }],
  },
  {
    name: 'a research switch allows loopback',
    modes: BOTH,
    change: { RESEARCH_ALLOW_LOOPBACK: '1' },
    says: /RESEARCH_ALLOW_LOOPBACK is on/u,
    fixed: [{ RESEARCH_ALLOW_LOOPBACK: '0' }],
  },
  ...PRIVATE_SUFFIXES.flatMap((suffix): Rule[] => [
    {
      name: `the allow-list names a host under .${suffix}`,
      modes: BOTH,
      change: { URL_INGEST_ALLOWED_HOSTS: `example.com,printer.${suffix}` },
      says: new RegExp(`private suffix \\(.*\\.${suffix.replace('.', '\\.')}[,)]`, 'u'),
      fixed: [{ URL_INGEST_ALLOWED_HOSTS: 'example.com,*.example.org' }],
    },
    {
      name: `the allow-list names a wildcard under .${suffix}`,
      modes: BOTH,
      change: { URL_INGEST_ALLOWED_HOSTS: `*.printer.${suffix}` },
      says: /private suffix/u,
      fixed: [{ URL_INGEST_ALLOWED_HOSTS: undefined }],
    },
  ]),
  {
    name: 'the allow-list is written in capitals',
    modes: BOTH,
    change: { URL_INGEST_ALLOWED_HOSTS: 'FILES.CORP,Example.COM' },
    says: /private suffix \(\.corp\)/u,
    fixed: [{ URL_INGEST_ALLOWED_HOSTS: 'FILES.CORPORATE.EXAMPLE.COM' }],
  },
  {
    name: 'production logs at debug level',
    modes: PRODUCTION,
    change: { LOG_LEVEL: 'debug' },
    says: /LOG_LEVEL is debug/u,
    fixed: [{ LOG_LEVEL: 'info' }, { LOG_LEVEL: 'warn' }],
  },
  {
    name: 'the rate limit is raised',
    modes: BOTH,
    change: { RATE_LIMIT_SCALE: '2' },
    says: /RATE_LIMIT_SCALE is 2/u,
    fixed: [{ RATE_LIMIT_SCALE: '1' }],
  },
  ...(
    [
      ['SWARM_TEST_DATABASE', 'pglite'],
      ['swarm_test_database', 'pglite'],
      ['SWARM_TEST_ANYTHING', 'x'],
      ['E2E_LOCAL_PORT', '3111'],
      ['DEMO_MODE', 'true'],
      ['ENABLE_DEMO_ENDPOINTS', '1'],
      ['enable_seed_endpoints', 'YES'],
    ] as const
  ).map(([name, value]): Rule => ({
    name: `a test or demonstration seam is set (${name}=${value})`,
    modes: BOTH,
    change: { [name]: value },
    says: new RegExp(`${name.toUpperCase()} is set`, 'u'),
    fixed: [{ [name]: undefined }, { [name]: 'false' }],
  })),
  {
    name: 'certificate checking is off',
    modes: BOTH,
    change: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    says: /NODE_TLS_REJECT_UNAUTHORIZED switches certificate checking off/u,
    fixed: [{ NODE_TLS_REJECT_UNAUTHORIZED: '1' }, { NODE_TLS_REJECT_UNAUTHORIZED: undefined }],
  },
  {
    name: 'the build id is not a commit',
    modes: BOTH,
    change: { BUILD_SHA: 'latest' },
    says: /BUILD_SHA is not a commit id/u,
    fixed: [{ BUILD_SHA: 'ABCDEF0' }, { BUILD_SHA: undefined }],
  },
];

describe.each(BOTH)('%s refuses to start', (mode) => {
  for (const rule of RULES.filter((candidate) => candidate.modes.includes(mode))) {
    it(`when ${rule.name}, and starts once that is fixed`, () => {
      const found = refusals(hosted(mode, rule.change));
      expect(found, found.join('\n')).toHaveLength(rule.count ?? 1);
      expect(
        found.some((line) => rule.says.test(line)),
        found.join('\n'),
      ).toBe(true);
      for (const fixed of rule.fixed) {
        expect(refusals(hosted(mode, fixed)), JSON.stringify(fixed)).toEqual([]);
      }
    });
  }

  it('does not refuse a rule that belongs to the other mode', () => {
    for (const rule of RULES.filter((candidate) => !candidate.modes.includes(mode))) {
      expect(refusals(hosted(mode, rule.change)), rule.name).toEqual([]);
    }
  });
});

describe('what a pilot may decide that production may not', () => {
  it.each(['true', 'TRUE', ' True '])(
    'may use a model API key when the decision is recorded (ALLOW_MODEL_API_KEY=%j)',
    (allow) => {
      const config = loadConfig(hosted('pilot', { ...openai, ALLOW_MODEL_API_KEY: allow }));
      expect(config.provider.auth).toBe('api-key');
      expect(config.deployment.warnings.join(' ')).toContain('Production refuses one');
    },
  );

  it.each(['1', 'yes', 'on', 'false', '', 'ture'])(
    'is not let off by ALLOW_MODEL_API_KEY=%j: only the plain word counts',
    (allow) => {
      expect(refusals(hosted('pilot', { ...openai, ALLOW_MODEL_API_KEY: allow }))).toHaveLength(1);
    },
  );

  it('is refused the key in production whatever that says, and is told so', () => {
    const found = refusals(hosted('production', { ...openai, ALLOW_MODEL_API_KEY: 'true' }));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('ALLOW_MODEL_API_KEY does not apply here');
  });

  it('may run on a SQLite file, and on a password for the database, with a warning for each', () => {
    const config = loadConfig(
      hosted('pilot', {
        DATABASE_URL: undefined,
        DATABASE_AUTH: 'password',
        OPENAI_API_KEY: 'canary-unused-key',
        BUILD_SHA: undefined,
      }),
    );
    expect(config.deployment.warnings).toEqual([
      expect.stringContaining('SQLite'),
      expect.stringContaining('API key is set although none is used'),
      expect.stringContaining('BUILD_SHA is not set'),
    ]);
    const password = loadConfig(
      hosted('pilot', {
        DATABASE_AUTH: 'password',
        DATABASE_URL: 'postgres://swarm:canary-pw@db.example.test:5432/swarm?sslmode=verify-full',
      }),
    );
    expect(password.deployment.warnings.join(' ')).toContain('DATABASE_AUTH is "password"');
  });

  it('is refused a model key it does not use only in production', () => {
    expect(refusals(hosted('production', { OPENAI_API_KEY: 'canary-unused-key' }))).toEqual([
      expect.stringContaining('OPENAI_API_KEY is set although no model key is used'),
    ]);
    expect(refusals(hosted('production', { OPENAI_API_KEY: '  ' }))).toEqual([]);
    expect(
      refusals(
        hosted('production', { OPENAI_API_KEY: 'canary-a', AZURE_OPENAI_API_KEY: 'canary-b' }),
      ),
    ).toEqual([expect.stringContaining('AZURE_OPENAI_API_KEY and OPENAI_API_KEY are set')]);
  });

  it('logs silently only with a warning', () => {
    expect(loadConfig(hosted('pilot', { LOG_LEVEL: 'silent' })).deployment.warnings).toEqual([
      expect.stringContaining('LOG_LEVEL is silent'),
    ]);
  });
});

describe('the label', () => {
  it('is the pilot label by default, and a pilot is only ever labelled as one', () => {
    expect(loadConfig(hosted('pilot')).deployment.label).toBe(
      'PRODUCTION-CANDIDATE CONTROLLED PILOT',
    );
    expect(loadConfig(hosted('pilot', { DEPLOYMENT_LABEL: '   ' })).deployment.label).toBe(
      'PRODUCTION-CANDIDATE CONTROLLED PILOT',
    );
    for (const label of [
      'Strategy desk pilot',
      'PILOT',
      'Controlled pilot (production candidate)',
      'ＰＩＬＯＴ for the desk',
      'Production-candidate pilot',
    ]) {
      expect(
        loadConfig(hosted('pilot', { DEPLOYMENT_LABEL: label })).deployment.label,
        label,
      ).toMatch(/pilot/iu);
    }
    expect(
      loadConfig(hosted('pilot', { DEPLOYMENT_LABEL: ' pilot   with   spaces ' })).deployment.label,
    ).toBe('pilot with spaces');
  });

  it.each([
    'PRODUCTION',
    'Production',
    ' production ',
    'ＰＲＯＤＵＣＴＩＯＮ',
    'Production\u00a0release',
    'Pilot - general availability',
    'Pilot GA',
    'Pilot (generally available)',
    'Pilot: public release',
    'pilot production',
    'Controlled beta',
    'a'.repeat(81),
    'Pilot\nproduction candidate',
    'Pilot\u202e',
    'Pilot\u200b',
    '<b>Pilot</b>',
  ])('never calls a pilot %j', (label) => {
    const found = refusals(hosted('pilot', { DEPLOYMENT_LABEL: label }));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('DEPLOYMENT_LABEL');
  });

  it('is explicit in production, and does not call itself a pilot', () => {
    expect(loadConfig(hosted('production')).deployment.label).toBe('Strategy desk decision lab');
    for (const label of [undefined, '', '   ']) {
      expect(refusals(hosted('production', { DEPLOYMENT_LABEL: label }))).toEqual([
        expect.stringContaining('DEPLOYMENT_LABEL is required in production'),
      ]);
    }
    for (const label of ['Pilot', 'PRODUCTION-CANDIDATE CONTROLLED PILOT', 'ＰＩＬＯＴ']) {
      expect(refusals(hosted('production', { DEPLOYMENT_LABEL: label })), label).toEqual([
        expect.stringContaining('calls this production deployment a pilot'),
      ]);
    }
  });
});

describe('a refusal', () => {
  const everythingWrong: Environment = {
    DEPLOYMENT_MODE: 'production',
    AUTH_MODE: 'none',
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgres://swarm:canary-db-password@db.example.test:5432/swarm?sslmode=disable',
    DATABASE_AUTH: 'password',
    AI_PROVIDER: 'openai',
    AI_MODEL: 'a-model',
    OPENAI_API_KEY: 'canary-model-key-do-not-log',
    OPENAI_BASE_URL: 'https://api.openai.example/v1',
    AZURE_OPENAI_API_KEY: 'canary-azure-key-do-not-log',
    ALLOWED_HOSTS: '*,localhost',
    ALLOWED_ORIGINS: 'http://localhost:3001',
    TRUST_PROXY: '0',
    APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=canary-ikey;Secret=canary-secret',
    URL_INGEST_ALLOWED_PORTS: '80',
    URL_INGEST_ALLOWED_HOSTS: 'canary-files.corp',
    RESEARCH_ALLOW_HTTP: 'canary-true',
    LOG_LEVEL: 'debug',
    RATE_LIMIT_SCALE: '500',
    SWARM_TEST_DATABASE: 'canary-pglite',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    BUILD_SHA: 'canary-not-a-commit',
    DEPLOYMENT_LABEL: 'canary label that is far too long '.repeat(4),
  };

  function refusal(): DeploymentRefused {
    try {
      loadConfig(everythingWrong);
    } catch (error) {
      if (error instanceof DeploymentRefused) return error;
      throw error;
    }
    throw new Error('The configuration was accepted.');
  }

  it('lists every violation at once, in one error', () => {
    const refused = refusal();
    for (const setting of [
      'DEPLOYMENT_LABEL',
      'BUILD_SHA',
      'AUTH_MODE',
      'API key',
      'DATABASE_URL',
      'DATABASE_AUTH',
      'ALLOWED_HOSTS has a wildcard',
      'ALLOWED_HOSTS lists localhost',
      'ALLOWED_ORIGINS has an origin that is not https',
      'ALLOWED_ORIGINS lists localhost',
      'TRUST_PROXY',
      'APPLICATIONINSIGHTS_CONNECTION_STRING',
      'URL_INGEST_ALLOWED_PORTS',
      'URL_INGEST_ALLOWED_HOSTS',
      'RESEARCH_ALLOW_HTTP',
      'LOG_LEVEL',
      'RATE_LIMIT_SCALE',
      'SWARM_TEST_DATABASE',
      'NODE_TLS_REJECT_UNAUTHORIZED',
    ]) {
      expect(refused.message, setting).toContain(setting);
    }
    expect(refused.violations).toHaveLength(19);
    expect(refused.message).toContain('19 unsafe settings');
    expect(refused.message.split('\n').filter((line) => /^ {2}\d+\. /u.test(line))).toHaveLength(
      19,
    );
    expect(refused.message).toContain('DEPLOYMENT_MODE=local');
  });

  it('repeats no credential, no connection string, no address and none of what was configured', () => {
    const message = refusal().message;
    for (const value of Object.values(everythingWrong)) {
      if (value?.toLowerCase().includes('canary')) expect(message, value).not.toContain(value);
    }
    expect(message).not.toMatch(/canary/iu);
    expect(message).not.toMatch(/db\.example\.test|api\.openai\.example|localhost:3001/u);
  });

  it('says one setting in the singular', () => {
    expect(() => loadConfig(hosted('pilot', { TRUST_PROXY: '0' }))).toThrow(/1 unsafe setting\./u);
  });

  it('leaves a configuration error that is not about the deployment as it always was', () => {
    expect(() => loadConfig(hosted('pilot', { AUTH_ENTRA_AUDIENCE: undefined }))).toThrow(
      /AUTH_ENTRA_AUDIENCE/u,
    );
    expect(() => loadConfig(hosted('pilot', { PORT: 'invalid' }))).toThrow('PORT');
  });
});

describe('the defaults of a hosted deployment', () => {
  it('reads pages over HTTPS unless it is told otherwise, and local keeps its ports', () => {
    expect(loadConfig(hosted('pilot')).urlIngestion.allowedPorts).toEqual([443]);
    expect(loadConfig(hosted('production')).urlIngestion.allowedPorts).toEqual([443]);
    expect(
      loadConfig(hosted('pilot', { URL_INGEST_ALLOWED_PORTS: '443,8443' })).urlIngestion
        .allowedPorts,
    ).toEqual([443, 8443]);
    expect(loadConfig({}).urlIngestion.allowedPorts).toEqual([80, 443]);
  });
});

describe('the private suffixes the allow-list refuses', () => {
  it('are only names that the page fetcher itself refuses', () => {
    for (const suffix of PRIVATE_SUFFIXES) {
      expect(() => validateUrl(`https://printer.${suffix}/`), suffix).toThrow();
    }
    expect(() => validateUrl('https://printer.example.com/')).not.toThrow();
  });
});

describe('what the guard shares with the code it guards', () => {
  it('accepts the connection strings that telemetry accepts: the pattern is the same text', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/telemetry/azure-monitor.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain(String(APPLICATION_INSIGHTS));
  });

  it('shows the name of a setting only when it has the shape of one', () => {
    const refused = (change: Environment): string => {
      try {
        loadConfig(hosted('pilot', change));
      } catch (error) {
        if (error instanceof DeploymentRefused) return error.message;
        throw error;
      }
      throw new Error('The configuration was accepted.');
    };
    const odd = refused({ 'SWARM_TEST_canary-name-do-not-log': 'on' });
    expect(odd).toContain('a setting with an unusual name is set');
    expect(odd).not.toMatch(/canary/iu);
    expect(refused({ swarm_test_lower: 'on' })).toContain('SWARM_TEST_LOWER is set');
  });
});

describe('what the public configuration says', () => {
  it('names the deployment and the build, and nothing that is configured behind them', () => {
    const local = publicConfig(loadConfig({ BUILD_SHA: 'a1b2c3d' }));
    expect(local.deployment).toEqual({ mode: 'local', label: 'LOCAL' });
    expect(local.build).toEqual({ version: APP_VERSION, sha: 'a1b2c3d' });
    expect(publicConfig(loadConfig({})).build).toEqual({ version: APP_VERSION, sha: null });

    const shown = publicConfig(
      loadConfig(
        hosted('pilot', {
          DATABASE_AUTH: 'password',
          DATABASE_URL:
            'postgres://swarm:canary-db-password@db.example.test:5432/swarm?sslmode=require',
          AUTH_ENTRA_CLIENT_SECRET: 'canary-client-secret',
        }),
      ),
    );
    expect(shown.deployment).toEqual({
      mode: 'pilot',
      label: 'PRODUCTION-CANDIDATE CONTROLLED PILOT',
    });
    expect(shown.build?.sha).toBe('a1b2c3d4e5f6');
    const text = JSON.stringify(shown);
    for (const hidden of [
      'canary',
      'db.example.test',
      TENANT_A,
      CLIENT,
      'swarm-dev.openai',
      INSIGHTS,
      'warnings',
    ]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });
});

describe('a hosted application', () => {
  async function start(environment: Environment) {
    const lines: Record<string, unknown>[] = [];
    const config = loadConfig(environment);
    const harness = await buildApp({
      config,
      repository: new Repository(':memory:'),
      ...(config.auth.mode === 'entra'
        ? { tokenVerifier: new TokenVerifier(config.auth, idp.keys) }
        : {}),
      logStream: { write: (line: string) => void lines.push(JSON.parse(line)) },
    });
    return { ...harness, lines };
  }

  it('says what it is once, and what was recommended and not done; a local one says nothing', async () => {
    const pilot = await start(
      hosted('pilot', { DATABASE_URL: undefined, DATABASE_AUTH: 'password' }),
    );
    try {
      expect(pilot.lines.filter((entry) => entry.msg === 'Deployment.')).toEqual([
        expect.objectContaining({
          mode: 'pilot',
          label: 'PRODUCTION-CANDIDATE CONTROLLED PILOT',
          version: APP_VERSION,
          build: 'a1b2c3d4e5f6',
        }),
      ]);
      expect(pilot.lines.filter((entry) => entry.level === 40).map((entry) => entry.msg)).toEqual([
        expect.stringContaining('SQLite'),
      ]);
    } finally {
      await pilot.app.close();
    }

    const local = await start({ LOG_LEVEL: 'info' });
    try {
      expect(local.lines.filter((entry) => entry.msg === 'Deployment.')).toEqual([]);
      expect(local.lines.filter((entry) => entry.level === 40)).toEqual([]);
    } finally {
      await local.app.close();
    }

    const forgotten = await start(hosted('pilot', { DEPLOYMENT_MODE: undefined }));
    try {
      expect(forgotten.lines.filter((entry) => entry.msg === 'Deployment.')).toEqual([]);
      expect(
        forgotten.lines.filter((entry) => entry.level === 40).map((entry) => entry.msg),
      ).toEqual([expect.stringContaining('DEPLOYMENT_MODE is local')]);
    } finally {
      await forgotten.app.close();
    }
  });

  it('tells a signed-in caller what it is, and nobody else', async () => {
    const instance = await start(
      hosted('pilot', { DATABASE_URL: undefined, DATABASE_AUTH: 'password' }),
    );
    try {
      const anonymous = await instance.app.inject({ url: '/api/config', headers: { host: HOST } });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.body).not.toMatch(/PILOT|a1b2c3d/u);
      const signedIn = await instance.app.inject({
        url: '/api/config',
        headers: { host: HOST, ...(await authorization({ roles: ['Swarm.Analyst'] })) },
      });
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      expect(signedIn.json()).toMatchObject({
        deployment: { mode: 'pilot', label: 'PRODUCTION-CANDIDATE CONTROLLED PILOT' },
        build: { version: APP_VERSION, sha: 'a1b2c3d4e5f6' },
      });
    } finally {
      await instance.app.close();
    }
  });

  it('is reported to the monitoring as swarm.deployment.info until it is closed', async () => {
    const config = loadConfig(
      hosted('pilot', { DATABASE_URL: undefined, DATABASE_AUTH: 'password' }),
    );
    let reads = 0;
    Object.defineProperty(config.deployment.build, 'sha', {
      get: () => {
        reads += 1;
        return 'a1b2c3d4e5f6';
      },
    });
    const instance = await buildApp({
      config,
      repository: new Repository(':memory:'),
      tokenVerifier: new TokenVerifier(config.auth, idp.keys),
      logStream: { write: () => undefined },
    });
    expect(
      (await telemetry.measurements()).filter((point) => point.name === 'swarm.deployment.info'),
    ).toContainEqual({
      name: 'swarm.deployment.info',
      attributes: {
        'swarm.deployment.mode': 'pilot',
        'swarm.build.version': APP_VERSION,
        'swarm.build.sha': 'a1b2c3d4e5f6',
      },
      value: 1,
    });
    expect(reads).toBeGreaterThan(0);
    await instance.app.close();
    const closed = reads;
    await telemetry.measurements();
    expect(reads).toBe(closed);
  });
});
