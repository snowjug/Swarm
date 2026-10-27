import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  rankCandidates,
  type CatalogModel,
  type CatalogSku,
  type RankOptions,
  type RegionCatalog,
  type UsageRecord,
} from './models.js';

const NOW = new Date('2026-06-01T00:00:00Z');

function sku(name: string, model: string, overrides: Partial<CatalogSku> = {}): CatalogSku {
  return {
    name,
    usageName: `OpenAI.${name}.${model}`,
    capacity: { minimum: 1, maximum: 1000, step: 1, default: 1 },
    ...overrides,
  };
}

function entry(
  name: string,
  overrides: Partial<CatalogModel['model']> = {},
  skus: CatalogSku[] = [sku('Standard', name)],
  kind = 'AIServices',
): CatalogModel {
  return {
    kind,
    model: {
      format: 'OpenAI',
      name,
      version: '2025-04-14',
      isDefaultVersion: true,
      lifecycleStatus: 'GenerallyAvailable',
      capabilities: { chatCompletion: 'true', inference: 'true' },
      skus,
      ...overrides,
    },
  };
}

function usage(name: string, limit: number, currentValue = 0): UsageRecord {
  return { name: { value: name }, limit, currentValue };
}

function region(name: string, models: CatalogModel[], usages: UsageRecord[] = []): RegionCatalog {
  return { region: name, models, usage: usages };
}

const base: RankOptions = {
  kind: 'AIServices',
  regions: ['eastus2', 'westus3'],
  capacity: 10,
  now: NOW,
};

