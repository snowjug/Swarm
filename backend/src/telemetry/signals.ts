import {
  SpanStatusCode,
  metrics,
  trace,
  type Counter,
  type Histogram,
  type Meter,
  type ObservableGauge,
  type Span,
} from '@opentelemetry/api';
import { APP_VERSION } from '../../../shared/types.js';
import { publicFailure } from '../errors.js';
import { safeAttributes } from './attributes.js';

const SCOPE = 'swarm-lab';

/** The tracer of this application. With no SDK registered it does nothing, at no cost. */
export const tracer = () => trace.getTracer(SCOPE, APP_VERSION);

/** What a running process reports about itself when its gauges are read. */
export interface Reading {
  role: string;
  jobsByState: Readonly<Record<string, number>>;
  /** Seconds the oldest waiting job has waited; null when none waits. */
  oldestWaitingSeconds: number | null;
  databaseUp: boolean;
  workerBusy: boolean;
}

interface Instruments {
  httpDuration: Histogram;
  httpErrors: Counter;
  denials: Counter;
  auditEvents: Counter;
  jobsFinished: Counter;
  jobDuration: Histogram;
  jobEvents: Counter;
  modelCalls: Counter;
  modelLatency: Histogram;
  modelTokens: Counter;
  grounding: Counter;
  gauges: ObservableGauge[];
}

const sources = new Set<() => Reading>();

function readAll(): Reading[] {
  const readings: Reading[] = [];
  for (const source of sources) {
    try {
      readings.push(source());
    } catch {
      // A gauge that cannot be read is skipped: a metric must never be the reason a request fails.
    }
  }
  return readings;
}

function createInstruments(meter: Meter): Instruments {
  const jobsByState = meter.createObservableGauge('swarm.jobs.by_state', {
    description: 'Jobs in each state: the queue depth is queued plus retrying',
  });
  jobsByState.addCallback((result) => {
    for (const reading of readAll()) {
      for (const [state, count] of Object.entries(reading.jobsByState)) {
        result.observe(
          count,
          safeAttributes({ 'swarm.job.state': state, 'swarm.role': reading.role }),
        );
      }
    }
  });
  const oldest = meter.createObservableGauge('swarm.jobs.oldest_waiting', {
    description: 'Seconds the oldest waiting job has waited',
    unit: 's',
  });
  oldest.addCallback((result) => {
    for (const reading of readAll()) {
      if (reading.oldestWaitingSeconds !== null) {
        result.observe(
          reading.oldestWaitingSeconds,
          safeAttributes({ 'swarm.role': reading.role }),
        );
      }
    }
  });
  const database = meter.createObservableGauge('swarm.db.up', {
    description: '1 when the database answers a trivial query, 0 when it does not',
  });
  database.addCallback((result) => {
    for (const reading of readAll()) {
      result.observe(reading.databaseUp ? 1 : 0, safeAttributes({ 'swarm.role': reading.role }));
    }
  });
  const worker = meter.createObservableGauge('swarm.worker.busy', {
    description: '1 while this process is running a job',
  });
  worker.addCallback((result) => {
    for (const reading of readAll()) {
      result.observe(reading.workerBusy ? 1 : 0, safeAttributes({ 'swarm.role': reading.role }));
    }
  });
  return {
    httpDuration: meter.createHistogram('swarm.http.server.duration', {
      description: 'Time to answer a request, by route template and status class',
      unit: 'ms',
    }),
    httpErrors: meter.createCounter('swarm.http.errors', {
      description: 'Error answers, by error code and status class',
    }),
    denials: meter.createCounter('swarm.auth.denials', {
      description: 'Requests refused for who the caller is or what the caller may do',
    }),
    auditEvents: meter.createCounter('swarm.audit.events', {
      description: 'Audit entries written, by action: exports, runs, branches, membership changes',
    }),
    jobsFinished: meter.createCounter('swarm.jobs.finished', {
      description: 'Jobs that ended on this worker, by kind and outcome',
    }),
    jobDuration: meter.createHistogram('swarm.jobs.duration', {
      description: 'Time a job ran on this worker',
      unit: 'ms',
    }),
    jobEvents: meter.createCounter('swarm.jobs.events', {
      description: 'Queue events: retries, lease expiries, expiry, hand-backs, lost leases',
    }),
    modelCalls: meter.createCounter('swarm.model.calls', {
      description: 'Model provider calls, by provider, model and outcome',
    }),
    modelLatency: meter.createHistogram('swarm.model.latency', {
      description: 'Time a model call took',
      unit: 'ms',
    }),
    modelTokens: meter.createCounter('swarm.model.tokens', {
      description: 'Tokens the provider reported, by direction',
    }),
    grounding: meter.createCounter('swarm.grounding.statements', {
      description: 'Report statements by the support class the grounding review gave them',
    }),
    gauges: [jobsByState, oldest, database, worker],
  };
}

// The instruments belong to the meter provider that existed when they were made, so they are made
// again if the provider is replaced (as a test does), and not otherwise.
const cache = new WeakMap<object, Instruments>();
function instruments(): Instruments {
  const provider = metrics.getMeterProvider();
  let found = cache.get(provider);
  if (!found) {
    found = createInstruments(metrics.getMeter(SCOPE, APP_VERSION));
    cache.set(provider, found);
  }
  return found;
}

