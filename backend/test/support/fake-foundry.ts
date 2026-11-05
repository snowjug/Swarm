/**
 * An in-process fake of the Azure OpenAI v1 chat-completions endpoint of a Microsoft Foundry resource,
 * for tests of everything that talks to a model. Nothing here reaches the network: it listens on a
 * loopback port and is the only "Azure" any test may use.
 *
 *   const fake = await startFakeFoundry({ deployments: { fast: {}, deep: { temperature: false } } });
 *   const config = testConfig(fake.environment());          // AI_PROVIDER=foundry, pointed at the fake
 *   fake.script({ kind: 'reply', value: { answer: 'ok' } }); // the next answer; scripts are consumed in order
 *   ...
 *   expect(fake.requests[0]?.body?.response_format).toMatchObject({ type: 'json_schema' });
 *   await fake.close();
 *
 * What it checks, as the real service does: the credential (a bearer token that equals `token`, or an
 * `api-key` that equals `apiKey`, else 401), the route (`POST /openai/v1/chat/completions`), the
 * deployment in `model` (404 for one that is not in `deployments`, when that is given), what a
 * deployment takes (`jsonSchema`, `temperature`, `reasoningEffort`, `minimalEffort`, `maxContextChars`),
 * what it spends thinking (`thinks`, counted against `max_completion_tokens` as hidden reasoning
 * tokens are, so that a reply that does not fit ends with `finish_reason: length`), and, for
 * `response_format: json_schema`, that the schema obeys the documented strict-mode rules
 * (`strictSchemaProblems`: closed objects, every property required, no lengths or ranges, `anyOf` only).
 * A reply it is scripted to give under a strict schema must also conform to that schema, as a real
 * constrained model's would: a key the script leaves out is written as null where the schema allows
 * it (what a constrained model does for an optional property), and anything else that does not
 * conform makes the answer a 501 and is listed in `problems`.
 *
 * Every request is kept in `requests` with its parsed body, so a test can prove what was sent, and
 * where: which deployment, which parameters, and that no secret or untrusted text went anywhere else.
 *
 * Steps (`script`, `scriptFor`, `respond`) say how the next requests are answered:
 *   reply          a JSON value as the message content (a function of the request is allowed)
 *   text           exactly this content: invalid JSON, a fenced block, prose
 *   refusal        a 200 with `message.refusal`
 *   filter-prompt  a 400 `content_filter` error naming the categories that were filtered
 *   filter-output  a 200 with `finish_reason: content_filter` and filtered output categories
 *                  (`partial` is the content that came with it; `null` leaves `content` out)
 *   detected       a 200 reply whose prompt annotation says jailbreak / indirect_attack was detected
 *   truncated      a 200 with `finish_reason: length` and partial content
 *   status         an error status (429 with Retry-After, 5xx, ...) with a provider-shaped body
 *   slow           the inner step, after a delay that ends if the client goes away
 *   hang           no answer until the client goes away (for timeouts)
 *
 * The shapes of the errors and annotations are written from the public documentation of the Azure
 * OpenAI v1 API; none of it has been checked against a live resource.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TokenProvider } from '../../src/models/entra.js';

export const FAKE_FOUNDRY_TOKEN = 'fake-foundry-token-canary-7f3a91';
export const FAKE_FOUNDRY_KEY = 'fake-foundry-key-canary-52c0de';

export interface FakeDeployment {
  /** Takes `response_format: json_schema`. Default true. */
  jsonSchema?: boolean;
  /** Takes `temperature`. Default true; a reasoning deployment takes only its default. */
  temperature?: boolean;
  /**
   * Takes `reasoning_effort`. Default true, as the reasoning deployment this product runs on does.
   * `false` refuses it by name (400 `unsupported_parameter`). `'unrecognized'` refuses it as Azure
   * refuses an argument a model does not know: a 400 that names neither a parameter nor a code.
   */
  reasoningEffort?: boolean | 'unrecognized';
  /** Takes the effort `minimal`. Default true; false is a 400 `unsupported_value` naming the parameter, as the o-series says. */
  minimalEffort?: boolean;
  /**
   * What the deployment spends thinking before it writes, in tokens, by the effort the request asks for
   * (`default` when it sends none). Hidden reasoning tokens are counted against `max_completion_tokens`:
   * a reply that does not fit ends with `finish_reason: length`, with no content at all when the thinking
   * alone does not fit. Absent: the deployment does not think.
   */
  thinks?: Partial<Record<'default' | 'minimal' | 'low' | 'medium' | 'high', number>>;
  /** The most characters of messages it takes; a longer request is a 400 `context_length_exceeded`. */
  maxContextChars?: number;
}

