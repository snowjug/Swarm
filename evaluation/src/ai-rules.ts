import { proposeConstraints } from '../../backend/src/constraints/propose.js';
import { distance, fingerprint } from '../../backend/src/research/crawler/dedupe.js';
import { detectContradictions } from '../../backend/src/grounding/contradictions.js';
import { FLAG_LABEL } from '../../backend/src/research/extract/index.js';
import { proposeParticipants } from '../../backend/src/stakeholders/participants/propose.js';
import {
  reviewContext,
  reviewParticipants,
} from '../../backend/src/stakeholders/participants/validate.js';
import { constraintSetSchema, type ConstraintSet } from '../../shared/constraints.js';
import { stakeholderSetSchema, type StakeholderSet } from '../../shared/stakeholders.js';
import { runRuleCritics } from '../../backend/src/critics/rules.js';
import { measureClaims } from './measure.js';
import { runGroup, type GroupRun } from './ai-crawl.js';
import {
  loadFlaws,
  loadScenarios,
  loadSites,
  type Scenario,
  type SeededFlaw,
  type SiteSet,
} from './ai-datasets.js';
import { prepare, prepareFrom, type Prepared } from './ai-corpus.js';
import { critiquesOf, plant, unflawedInput } from './ai-flaws.js';
import { startSiteWorld } from './ai-fixtures.js';
import type { Split } from './datasets.js';
import type { FlawRun } from './measure-critics.js';
import type { ObservedOutcome, PageLabel, PageObservation, Pair } from './measure-sources.js';

const NOW = new Date('2026-11-03T09:00:00.000Z');

/** What a rules path answered, and whether the answer is one the product's own checks accept. */
export interface Answer<T> {
  valid: boolean;
  /** `FALLBACK_INVALID`, `SCHEMA`, or the error that was thrown; null when valid. */
  error: string | null;
  value: T | null;
  ms: number;
}

const errorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'THROWN';

export async function askParticipants(prepared: Prepared): Promise<Answer<StakeholderSet>> {
  const started = performance.now();
  try {
    const result = await proposeParticipants({
      context: prepared.context,
      model: null,
      modelName: null,
      signal: new AbortController().signal,
      now: () => NOW,
    });
    const valid = stakeholderSetSchema.safeParse(result.set).success;
    return {
      valid,
      error: valid ? null : 'SCHEMA',
      value: result.set,
      ms: performance.now() - started,
    };
  } catch (error) {
    return { valid: false, error: errorCode(error), value: null, ms: performance.now() - started };
  }
}

export async function askConstraints(prepared: Prepared): Promise<Answer<ConstraintSet>> {
  const started = performance.now();
  try {
    const result = await proposeConstraints({
      existing: null,
      context: prepared.discovery,
      mode: 'rules',
      model: null,
      modelName: null,
      signal: new AbortController().signal,
      revisions: { scenario: 0, actors: 0 },
      assumptionIds: new Set(),
      now: NOW,
    });
    const valid = constraintSetSchema.safeParse(result.set).success;
    return {
      valid,
      error: valid ? null : 'SCHEMA',
      value: result.set,
      ms: performance.now() - started,
    };
  } catch (error) {
    return { valid: false, error: errorCode(error), value: null, ms: performance.now() - started };
  }
}

export interface Reading {
  prepared: Prepared;
  participants: Answer<StakeholderSet>;
  constraints: Answer<ConstraintSet>;
  /** The product's own review of the participants it proposed: blocking issues stop an approval. */
  blocking: number | null;
}

async function read(scenarioQuestion: Prepared): Promise<Reading> {
  const participants = await askParticipants(scenarioQuestion);
  const constraints = await askConstraints(scenarioQuestion);
  const review = participants.value
    ? reviewParticipants(
        participants.value,
        reviewContext({
          passages: scenarioQuestion.passages,
          graph: null,
          scenario: scenarioQuestion.frame,
          question: scenarioQuestion.question,
        }),
      )
    : null;
  return {
    prepared: scenarioQuestion,
    participants,
    constraints,
    blocking: review ? review.counts.blocking : null,
  };
}

export interface ContradictionReading {
  expected: number;
  found: number;
  detections: number;
  /** Detections no label accounts for; the labels are not a list of every conflict a text holds. */
  unmatched: string[];
}

export interface ScenarioObservation {
  scenario: Scenario;
  full: Reading;
  /** The same documents with the sentence of one labelled constraint taken out. */
  gap: Reading | null;
  noSources: Reading;
  alternatives: { gold: number; found: number; missed: string[] };
  /** The product's own claim check against the labelled claims. */
  claims: ReturnType<typeof measureClaims> | null;
  contradictions: ContradictionReading;
}

