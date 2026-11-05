import type { ModelCallEvent } from './telemetry.js';
import type { ModelRole } from './task.js';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/**
 * How one call is to be made, as a router decided. Only a provider's own client reads it; a gateway
 * that does not know it (a test double) ignores it, so adding a field here never breaks a caller.
 */
export interface ModelCallRoute {
  role?: ModelRole;
  /** The versioned task name. It also names the structured output the provider is asked for. */
  task?: string;
  deployment?: string;
  /** Sampling temperature. Null or absent: the provider's default. */
  temperature?: number | null;
  /** For a reasoning deployment. Null or absent: the client asks at the structured-task effort unless the deployment has refused one. */
  reasoningEffort?: ReasoningEffort | null;
  /**
   * True when the budget this route came with already has room for the effort it names, as a router's
   * has for a deployment that reasons. Otherwise the client adds that room itself: an effort is never
   * sent with a budget that thinking could use up.
   */
  roomForReasoning?: boolean;
  /** The time limit of one request, in place of the provider's. */
  timeoutMs?: number;
  /** Retries after a network error or 5xx (`transient`) and after HTTP 429 (`throttle`). */
  retry?: { transient: number; throttle: number };
  /** False: ask for plain JSON even where a strict schema could be used. */
  strictSchema?: boolean;
}

/**
 * What a call tells the code that made it about how it went, for that code's record of the task. The
 * caller puts an empty one in the options and reads it after; a client that knows fills it in, and a
 * gateway that does not leaves it empty.
 */
export interface CallReport {
  /** The deployment of the last request made. */
  deployment?: string | null;
  /** The correction rounds the accepted reply needed: 0 when the first reply was. Set only on success. */
  repairs?: number;
}

export interface CallRequestInfo {
  deployment: string;
  /** The characters of the messages about to be sent. */
  inputChars: number;
  maxOutputTokens: number;
}

export interface CallTicket {
  /**
   * Reports the call, once. `estimate` is what the call probably used, for a provider that does not
   * say: a limit that was only enforced on reported tokens could be passed by such a provider.
   */
  end(event: ModelCallEvent, estimate: { inputTokens: number; outputTokens: number }): void;
}

/**
 * Asked before every provider round trip of one `json()` call, repairs and retries included. It throws
 * to stop the call: that is how an operation's own allowance holds back a call that is about to be
 * made, in the one place that knows when a call is made.
 */
export interface CallGate {
  begin(request: CallRequestInfo): CallTicket;
}
