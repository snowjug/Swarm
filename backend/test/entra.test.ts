import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { ModelClient, httpFailure } from '../src/models/client.js';
import { entraTokenProvider, COGNITIVE_SERVICES_SCOPE } from '../src/models/entra.js';
import { ProviderTelemetry } from '../src/models/telemetry.js';
import { testConfig } from './fixtures.js';

const answer = z.object({ answer: z.string() });
const signal = () => new AbortController().signal;
const TOKEN = 'entra-token-value-that-must-never-leak';
const azureEnvironment = {
  AI_PROVIDER: 'azure',
  AI_MODEL: 'dev-deployment',
  AZURE_OPENAI_ENDPOINT: 'https://swarm-dev.cognitiveservices.azure.com/',
};
const entra = () => testConfig(azureEnvironment).provider;
const completion = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 12 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
const tokens = { getToken: vi.fn<(signal: AbortSignal) => Promise<string>>() };

describe('Microsoft Entra ID authentication for Azure', () => {
  it('sends a bearer token from the token provider, never an API key, on every request', async () => {
    tokens.getToken.mockReset().mockResolvedValue(TOKEN);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => completion('{"answer":"ok"}'));
    const client = new ModelClient(entra(), () => undefined, fetcher, 16, { tokens });
    await client.json(answer, 'Return JSON.', {}, signal());
    await client.json(answer, 'Return JSON.', {}, signal());
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://swarm-dev.cognitiveservices.azure.com/openai/v1/chat/completions',
    );
    const headers = new Headers(init!.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.has('api-key')).toBe(false);
    expect(JSON.parse(String(init!.body))).toMatchObject({ model: 'dev-deployment' });
    expect(tokens.getToken).toHaveBeenCalledTimes(2);
  });

  it('does not count a slow sign-in against the provider timeout', async () => {
    const slowSignIn = {
      getToken: vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return TOKEN;
      }),
    };
    const config = testConfig({ ...azureEnvironment, AI_TIMEOUT_MS: '100' }).provider;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => completion('{"answer":"ok"}'));
    await new ModelClient(config, () => undefined, fetcher, 16, { tokens: slowSignIn }).json(
      answer,
      'Return JSON.',
      {},
      signal(),
    );
    // Sign-in took 2.5x the timeout, yet the request itself still had its full time budget.
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  });

  it('asks the Azure Identity credential for the Cognitive Services scope and honours cancellation', async () => {
    const credential = {
      getToken: vi
        .fn()
        .mockResolvedValue({ token: TOKEN, expiresOnTimestamp: Date.now() + 3_600_000 }),
    };
    const provider = entraTokenProvider({ credential });
    const controller = new AbortController();
    await expect(provider.getToken(controller.signal)).resolves.toBe(TOKEN);
    expect(credential.getToken).toHaveBeenCalledWith(COGNITIVE_SERVICES_SCOPE, {
      abortSignal: controller.signal,
    });
    expect(COGNITIVE_SERVICES_SCOPE).toBe('https://cognitiveservices.azure.com/.default');
  });

  it('turns any credential failure into one actionable error that leaks no account detail', async () => {
    const credential = {
      getToken: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'AzureCliCredential: az failed for user alice@contoso.com tenant 11111111-secret',
          ),
        ),
    };
    const failing = entraTokenProvider({ credential });
    const fetcher = vi.fn<typeof fetch>();
    const request = new ModelClient(entra(), () => undefined, fetcher, 16, {
      tokens: failing,
    }).json(answer, 'Return JSON.', {}, signal());
    await expect(request).rejects.toMatchObject({ code: 'MODEL_AUTH', statusCode: 502 });
    await expect(request).rejects.toThrow('az login');
    await expect(request).rejects.not.toThrow('alice@contoso.com');
    await expect(request).rejects.not.toThrow('11111111');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('explains 401 and 403 differently, names the missing role, and never exposes the provider body', async () => {
    tokens.getToken.mockReset().mockResolvedValue(TOKEN);
    for (const [status, expected] of [
      [401, 'az login'],
      [403, 'Cognitive Services OpenAI User'],
    ] as const) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(`PRIVATE_BODY ${TOKEN}`, { status }));
      const request = new ModelClient(entra(), () => undefined, fetcher, 16, { tokens }).json(
        answer,
        'Return JSON.',
        {},
        signal(),
      );
      await expect(request).rejects.toMatchObject({ code: 'MODEL_AUTH' });
      await expect(request).rejects.toThrow(expected);
      await expect(request).rejects.not.toThrow('PRIVATE_BODY');
      await expect(request).rejects.not.toThrow(TOKEN);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(httpFailure(404, entra()).code).toBe('MODEL_NOT_FOUND');
    expect(httpFailure(429, entra()).code).toBe('MODEL_RATE_LIMIT');
    expect(httpFailure(500, entra()).code).toBe('MODEL_HTTP_ERROR');
  });
});

