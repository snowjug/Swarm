import type { ByokStatus } from '../../../../shared/public.js';
import { ProviderHttpError, type ProviderErrorDetail } from '../../models/client.js';

/**
 * What Google's Gemini API said when it refused a request, in a few words that name a cause and nothing else. Google's
 * errors are not OpenAI's (`status` is a word such as `RESOURCE_EXHAUSTED`, `code` is a number, and the error may come
 * in a list), so they are read here, for what kind of problem they say, and **never repeated**: the person is told what
 * to do about it in our words, and the provider's text goes nowhere. The shapes are from Google's troubleshooting
 * guide (https://aistudio.google.com/docs/troubleshooting.md).
 */
export type GeminiProblem =
  | 'invalid-key'
  | 'rate-limited'
  | 'quota'
  | 'region'
  | 'model-not-found'
  | 'bad-parameter'
  | 'unavailable'
  | 'other';

export interface Classified {
  problem: GeminiProblem;
  /** For `bad-parameter`: the request field the provider did not know or take. */
  parameter: string | null;
}

/** What an error says, lower-cased and joined: the message, the status word, the reasons. Used only to classify. */
function haystack(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.slice(0, 2_000).toLowerCase();
  }
  const first: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const error = record(record(first).error);
  const words: string[] = [];
  for (const field of ['message', 'status', 'code', 'type', 'param']) {
    const value = error[field];
    if (typeof value === 'string' || typeof value === 'number') words.push(String(value));
  }
  if (Array.isArray(error.details)) {
    for (const detail of error.details.slice(0, 8)) {
      const reason = record(detail).reason;
      if (typeof reason === 'string') words.push(reason);
    }
  }
  // The whole of it too: a quota's own name (per minute, per day) is in the details, not the message.
  words.push(JSON.stringify(first ?? '').slice(0, 4_000));
  return words.join(' ').slice(0, 6_000).toLowerCase();
}

/** Request fields that may be named in a refusal, and so may be given up one at a time: nothing else is. */
const ADJUSTABLE = new Set([
  'max_completion_tokens',
  'reasoning_effort',
  'temperature',
  'response_format',
  'top_p',
]);

const KEY_REJECTED =
  /api[ _]?key (?:not valid|invalid|expired|not found)|api_key_(?:invalid|expired)|invalid_api_key|incorrect api key/u;
/** "The free tier is not available in your country. Please enable billing": a plan, not a place. */
const NEEDS_BILLING = /free tier[^"]{0,80}not available[^"]{0,120}billing|enable billing/u;
const REGION =
  /location is not supported|not available in your (?:country|region|location)|unsupported_user_location|user location/u;
