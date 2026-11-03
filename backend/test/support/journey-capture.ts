/**
 * What would leave the process, and what the process writes, held in memory so that the journey can read it: the spans
 * and metrics that the application emits (the exporters of `telemetry-harness.ts`, without the test runner they are
 * bound to there) and the structured log lines of every application of the harness. `journey-server.ts` serves what
 * this holds, and says where a canary string was found.
 */
import { context, metrics, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { CanaryReport, TelemetryReading } from './journey-protocol.js';

/** The most log lines kept: the oldest are dropped, which a run of the journey never reaches. */
const MAX_LOG_LINES = 200_000;

export interface Capture {
  /** For `buildApp({ logStream })`. */
  readonly logStream: { write(message: string): void };
  reading(): Promise<TelemetryReading>;
  /** Forgets the spans and the log lines. Metrics are cumulative: a reader that counts reads before and after. */
  reset(): void;
  /** Where each canary appears, among the logs, the spans, the metrics and the extra places given. */
  scan(canaries: Record<string, string>, extra?: Record<string, string>): Promise<CanaryReport>;
  close(): Promise<void>;
}

export function startCapture(): Capture {
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 3_600_000,
  });
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  const meterProvider = new MeterProvider({ readers: [reader] });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);

  let lines: string[] = [];

  async function measurements(): Promise<TelemetryReading['metrics']> {
    metricExporter.reset();
    await reader.forceFlush();
    const latest = metricExporter.getMetrics().at(-1);
    const points: TelemetryReading['metrics'] = [];
    for (const scope of latest?.scopeMetrics ?? []) {
      for (const metric of scope.metrics) {
        for (const point of metric.dataPoints as DataPoint<unknown>[]) {
          points.push({
            name: metric.descriptor.name,
            attributes: { ...point.attributes },
            value: point.value,
          });
        }
      }
    }
    return points;
  }

  const spans = (): TelemetryReading['spans'] =>
    spanExporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: { ...span.attributes },
      status: span.status.code,
    }));

  const parsed = (line: string): Record<string, unknown> => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return { unparsed: line };
    }
  };

  return {
    logStream: {
      write(message) {
        lines.push(message);
        if (lines.length > MAX_LOG_LINES) lines = lines.slice(-MAX_LOG_LINES / 2);
      },
    },
    async reading() {
      return { spans: spans(), metrics: await measurements(), logs: lines.map(parsed) };
    },
    reset() {
      spanExporter.reset();
      lines = [];
    },
    async scan(canaries, extra = {}) {
      // Everything that would leave the process, whole: a span's events, links and resource as well as its attributes.
      const exported = {
        logs: lines.join('\n'),
        spans: JSON.stringify(
          spanExporter.getFinishedSpans().map((span) => ({
            name: span.name,
            attributes: span.attributes,
            events: span.events,
            links: span.links,
            status: span.status,
            resource: span.resource.attributes,
          })),
        ),
        metrics: JSON.stringify(await measurements()),
        ...extra,
      };
      const report: CanaryReport = {};
      for (const [name, value] of Object.entries(canaries)) {
        report[name] = Object.entries(exported)
          .filter(([, text]) => text.includes(value))
          .map(([place]) => place);
      }
      return report;
    },
    async close() {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
      trace.disable();
      metrics.disable();
      context.disable();
    },
  };
}
