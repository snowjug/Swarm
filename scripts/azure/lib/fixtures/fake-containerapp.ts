import { createHash } from 'node:crypto';
import { AzError, type AzClient } from '../az.js';
import type { GitPort } from '../release-flow.js';
import type { SmokeReport } from '../pilot-smoke.js';

/**
 * A stateful fake of the parts of Azure the release tooling touches: one container app in multiple-revision
 * mode with its revisions and traffic, one registry, one resource group. It answers exactly the `az`
 * commands the tooling issues, enforces the rules that matter (weights sum to 100, a locked tag cannot be
 * rewritten, a revision with traffic cannot be deactivated), and records every call, so that a test can say
 * "this dry run changed nothing" and "traffic ended on that revision".
 */

export const SUB = '11111111-2222-3333-4444-555555555555';
export const GROUP = 'rg-swarm-pilot';
export const APP = 'ca-swarm-pilot';
export const REGISTRY = 'crswarmpilot';
export const LOGIN_SERVER = 'crswarmpilot.azurecr.example';
export const DOMAIN = 'example.region.azurecontainerapps.example';
export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);

export interface FakeRevision {
  name: string;
  active: boolean;
  image: string;
  running: string;
  health: string;
  replicas: number;
  /** Polls left before the revision reports Running. */
  warmup: number;
  /** True when the application inside answers its smoke checks. */
  appHealthy: boolean;
  createdTime: string;
}

export interface FakeWorld {
  tags: Record<string, string> | null;
  mode: string;
  traffic: { revisionName?: string; latestRevision?: boolean; weight: number }[];
  revisions: Map<string, FakeRevision>;
  latest: string;
  env: { name: string; value?: string; secretRef?: string }[];
  images: Map<string, { digest: string; locked: boolean }>;
  /** The next revision created fails to start. */
  failNextRevision: boolean;
  /** The next revision created never finishes starting. */
  hangNextRevision: boolean;
  /** The next revision created starts but its application is broken. */
  breakNextApp: boolean;
  /** The next revision activated never finishes starting. */
  hangNextActivation: boolean;
  calls: string[][];
  clock: { now: number };
}

export const digestOf = (sha: string): string =>
  `sha256:${createHash('sha256').update(sha).digest('hex')}`;

export function newWorld(options: { placeholder?: boolean } = {}): FakeWorld {
  const first = options.placeholder ? `${APP}--bootstrap` : `${APP}--r${SHA_A.slice(0, 12)}`;
  const image = options.placeholder
    ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
    : `${LOGIN_SERVER}/swarm@${digestOf(SHA_A)}`;
  const revisions = new Map<string, FakeRevision>();
  revisions.set(first, {
    name: first,
    active: true,
    image,
    running: 'Running',
    health: 'Healthy',
    replicas: 1,
    warmup: 0,
    appHealthy: true,
    createdTime: '2026-11-01T10:00:00Z',
  });
  return {
    tags: { app: 'swarm-lab' },
    mode: 'Multiple',
    traffic: options.placeholder
      ? [{ latestRevision: true, weight: 100 }]
      : [{ revisionName: first, weight: 100 }],
    revisions,
    latest: first,
    env: [
      { name: 'PORT', value: '3001' },
      { name: 'AUTH_MODE', value: 'entra' },
      { name: 'AUTH_ENTRA_CLIENT_ASSERTION', value: 'managed-identity' },
      {
        name: 'DATABASE_URL',
        value: 'postgres://id-swarm-pilot@psql-example.postgres.example:5432/swarm?sslmode=require',
      },
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING',
        value:
          'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.invalid/',
      },
      { name: 'AUTH_ENTRA_CLIENT_SECRET', secretRef: 'auth-entra-client-secret' },
      { name: 'SOME_API_KEY', value: 'not-a-real-key-value-for-a-test-0123456789' },
    ],
    images: new Map([[`swarm:${SHA_A}`, { digest: digestOf(SHA_A), locked: true }]]),
    failNextRevision: false,
    hangNextRevision: false,
    breakNextApp: false,
    hangNextActivation: false,
    calls: [],
    clock: { now: Date.parse('2026-11-03T10:00:00Z') },
  };
}