const PER_MINUTE = /per[ _]?minute/u;
const PER_DAY = /per[ _]?day|daily/u;
/** Words that say a plan or billing is the limit, and not how fast requests come. */
const PLAN_WORDS = /billing|check your plan|exceeded your current quota/u;
const MODEL_MISSING =
  /models?\/[^\s"]+ is not found|model[^.]{0,80} not found|not found for api version|is not supported for generatecontent/u;

export function classifyGemini(status: number, body: string): Classified {
  const text = haystack(body);
  const done = (problem: GeminiProblem, parameter: string | null = null): Classified => ({
    problem,
    parameter,
  });
  if (KEY_REJECTED.test(text)) return done('invalid-key');
  if (NEEDS_BILLING.test(text)) return done('quota');
  if (REGION.test(text)) return done('region');
  if (status === 401) return done('invalid-key');
  if (status === 403) return done('invalid-key');
  if (status === 402) return done('quota');
  if (status === 429 || text.includes('resource_exhausted')) {
    // Google's limits per minute pass by waiting; a limit per day, or a plan that does not allow the request, does not.
    if (PER_MINUTE.test(text) && !PER_DAY.test(text)) return done('rate-limited');
    return done(PER_DAY.test(text) || PLAN_WORDS.test(text) ? 'quota' : 'rate-limited');
  }
  if (status === 404 || MODEL_MISSING.test(text)) return done('model-not-found');
  if (status === 408 || status >= 500) return done('unavailable');
  if (status === 400 || status === 422) {
    if (text.includes('failed_precondition') && /billing|free tier/u.test(text)) {
      return done('quota');
    }
    const named =
      /unknown name "([a-z_]{1,40})"/u.exec(text) ??
      /unsupported parameter:?\s*['"`]?([a-z_]{1,40})/u.exec(text) ??
      /invalid value at '([a-z_.]{1,40})/u.exec(text);
    const parameter = named?.[1] ?? null;
    if (parameter !== null && ADJUSTABLE.has(parameter)) return done('bad-parameter', parameter);
    if (/thinking|reasoning/u.test(text) && /not support|unsupported|not enabled/u.test(text)) {
      return done('bad-parameter', 'reasoning_effort');
    }
    if (
      /response_format|json_schema|schema/u.test(text) &&
      /not support|unsupported|invalid/u.test(text)
    ) {
      return done('bad-parameter', 'response_format');
    }
  }
  return done('other');
}

/** What a person is told, with the one thing to do. The code is what the page decides by. */
const WORDS: Record<
  'invalid-key' | 'rate-limited' | 'quota' | 'region' | 'model-not-found',
  { status: number; code: string; message: string; connect: ByokStatus | null }
> = {
  'invalid-key': {
    status: 502,
    code: 'BYOK_KEY_REJECTED',
    message:
      'Google did not accept this key. Check that you copied all of it, or make a new one in AI Studio.',
    connect: 'invalid',
  },
  'rate-limited': {
    status: 429,
    code: 'BYOK_RATE_LIMITED',
    message:
      'Your Google quota is used up for the moment. Wait a minute, or try a different model.',
    connect: 'rate-limited',
  },
  quota: {
    status: 429,
    code: 'BYOK_QUOTA',
    message: 'Your Google quota or billing does not allow this. Check your plan in AI Studio.',
    connect: 'quota',
  },
  region: {
    status: 502,
    code: 'BYOK_REGION',
    message: 'Google does not offer this key’s service from where the server is. Try another key.',
    connect: 'region',
  },
  'model-not-found': {
    status: 502,
    code: 'BYOK_MODEL_NOT_FOUND',
    message: 'The model you chose is not available to your key. Pick another model in settings.',
    connect: null,
  },
};

const UNAVAILABLE =
  'Google’s service did not answer properly. Try again in a moment, or pick a different model.';
const OTHER = 'Google did not accept the request. Try again, or pick a different model.';

/** What `POST /api/byok/connect` says for a problem, or null when it is not one a key check can have. */
export const connectStatusOf = (problem: GeminiProblem): ByokStatus =>
  problem === 'invalid-key' ||
  problem === 'rate-limited' ||
  problem === 'quota' ||
  problem === 'region'
    ? (WORDS[problem].connect as ByokStatus)
    : 'unreachable';

/** The plain words for a problem, for the key check. */
export const wordsOf = (problem: 'invalid-key' | 'rate-limited' | 'quota' | 'region'): string =>
  WORDS[problem].message;

const detailOf = (parameter: string | null): ProviderErrorDetail => ({
  code: parameter === null ? null : 'unsupported_parameter',
  innerCode: null,
  param: parameter,
  filtered: [],
});

/**
 * The failure to raise for a refusal by Gemini. A parameter the provider does not take is raised in the form the model
 * client already adjusts to (it asks again without it, or with the other name for the token limit); anything else is
 * raised in words for a person with a code the page knows. Provider text is not in any of them.
 */
export function geminiFailure(status: number, body: string): ProviderHttpError {
  const { problem, parameter } = classifyGemini(status, body);
  if (problem === 'bad-parameter') {
    return new ProviderHttpError(
      502,
      'MODEL_PARAMETER_UNSUPPORTED',
      'Google did not take a setting of the request. Try a different model.',
      status,
      detailOf(parameter),
    );
  }
  if (problem === 'unavailable') {
    return new ProviderHttpError(502, 'MODEL_HTTP_ERROR', UNAVAILABLE, status, detailOf(null));
  }
  if (problem === 'other') {
    return new ProviderHttpError(502, 'MODEL_HTTP_ERROR', OTHER, status, detailOf(null));
  }
  const words = WORDS[problem];
  return new ProviderHttpError(
    words.status,
    words.code,
    words.message,
    status,
    detailOf(null),
    problem === 'rate-limited',
  );
}
