import type { ProviderConfig } from '../config.js';
import { signals } from '../telemetry/signals.js';
import { checkSentence } from '../../../shared/provider-check.js';
import type { ProviderCheck, ProviderConnectivity, ProviderStatus } from '../../../shared/types.js';
import { estimateCostUsd, type PriceTable } from './cost.js';
import type { ReasoningEffort } from './call.js';
import type { SafetyFinding } from './safety.js';
import type { ModelRole } from './task.js';

/** What a provider said ended a reply, reduced to a closed set so that nothing it wrote is ever stored. */
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'other';

export interface ModelCallEvent {
  ok: boolean;
  repair: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  tokensReported: boolean;
  errorCode: string | null;
  /** What the client knows about the call when it is made for a routed task; absent for a plain call. */
  deployment?: string | null;
  role?: ModelRole | null;
  structured?: 'json_schema' | 'json_object' | null;
  safety?: readonly SafetyFinding[];
  /** Why the provider ended its reply. Null when the call ended before there was one. */
  finishReason?: FinishReason | null;
  /** Hidden thinking tokens the provider says it spent, part of `outputTokens`. Null when it does not say. */
  reasoningTokens?: number | null;
  /** The effort the request asked for (null: none was sent) and the most it allowed the reply to be. */
  effort?: ReasoningEffort | null;
  maxOutputTokens?: number | null;
}

/**
 * How a round trip to the provider ended, for the operators. `truncated` and `schema-invalid` are
 * kept apart from `failed` because they are different problems with different remedies: the first is
 * a limit that was too small for what the model spent (thinking included), the second is a reply that
 * was whole and was not what was asked for, and neither says anything is wrong with the connection.
 */
export type ModelCallOutcome = 'ok' | 'repaired' | 'truncated' | 'schema-invalid' | 'failed';

export function modelCallOutcome(
  event: Pick<ModelCallEvent, 'ok' | 'repair' | 'errorCode'>,
): ModelCallOutcome {
  if (event.ok) return event.repair ? 'repaired' : 'ok';
  if (event.errorCode === 'MODEL_TRUNCATED') return 'truncated';
  if (event.errorCode === 'MODEL_OUTPUT_INVALID') return 'schema-invalid';
  return 'failed';
}

/** A reply the schema or the server's checks refused: a class of problem, never the reply. */
export interface ModelRejectEvent {
  reason: 'not_json' | 'schema' | 'validation' | 'injection_echo';
  repair: boolean;
  deployment: string | null;
  role: ModelRole | null;
}

export interface ModelObserver {
  onCall(event: ModelCallEvent): void;
  onReject?(event: ModelRejectEvent): void;
}

/** Failures that mean the provider could not be reached or used, as opposed to bad model output. */
const CONNECTIVITY_CODES = new Set([
  'MODEL_AUTH',
  'MODEL_UNREACHABLE',
  'MODEL_TIMEOUT',
  'MODEL_HTTP_ERROR',
  'MODEL_RATE_LIMIT',
  'MODEL_NOT_FOUND',
  'MODEL_PROTOCOL',
]);

/**
 * Process-lifetime counters for the real model provider. It stores only counts, codes and
 * timestamps: never prompts, completions, tokens-as-credentials or provider response bodies.
 */
export class ProviderTelemetry implements ModelObserver {
  private readonly startedAt = new Date().toISOString();
  private calls = 0;
  private repairCalls = 0;
  private failures = 0;
  private truncated = 0;
  private schemaInvalid = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private reasoningTokens = 0;
  private tokensReported = false;
  private connectivity: ProviderConnectivity;
  private lastCheckedAt: string | null = null;
  private lastLatencyMs: number | null = null;
  private lastError: { code: string; message: string } | null = null;
  private check: ProviderCheck | null = null;
  private prices: PriceTable = [];

  constructor(private readonly config: ProviderConfig) {
    this.connectivity = config.configured ? 'unverified' : 'not-applicable';
  }

  /**
   * Keeps the result of an explicit connection check, and lets it decide what the connection is. A check
   * is the one thing that asks for each of the four things apart, so what it found is more to be believed
   * than the code of whichever call failed last: a provider that is throttled, or whose deployment gives
   * cut-off replies, is still reached, signed in to and found, and is not called "failing" for that.
   */
  recordCheck(check: ProviderCheck): void {
    this.check = check;
    this.lastCheckedAt = check.checkedAt;
    this.lastLatencyMs = Math.round(
      check.deployments.reduce((slowest, one) => Math.max(slowest, one.latencyMs), 0),
    );
    // The connection is confirmed or it is not, and the chip says exactly that: there is no state in
    // which the page says "connected" and the check says it failed.
    this.connectivity = check.connected ? 'ok' : 'failing';
    const code = check.deployments.find((one) => one.code !== null)?.code ?? null;
    this.lastError = check.ok || code === null ? null : { code, message: checkSentence(check) };
  }