function weightOf(world: FakeWorld, name: string): number {
  return world.traffic.reduce((sum, entry) => {
    const matches = entry.latestRevision ? world.latest === name : entry.revisionName === name;
    return sum + (matches ? entry.weight : 0);
  }, 0);
}

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function revisionJson(world: FakeWorld, revision: FakeRevision) {
  return {
    name: revision.name,
    properties: {
      active: revision.active,
      createdTime: revision.createdTime,
      fqdn: `${revision.name}.${DOMAIN}`,
      healthState: revision.health,
      runningState: revision.running,
      replicas: revision.replicas,
      trafficWeight: weightOf(world, revision.name),
      template: { containers: [{ image: revision.image }] },
    },
  };
}

/** Each poll of a warming revision brings it a step closer to Running. */
function tick(world: FakeWorld): void {
  for (const revision of world.revisions.values()) {
    if (revision.warmup > 0) {
      revision.warmup -= 1;
      if (revision.warmup === 0 && revision.running === 'Processing') {
        revision.running = 'Running';
        revision.health = 'Healthy';
        revision.replicas = 1;
      }
    }
  }
}

export function fakeAzure(world: FakeWorld = newWorld()) {
  const answer = (args: readonly string[]): unknown => {
    world.calls.push([...args]);
    const [group, verb, third] = args;
    if (group === 'account' && verb === 'show')
      return { id: SUB, name: 'Visual Studio Enterprise', state: 'Enabled' };
    if (group === 'group' && verb === 'show') return { name: GROUP, tags: world.tags };
    if (group === 'acr' && verb === 'show') return { loginServer: LOGIN_SERVER };
    if (group === 'acr' && verb === 'build') {
      const tag = optionValue(args, '--image') ?? '';
      const sha = tag.replace('swarm:', '');
      if (world.images.get(tag)?.locked) throw new AzError('AZ_FAILED', `The tag ${tag} is locked`);
      world.images.set(tag, { digest: digestOf(sha), locked: false });
      return 'built';
    }
    if (group === 'acr' && verb === 'repository' && third === 'show') {
      const image = world.images.get(optionValue(args, '--image') ?? '');
      if (!image) throw new AzError('AZ_FAILED', 'manifest unknown');
      return `${image.digest}\n`;
    }
    if (group === 'acr' && verb === 'repository' && third === 'update') {
      const image = world.images.get(optionValue(args, '--image') ?? '');
      if (!image) throw new AzError('AZ_FAILED', 'manifest unknown');
      image.locked = optionValue(args, '--write-enabled') === 'false';
      return 'locked';
    }
    if (group === 'containerapp' && verb === 'show') {
      tick(world);
      const latest = world.revisions.get(world.latest);
      return {
        name: APP,
        properties: {
          provisioningState: 'Succeeded',
          latestRevisionName: world.latest,
          latestReadyRevisionName: world.latest,
          configuration: {
            activeRevisionsMode: world.mode,
            ingress: {
              fqdn: `${APP}.${DOMAIN}`,
              traffic: world.traffic.map((entry) => ({ ...entry, label: null })),
            },
          },
          template: {
            containers: [
              { image: latest?.image, env: world.env, resources: { cpu: 0.5, memory: '1Gi' } },
            ],
            scale: { minReplicas: 1, maxReplicas: 1 },
          },
        },
      };
    }
    if (group === 'containerapp' && verb === 'revision' && third === 'list') {
      tick(world);
      return [...world.revisions.values()].map((revision) => revisionJson(world, revision));
    }
    if (group === 'containerapp' && verb === 'revision' && third === 'deactivate') {
      const revision = world.revisions.get(optionValue(args, '--revision') ?? '');
      if (!revision) throw new AzError('AZ_FAILED', 'revision not found');
      if (weightOf(world, revision.name) > 0)
        throw new AzError('AZ_FAILED', 'A revision that receives traffic cannot be deactivated');
      Object.assign(revision, { active: false, running: 'Stopped', replicas: 0, health: 'None' });
      return 'deactivated';
    }
    if (group === 'containerapp' && verb === 'revision' && third === 'activate') {
      const revision = world.revisions.get(optionValue(args, '--revision') ?? '');
      if (!revision) throw new AzError('AZ_FAILED', 'revision not found');
      const hangs = world.hangNextActivation;
      world.hangNextActivation = false;
      Object.assign(revision, {
        active: true,
        running: 'Processing',
        health: 'None',
        warmup: hangs ? 1_000_000 : 1,
      });
      return 'activated';
    }
    if (group === 'containerapp' && verb === 'ingress' && third === 'traffic') {
      const at = args.indexOf('--revision-weight');
      const pairs = args
        .slice(at + 1)
        .filter((entry) => !entry.startsWith('--') && entry.includes('='));
      const entries = pairs.map((pair) => {
        const [name = '', weight = '0'] = pair.split('=');
        if (!world.revisions.has(name))
          throw new AzError('AZ_FAILED', `revision ${name} not found`);
        return { revisionName: name, weight: Number(weight) };
      });
      if (entries.reduce((sum, entry) => sum + entry.weight, 0) !== 100)
        throw new AzError('AZ_FAILED', 'Traffic weights must sum to 100');
      world.traffic = entries;
      return 'traffic set';
    }
    if (group === 'containerapp' && verb === 'update') {
      const suffix = optionValue(args, '--revision-suffix') ?? 'auto';
      const name = `${APP}--${suffix}`;
      if (world.revisions.has(name))
        throw new AzError('AZ_FAILED', `Revision ${name} already exists`);
      const broken = world.failNextRevision;
      const hanging = world.hangNextRevision;
      const unhealthy = world.breakNextApp;
      world.failNextRevision = false;
      world.hangNextRevision = false;
      world.breakNextApp = false;
      world.clock.now += 60_000;
      world.revisions.set(name, {
        name,
        active: true,
        image: optionValue(args, '--image') ?? '',
        running: broken ? 'Failed' : 'Processing',
        health: broken ? 'Unhealthy' : 'None',
        replicas: broken ? 0 : 1,
        warmup: broken ? 0 : hanging ? 1_000_000 : 2,
        appHealthy: !unhealthy,
        createdTime: new Date(world.clock.now).toISOString(),
      });
      world.latest = name;
      return 'updated';
    }
    throw new AzError('AZ_FAILED', `unexpected az call: ${args.slice(0, 4).join(' ')}`);
  };
  const az: AzClient = {
    json: async <T>(args: readonly string[]) => answer(args) as T,
    text: async (args) => String(answer(args)),
  };
  return {
    az,
    world,
    /** The calls that change something, in order. */
    mutations: () =>
      world.calls.filter(
        ([group, verb, third, fourth]) =>
          (group === 'acr' && (verb === 'build' || third === 'update')) ||
          (group === 'containerapp' &&
            (verb === 'update' ||
              (verb === 'ingress' && third === 'traffic' && fourth === 'set') ||
              (verb === 'revision' && (third === 'deactivate' || third === 'activate')))),
      ),
    servingNames: () =>
      world.traffic
        .filter((entry) => entry.weight > 0)
        .map((entry) => (entry.latestRevision ? world.latest : (entry.revisionName ?? ''))),
  };
}