export interface Usage {
  prompt: number;
  completion: number;
  /** Of `completion`, the hidden thinking tokens: reported as `completion_tokens_details.reasoning_tokens`. */
  reasoning?: number;
}

export type FakeStep =
  | { kind: 'reply'; value: unknown; usage?: Usage | null }
  | { kind: 'text'; text: string; usage?: Usage | null }
  | { kind: 'refusal'; text?: string }
  | { kind: 'filter-prompt'; categories?: string[] }
  | { kind: 'filter-output'; categories?: string[]; partial?: string | null }
  | { kind: 'detected'; category: 'jailbreak' | 'indirect_attack'; value: unknown }
  | { kind: 'truncated'; partial?: string; usage?: Usage }
  | { kind: 'status'; status: number; retryAfterSeconds?: number; code?: string; param?: string }
  | { kind: 'slow'; ms: number; then: FakeStep }
  | { kind: 'hang' };

export interface ChatBody {
  model?: unknown;
  messages?: Array<{ role: string; content: string }>;
  response_format?: {
    type?: string;
    json_schema?: { name?: string; strict?: boolean; schema?: unknown };
  };
  max_completion_tokens?: number;
  max_tokens?: number;
  temperature?: number;
  reasoning_effort?: string;
  [key: string]: unknown;
}

export interface RecordedRequest {
  index: number;
  method: string;
  path: string;
  /** The `model` of the body: the deployment that was asked for. */
  deployment: string | null;
  /** How the request signed itself in. The credential itself is in `headers`. */
  credential: 'bearer' | 'api-key' | 'none';
  /** Lower-cased header names. A test may assert that a fake credential is, or is not, in here. */
  headers: Record<string, string>;
  body: ChatBody | null;
  rawBody: string;
  system: string;
  /** The `untrustedScenarioData` of the user message, when there is one. */
  data: unknown;
  /** What was answered: an HTTP status, and the kind of step that produced it. */
  status: number;
  step: string;
}

export interface FakeFoundryOptions {
  token?: string;
  apiKey?: string;
  /** Naming deployments makes every other name a 404 `DeploymentNotFound`. Default: any name will do. */
  deployments?: Record<string, FakeDeployment>;
  /** The answer when nothing is scripted. Default: `{"status":"ok"}`. */
  fallbackReply?: (request: RecordedRequest) => unknown;
  /** Add the clean content-filter annotations Azure puts on replies. Default true. */
  annotations?: boolean;
}

