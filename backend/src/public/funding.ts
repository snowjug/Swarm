import { AsyncLocalStorage } from 'node:async_hooks';
import type { Funding } from '../../../shared/public.js';

/**
 * What pays for the model calls of the code that is running now: the free tier, or a person's own key. Like the database
 * scope it travels with the asynchronous call chain, set once by the request (or by the job that runs for a project)
 * and read when a model is made. Nothing a caller sends chooses a workspace: the workspace is the signed-in person's.
 */
export interface FundingContext {
  /** The workspace the calls are made for, and charged to. */
  workspaceId: string;
  funding: Funding;
  /** For `byok`: the person's own key and model, held in memory for this request or run, never anywhere else. */
  byok: { key: string; model: string | null } | null;
}

const storage = new AsyncLocalStorage<FundingContext>();

export const currentFunding = (): FundingContext | undefined => storage.getStore();

export const runWithFunding = <T>(context: FundingContext, operation: () => T): T =>
  storage.run(context, operation);

/** The form Fastify documents for context that must reach later hooks and the handler: `done` runs inside it. */
export const enterFunding = (context: FundingContext, done: () => void): void => {
  storage.run(context, done);
};
