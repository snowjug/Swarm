import type { ByokConnectResult, ByokModel, ByokStatus } from '../../../../shared/public.js';
import { classifyGemini, connectStatusOf, wordsOf } from './errors.js';
import { GEMINI_BASE_URL, GEMINI_HOST, MODEL_SHAPE } from './provider.js';

const MAX_LIST_BYTES = 512_000;
const MAX_MODELS = 40;
const CONNECT_TIMEOUT_MS = 10_000;

export const CONNECT_WORDS: Record<'valid' | 'unreachable' | 'disabled', string> = {
  valid: 'Connected. Your key works. Choose a model, and your runs use your own Google quota.',
  unreachable: 'We could not reach Google just now. Try again in a moment.',
  disabled: 'Using your own key is switched off on this site.',
};

const failed = (status: ByokStatus, message: string): ByokConnectResult => ({
  status,
  message,
  models: [],
  defaultModel: null,
});

/** Models that are not for writing structured text: images, speech, live audio, embeddings, robotics, agents. */
const NOT_TEXT =
  /image|tts|live|audio|embed|transcribe|veo|imagen|robotics|computer-use|aqa|learnlm|dialog/u;

interface Ranked extends ByokModel {
  family: number;
  stable: number;
  version: number;
}

/** "Gemini 2.5 Flash", and whether it is a preview: a name a person can read. */
function labelOf(id: string, stable: boolean): string {
  const words = id
    .split('-')
    .map((word) => (/^\d/u.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)));
  return `${words.join(' ')}${stable ? '' : ' (preview)'}`;
}

/**
 * The models a key can use for text, best default first. The names come from the API and none is written in code, because
 * they change quickly: the rule is a `gemini-*` text model, preferring `flash` (fast and cheap enough for structured
 * answers) over `flash-lite` over `pro` over the rest; a stable name over a preview or experimental one; then the highest
 * version. The person can pick any of them.
 */
export function chooseModels(ids: readonly string[]): {
  models: ByokModel[];
  defaultModel: string | null;
} {
  const seen = new Set<string>();
  const ranked: Ranked[] = [];
  for (const raw of ids) {
    const id = raw.replace(/^models\//u, '');
    if (seen.has(id) || !id.startsWith('gemini-') || !MODEL_SHAPE.test(id) || NOT_TEXT.test(id)) {
      continue;
    }
    seen.add(id);
    const stable = !/preview|exp/u.test(id);
    const family =
      /flash/u.test(id) && !/lite/u.test(id) ? 3 : /lite/u.test(id) ? 2 : /pro/u.test(id) ? 1 : 0;
    const version = Number(/^gemini-(\d+(?:\.\d+)?)/u.exec(id)?.[1] ?? 0);
    ranked.push({ id, label: labelOf(id, stable), family, stable: stable ? 1 : 0, version });
  }
  ranked.sort(
    (a, b) =>
      b.family - a.family ||
      b.stable - a.stable ||
      b.version - a.version ||
      a.id.localeCompare(b.id),
  );
  const models = ranked.slice(0, MAX_MODELS).map(({ id, label }) => ({ id, label }));
  return { models, defaultModel: models[0]?.id ?? null };
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= MAX_LIST_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      parts.push(value);
    }
    return size > MAX_LIST_BYTES ? '' : new TextDecoder().decode(Buffer.concat(parts));
  } catch {
    return '';
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function idsOf(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const record =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : null;
  if (!list) return null;
  const ids: string[] = [];
  for (const item of list.slice(0, 1_000)) {
    const id =
      (item as { id?: unknown; name?: unknown } | null)?.id ??
      (item as { name?: unknown } | null)?.name;
    if (typeof id === 'string') ids.push(id);
  }
  return ids;
}

/**
 * Tries a key with one request that uses no tokens: the list of models it can use. The address is built here from a
 * constant and checked, the key goes in a header, and a redirect is an error, so the key can reach no host but Google's.
 * Whatever Google says is turned into one of a few plain statuses, and neither the key nor Google's own words are in the
 * answer.
 */
export async function connectGemini(
  key: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ByokConnectResult> {
  const url = new URL('models', GEMINI_BASE_URL);
  if (url.protocol !== 'https:' || url.host !== GEMINI_HOST) {
    throw new Error('The key check would not go to the provider’s own host.');
  }
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(options.timeoutMs ?? CONNECT_TIMEOUT_MS),
  ]);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
    });
  } catch {
    return failed('unreachable', CONNECT_WORDS.unreachable);
  }
  const text = await boundedText(response);
  if (!response.ok) {
    const { problem } = classifyGemini(response.status, text);
    const status = connectStatusOf(problem);
    return failed(
      status,
      status === 'invalid' || status === 'rate-limited' || status === 'quota' || status === 'region'
        ? wordsOf(problem as 'invalid-key' | 'rate-limited' | 'quota' | 'region')
        : CONNECT_WORDS.unreachable,
    );
  }
  const ids = idsOf(text);
  if (ids === null) return failed('unreachable', CONNECT_WORDS.unreachable);
  const { models, defaultModel } = chooseModels(ids);
  if (models.length === 0) {
    return failed(
      'unreachable',
      'Your key works, but Google listed no text model for it. Check the key’s project in AI Studio.',
    );
  }
  return { status: 'valid', message: CONNECT_WORDS.valid, models, defaultModel };
}
