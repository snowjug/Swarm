import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCostPlan,
  CONTAINER_APPS_FREE_GRANT,
  HOURS_PER_MONTH,
  loadPriceSnapshot,
  renderCostPlan,
  SNAPSHOT_PATH,
  type CostLine,
} from './cost-plan.js';

const snapshot = loadPriceSnapshot();
const line = (lines: CostLine[], id: string): CostLine => {
  const found = lines.find((one) => one.id === id);
  if (!found) throw new Error(`no cost line ${id}`);
  return found;
};

describe('the price snapshot', () => {
  it('records when and how it was read, and every query so it can be repeated with curl', () => {
    expect(snapshot.retrievedOn).toBe('2026-11-03');
    expect(snapshot.source).toBe('https://prices.azure.com/api/retail/prices');
    expect(snapshot.queries.length).toBeGreaterThan(15);
    for (const query of snapshot.queries) {
      expect(query.filter).toMatch(/serviceName eq|productName eq|meterName/u);
    }
    const services = snapshot.queries.map((query) => query.id);
    for (const id of [
      'containerapps',
      'postgres',
      'acr',
      'loganalytics',
      'monitor',
      'keyvault',
      'vm-d4asv5',
      'nat-gateway',
    ]) {
      expect(services, id).toContain(id);
    }
  });

  it('holds a USD and an INR price for every meter in every region it names, and INR is one consistent conversion', () => {
    const { value, min, max } = snapshot.impliedInrPerUsd;
    expect(max - min).toBeLessThan(0.01);
    for (const [id, meter] of Object.entries(snapshot.meters)) {
      for (const [region, price] of Object.entries(meter.prices)) {
        expect(price.USD, `${id} ${region}`).toBeGreaterThan(0);
        expect(price.INR, `${id} ${region}`).toBeGreaterThan(0);
        // Prices of fractions of a cent are rounded to six places in INR, so compare with a tolerance.
        expect(Math.abs(price.INR / price.USD - value) / value, `${id} ${region}`).toBeLessThan(
          0.002,
        );
      }
    }
  });
});

describe('the pilot cost plan in Central India', () => {
  const plan = buildCostPlan(snapshot, { region: 'centralindia', profile: 'pilot' });

  it('prices the container app from per-second meters and the free grant', () => {
    const app = line(plan.lines, 'container-app');
    const vcpu = 0.5 * HOURS_PER_MONTH * 3600 - CONTAINER_APPS_FREE_GRANT.vcpuSeconds;
    const memory = 1 * HOURS_PER_MONTH * 3600 - CONTAINER_APPS_FREE_GRANT.memoryGibSeconds;
    expect(vcpu).toBe(1_134_000);
    expect(memory).toBe(2_268_000);
    expect(app.lowUsd).toBeCloseTo(vcpu * 0.000003 + memory * 0.000003, 4);
    expect(app.highUsd).toBeCloseTo(vcpu * 0.000024 + memory * 0.000003, 4);
    expect(app.lowUsd.toFixed(2)).toBe('10.21');
    expect(app.highUsd.toFixed(2)).toBe('34.02');
  });

  it('prices PostgreSQL B1ms, the registry and the alert rules', () => {
    expect(line(plan.lines, 'postgres').lowUsd).toBeCloseTo(730 * 0.0245 + 32 * 0.131, 4);
    expect(line(plan.lines, 'registry').lowUsd).toBeCloseTo((730 / 24) * 0.1666, 4);
    expect(line(plan.lines, 'alerts').lowUsd).toBeCloseTo(9 * 0.5, 4);
    expect(line(plan.lines, 'logs').highUsd).toBeCloseTo(1 * 3.22, 4);
  });

  it('adds the infrastructure up, converts with the stated rate, and keeps the model out of the infrastructure', () => {
    const low = plan.lines.reduce((sum, one) => sum + one.lowUsd, 0);
    const high = plan.lines.reduce((sum, one) => sum + one.highUsd, 0);
    expect(plan.infrastructure.lowUsd).toBeCloseTo(low, 1);
    expect(plan.infrastructure.highUsd).toBeCloseTo(high, 1);
    expect(plan.usdToInr).toBe(snapshot.impliedInrPerUsd.value);
    expect(plan.infrastructure.lowInr).toBe(Math.round(low * plan.usdToInr));
    expect(plan.total.highUsd).toBeCloseTo(plan.infrastructure.highUsd + plan.model.monthlyUsd, 1);
    expect(plan.model.perScenarioUsd).toBeCloseTo(0.534 * 0.4 + 0.062 * 1.6, 3);
  });

  it('says what the numbers are: list prices, on one date, with assumptions marked', () => {
    const text = renderCostPlan(plan).join('\n');
    expect(text).toContain('List prices read on 2026-11-03');
    expect(text).toContain('An estimate, not a quote');
    expect(text).toContain('[assumption]');
    expect(plan.lines.filter((one) => one.basis === 'assumption').length).toBeGreaterThanOrEqual(2);
  });

  it('prices the dev VM in the region it runs in and flags that it is outside the pilot total', () => {
    expect(plan.vm).toMatchObject({ region: 'centralindia', hourlyUsd: 0.111 });
    expect(plan.vm.monthlyUsd).toBeCloseTo(0.111 * 730, 2);
    expect(plan.vm.monthlyInr).toBe(Math.round(0.111 * 730 * plan.usdToInr));
    expect(renderCostPlan(plan).join('\n')).toContain('NOT in the numbers above');
    // The VM alone is more than the pilot's idle month: the budget advice depends on it.
    expect(plan.vm.monthlyUsd).toBeGreaterThan(plan.infrastructure.lowUsd);
  });

  it('prices a NAT gateway and a firewall as options, and never as part of the pilot', () => {
    expect(plan.lines.some((one) => one.id === 'nat-gateway')).toBe(false);
    const nat = plan.optional.find((one) => one.id === 'nat-gateway');
    expect(nat?.lowUsd).toBeCloseTo(730 * 0.045 + 730 * 0.005 + 10 * 0.045, 4);
    expect(plan.optional.find((one) => one.id === 'firewall')?.arithmetic).toContain('Standard');
  });
});