function readAlternatives(
  scenario: Scenario,
  prepared: Prepared,
): ScenarioObservation['alternatives'] {
  const text = prepared.frame.alternatives
    .map((alternative) =>
      [
        alternative.label,
        alternative.description,
        ...alternative.changes.map(
          (change) => `${change.name} ${change.from ?? ''} ${change.to ?? ''}`,
        ),
      ].join(' '),
    )
    .join(' ')
    .toLowerCase();
  const missed = scenario.alternatives
    .filter((alternative) => !alternative.cues.some((cue) => text.includes(cue.toLowerCase())))
    .map((alternative) => alternative.id);
  return {
    gold: scenario.alternatives.length,
    found: scenario.alternatives.length - missed.length,
    missed,
  };
}

function readClaims(scenario: Scenario, prepared: Prepared): ScenarioObservation['claims'] {
  if (scenario.claims.length === 0) return null;
  return measureClaims(
    {
      version: 1,
      claims: scenario.claims.map((claim) => ({
        id: claim.id,
        split: scenario.split,
        kind: 'extracted-claim' as const,
        documents: claim.documents,
        gold: claim.gold,
        text: claim.statement,
      })),
    },
    prepared.passages,
    'all',
  );
}

function readContradictions(scenario: Scenario, prepared: Prepared): ContradictionReading {
  const detections = detectContradictions(prepared.passages, NOW);
  const textOf = (detection: (typeof detections)[number]): string =>
    `${detection.left.quote ?? ''} ${detection.right.quote ?? ''}`.toLowerCase();
  const matches = (
    expected: Scenario['conflicts'][number],
    detection: (typeof detections)[number],
  ): boolean =>
    [detection.left.documentName, detection.right.documentName].sort().join('|') ===
      [expected.a.document, expected.b.document].sort().join('|') &&
    expected.mustContain.every((phrase) => textOf(detection).includes(phrase.toLowerCase()));
  const found = scenario.conflicts.filter((expected) =>
    detections.some((detection) => matches(expected, detection)),
  );
  return {
    expected: scenario.conflicts.length,
    found: found.length,
    detections: detections.length,
    unmatched: detections
      .filter((detection) => !scenario.conflicts.some((expected) => matches(expected, detection)))
      .map(
        (detection) =>
          `${detection.left.documentName} ~ ${detection.right.documentName}: ${detection.topic}`,
      ),
  };
}

export async function observeScenario(scenario: Scenario): Promise<ScenarioObservation> {
  const full = prepare(scenario, 'full');
  const noSources = prepare(scenario, 'no-sources');
  return {
    scenario,
    full: await read(full),
    gap: scenario.gap ? await read(prepare(scenario, 'gap')) : null,
    noSources: await read(noSources),
    alternatives: readAlternatives(scenario, full),
    claims: readClaims(scenario, full),
    contradictions: readContradictions(scenario, full),
  };
}

export async function observeScenarios(): Promise<ScenarioObservation[]> {
  const observations: ScenarioObservation[] = [];
  for (const scenario of loadScenarios()) observations.push(await observeScenario(scenario));
  return observations;
}

// ---------------------------------------------------------------------------------------------
// The crawler
// ---------------------------------------------------------------------------------------------

export interface PageRecord {
  pair: Pair;
  split: Split;
  group: string;
  hostile: boolean;
  injection: SiteSet['pages'][number]['gold']['injection'];
  payloads: string[];
}

export interface CrawlObservation {
  runs: GroupRun[];
  pages: PageRecord[];
  /** The projects made from what the crawl read: research on the library question, and the injected pages. */
  derived: { id: string; reading: Reading }[];
  /** Detections among the documents of the multi-site group, against the group's labelled conflicts. */
  contradictions: ContradictionReading;
  /** Pages of a group's `neverFetched` the fixture server was asked for. */
  fetchedAgainstExpectation: { group: string; page: string }[];
  /** Copies the labels name that were read as separate sources, and how far their fingerprint is from the original's. */
  uncollapsed: { original: string; copy: string; bits: number }[];
  elapsedMs: number;
}

const LIBRARY_QUESTION =
  'What could happen if the Ostrand public library changes its opening hours?';

const labelOf = (page: SiteSet['pages'][number]): PageLabel => ({
  id: page.id,
  outcome: page.gold.outcome,
  quarantine: page.gold.quarantine,
  failure: page.gold.failure,
  category: page.gold.category,
  authority: page.gold.authority,
  hostile: page.gold.hostile,
  main: page.gold.main,
  boilerplate: page.gold.boilerplate,
});

const usedDocuments = (run: GroupRun): { name: string; content: string; url: string }[] =>
  run.result.pages.map((page) => {
    const fixtureId = [...run.observations.entries()].find(
      ([, seen]) => seen.outcome === 'used' && seen.text === page.document.text,
    )?.[0];
    return {
      name: fixtureId ?? page.source.id,
      content: page.document.text,
      url: page.source.finalUrl ?? page.source.requestedUrl,
    };
  });

