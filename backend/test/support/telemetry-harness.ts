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
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, afterEach, beforeAll } from 'vitest';

export interface Point {
  name: string;
  attributes: Record<string, unknown>;
  value: unknown;
}

/**
 * In-memory trace and metric exporters, registered for the life of one test file, and the means of
 * reading what they hold. Everything that would leave the process is here, so that a test can say
 * what must never be in it. Metrics are cumulative: a test that counts reads before and after.
 */
export function telemetryHarness() {
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

  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
  });
  afterAll(async () => {
    await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
    trace.disable();
    metrics.disable();
    context.disable();
  });
  afterEach(() => spanExporter.reset());

  /** The measurements as of now, one entry per name and set of attributes. */
  async function measurements(): Promise<Point[]> {
    metricExporter.reset();
    await reader.forceFlush();
    const latest = metricExporter.getMetrics().at(-1);
    const points: Point[] = [];
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

  /** What a counter or a histogram holds for these attributes: its sum of counts, or its number of records. */
  const total = (points: Point[], name: string, attributes: Record<string, unknown> = {}): number =>
    points
      .filter(
        (point) =>
          point.name === name &&
          Object.entries(attributes).every(([key, value]) => point.attributes[key] === value),
      )
      .reduce((sum, point) => {
        const value = point.value;
        if (typeof value === 'number') return sum + value;
        const count = (value as { count?: unknown } | null)?.count;
        return sum + (typeof count === 'number' ? count : 0);
      }, 0);

  const spans = (name: string): ReadableSpan[] =>
    spanExporter.getFinishedSpans().filter((span) => span.name === name);

  /** Everything that would leave the process, as text. */
  async function everythingExported(): Promise<string> {
    return JSON.stringify({
      spans: spanExporter.getFinishedSpans().map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        links: span.links,
        status: span.status,
        resource: span.resource.attributes,
      })),
      metrics: await measurements(),
    });
  }

  return {
    spanExporter,
    meterProvider,
    measurements,
    total,
    spans,
    everythingExported,
  };
}
