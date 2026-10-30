import { context, metrics, trace } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { TokenCredential } from '@azure/identity';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startTelemetry,
  type StartDependencies,
  type TelemetryHandle,
} from '../src/telemetry/azure-monitor.js';
import { inSpan, signals } from '../src/telemetry/signals.js';

const KEY = '00000000-0000-4000-8000-0000000000aa';
const CONNECTION = `InstrumentationKey=${KEY};IngestionEndpoint=https://eastus2-0.in.applicationinsights.azure.com/`;
const credential: TokenCredential = { getToken: async () => null };

function fakes() {
  const traces = new InMemorySpanExporter();
  const metricsOut = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const seen: { connectionString: string; credential: TokenCredential }[] = [];
  const credentialFor: (string | undefined)[] = [];
  const dependencies: StartDependencies = {
    createExporters: async (options) => {
      seen.push(options);
      return { traces, metrics: metricsOut };
    },
    createCredential: (clientId) => {
      credentialFor.push(clientId);
      return credential;
    },
  };
  return { traces, metricsOut, seen, credentialFor, dependencies };
}

let handle: TelemetryHandle | null = null;
afterEach(async () => {
  await handle?.shutdown();
  handle = null;
  trace.disable();
  metrics.disable();
  context.disable();
});

describe('starting telemetry', () => {
  it('does nothing without a connection string, and loads nothing', async () => {
    const { dependencies, seen, credentialFor } = fakes();
    for (const env of [{}, { APPLICATIONINSIGHTS_CONNECTION_STRING: '  ' }]) {
      expect(await startTelemetry(env, dependencies)).toEqual({ handle: null, warning: null });
    }
    expect(seen).toEqual([]);
    expect(credentialFor).toEqual([]);
    // The instrumentation is then a no-op, and costs the application nothing.
    expect(await inSpan('swarm.test', {}, async () => 'done')).toBe('done');
    signals.audit('project.created');
  });

  it('refuses a malformed connection string without repeating it, and runs without telemetry', async () => {
    const { dependencies, seen } = fakes();
    const secret = 'InstrumentationKey=not-a-guid;Secret=do-not-print-me';
    const started = await startTelemetry(
      { APPLICATIONINSIGHTS_CONNECTION_STRING: secret },
      dependencies,
    );
    expect(started.handle).toBeNull();
    expect(started.warning).toContain('not a valid');
    expect(started.warning).not.toContain('do-not-print-me');
    expect(started.warning).not.toContain('InstrumentationKey');
    expect(seen).toEqual([]);
  });

  it('exports with a credential, chosen by the identity named, and never with a key of its own', async () => {
    const { dependencies, seen, credentialFor, traces, metricsOut } = fakes();
    const started = await startTelemetry(
      {
        APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION,
        AZURE_CLIENT_ID: '11111111-2222-4333-8444-555555555555',
        OTEL_SERVICE_NAME: 'swarm-pilot',
        SWARM_ROLE: 'worker',
        OTEL_METRIC_EXPORT_INTERVAL: '1000',
      },
      dependencies,
    );
    handle = started.handle;
    expect(started.warning).toBeNull();
    expect(handle).not.toBeNull();
    expect(seen).toEqual([{ connectionString: CONNECTION, credential }]);
    expect(credentialFor).toEqual(['11111111-2222-4333-8444-555555555555']);

    await inSpan(
      'swarm.job',
      { 'swarm.job.kind': 'simulation', prompt: 'never exported' },
      async () => undefined,
    );
    signals.jobEvent('retry', 'simulation');
    // Read before shutdown: an in-memory exporter forgets what it holds when it is shut down.
    await handle?.flush();

    const [span] = traces.getFinishedSpans();
    expect(span?.name).toBe('swarm.job');
    expect(span?.attributes).toEqual({ 'swarm.job.kind': 'simulation' });
    expect(span?.resource.attributes).toMatchObject({
      'service.name': 'swarm-pilot',
      'swarm.role': 'worker',
    });
    const events = metricsOut
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
      .filter((metric) => metric.descriptor.name === 'swarm.jobs.events');
    expect(events).not.toHaveLength(0);
  });

  it('uses whatever identity the environment offers when none is named', async () => {
    const { dependencies, credentialFor } = fakes();
    const started = await startTelemetry(
      { APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION },
      dependencies,
    );
    handle = started.handle;
    expect(credentialFor).toEqual([undefined]);
  });

  it('is a warning, not a failure, when the exporters cannot be made', async () => {
    const started = await startTelemetry(
      { APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION },
      {
        createExporters: async () => {
          throw new Error(`could not load: ${CONNECTION}`);
        },
        createCredential: () => credential,
      },
    );
    expect(started.handle).toBeNull();
    expect(started.warning).toBe(
      'Telemetry could not be started, so the application runs without it.',
    );
    expect(started.warning).not.toContain(KEY);
  });
});
