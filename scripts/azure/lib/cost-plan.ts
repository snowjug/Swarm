import { readFileSync } from 'node:fs';

/**
 * The cost plan. It prices the resources infra/pilot would create from a SNAPSHOT of public list prices
 * (docs/production/prices/), never from a live call, so it runs offline, gives the same answer twice,
 * and every number in docs/production/azure-preflight.md can be recomputed. It says what it is: a list-price
 * estimate on one date. It knows nothing about an agreement, a credit, a dev/test discount or real usage.
 */

export interface MeterPrice {
  meterId: string;
  effectiveStartDate: string;
  USD: number;
  INR: number;
}

export interface Meter {
  service: string;
  product: string;
  sku: string;
  meter: string;
  unit: string;
  tierMinimumUnits: number;
  prices: Readonly<Record<string, MeterPrice>>;
}

export interface PriceSnapshot {
  schemaVersion: number;
  retrievedOn: string;
  source: string;
  apiVersion: string;
  note: string;
  meters: Readonly<Record<string, Meter>>;
  queries: readonly { id: string; region: string; filter: string }[];
  impliedInrPerUsd: {
    value: number;
    min: number;
    max: number;
    metersCompared: number;
    method: string;
  };
}

export const SNAPSHOT_PATH = new URL(
  '../../../docs/production/prices/azure-retail-prices-2026-11-03.json',
  import.meta.url,
);

export function loadPriceSnapshot(path: URL | string = SNAPSHOT_PATH): PriceSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as PriceSnapshot;
}

export const HOURS_PER_MONTH = 730;
export const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;
export const DAYS_PER_MONTH = HOURS_PER_MONTH / 24;

/** What Microsoft's billing documentation grants each subscription each month for Container Apps. Not in the price API. */
export const CONTAINER_APPS_FREE_GRANT = {
  vcpuSeconds: 180_000,
  memoryGibSeconds: 360_000,
  requests: 2_000_000,
} as const;

/** Log Analytics: the first 5 GB a month per billing account is free; it is a tier of the ingestion meter. */
export const LOG_FREE_GB = 5;

export type Profile = 'pilot' | 'production-shaped';

export interface ProfileShape {
  cpu: number;
  memoryGib: number;
  postgres: {
    meter: 'postgres.burstable_b1ms_hour' | 'postgres.generalpurpose_ddsv5_2vcore_hour';
    storageGb: number;
    zoneRedundantHa: boolean;
    geoRedundantBackup: boolean;
  };
  registry: 'acr.basic_registry_unit_day' | 'acr.premium_registry_unit_day';
  natGateway: boolean;
  keyVault: boolean;
  logGbLow: number;
  logGbHigh: number;
}

export const PROFILES: Readonly<Record<Profile, ProfileShape>> = {
  pilot: {
    cpu: 0.5,
    memoryGib: 1,
    postgres: {
      meter: 'postgres.burstable_b1ms_hour',
      storageGb: 32,
      zoneRedundantHa: false,
      geoRedundantBackup: false,
    },
    registry: 'acr.basic_registry_unit_day',
    natGateway: false,
    keyVault: false,
    logGbLow: 0.5,
    logGbHigh: 6,
  },
  'production-shaped': {
    cpu: 1,
    memoryGib: 2,
    postgres: {
      meter: 'postgres.generalpurpose_ddsv5_2vcore_hour',
      storageGb: 128,
      zoneRedundantHa: true,
      geoRedundantBackup: true,
    },
    registry: 'acr.premium_registry_unit_day',
    natGateway: true,
    keyVault: true,
    logGbLow: 5,
    logGbHigh: 20,
  },
};

