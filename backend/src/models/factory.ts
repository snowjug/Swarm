import type { ServerConfig } from '../config.js';
import { ModelClient, type ModelGateway, type ModelUsageSink } from './client.js';
import { entraTokenProvider, type TokenProvider } from './entra.js';
import type { ProviderTelemetry } from './telemetry.js';

export type ModelFactory = (
  onUsage: ModelUsageSink,
  options?: { maxCalls: number },
) => ModelGateway;

/**
 * Builds the production model factory. One Entra token provider and one telemetry collector are
 * shared by every client, so tokens are cached once and every real round trip is counted.
 */
export function createModelFactory(
  config: ServerConfig,
  telemetry: ProviderTelemetry,
  tokens: TokenProvider | null = config.provider.auth === 'entra'
    ? entraTokenProvider({ managedIdentityClientId: config.provider.managedIdentityClientId })
    : null,
): ModelFactory {
  return (onUsage, options) =>
    new ModelClient(config.provider, onUsage, undefined, options?.maxCalls ?? 16, {
      tokens,
      observer: telemetry,
    });
}
