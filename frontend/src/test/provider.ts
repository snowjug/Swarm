import { expect } from 'vitest';
import type {
  CheckStage,
  DeploymentCheck,
  ProviderCheck,
  ProviderStatus,
} from '../../../shared/types';

/** Text a person reads: markup removed and whitespace collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

const SECRET_LOOKING: [string, RegExp][] = [
  ['an OpenAI-style key', /\bsk-[A-Za-z0-9_-]{8,}/u],
  ['a JWT', /\beyJ[A-Za-z0-9_-]{8,}/u],
  ['a bearer token', /\bBearer\s+\S{6,}/iu],
  ['a credential assignment', /\b(?:api[-_ ]?key|token|secret|password)\s*[:=]\s*\S{6,}/iu],
  ['a long opaque value', /(?<![\w-])[A-Za-z0-9+/_-]{32,}={0,2}(?![\w-])/u],
  [
    'an endpoint URL or provider host',
    /https?:\/\/|\b[a-z0-9-]+\.(?:openai\.azure|cognitiveservices\.azure|services\.ai\.azure)\.com\b/iu,
  ],
];

/** The API carries no key, token or endpoint, so nothing rendered may look like one. */
export function expectNoSecretLikeText(text: string): void {
  for (const [name, pattern] of SECRET_LOOKING) {
    expect(text, `rendered text must not contain ${name}`).not.toMatch(pattern);
  }
}

/** A local/rules status: no provider is configured, so no model call can happen. */
export function localStatusFixture(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    mode: 'local-rules',
    provider: 'none',
    model: null,
    auth: 'none',
    configured: false,
    connectivity: 'not-applicable',
    lastCheckedAt: null,
    lastLatencyMs: null,
    lastError: null,
    counters: {
      calls: 0,
      repairCalls: 0,
      failures: 0,
      truncated: 0,
      schemaInvalid: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      tokensReported: false,
    },
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A configured real-model status; Azure with Entra ID unless overridden. */
export function realStatusFixture(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return localStatusFixture({
    mode: 'real-model',
    provider: 'azure',
    model: 'swarm-dev-deployment',
    auth: 'entra',
    configured: true,
    connectivity: 'unverified',
    ...overrides,
  });
}

/**
 * What a connection check found: all four things confirmed unless a stage is replaced. `connected` and `ok`
 * follow from the stages as the server works them out, so that a fixture cannot say what the stages do not.
 */
export function checkFixture(found: Partial<DeploymentCheck> = {}): ProviderCheck {
  const ok: CheckStage = { state: 'ok', detail: null };
  const deployment: DeploymentCheck = {
    deployment: 'swarm-dev-deployment',
    reachable: ok,
    authenticated: ok,
    deploymentFound: ok,
    structuredOutput: { state: 'ok', detail: 'strict JSON schema' },
    structuredMode: 'json_schema',
    code: null,
    latencyMs: 140,
    ...found,
  };
  const connected = [
    deployment.reachable,
    deployment.authenticated,
    deployment.deploymentFound,
  ].every((stage) => stage.state === 'ok');
  return {
    checkedAt: '2026-01-01T00:00:10.000Z',
    connected,
    ok: connected && deployment.structuredOutput.state === 'ok',
    deployments: [deployment],
  };
}
