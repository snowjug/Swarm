import type { Scenario } from './ai-datasets.js';
import {
  acceptedConstraints,
  constraintEvidence,
  constraintSourced,
  liveActors,
  liveConstraints,
  participantEvidence,
  participantSourced,
  wordsOfOutput,
} from './ai-adapt.js';
import type {
  Answer,
  CrawlObservation,
  CriticObservation,
  Reading,
  ScenarioObservation,
} from './ai-rules.js';
import { FLAG_LABEL, outcomeMap } from './ai-rules.js';
import type { Split } from './datasets.js';
import {
  actorCoverage,
  actorCoverageLenient,
  actorRedundancy,
  genericNamesAccepted,
  missingVoiceSurfaced,
  type GoldActor,
} from './measure-actors.js';
import {
  extractedLabelErrors,
  raisedCategories,
  scoreConstraints,
  scoreGaps,
  type GapReading,
  type GoldConstraintLabel,
} from './measure-constraints.js';
import { scoreCatches, scoreFalseAlarms } from './measure-critics.js';
import {
  citationCorrectness,
  groundedClaimRate,
  unsupportedClaimRate,
} from './measure-grounding.js';
import {
  carriesPayload,
  scoreClassification,
  scoreDispositions,
  scoreDiversity,
  scoreDuplicateCopies,
  scoreDuplicateGroups,
  scoreExtraction,
  scoreInjectionLabelling,
  scoreQuarantine,
  type InjectedPage,
} from './measure-sources.js';
import { pooled, rateOf, type Rate } from './measure-stats.js';

export type SplitFilter = Split | 'all';

const inSplit = (split: Split, filter: SplitFilter): boolean =>
  filter === 'all' || split === filter;

export const goldActors = (scenario: Scenario): GoldActor[] =>
  scenario.participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
    voice: participant.voice,
    aliases: participant.aliases,
  }));

export const goldConstraints = (scenario: Scenario): GoldConstraintLabel[] =>
  scenario.constraints.map((constraint) => ({
    id: constraint.id,
    category: constraint.category,
    hardness: constraint.hardness,
    document: constraint.document,
    quote: constraint.quote,
  }));

/** The answers of a reading that a proposal was made from sources for. */
const answersOf = (reading: Reading): Answer<unknown>[] => [
  reading.participants,
  reading.constraints,
];

export interface GroundingMeasures {
  grounded: Rate;
  unsupported: Rate;
  citation: Rate;
  extractedErrors: { count: number; of: number; ids: string[] };
}

/** Grounding, over every accepted output of the readings that had sources. */
export function measureGrounding(readings: readonly Reading[]): GroundingMeasures {
  const grounded: Rate[] = [];
  const unsupported: Rate[] = [];
  const citation: Rate[] = [];
  let count = 0;
  let of = 0;
  const ids: string[] = [];
  for (const reading of readings) {
    const records = reading.prepared.records;
    const participants = reading.participants.value;
    const constraints = reading.constraints.value;
    const evidence = [
      ...(participants ? participantEvidence(participants) : []),
      ...(constraints ? constraintEvidence(constraints) : []),
    ];
    const sourced = [
      ...(participants ? participantSourced(participants) : []),
      ...(constraints ? constraintSourced(constraints) : []),
    ];
    grounded.push(groundedClaimRate(evidence, records));
    citation.push(citationCorrectness(evidence, records));
    unsupported.push(unsupportedClaimRate(sourced, records));
    if (constraints) {
      const errors = extractedLabelErrors(acceptedConstraints(constraints), records);
      count += errors.count;
      of += errors.of;
      ids.push(...errors.ids);
    }
  }
  return {
    grounded: pooled(grounded),
    unsupported: pooled(unsupported),
    citation: pooled(citation),
    extractedErrors: { count, of, ids },
  };
}

