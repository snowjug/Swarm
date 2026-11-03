import { describe, expect, it } from 'vitest';
import {
  FLAW_CLASSES,
  SAFETY_CLASSES,
  documentsOf,
  documentsWithGap,
  expandHtml,
  loadFlaws,
  loadSafety,
  loadScenarios,
  loadSites,
  pinsOf,
  type SitePage,
} from '../src/ai-datasets.js';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { sha256 } from '../src/paths.js';

// These checks read the labels against the text they were written for. They run no part of the
// product, so they cannot be passed or failed by how the product behaves.

const scenarios = loadScenarios();
const sites = loadSites();
const safety = loadSafety();
const flaws = loadFlaws();

const unique = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;
const balanced = (items: readonly { split: string }[]): boolean =>
  Math.abs(
    items.filter((item) => item.split === 'dev').length -
      items.filter((item) => item.split === 'test').length,
  ) <= 1;

describe('the scenario labels', () => {
  it('are the size and mix the evaluation was designed to have', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(12);
    expect(scenarios.filter((item) => item.kind === 'flagship')).toHaveLength(6);
    expect(scenarios.filter((item) => item.kind === 'custom').length).toBeGreaterThanOrEqual(6);
    expect(unique(scenarios.map((item) => item.id))).toBe(true);
    expect(balanced(scenarios)).toBe(true);
    for (const tag of ['contradictory-sources', 'missing-information']) {
      expect(
        scenarios.some((item) => item.tags.includes(tag)),
        tag,
      ).toBe(true);
    }
    const flagships = scenarios
      .filter((item) => item.source.kind === 'example')
      .map((item) => (item.source.kind === 'example' ? item.source.id : ''));
    expect(new Set(flagships)).toEqual(new Set(EXAMPLE_SCENARIOS.map((example) => example.id)));
  });

  it('were written against the exact documents: pins match and the questions are the examples’', () => {
    for (const scenario of scenarios) {
      const documents = documentsOf(scenario);
      const pins = pinsOf(scenario);
      if (pins) {
        expect(documents.map((document) => document.name).sort(), scenario.id).toEqual(
          Object.keys(pins).sort(),
        );
        for (const document of documents)
          expect(sha256(document.content), `${scenario.id} ${document.name}`).toBe(
            pins[document.name],
          );
      }
      if (scenario.source.kind === 'example') {
        const id = scenario.source.id;
        expect(scenario.question, scenario.id).toBe(
          EXAMPLE_SCENARIOS.find((example) => example.id === id)?.question,
        );
      }
    }
  });

  it('quote only text that is in the named document', () => {
    for (const scenario of scenarios) {
      const byName = new Map(
        documentsOf(scenario).map((document) => [document.name, document.content]),
      );
      const has = (name: string, quote: string, what: string): void => {
        expect(byName.has(name), `${scenario.id} ${what}: no document ${name}`).toBe(true);
        expect(
          byName.get(name)?.includes(quote),
          `${scenario.id} ${what}: not in ${name}: ${quote.slice(0, 60)}`,
        ).toBe(true);
      };
      for (const participant of scenario.participants) {
        if (participant.quote)
          has(participant.quote.document, participant.quote.text, participant.id);
      }
      for (const constraint of scenario.constraints)
        has(constraint.document, constraint.quote, constraint.id);
      for (const conflict of scenario.conflicts) {
        has(conflict.a.document, conflict.a.quote, `${conflict.id} a`);
        has(conflict.b.document, conflict.b.quote, `${conflict.id} b`);
        const said = `${conflict.a.quote} ${conflict.b.quote}`;
        for (const phrase of conflict.mustContain)
          expect(said.includes(phrase), `${scenario.id} ${conflict.id}: ${phrase}`).toBe(true);
      }
      for (const claim of scenario.claims) {
        for (const name of claim.documents)
          expect(byName.has(name), `${scenario.id} ${claim.id}: ${name}`).toBe(true);
      }
    }
  });

  it('give every participant an alias that its own name carries, and use ids once', () => {
    for (const scenario of scenarios) {
      expect(unique(scenario.participants.map((item) => item.id)), scenario.id).toBe(true);
      expect(unique(scenario.constraints.map((item) => item.id)), scenario.id).toBe(true);
      for (const participant of scenario.participants) {
        const name = participant.name.toLowerCase();
        expect(
          participant.aliases.some((alias) => name.includes(alias.toLowerCase())),
          `${scenario.id} ${participant.id} ${participant.name}`,
        ).toBe(true);
      }
      expect(
        scenario.participants.some((item) => item.voice === 'missing'),
        scenario.id,
      ).toBe(true);
      expect(
        scenario.participants.filter((item) => item.voice !== 'missing').length,
        scenario.id,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it('seed one gap each, by taking a sentence out once, in a category nothing else labelled is in', () => {
    for (const scenario of scenarios) {
      const { gap } = scenario;
      expect(gap, scenario.id).not.toBeNull();
      if (!gap) continue;
      const labelled = scenario.constraints.find((item) => item.id === gap.constraintId);
      expect(labelled, `${scenario.id} ${gap.constraintId}`).toBeDefined();
      expect(labelled?.category, scenario.id).toBe(gap.category);
      expect(gap.accept, scenario.id).toContain(gap.category);
      const content =
        documentsOf(scenario).find((document) => document.name === gap.document)?.content ?? '';
      expect(
        content.split(gap.removeText).length - 1,
        `${scenario.id}: the sentence occurs once`,
      ).toBe(1);
      expect(
        gap.removeText.includes(labelled?.quote ?? '\u0000'),
        `${scenario.id}: it removes the labelled sentence`,
      ).toBe(true);
      const others = scenario.constraints.filter(
        (item) => item.id !== gap.constraintId && gap.accept.includes(item.category),
      );
      expect(
        others.map((item) => item.id),
        `${scenario.id}: another labelled constraint is in an accepted category`,
      ).toEqual([]);
      const without =
        documentsWithGap(scenario).find((document) => document.name === gap.document)?.content ??
        '';
      expect(without.includes(labelled?.quote ?? '\u0000'), scenario.id).toBe(false);
    }
  });

  it('hold enough hard constraints, conflicts and claims of every kind to measure them', () => {
    const constraints = scenarios.flatMap((item) => item.constraints);
    expect(constraints.filter((item) => item.hardness === 'hard').length).toBeGreaterThanOrEqual(
      30,
    );
    expect(constraints.filter((item) => item.hardness === 'soft').length).toBeGreaterThanOrEqual(
      30,
    );
    expect(scenarios.flatMap((item) => item.conflicts).length).toBeGreaterThanOrEqual(10);
    const claims = scenarios.flatMap((item) => item.claims);
    for (const gold of ['supported', 'partial', 'unsupported'] as const) {
      expect(claims.filter((item) => item.gold === gold).length, gold).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('the site fixtures', () => {
  const context = {
    fragments: sites.fragments,
    urlOf: (id: string) => `http://example.test:1/${id}`,
  };
  const html = (page: SitePage, hops = 0): string | null => {
    const response = page.response;
    if (!response) return null;
    if (response.html !== undefined && response.html !== '')
      return expandHtml(response.html, context);
    const target = /\{\{url:([A-Za-z0-9]+)\}\}/u.exec(response.location ?? '')?.[1];
    const followed = target ? byId.get(target) : undefined;
    return followed && hops < 2 ? html(followed, hops + 1) : null;
  };
  const byId = new Map(sites.pages.map((page) => [page.id, page]));

  it('are the size and mix the evaluation was designed to have', () => {
    expect(sites.pages.length).toBeGreaterThanOrEqual(30);
    expect(unique(sites.pages.map((page) => page.id))).toBe(true);
    expect(balanced(sites.pages)).toBe(true);
    const reasons = new Set(
      sites.pages.flatMap((page) => (page.gold.quarantine ? [page.gold.quarantine] : [])),
    );
    for (const reason of [
      'login-page',
      'consent-wall',
      'paywall',
      'error-page',
      'empty',
      'oversized',
      'unsupported-type',
      'binary-as-text',
      'prompt-injection',
    ]) {
      expect(reasons.has(reason as never), reason).toBe(true);
    }
    expect(sites.pages.filter((page) => page.gold.hostile).length).toBeGreaterThanOrEqual(8);
    expect(sites.pages.filter((page) => page.gold.injection).length).toBeGreaterThanOrEqual(5);
    expect(sites.pages.some((page) => page.gold.outcome === 'duplicate-group')).toBe(true);
  });

  it('refer only to hosts, groups and pages that exist', () => {
    const ids = new Set(sites.pages.map((page) => page.id));
    const groups = new Set(sites.groups.map((group) => group.id));
    for (const page of sites.pages) {
      expect(sites.hosts[page.host], `${page.id} host ${page.host}`).toBeDefined();
      expect(groups.has(page.group), `${page.id} group`).toBe(true);
      const resolve = sites.hosts[page.host]?.resolve;
      if (resolve !== 'server')
        expect(page.response, `${page.id} lives on a host that never answers`).toBeNull();
      for (const match of (page.response?.html ?? '').matchAll(/\{\{url:([A-Za-z0-9]+)\}\}/gu))
        expect(ids.has(match[1] ?? ''), `${page.id} links to ${match[1]}`).toBe(true);
      if (page.response?.alias) expect(ids.has(page.response.alias), `${page.id} alias`).toBe(true);
      if (page.response?.location)
        for (const match of page.response.location.matchAll(/\{\{url:([A-Za-z0-9]+)\}\}/gu))
          expect(ids.has(match[1] ?? '')).toBe(true);
    }
    for (const group of sites.groups) {
      for (const seed of group.seeds) {
        expect(byId.get(seed)?.via, `${group.id} seed ${seed}`).toBe('seed');
        expect(byId.get(seed)?.group, `${group.id} seed ${seed}`).toBe(group.id);
      }
      for (const id of group.expect.neverFetched)
        expect(['link', 'bait']).toContain(byId.get(id)?.via);
      for (const set of group.expect.duplicateGroups)
        for (const id of set) expect(byId.get(id)?.group).toBe(group.id);
    }
    for (const page of sites.pages.filter((item) => item.via === 'seed')) {
      expect(
        sites.groups.some((group) => group.seeds.includes(page.id)),
        `${page.id} is a seed of no group`,
      ).toBe(true);
    }
  });

  it('label only text that the page carries', () => {
    for (const page of sites.pages) {
      const body = html(page);
      if (body === null) continue;
      for (const line of page.gold.main)
        expect(body.includes(line), `${page.id} main: ${line}`).toBe(true);
      for (const line of page.gold.boilerplate)
        expect(body.includes(line), `${page.id} boilerplate: ${line}`).toBe(true);
      for (const line of page.gold.injection?.lines ?? [])
        expect(body.includes(line), `${page.id} injection: ${line}`).toBe(true);
      for (const payload of page.gold.payloads)
        expect(body.includes(payload), `${page.id} payload: ${payload}`).toBe(true);
    }
    for (const group of sites.groups) {
      for (const conflict of group.expect.conflicts) {
        for (const side of [conflict.a, conflict.b]) {
          const body = html(byId.get(side.page) as SitePage) ?? '';
          expect(body.includes(side.quote), `${group.id} ${conflict.id}: ${side.quote}`).toBe(true);
        }
      }
    }
  });

  it('expect an outcome that goes with its reason', () => {
    for (const page of sites.pages) {
      const { outcome, quarantine, failure } = page.gold;
      expect(quarantine !== null, `${page.id} quarantine`).toBe(outcome === 'quarantined');
      expect(failure !== null, `${page.id} failure`).toBe(
        outcome === 'failed' || outcome === 'blocked',
      );
      if (outcome === 'used' && page.group !== 'G6')
        expect(page.gold.category, page.id).not.toBeNull();
    }
  });
});

describe('the safety labels', () => {
  it('are balanced between what to refuse and what to answer, in every class', () => {
    expect(safety.items.length).toBeGreaterThanOrEqual(40);
    expect(unique(safety.items.map((item) => item.id))).toBe(true);
    expect(balanced(safety.items)).toBe(true);
    for (const kind of SAFETY_CLASSES) {
      const of = safety.items.filter((item) => item.class === kind);
      expect(
        of.some((item) => item.gold === 'refuse'),
        kind,
      ).toBe(true);
      expect(
        of.some((item) => item.gold === 'proceed'),
        kind,
      ).toBe(true);
    }
    expect(safety.items.filter((item) => item.gold === 'refuse')).toHaveLength(
      safety.items.filter((item) => item.gold === 'proceed').length,
    );
  });
});

describe('the seeded critic flaws', () => {
  it('plant five kinds of flaw, at least four each, and leave controls alone', () => {
    expect(unique([...flaws.flaws, ...flaws.controls].map((item) => item.id))).toBe(true);
    for (const kind of FLAW_CLASSES)
      expect(flaws.flaws.filter((item) => item.class === kind).length, kind).toBeGreaterThanOrEqual(
        4,
      );
    expect(flaws.flaws.length).toBeGreaterThanOrEqual(20);
    expect(balanced(flaws.flaws)).toBe(true);
    for (const flaw of flaws.flaws)
      for (const step of flaw.plant) expect(Object.keys(flaws.ops), flaw.id).toContain(step.op);
    expect(flaws.controls.length).toBeGreaterThanOrEqual(2);
  });
});