export interface FakeFoundry {
  /** `http://127.0.0.1:<port>`: the FOUNDRY_ENDPOINT that the loopback test seam accepts. */
  readonly url: string;
  readonly token: string;
  readonly apiKey: string;
  /** A token provider that returns the accepted token, for the Microsoft Entra path. */
  readonly tokens: TokenProvider;
  readonly requests: readonly RecordedRequest[];
  /** What the fake itself found wrong: a strict schema that broke the rules, a scripted reply that does not conform. */
  readonly problems: readonly string[];
  /** The most requests that were being answered at the same moment. */
  readonly maxInFlight: number;
  script(...steps: FakeStep[]): void;
  scriptFor(deployment: string, ...steps: FakeStep[]): void;
  /** Answers every request nothing is scripted for; return undefined to let the default answer. */
  respond(handler: ((request: RecordedRequest) => FakeStep | undefined) | null): void;
  /**
   * The environment of a server that uses this fake: AI_PROVIDER=foundry with the test seam. Key
   * authentication by default (nothing else to inject); `auth: 'entra'` leaves the credential to
   * the caller, who passes `tokens` to the model factory.
   */
  environment(overrides?: Record<string, string>, auth?: 'key' | 'entra'): Record<string, string>;
  /** Forgets requests, scripts and problems. */
  reset(): void;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// The strict-mode rules, written out independently of the code that produces schemas
// ---------------------------------------------------------------------------------------------

const UNSUPPORTED_KEYWORDS = [
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'minContains',
  'maxContains',
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'default',
  '$schema',
  'prefixItems',
  'additionalItems',
];
const PRIMITIVES = new Set(['string', 'number', 'integer', 'boolean', 'null']);

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a strict structured-output schema may not do, as the documentation of Azure OpenAI lists it. */
export function strictSchemaProblems(schema: unknown): string[] {
  const problems: string[] = [];
  if (!isNode(schema)) return ['the schema is not an object'];
  if (schema.type !== 'object') problems.push('the root must be an object');
  const definitions = isNode(schema.$defs) ? schema.$defs : {};
  let properties = 0;
  const visit = (node: unknown, path: string, depth: number): void => {
    if (!isNode(node)) {
      problems.push(`${path}: not a schema`);
      return;
    }
    if (depth > 10) problems.push(`${path}: nested more than 10 levels`);
    for (const keyword of UNSUPPORTED_KEYWORDS) {
      if (keyword in node && !(path === '#' && keyword === '$defs'))
        problems.push(`${path}: unsupported keyword ${keyword}`);
    }
    if (typeof node.$ref === 'string') {
      const name = node.$ref.replace('#/$defs/', '');
      if (!node.$ref.startsWith('#/$defs/') || !(name in definitions))
        problems.push(`${path}: unresolved reference`);
      return;
    }
    if (Array.isArray(node.anyOf)) {
      if (node.anyOf.length === 0) problems.push(`${path}: empty anyOf`);
      node.anyOf.forEach((variant, index) => visit(variant, `${path}.anyOf[${index}]`, depth + 1));
      return;
    }
    const kinds = Array.isArray(node.type) ? node.type : [node.type];
    if (node.type === undefined || kinds.some((kind) => typeof kind !== 'string')) {
      problems.push(`${path}: no type`);
      return;
    }
    if (Array.isArray(node.type) && !node.type.every((kind) => PRIMITIVES.has(String(kind)))) {
      problems.push(`${path}: a type list may hold only primitive types`);
    }
    if (node.type === 'object') {
      if (node.additionalProperties !== false)
        problems.push(`${path}: additionalProperties must be false`);
      const declared = isNode(node.properties) ? node.properties : null;
      if (!declared) {
        problems.push(`${path}: an object needs properties`);
        return;
      }
      const required = Array.isArray(node.required) ? node.required : [];
      for (const key of Object.keys(declared)) {
        properties += 1;
        if (!required.includes(key))
          problems.push(`${path}.${key}: every property must be required`);
        visit(declared[key], `${path}.${key}`, depth + 1);
      }
      for (const key of required) {
        if (!(String(key) in declared)) problems.push(`${path}: required names a missing ${key}`);
      }
    }
    if (node.type === 'array') {
      if (!isNode(node.items)) problems.push(`${path}: items must be a schema`);
      else visit(node.items, `${path}[]`, depth + 1);
    }
    if (Array.isArray(node.enum) && node.enum.length === 0) problems.push(`${path}: empty enum`);
  };
  visit(schema, '#', 0);
  for (const [name, definition] of Object.entries(definitions))
    visit(definition, `#/$defs/${name}`, 1);
  if (properties > 5_000) problems.push('more than 5,000 properties');
  return problems;
}

/**
 * What a constrained model does with an optional property it has nothing for: it writes null. A test
 * scripts a natural reply, and this completes it the way the real thing would, where the schema allows.
 */
function fillNulls(schema: unknown, value: unknown, root: Node, depth = 0): unknown {
  if (!isNode(schema) || depth > 12) return value;
  if (typeof schema.$ref === 'string') {
    const target = (isNode(root.$defs) ? root.$defs : {})[schema.$ref.replace('#/$defs/', '')];
    return fillNulls(target, value, root, depth + 1);
  }
  if (Array.isArray(schema.anyOf)) {
    for (const variant of schema.anyOf) {
      const filled = fillNulls(variant, value, root, depth + 1);
      if (mismatch(variant, filled, root) === null) return filled;
    }
    return value;
  }
  if (Array.isArray(value) && isNode(schema.items)) {
    return value.map((item) => fillNulls(schema.items, item, root, depth + 1));
  }
  if (isNode(value) && isNode(schema.properties)) {
    const out: Node = { ...value };
    for (const [key, property] of Object.entries(schema.properties)) {
      if (key in out) out[key] = fillNulls(property, out[key], root, depth + 1);
      else if (mismatch(property, null, root) === null) out[key] = null;
    }
    return out;
  }
  return value;
}

/** Whether a value conforms to a strict schema, for the replies a test scripts. Returns the first mismatch. */
function mismatch(schema: unknown, value: unknown, root: Node, path = '#'): string | null {
  if (!isNode(schema)) return `${path}: not a schema`;
  if (typeof schema.$ref === 'string') {
    const target = (isNode(root.$defs) ? root.$defs : {})[schema.$ref.replace('#/$defs/', '')];
    return mismatch(target, value, root, path);
  }
  if (Array.isArray(schema.anyOf)) {
    const failures = schema.anyOf.map((variant) => mismatch(variant, value, root, path));
    return failures.some((failure) => failure === null)
      ? null
      : (failures[0] ?? `${path}: no variant`);
  }
  const kinds = (Array.isArray(schema.type) ? schema.type : [schema.type]).map(String);
  const actual =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : Number.isInteger(value)
          ? 'integer'
          : typeof value;
  const fits = kinds.some((kind) => kind === actual || (kind === 'number' && actual === 'integer'));
  if (!fits) return `${path}: expected ${kinds.join('|')}, got ${actual}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path}: not in the enum`;
  if (actual === 'array') {
    for (const [index, item] of (value as unknown[]).entries()) {
      const failure = mismatch(schema.items, item, root, `${path}[${index}]`);
      if (failure) return failure;
    }
  }
  if (actual === 'object') {
    const declared = isNode(schema.properties) ? schema.properties : {};
    const given = value as Record<string, unknown>;
    for (const key of Object.keys(declared)) {
      if (!(key in given)) return `${path}.${key}: missing (strict mode requires every key)`;
      const failure = mismatch(declared[key], given[key], root, `${path}.${key}`);
      if (failure) return failure;
    }
    for (const key of Object.keys(given)) {
      if (!(key in declared)) return `${path}.${key}: not allowed (additionalProperties is false)`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------------

const CATEGORIES = ['hate', 'self_harm', 'sexual', 'violence'] as const;

function clean(): Record<string, unknown> {
  return {
    ...Object.fromEntries(CATEGORIES.map((name) => [name, { filtered: false, severity: 'safe' }])),
    jailbreak: { filtered: false, detected: false },
    indirect_attack: { filtered: false, detected: false },
  };
}

const wait = (ms: number, response: ServerResponse): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    response.once('close', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    request.on('data', (chunk: Buffer) => parts.push(chunk));
    request.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    request.on('error', reject);
  });
}

const tokensOf = (chars: number): number => Math.ceil(chars / 4);

export async function startFakeFoundry(options: FakeFoundryOptions = {}): Promise<FakeFoundry> {
  const token = options.token ?? FAKE_FOUNDRY_TOKEN;
  const apiKey = options.apiKey ?? FAKE_FOUNDRY_KEY;
  const annotations = options.annotations ?? true;
  const queues = new Map<string, FakeStep[]>();
  let handler: ((request: RecordedRequest) => FakeStep | undefined) | null = null;
  const requests: RecordedRequest[] = [];
  const problems: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const next = (deployment: string | null, request: RecordedRequest): FakeStep | undefined =>
    (deployment ? queues.get(deployment)?.shift() : undefined) ??
    queues.get('*')?.shift() ??
    handler?.(request);

  /** The tokens a deployment that thinks spends on it for this request, or null when it does not think. */
  function thinking(request: RecordedRequest): number | null {
    const table = options.deployments?.[request.deployment ?? '']?.thinks;
    if (!table) return null;
    const asked = request.body?.reasoning_effort;
    const key =
      typeof asked === 'string' && asked in table ? (asked as keyof typeof table) : 'default';
    return table[key] ?? table.default ?? 0;
  }

  const promptTokens = (request: RecordedRequest): number =>
    tokensOf(
      (request.body?.messages ?? []).reduce(
        (total, message) => total + String(message.content).length,
        0,
      ),
    );

  function send(response: ServerResponse, status: number, body: unknown, headers = {}): void {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  }

  const failure = (code: string, message: string, param: string | null = null) => ({
    error: { message, type: 'invalid_request_error', param, code },
  });

  function completion(
    content: string | null | undefined,
    extra: {
      finish?: string;
      refusal?: string;
      usage?: Usage | null;
      prompt?: Record<string, unknown>;
      output?: Record<string, unknown>;
    },
    request: RecordedRequest,
  ) {
    const promptChars = (request.body?.messages ?? []).reduce(
      (total, message) => total + String(message.content).length,
      0,
    );
    const usage =
      extra.usage === null
        ? undefined
        : {
            prompt_tokens: extra.usage?.prompt ?? tokensOf(promptChars),
            completion_tokens: extra.usage?.completion ?? tokensOf((content ?? '').length),
            ...(extra.usage?.reasoning === undefined
              ? {}
              : { completion_tokens_details: { reasoning_tokens: extra.usage.reasoning } }),
          };
    return {
      id: `chatcmpl-fake-${request.index}`,
      object: 'chat.completion',
      model: request.deployment,
      ...(annotations
        ? {
            prompt_filter_results: [
              { prompt_index: 0, content_filter_results: extra.prompt ?? clean() },
            ],
          }
        : {}),
      choices: [
        {
          index: 0,
          finish_reason: extra.finish ?? 'stop',
          message: {
            role: 'assistant',
            ...(content === undefined ? {} : { content }),
            ...(extra.refusal !== undefined ? { refusal: extra.refusal } : {}),
          },
          ...(annotations ? { content_filter_results: extra.output ?? clean() } : {}),
        },
      ],
      ...(usage ? { usage } : {}),
    };
  }

  async function answer(
    step: FakeStep,
    request: RecordedRequest,
    response: ServerResponse,
  ): Promise<void> {
    request.step = step.kind;
    const schema = request.body?.response_format?.json_schema?.schema;
    const strict = request.body?.response_format?.type === 'json_schema';
    const render = (given: unknown): string | null => {
      const scripted =
        typeof given === 'function' ? (given as (r: RecordedRequest) => unknown)(request) : given;
      const root = isNode(schema) ? schema : {};
      // A constrained model writes every key; for an optional property it writes null.
      const value = strict ? fillNulls(schema, scripted, root) : scripted;
      if (strict) {
        const found = mismatch(schema, value, root);
        if (found) {
          problems.push(`scripted reply does not conform to the strict schema: ${found}`);
          return null;
        }
      }
      return JSON.stringify(value);
    };
    const respond = (status: number, body: unknown, headers = {}): void => {
      request.status = status;
      send(response, status, body, headers);
    };
    // Nothing here is a status a client retries, so that a mistake in a test's script shows at once.
    const nonconforming = failure(
      'fake_nonconforming_reply',
      'The scripted reply does not conform to the strict schema; see the problems of the fake.',
    );
    // What a deployment that thinks makes of a reply: the thinking comes first and counts against the
    // limit, so the reply is cut off where the limit is, and is empty when the thinking alone passes it.
    const fitted = (content: string, given: Usage | null | undefined) => {
      const spent = thinking(request);
      if (spent === null) return completion(content, { usage: given }, request);
      const limit = request.body?.max_completion_tokens ?? Number.POSITIVE_INFINITY;
      const prompt = given?.prompt ?? promptTokens(request);
      const visible = given?.completion ?? tokensOf(content.length);
      if (spent + visible > limit) {
        return completion(
          content.slice(0, Math.max(0, limit - spent) * 4),
          {
            finish: 'length',
            usage: { prompt, completion: limit, reasoning: Math.min(spent, limit) },
          },
          request,
        );
      }
      return completion(
        content,
        { usage: { prompt, completion: spent + visible, reasoning: spent } },
        request,
      );
    };
    switch (step.kind) {
      case 'reply': {
        const content = render(step.value);
        if (content === null) return respond(501, nonconforming);
        return respond(200, fitted(content, step.usage));
      }
      case 'text':
        return respond(200, fitted(step.text, step.usage));
      case 'refusal':
        return respond(
          200,
          completion(null, { refusal: step.text ?? 'I cannot help with that.' }, request),
        );
      case 'filter-prompt': {
        const categories = step.categories ?? ['jailbreak'];
        return respond(400, {
          error: {
            message: 'PROVIDER_FREE_TEXT the prompt triggered the content management policy.',
            type: null,
            param: 'prompt',
            code: 'content_filter',
            status: 400,
            innererror: {
              code: 'ResponsibleAIPolicyViolation',
              content_filter_result: Object.fromEntries(
                categories.map((name) => [name, { filtered: true, detected: true }]),
              ),
            },
          },
        });
      }
      case 'filter-output': {
        const output = Object.fromEntries(
          (step.categories ?? ['violence']).map((name) => [
            name,
            { filtered: true, severity: 'high' },
          ]),
        );
        return respond(
          200,
          completion(
            // `partial: null` leaves `content` out of the message, as a blocked reply may.
            step.partial === null ? undefined : (step.partial ?? null),
            { finish: 'content_filter', output },
            request,
          ),
        );
      }
      case 'detected': {
        const content = render(step.value);
        if (content === null) return respond(501, nonconforming);
        const prompt = { ...clean(), [step.category]: { filtered: false, detected: true } };
        return respond(200, completion(content, { prompt }, request));
      }
      case 'truncated':
        return respond(
          200,
          completion(
            step.partial ?? '{"answer":"cut off',
            { finish: 'length', usage: step.usage },
            request,
          ),
        );
      case 'status':
        return respond(
          step.status,
          failure(
            step.code ?? String(step.status),
            'PROVIDER_FREE_TEXT a message that must never be shown.',
            step.param ?? null,
          ),
          step.retryAfterSeconds === undefined
            ? {}
            : { 'retry-after': String(step.retryAfterSeconds) },
        );
      case 'slow':
        if (await wait(step.ms, response)) return answer(step.then, request, response);
        request.status = 499;
        return;
      case 'hang':
        request.status = 499;
        await wait(60_000, response);
        return;
    }
  }

  async function handle(raw: IncomingMessage, response: ServerResponse): Promise<void> {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await serve(raw, response);
    } finally {
      inFlight -= 1;
    }
  }

  async function serve(raw: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawBody = await readBody(raw);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw.headers)) {
      headers[name] = Array.isArray(value) ? value.join(', ') : (value ?? '');
    }
    let body: ChatBody | null = null;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      body = isNode(parsed) ? (parsed as ChatBody) : null;
    } catch {
      body = null;
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const userText = messages.find((message) => message.role === 'user')?.content ?? '';
    let data: unknown = null;
    try {
      data = (JSON.parse(userText) as { untrustedScenarioData?: unknown }).untrustedScenarioData;
    } catch {
      data = null;
    }
    const bearer = /^Bearer ([A-Za-z0-9._~+/=-]+)$/u.exec(headers.authorization ?? '')?.[1];
    const record: RecordedRequest = {
      index: requests.length,
      method: raw.method ?? '',
      path: (raw.url ?? '').split('?')[0] ?? '',
      deployment: typeof body?.model === 'string' ? body.model : null,
      credential: /^Bearer /u.test(headers.authorization ?? '')
        ? 'bearer'
        : headers['api-key']
          ? 'api-key'
          : 'none',
      headers,
      body,
      rawBody,
      system: messages.find((message) => message.role === 'system')?.content ?? '',
      data,
      status: 0,
      step: 'refused',
    };
    requests.push(record);
    const reject = (status: number, payload: unknown): void => {
      record.status = status;
      send(response, status, payload);
    };
    if (record.path !== '/openai/v1/chat/completions')
      return reject(404, failure('NotFound', 'Resource not found.'));
    if (record.method !== 'POST') return reject(405, failure('MethodNotAllowed', 'Use POST.'));
    const signedIn = (bearer !== undefined && bearer === token) || headers['api-key'] === apiKey;
    if (!signedIn) {
      return reject(401, {
        error: { code: '401', message: 'Access denied due to an invalid credential.' },
      });
    }
    if (!body || typeof body.model !== 'string' || messages.length === 0)
      return reject(400, failure('invalid_request_error', 'The request body is not valid.'));
    const deployment = options.deployments?.[body.model];
    if (options.deployments && !deployment) {
      return reject(404, failure('DeploymentNotFound', 'The API deployment does not exist.'));
    }
    const capabilities = deployment ?? {};
    const format = body.response_format;
    if (format?.type === 'json_schema') {
      if (capabilities.jsonSchema === false) {
        return reject(
          400,
          failure(
            'unsupported_parameter',
            'response_format json_schema is not supported.',
            'response_format',
          ),
        );
      }
      const name = format.json_schema?.name;
      const found = [
        ...(typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(name)
          ? []
          : ['the schema name is not valid']),
        ...(typeof format.json_schema?.strict === 'boolean' ? [] : ['strict must be a boolean']),
        ...strictSchemaProblems(format.json_schema?.schema),
      ];
      if (found.length > 0) {
        problems.push(...found.map((problem) => `request ${record.index}: ${problem}`));
        return reject(
          400,
          failure('invalid_json_schema', `Invalid schema: ${found[0]}`, 'response_format'),
        );
      }
    } else if (format?.type === 'json_object') {
      if (!messages.some((message) => /json/iu.test(String(message.content)))) {
        return reject(
          400,
          failure('invalid_request_error', 'The messages must mention JSON.', 'messages'),
        );
      }
    } else if (format !== undefined && format.type !== 'text') {
      return reject(400, failure('invalid_value', 'Unknown response_format.', 'response_format'));
    }
    if (body.temperature !== undefined && capabilities.temperature === false) {
      return reject(
        400,
        failure('unsupported_value', 'temperature does not support this value.', 'temperature'),
      );
    }
    if (body.reasoning_effort !== undefined) {
      if (capabilities.reasoningEffort === false) {
        return reject(
          400,
          failure(
            'unsupported_parameter',
            'reasoning_effort is not supported.',
            'reasoning_effort',
          ),
        );
      }
      if (capabilities.reasoningEffort === 'unrecognized') {
        // How Azure refuses an argument a model does not know: it says nothing a client can act on.
        return reject(400, {
          error: {
            message: 'Unrecognized request argument supplied: reasoning_effort',
            type: 'invalid_request_error',
            param: null,
            code: null,
          },
        });
      }
      if (body.reasoning_effort === 'minimal' && capabilities.minimalEffort === false) {
        return reject(
          400,
          failure(
            'unsupported_value',
            'reasoning_effort does not support this value.',
            'reasoning_effort',
          ),
        );
      }
    }
    const chars = messages.reduce((total, message) => total + String(message.content).length, 0);
    if (capabilities.maxContextChars !== undefined && chars > capabilities.maxContextChars) {
      return reject(400, failure('context_length_exceeded', 'The context is too long.'));
    }
    const step =
      next(record.deployment, record) ??
      ({ kind: 'reply', value: options.fallbackReply?.(record) ?? { status: 'ok' } } as FakeStep);
    await answer(step, record, response);
  }

  const server: Server = createServer((raw, response) => {
    handle(raw, response).catch((error: unknown) => {
      problems.push(
        `the fake itself failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (!response.headersSent) send(response, 500, failure('fake_failed', 'The fake failed.'));
      else response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    token,
    apiKey,
    tokens: { getToken: async () => token },
    requests,
    problems,
    get maxInFlight() {
      return maxInFlight;
    },
    script: (...steps) => {
      queues.set('*', [...(queues.get('*') ?? []), ...steps]);
    },
    scriptFor: (deployment, ...steps) => {
      queues.set(deployment, [...(queues.get(deployment) ?? []), ...steps]);
    },
    respond: (replacement) => {
      handler = replacement;
    },
    environment: (overrides = {}, auth = 'key') => ({
      AI_PROVIDER: 'foundry',
      AI_MODEL: Object.keys(options.deployments ?? {})[0] ?? 'fake-default',
      FOUNDRY_ENDPOINT: url,
      FOUNDRY_TEST_ALLOW_LOOPBACK: '1',
      ...(auth === 'key' ? { FOUNDRY_AUTH: 'key', FOUNDRY_API_KEY: apiKey } : {}),
      ...overrides,
    }),
    reset: () => {
      queues.clear();
      handler = null;
      requests.length = 0;
      problems.length = 0;
      maxInFlight = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