export interface RulesMeasures {
  filter: SplitFilter;
  counts: { scenarios: number; pages: number; flaws: number; controls: number };
  /** Every rules answer: valid by the shared schema and the server's own checks. */
  answers: Rate;
  invalid: { where: string; error: string }[];
  /** Participant sets the product's own review would refuse to approve. */
  blockedSets: Rate;
  grounding: GroundingMeasures;
  actors: {
    coverage: Rate;
    /** Any shared content word of the name counts as a match: an upper bound on what the aliases could be hiding. */
    coverageLenient: Rate;
    missed: { scenario: string; ids: string[] }[];
    missingVoices: Rate;
    redundancy: Rate;
    repeats: { scenario: string; names: string[] }[];
    generic: { count: number; of: number; names: string[] };
  };
  constraints: {
    hardRecall: Rate;
    recall: Rate;
    categoryAgreement: Rate;
    hardnessAgreement: Rate;
    precisionAgainstLabels: Rate;
    missedHard: { scenario: string; ids: string[] }[];
    gap: {
      detected: Rate;
      detectedBecauseOfRemoval: Rate;
      viaQuestion: number;
      viaConstraint: number;
      missed: string[];
    };
  };
  noSources: {
    answers: Rate;
    participants: number;
    constraints: number;
    extractedConstraints: number;
    generic: { count: number; names: string[] };
  };
  frame: { alternatives: Rate; missed: { scenario: string; ids: string[] }[] };
  claims: { accuracy: Rate; unsupportedAccepted: Rate; falseAlarm: Rate };
  contradictions: { recall: Rate; detections: number; unmatched: string[] };
  crawl: {
    dispositions: ReturnType<typeof scoreDispositions>;
    quarantine: ReturnType<typeof scoreQuarantine>;
    classification: ReturnType<typeof scoreClassification>;
    extraction: ReturnType<typeof scoreExtraction>;
    injection: ReturnType<typeof scoreInjectionLabelling>;
  };
  /** Measured over a whole group, which has no split: present only for `all`. */
  groups: {
    diversity: ReturnType<typeof scoreDiversity>;
    duplicates: Rate;
    duplicateCopies: Rate;
    uncollapsed: { original: string; copy: string; bits: number }[];
    baitFetched: { group: string; page: string }[];
    /** Addresses that only an injected page names, which the labels say must not be fetched. */
    baitOf: number;
    payloadEchoes: { count: number; of: number; where: string[] };
    conflicts: { recall: Rate; detections: number; unmatched: string[] };
    derivedAnswers: Rate;
    derivedGrounding: GroundingMeasures;
  } | null;
  critics: {
    catches: ReturnType<typeof scoreCatches>;
    falseAlarms: ReturnType<typeof scoreFalseAlarms>;
  };
}

