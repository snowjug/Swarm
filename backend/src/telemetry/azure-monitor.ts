import { randomUUID } from 'node:crypto';
import { context, metrics, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { APP_VERSION } from '../../../shared/types.js';

export interface Exporters {
  traces: SpanExporter;
  metrics: PushMetricExporter;
}

/** What starting telemetry needs from outside, so that a test can supply it. */
export interface StartDependencies {
  createExporters(options: {
    connectionString: string;
    credential: TokenCredential;
  }): Promise<Exporters>;
  createCredential(clientId: string | undefined): TokenCredential;
}

const defaults: StartDependencies = {
  async createExporters(options) {
    // Loaded only when telemetry is switched on, so that a local run does not pay for it.
    const { AzureMonitorTraceExporter, AzureMonitorMetricExporter } =
      await import('@azure/monitor-opentelemetry-exporter');
    return {
      traces: new AzureMonitorTraceExporter(options),
      metrics: new AzureMonitorMetricExporter(options),
    };
  },
  // A user-assigned managed identity when one is named, otherwise whatever the environment offers
  // (`az login` on a developer's machine, a system-assigned identity in Azure). No key is involved.
  createCredential: (clientId) =>
    new DefaultAzureCredential(clientId ? { managedIdentityClientId: clientId } : {}),
};

export interface TelemetryHandle {
  /** Sends what is buffered now. */
  flush(): Promise<void>;
  /** Sends what is buffered and stops. Safe to call once. */
  shutdown(): Promise<void>;
}

export interface StartResult {
  handle: TelemetryHandle | null;
  /** Why telemetry is off although it was asked for. Never contains the connection string. */
  warning: string | null;
}

const CONNECTION_STRING =
  /^InstrumentationKey=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:;[A-Za-z]+=[^;\s]+)*;?$/iu;

function samplingRatio(value: string | undefined): number {
  const ratio = Number(value);
  return value !== undefined && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 1;
}

/**
 * Starts exporting traces and metrics to Application Insights, authenticated with Microsoft Entra
 * (a token, not the instrumentation key), when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. Without
 * it nothing is started and the application's instrumentation does nothing. Observability must
 * never stop the application, so a failure here is a warning and the application runs without it.
 *
 * Only what the application itself emits is exported: there is no automatic instrumentation of
 * HTTP clients or of the database driver, which would record URLs and statements.
 */
export async function startTelemetry(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: StartDependencies = defaults,
): Promise<StartResult> {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
  if (!connectionString) return { handle: null, warning: null };
  if (!CONNECTION_STRING.test(connectionString)) {
    return {
      handle: null,
      warning:
        'APPLICATIONINSIGHTS_CONNECTION_STRING is not a valid Application Insights connection string, so no telemetry is sent.',
    };
  }
  try {
    const exporters = await dependencies.createExporters({
      connectionString,
      credential: dependencies.createCredential(env.AZURE_CLIENT_ID?.trim() || undefined),
    });
    const resource = resourceFromAttributes({
      'service.name': env.OTEL_SERVICE_NAME?.trim() || 'swarm',
      'service.version': APP_VERSION,
      'service.instance.id': randomUUID().slice(0, 8),
      'swarm.role': env.SWARM_ROLE?.trim() || 'all',
    });
    const manager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(manager);
    const tracerProvider = new BasicTracerProvider({
      resource,
      sampler: new ParentBasedSampler({
        root:
          samplingRatio(env.OTEL_TRACES_SAMPLER_ARG) === 1
            ? new AlwaysOnSampler()
            : new TraceIdRatioBasedSampler(samplingRatio(env.OTEL_TRACES_SAMPLER_ARG)),
      }),
      spanProcessors: [new BatchSpanProcessor(exporters.traces)],
    });
    trace.setGlobalTracerProvider(tracerProvider);
    const interval = Number(env.OTEL_METRIC_EXPORT_INTERVAL);
    const meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: exporters.metrics,
          exportIntervalMillis: Number.isFinite(interval) && interval >= 1_000 ? interval : 60_000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
    return {
      handle: {
        async flush() {
          await Promise.allSettled([tracerProvider.forceFlush(), meterProvider.forceFlush()]);
        },
        async shutdown() {
          await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
          trace.disable();
          metrics.disable();
          context.disable();
        },
      },
      warning: null,
    };
  } catch {
    return {
      handle: null,
      warning: 'Telemetry could not be started, so the application runs without it.',
    };
  }
}
