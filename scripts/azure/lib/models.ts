export type AccountKind = 'AIServices' | 'OpenAI';

export interface CatalogSku {
  name: string;
  usageName?: string;
  deprecationDate?: string | null;
  capacity?: {
    minimum?: number;
    maximum?: number;
    default?: number;
    step?: number;
  };
}

export interface CatalogModel {
  kind: string;
  model: {
    format?: string;
    name: string;
    version: string;
    isDefaultVersion?: boolean;
    lifecycleStatus?: string;
    capabilities?: Record<string, string>;
    deprecation?: { inference?: string | null } | null;
    skus?: CatalogSku[];
  };
}

export interface UsageRecord {
  name: { value: string };
  currentValue: number;
  limit: number;
}

export interface RegionCatalog {
  region: string;
  models: readonly CatalogModel[];
  usage: readonly UsageRecord[];
}

export interface Candidate {
  region: string;
  kind: AccountKind;
  modelName: string;
  modelVersion: string;
  sku: string;
  capacity: number;
  quotaAvailable: number | null;
  retiresOn: string | null;
  notes: string[];
}

export interface Rejection {
  region: string;
  modelName: string;
  version?: string;
  sku?: string;
  reason: string;
}

export interface RankOptions {
  kind: AccountKind;
  /** Region preference, most preferred first. Regions not listed are ignored. */
  regions: readonly string[];
  /** Exact model names, most preferred first. Replaces the default cost-safe allowlist. */
  modelNames?: readonly string[];
  /** Wanted capacity in thousands of tokens per minute. */
  capacity: number;
  now: Date;
  minDaysBeforeRetirement?: number;
  allowPreview?: boolean;
  /** Include Legacy and Deprecating models (still served, but with a published retirement date). */
  allowLegacy?: boolean;
}

/**
 * Cost-safe defaults for many short structured-JSON calls: small non-reasoning chat models first.
 * Flagship, reasoning and "pro" models are never chosen unless named explicitly.
 */
export const DEFAULT_MODEL_PREFERENCE: readonly RegExp[] = [
  /^gpt-4\.1-mini$/,
  /^gpt-4o-mini$/,
  /^gpt-5(\.\d+)?-mini$/,
  /^gpt-4\.1$/,
  /^gpt-4o$/,
  /^gpt-5(\.\d+)?-chat$/,
  /^gpt-4\.1-nano$/,
];

/** Regional processing first, then data-zone, then global. */
export const SKU_PREFERENCE = ['Standard', 'DataZoneStandard', 'GlobalStandard'] as const;

const GENERALLY_AVAILABLE = new Set(['generallyavailable', 'stable']);
const LEGACY = new Set(['legacy', 'deprecating']);
const DAY_MS = 86_400_000;

function lifecycleProblem(status: string | undefined, options: RankOptions): string | null {
  if (!status) return null;
  const value = status.toLowerCase();
  if (GENERALLY_AVAILABLE.has(value)) return null;
  if (value === 'preview') {
    return options.allowPreview
      ? null
      : 'lifecycle is Preview (pass --allow-preview to include it)';
  }
  if (LEGACY.has(value)) {
    return options.allowLegacy
      ? null
      : `lifecycle is ${status} (pass --allow-legacy to include it)`;
  }
  return `lifecycle is ${status}`;
}

/**
 * Fine-tuning hosting reuses SKU names such as "DataZoneStandard" but meters a separate quota
 * (its usage name ends in "-finetune"), so it can never stand in for the quota that deploying a
 * base model consumes. The live catalog lists both kinds under the same model.
 */
const FINE_TUNING_USAGE = /fine-?tun/iu;

/**
 * Keeps one inference entry per SKU name. Fine-tuning entries are dropped; among genuine repeats
 * of an inference SKU the roomier entry wins.
 */
function uniqueSkus(skus: readonly CatalogSku[]): CatalogSku[] {
  const byName = new Map<string, CatalogSku>();
  for (const sku of skus) {
    if (sku.usageName && FINE_TUNING_USAGE.test(sku.usageName)) continue;
    const current = byName.get(sku.name);
    if (!current || (sku.capacity?.maximum ?? 0) > (current.capacity?.maximum ?? 0))
      byName.set(sku.name, sku);
  }
  return [...byName.values()];
}

function modelTier(name: string, explicit: readonly string[] | undefined): number {
  if (explicit) return explicit.indexOf(name);
  return DEFAULT_MODEL_PREFERENCE.findIndex((pattern) => pattern.test(name));
}

function quotaFor(usage: readonly UsageRecord[], usageName: string | undefined): number | null {
  if (!usageName) return null;
  const wanted = usageName.toLowerCase();
  const record = usage.find((entry) => entry.name.value.toLowerCase() === wanted);
  return record ? Math.max(0, record.limit - record.currentValue) : null;
}