export function measureRules(
  scenarios: readonly ScenarioObservation[],
  crawl: CrawlObservation,
  critics: CriticObservation,
  filter: SplitFilter,
): RulesMeasures {
  const own = scenarios.filter((item) => inSplit(item.scenario.split, filter));
  const full = own.map((item) => ({ item, reading: item.full }));
  const withSources = own.flatMap((item) => [item.full, ...(item.gap ? [item.gap] : [])]);

  const answers: Rate[] = [];
  const invalid: RulesMeasures['invalid'] = [];
  const note = (where: string, reading: Reading): void => {
    for (const [kind, answer] of [
      ['participants', reading.participants],
      ['constraints', reading.constraints],
    ] as const) {
      answers.push(rateOf(answer.valid ? 1 : 0, 1));
      if (!answer.valid)
        invalid.push({ where: `${where} ${kind}`, error: answer.error ?? 'invalid' });
    }
  };
  for (const item of own) {
    note(`${item.scenario.id} full`, item.full);
    if (item.gap) note(`${item.scenario.id} gap`, item.gap);
    note(`${item.scenario.id} no-sources`, item.noSources);
  }
  if (filter === 'all')
    for (const derived of crawl.derived) note(`${derived.id} crawled`, derived.reading);

  const coverage: Rate[] = [];
  const missingVoices: Rate[] = [];
  const redundancy: Rate[] = [];
  const missed: RulesMeasures['actors']['missed'] = [];
  const repeats: RulesMeasures['actors']['repeats'] = [];
  const genericNames: string[] = [];
  let genericOf = 0;
  const lenient: Rate[] = [];
  const blocked: Rate[] = [];
  for (const { item, reading } of full) {
    const gold = goldActors(item.scenario);
    const live = reading.participants.value ? liveActors(reading.participants.value) : [];
    const covered = actorCoverage(gold, live);
    coverage.push(covered);
    lenient.push(actorCoverageLenient(gold, live));
    if (covered.missed.length > 0) missed.push({ scenario: item.scenario.id, ids: covered.missed });
    missingVoices.push(missingVoiceSurfaced(gold, live));
    const repeated = actorRedundancy(gold, live);
    redundancy.push(repeated);
    if (repeated.repeats.length > 0)
      repeats.push({ scenario: item.scenario.id, names: repeated.repeats });
    if (reading.blocking !== null) blocked.push(rateOf(reading.blocking > 0 ? 1 : 0, 1));
  }
  const everyReading: Reading[] = [
    ...own.flatMap((item) => [item.full, item.noSources, ...(item.gap ? [item.gap] : [])]),
    ...(filter === 'all' ? crawl.derived.map((derived) => derived.reading) : []),
  ];
  for (const reading of everyReading) {
    const live = reading.participants.value ? liveActors(reading.participants.value) : [];
    const found = genericNamesAccepted(live);
    genericNames.push(...found.names);
    genericOf += live.length;
  }

  const hardRecall: Rate[] = [];
  const recall: Rate[] = [];
  const categoryAgreement: Rate[] = [];
  const hardnessAgreement: Rate[] = [];
  const precision: Rate[] = [];
  const missedHard: RulesMeasures['constraints']['missedHard'] = [];
  for (const { item, reading } of full) {
    const accepted = reading.constraints.value
      ? acceptedConstraints(reading.constraints.value)
      : [];
    const scores = scoreConstraints(goldConstraints(item.scenario), accepted);
    hardRecall.push(scores.hardRecall);
    recall.push(scores.recall);
    categoryAgreement.push(scores.categoryAgreement);
    hardnessAgreement.push(scores.hardnessAgreement);
    precision.push(scores.precisionAgainstLabels);
    if (scores.missedHard.length > 0)
      missedHard.push({ scenario: item.scenario.id, ids: scores.missedHard });
  }

  const readings: GapReading[] = own.flatMap((item) => {
    if (!item.scenario.gap || !item.gap) return [];
    const reading = (set: Reading): Pick<GapReading, 'constraints' | 'questions'> => ({
      constraints: set.constraints.value
        ? liveConstraints(set.constraints.value).map((constraint) => ({
            category: constraint.category,
            source: constraint.source,
          }))
        : [],
      questions: set.constraints.value
        ? set.constraints.value.clarifications.map((question) => ({
            category: question.category,
            status: question.status,
          }))
        : [],
    });
    const seeded = reading(item.gap);
    return [
      {
        id: item.scenario.id,
        accept: item.scenario.gap.accept,
        ...seeded,
        raisedWithoutGap: raisedCategories(reading(item.full)),
      },
    ];
  });

  const claims = own.flatMap((item) => (item.claims ? [item.claims] : []));
  const confusion = (
    gold: 'supported' | 'partial' | 'unsupported',
    predicted: 'supported' | 'partial' | 'unsupported',
  ): number => claims.reduce((sum, metrics) => sum + metrics.confusion[gold][predicted], 0);
  const total = claims.reduce((sum, metrics) => sum + metrics.claims, 0);
  const goldSupported = (['supported', 'partial', 'unsupported'] as const).reduce(
    (sum, predicted) => sum + confusion('supported', predicted),
    0,
  );
  const goldUnsupported = (['supported', 'partial', 'unsupported'] as const).reduce(
    (sum, predicted) => sum + confusion('unsupported', predicted),
    0,
  );

  const detections = own.reduce((sum, item) => sum + item.contradictions.detections, 0);
  const pages = crawl.pages.filter((record) => inSplit(record.split, filter));
  const pairs = pages.map((record) => record.pair);
  const injected: InjectedPage[] = pages.flatMap((record) =>
    record.injection && record.pair.seen.outcome === 'used'
      ? [
          {
            id: record.pair.gold.id,
            expected: record.injection.expected,
            lines: record.injection.lines,
            text: record.pair.seen.text,
          },
        ]
      : [],
  );

  let groups: RulesMeasures['groups'] = null;
  if (filter === 'all') {
    const multi = crawl.runs.find((run) => run.group.id === 'G1');
    const duplicateRuns = crawl.runs.find((run) => run.group.id === 'G6');
    const injectedRun = crawl.derived.find((derived) => derived.id === 'G4');
    const payloads = pages.flatMap((record) => record.payloads);
    const echoes: string[] = [];
    if (injectedRun) {
      const text = [injectedRun.reading.participants.value, injectedRun.reading.constraints.value]
        .map(wordsOfOutput)
        .join(' ');
      for (const payload of payloads) if (carriesPayload(text, payload)) echoes.push(payload);
    }
    const g1 = crawl.derived.find((derived) => derived.id === 'G1');
    groups = {
      diversity: scoreDiversity(
        multi
          ? multi.result.pages.map((page) => ({
              url: page.source.finalUrl ?? page.source.requestedUrl,
              passages: page.source.passageCount,
            }))
          : [],
      ),
      duplicates: duplicateRuns
        ? scoreDuplicateGroups(
            duplicateRuns.group.expect.duplicateGroups,
            outcomeMap(crawl.pages.filter((record) => record.group === 'G6')),
          )
        : rateOf(0, 0),
      duplicateCopies: duplicateRuns
        ? scoreDuplicateCopies(
            duplicateRuns.group.expect.duplicateGroups,
            outcomeMap(crawl.pages.filter((record) => record.group === 'G6')),
          )
        : rateOf(0, 0),
      uncollapsed: crawl.uncollapsed,
      baitFetched: crawl.fetchedAgainstExpectation.filter((item) => item.group === 'G4'),
      baitOf:
        crawl.runs.find((run) => run.group.id === 'G4')?.group.expect.neverFetched.length ?? 0,
      payloadEchoes: { count: echoes.length, of: payloads.length, where: echoes },
      conflicts: {
        recall: rateOf(crawl.contradictions.found, crawl.contradictions.expected),
        detections: crawl.contradictions.detections,
        unmatched: crawl.contradictions.unmatched,
      },
      derivedAnswers: pooled(
        crawl.derived.flatMap((derived) =>
          answersOf(derived.reading).map((answer) => rateOf(answer.valid ? 1 : 0, 1)),
        ),
      ),
      derivedGrounding: measureGrounding(
        g1 ? [g1.reading, ...(injectedRun ? [injectedRun.reading] : [])] : [],
      ),
    };
  }

  const critic = {
    runs: critics.runs.filter((run) => inSplit(run.split, filter)),
    controls: critics.controls.filter((control) => inSplit(control.split, filter)),
  };

  return {
    filter,
    counts: {
      scenarios: own.length,
      pages: pages.length,
      flaws: critic.runs.length,
      controls: critic.controls.length,
    },
    answers: pooled(answers),
    invalid,
    blockedSets: pooled(blocked),
    grounding: measureGrounding([
      ...withSources,
      ...(filter === 'all' ? crawl.derived.map((derived) => derived.reading) : []),
    ]),
    actors: {
      coverage: pooled(coverage),
      coverageLenient: pooled(lenient),
      missed,
      missingVoices: pooled(missingVoices),
      redundancy: pooled(redundancy),
      repeats,
      generic: { count: genericNames.length, of: genericOf, names: genericNames },
    },
    constraints: {
      hardRecall: pooled(hardRecall),
      recall: pooled(recall),
      categoryAgreement: pooled(categoryAgreement),
      hardnessAgreement: pooled(hardnessAgreement),
      precisionAgainstLabels: pooled(precision),
      missedHard,
      gap: scoreGaps(readings),
    },
    noSources: {
      answers: pooled(
        own.flatMap((item) =>
          answersOf(item.noSources).map((answer) => rateOf(answer.valid ? 1 : 0, 1)),
        ),
      ),
      participants: own.reduce(
        (sum, item) =>
          sum +
          (item.noSources.participants.value
            ? liveActors(item.noSources.participants.value).length
            : 0),
        0,
      ),
      constraints: own.reduce(
        (sum, item) =>
          sum +
          (item.noSources.constraints.value
            ? liveConstraints(item.noSources.constraints.value).length
            : 0),
        0,
      ),
      extractedConstraints: own.reduce(
        (sum, item) =>
          sum +
          (item.noSources.constraints.value
            ? liveConstraints(item.noSources.constraints.value).filter(
                (constraint) => constraint.source === 'extracted',
              ).length
            : 0),
        0,
      ),
      generic: {
        count: own.reduce(
          (sum, item) =>
            sum +
            (item.noSources.participants.value
              ? genericNamesAccepted(liveActors(item.noSources.participants.value)).count
              : 0),
          0,
        ),
        names: own.flatMap((item) =>
          item.noSources.participants.value
            ? genericNamesAccepted(liveActors(item.noSources.participants.value)).names
            : [],
        ),
      },
    },
    frame: {
      alternatives: rateOf(
        own.reduce((sum, item) => sum + item.alternatives.found, 0),
        own.reduce((sum, item) => sum + item.alternatives.gold, 0),
      ),
      missed: own
        .filter((item) => item.alternatives.missed.length > 0)
        .map((item) => ({ scenario: item.scenario.id, ids: item.alternatives.missed })),
    },
    claims: {
      accuracy: rateOf(
        confusion('supported', 'supported') +
          confusion('partial', 'partial') +
          confusion('unsupported', 'unsupported'),
        total,
      ),
      unsupportedAccepted: rateOf(confusion('unsupported', 'supported'), goldUnsupported),
      falseAlarm: rateOf(confusion('supported', 'unsupported'), goldSupported),
    },
    contradictions: {
      recall: rateOf(
        own.reduce((sum, item) => sum + item.contradictions.found, 0),
        own.reduce((sum, item) => sum + item.contradictions.expected, 0),
      ),
      detections,
      unmatched: own.flatMap((item) =>
        item.contradictions.unmatched.map((line) => `${item.scenario.id}: ${line}`),
      ),
    },
    crawl: {
      dispositions: scoreDispositions(pairs),
      quarantine: scoreQuarantine(pairs),
      classification: scoreClassification(pairs),
      extraction: scoreExtraction(pairs),
      injection: scoreInjectionLabelling(injected, FLAG_LABEL),
    },
    groups,
    critics: {
      catches: scoreCatches(critic.runs),
      falseAlarms: scoreFalseAlarms(critic.controls),
    },
  };
}
