/**
 * What stands between a model call and the money it costs, for a deployment that has to keep a promise about spend
 * (the public edition's free tier). The client asks before **every** provider round trip, in the one place that knows a
 * call is about to be made, and tells what happened after. A pilot gives its clients none, and nothing here runs.
 *
 * The gate is asked with the worst case of the call, so that what is settled plus what is reserved can never pass a cap,
 * however many calls are in flight: a limit that was only enforced on what was already used would let a burst through.
 */
export interface SpendRequest {
  deployment: string;
  /** What the characters about to be sent come to, in tokens. */
  inputTokens: number;
  /** The whole output limit of the call, which a reasoning model's hidden tokens are inside. */
  maxOutputTokens: number;
}

export interface SpendUse {
  inputTokens: number;
  /** Completion tokens as the provider counts them: hidden reasoning tokens are in this number. */
  outputTokens: number;
  /** What part of `outputTokens` was reasoning, when the provider says. */
  reasoningTokens: number | null;
}

export interface SpendTicket {
  /** The call used this much, as the provider reported it. */
  settle(used: SpendUse): void;
  /** The request was sent and nothing is known of what it used: it is charged at its worst case, never at nothing. */
  settleAtWorstCase(): void;
  /** The request never reached the provider: nothing was used, and the reservation is given back. */
  release(): void;
}

export interface SpendGate {
  /** Throws to refuse the call. The error is the person's to read: its message says what happened and what to do. */
  begin(request: SpendRequest): SpendTicket;
}