  /** The operator's price table, so that a call's estimated cost can be counted. Without one, none is. */
  usePrices(prices: PriceTable): void {
    this.prices = prices;
  }

  onReject(event: ModelRejectEvent): void {
    signals.modelSchemaFailure({
      reason: event.reason,
      role: event.role,
      deployment: event.deployment ?? this.config.model,
      repair: event.repair,
    });
  }

  onCall(event: ModelCallEvent): void {
    const deployment = event.deployment ?? this.config.model;
    const outcome = modelCallOutcome(event);
    const cost = estimateCostUsd(event, deployment, this.prices);
    signals.modelCall({
      provider: this.config.name,
      model: deployment ?? '',
      ok: event.ok,
      repair: event.repair,
      outcome,
      latencyMs: event.latencyMs,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      tokensReported: event.tokensReported,
      reasoningTokens: event.reasoningTokens ?? null,
      finishReason: event.finishReason ?? null,
      effort: event.effort ?? null,
      errorCode: event.errorCode,
      role: event.role ?? null,
      structured: event.structured ?? null,
      // What the provider reported was spent, so it is priced whether or not the reply could be used.
      estimatedUsd: event.tokensReported ? cost.usd : null,
    });
    for (const finding of event.safety ?? []) {
      signals.modelSafety({
        kind: finding.class,
        blocked: finding.action === 'blocked',
        role: event.role ?? null,
        deployment,
      });
    }
    this.lastCheckedAt = new Date().toISOString();
    this.lastLatencyMs = Math.round(event.latencyMs);
    if (event.repair) this.repairCalls += 1;
    if (event.tokensReported) {
      this.tokensReported = true;
      this.inputTokens += event.inputTokens;
      this.outputTokens += event.outputTokens;
      this.reasoningTokens += event.reasoningTokens ?? 0;
    }
    if (event.ok) {
      this.calls += 1;
      this.connectivity = 'ok';
      this.lastError = null;
      return;
    }
    this.failures += 1;
    if (outcome === 'truncated') this.truncated += 1;
    if (outcome === 'schema-invalid') this.schemaInvalid += 1;
    if (event.errorCode && CONNECTIVITY_CODES.has(event.errorCode)) {
      this.connectivity = 'failing';
      this.lastError = { code: event.errorCode, message: describe(event.errorCode) };
    } else if (event.errorCode) {
      // A reply that was cut off, or whole and refused, is the provider answering: it was reached and it
      // took the credentials. What was wrong is the reply, and the last error says which.
      if (outcome === 'truncated' || outcome === 'schema-invalid') this.connectivity = 'ok';
      this.lastError = { code: event.errorCode, message: describe(event.errorCode) };
    }
  }

  snapshot(): ProviderStatus {
    const { name, model, auth, configured } = this.config;
    return {
      mode: configured ? 'real-model' : 'local-rules',
      provider: name,
      model,
      auth,
      configured,
      connectivity: this.connectivity,
      lastCheckedAt: this.lastCheckedAt,
      lastLatencyMs: this.lastLatencyMs,
      lastError: this.lastError,
      check: this.check,
      counters: {
        calls: this.calls,
        repairCalls: this.repairCalls,
        failures: this.failures,
        truncated: this.truncated,
        schemaInvalid: this.schemaInvalid,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        reasoningTokens: this.reasoningTokens,
        tokensReported: this.tokensReported,
      },
      startedAt: this.startedAt,
    };
  }
}

function describe(code: string): string {
  switch (code) {
    case 'MODEL_AUTH':
      return 'The provider rejected or could not obtain credentials.';
    case 'MODEL_UNREACHABLE':
      return 'The provider endpoint could not be reached.';
    case 'MODEL_TIMEOUT':
      return 'The provider did not answer in time.';
    case 'MODEL_RATE_LIMIT':
      return 'The provider is rate limiting requests.';
    case 'MODEL_NOT_FOUND':
      return 'The endpoint or deployment was not found.';
    case 'MODEL_PROTOCOL':
      return 'The provider response did not match the expected API.';
    case 'MODEL_OUTPUT_INVALID':
      return 'The model replied in full, but the reply was not accepted: it was not the JSON asked for or it failed the server’s checks.';
    case 'MODEL_REFUSED':
      return 'The provider declined a request.';
    case 'MODEL_PARAMETER_UNSUPPORTED':
      return 'The deployment rejected a request parameter.';
    case 'MODEL_CONTEXT_LIMIT':
      return 'A request exceeded the model context window.';
    case 'MODEL_TRUNCATED':
      return 'A model reply was cut off at its output limit, so it was not used.';
    case 'MODEL_CALL_BUDGET':
      return 'The per-operation model call budget was reached.';
    case 'MODEL_TOKEN_BUDGET':
      return 'The per-operation model token budget was reached.';
    case 'MODEL_COST_BUDGET':
      return 'The per-operation estimated cost limit was reached.';
    case 'MODEL_ROUTE_UNAVAILABLE':
      return 'No configured deployment could serve a task.';
    default:
      return 'A model call failed.';
  }
}
