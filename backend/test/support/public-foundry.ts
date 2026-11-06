/** The operator's Azure deployment, as far as the public edition's tests need it, and the settings that point at it. */

export const foundryEnvironment = {
  AI_PROVIDER: 'foundry',
  FOUNDRY_ENDPOINT: 'https://free-tier.openai.azure.com',
  FOUNDRY_AUTH: 'key',
  FOUNDRY_API_KEY: 'operator-key-never-shown',
  AI_MODEL: 'gpt-4.1-mini',
  MODEL_PRICES: JSON.stringify([
    { deployment: 'gpt-4.1-mini', inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
  ]),
  FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ 'gpt-4.1-mini': { reasoning: false } }),
};

export interface FoundrySeen {
  url: string;
  body: Record<string, unknown>;
}

export class FakeFoundry {
  readonly seen: FoundrySeen[] = [];
  /** What the next reply says; a function lets a test choose per request. */
  reply: (call: number, body: Record<string, unknown>) => Response | Promise<Response> = () =>
    this.ok();
  inspect: ((body: Record<string, unknown>) => void) | null = null;

  ok(
    usage = { prompt_tokens: 120, completion_tokens: 80, reasoning: 0 },
    content = '{"ok":true}',
    finish = 'stop',
  ): Response {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: finish }],
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          completion_tokens_details: { reasoning_tokens: usage.reasoning },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    this.seen.push({ url: String(input), body });
    this.inspect?.(body);
    // A deployment that does not reason refuses the setting. The public edition declares its deployments as ones that
    // do not, so a request that carries it is a fault, and is refused here as Azure would.
    if ('reasoning_effort' in body) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'unsupported_parameter',
            param: 'reasoning_effort',
            message: 'Unsupported parameter.',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
    const answer = Promise.resolve(this.reply(this.seen.length, body));
    const signal = init?.signal;
    if (!signal) return answer;
    // A request that is abandoned stops, as a real one does.
    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void =>
        reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  };
}
