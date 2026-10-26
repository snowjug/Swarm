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

export function publicFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An internal operation failed. Check the server log using the request or project ID.',
  };
}