export interface CostAssumptions {
  /** Log alert rules the template creates (nine). Billed per rule per month at the 15-minute frequency. */
  logAlertRules: number;
  /** Metric alert time series (one per metric rule). The first ten a month are free. */
  metricAlertSeries: number;
  /** Releases a month, and hours the previous revision stays warm after each. */
  releasesPerMonth: number;
  warmWindowHours: number;
  keyVaultOperations: number;
  natDataGb: number;
  /** One recorded demonstration scenario of three runs (docs/azure/pilot-cost.md): tokens in and out. */
  scenarioTokensIn: number;
  scenarioTokensOut: number;
  scenariosPerMonth: number;
  /** Outbound data in a month. The first 100 GB are free. */
  egressGb: number;
}

export const DEFAULT_ASSUMPTIONS: CostAssumptions = {
  logAlertRules: 9,
  metricAlertSeries: 9,
  releasesPerMonth: 4,
  warmWindowHours: 4,
  keyVaultOperations: 100_000,
  natDataGb: 10,
  scenarioTokensIn: 534_000,
  scenarioTokensOut: 62_000,
  scenariosPerMonth: 10,
  egressGb: 5,
};

export interface CostLine {
  id: string;
  label: string;
  /** `list-price`: arithmetic on snapshot prices. `assumption`: also rests on a stated usage guess. `documented`: a ratio from Microsoft's documentation, not the price API. */
  basis: 'list-price' | 'assumption' | 'documented';
  lowUsd: number;
  highUsd: number;
  /** The arithmetic, in dollars, as a reader would redo it. */
  arithmetic: string;
  note?: string;
}

export interface CostPlan {
  region: string;
  profile: Profile;
  retrievedOn: string;
  usdToInr: number;
  lines: CostLine[];
  /** Infrastructure only: no model usage. */
  infrastructure: { lowUsd: number; highUsd: number; lowInr: number; highInr: number };
  model: { perScenarioUsd: number; monthlyUsd: number; alternatives: ModelLine[] };
  total: { lowUsd: number; highUsd: number; lowInr: number; highInr: number };
  optional: CostLine[];
  vm: {
    region: string;
    hourlyUsd: number;
    monthlyUsd: number;
    monthlyInr: number;
    windowsMonthlyUsd: number;
  };
}

export interface ModelLine {
  label: string;
  perScenarioUsd: number;
  perMillionTokensInUsd: number;
  perMillionTokensOutUsd: number;
}

function price(snapshot: PriceSnapshot, id: string, region: string): number {
  const meter = snapshot.meters[id];
  if (!meter) throw new Error(`The price snapshot has no meter "${id}".`);
  const found = meter.prices[region] ?? meter.prices['Global'];
  if (!found) throw new Error(`The price snapshot has no price for "${id}" in ${region}.`);
  return found.USD;
}

