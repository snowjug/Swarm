export interface HttpResult {
  status: number;
  body: unknown;
}

/** The only way the verification touches the application: its public HTTP API. */
export interface Http {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResult>;
}

/** A check did not hold. The message is written for the operator and shown as is. */
export class CheckFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckFailure';
  }
}

/**
 * Every capability the verification claims. A check that never ran is reported as skipped and can
 * never count as passed, so the overall verdict cannot be reached by omission.
 */
export const CHECKS = [
  {
    id: 'provider-config',
    title: 'The server is set up for a real model from the expected provider',
  },
  { id: 'provider-connection', title: 'A real model round trip succeeded' },
  {
    id: 'pipeline',
    title: 'A synthetic project ran every stage: graph, proxies, simulation and report',
  },
  {
    id: 'real-calls',
    title: 'The real model calls are recorded on the project for the expected provider',
  },
  {
    id: 'per-actor',
    title: 'Every proxy decided on both platforms in every round, with a stated reason',
  },
  { id: 'graph-quotes', title: 'Every graph node quotes a cited passage verbatim' },
  { id: 'grounding', title: 'The report has a grounding review whose citations all resolve' },
  { id: 'grounding-model-check', title: 'The independent model check of the report ran' },
  {
    id: 'branching',
    title: 'A branch with a changed assumption re-ran only the later rounds and was compared',
  },
  { id: 'analyst-chat', title: 'The analyst chat answered from the report with a real model call' },
  {
    id: 'actor-chat',
    title: 'The actor chat answered as a fictional proxy with a real model call',
  },
  { id: 'telemetry', title: 'The server’s provider counters account for every recorded call' },
  { id: 'injection-probe', title: 'An instruction hidden in the source document was not obeyed' },
  { id: 'no-secrets', title: 'No credential-shaped text appears in any output' },
  { id: 'export', title: 'The export carries the grounding review and the disclaimer' },
] as const;

export type CheckId = (typeof CHECKS)[number]['id'];
export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  detail: string;
}

const SECRET_SHAPES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gu },
  {
    name: 'JSON web token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gu,
  },
  { name: 'secret key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/gu },
  { name: 'api-key header', pattern: /\bapi-key["']?\s*[:=]\s*["']?[A-Za-z0-9]{16,}/giu },
  {
    name: 'connection-string secret',
    pattern: /\b(?:AccountKey|SharedAccessKey|Password)\s*=\s*[^;\s]{8,}/giu,
  },
];

/** Names (never values) of the credential shapes present in `value`. */
export function findSecretShapes(value: unknown): string[] {
  const haystack = typeof value === 'string' ? value : JSON.stringify(value);
  return SECRET_SHAPES.filter(({ pattern }) => haystack.match(pattern) !== null).map(
    ({ name }) => name,
  );
}

export function redact(value: string): string {
  return SECRET_SHAPES.reduce((text, { pattern }) => text.replace(pattern, '[redacted]'), value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A bounded, credential-free description of an error response. */
export function describeError(result: HttpResult): string {
  const error = asRecord(asRecord(result.body).error);
  const code = typeof error.code === 'string' ? error.code : 'no error code';
  const message =
    typeof error.message === 'string' ? error.message.replace(/\s+/gu, ' ').slice(0, 240) : '';
  return `HTTP ${result.status} ${code}${message ? `: ${message}` : ''}`;
}

/** Reads a first-party JSON response as its shared type, or reports the refusal. */
export function expectJson<T>(result: HttpResult, action: string): T {
  if (result.status < 200 || result.status >= 300 || typeof result.body !== 'object') {
    throw new CheckFailure(`${action} failed: ${describeError(result)}`);
  }
  return result.body as T;
}

export interface Outcome<T> {
  detail: string;
  value: T;
}

/** Accumulates one result per check; unrun checks surface as skipped. */
export class Recorder {
  private readonly results = new Map<CheckId, CheckResult>();

  constructor(private readonly onResult?: (result: CheckResult) => void) {}

  /** Passes the check with the outcome's detail and hands back its value; a throw fails it (null). */
  async collect<T extends object>(
    id: CheckId,
    body: () => Outcome<T> | Promise<Outcome<T>>,
  ): Promise<T | null> {
    const title = CHECKS.find((check) => check.id === id)?.title ?? id;
    let result: CheckResult;
    let value: T | null = null;
    try {
      const outcome = await body();
      value = outcome.value;
      result = { id, title, status: 'pass', detail: redact(outcome.detail) };
    } catch (error) {
      const detail =
        error instanceof CheckFailure
          ? error.message
          : `Unexpected error: ${error instanceof Error ? error.message : 'unknown'}`;
      result = { id, title, status: 'fail', detail: redact(detail).slice(0, 500) };
    }
    this.results.set(id, result);
    this.onResult?.(result);
    return value;
  }

  /** Returning a string passes the check with that detail; throwing fails it. */
  async run(id: CheckId, body: () => string | Promise<string>): Promise<boolean> {
    const outcome = await this.collect(id, async () => ({ detail: await body(), value: {} }));
    return outcome !== null;
  }

  /** Marks a check as deliberately not run. It can never count as a pass. */
  skip(id: CheckId, reason: string): void {
    const title = CHECKS.find((check) => check.id === id)?.title ?? id;
    const result: CheckResult = { id, title, status: 'skipped', detail: reason };
    this.results.set(id, result);
    this.onResult?.(result);
  }

  all(): CheckResult[] {
    return CHECKS.map(
      ({ id, title }): CheckResult =>
        this.results.get(id) ?? {
          id,
          title,
          status: 'skipped',
          detail: 'Not run: an earlier check it depends on did not pass.',
        },
    );
  }
}

/** Joins the first few problems so one failing check stays readable. */
export function summarize(problems: readonly string[], shown = 4): string {
  const rest = problems.length - shown;
  return problems.slice(0, shown).join('; ') + (rest > 0 ? ` (and ${rest} more)` : '');
}
