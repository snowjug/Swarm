/**
 * Google's Gemini API as a person's key meets it, through its OpenAI-compatible endpoint, for tests: the same host and
 * paths, the same way of authorising (a bearer token), and Google's own shapes for what goes wrong (an error is
 * `{ error: { code: <number>, message, status: "INVALID_ARGUMENT" … } }`, and it may come in a list). It says nothing
 * about the real service: it is a double, built from Google's published documentation of that endpoint
 * (https://ai.google.dev/gemini-api/docs/openai and https://aistudio.google.com/docs/troubleshooting.md).
 */
export interface GeminiSeen {
  method: string;
  url: string;
  host: string;
  path: string;
  /** The `Authorization` header, as sent. */
  authorization: string | null;
  body: Record<string, unknown> | null;
  redirect: RequestRedirect | undefined;
}

type Reply = (call: number, seen: GeminiSeen) => Response | Promise<Response>;

export const GEMINI_MODELS = [
  'models/gemini-2.5-pro',
  'models/gemini-2.5-flash',
  'models/gemini-2.5-flash-lite',
  'models/gemini-3-flash-preview',
  'models/gemini-2.5-flash-image',
  'models/gemini-2.5-flash-preview-tts',
  'models/gemini-embedding-001',
  'models/gemma-3-27b-it',
  'models/gemini-2.0-flash',
];

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Google's error body: a number for `code`, a word for `status`, and the whole thing in a list for some endpoints. */
export const googleError = (
  code: number,
  status: string,
  message: string,
  reason?: string,
  list = true,
): Response => {
  const error = {
    error: {
      code,
      message,
      status,
      ...(reason
        ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] }
        : {}),
    },
  };
  return json(code, list ? [error] : error, { 'retry-after': '0' });
};

export class FakeGemini {
  readonly seen: GeminiSeen[] = [];
  /** The keys it accepts. Any other key is refused as Google refuses one it does not know. */
  readonly keys = new Set<string>();
  models: string[] = [...GEMINI_MODELS];
  /** Request fields it answers "unknown name" to, as Google's JSON parser does for a field it does not have. */
  readonly refuses = new Set<string>();
  /** What a chat request is answered with, by the number of the chat request. */
  reply: Reply = () => this.ok('{"ok":true}');
  /** What the list of models is answered with, instead of the list. */
  listing: (() => Response | Promise<Response>) | null = null;
  chats = 0;

  ok(
    content: string,
    usage = { prompt: 120, completion: 80, reasoning: 0 },
    finish: 'stop' | 'length' | 'content_filter' = 'stop',
  ): Response {
    return json(200, {
      id: 'fake',
      object: 'chat.completion',
      model: 'gemini',
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content } }],
      usage: {
        prompt_tokens: usage.prompt,
        completion_tokens: usage.completion,
        total_tokens: usage.prompt + usage.completion,
        completion_tokens_details: { reasoning_tokens: usage.reasoning },
      },
    });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);
    const seen: GeminiSeen = {
      method: String(init?.method ?? 'GET'),
      url: url.toString(),
      host: url.host,
      path: url.pathname,
      authorization: headers.get('authorization'),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      redirect: init?.redirect,
    };
    this.seen.push(seen);
    const key = /^Bearer (.+)$/u.exec(seen.authorization ?? '')?.[1] ?? '';
    if (!this.keys.has(key)) {
      return googleError(
        400,
        'INVALID_ARGUMENT',
        'API key not valid. Please pass a valid API key.',
        'API_KEY_INVALID',
      );
    }
    const signal = init?.signal;
    const answer = async (): Promise<Response> => {
      if (seen.method === 'GET' && seen.path === '/v1beta/openai/models') {
        return this.listing
          ? this.listing()
          : json(200, {
              object: 'list',
              data: this.models.map((id) => ({ id, object: 'model', owned_by: 'google' })),
            });
      }
      if (seen.method === 'POST' && seen.path === '/v1beta/openai/chat/completions') {
        this.chats += 1;
        for (const field of this.refuses) {
          if (seen.body && field in seen.body) {
            return googleError(
              400,
              'INVALID_ARGUMENT',
              `Invalid JSON payload received. Unknown name "${field}": Cannot find field.`,
            );
          }
        }
        return this.reply(this.chats, seen);
      }
      return googleError(404, 'NOT_FOUND', 'Not found.');
    };
    if (!signal) return answer();
    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void =>
        reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      answer()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  };

  /** Every request went to Google's own host and one of the two paths this server uses, with nothing redirected. */
  get strays(): string[] {
    return this.seen
      .filter(
        (entry) =>
          entry.host !== 'generativelanguage.googleapis.com' ||
          !['/v1beta/openai/models', '/v1beta/openai/chat/completions'].includes(entry.path) ||
          entry.redirect !== 'error' ||
          new URL(entry.url).search !== '',
      )
      .map((entry) => `${entry.method} ${entry.url}`);
  }
}