describe('rankCandidates', () => {
  it('prefers the cheap non-reasoning default model over larger ones', () => {
    const { candidates } = rankCandidates(
      [
        region('eastus2', [
          entry('gpt-4o'),
          entry('gpt-4.1'),
          entry('gpt-4.1-mini'),
          entry('gpt-4o-mini'),
        ]),
      ],
      base,
    );
    expect(candidates.map((c) => c.modelName)).toEqual([
      'gpt-4.1-mini',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4o',
    ]);
  });

  it('never selects reasoning, flagship, pro or non-chat models by default', () => {
    const { candidates } = rankCandidates(
      [
        region('eastus2', [
          entry('o3-pro'),
          entry('gpt-5'),
          entry('gpt-5-pro'),
          entry('gpt-4.1-mini', { capabilities: { chatCompletion: 'false' } }),
          entry('text-embedding-3-large'),
        ]),
      ],
      base,
    );
    expect(candidates).toEqual([]);
  });

  it('honours an explicit model list in its own order and ignores the default allowlist', () => {
    const { candidates } = rankCandidates(
      [region('eastus2', [entry('gpt-4.1-mini'), entry('gpt-5-mini'), entry('gpt-4o')])],
      { ...base, modelNames: ['gpt-5-mini', 'gpt-4o'] },
    );
    expect(candidates.map((c) => c.modelName)).toEqual(['gpt-5-mini', 'gpt-4o']);
  });

  it('orders regions by the supplied preference and ignores unlisted regions', () => {
    const { candidates } = rankCandidates(
      [
        region('westus3', [entry('gpt-4.1-mini')]),
        region('brazilsouth', [entry('gpt-4.1-mini')]),
        region('eastus2', [entry('gpt-4.1-mini')]),
      ],
      base,
    );
    expect(candidates.map((c) => c.region)).toEqual(['eastus2', 'westus3']);
  });

  it('prefers regional Standard over DataZone and Global, falling back when quota is exhausted', () => {
    const models = [
      entry('gpt-4.1-mini', {}, [
        sku('GlobalStandard', 'gpt-4.1-mini'),
        sku('Standard', 'gpt-4.1-mini'),
        sku('DataZoneStandard', 'gpt-4.1-mini'),
      ]),
    ];
    const plenty = [
      usage('OpenAI.Standard.gpt-4.1-mini', 100),
      usage('OpenAI.DataZoneStandard.gpt-4.1-mini', 100),
      usage('OpenAI.GlobalStandard.gpt-4.1-mini', 100),
    ];
    expect(
      rankCandidates([region('eastus2', models, plenty)], base).candidates.map((c) => c.sku),
    ).toEqual(['Standard', 'DataZoneStandard', 'GlobalStandard']);

    const noStandard = [usage('OpenAI.Standard.gpt-4.1-mini', 50, 50), ...plenty.slice(1)];
    const result = rankCandidates([region('eastus2', models, noStandard)], base);
    expect(result.candidates.map((c) => c.sku)).toEqual(['DataZoneStandard', 'GlobalStandard']);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ sku: 'Standard', reason: 'no quota available in this region' }),
    );
  });

  it('never offers provisioned (reserved, hourly-billed) capacity', () => {
    const { candidates, rejected } = rankCandidates(
      [region('eastus2', [entry('gpt-4.1-mini', {}, [sku('ProvisionedManaged', 'gpt-4.1-mini')])])],
      base,
    );
    expect(candidates).toEqual([]);
    expect(rejected[0]?.reason).toBe('not a pay-as-you-go SKU');
  });

  it('reduces capacity to the available quota and says so', () => {
    const { candidates } = rankCandidates(
      [region('eastus2', [entry('gpt-4.1-mini')], [usage('OpenAI.Standard.gpt-4.1-mini', 6, 1)])],
      base,
    );
    expect(candidates[0]).toMatchObject({ capacity: 5, quotaAvailable: 5 });
    expect(candidates[0]?.notes).toContain('capacity reduced from 10 to 5');
  });

  it('respects the SKU capacity step and minimum', () => {
    const stepped = sku('Standard', 'gpt-4.1-mini', {
      capacity: { minimum: 5, maximum: 100, step: 5 },
    });
    const ok = rankCandidates(
      [
        region(
          'eastus2',
          [entry('gpt-4.1-mini', {}, [stepped])],
          [usage('OpenAI.Standard.gpt-4.1-mini', 13)],
        ),
      ],
      base,
    );
    expect(ok.candidates[0]?.capacity).toBe(10);

    const tooLittle = rankCandidates(
      [
        region(
          'eastus2',
          [entry('gpt-4.1-mini', {}, [stepped])],
          [usage('OpenAI.Standard.gpt-4.1-mini', 3)],
        ),
      ],
      base,
    );
    expect(tooLittle.candidates).toEqual([]);
    expect(tooLittle.rejected[0]?.reason).toContain('below the SKU minimum');
  });

  it('keeps candidates whose quota is unreported but ranks known quota first within a model', () => {
    const { candidates } = rankCandidates(
      [
        region('eastus2', [entry('gpt-4.1-mini')]),
        region('westus3', [entry('gpt-4.1-mini')], [usage('OpenAI.Standard.gpt-4.1-mini', 50)]),
      ],
      base,
    );
    expect(candidates.map((c) => c.region)).toEqual(['westus3', 'eastus2']);
    expect(candidates[1]?.quotaAvailable).toBeNull();
    expect(candidates[1]?.notes.join(' ')).toContain('quota not reported');
  });

  it('rejects models that retire within the safety window and keeps later ones', () => {
    const { candidates, rejected } = rankCandidates(
      [
        region('eastus2', [
          entry('gpt-4.1-mini', { deprecation: { inference: '2026-08-01T00:00:00Z' } }),
          entry('gpt-4o-mini', { deprecation: { inference: '2027-06-01T00:00:00Z' } }),
        ]),
      ],
      base,
    );
    expect(candidates.map((c) => c.modelName)).toEqual(['gpt-4o-mini']);
    expect(candidates[0]?.retiresOn).toBe('2027-06-01');
    expect(rejected[0]?.reason).toMatch(/retires 2026-08-01, within 120 days/);
  });

  it('rejects an SKU retiring soon even when the model itself is fine', () => {
    const soon = sku('Standard', 'gpt-4.1-mini', { deprecationDate: '2026-07-01T00:00:00Z' });
    const { candidates, rejected } = rankCandidates(
      [
        region('eastus2', [
          entry('gpt-4.1-mini', {}, [soon, sku('GlobalStandard', 'gpt-4.1-mini')]),
        ]),
      ],
      base,
    );
    expect(candidates.map((c) => c.sku)).toEqual(['GlobalStandard']);
    expect(rejected.some((r) => r.sku === 'Standard' && r.reason.startsWith('SKU retires'))).toBe(
      true,
    );
  });

  it('excludes preview models unless explicitly allowed', () => {
    const preview = [region('eastus2', [entry('gpt-4.1-mini', { lifecycleStatus: 'Preview' })])];
    expect(rankCandidates(preview, base).candidates).toEqual([]);
    expect(rankCandidates(preview, { ...base, allowPreview: true }).candidates).toHaveLength(1);
  });

  it('chooses the default version, and the newest otherwise, never an older retiring one', () => {
    const { candidates } = rankCandidates(
      [
        region('eastus2', [
          entry('gpt-4.1-mini', { version: '2025-01-01', isDefaultVersion: false }),
          entry('gpt-4.1-mini', { version: '2025-04-14', isDefaultVersion: true }),
          entry('gpt-4.1-mini', { version: '2025-09-01', isDefaultVersion: false }),
        ]),
      ],
      base,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.modelVersion).toBe('2025-04-14');
  });

  it('only returns entries for the requested account kind', () => {
    const { candidates } = rankCandidates(
      [region('eastus2', [entry('gpt-4.1-mini', {}, undefined, 'OpenAI')])],
      base,
    );
    expect(candidates).toEqual([]);
    expect(
      rankCandidates([region('eastus2', [entry('gpt-4.1-mini', {}, undefined, 'OpenAI')])], {
        ...base,
        kind: 'OpenAI',
      }).candidates,
    ).toHaveLength(1);
  });

  it('matches quota names case-insensitively', () => {
    const { candidates } = rankCandidates(
      [region('eastus2', [entry('gpt-4.1-mini')], [usage('openai.standard.GPT-4.1-MINI', 20)])],
      base,
    );
    expect(candidates[0]?.quotaAvailable).toBe(20);
  });

  it('lists a SKU the catalog repeats only once', () => {
    const twice = [
      sku('GlobalStandard', 'gpt-4.1-mini', { capacity: { maximum: 1000 } }),
      sku('GlobalStandard', 'gpt-4.1-mini', { capacity: { maximum: 10_000_000 } }),
    ];
    const { candidates } = rankCandidates(
      [region('eastus2', [entry('gpt-4.1-mini', {}, twice)])],
      base,
    );
    expect(candidates).toHaveLength(1);
  });

  it('includes Legacy and Deprecating models only when explicitly allowed', () => {
    const legacy = [
      region('eastus2', [
        entry('gpt-4.1-mini', { lifecycleStatus: 'Legacy' }),
        entry('gpt-4o-mini', { lifecycleStatus: 'Deprecating' }),
        entry('gpt-4o', { lifecycleStatus: 'Deprecated' }),
      ]),
    ];
    const strict = rankCandidates(legacy, base);
    expect(strict.candidates).toEqual([]);
    expect(strict.rejected.find((r) => r.modelName === 'gpt-4.1-mini')?.reason).toContain(
      '--allow-legacy',
    );

    const allowed = rankCandidates(legacy, { ...base, allowLegacy: true });
    expect(allowed.candidates.map((c) => c.modelName)).toEqual(['gpt-4.1-mini', 'gpt-4o-mini']);
  });
});

