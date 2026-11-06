import { vi } from 'vitest';

/** One request the page made, as the server saw it: header names in lower case, the body read as JSON when it was. */
export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = Response | object | null | undefined;
export type Handler = Answer | ((call: Call) => Answer | Promise<Answer>);

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const noContent = (): Response => new Response(null, { status: 204 });

export const failure = (status: number, code: string, message = 'The server said no.'): Response =>
  json({ error: { code, message, requestId: 'req-test' } }, status);

function lowerCased(headers: HeadersInit | undefined): Record<string, string> {
  const found: Record<string, string> = {};
  if (!headers) return found;
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers);
  for (const [name, value] of entries) found[name.toLowerCase()] = String(value);
  return found;
}

function bodyOf(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return body ?? undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * A server that answers from a table of `"METHOD /path"` to what it says, in place of `fetch`. A request that is not in
 * the table is answered 404 and listed in `unexpected`, so that a page that asks for more than a test expects shows up.
 * Nothing leaves the process.
 */
export function fakeServer(routes: Record<string, Handler> = {}) {
  const table = new Map<string, Handler>(Object.entries(routes));
  const calls: Call[] = [];
  const unexpected: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/u, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const call: Call = {
      method,
      path,
      headers: lowerCased(init.headers),
      body: bodyOf(init.body),
    };
    calls.push(call);
    const handler = table.get(`${method} ${path}`) ?? table.get(`${method} ${path.split('?')[0]}`);
    if (handler === undefined) {
      unexpected.push(`${method} ${path}`);
      return failure(404, 'NOT_FOUND', 'No such route in the test.');
    }
    const answer = typeof handler === 'function' ? await handler(call) : handler;
    if (answer instanceof Response) return answer;
    return answer === null || answer === undefined ? noContent() : json(answer);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    unexpected,
    fetch: fetchMock,
    set(route: string, handler: Handler) {
      table.set(route, handler);
    },
    /** The requests made so far to a route, in order. */
    to(route: string): Call[] {
      const [method, path] = route.split(' ');
      return calls.filter(
        (call) =>
          call.method === method && (call.path === path || call.path.split('?')[0] === path),
      );
    },
  };
}

export type FakeServer = ReturnType<typeof fakeServer>;
