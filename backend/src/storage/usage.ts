import { z } from 'zod';
import {
  BUDGET_WARNING_AT,
  budgetInputSchema,
  type BudgetInput,
  type BudgetState,
} from '../../../shared/budget.js';
import { AppError } from '../errors.js';
import type { SqlDatabase } from './sql.js';

/** What applies to a project: 0 is no limit. */
export interface UsageLimits {
  callLimit: number;
  tokenLimit: number;
}

export interface ProjectUsage {
  /** Model calls that completed since the project was made, and the tokens they used. */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** What the project itself sets: null is the deployment's default, 0 is no limit. */
  own: BudgetInput;
  /** What applies: the project's own limit where it has one, otherwise the deployment's. */
  limits: UsageLimits;
  defaults: UsageLimits;
}

// A counter can come back from PostgreSQL as text: it is a 64-bit integer there.
const usageRow = z.object({
  calls: z.coerce.number(),
  input_tokens: z.coerce.number(),
  output_tokens: z.coerce.number(),
  call_limit: z.coerce.number().nullable(),
  token_limit: z.coerce.number().nullable(),
});

const NO_LIMITS: UsageLimits = { callLimit: 0, tokenLimit: 0 };

/** The worse of the calls and the tokens. A measure without a limit says nothing. */
export function budgetState(usage: ProjectUsage): BudgetState {
  const shares: number[] = [];
  if (usage.limits.callLimit > 0) shares.push(usage.calls / usage.limits.callLimit);
  if (usage.limits.tokenLimit > 0) {
    shares.push((usage.inputTokens + usage.outputTokens) / usage.limits.tokenLimit);
  }
  if (shares.length === 0) return 'none';
  const worst = Math.max(...shares);
  return worst >= 1 ? 'exhausted' : worst >= BUDGET_WARNING_AT ? 'warning' : 'ok';
}

const grouped = (value: number): string => value.toLocaleString('en-GB');

/**
 * What each project has spent on the model, and what it may. A call is counted when it completes, so
 * the call that crosses a limit is the last one: the next is refused. Calls already in flight may
 * finish over it, and the tokens of a call are only known once it is over, so a token limit is
 * checked between calls, not within one.
 */
export class UsageStore {
  private defaults: UsageLimits = NO_LIMITS;

  constructor(private readonly database: SqlDatabase) {}

  /** What every project gets that does not set its own limits. Set once, from the deployment. */
  setDefaults(defaults: UsageLimits): void {
    this.defaults = { ...defaults };
  }

  get(projectId: string): ProjectUsage {
    const found = this.database
      .prepare(
        'SELECT calls, input_tokens, output_tokens, call_limit, token_limit FROM project_usage WHERE project_id = ?',
      )
      .get(projectId);
    const stored = found
      ? usageRow.parse(found)
      : { calls: 0, input_tokens: 0, output_tokens: 0, call_limit: null, token_limit: null };
    return {
      calls: stored.calls,
      inputTokens: stored.input_tokens,
      outputTokens: stored.output_tokens,
      own: { callLimit: stored.call_limit, tokenLimit: stored.token_limit },
      limits: {
        callLimit: stored.call_limit ?? this.defaults.callLimit,
        tokenLimit: stored.token_limit ?? this.defaults.tokenLimit,
      },
      defaults: { ...this.defaults },
    };
  }

  /** Adds one completed call. The addition is the statement, so that concurrent calls are not lost. */
  record(projectId: string, inputTokens: number, outputTokens: number): void {
    this.database
      .prepare(
        `INSERT INTO project_usage (project_id, calls, input_tokens, output_tokens, updated_at)
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           calls = project_usage.calls + 1,
           input_tokens = project_usage.input_tokens + EXCLUDED.input_tokens,
           output_tokens = project_usage.output_tokens + EXCLUDED.output_tokens,
           updated_at = EXCLUDED.updated_at`,
      )
      .run(
        projectId,
        Math.max(0, Math.trunc(inputTokens)),
        Math.max(0, Math.trunc(outputTokens)),
        new Date().toISOString(),
      );
  }

  /** Sets what the project itself may use. null falls back to the deployment's default; 0 is no limit. */
  setLimits(projectId: string, input: BudgetInput): void {
    const { callLimit, tokenLimit } = budgetInputSchema.parse(input);
    this.database
      .prepare(
        `INSERT INTO project_usage (project_id, call_limit, token_limit, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           call_limit = EXCLUDED.call_limit,
           token_limit = EXCLUDED.token_limit,
           updated_at = EXCLUDED.updated_at`,
      )
      .run(projectId, callLimit, tokenLimit, new Date().toISOString());
  }

  /** Refuses the next model call of a project that has used what it may. */
  admit(projectId: string): void {
    const usage = this.get(projectId);
    const { callLimit, tokenLimit } = usage.limits;
    const tokens = usage.inputTokens + usage.outputTokens;
    const spent =
      callLimit > 0 && usage.calls >= callLimit
        ? `${grouped(usage.calls)} of ${grouped(callLimit)} model calls`
        : tokenLimit > 0 && tokens >= tokenLimit
          ? `${grouped(tokens)} of ${grouped(tokenLimit)} tokens`
          : null;
    if (spent) {
      throw new AppError(
        429,
        'PROJECT_BUDGET',
        `This project has used its model budget (${spent}). A workspace owner or administrator can raise it.`,
      );
    }
  }
}
