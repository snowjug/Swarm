import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Whose rows the code running right now may see, when the database enforces row-level security. It travels with
 * the asynchronous call chain (an `AsyncLocalStorage`), so that the request that is being served, or the job that is
 * being run, is what decides, and nothing a caller sends can.
 *
 *  - `system`: work about the platform and not about one tenant (a sign-in before the tenant is known, the audit
 *    chain, the usage ledger, the job queue's upkeep). It sees every row.
 *  - `tenant`: the workspace of the signed-in caller, or of the project a job works on.
 *  - Neither: the database refuses (`DB_CONTEXT_MISSING`). Absence of a scope never means "everything".
 *
 * An object is shared on purpose: a request's scope is made before the caller is known and the guard fills `tenant`
 * in right after authentication, which every later hook and the handler then see.
 */
export interface DbScope {
  tenant: string | null;
  system: boolean;
}

const storage = new AsyncLocalStorage<DbScope>();

/** The scope of the code running now, if any. */
export const currentScope = (): DbScope | undefined => storage.getStore();

/** Runs `operation` (and everything it starts) in `scope`. */
export const runInScope = <T>(scope: DbScope, operation: () => T): T =>
  storage.run(scope, operation);

/** The form Fastify documents for context that must reach later hooks and the handler: `done` runs inside the scope. */
export const enterScope = (scope: DbScope, done: () => void): void => {
  storage.run(scope, done);
};

export const SYSTEM_SCOPE: DbScope = Object.freeze({ tenant: null, system: true });
