import { isStorageUnavailable } from './storage/failure.js';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    if (signal.reason instanceof AppError) throw signal.reason;
    throw new AppError(409, 'RUN_CANCELLED', 'The operation was cancelled.');
  }
}

/** The code of every failure of the store to serve: the database is down, too slow, out of resources or held by others. */
export const STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE';

/** Said to a person whatever the cause was, so that no driver, host, statement or credential is in it. */
const STORAGE_UNAVAILABLE_MESSAGE =
  'Swarm cannot use its database right now. Nothing you did caused this. Wait a minute, then try again.';

/** The `Retry-After` that goes with it, as long as the message says. */
export const STORAGE_RETRY_AFTER_SECONDS = 60;

/** What is raised when the store cannot serve. The cause is kept for whoever debugs and is never sent. */
export function storageUnavailable(cause: unknown): AppError {
  return new AppError(503, STORAGE_UNAVAILABLE, STORAGE_UNAVAILABLE_MESSAGE, { cause });
}

export function publicFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  if (isStorageUnavailable(error)) {
    return { code: STORAGE_UNAVAILABLE, message: STORAGE_UNAVAILABLE_MESSAGE };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An internal operation failed. Check the server log using the request or project ID.',
  };
}
