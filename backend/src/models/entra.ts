import type { TokenCredential } from '@azure/identity';
import { AppError } from '../errors.js';

/** Data-plane scope for Azure OpenAI / Foundry resources (public cloud). */
export const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';

export interface TokenProvider {
  /** Returns a bearer token. The caller must never log, persist or return it. */
  getToken(signal: AbortSignal): Promise<string>;
}

export interface EntraOptions {
  /** Client ID of a user-assigned managed identity for hosted execution (non-secret). */
  managedIdentityClientId?: string | null;
  /** Injected for tests; production uses `DefaultAzureCredential`. */
  credential?: TokenCredential;
  scope?: string;
}

const UNAVAILABLE =
  'Microsoft Entra sign-in is unavailable for Swarm. Run "az login" (or "azd auth login") on this ' +
  'machine and retry; hosted runs need a managed identity (set AZURE_CLIENT_ID for a user-assigned one).';

/**
 * Acquires Microsoft Entra ID tokens with the Azure Identity library. Locally this uses the
 * developer's own `az` / `azd` / VS Code sign-in; in Azure it uses the workload's managed identity.
 * No credential is read from, or written to, Swarm's configuration. The SDK is loaded lazily so
 * local-rules mode never pays for it, and the SDK caches and refreshes tokens itself.
 */
export function entraTokenProvider(options: EntraOptions = {}): TokenProvider {
  const scope = options.scope ?? COGNITIVE_SERVICES_SCOPE;
  let credential: Promise<TokenCredential> | undefined = options.credential
    ? Promise.resolve(options.credential)
    : undefined;
  return {
    async getToken(signal: AbortSignal): Promise<string> {
      credential ??= import('@azure/identity').then(
        ({ DefaultAzureCredential }) =>
          new DefaultAzureCredential(
            options.managedIdentityClientId
              ? { managedIdentityClientId: options.managedIdentityClientId }
              : {},
          ),
      );
      try {
        const token = await (await credential).getToken(scope, { abortSignal: signal });
        if (!token?.token) throw new AppError(502, 'MODEL_AUTH', UNAVAILABLE);
        return token.token;
      } catch (error) {
        if (signal.aborted || error instanceof AppError) throw error;
        // The underlying error can contain tenant, account or CLI output; keep it out of messages.
        throw new AppError(502, 'MODEL_AUTH', UNAVAILABLE, { cause: error });
      }
    },
  };
}
