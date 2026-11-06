import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProviderName } from '../../../shared/types.js';

/**
 * Who answers the model work that is being done now, when that is not the provider the server is configured with: in
 * the public edition, a person's own key and the model they chose. Results are labelled with it (the provider and model
 * a project's run records, the model a proposal says it came from), so that they are never said to have come from a model
 * that did not write them, and so that a project is not moved to another provider without being told.
 *
 * It travels with the asynchronous call chain, like the funding it comes from. Nothing sets it in a pilot, and then
 * `modelIdentity` says what the configuration says, as it always did.
 */
export interface ModelIdentity {
  provider: ProviderName;
  model: string | null;
}

const storage = new AsyncLocalStorage<ModelIdentity>();

export const runAsModel = <T>(identity: ModelIdentity, operation: () => T): T =>
  storage.run(identity, operation);

export const enterAsModel = (identity: ModelIdentity, done: () => void): void => {
  storage.run(identity, done);
};

/** The provider and model that answer the work being done now: the person's own if they pay for it, else the configured. */
export function modelIdentity(configured: {
  name: ProviderName;
  model: string | null;
}): ModelIdentity {
  return storage.getStore() ?? { provider: configured.name, model: configured.model };
}
