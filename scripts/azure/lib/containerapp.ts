import type { AzClient } from './az.js';

/**
 * What the release tooling needs to know about a container app, read from `az containerapp show` and
 * `az containerapp revision list`. The parsing is defensive on purpose: the CLI's JSON is large and
 * changes between versions, so every field the tooling relies on has a stated meaning here and an honest
 * "unknown" when it is missing, and no decision is taken on a field that could not be read.
 */

export interface Scope {
  subscription: string;
  resourceGroup: string;
  app: string;
}

export interface TrafficEntry {
  revisionName: string | null;
  latestRevision: boolean;
  weight: number;
  label: string | null;
}

export interface RevisionInfo {
  name: string;
  active: boolean;
  createdTime: string | null;
  fqdn: string | null;
  image: string | null;
  trafficWeight: number;
  running: string | null;
  health: string | null;
  replicas: number | null;
}

export interface AppState {
  name: string;
  provisioningState: string | null;
  mode: string | null;
  fqdn: string | null;
  latestRevisionName: string | null;
  latestReadyRevisionName: string | null;
  traffic: TrafficEntry[];
  image: string | null;
  cpu: string | number | null;
  memory: string | null;
  minReplicas: number | null;
  maxReplicas: number | null;
  env: { name?: unknown; value?: unknown; secretRef?: unknown }[];
  revisions: RevisionInfo[];
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const commonArgs = (scope: Scope): string[] => [
  '--name',
  scope.app,
  '--resource-group',
  scope.resourceGroup,
  '--subscription',
  scope.subscription,
];

export async function readApp(az: AzClient, scope: Scope): Promise<AppState> {
  const raw = obj(await az.json<unknown>(['containerapp', 'show', ...commonArgs(scope)]));
  const properties = obj(raw.properties);
  const configuration = obj(properties.configuration);
  const ingress = obj(configuration.ingress);
  const template = obj(properties.template);
  const containers = Array.isArray(template.containers) ? template.containers : [];
  const container = obj(containers[0]);
  const scale = obj(template.scale);
  const traffic = (Array.isArray(ingress.traffic) ? ingress.traffic : []).map(
    (entry): TrafficEntry => {
      const item = obj(entry);
      return {
        revisionName: text(item.revisionName),
        latestRevision: item.latestRevision === true,
        weight: num(item.weight) ?? 0,
        label: text(item.label),
      };
    },
  );
  const rawRevisions = await az.json<unknown>([
    'containerapp',
    'revision',
    'list',
    ...commonArgs(scope),
  ]);
  const revisions = (Array.isArray(rawRevisions) ? rawRevisions : []).map((entry): RevisionInfo => {
    const item = obj(entry);
    const itemProperties = obj(item.properties);
    const itemTemplate = obj(itemProperties.template);
    const itemContainer = obj(
      Array.isArray(itemTemplate.containers) ? itemTemplate.containers[0] : undefined,
    );
    return {
      name: text(item.name) ?? '',
      active: itemProperties.active === true,
      createdTime: text(itemProperties.createdTime),
      fqdn: text(itemProperties.fqdn),
      image: text(itemContainer.image),
      trafficWeight: num(itemProperties.trafficWeight) ?? 0,
      running: text(itemProperties.runningState),
      health: text(itemProperties.healthState),
      replicas: num(itemProperties.replicas),
    };
  });
  return {
    name: text(raw.name) ?? scope.app,
    provisioningState: text(properties.provisioningState),
    mode: text(configuration.activeRevisionsMode),
    fqdn: text(ingress.fqdn),
    latestRevisionName: text(properties.latestRevisionName),
    latestReadyRevisionName: text(properties.latestReadyRevisionName),
    traffic,
    image: text(container.image),
    cpu:
      typeof obj(container.resources).cpu === 'number' ||
      typeof obj(container.resources).cpu === 'string'
        ? (obj(container.resources).cpu as string | number)
        : null,
    memory: text(obj(container.resources).memory),
    minReplicas: num(scale.minReplicas),
    maxReplicas: num(scale.maxReplicas),
    env: (Array.isArray(container.env) ? container.env : []).map(obj),
    revisions: revisions.filter((revision) => revision.name),
  };
}

/** The revisions that receive traffic now, with `latestRevision` entries resolved to the newest revision. */
export function servingRevisions(state: AppState): { name: string; weight: number }[] {
  const serving: { name: string; weight: number }[] = [];
  for (const entry of state.traffic) {
    if (entry.weight <= 0) continue;
    const name = entry.latestRevision ? state.latestRevisionName : entry.revisionName;
    if (name) serving.push({ name, weight: entry.weight });
  }
  return serving;
}

export const PLACEHOLDER_IMAGE = 'containerapps-helloworld';
export const isPlaceholder = (image: string | null): boolean =>
  image?.includes(PLACEHOLDER_IMAGE) === true;

export function revisionNamed(state: AppState, name: string): RevisionInfo | undefined {
  return state.revisions.find((revision) => revision.name === name);
}

/** Argument lists for the commands that change things. Kept in one place so the plan can print them. */
export const commands = {
  acrBuild: (scope: Scope, registry: string, sha: string): string[] => [
    'acr',
    'build',
    '--registry',
    registry,
    '--subscription',
    scope.subscription,
    '--image',
    `swarm:${sha}`,
    '--file',
    'Dockerfile',
    '.',
  ],
  acrLock: (scope: Scope, registry: string, sha: string): string[] => [
    'acr',
    'repository',
    'update',
    '--name',
    registry,
    '--subscription',
    scope.subscription,
    '--image',
    `swarm:${sha}`,
    '--write-enabled',
    'false',
    '--delete-enabled',
    'false',
  ],
  trafficSet: (
    scope: Scope,
    weights: readonly { revision: string; weight: number }[],
  ): string[] => [
    'containerapp',
    'ingress',
    'traffic',
    'set',
    ...commonArgs(scope),
    '--revision-weight',
    ...weights.map((entry) => `${entry.revision}=${entry.weight}`),
  ],
  update: (scope: Scope, image: string, suffix: string, env: readonly string[] = []): string[] => [
    'containerapp',
    'update',
    ...commonArgs(scope),
    '--image',
    image,
    '--revision-suffix',
    suffix,
    ...(env.length > 0 ? ['--set-env-vars', ...env] : []),
  ],
  deactivate: (scope: Scope, revision: string): string[] => [
    'containerapp',
    'revision',
    'deactivate',
    ...commonArgs(scope),
    '--revision',
    revision,
  ],
  activate: (scope: Scope, revision: string): string[] => [
    'containerapp',
    'revision',
    'activate',
    ...commonArgs(scope),
    '--revision',
    revision,
  ],
};

export const reads = {
  account: (subscription: string): string[] => ['account', 'show', '--subscription', subscription],
  group: (subscription: string, resourceGroup: string): string[] => [
    'group',
    'show',
    '--name',
    resourceGroup,
    '--subscription',
    subscription,
  ],
  registry: (subscription: string, registry: string): string[] => [
    'acr',
    'show',
    '--name',
    registry,
    '--subscription',
    subscription,
  ],
  digest: (subscription: string, registry: string, sha: string): string[] => [
    'acr',
    'repository',
    'show',
    '--name',
    registry,
    '--subscription',
    subscription,
    '--image',
    `swarm:${sha}`,
    '--query',
    'digest',
    '-o',
    'tsv',
  ],
};
