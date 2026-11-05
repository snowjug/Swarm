import { z } from 'zod';

/**
 * What a step that fell back to rules goes on to say: the failure's own sentence ends with it. A step that
 * stopped instead, and asked, tells the failure without it (see `withoutRulesUsed`).
 */
export const RULES_USED = ', so rules were used.';

/** A stored failure as a person is told of it when nothing was done about it: what failed, and not that rules were used. */
export const withoutRulesUsed = (detail: string): string => detail.replace(RULES_USED, '.');

/** What a list that rules made after the model failed is called wherever it is shown: never as the model's. */
export const RULES_FALLBACK_LABEL = 'Participants from the rules fallback';

/**
 * The classes of failure that stop a step a model was asked to do. Each has fixed wording on the server; a
 * failure of any other kind is recorded and shown as `MODEL_UNEXPECTED`, so that nothing a caller sends or a
 * provider says can reach a record through its code.
 */
export const MODEL_FAILURE_CODES = [
  'MODEL_OUTPUT_INVALID',
  'MODEL_TRUNCATED',
  'MODEL_TIMEOUT',
  'MODEL_UNREACHABLE',
  'MODEL_RATE_LIMIT',
  'MODEL_AUTH',
  'MODEL_NOT_FOUND',
  'MODEL_CALL_BUDGET',
  'MODEL_TOKEN_BUDGET',
  'MODEL_COST_BUDGET',
  'PROJECT_BUDGET',
  'MODEL_ROUTE_UNAVAILABLE',
  'MODEL_PARAMETER_UNSUPPORTED',
  'MODEL_HTTP_ERROR',
  'MODEL_CONTEXT_LIMIT',
  'MODEL_UNEXPECTED',
] as const;
export type ModelFailureCode = (typeof MODEL_FAILURE_CODES)[number];

/**
 * What a step answers when the model it asked could not be used and the person has not yet said what to do
 * about it. Nothing was kept: what was there before is as it was. There is no word of the model's in it.
 */
export const proposalStopSchema = z.object({
  code: z.enum(MODEL_FAILURE_CODES),
  /** What failed, in a sentence for a person: the class of failure and, when a reply was seen, counts about it. */
  detail: z.string().trim().max(300),
  /** Whether asking the model again, as it was asked, may help: not when the deployment, the credentials or the budget are the trouble. */
  retryable: z.boolean(),
});
export type ProposalStop = z.infer<typeof proposalStopSchema>;

/**
 * What a route answers, with status 200 instead of its usual view, when a model was asked and could not be
 * used. The person then chooses: ask again, edit by hand, or continue with rules (the same request with
 * `mode: 'rules'` and `fallbackFrom` the code, which records what follows as the rules fallback).
 */
export interface ProposalStopped {
  stopped: ProposalStop;
}

export const proposalWasStopped = <View extends object>(
  answer: View | ProposalStopped,
): answer is ProposalStopped => 'stopped' in answer;
