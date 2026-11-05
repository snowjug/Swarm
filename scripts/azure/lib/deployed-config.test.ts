import { describe, expect, it } from 'vitest';
import { readApp } from './containerapp.js';
import {
  APP_PORT,
  checkContainerConfig,
  failedChecks,
  isPlaceholderImage,
  type ContainerConfig,
} from './deployed-config.js';
import { consoleLogQuery, revisionLogHelp, systemLogQuery } from './revision-logs.js';
import type { AzClient } from './az.js';

const probes = (overrides: Partial<Record<'Startup' | 'Liveness' | 'Readiness', object>> = {}) => [
  { type: 'Startup', path: '/api/health/live', port: APP_PORT, ...overrides.Startup },
  { type: 'Liveness', path: '/api/health/live', port: APP_PORT, ...overrides.Liveness },
  { type: 'Readiness', path: '/api/health/ready', port: APP_PORT, ...overrides.Readiness },
];

const good: ContainerConfig = {
  image: 'registry.example/swarm@sha256:abc',
  targetPort: APP_PORT,
  env: [{ name: 'PORT', value: '3001' }],
  probes: probes(),
};

const ids = (config: Partial<ContainerConfig>) =>
  failedChecks(checkContainerConfig({ ...good, ...config })).map((check) => check.id);

describe('checkContainerConfig', () => {
  it('passes the configuration the template sets for a real image', () => {
    expect(checkContainerConfig(good).map((check) => check.status)).toEqual([
      'pass',
      'pass',
      'pass',
    ]);
  });

  it('accepts a PORT that is not set: the application defaults to the port the ingress targets', () => {
    expect(ids({ env: [] })).toEqual([]);
    expect(ids({ env: [{ name: 'OTHER', value: 'x' }] })).toEqual([]);
  });

  it('fails every way the live pilot went wrong', () => {
    // PORT=80 carried over from the placeholder, which the application refuses.
    expect(ids({ env: [{ name: 'PORT', value: '80' }] })).toEqual(['port-env']);
    // The ingress still on the placeholder's port.
    expect(ids({ targetPort: 80 })).toEqual(['ingress-port']);
    expect(ids({ targetPort: null })).toEqual(['ingress-port']);
    // No probe at all.
    expect(ids({ probes: [] })).toEqual(['probes']);
  });

  it('fails a PORT that is valid but differs from the port the ingress and probes use', () => {
    const [, port] = checkContainerConfig({ ...good, env: [{ name: 'PORT', value: '8080' }] });
    expect(port).toMatchObject({ status: 'fail' });
    expect(port?.detail).toContain('PORT=8080, but the ingress and the probes use 3001');
  });

  it('fails an empty or non-numeric PORT, and a PORT held as a secret reference', () => {
    expect(ids({ env: [{ name: 'PORT', value: '' }] })).toEqual(['port-env']);
    expect(ids({ env: [{ name: 'PORT', value: 'three thousand' }] })).toEqual(['port-env']);
    expect(ids({ env: [{ name: 'PORT', secretRef: 'port' }] })).toEqual(['port-env']);
  });

  it('names what is wrong with the probes: a missing one, a wrong route, a wrong port', () => {
    const [, , missing] = checkContainerConfig({
      ...good,
      probes: probes().filter((probe) => probe.type !== 'Readiness'),
    });
    expect(missing?.detail).toContain('no Readiness probe');
    const [, , wrong] = checkContainerConfig({
      ...good,
      probes: probes({ Liveness: { path: '/' }, Startup: { port: 80 } }),
    });
    expect(wrong?.detail).toContain('the Liveness probe asks /, not /api/health/live');
    expect(wrong?.detail).toContain('the Startup probe uses port 80, not 3001');
  });

  it('reads a probe type without regard to case, as the CLI and the portal differ', () => {
    expect(
      ids({
        probes: probes().map((probe) => ({ ...probe, type: probe.type.toUpperCase() })),
      }),
    ).toEqual([]);
  });

  it('says why a missing probe matters and what fixes it', () => {
    const [, , probesCheck] = checkContainerConfig({ ...good, probes: [] });
    expect(probesCheck?.detail).toContain('az containerapp update cannot set probes');
  });
});

describe('isPlaceholderImage', () => {
  it('recognises the public placeholder and nothing else', () => {
    expect(isPlaceholderImage('mcr.microsoft.com/azuredocs/containerapps-helloworld:latest')).toBe(
      true,
    );
    expect(isPlaceholderImage('registry.example/swarm@sha256:abc')).toBe(false);
    expect(isPlaceholderImage(null)).toBe(false);
  });
});