describe('bounded repair of malformed model output', () => {
  const config = () =>
    testConfig({ AI_PROVIDER: 'openai', AI_MODEL: 'm', OPENAI_API_KEY: 'test-placeholder' })
      .provider;

  it('repairs a malformed reply by sending only the validator reason back, then succeeds', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion('not json at all'))
      .mockResolvedValueOnce(completion('{"answer":42}'))
      .mockResolvedValueOnce(completion('{"answer":"fixed"}'));
    const usage = vi.fn();
    await expect(
      new ModelClient(config(), usage, fetcher).json(answer, 'Return JSON.', { x: 1 }, signal()),
    ).resolves.toEqual({ answer: 'fixed' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(usage).toHaveBeenCalledTimes(3);
    const second = JSON.parse(String(fetcher.mock.calls[1]![1]!.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(second.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(second.messages[3]!.content).toContain('rejected by the server');
    expect(second.messages[3]!.content).toContain('valid JSON');
  });

  it('is bounded: gives up after the configured repairs and fails visibly with no fallback', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => completion('{"answer":1}'));
    const request = new ModelClient(config(), () => undefined, fetcher).json(
      answer,
      'Return JSON.',
      {},
      signal(),
      100,
      { repairs: 1 },
    );
    await expect(request).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', statusCode: 502 });
    await expect(request).rejects.toThrow('after 1 bounded repair attempt');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('runs server-side semantic validation and repairs invalid citations', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion('{"answer":"cites S999"}'))
      .mockResolvedValueOnce(completion('{"answer":"cites S1"}'));
    const validate = (value: { answer: string }) => {
      if (value.answer.includes('S999'))
        throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'Source S999 was not supplied.');
    };
    await expect(
      new ModelClient(config(), () => undefined, fetcher).json(
        answer,
        'Return JSON.',
        {},
        signal(),
        100,
        { validate },
      ),
    ).resolves.toEqual({ answer: 'cites S1' });
    const repair = JSON.parse(String(fetcher.mock.calls[1]![1]!.body)) as {
      messages: { content: string }[];
    };
    expect(repair.messages.at(-1)!.content).toContain('Source S999 was not supplied');
  });

  it('does not repair transport failures, and counts repairs against the call budget', async () => {
    const budget = vi.fn<typeof fetch>().mockImplementation(async () => completion('{"answer":1}'));
    await expect(
      new ModelClient(config(), () => undefined, budget, 2).json(
        answer,
        'Return JSON.',
        {},
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'MODEL_CALL_BUDGET' });
    expect(budget).toHaveBeenCalledTimes(2);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('x', { status: 401 }));
    await expect(
      new ModelClient(config(), () => undefined, transport).json(
        answer,
        'Return JSON.',
        {},
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'MODEL_AUTH' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('never lets model-controlled text smuggle control characters into the stored reason', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => completion('{"answer":1}'));
    const request = new ModelClient(config(), () => undefined, fetcher).json(
      answer,
      'Return JSON.',
      {},
      signal(),
      100,
      {
        repairs: 0,
        validate: () => {
          throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'bad\u0007\u001b[31m id\nS1');
        },
      },
    );
    await expect(request).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    await expect(request).rejects.not.toThrow('\u0007');
  });
});

describe('provider telemetry and the status API', () => {
  it('counts real round trips, repairs, failures and reported tokens without storing content', async () => {
    const config = entra();
    const telemetry = new ProviderTelemetry(config);
    tokens.getToken.mockReset().mockResolvedValue(TOKEN);
    expect(telemetry.snapshot()).toMatchObject({
      mode: 'real-model',
      provider: 'azure',
      model: 'dev-deployment',
      auth: 'entra',
      connectivity: 'unverified',
      counters: { calls: 0, failures: 0, tokensReported: false },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion('bad'))
      .mockResolvedValueOnce(completion('{"answer":"ok"}'))
      .mockResolvedValueOnce(new Response('x', { status: 403 }));
    const client = new ModelClient(config, () => undefined, fetcher, 16, {
      tokens,
      observer: telemetry,
    });
    await client.json(answer, 'Return JSON.', {}, signal());
    expect(telemetry.snapshot()).toMatchObject({
      connectivity: 'ok',
      counters: {
        calls: 2,
        repairCalls: 1,
        failures: 0,
        inputTokens: 60,
        outputTokens: 24,
        tokensReported: true,
      },
    });
    await expect(client.json(answer, 'Return JSON.', {}, signal())).rejects.toThrow();
    const failed = telemetry.snapshot();
    expect(failed).toMatchObject({
      connectivity: 'failing',
      lastError: { code: 'MODEL_AUTH' },
      counters: { failures: 1 },
    });
    const serialized = JSON.stringify(failed);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('swarm-dev');
  });

  it('reports local/rules mode honestly when no provider is configured', async () => {
    const harness = await buildApp({ config: testConfig() });
    try {
      const response = await harness.app.inject({ method: 'GET', url: '/api/provider/status' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        mode: 'local-rules',
        provider: 'none',
        connectivity: 'not-applicable',
        configured: false,
        counters: { calls: 0, failures: 0 },
      });
      const check = await harness.app.inject({ method: 'POST', url: '/api/provider/check' });
      expect(check.statusCode).toBe(503);
      expect(check.json().error.code).toBe('MODEL_NOT_CONFIGURED');
    } finally {
      await harness.app.close();
    }
  });

  it('performs an explicit real round trip on request and surfaces failures without falling back', async () => {
    const config = testConfig({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'm',
      OPENAI_API_KEY: 'test-placeholder-only',
      RATE_LIMIT_SCALE: '10',
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion('{"status":"ok"}'));
    const harness = await buildApp({
      config,
      modelFactory: (onUsage) => new ModelClient(config.provider, onUsage, fetcher),
    });
    try {
      const response = await harness.app.inject({ method: 'POST', url: '/api/provider/check' });
      expect(response.statusCode, response.body).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(response.body).not.toContain('test-placeholder-only');
    } finally {
      await harness.app.close();
    }
  });
});
