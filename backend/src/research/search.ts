import { z } from 'zod';
import type { DiscoveryStatus } from '../../../shared/research.js';
import { RESEARCH_USER_AGENT } from './crawler/identity.js';
import { redact } from './redact.js';
import type { SearchHit, SearchProvider } from './discovery.js';

/**
 * The providers that find the addresses of pages for a question that names none. Each asks an interface that its operator
 * offers for exactly this: an API, with terms of use and, where it has one, a key. Reading the result page of a search
 * engine is never a way to discover, and nothing here does it.
 *
 * What a provider is asked is a short query made from the names and topics of the research plan, and never the question
 * as it was typed (`searchQueryOf`). What it answers is a list of addresses and nothing else: the title and the snippet of
 * a result are what a site chose to say about itself, so they are not kept, and every address is vetted by the crawler as
 * any other is before anything is fetched. A key is held in the provider, put in the one header that carries it, and in no
 * message, log line, error or answer: what goes wrong is told by its class (`SearchFailure`), never by its words.
 */

/** Why a search failed, in a word: no address, no key, no body of an answer, and no message of a library is in it. */
export type SearchFailureKind =
  | 'unreachable'
  | 'timeout'
  | 'refused'
  | 'status'
  | 'redirect'
  | 'content-type'
  | 'too-large'
  | 'malformed';

export class SearchFailure extends Error {
  constructor(readonly kind: SearchFailureKind) {
    super(`The search provider failed: ${kind}.`);
    this.name = 'SearchFailure';
  }
}

const UNREACHABLE = 'The search provider could not be reached.';
const REFUSED =
  'The search provider refused the search: its key may be wrong, or its limit for now may be used up.';
const UNUSABLE = 'The search provider did not answer in a form that can be used.';

/** What a person is told when a search failed: a sentence of ours for the class of the failure, and no word of the provider's. */
export function searchFailureSentence(error: unknown): string {
  if (!(error instanceof SearchFailure)) return UNREACHABLE;
  switch (error.kind) {
    case 'refused':
      return REFUSED;
    case 'redirect':
    case 'status':
    case 'content-type':
    case 'too-large':
    case 'malformed':
      return UNUSABLE;
    case 'unreachable':
    case 'timeout':
      return UNREACHABLE;
  }
}

export interface SearchSettings {
  /** The key of a provider that needs one. It is never logged, returned or put in an error. */
  apiKey: string | null;
  /**
   * Where the provider is reached, when it is not at its own address: for a test double on this machine. A hosted
   * deployment refuses it (`deployment.ts`), so that a key is never sent anywhere else.
   */
  endpoint: string | null;
  /** How long one search may take. */
  timeoutMs: number;
  /** For a test: what asks. */
  fetch?: typeof fetch;
}

export const DEFAULT_SEARCH_TIMEOUT_MS = 8_000;
const MAX_ANSWER_BYTES = 1_000_000;
const MAX_ADDRESS_LENGTH = 2_048;
/** The most results a provider is asked for in one search: both of the interfaces below allow at least this many. */
const MOST_RESULTS = 20;

// -- the query ---------------------------------------------------------------------------------------------------------

/** What a plan holds that a query is made from. The question as it was typed is not among it, so it cannot be sent. */
export interface PlanTerms {
  entities: readonly { name: string }[];
  topics: readonly string[];
}

const MAX_QUERY_CHARS = 180;
const MAX_QUERY_TERMS = 8;
const WORDS_IN_TERM = 6;
const MAX_TERM_CHARS = 48;
/** The longest word that is a word: a longer one is an identifier, a token, or a clause of a language written without spaces. */
const MAX_WORD_CHARS = 24;
const YEAR = /^(?:19|20)\d{2}$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu;
const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** Scripts that are written without a space between words: a run of them is a clause, and cannot be told from a name. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;

/** Words that say nothing of what a search is for: a term made of them alone is not asked. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  'the and or but for nor of to in on at by with from into than then that this these those our their its his her your my we they it is are was were be been has have had do does did who which what how why not no so as if'.split(
    ' ',
  ),
);

const tidy = (text: string): string => text.replace(CONTROL, ' ').replace(/\s+/gu, ' ').trim();

/**
 * Whether a word of a term may leave this server. A name or a topic is made of words; a reference number, a key, a
 * token, an address, a path or a whole clause is not, and is not sent: nothing of the question that a person wrote
 * as an identifier or as a secret goes to a provider. A figure is not a word either, except a year and a short code
 * such as 5G or B2B. Nor is a run of a script that is written without spaces (Chinese, Japanese, Thai and the like): the
 * planner reads English, and a clause of such a script is the question itself. It errs on the side of sending less.
 */
