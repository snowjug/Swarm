import type { JWTVerifyGetKey } from 'jose';
import type { PublicProviderId } from '../../../../shared/public.js';
import type { PublicConfig } from '../config.js';
import { GitHubProvider } from './github.js';
import { GoogleProvider } from './google.js';
import type { IdentityProvider } from './provider.js';

export interface ProviderDeps {
  /** Test hook: the `fetch` the providers use. Never a URL: the hosts are constants. */
  fetcher?: typeof fetch;
  /** Test hook: Google's signing keys, without the network. */
  googleKeys?: JWTVerifyGetKey;
}

/** The providers that are configured, in the order the sign-in page offers them. */
export function buildProviders(
  config: PublicConfig,
  deps: ProviderDeps = {},
): Map<PublicProviderId, IdentityProvider> {
  const providers = new Map<PublicProviderId, IdentityProvider>();
  if (config.providers.google) {
    providers.set(
      'google',
      new GoogleProvider(config.providers.google, deps.fetcher ?? fetch, deps.googleKeys),
    );
  }
  if (config.providers.github) {
    providers.set('github', new GitHubProvider(config.providers.github, deps.fetcher ?? fetch));
  }
  return providers;
}
