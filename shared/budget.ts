import { z } from 'zod';

/**
 * A project's model budget: how many model calls, and how many tokens, it may use in all. A limit of
 * 0 is no limit. The deployment sets a default for every project; a workspace owner or administrator
 * may give one project its own, or lift it.
 */

/** The most a limit may be set to: a number a person could mean, well inside what a counter holds. */
export const MAX_BUDGET_LIMIT = 1_000_000_000;

/** The share of a limit at which a project is told that it is running low. */
export const BUDGET_WARNING_AT = 0.8;

export type BudgetState = 'none' | 'ok' | 'warning' | 'exhausted';

export interface BudgetView {
  /** Model calls that completed since the project was made, and the tokens they used. */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** What applies now: the project's own limit where it has one, otherwise the deployment's. 0 is none. */
  callLimit: number;
  tokenLimit: number;
  /** What this project itself sets. null is "the deployment's default"; 0 is "no limit". */
  own: { callLimit: number | null; tokenLimit: number | null };
  /** What the deployment sets for every project that does not set its own. */
  defaults: { callLimit: number; tokenLimit: number };
  /** The worse of the calls and the tokens. */
  state: BudgetState;
  /** Whether this caller may change the limits. */
  may: { edit: boolean };
}

const limit = z.int().min(0).max(MAX_BUDGET_LIMIT).nullable();

export const budgetInputSchema = z.object({ callLimit: limit, tokenLimit: limit }).strict();
export type BudgetInput = z.infer<typeof budgetInputSchema>;
