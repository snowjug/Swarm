import { describe, expect, it } from 'vitest';
import { DEFAULT_RESEARCH_BUDGET, RESEARCH_BUDGET_CEILING } from '../../shared/research.js';
import {
  BUDGET_FLOOR,
  clampBudget,
  loadResearchConfig,
  publicResearch,
  researchEnabled,
} from '../src/research/config.js';
import { DISCOVERY_UNCONFIGURED_MESSAGE } from '../src/research/discovery.js';

describe('the settings of research', () => {
  it('start from the shared defaults and the shared ceiling, with research on and no search provider', () => {
    const config = loadResearchConfig({});
    expect(config).toEqual({
      enabled: true,
      searchProvider: 'none',
      ceiling: RESEARCH_BUDGET_CEILING,
      defaults: DEFAULT_RESEARCH_BUDGET,
      minDelayMs: 1_000,
      maxPauseMs: 300_000,
    });
  });

  it('read an empty setting as an unset one, as .env.example leaves them', () => {
    const empty = Object.fromEntries(
      [
        'RESEARCH_ENABLED',
        'RESEARCH_SEARCH_PROVIDER',
        'RESEARCH_MAX_PAGES',
        'RESEARCH_MAX_COST_USD',
        'RESEARCH_DOMAIN_DELAY_MS',
        'RESEARCH_MAX_PAUSE_SECONDS',
      ].map((name) => [name, '']),
    );
    expect(loadResearchConfig(empty)).toEqual(loadResearchConfig({}));
  });

  it.each([
    ['on', true],
    ['true', true],
    ['1', true],
    ['off', false],
    ['false', false],
    ['0', false],
  ])('switch research with %s: enabled is %s', (value, enabled) => {
    expect(loadResearchConfig({ RESEARCH_ENABLED: value }).enabled).toBe(enabled);
  });

  it('can lower a limit below the ceiling and never raise it above, and the defaults follow it down', () => {
    const lowered = loadResearchConfig({
      RESEARCH_MAX_PAGES: '5',
      RESEARCH_MAX_DOMAINS: '2',
      RESEARCH_MAX_DEPTH: '0',
      RESEARCH_MAX_SECONDS: '60',
      RESEARCH_MAX_COST_USD: '0',
      RESEARCH_MAX_TOTAL_BYTES: '2000000',
      RESEARCH_MAX_BYTES_PER_PAGE: '500000',
    });
    expect(lowered.ceiling).toMatchObject({
      maxPages: 5,
      maxDomains: 2,
      maxDepth: 0,
      maxElapsedMs: 60_000,
      maxEstimatedCostUsd: 0,
      maxTotalBytes: 2_000_000,
      maxBytesPerPage: 500_000,
    });
    expect(lowered.defaults).toMatchObject({
      maxPages: 5,
      maxDomains: 2,
      maxDepth: 0,
      maxElapsedMs: 60_000,
      maxEstimatedCostUsd: 0,
      maxTotalBytes: 2_000_000,
      maxBytesPerPage: 500_000,
    });
    for (const [name, value] of [
      ['RESEARCH_MAX_PAGES', '31'],
      ['RESEARCH_MAX_DOMAINS', '9'],
      ['RESEARCH_MAX_DEPTH', '3'],
      ['RESEARCH_MAX_SECONDS', '301'],
      ['RESEARCH_MAX_COST_USD', '2.5'],
      ['RESEARCH_MAX_TOTAL_BYTES', '20000001'],
      ['RESEARCH_DOMAIN_DELAY_MS', '10001'],
      ['RESEARCH_MAX_PAUSE_SECONDS', '421'],
    ] as const) {
      expect(() => loadResearchConfig({ [name]: value }), name).toThrow(name);
    }
  });

  it('name the setting that is wrong and never repeat its value', () => {
    for (const environment of [
      { RESEARCH_ENABLED: 'perhaps-s3cret' },
      { RESEARCH_SEARCH_PROVIDER: 'bing-s3cret' },
      { RESEARCH_MAX_PAGES: 'lots-s3cret' },
      { RESEARCH_MAX_PAUSE_SECONDS: '5' },
    ]) {
      const [name] = Object.keys(environment);
      let message = '';
      try {
        loadResearchConfig(environment);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(`Invalid research configuration: ${name}.`);
    }
  });

  it('hold a pause to the shortest and longest the job allows', () => {
    expect(loadResearchConfig({ RESEARCH_MAX_PAUSE_SECONDS: '30' }).maxPauseMs).toBe(30_000);
    expect(loadResearchConfig({ RESEARCH_MAX_PAUSE_SECONDS: '420' }).maxPauseMs).toBe(420_000);
    expect(() => loadResearchConfig({ RESEARCH_MAX_PAUSE_SECONDS: '29' })).toThrow();
  });

  it('have no setting that reads plain HTTP, a private address, or a provider that is not built', () => {
    const config = loadResearchConfig({
      RESEARCH_ALLOW_HTTP: 'true',
      RESEARCH_ALLOW_PRIVATE_NETWORK: 'true',
      RESEARCH_ALLOW_PRIVATE: '1',
    });
    expect(Object.keys(config).sort()).toEqual(
      ['ceiling', 'defaults', 'enabled', 'maxPauseMs', 'minDelayMs', 'searchProvider'].sort(),
    );
    expect(() => loadResearchConfig({ RESEARCH_SEARCH_PROVIDER: 'bing' })).toThrow(
      'RESEARCH_SEARCH_PROVIDER',
    );
  });
});

describe('the budget of one run', () => {
  const config = loadResearchConfig({ RESEARCH_DOMAIN_DELAY_MS: '3000', RESEARCH_MAX_PAGES: '20' });

  it('is the defaults when nothing more is asked', () => {
    expect(clampBudget(config)).toEqual(config.defaults);
    expect(config.defaults.perDomainDelayMs).toBe(3_000);
  });

  it('holds what a person asks for to the ceiling, and to the least a limit can be', () => {
    const budget = clampBudget(config, {
      maxPages: 1_000,
      maxDomains: 0,
      maxDepth: -4,
      maxElapsedMs: 9_999_999,
      maxEstimatedCostUsd: 99,
      maxFailedRequests: 2.9,
    });
    expect(budget).toMatchObject({
      maxPages: 20,
      maxDomains: BUDGET_FLOOR.maxDomains,
      maxDepth: BUDGET_FLOOR.maxDepth,
      maxElapsedMs: RESEARCH_BUDGET_CEILING.maxElapsedMs,
      maxEstimatedCostUsd: RESEARCH_BUDGET_CEILING.maxEstimatedCostUsd,
      maxFailedRequests: 2,
    });
  });

  it('lets a person lengthen the wait between requests to a site and never shorten the server’s', () => {
    expect(clampBudget(config, { perDomainDelayMs: 250 }).perDomainDelayMs).toBe(3_000);
    expect(clampBudget(config, { perDomainDelayMs: 5_000 }).perDomainDelayMs).toBe(5_000);
    expect(clampBudget(config, { perDomainDelayMs: 60_000 }).perDomainDelayMs).toBe(10_000);
  });

  it('keeps a fractional cost and a share, ignores what is not a number, and never lets a page exceed the total', () => {
    const budget = clampBudget(config, {
      maxEstimatedCostUsd: 0.5,
      maxDuplicateRatio: 0.25,
      maxPages: Number.NaN,
      maxDepth: Number.POSITIVE_INFINITY,
      maxBytesPerPage: 1_900_000,
      maxTotalBytes: 100_000,
    });
    expect(budget).toMatchObject({
      maxEstimatedCostUsd: 0.5,
      maxDuplicateRatio: 0.25,
      maxPages: config.defaults.maxPages,
      maxDepth: config.defaults.maxDepth,
      maxTotalBytes: 100_000,
      maxBytesPerPage: 100_000,
    });
  });
});

describe('what a server says about research', () => {
  const base = loadResearchConfig({});

  it('is enabled only when the server reads public pages at all', () => {
    expect(researchEnabled({ research: base, urlIngestion: { enabled: true } })).toBe(true);
    expect(researchEnabled({ research: base, urlIngestion: { enabled: false } })).toBe(false);
    expect(researchEnabled({ research: { enabled: false }, urlIngestion: { enabled: true } })).toBe(
      false,
    );
  });

  it('says, with the way to change it, that discovery has no provider, and shows the defaults', () => {
    const shown = publicResearch({ research: base, urlIngestion: { enabled: true } });
    expect(shown).toEqual({
      enabled: true,
      discovery: { available: false, provider: null, message: DISCOVERY_UNCONFIGURED_MESSAGE },
      budget: base.defaults,
    });
    expect(DISCOVERY_UNCONFIGURED_MESSAGE).toContain('RESEARCH_SEARCH_PROVIDER');
  });
});