export async function observeCrawl(sites: SiteSet = loadSites()): Promise<CrawlObservation> {
  const world = await startSiteWorld(sites);
  const started = Date.now();
  try {
    const runs: GroupRun[] = [];
    for (const group of sites.groups) runs.push(await runGroup(world, sites, group));
    const pages: PageRecord[] = [];
    for (const run of runs) {
      for (const page of sites.pages.filter((item) => item.group === run.group.id)) {
        const seen = run.observations.get(page.id) as PageObservation;
        pages.push({
          pair: { gold: labelOf(page), seen },
          split: page.split,
          group: run.group.id,
          hostile: page.gold.hostile,
          injection: page.gold.injection,
          payloads: page.gold.payloads,
        });
      }
    }
    const derived: CrawlObservation['derived'] = [];
    for (const id of ['G1', 'G4']) {
      const run = runs.find((item) => item.group.id === id);
      if (!run) continue;
      const documents = usedDocuments(run).map(({ name, content }) => ({ name, content }));
      derived.push({
        id,
        reading: await read(prepareFrom(LIBRARY_QUESTION, documents, 'full')),
      });
    }
    const multi = runs.find((item) => item.group.id === 'G1');
    const contradictions: ContradictionReading = (() => {
      if (!multi) return { expected: 0, found: 0, detections: 0, unmatched: [] };
      const chunks = prepareFrom(LIBRARY_QUESTION, usedDocuments(multi), 'full').passages;
      const detections = detectContradictions(chunks, NOW);
      const textOf = (detection: (typeof detections)[number]): string =>
        `${detection.left.quote ?? ''} ${detection.right.quote ?? ''}`.toLowerCase();
      const expected = multi.group.expect.conflicts;
      const matches = (
        want: (typeof expected)[number],
        detection: (typeof detections)[number],
      ): boolean =>
        [detection.left.documentName, detection.right.documentName].sort().join('|') ===
          [want.a.page, want.b.page].sort().join('|') &&
        want.mustContain.every((phrase) => textOf(detection).includes(phrase.toLowerCase()));
      return {
        expected: expected.length,
        found: expected.filter((want) => detections.some((detection) => matches(want, detection)))
          .length,
        detections: detections.length,
        unmatched: detections
          .filter((detection) => !expected.some((want) => matches(want, detection)))
          .map(
            (detection) =>
              `${detection.left.documentName} ~ ${detection.right.documentName}: ${detection.topic}`,
          ),
      };
    })();
    const copies: CrawlObservation['uncollapsed'] = [];
    const duplicateRun = runs.find((run) => run.group.id === 'G6');
    for (const group of duplicateRun?.group.expect.duplicateGroups ?? []) {
      const seen = group.map((id) => ({ id, seen: duplicateRun?.observations.get(id) }));
      const original = seen.find((item) => item.seen?.outcome === 'used');
      const base = original?.seen?.text ? fingerprint(original.seen.text) : null;
      for (const item of seen) {
        if (item === original || item.seen?.outcome !== 'used' || !item.seen.text || !base)
          continue;
        const print = fingerprint(item.seen.text);
        if (print)
          copies.push({ original: original?.id ?? '', copy: item.id, bits: distance(base, print) });
      }
    }
    return {
      runs,
      pages,
      derived,
      contradictions,
      uncollapsed: copies,
      fetchedAgainstExpectation: runs.flatMap((run) =>
        run.fetchedAgainstExpectation.map((page) => ({ group: run.group.id, page })),
      ),
      elapsedMs: Date.now() - started,
    };
  } finally {
    await world.close();
  }
}

export const outcomeMap = (records: readonly PageRecord[]): Map<string, ObservedOutcome> =>
  new Map(records.map((record) => [record.pair.gold.id, record.pair.seen.outcome]));

// ---------------------------------------------------------------------------------------------
// The rule critics
// ---------------------------------------------------------------------------------------------

export interface CriticObservation {
  runs: (FlawRun & { split: Split })[];
  controls: {
    id: string;
    split: Split;
    baseline: ReturnType<typeof runRuleCritics>;
    changed: ReturnType<typeof runRuleCritics>;
  }[];
}

export function observeCritics(): CriticObservation {
  const file = loadFlaws();
  const baseline = critiquesOf(unflawedInput());
  const run = (flaw: SeededFlaw): FlawRun & { split: Split } => ({
    id: flaw.id,
    split: flaw.split,
    class: flaw.class,
    roles: flaw.expect.roles,
    targetKinds: flaw.expect.targetKinds,
    baseline,
    flawed: critiquesOf(plant(unflawedInput(), flaw.plant)),
  });
  return {
    runs: file.flaws.map(run),
    controls: file.controls.map((control) => ({
      id: control.id,
      split: control.split,
      baseline,
      changed: critiquesOf(plant(unflawedInput(), control.plant)),
    })),
  };
}

export { FLAG_LABEL };
