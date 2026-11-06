import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { chooseModels, connectGemini } from '../../src/public/byok/connect.js';
import { classifyGemini, geminiFailure } from '../../src/public/byok/errors.js';
import { EphemeralKeys } from '../../src/public/byok/keys.js';
import {
  GEMINI_BASE_URL,
  GEMINI_HOST,
  parseByokHeaders,
  takeByokHeaders,
} from '../../src/public/byok/provider.js';
import {
  forgetAllSecrets,
  holdsSecret,
  redactingStream,
  redactSecrets,
  registerSecret,
  scrub,
} from '../../src/public/byok/secrets.js';
import { WindowLimiter } from '../../src/public/limits.js';
import { FakeGemini, GEMINI_MODELS, googleError } from '../support/fake-gemini.js';

const KEY = 'AIzaSyD-canary0123456789abcdefghijklmn_';
const PLAIN = 'canary-plain-key-0123456789-abcdefghij';

describe('a key is recognised wherever it turns up', () => {
  it('removes a key it was handed, in the forms it is written in, and one that has the shape of a key', () => {
    forgetAllSecrets();
    registerSecret(PLAIN);
    expect(redactSecrets(`failed with ${PLAIN} in it`)).toBe('failed with [key removed] in it');
    expect(redactSecrets(`https://x.example/?q=${encodeURIComponent(PLAIN)}`)).not.toContain(PLAIN);
    expect(redactSecrets(JSON.stringify({ message: `bad ${PLAIN}` }))).not.toContain(PLAIN);
    expect(redactSecrets(Buffer.from(PLAIN).toString('base64'))).toBe('[key removed]');
    // Not handed to the server, but the shape of Google's keys, of a bearer token, of the header and of a query parameter.
    expect(redactSecrets(`oops ${KEY} oops`)).toBe('oops [key removed] oops');
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe(
      'Authorization: Bearer [key removed]',
    );
    expect(redactSecrets('x-swarm-provider-key: some-unregistered-value-1234')).toBe(
      'x-swarm-provider-key: [key removed]',
    );
    expect(redactSecrets('GET /v1beta/models?key=some-unregistered-value&alt=json')).toBe(
      'GET /v1beta/models?key=[key removed]&alt=json',
    );
    expect(redactSecrets('nothing to see, 12345678, a normal sentence')).toBe(
      'nothing to see, 12345678, a normal sentence',
    );
    expect(holdsSecret(PLAIN)).toBe(true);
    expect(holdsSecret('plain text')).toBe(false);
  });

  it('forgets a key once nobody could be holding it, and does not grow without end', () => {
    forgetAllSecrets();
    const at = 1_000_000;
    registerSecret(PLAIN, at);
    expect(redactSecrets(PLAIN, at + 5 * 3_600_000)).toBe('[key removed]');
    expect(redactSecrets(PLAIN, at + 7 * 3_600_000)).toBe(PLAIN);
    // Short values would mask ordinary text, so they are not tracked.
    registerSecret('short');
    expect(redactSecrets('a short word')).toBe('a short word');
    for (let i = 0; i < 2_500; i++) registerSecret(`bulk-secret-${String(i).padStart(6, '0')}-x`);
    expect(redactSecrets('bulk-secret-000000-x')).toBe('bulk-secret-000000-x');
    expect(redactSecrets('bulk-secret-002499-x')).toBe('[key removed]');
    forgetAllSecrets();
  });

  it('cleans what is nested in a value, and the lines of a log', () => {
    forgetAllSecrets();
    registerSecret(PLAIN);
    expect(scrub({ a: [PLAIN, { b: `x ${PLAIN}` }], n: 3, ok: true })).toEqual({
      a: ['[key removed]', { b: 'x [key removed]' }],
      n: 3,
      ok: true,
    });
    const written: string[] = [];
    const stream = redactingStream({ write: (chunk) => written.push(chunk) });
    stream.write(`{"level":30,"msg":"hello ${PLAIN}"}\n`);
    stream.write(`{"level":30,"msg":"hello ${KEY}"}\n`);
    expect(written.join('')).not.toContain(PLAIN);
    expect(written.join('')).not.toContain(KEY);
    expect(written.join('')).toContain('hello [key removed]');
    forgetAllSecrets();
  });
});

