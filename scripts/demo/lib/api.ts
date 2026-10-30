/** A small client for the application's own API. It sends no credentials of any kind. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

function failure(method: string, path: string, status: number, text: string): ApiError {
  let detail = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error) detail = `${parsed.error.code ?? 'error'}: ${parsed.error.message ?? ''}`;
  } catch {
    // Not JSON: the trimmed text is the best description there is.
  }
  return new ApiError(`${method} ${path} answered ${status}. ${detail}`, status);
}

export function httpApi(baseUrl: string, timeoutMs = 15 * 60_000): Api {
  const send = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const code =
        error instanceof Error && error.cause instanceof Error && 'code' in error.cause
          ? String(error.cause.code)
          : error instanceof Error
            ? error.name
            : 'unknown';
      throw new ApiError(`${method} ${path} could not reach the server (${code}).`, 0);
    }
    const text = await response.text();
    if (!response.ok) throw failure(method, path, response.status, text);
    return (text ? JSON.parse(text) : undefined) as T;
  };
  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    put: (path, body) => send('PUT', path, body),
  };
}