describe('readApp reads what `az containerapp show` and `revision list` return', () => {
  // The shape of the live pilot's answers (names and addresses are invented): ingress on 3001, PORT set,
  // and `probes: []`, which is how the live container looked.
  const show = {
    name: 'ca-example',
    properties: {
      provisioningState: 'Succeeded',
      latestRevisionName: 'ca-example--r1',
      environmentId:
        '/subscriptions/s/resourceGroups/g/providers/Microsoft.App/managedEnvironments/cae-example',
      configuration: {
        activeRevisionsMode: 'Multiple',
        ingress: {
          fqdn: 'ca-example.example',
          targetPort: 3001,
          traffic: [{ latestRevision: true, weight: 100 }],
        },
      },
      template: {
        containers: [
          {
            image: 'registry.example/swarm@sha256:abc',
            env: [{ name: 'PORT', value: '3001' }],
            probes: [],
            resources: { cpu: 0.5, memory: '1Gi' },
          },
        ],
        scale: { minReplicas: 1, maxReplicas: 1 },
      },
    },
  };
  const revisions = [
    {
      name: 'ca-example--r1',
      properties: {
        active: true,
        trafficWeight: 100,
        runningState: 'RunningAtMaxScale',
        healthState: 'Healthy',
        template: {
          containers: [
            {
              image: 'registry.example/swarm@sha256:abc',
              env: [{ name: 'PORT', value: '3001' }],
              probes: [{ type: 'Readiness', httpGet: { path: '/api/health/ready', port: 3001 } }],
            },
          ],
        },
      },
    },
  ];
  const az: AzClient = {
    json: async <T>(args: readonly string[]) => (args.includes('revision') ? revisions : show) as T,
    text: async () => '',
  };

  it('takes the ingress port, the environment, and the probes of the app and of each revision', async () => {
    const state = await readApp(az, { subscription: 's', resourceGroup: 'g', app: 'ca-example' });
    expect(state.targetPort).toBe(3001);
    expect(state.environmentId).toContain('managedEnvironments/cae-example');
    expect(state.probes).toEqual([]);
    expect(state.revisions[0]?.probes).toEqual([
      { type: 'Readiness', path: '/api/health/ready', port: 3001 },
    ]);
    expect(state.revisions[0]?.env).toEqual([{ name: 'PORT', value: '3001' }]);
    // The live container as it was left: the right port, and no probe.
    expect(failedChecks(checkContainerConfig(state)).map((check) => check.id)).toEqual(['probes']);
  });
});

describe('revisionLogHelp', () => {
  const scope = { subscription: 'sub', resourceGroup: 'rg-example', app: 'ca-example' };

  it('names both tables, the app and the revision, in queries that read the columns of the live workspace', () => {
    expect(consoleLogQuery('ca-example', 'ca-example--r1')).toBe(
      "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-example' and RevisionName_s == 'ca-example--r1' | project TimeGenerated, Stream_s, Log_s | order by TimeGenerated desc | take 100",
    );
    expect(systemLogQuery('ca-example', 'ca-example--r1')).toContain(
      'project TimeGenerated, Reason_s, Log_s',
    );
  });

  it('looks the workspace up from the environment of the app when it is known', () => {
    const help = revisionLogHelp(
      scope,
      'ca-example--r1',
      '/subscriptions/s/resourceGroups/g/providers/Microsoft.App/managedEnvironments/cae',
    );
    expect(help).toContain(
      'az containerapp env show --ids /subscriptions/s/resourceGroups/g/providers/Microsoft.App/managedEnvironments/cae',
    );
    expect(help).toContain('logAnalyticsConfiguration.customerId');
    expect(help).toContain('az monitor log-analytics query --workspace "$WS"');
  });

  it('says what to look for: the refused setting, the failed probe, the deadline', () => {
    const help = revisionLogHelp(scope, 'ca-example--r1');
    expect(help).toContain('Invalid server configuration');
    expect(help).toContain('ProbeFailed');
    expect(help).toContain('Deployment Progress Deadline Exceeded');
    expect(help).toContain('customer id of the Log Analytics workspace');
  });

  it('never puts a name into a shell command or a query unless it is a plain Azure name', () => {
    const help = revisionLogHelp(scope, "x'; rm -rf / #");
    expect(help).not.toContain('rm -rf');
    expect(help).toContain('Log Analytics');
  });
});