describe('what a request says about a key of its own', () => {
  const headers = (extra: Record<string, string | string[]>) => ({
    'x-swarm-provider': 'gemini',
    'x-swarm-provider-key': KEY,
    ...extra,
  });

  it('reads a key and a model, and nothing when there is no key', () => {
    expect(parseByokHeaders(headers({ 'x-swarm-provider-model': 'gemini-2.5-flash' }))).toEqual({
      kind: 'ok',
      byok: { key: KEY, model: 'gemini-2.5-flash' },
    });
    expect(parseByokHeaders(headers({}))).toEqual({ kind: 'ok', byok: { key: KEY, model: null } });
    expect(parseByokHeaders({})).toEqual({ kind: 'none' });
    expect(parseByokHeaders({ 'x-swarm-provider': 'gemini' })).toEqual({ kind: 'none' });
  });

  it('refuses what is not a key, a model or a provider this server knows, without saying what it saw', () => {
    expect(parseByokHeaders(headers({ 'x-swarm-provider': 'openai' }))).toEqual({
      kind: 'invalid',
      about: 'provider',
    });
    expect(parseByokHeaders({ 'x-swarm-provider-key': KEY })).toEqual({
      kind: 'invalid',
      about: 'provider',
    });
    for (const bad of [
      'short',
      'has space inside the key 0123456789',
      'x'.repeat(300),
      'ключ-0123456789-abcdef',
    ]) {
      expect(parseByokHeaders(headers({ 'x-swarm-provider-key': bad }))).toEqual({
        kind: 'invalid',
        about: 'key',
      });
    }
    expect(parseByokHeaders(headers({ 'x-swarm-provider-key': [KEY, KEY] }))).toEqual({
      kind: 'invalid',
      about: 'key',
    });
    for (const bad of ['../../etc', 'a b', 'x'.repeat(80), 'https://evil.example/m']) {
      expect(parseByokHeaders(headers({ 'x-swarm-provider-model': bad }))).toEqual({
        kind: 'invalid',
        about: 'model',
      });
    }
  });

  it('takes the key out of the request, so that nothing after it can see it', () => {
    forgetAllSecrets();
    const request = {
      raw: {
        headers: {
          host: 'localhost',
          'x-swarm-provider': 'gemini',
          'x-swarm-provider-key': PLAIN,
          'x-swarm-provider-model': 'gemini-2.5-flash',
        } as Record<string, string>,
        rawHeaders: [
          'Host',
          'localhost',
          'X-Swarm-Provider',
          'gemini',
          'X-Swarm-Provider-Key',
          PLAIN,
          'X-Swarm-Provider-Model',
          'gemini-2.5-flash',
        ],
      },
    } as unknown as FastifyRequest;
    const found = takeByokHeaders(request);
    expect(found).toEqual({ kind: 'ok', byok: { key: PLAIN, model: 'gemini-2.5-flash' } });
    expect(request.raw.headers).toEqual({ host: 'localhost' });
    expect(JSON.stringify(request.raw.rawHeaders)).not.toContain(PLAIN);
    expect(JSON.stringify(request.raw.rawHeaders)).not.toContain('gemini');
    // And from then on the server recognises it wherever it is written.
    expect(redactSecrets(`error for ${PLAIN}`)).toBe('error for [key removed]');
    forgetAllSecrets();
  });
});

