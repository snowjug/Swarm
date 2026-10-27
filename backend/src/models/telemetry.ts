import type { ProviderConfig } from '../config.js';
import type { ProviderConnectivity, ProviderStatus } from '../../../shared/types.js';

export interface ModelCallEvent {
  ok: boolean;
  repair: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  tokensReported: boolean;
  errorCode: string | null;
}

export interface ModelObserver {
  onCall(event: ModelCallEvent): void;
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
  private inputTokens = 0;
  private outputTokens = 0;
  private tokensReported = false;
  private connectivity: ProviderConnectivity;
  private lastCheckedAt: string | null = null;
  private lastLatencyMs: number | null = null;
  private lastError: { code: string; message: string } | null = null;

  constructor(private readonly config: ProviderConfig) {
    this.connectivity = config.configured ? 'unverified' : 'not-applicable';
  }

  onCall(event: ModelCallEvent): void {
    this.lastCheckedAt = new Date().toISOString();
    this.lastLatencyMs = Math.round(event.latencyMs);
    if (event.repair) this.repairCalls += 1;
    if (event.ok) {
      this.calls += 1;
      this.inputTokens += event.inputTokens;
      this.outputTokens += event.outputTokens;
      if (event.tokensReported) this.tokensReported = true;
      this.connectivity = 'ok';
      this.lastError = null;
      return;
    }
    this.failures += 1;
    if (event.errorCode && CONNECTIVITY_CODES.has(event.errorCode)) {
      this.connectivity = 'failing';
      this.lastError = { code: event.errorCode, message: describe(event.errorCode) };
    } else if (event.errorCode) {
      // The provider answered; the content failed validation. Connectivity is unaffected.
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
      counters: {
        calls: this.calls,
        repairCalls: this.repairCalls,
        failures: this.failures,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
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
      return 'The model returned output that failed validation after bounded repair.';
    case 'MODEL_REFUSED':
      return 'The provider declined a request.';
    case 'MODEL_PARAMETER_UNSUPPORTED':
      return 'The deployment rejected a request parameter.';
    case 'MODEL_CONTEXT_LIMIT':
      return 'A request exceeded the model context window.';
    case 'MODEL_TRUNCATED':
      return 'A model answer was truncated.';
    case 'MODEL_CALL_BUDGET':
      return 'The per-operation model call budget was reached.';
    default:
      return 'A model call failed.';
  }
}