describe('the cost plan across regions and profiles', () => {
  it('reproduces the figures the 30 October document had for East US 2, from a fresh fetch', () => {
    const plan = buildCostPlan(snapshot, { region: 'eastus2', profile: 'pilot' });
    expect(line(plan.lines, 'postgres').lowUsd.toFixed(2)).toBe('16.09');
    expect(line(plan.lines, 'container-app').lowUsd.toFixed(2)).toBe('10.21');
    expect(line(plan.lines, 'container-app').highUsd.toFixed(2)).toBe('34.02');
    expect(line(plan.lines, 'registry').lowUsd.toFixed(2)).toBe('5.07');
    expect(line(plan.lines, 'logs').highUsd.toFixed(2)).toBe('2.76');
  });

  it('is dearer in Central India than in East US 2, because of the database and the logs', () => {
    const india = buildCostPlan(snapshot, { region: 'centralindia', profile: 'pilot' });
    const us = buildCostPlan(snapshot, { region: 'eastus2', profile: 'pilot' });
    expect(india.infrastructure.lowUsd).toBeGreaterThan(us.infrastructure.lowUsd);
    expect(line(india.lines, 'container-app').lowUsd).toBe(line(us.lines, 'container-app').lowUsd);
  });

  it('shows the production shape costing an order of magnitude more, with its documented-not-priced parts marked', () => {
    const pilot = buildCostPlan(snapshot, { region: 'centralindia', profile: 'pilot' });
    const shaped = buildCostPlan(snapshot, {
      region: 'centralindia',
      profile: 'production-shaped',
    });
    expect(shaped.infrastructure.lowUsd).toBeGreaterThan(8 * pilot.infrastructure.lowUsd);
    expect(line(shaped.lines, 'postgres').basis).toBe('documented');
    expect(line(shaped.lines, 'postgres').arithmetic).toContain('x 2 (standby)');
    expect(shaped.lines.some((one) => one.id === 'nat-gateway')).toBe(true);
    expect(shaped.lines.some((one) => one.id === 'key-vault')).toBe(true);
  });

  it('fails loudly rather than pricing a meter the snapshot does not hold', () => {
    const empty = { ...snapshot, meters: {} };
    expect(() => buildCostPlan(empty, { region: 'centralindia', profile: 'pilot' })).toThrow(
      /no meter/u,
    );
  });
});

describe('docs/production/azure-preflight.md', () => {
  const docUrl = new URL('../../../docs/production/azure-preflight.md', import.meta.url);
  const doc = (() => {
    try {
      return readFileSync(docUrl, 'utf8');
    } catch {
      return null;
    }
  })();

  it.skipIf(doc === null)(
    'quotes the totals this code computes, so the page and the script cannot drift apart',
    () => {
      for (const region of ['centralindia', 'eastus2']) {
        const plan = buildCostPlan(snapshot, { region, profile: 'pilot' });
        expect(doc, `${region} low`).toContain(plan.infrastructure.lowUsd.toFixed(2));
        expect(doc, `${region} high`).toContain(plan.infrastructure.highUsd.toFixed(2));
      }
      const vm = buildCostPlan(snapshot, { region: 'centralindia', profile: 'pilot' }).vm;
      expect(doc).toContain(vm.monthlyUsd.toFixed(2));
      expect(doc).toContain(snapshot.retrievedOn);
      expect(doc).toContain(String(snapshot.impliedInrPerUsd.value));
      expect(doc).toContain(SNAPSHOT_PATH.pathname.split('/').pop() ?? '');
    },
  );
});