describe('a key held in memory for a run', () => {
  const make = (clock: { at: number }, max?: number) =>
    new EphemeralKeys({
      now: () => clock.at,
      idleMs: 90 * 60_000,
      absoluteMs: 4 * 3_600_000,
      ...(max ? { max } : {}),
    });

  it('is held for the person, used by a run, and forgotten when they say so', () => {
    const clock = { at: 0 };
    const keys = make(clock);
    expect(keys.get('w1')).toBeNull();
    keys.put('w1', PLAIN, 'gemini-2.5-flash');
    expect(keys.get('w1')).toEqual({ key: PLAIN, model: 'gemini-2.5-flash' });
    expect(keys.get('w2')).toBeNull();
    expect(keys.forget('w1')).toBe(true);
    expect(keys.get('w1')).toBeNull();
    keys.put('w1', PLAIN, null);
    keys.forgetAll();
    expect(keys.size).toBe(0);
  });

  it('is forgotten after it was not used for a while, and after a fixed time whatever it is used for', () => {
    const clock = { at: 0 };
    const keys = make(clock);
    keys.put('w1', PLAIN, 'm');
    clock.at = 89 * 60_000;
    expect(keys.get('w1')).not.toBeNull();
    clock.at = 89 * 60_000 + 91 * 60_000;
    expect(keys.get('w1')).toBeNull();
    // Used again and again, the same key still ends 4 hours after it was first seen.
    clock.at = 0;
    keys.put('w2', PLAIN, 'm');
    for (let minute = 30; minute <= 240; minute += 30) {
      clock.at = minute * 60_000;
      keys.put('w2', PLAIN, 'm');
    }
    clock.at = 241 * 60_000;
    expect(keys.get('w2')).toBeNull();
    // A different key starts its own lifetime.
    const other = { at: 0 };
    const more = make(other);
    more.put('w', 'key-A-0123456789', 'm');
    for (const minute of [60, 120, 180]) {
      other.at = minute * 60_000;
      expect(more.get('w')).not.toBeNull();
    }
    other.at = 200 * 60_000;
    more.put('w', 'key-B-0123456789', 'm');
    other.at = 250 * 60_000;
    expect(more.get('w')).toEqual({ key: 'key-B-0123456789', model: 'm' });
  });

  it('sweeps what has expired and holds no more than it is allowed', () => {
    const clock = { at: 0 };
    const keys = make(clock, 3);
    for (const id of ['a', 'b', 'c', 'd']) keys.put(id, `${PLAIN}-${id}`, 'm');
    expect(keys.size).toBe(3);
    expect(keys.get('a')).toBeNull();
    clock.at = 5 * 3_600_000;
    expect(keys.sweep()).toBe(3);
    expect(keys.size).toBe(0);
  });
});

