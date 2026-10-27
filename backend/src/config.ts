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

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  allowedOrigins: Set<string>;
  allowedHosts: Set<string>;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'silent';
  provider: ProviderConfig;
  sourceUrl: string | null;
  storageWarning: string | null;
  /** Multiplies every per-IP request limit. Default 1; raise only for automated tests/load tests. */
  rateLimitScale: number;
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

const environmentSchema = z.object({
  HOST: z.enum(['127.0.0.1', 'localhost', '0.0.0.0', '::']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  DATA_DIR: z.string().trim().min(1).default('./data'),
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
});

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
    reason:
      auth === 'entra'
        ? 'Microsoft Entra ID sign-in will be used (no API key). Connectivity and the "Cognitive Services OpenAI User" role are not yet verified.'
        : 'Configuration is present. Connectivity and model compatibility are not yet verified.',
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
  const databasePath = resolve(input.DATA_DIR, 'swarm-lab.sqlite');
  return {
    host: input.HOST,
    port: input.PORT,
    databasePath,
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
    storageWarning: storageWarning(databasePath),
    rateLimitScale: input.RATE_LIMIT_SCALE,
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
      authentication: 'local-single-user',
    },
  };
}
