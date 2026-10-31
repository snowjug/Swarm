/** Whether the person went away, as opposed to the work simply running out of the time it was given. */
export function clientLeft(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  const reason: unknown = signal.reason;
  return !(reason instanceof DOMException && reason.name === 'TimeoutError');
}

/** Why a model could not be used, in words for the note: its own plain message, or that it ran out of time. */
export function failureWords(signal: AbortSignal | undefined, message: string): string {
  return signal?.aborted && !clientLeft(signal) ? 'the model did not answer in time' : message;
}