describe('what Google says is read for the kind of trouble, and never repeated', () => {
  const body = (
    code: number,
    status: string,
    message: string,
    reason?: string,
    extra: object = {},
  ) =>
    JSON.stringify([
      {
        error: {
          code,
          message,
          status,
          ...(reason ? { details: [{ reason }] } : {}),
          ...extra,
        },
      },
    ]);

  it.each([
    [
      'a key that is not valid (Google answers 400)',
      400,
      body(
        400,
        'INVALID_ARGUMENT',
        'API key not valid. Please pass a valid API key.',
        'API_KEY_INVALID',
      ),
      'invalid-key',
    ],
    [
      'a key that has expired',
      400,
      body(
        400,
        'INVALID_ARGUMENT',
        'API key expired. Please renew the API key.',
        'API_KEY_INVALID',
      ),
      'invalid-key',
    ],
    [
      'no permission',
      403,
      body(403, 'PERMISSION_DENIED', 'Your API key doesn’t have the required permissions.'),
      'invalid-key',
    ],
    [
      'no credentials',
      401,
      body(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'),
      'invalid-key',
    ],
    [
      'a country that is not served',
      400,
      body(400, 'FAILED_PRECONDITION', 'User location is not supported for the API use.'),
      'region',
    ],
    [
      'a country with no free tier',
      400,
      body(
        400,
        'FAILED_PRECONDITION',
        'Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.',
      ),
      'quota',
    ],
    [
      'requests per minute',
      429,
      body(
        429,
        'RESOURCE_EXHAUSTED',
        'You exceeded your current quota, please check your plan and billing details.',
        undefined,
        {
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
            },
          ],
        },
      ),
      'rate-limited',
    ],
    [
      'requests per day',
      429,
      body(
        429,
        'RESOURCE_EXHAUSTED',
        'You exceeded your current quota, please check your plan and billing details.',
        undefined,
        {
          details: [
            { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
          ],
        },
      ),
      'quota',
    ],
    [
      'a quota with no more said',
      429,
      body(
        429,
        'RESOURCE_EXHAUSTED',
        'You exceeded your current quota, please check your plan and billing details.',
      ),
      'quota',
    ],
    [
      'a limit with no more said',
      429,
      body(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).'),
      'rate-limited',
    ],
    ['payment required', 402, '{}', 'quota'],
    [
      'a model that is not there',
      404,
      body(
        404,
        'NOT_FOUND',
        'models/gemini-9 is not found for API version v1beta, or is not supported for generateContent.',
      ),
      'model-not-found',
    ],
    [
      'Google having trouble',
      503,
      body(503, 'UNAVAILABLE', 'The model is overloaded. Please try again later.'),
      'unavailable',
    ],
    ['a timeout', 504, '', 'unavailable'],
    [
      'something else',
      400,
      body(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.'),
      'other',
    ],
    ['a body that is not JSON', 400, '<html>nope</html>', 'other'],
  ])('%s', (_name, status, text, problem) => {
    expect(classifyGemini(status as number, text as string).problem).toBe(problem);
  });

  it('names a parameter that Google does not take, so that the client can leave it out', () => {
    const unknown = (field: string) =>
      body(
        400,
        'INVALID_ARGUMENT',
        `Invalid JSON payload received. Unknown name "${field}": Cannot find field.`,
      );
    expect(classifyGemini(400, unknown('max_completion_tokens'))).toEqual({
      problem: 'bad-parameter',
      parameter: 'max_completion_tokens',
    });
    expect(classifyGemini(400, unknown('reasoning_effort'))).toEqual({
      problem: 'bad-parameter',
      parameter: 'reasoning_effort',
    });
    expect(classifyGemini(400, unknown('temperature')).parameter).toBe('temperature');
    // A field that is not one the client gives up is not named, and so cannot be made to be.
    expect(classifyGemini(400, unknown('messages')).problem).toBe('other');
    expect(
      classifyGemini(400, body(400, 'INVALID_ARGUMENT', 'Thinking is not supported by this model.'))
        .parameter,
    ).toBe('reasoning_effort');
    expect(
      classifyGemini(
        400,
        body(400, 'INVALID_ARGUMENT', 'The response_format json_schema is not supported.'),
      ).parameter,
    ).toBe('response_format');
  });

  it('says what to do in words that are ours, with a code the page knows, and carries nothing of Google’s', () => {
    const cases = [
      [
        400,
        body(
          400,
          'INVALID_ARGUMENT',
          'API key not valid. Please pass a valid API key. AIzaSyShouldNotAppearInAnything',
          'API_KEY_INVALID',
        ),
        'BYOK_KEY_REJECTED',
        502,
      ],
      [
        429,
        body(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted'),
        'BYOK_RATE_LIMITED',
        429,
      ],
      [
        429,
        body(429, 'RESOURCE_EXHAUSTED', 'per day quota exceeded, secret-detail-zzz'),
        'BYOK_QUOTA',
        429,
      ],
      [
        400,
        body(400, 'FAILED_PRECONDITION', 'User location is not supported for the API use.'),
        'BYOK_REGION',
        502,
      ],
      [
        404,
        body(404, 'NOT_FOUND', 'models/x is not found for API version v1beta'),
        'BYOK_MODEL_NOT_FOUND',
        502,
      ],
    ] as const;
    for (const [status, text, code, http] of cases) {
      const failure = geminiFailure(status, text);
      expect(failure.code).toBe(code);
      expect(failure.statusCode).toBe(http);
      expect(failure.message).not.toMatch(
        /AIza|secret-detail|INVALID_ARGUMENT|RESOURCE_EXHAUSTED|generativelanguage/u,
      );
      expect(failure.message.length).toBeGreaterThan(30);
      // One thing to do, said once, as a sentence.
      expect(failure.message).toMatch(/[.]$/u);
    }
    // Asking again cannot help a quota or a key, and can help a limit that passes.
    expect(geminiFailure(429, cases[1][1]).retryable).toBe(true);
    expect(geminiFailure(429, cases[2][1]).retryable).toBe(false);
    expect(geminiFailure(400, cases[0][1]).retryable).toBe(false);
  });
});

describe('choosing a model from what the key can use', () => {
  it('keeps the text models, prefers a stable flash model of the highest version, and lists the rest', () => {
    const { models, defaultModel } = chooseModels(GEMINI_MODELS);
    expect(defaultModel).toBe('gemini-2.5-flash');
    expect(models.map((model) => model.id)).toEqual([
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-3-flash-preview',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
    ]);
    expect(models.find((model) => model.id === 'gemini-3-flash-preview')!.label).toBe(
      'Gemini 3 Flash Preview (preview)',
    );
    expect(models.find((model) => model.id === 'gemini-2.5-pro')!.label).toBe('Gemini 2.5 Pro');
  });

  it('is not tied to a name: another list gives another default, and a list with no text model gives none', () => {
    expect(
      chooseModels([
        'models/gemini-4-flash',
        'models/gemini-4-flash-preview-05-20',
        'models/gemini-3.6-flash',
      ]).defaultModel,
    ).toBe('gemini-4-flash');
    expect(chooseModels(['models/gemini-4-pro-preview', 'models/gemini-3-pro']).defaultModel).toBe(
      'gemini-3-pro',
    );
    expect(
      chooseModels([
        'models/gemini-embedding-001',
        'models/gemma-3-27b-it',
        'models/imagen-4',
        '../../evil',
        'models/gemini-2.5-flash-live',
      ]).defaultModel,
    ).toBeNull();
    expect(chooseModels([]).models).toEqual([]);
  });

  it('shows at most a few dozen, and never a name that is not a name', () => {
    const many = Array.from({ length: 200 }, (_, i) => `models/gemini-${i % 9}.${i}-flash`);
    expect(chooseModels(many).models.length).toBeLessThanOrEqual(40);
    expect(
      chooseModels(['models/gemini-2.5-flash/../x', 'models/gemini-2.5 flash']).models,
    ).toEqual([]);
  });
});

describe('trying a key with one request that uses no tokens', () => {
  const make = () => {
    const fake = new FakeGemini();
    fake.keys.add(KEY);
    return fake;
  };

  it('lists the models, sends the key only in a header, to Google’s host, and follows no redirect', async () => {
    const fake = make();
    const result = await connectGemini(KEY, { fetcher: fake.fetch });
    expect(result.status).toBe('valid');
    expect(result.defaultModel).toBe('gemini-2.5-flash');
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]).toMatchObject({
      method: 'GET',
      host: GEMINI_HOST,
      path: '/v1beta/openai/models',
      authorization: `Bearer ${KEY}`,
      redirect: 'error',
    });
    expect(fake.seen[0]!.url).toBe(`${GEMINI_BASE_URL}models`);
    expect(fake.seen[0]!.url).not.toContain(KEY);
    expect(fake.strays).toEqual([]);
  });

  it('says one of a few plain things for whatever Google says, and never what Google said', async () => {
    const fake = make();
    const status = async (key = KEY) => connectGemini(key, { fetcher: fake.fetch });
    const wrong = await status('AIzaSyWrongWrongWrongWrongWrongWrong0000');
    expect(wrong).toMatchObject({ status: 'invalid', models: [], defaultModel: null });
    expect(wrong.message).toBe(
      'Google did not accept this key. Check that you copied all of it, or make a new one in AI Studio.',
    );
    expect(JSON.stringify(wrong)).not.toMatch(/API_KEY_INVALID|INVALID_ARGUMENT|AIzaSyWrong/u);

    fake.listing = () =>
      googleError(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).');
    expect((await status()).status).toBe('rate-limited');
    fake.listing = () =>
      googleError(
        429,
        'RESOURCE_EXHAUSTED',
        'You exceeded your current quota, please check your plan and billing details. per day',
      );
    expect((await status()).status).toBe('quota');
    fake.listing = () =>
      googleError(400, 'FAILED_PRECONDITION', 'User location is not supported for the API use.');
    expect((await status()).status).toBe('region');
    fake.listing = () => googleError(503, 'UNAVAILABLE', 'overloaded');
    expect((await status()).status).toBe('unreachable');
    fake.listing = () => new Response('not json at all', { status: 200 });
    expect((await status()).status).toBe('unreachable');
    fake.listing = () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    expect((await status()).status).toBe('unreachable');
    fake.listing = () => {
      throw new TypeError('fetch failed');
    };
    expect((await status()).status).toBe('unreachable');
    expect(fake.strays).toEqual([]);
  });
});

describe('a limit per key, in memory', () => {
  it('lets so many through in a window, counts only what it lets through, and tells when to come back', () => {
    const clock = { at: 0 };
    const limiter = new WindowLimiter(3, 60_000, () => clock.at, 3);
    expect([1, 2, 3, 4].map(() => limiter.allow('a'))).toEqual([true, true, true, false]);
    expect(limiter.retryAfterMs('a')).toBe(60_000);
    clock.at = 30_000;
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.retryAfterMs('a')).toBe(30_000);
    clock.at = 60_001;
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
    // It remembers no more keys than it is allowed.
    for (const key of ['c', 'd', 'e', 'f']) limiter.allow(key);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});
