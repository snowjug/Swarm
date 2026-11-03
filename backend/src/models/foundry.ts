import type { ProviderConfig } from '../config.js';
import { DEPLOYMENT_NAME, type Environment } from './routing-config.js';

/** A Microsoft Entra token is sent to this host, so only the hosts of Azure AI resources are accepted. */
export const FOUNDRY_HOST_SUFFIXES = [
  '.openai.azure.com',
  '.services.ai.azure.com',
  '.cognitiveservices.azure.com',
] as const;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export type FoundryEndpoint = { valid: true; url: string } | { valid: false; reason: string };

/**
 * Checks a Foundry endpoint and returns the base URL of its OpenAI-compatible v1 API. The resource
 * root, or its `/openai/v1` path, is accepted. A reason never repeats the value: an endpoint is
 * configuration, and a setting that was mistyped into a URL may be a secret.
 *
 * `allowLoopback` is the seam that lets a test point Swarm at a server on this machine. It is
 * refused for a production deployment, where `loadConfig` never turns it on.
 */
export function foundryEndpoint(
  value: string,
  options: { allowLoopback?: boolean } = {},
): FoundryEndpoint {
  if (!URL.canParse(value)) return { valid: false, reason: 'Use a valid absolute https URL.' };
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    return {
      valid: false,
      reason: 'Endpoint credentials, query strings and fragments are not supported.',
    };
  }
  const loopback = options.allowLoopback === true && LOOPBACK_HOSTS.has(url.hostname);
  if (!loopback) {
    if (url.protocol !== 'https:') return { valid: false, reason: 'Use an https endpoint.' };
    const host = url.hostname.toLowerCase();
    if (!FOUNDRY_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      return {
        valid: false,
        reason: `The host must end in ${FOUNDRY_HOST_SUFFIXES.join(', ')}.`,
      };
    }
    if (url.port) return { valid: false, reason: 'Use the default https port.' };
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, reason: 'Use an http or https endpoint.' };
  }
  if (!/^\/(?:openai\/v1\/?)?$/u.test(url.pathname)) {
    return {
      valid: false,
      reason: 'Use the resource root or its /openai/v1 endpoint.',
    };
  }
  return { valid: true, url: `${url.origin}/openai/v1/` };
}

/**
 * The provider for AI_PROVIDER=foundry: Microsoft Foundry through its OpenAI-compatible v1 API.
 * Microsoft Entra ID is the default and needs no key. A key is used only when FOUNDRY_AUTH=key is
 * chosen. Whether a key, or the loopback test seam, is acceptable for a deployment is decided by
 * the deployment guard (`deployment.ts`), which refuses a pilot or production start that uses one.
 */
export function buildFoundryProvider(
  base: ProviderConfig,
  environment: Environment,
  managedIdentityClientId: string | null,
): ProviderConfig {
  const authSetting = environment.FOUNDRY_AUTH?.trim() || 'entra';
  if (authSetting !== 'entra' && authSetting !== 'key') {
    throw new Error('Invalid server configuration: FOUNDRY_AUTH.');
  }
  const loopback = environment.FOUNDRY_TEST_ALLOW_LOOPBACK?.trim() === '1';

  const unconfigured = (reason: string): ProviderConfig => ({ ...base, reason });
  if (!base.model) {
    return unconfigured(
      'Set AI_MODEL, the name of the default deployment, in the backend environment.',
    );
  }
  if (!DEPLOYMENT_NAME.test(base.model)) {
    return unconfigured(
      'AI_MODEL must be a deployment name: letters, digits, dots, hyphens, underscores.',
    );
  }
  const rawUrl = environment.FOUNDRY_ENDPOINT?.trim();
  if (!rawUrl) return unconfigured('Set FOUNDRY_ENDPOINT in the backend environment.');
  const key = environment.FOUNDRY_API_KEY?.trim();
  if (authSetting === 'key' && !key) {
    return unconfigured(
      'Set FOUNDRY_API_KEY in the backend environment, or use Microsoft Entra ID.',
    );
  }
  const checked = foundryEndpoint(rawUrl, { allowLoopback: loopback });
  if (!checked.valid) return unconfigured(`Invalid provider endpoint: ${checked.reason}`);

  const entra = authSetting === 'entra';
  return {
    ...base,
    baseUrl: checked.url,
    apiKey: entra ? null : (key ?? null),
    auth: entra ? 'entra' : 'api-key',
    managedIdentityClientId: entra ? managedIdentityClientId : null,
    configured: true,
    reason: entra
      ? 'Microsoft Foundry through the OpenAI-compatible v1 API, signed in with Microsoft Entra ID (no API key). The identity needs the "Cognitive Services OpenAI User" role on the resource.'
      : 'Microsoft Foundry through the OpenAI-compatible v1 API. Provider settings are present on the server.',
  };
}
