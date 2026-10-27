import { CheckFailure, type Http, type HttpResult } from './verify-support.js';

function reason(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
      return cause.code;
    }
    return error.name === 'TimeoutError' ? 'the request timed out' : error.message;
  }
  return 'unknown error';
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A plain fetch client for the application's own API. It never sends credentials of any kind. */
export function fetchHttp(baseUrl: string, timeoutMs: number): Http {
  return {
    async request(method, path, body): Promise<HttpResult> {
      let response: Response;
      try {
        response = await fetch(new URL(path, baseUrl), {
          method,
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new CheckFailure(
          `Cannot reach ${baseUrl} (${reason(error)}). Is the server running? Start it with "npm run dev".`,
        );
      }
      const text = await response.text();
      const json = (response.headers.get('content-type') ?? '').includes('json');
      return { status: response.status, body: json ? parse(text) : text };
    },
  };
}
