import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyRequest } from 'fastify';
import { BYOK_HEADERS, BYOK_PROVIDER } from '../../../../shared/public.js';
import type { ProviderConfig } from '../../config.js';
import { registerSecret } from './secrets.js';

/**
 * Google's Gemini API, through its OpenAI-compatible endpoint. The host is a constant: **nothing a person sends can
 * name another one**, so a key can only ever be sent to Google, and the server cannot be made to fetch an address of
 * someone's choosing through it. Documentation: https://ai.google.dev/gemini-api/docs/openai
 */
export const GEMINI_HOST = 'generativelanguage.googleapis.com';
export const GEMINI_BASE_URL = `https://${GEMINI_HOST}/v1beta/openai/`;

/** What a key may look like: printable ASCII without spaces. No prefix is required, so a change of format breaks nothing. */
const KEY_SHAPE = /^[\x21-\x7e]{16,256}$/u;
/** What a model name may look like. It goes in the body of a request and never into an address. */
export const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export interface ParsedByok {
  key: string;
  model: string | null;
}

/** What a request said about a key of its own. */
export type ByokHeaders =
  | { kind: 'none' }
  | { kind: 'ok'; byok: ParsedByok }
  | { kind: 'invalid'; about: 'provider' | 'key' | 'model' };

const read = (headers: IncomingHttpHeaders, name: string): string | string[] | undefined =>
  headers[name];

/**
 * Reads the three headers a page sends with a key. A key that is not a plain value is invalid, and so is a provider
 * this server does not know. Nothing about the key is in the answer.
 */
export function parseByokHeaders(headers: IncomingHttpHeaders): ByokHeaders {
  const key = read(headers, BYOK_HEADERS.key);
  const provider = read(headers, BYOK_HEADERS.provider);
  const model = read(headers, BYOK_HEADERS.model);
  if (key === undefined && provider === undefined && model === undefined) return { kind: 'none' };
  if (key === undefined) {
    // A provider or a model with no key is the page asking for nothing: it uses the free tier.
    return { kind: 'none' };
  }
  if (typeof provider !== 'string' || provider.trim().toLowerCase() !== BYOK_PROVIDER) {
    return { kind: 'invalid', about: 'provider' };
  }
  if (typeof key !== 'string' || !KEY_SHAPE.test(key.trim())) {
    return { kind: 'invalid', about: 'key' };
  }
  if (model !== undefined && (typeof model !== 'string' || !MODEL_SHAPE.test(model.trim()))) {
    return { kind: 'invalid', about: 'model' };
  }
  return {
    kind: 'ok',
    byok: { key: key.trim(), model: typeof model === 'string' ? model.trim() : null },
  };
}

const taken = new WeakMap<object, ByokHeaders>();

/**
 * The first thing that happens to a request in the public edition. The key is read and registered so that it can be
 * recognised anywhere it might be written, and then **taken out of the request**: from `headers` and from the raw
 * header list, so that no later hook, plugin or handler, and no log of a request, can see it. It lives on in the
 * funding of the request, which is memory for the length of the request, and nowhere else.
 */
export function takeByokHeaders(request: FastifyRequest): ByokHeaders {
  const found = parseByokHeaders(request.raw.headers);
  const key = request.raw.headers[BYOK_HEADERS.key];
  if (typeof key === 'string') registerSecret(key.trim());
  else if (Array.isArray(key)) for (const one of key) registerSecret(one.trim());
  for (const name of Object.values(BYOK_HEADERS)) delete request.raw.headers[name];
  const raw = request.raw.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index]?.toLowerCase();
    if (name !== undefined && (Object.values(BYOK_HEADERS) as string[]).includes(name)) {
      raw[index + 1] = '';
    }
  }
  taken.set(request, found);
  return found;
}

/** What the request said about a key of its own, as `takeByokHeaders` found it. */
export const byokOf = (request: FastifyRequest): ByokHeaders =>
  taken.get(request) ?? { kind: 'none' };

/**
 * How a person's own Gemini key is reached. The key is the credential of this one object, made for one request or run.
 * With no key it only says which provider it is (for counters and labels) and reaches nothing.
 */
export function geminiProvider(
  key: string | null,
  model: string | null,
  timeoutMs: number,
): ProviderConfig {
  return {
    name: 'gemini',
    model,
    baseUrl: GEMINI_BASE_URL,
    apiKey: key,
    auth: 'api-key',
    managedIdentityClientId: null,
    configured: key !== null && model !== null,
    reason: key === null ? 'A person’s own key is used for one request at a time.' : '',
    timeoutMs,
  };
}