/** Passes when every revision that has traffic has a healthy application. */
export function fakeSmoke(world: FakeWorld): (baseUrl: string) => Promise<SmokeReport> {
  return async (baseUrl) => {
    const healthy = world.traffic
      .filter((entry) => entry.weight > 0)
      .every((entry) => {
        const name = entry.latestRevision ? world.latest : entry.revisionName;
        return world.revisions.get(name ?? '')?.appHealthy === true;
      });
    return {
      baseUrl,
      passed: healthy,
      checks: [
        {
          id: 'live',
          title: 'GET /api/health/live answers 200',
          status: healthy ? 'pass' : 'fail',
          detail: healthy ? 'HTTP 200.' : 'HTTP 503.',
        },
        {
          id: 'ready',
          title: 'GET /api/health/ready answers 200',
          status: healthy ? 'pass' : 'fail',
          detail: healthy ? 'HTTP 200.' : 'HTTP 503.',
        },
      ],
    } as SmokeReport;
  };
}

export function fakeGit(
  options: { head?: string; clean?: boolean; schema?: number } = {},
): GitPort & { schema: number } {
  const state = { schema: options.schema ?? 9 };
  return {
    get schema() {
      return state.schema;
    },
    set schema(value: number) {
      state.schema = value;
    },
    head: async () => options.head ?? SHA_B,
    isClean: async () => options.clean ?? true,
    show: async () =>
      `export const MIGRATIONS: readonly Migration[] = [\n${Array.from({ length: state.schema }, (_, index) => `  {\n    version: ${index + 1},\n    up: '',\n  },\n`).join('')}];\n`,
  };
}