const statusClass = (status: number): string => `${Math.floor(status / 100)}xx`;

/** Error codes that mean a request was refused for who or where the caller is, or what they may do. */
export const DENIAL_CODES: ReadonlySet<string> = new Set([
  'SIGN_IN_REQUIRED',
  'CSRF_REQUIRED',
  'FORBIDDEN',
  'ROUTE_NOT_AUTHORIZED',
  'HOST_NOT_ALLOWED',
  'ORIGIN_NOT_ALLOWED',
  'UNAUTHENTICATED',
]);

export interface ModelCallSignal {
  provider: string;
  model: string;
  ok: boolean;
  repair: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  errorCode: string | null;
}

/**
 * What the application tells its monitoring. Every attribute passes through `safeAttributes`, so
 * only identifiers, codes and counts can leave the process; a prompt, a document or a credential
 * has no name on the list and cannot be added.
 */
export const signals = {
  httpRequest(input: { route: string; method: string; status: number; durationMs: number }): void {
    instruments().httpDuration.record(
      input.durationMs,
      safeAttributes({
        'swarm.http.route': input.route,
        'swarm.http.method': input.method,
        'swarm.http.status_class': statusClass(input.status),
      }),
    );
  },

  /** An error answer. A refusal of who or what the caller is also counts as a denial. */
  apiError(input: { route: string; status: number; code: string }): void {
    const attributes = safeAttributes({
      'swarm.http.route': input.route,
      'swarm.http.status_class': statusClass(input.status),
      'swarm.error.code': input.code,
    });
    instruments().httpErrors.add(1, attributes);
    if (DENIAL_CODES.has(input.code)) {
      instruments().denials.add(
        1,
        safeAttributes({ 'swarm.auth.reason': input.code, 'swarm.http.route': input.route }),
      );
    }
  },

  audit(action: string): void {
    instruments().auditEvents.add(1, safeAttributes({ 'swarm.audit.action': action }));
  },

  jobFinished(input: {
    kind: string;
    outcome: string;
    code: string | null;
    attempt: number;
    durationMs: number;
    branch: boolean;
  }): void {
    const attributes = safeAttributes({
      'swarm.job.kind': input.kind,
      'swarm.job.outcome': input.outcome,
      'swarm.project.branch': input.branch,
      ...(input.code ? { 'swarm.error.code': input.code } : {}),
    });
    instruments().jobsFinished.add(1, attributes);
    instruments().jobDuration.record(
      input.durationMs,
      safeAttributes({ 'swarm.job.kind': input.kind, 'swarm.job.outcome': input.outcome }),
    );
  },

  jobEvent(event: string, kind: string): void {
    instruments().jobEvents.add(
      1,
      safeAttributes({ 'swarm.job.event': event, 'swarm.job.kind': kind }),
    );
  },

  modelCall(input: ModelCallSignal): void {
    const outcome = input.ok ? (input.repair ? 'repaired' : 'ok') : 'failed';
    const attributes = safeAttributes({
      'swarm.model.provider': input.provider,
      'swarm.model.name': input.model,
      'swarm.model.outcome': outcome,
      ...(input.errorCode ? { 'swarm.error.code': input.errorCode } : {}),
    });
    const set = instruments();
    set.modelCalls.add(1, attributes);
    set.modelLatency.record(
      input.latencyMs,
      safeAttributes({ 'swarm.model.provider': input.provider, 'swarm.model.outcome': outcome }),
    );
    if (input.ok) {
      const base = { 'swarm.model.provider': input.provider, 'swarm.model.name': input.model };
      set.modelTokens.add(
        input.inputTokens,
        safeAttributes({ ...base, 'swarm.model.direction': 'input' }),
      );
      set.modelTokens.add(
        input.outputTokens,
        safeAttributes({ ...base, 'swarm.model.direction': 'output' }),
      );
    }
  },

  grounding(byClass: Readonly<Record<string, number>>): void {
    for (const [supportClass, count] of Object.entries(byClass)) {
      if (count > 0) {
        instruments().grounding.add(
          count,
          safeAttributes({ 'swarm.grounding.class': supportClass }),
        );
      }
    }
  },

  /** Registers what this process reports through its gauges. Returns the function that stops reporting. */
  observe(source: () => Reading): () => void {
    instruments();
    sources.add(source);
    return () => {
      sources.delete(source);
    };
  },
};

/**
 * Runs `work` in a span. The span records what happened (the error code, never the message or the
 * exception, which can hold content) and always ends.
 */
export async function inSpan<T>(
  name: string,
  attributes: Readonly<Record<string, unknown>>,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(
    name,
    { attributes: safeAttributes(attributes) },
    async (span) => {
      try {
        return await work(span);
      } catch (error) {
        span.setAttribute('swarm.error.code', publicFailure(error).code);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/** Marks a span as failed. The reason is its error code attribute, never a message. */
export function failSpan(span: Span): void {
  span.setStatus({ code: SpanStatusCode.ERROR });
}

/** Sets attributes on a span through the same allow-list. */
export function annotate(span: Span, attributes: Readonly<Record<string, unknown>>): void {
  span.setAttributes(safeAttributes(attributes));
}
