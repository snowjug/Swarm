import type { ReasoningEffort } from './call.js';

/**
 * How much a model may write in answer to one request, and how hard it may think first.
 *
 * A reasoning deployment (gpt-5, o-series) spends hidden "reasoning" tokens before it writes a word of
 * the answer, and they are counted against `max_completion_tokens`. A budget sized for the answer alone
 * can be used up entirely by thinking: the reply then ends with `finish_reason: length` and no JSON,
 * even for a request that asks for one word. So a budget is always the answer plus room for the effort
 * that is asked, and the effort for a structured task is low: the schema constrains the answer, and
 * every token spent thinking is a token not left for it, a longer wait and a bigger bill.
 *
 * The router (`router.ts`) chooses the answer a role is given and the effort of a deployment that is
 * declared to reason; the client (`client.ts`) applies what is here to every call, whether a router
 * chose it or not.
 */

/** From the least thinking to the most. */
export const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

/** Tokens a reasoning deployment may spend thinking before it writes the answer, by effort. */
export const REASONING_HEADROOM: Record<ReasoningEffort, number> = {
  minimal: 500,
  low: 1_000,
  medium: 2_000,
  high: 4_000,
};

/** The most an output budget may be: where a retry after a cut-off reply stops growing it. */
export const MAX_OUTPUT_TOKENS = 16_000;

/** What a structured task is asked at when nothing names another effort. */
export const STRUCTURED_EFFORT: ReasoningEffort = 'low';

/** The effort of a request that must not be cut off, such as a connection check. */
export const MINIMAL_EFFORT: ReasoningEffort = 'minimal';

/** What a call is given to write when its caller does not say. */
export const DEFAULT_ANSWER_TOKENS = 5_000;

/** The answer a call is to be given room to write: its caller's number if it is one. */
export function answerTokensFor(asked: number | undefined): number {
  return typeof asked === 'number' && Number.isFinite(asked) && asked >= 1
    ? Math.floor(asked)
    : DEFAULT_ANSWER_TOKENS;
}

/** The room a reasoning deployment is given to think at `effort`; none for a request that sends no effort. */
export const roomFor = (effort: ReasoningEffort | null): number =>
  effort === null ? 0 : REASONING_HEADROOM[effort];

/** The tokens to send for an answer of `answerTokens` at `effort`: room to think on top, never past the cap. */
export function budgetFor(answerTokens: number, effort: ReasoningEffort | null): number {
  if (effort === null) return answerTokens;
  return Math.max(answerTokens, Math.min(MAX_OUTPUT_TOKENS, answerTokens + roomFor(effort)));
}

/** One step less thinking, down to `floor`: a deployment that does not take `minimal` stops at `low`. */
export function lowerEffort(
  effort: ReasoningEffort,
  floor: ReasoningEffort = MINIMAL_EFFORT,
): ReasoningEffort {
  const level = Math.max(EFFORTS.indexOf(floor), EFFORTS.indexOf(effort) - 1);
  return EFFORTS[level] ?? floor;
}

export interface OutputSetting {
  maxTokens: number;
  /** Null for a request that sends no effort, as a deployment that does not reason is asked. */
  effort: ReasoningEffort | null;
}

/**
 * What to ask again with after a reply that was cut off at its limit: twice the room, up to the cap, and
 * less thinking. A reply that ended at the limit is never read, so this is the one chance the call gets
 * to finish: null when there is nothing more to give it, because the cap is reached and the effort is at
 * its floor, and asking again would be asking the same thing.
 */
export function retryAfterLength(
  sent: OutputSetting,
  floor: ReasoningEffort = MINIMAL_EFFORT,
): OutputSetting | null {
  const next: OutputSetting = {
    maxTokens: Math.max(sent.maxTokens, Math.min(MAX_OUTPUT_TOKENS, sent.maxTokens * 2)),
    effort: sent.effort === null ? null : lowerEffort(sent.effort, floor),
  };
  return next.maxTokens === sent.maxTokens && next.effort === sent.effort ? null : next;
}