function chooseCapacity(
  wanted: number,
  quota: number | null,
  limits: CatalogSku['capacity'],
): number | null {
  const minimum = limits?.minimum ?? 1;
  const step = Math.max(1, limits?.step ?? 1);
  const target = Math.min(wanted, limits?.maximum ?? Number.POSITIVE_INFINITY, quota ?? wanted);
  const aligned = minimum + Math.floor((target - minimum) / step) * step;
  return aligned >= minimum ? aligned : null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function betterVersion(a: CatalogModel['model'], b: CatalogModel['model']): boolean {
  if (Boolean(a.isDefaultVersion) !== Boolean(b.isDefaultVersion))
    return Boolean(a.isDefaultVersion);
  return a.version > b.version;
}

interface Ranked extends Candidate {
  order: [number, number, number, number];
}

export function rankCandidates(
  catalogs: readonly RegionCatalog[],
  options: RankOptions,
): { candidates: Candidate[]; rejected: Rejection[] } {
  const minDays = options.minDaysBeforeRetirement ?? 120;
  const horizon = options.now.getTime() + minDays * DAY_MS;
  const regionOrder = options.regions.map((region) => region.toLowerCase());
  const ranked: Ranked[] = [];
  const rejected: Rejection[] = [];

  for (const catalog of catalogs) {
    const region = catalog.region.toLowerCase();
    const regionIndex = regionOrder.indexOf(region);
    if (regionIndex < 0) continue;

    // One entry per model name: the best version, so older retiring versions never win.
    const best = new Map<string, CatalogModel['model']>();
    for (const entry of catalog.models) {
      const model = entry.model;
      if (entry.kind !== options.kind || model.format !== 'OpenAI') continue;
      if (modelTier(model.name, options.modelNames) < 0) continue;
      const reject = (reason: string) =>
        rejected.push({ region, modelName: model.name, version: model.version, reason });

      const capabilities = model.capabilities ?? {};
      if (capabilities.chatCompletion !== 'true') {
        reject('does not support chat completions');
        continue;
      }
      if (capabilities.inference === 'false') {
        reject('does not support inference');
        continue;
      }
      const lifecycle = lifecycleProblem(model.lifecycleStatus, options);
      if (lifecycle) {
        reject(lifecycle);
        continue;
      }
      const retires = parseDate(model.deprecation?.inference);
      if (retires && retires.getTime() < horizon) {
        reject(`retires ${retires.toISOString().slice(0, 10)}, within ${minDays} days`);
        continue;
      }
      const current = best.get(model.name);
      if (!current || betterVersion(model, current)) best.set(model.name, model);
    }

    for (const model of best.values()) {
      const tier = modelTier(model.name, options.modelNames);
      for (const sku of uniqueSkus(model.skus ?? [])) {
        const skuIndex = SKU_PREFERENCE.indexOf(sku.name as (typeof SKU_PREFERENCE)[number]);
        const reject = (reason: string) =>
          rejected.push({
            region,
            modelName: model.name,
            version: model.version,
            sku: sku.name,
            reason,
          });
        if (skuIndex < 0) {
          reject('not a pay-as-you-go SKU');
          continue;
        }
        const skuRetires = parseDate(sku.deprecationDate);
        if (skuRetires && skuRetires.getTime() < horizon) {
          reject(`SKU retires ${skuRetires.toISOString().slice(0, 10)}, within ${minDays} days`);
          continue;
        }
        const quota = quotaFor(catalog.usage, sku.usageName);
        if (quota !== null && quota <= 0) {
          reject('no quota available in this region');
          continue;
        }
        const capacity = chooseCapacity(options.capacity, quota, sku.capacity);
        if (capacity === null) {
          reject(`available quota ${quota} is below the SKU minimum`);
          continue;
        }
        const notes: string[] = [];
        if (quota === null)
          notes.push('quota not reported by the usage API; the deployment may still be refused');
        if (capacity < options.capacity)
          notes.push(`capacity reduced from ${options.capacity} to ${capacity}`);
        if (!model.isDefaultVersion) notes.push('not the default version');
        ranked.push({
          region,
          kind: options.kind,
          modelName: model.name,
          modelVersion: model.version,
          sku: sku.name,
          capacity,
          quotaAvailable: quota,
          retiresOn:
            (skuRetires ?? parseDate(model.deprecation?.inference))?.toISOString().slice(0, 10) ??
            null,
          notes,
          // Model preference dominates; within a model, quota that is known to exist beats quota that
          // is merely unreported, then region and SKU preference decide.
          order: [tier, quota === null ? 1 : 0, regionIndex, skuIndex],
        });
      }
    }
  }

  ranked.sort(
    (a, b) =>
      a.order[0] - b.order[0] ||
      a.order[1] - b.order[1] ||
      a.order[2] - b.order[2] ||
      a.order[3] - b.order[3] ||
      (b.quotaAvailable ?? -1) - (a.quotaAvailable ?? -1),
  );
  return {
    candidates: ranked.map(({ order: _order, ...candidate }) => candidate),
    rejected,
  };
}