function sendable(word: string, avoid: ReadonlySet<string>): boolean {
  if (avoid.has(word.toLowerCase())) return false;
  if (word.length > MAX_WORD_CHARS || /[@/\\:=#%]/u.test(word) || UNSPACED.test(word)) return false;
  if (/\p{N}/u.test(word)) return YEAR.test(word) || (word.length <= 4 && /\p{L}/u.test(word));
  return true;
}

const EMAIL_ADDRESS = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const HOST_NAME = /\b(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,24}\b/gu;

/**
 * The words of the e-mail addresses and host names that a text holds, in lower case. The planner takes such an address
 * apart into words ("jane", "doe", "example", "com") that no test of a single word can tell from any other, so they are
 * found in the question and left out of what is asked: an e-mail address is a person's, and the name of a host may be of
 * a system that is not public. A site to start from is named in its own field, not in the question.
 */
export function identifierWordsOf(text: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const found of [...text.matchAll(EMAIL_ADDRESS), ...text.matchAll(HOST_NAME)])
    for (const word of found[0].split(/[^\p{L}\p{N}]+/u)) if (word) words.add(word.toLowerCase());
  return words;
}

/** Whether the redactor of what a page may say finds a secret, or the contact details of a person, in a term. */
function holdsSecret(term: string): boolean {
  return Object.values(redact(term).counts).some((count) => count > 0);
}

/**
 * What a provider is asked: the names and the topics of the plan, the names first and a name of several words in quotes,
 * and no more than a few of them. It is the question reduced to what a search needs, so that what is sent out is little,
 * and the words of a long question, which a person may have written for their own eyes, are not. A word that is not a
 * name or a topic (an identifier, a key, a figure, an address, a clause) is left out, and so is a term in which the
 * redactor finds a secret. **The question is never the fallback:** a plan with no name and no topic that can be sent
 * gives no term, and then nothing is asked.
 */
export function searchTermsOf(plan: PlanTerms, avoid: ReadonlySet<string> = new Set()): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const add = (raw: string, quoteMany: boolean): void => {
    const words: string[] = [];
    for (const word of tidy(raw).replace(/["“”]/gu, '').split(' ')) {
      const kept = word.replace(EDGES, '');
      if (!kept || !sendable(kept, avoid)) continue;
      if ([...words, kept].join(' ').length > MAX_TERM_CHARS || words.length >= WORDS_IN_TERM)
        break;
      words.push(kept);
    }
    const text = words.join(' ');
    const key = text.toLowerCase();
    const says = words.some((word) => word.length >= 3 && !FUNCTION_WORDS.has(word.toLowerCase()));
    if (!says || seen.has(key) || holdsSecret(text)) return;
    seen.add(key);
    terms.push(quoteMany && words.length > 1 ? `"${text}"` : text);
  };
  for (const entity of plan.entities) add(entity.name, true);
  for (const topic of plan.topics) add(topic, false);
  const kept: string[] = [];
  let length = 0;
  for (const term of terms.slice(0, MAX_QUERY_TERMS)) {
    length += term.length + (kept.length > 0 ? 1 : 0);
    if (length > MAX_QUERY_CHARS) break;
    kept.push(term);
  }
  return kept;
}

/** The terms of the plan as one query, or nothing when there is no term to ask for. */
export const searchQueryOf = (plan: PlanTerms, avoid?: ReadonlySet<string>): string =>
  searchTermsOf(plan, avoid).join(' ');

// -- what a provider answers ---------------------------------------------------------------------------------------------

/** An address that a research run may be started from: https, with no user name, no password and a sensible length. */
function usableAddress(candidate: string): string | null {
  if (candidate.length > MAX_ADDRESS_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  url.hash = '';
  return url.toString();
}

function addressesOf(candidates: readonly string[], limit: number): SearchHit[] {
  const kept = new Set<string>();
  for (const candidate of candidates) {
    const address = usableAddress(candidate);
    if (address) kept.add(address);
    if (kept.size >= limit) break;
  }
  return [...kept].map((url) => ({ url }));
}

/** Reads a body up to a limit, and no further: a provider that sends more is a provider that fails. */
async function readCapped(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new SearchFailure('malformed');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new SearchFailure('too-large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getJson(
  address: URL,
  headers: Record<string, string>,
  settings: Pick<SearchSettings, 'timeoutMs' | 'fetch'>,
  signal: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(settings.timeoutMs);
  let response: Response;
  try {
    response = await (settings.fetch ?? fetch)(address, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': RESEARCH_USER_AGENT, ...headers },
      // A provider that sends a visitor somewhere else is not read: the key would go with it.
      redirect: 'manual',
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new SearchFailure(timeout.aborted ? 'timeout' : 'unreachable');
  }
  try {
    if (response.status >= 300 && response.status < 400) throw new SearchFailure('redirect');
    if (response.status === 401 || response.status === 403 || response.status === 429)
      throw new SearchFailure('refused');
    if (!response.ok) throw new SearchFailure('status');
    if (!/\bjson\b/iu.test(response.headers.get('content-type') ?? ''))
      throw new SearchFailure('content-type');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_ANSWER_BYTES) throw new SearchFailure('too-large');
    const body = await readCapped(response, MAX_ANSWER_BYTES);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new SearchFailure('malformed');
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof SearchFailure) throw error;
    throw new SearchFailure(timeout.aborted ? 'timeout' : 'unreachable');
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

const baseOf = (endpoint: string | null, own: string): URL => {
  const base = new URL(endpoint ?? own);
  if (base.protocol !== 'https:' && base.hostname !== '127.0.0.1' && base.hostname !== 'localhost')
    throw new SearchFailure('refused');
  return base;
};

// -- Wikipedia ---------------------------------------------------------------------------------------------------------

const WIKIPEDIA = 'https://en.wikipedia.org';

// A page that a provider names with more than a title can be is left out and the rest are kept: one odd entry must
// not make the whole answer unusable (`usableAddress` does the same for an address that is too long).
const MOST_TITLE_LENGTH = 300;

const wikipediaAnswer = z.object({
  query: z
    .object({
      search: z.array(z.object({ title: z.string().min(1) })).optional(),
    })
    .optional(),
});

/**
 * The search of Wikipedia, which needs no key: the public search of the MediaWiki Action API, asked as its etiquette asks
 * (an identifying user agent, one request at a time, no more than a search a run). It offers the pages of an encyclopedia
 * that are about the names and topics of a question: background, with the references that each page cites, and not the
 * primary sources, which a person adds or names a site for. It is English only.
 */
export function wikipediaSearch(settings: SearchSettings): SearchProvider {
  return {
    status: (): DiscoveryStatus => ({
      available: true,
      provider: 'wikipedia',
      message:
        'Sources are looked for in the search of Wikipedia, which is sent the names and topics of your question. It finds background, not primary sources.',
    }),
    async search(query, { limit, signal }): Promise<SearchHit[]> {
      const base = baseOf(settings.endpoint, WIKIPEDIA);
      const address = new URL('/w/api.php', base);
      address.search = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: String(Math.min(Math.max(1, limit), MOST_RESULTS)),
        srnamespace: '0',
        srprop: '',
        format: 'json',
        formatversion: '2',
      }).toString();
      const answer = wikipediaAnswer.safeParse(await getJson(address, {}, settings, signal));
      if (!answer.success) throw new SearchFailure('malformed');
      const pages = (answer.data.query?.search ?? [])
        .filter(({ title }) => title.length <= MOST_TITLE_LENGTH)
        .map(({ title }) =>
          new URL(`/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`, base).toString(),
        );
      return addressesOf(pages, limit);
    },
  };
}

// -- Brave Search ------------------------------------------------------------------------------------------------------

const BRAVE = 'https://api.search.brave.com';

const braveAnswer = z.object({
  web: z
    .object({
      // An address too long to use is left out by `usableAddress`; it does not fail the answer.
      results: z.array(z.object({ url: z.string() })).optional(),
    })
    .optional(),
});

/**
 * The web search of Brave Search, a documented API with a key (the `X-Subscription-Token` header) and terms of use that
 * the operator who chooses it accepts. It is sent the names and topics of the question and answers with pages from the open
 * web, which the crawler then reads as it reads any address.
 */
export function braveSearch(settings: SearchSettings): SearchProvider {
  const key = settings.apiKey;
  return {
    status: (): DiscoveryStatus =>
      key
        ? {
            available: true,
            provider: 'brave',
            message:
              'Sources are looked for with Brave Search, which is sent the names and topics of your question.',
          }
        : {
            available: false,
            provider: 'brave',
            message:
              'RESEARCH_SEARCH_PROVIDER is brave, but no key is set (RESEARCH_SEARCH_API_KEY), so this server cannot look for sources from a question alone. Name a page or a site, or add sources of your own.',
          },
    async search(query, { limit, signal }): Promise<SearchHit[]> {
      if (!key) throw new SearchFailure('refused');
      const address = new URL('/res/v1/web/search', baseOf(settings.endpoint, BRAVE));
      address.search = new URLSearchParams({
        q: query,
        count: String(Math.min(Math.max(1, limit), MOST_RESULTS)),
        safesearch: 'moderate',
        result_filter: 'web',
        text_decorations: 'false',
      }).toString();
      const answer = braveAnswer.safeParse(
        await getJson(address, { 'x-subscription-token': key }, settings, signal),
      );
      if (!answer.success) throw new SearchFailure('malformed');
      return addressesOf(
        (answer.data.web?.results ?? []).map((result) => result.url),
        limit,
      );
    },
  };
}