// Captured from the live catalog (subscription id removed) so a change in Azure's response shape
// or lifecycle vocabulary shows up as a failing test instead of a wrong deployment.
describe('rankCandidates on a real catalog excerpt', () => {
  const excerpt = JSON.parse(
    readFileSync(new URL('./fixtures/catalog-eastus2-excerpt.json', import.meta.url), 'utf8'),
  ) as { value: CatalogModel[] };
  const catalogs = [region('eastus2', excerpt.value)];
  const options: RankOptions = {
    kind: 'AIServices',
    regions: ['eastus2'],
    capacity: 10,
    now: new Date('2026-10-27T00:00:00Z'),
  };

  it('picks the current generally-available small model, not a retiring or flagship one', () => {
    const { candidates } = rankCandidates(catalogs, options);
    expect(candidates[0]).toMatchObject({ modelName: 'gpt-5.4-mini', region: 'eastus2' });
    const names = new Set(candidates.map((c) => c.modelName));
    for (const excluded of [
      'gpt-4.1-mini',
      'gpt-4o-mini',
      'gpt-5-mini',
      'gpt-5.6-sol',
      'o3',
      'claude-sonnet-5',
    ]) {
      expect(names.has(excluded)).toBe(false);
    }
  });

  it('explains each exclusion using the live lifecycle vocabulary', () => {
    const { rejected } = rankCandidates(catalogs, options);
    const reason = (name: string) => rejected.find((r) => r.modelName === name)?.reason ?? '';
    expect(reason('gpt-4.1-mini')).toMatch(/Legacy.*--allow-legacy/);
    expect(reason('gpt-4o-mini')).toMatch(/Deprecating.*--allow-legacy/);
    expect(reason('gpt-5-mini')).toMatch(/retires 2027-02-09, within 120 days/);
  });

  it('offers only pay-as-you-go SKUs, once each', () => {
    const { candidates } = rankCandidates(catalogs, options);
    const keys = candidates.map((c) => `${c.region}/${c.modelName}/${c.modelVersion}/${c.sku}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      candidates.every((c) => ['Standard', 'DataZoneStandard', 'GlobalStandard'].includes(c.sku)),
    ).toBe(true);
  });

  it('flags quota as unreported when the usage API returns nothing', () => {
    const { candidates } = rankCandidates(catalogs, options);
    expect(candidates[0]?.quotaAvailable).toBeNull();
    expect(candidates[0]?.notes.join(' ')).toContain('quota not reported');
  });

  it('prefers the legacy non-reasoning model once the operator opts in', () => {
    const { candidates } = rankCandidates(catalogs, { ...options, allowLegacy: true });
    expect(candidates[0]).toMatchObject({ modelName: 'gpt-4.1-mini', retiresOn: '2027-04-14' });
  });
});