const round = (value: number, places = 4): number => Number(value.toFixed(places));
const dollars = (value: number): string =>
  `US$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 6 });

function modelPrices(snapshot: PriceSnapshot): ModelLine[] {
  const region = 'eastus2';
  const scenario = (inputPerM: number, outputPerM: number, assumptions: CostAssumptions) =>
    (assumptions.scenarioTokensIn / 1e6) * inputPerM +
    (assumptions.scenarioTokensOut / 1e6) * outputPerM;
  const defs = [
    {
      label: 'gpt-4.1-mini, Global Standard (the existing deployment)',
      inPerM: price(snapshot, 'model.gpt41mini_global_input_1k', region) * 1000,
      outPerM: price(snapshot, 'model.gpt41mini_global_output_1k', region) * 1000,
    },
    {
      label: 'gpt-4.1, Global Standard (a larger class)',
      inPerM: price(snapshot, 'model.gpt41_global_input_1k', region) * 1000,
      outPerM: price(snapshot, 'model.gpt41_global_output_1k', region) * 1000,
    },
    {
      label: 'gpt-5.4-mini, Global Standard',
      inPerM: price(snapshot, 'model.gpt54mini_global_input_1m', region),
      outPerM: price(snapshot, 'model.gpt54mini_global_output_1m', region),
    },
  ];
  return defs.map((entry) => ({
    label: entry.label,
    perScenarioUsd: round(scenario(entry.inPerM, entry.outPerM, DEFAULT_ASSUMPTIONS), 4),
    perMillionTokensInUsd: round(entry.inPerM, 4),
    perMillionTokensOutUsd: round(entry.outPerM, 4),
  }));
}

export function buildCostPlan(
  snapshot: PriceSnapshot,
  input: {
    region: string;
    profile: Profile;
    assumptions?: Partial<CostAssumptions>;
    /** Where the dev VM runs (Central India), which is not necessarily where the pilot would. */
    vmRegion?: string;
  },
): CostPlan {
  const { region, profile } = input;
  const shape = PROFILES[profile];
  const assume: CostAssumptions = { ...DEFAULT_ASSUMPTIONS, ...input.assumptions };
  const p = (id: string) => price(snapshot, id, region);
  const lines: CostLine[] = [];

  // Container app: billed per second of vCPU and GiB, at a lower rate while the replica is idle.
  const vcpuSeconds = shape.cpu * SECONDS_PER_MONTH;
  const memorySeconds = shape.memoryGib * SECONDS_PER_MONTH;
  const billedVcpu = Math.max(0, vcpuSeconds - CONTAINER_APPS_FREE_GRANT.vcpuSeconds);
  const billedMemory = Math.max(0, memorySeconds - CONTAINER_APPS_FREE_GRANT.memoryGibSeconds);
  const appLow =
    billedVcpu * p('containerapps.vcpu_idle_second') +
    billedMemory * p('containerapps.memory_idle_gib_second');
  const appHigh =
    billedVcpu * p('containerapps.vcpu_active_second') +
    billedMemory * p('containerapps.memory_active_gib_second');
  lines.push({
    id: 'container-app',
    label: `Container app (${shape.cpu} vCPU, ${shape.memoryGib} GiB, one replica, always on)`,
    basis: 'list-price',
    lowUsd: round(appLow),
    highUsd: round(appHigh),
    arithmetic: `vCPU ${num(vcpuSeconds)} s - ${num(CONTAINER_APPS_FREE_GRANT.vcpuSeconds)} free = ${num(billedVcpu)} s; memory ${num(memorySeconds)} GiB-s - ${num(CONTAINER_APPS_FREE_GRANT.memoryGibSeconds)} free = ${num(billedMemory)} GiB-s. Idle: ${num(billedVcpu)} x ${p('containerapps.vcpu_idle_second')} + ${num(billedMemory)} x ${p('containerapps.memory_idle_gib_second')} = ${dollars(appLow)}. Active all month: ${num(billedVcpu)} x ${p('containerapps.vcpu_active_second')} + ${num(billedMemory)} x ${p('containerapps.memory_active_gib_second')} = ${dollars(appHigh)}`,
    note: 'Assumes the per-subscription free grant is fully available and applies to idle seconds as well (UNVERIFIED). Without the grant the line is higher.',
  });

  // Blue/green: the previous revision keeps running (active rate) for a window after each release.
  const warmSeconds = assume.releasesPerMonth * assume.warmWindowHours * 3600;
  const warm =
    shape.cpu * warmSeconds * p('containerapps.vcpu_active_second') +
    shape.memoryGib * warmSeconds * p('containerapps.memory_active_gib_second');
  lines.push({
    id: 'warm-window',
    label: `Previous revision kept warm: ${assume.releasesPerMonth} releases x ${assume.warmWindowHours} h`,
    basis: 'assumption',
    lowUsd: round(warm),
    highUsd: round(warm),
    arithmetic: `${assume.releasesPerMonth} x ${assume.warmWindowHours} h x 3,600 = ${num(warmSeconds)} s; ${num(shape.cpu * warmSeconds)} vCPU-s x ${p('containerapps.vcpu_active_second')} + ${num(shape.memoryGib * warmSeconds)} GiB-s x ${p('containerapps.memory_active_gib_second')} = ${dollars(warm)}`,
    note: 'Both revisions also run the embedded job runner during the window (docs/production/release-process.md).',
  });

  // PostgreSQL flexible server.
  const haFactor = shape.postgres.zoneRedundantHa ? 2 : 1;
  const compute = HOURS_PER_MONTH * p(shape.postgres.meter) * haFactor;
  const storage = shape.postgres.storageGb * p('postgres.storage_gb_month') * haFactor;
  lines.push({
    id: 'postgres',
    label: `PostgreSQL flexible server (${shape.postgres.meter.includes('b1ms') ? 'Burstable B1ms' : 'General Purpose D2ds_v5'}, ${shape.postgres.storageGb} GiB${shape.postgres.zoneRedundantHa ? ', zone-redundant HA' : ''})`,
    basis: shape.postgres.zoneRedundantHa ? 'documented' : 'list-price',
    lowUsd: round(compute + storage),
    highUsd: round(compute + storage),
    arithmetic: `compute ${HOURS_PER_MONTH} h x ${p(shape.postgres.meter)}${haFactor === 2 ? ' x 2 (standby)' : ''} = ${dollars(compute)}; storage ${shape.postgres.storageGb} GB x ${p('postgres.storage_gb_month')}${haFactor === 2 ? ' x 2' : ''} = ${dollars(storage)}; backups up to the provisioned size are included`,
    note: shape.postgres.zoneRedundantHa
      ? 'The 2x for the standby and the price of geo-redundant backup storage are from Microsoft documentation, not from the price API (UNVERIFIED).'
      : undefined,
  });

  // Registry.
  const registry = DAYS_PER_MONTH * p(shape.registry);
  lines.push({
    id: 'registry',
    label: `Container Registry (${shape.registry.includes('basic') ? 'Basic' : 'Premium'})`,
    basis: 'list-price',
    lowUsd: round(registry),
    highUsd: round(registry),
    arithmetic: `${round(DAYS_PER_MONTH, 4)} days x ${p(shape.registry)} = ${dollars(registry)}; includes storage for the image`,
  });

  // Logs.
  const logLow = Math.max(0, shape.logGbLow - LOG_FREE_GB) * p('loganalytics.ingestion_gb_after_5');
  const logHigh =
    Math.max(0, shape.logGbHigh - LOG_FREE_GB) * p('loganalytics.ingestion_gb_after_5');
  lines.push({
    id: 'logs',
    label: 'Log Analytics workspace and Application Insights (ingestion)',
    basis: 'assumption',
    lowUsd: round(logLow),
    highUsd: round(logHigh),
    arithmetic: `low ${shape.logGbLow} GB, high ${shape.logGbHigh} GB a month; (GB - ${LOG_FREE_GB} free) x ${p('loganalytics.ingestion_gb_after_5')}: ${dollars(logLow)} to ${dollars(logHigh)}`,
    note: 'The daily cap in the template bounds this line; the volume is a guess until measured.',
  });

  // Alerts.
  const logAlerts = assume.logAlertRules * p('monitor.log_alert_rule_15min_month');
  const metricSeries =
    Math.max(0, assume.metricAlertSeries - 10) * p('monitor.metric_alert_series_month_after_10');
  lines.push({
    id: 'alerts',
    label: `Azure Monitor alert rules (${assume.logAlertRules} log, ${assume.metricAlertSeries} metric time series)`,
    basis: 'list-price',
    lowUsd: round(logAlerts + metricSeries),
    highUsd: round(logAlerts + metricSeries),
    arithmetic: `${assume.logAlertRules} log rules x ${p('monitor.log_alert_rule_15min_month')} (15-minute frequency) = ${dollars(logAlerts)}; ${assume.metricAlertSeries} metric series, the first 10 free = ${dollars(metricSeries)}; e-mail notifications and the action group are free within the monthly allowance`,
    note: 'The free metric-series allowance is shared by the whole subscription.',
  });

  // Key Vault.
  if (shape.keyVault) {
    const vault = (assume.keyVaultOperations / 10_000) * p('keyvault.standard_operations_10k');
    lines.push({
      id: 'key-vault',
      label: 'Key Vault (Standard): secret reads',
      basis: 'assumption',
      lowUsd: round(vault),
      highUsd: round(vault),
      arithmetic: `${num(assume.keyVaultOperations)} operations / 10,000 x ${p('keyvault.standard_operations_10k')} = ${dollars(vault)}; the vault itself has no standing charge`,
    });
  }

  // NAT gateway, when the profile has it.
  if (shape.natGateway) {
    lines.push(natLine(snapshot, region, assume));
  }

  // Egress.
  const egress = Math.max(0, assume.egressGb - 100) * p('bandwidth.internet_out_gb_after_100');
  lines.push({
    id: 'egress',
    label: 'Outbound data transfer',
    basis: 'assumption',
    lowUsd: round(egress),
    highUsd: round(egress),
    arithmetic: `${assume.egressGb} GB a month; the first 100 GB are free, so ${dollars(egress)}`,
  });

  const infraLow = lines.reduce((sum, line) => sum + line.lowUsd, 0);
  const infraHigh = lines.reduce((sum, line) => sum + line.highUsd, 0);

  const models = modelPrices(snapshot);
  const modelMonthly = (models[0]?.perScenarioUsd ?? 0) * assume.scenariosPerMonth;
  const rate = snapshot.impliedInrPerUsd.value;

  const optional: CostLine[] = [];
  if (!shape.natGateway) optional.push(natLine(snapshot, region, assume));
  const firewallBasic = HOURS_PER_MONTH * p('firewall.basic_deployment_hour');
  const firewallStandard = HOURS_PER_MONTH * p('firewall.standard_deployment_hour');
  optional.push({
    id: 'firewall',
    label: 'Azure Firewall (egress filtering by name): for reference, not in any profile',
    basis: 'list-price',
    lowUsd: round(firewallBasic),
    highUsd: round(firewallStandard),
    arithmetic: `Basic ${HOURS_PER_MONTH} h x ${p('firewall.basic_deployment_hour')} = ${dollars(firewallBasic)}; Standard ${HOURS_PER_MONTH} h x ${p('firewall.standard_deployment_hour')} = ${dollars(firewallStandard)}; plus ${p('firewall.standard_data_gb')} per GB processed (Standard). Needs a user-defined route on the environment subnet.`,
    note: 'A firewall can allow-list names. A research crawler visits arbitrary public sites, so it could only block, not allow-list; the application refuses private and metadata addresses itself.',
  });
  optional.push({
    id: 'environment-private-endpoint',
    label:
      'Container Apps environment with a private endpoint, planned maintenance or a dedicated profile',
    basis: 'list-price',
    lowUsd: round(HOURS_PER_MONTH * p('containerapps.environment_private_endpoint_hour')),
    highUsd: round(HOURS_PER_MONTH * p('containerapps.environment_private_endpoint_hour')),
    arithmetic: `${HOURS_PER_MONTH} h x ${p('containerapps.environment_private_endpoint_hour')} = ${dollars(HOURS_PER_MONTH * p('containerapps.environment_private_endpoint_hour'))}`,
    note: 'The single most expensive change to make by accident: no template here adds it.',
  });

  const vmRegion = input.vmRegion ?? 'centralindia';
  const vmHourly = price(snapshot, 'vm.d4as_v5_linux_hour', vmRegion);
  const vmWindows = price(snapshot, 'vm.d4as_v5_windows_hour', vmRegion);

  return {
    region,
    profile,
    retrievedOn: snapshot.retrievedOn,
    usdToInr: rate,
    lines,
    infrastructure: {
      lowUsd: round(infraLow, 2),
      highUsd: round(infraHigh, 2),
      lowInr: round(infraLow * rate, 0),
      highInr: round(infraHigh * rate, 0),
    },
    model: {
      perScenarioUsd: models[0]?.perScenarioUsd ?? 0,
      monthlyUsd: round(modelMonthly, 2),
      alternatives: models,
    },
    total: {
      lowUsd: round(infraLow, 2),
      highUsd: round(infraHigh + modelMonthly, 2),
      lowInr: round(infraLow * rate, 0),
      highInr: round((infraHigh + modelMonthly) * rate, 0),
    },
    optional,
    vm: {
      region: vmRegion,
      hourlyUsd: vmHourly,
      monthlyUsd: round(vmHourly * HOURS_PER_MONTH, 2),
      monthlyInr: round(vmHourly * HOURS_PER_MONTH * rate, 0),
      windowsMonthlyUsd: round(vmWindows * HOURS_PER_MONTH, 2),
    },
  };
}

function natLine(snapshot: PriceSnapshot, region: string, assume: CostAssumptions): CostLine {
  const gateway = HOURS_PER_MONTH * price(snapshot, 'nat.gateway_hour', region);
  const address =
    HOURS_PER_MONTH * price(snapshot, 'network.public_ip_standard_static_hour', region);
  const data = assume.natDataGb * price(snapshot, 'nat.data_processed_gb', region);
  const total = gateway + address + data;
  return {
    id: 'nat-gateway',
    label:
      'NAT gateway with one static public IP (one fixed outbound address; does not filter anything)',
    basis: 'assumption',
    lowUsd: round(total),
    highUsd: round(total),
    arithmetic: `gateway ${HOURS_PER_MONTH} h x ${price(snapshot, 'nat.gateway_hour', region)} = ${dollars(gateway)}; address ${HOURS_PER_MONTH} h x ${price(snapshot, 'network.public_ip_standard_static_hour', region)} = ${dollars(address)}; data ${assume.natDataGb} GB x ${price(snapshot, 'nat.data_processed_gb', region)} = ${dollars(data)}`,
    note: 'The NAT gateway meter is listed under the region "Global" in the price API.',
  };
}

export function inr(usd: number, plan: Pick<CostPlan, 'usdToInr'>): number {
  return Math.round(usd * plan.usdToInr);
}

/** A plain-text rendering for the terminal. The documentation carries the same numbers with their working. */
export function renderCostPlan(plan: CostPlan): string[] {
  const out: string[] = [];
  out.push(
    `Cost plan: profile ${plan.profile}, region ${plan.region}. List prices read on ${plan.retrievedOn}; INR = USD x ${plan.usdToInr} (the API's own INR list conversion that day). An estimate, not a quote.`,
  );
  for (const line of plan.lines) {
    out.push(
      `  ${line.label}: ${dollars(line.lowUsd)} to ${dollars(line.highUsd)} (INR ${num(inr(line.lowUsd, plan))} to ${num(inr(line.highUsd, plan))}) [${line.basis}]`,
    );
  }
  out.push(
    `  Infrastructure per month: ${dollars(plan.infrastructure.lowUsd)} to ${dollars(plan.infrastructure.highUsd)} (INR ${num(plan.infrastructure.lowInr)} to ${num(plan.infrastructure.highInr)}).`,
  );
  out.push(
    `  Model usage is separate and usage-based: ${dollars(plan.model.perScenarioUsd)} per recorded scenario on gpt-4.1-mini.`,
  );
  out.push(
    `  The dev VM swarm-dev (Standard_D4as_v5, ${plan.vm.region}) running 24x7 costs ${dollars(plan.vm.monthlyUsd)} a month (INR ${num(plan.vm.monthlyInr)}) at the Linux/base rate and is NOT in the numbers above; its disk is not priced.`,
  );
  return out;
}
