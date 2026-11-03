import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ConstraintSet } from '../../shared/constraints.js';
import { proposeConstraints } from '../../backend/src/constraints/propose.js';
import type { JsonOptions, ModelGateway } from '../../backend/src/models/client.js';
import { acceptedConstraints, liveConstraints } from '../src/ai-adapt.js';
import { prepare } from '../src/ai-corpus.js';
import { loadScenarios, type Scenario } from '../src/ai-datasets.js';
import { goldConstraints } from '../src/ai-measure-rules.js';
import { askConstraints } from '../src/ai-rules.js';
import { cleanConstraints } from '../src/ai-scripts.js';
import {
  raisedCategories,
  scoreConstraints,
  scoreGaps,
  statesLabel,
  type AcceptedConstraint,
  type GapReading,
  type GoldConstraintLabel,
} from '../src/measure-constraints.js';
import { rateOf, type Rate } from '../src/measure-stats.js';

/**
 * What the constraint rules and the reading of a model's reply do on the DEV split of the scenario
 * dataset, with the precision of hardness measured beside its recall: a change that makes a constraint
 * hard for words that do not state a limit raises recall and costs a person a run that a hard legal or
 * safety constraint can block, so recall is never reported without it.
 *
 * Only dev scenarios are read here. The test split is for one look at the end of the work, by the
 * harness's own report, and never for tuning.
 */

export interface HardPrecision {
  /**
   * Of the accepted constraints held hard, the share that state a sentence labelled hard. One that states
   * no labelled sentence counts against it, because the labels are not a list of every limit a text
   * holds: this is a lower bound.
   */
  strict: Rate;
  /** Of the held hard that state a labelled sentence, the share whose sentence is labelled hard. */
  againstLabels: Rate;
  /** Held hard, stating a sentence labelled soft: a wish, a possibility or a fact held as a limit. */
  falseHard: string[];
  /** Held hard, stating no labelled sentence: to be read by a person before they are called right or wrong. */
  unlabelled: string[];
}

export function scoreHardPrecision(
  labels: readonly GoldConstraintLabel[],
  accepted: readonly AcceptedConstraint[],
): HardPrecision {
  const held = accepted.filter((item) => item.hardness === 'hard');
  const stated = (item: AcceptedConstraint) => labels.filter((label) => statesLabel(label, item));
  const onHard = held.filter((item) => stated(item).some((label) => label.hardness === 'hard'));
  const onLabelled = held.filter((item) => stated(item).length > 0);
  return {
    strict: rateOf(onHard.length, held.length),
    againstLabels: rateOf(onHard.length, onLabelled.length),
    falseHard: held
      .filter((item) => stated(item).length > 0 && !onHard.includes(item))
      .map((item) => item.id),
    unlabelled: held.filter((item) => stated(item).length === 0).map((item) => item.id),
  };
}

describe('hard-label precision', () => {
  const label = (id: string, hardness: 'hard' | 'soft', quote: string): GoldConstraintLabel => ({
    id,
    category: 'operational',
    hardness,
    document: 'a.md',
    quote,
  });
  const item = (id: string, hardness: 'hard' | 'soft', quote: string): AcceptedConstraint => ({
    id,
    category: 'operational',
    hardness,
    source: 'extracted',
    evidence: [
      {
        passageId: 'S1',
        documentId: 'D1',
        documentName: 'a.md',
        quote,
        start: 0,
        end: quote.length,
      },
    ],
  });

  it('counts what is held hard against what is labelled hard, and says what it cannot judge', () => {
    const must = 'Every member of staff must wear a badge at all times in the shop.';
    const wish = 'Residents asked that the swimming pool stay open until nine at night.';
    const cap = 'Deliveries to the loading bay may not exceed three vans in one day.';
    const labels = [label('a', 'hard', must), label('b', 'soft', wish), label('c', 'hard', cap)];
    const accepted = [
      item('x', 'hard', must),
      item('y', 'hard', wish),
      item('z', 'soft', cap),
      item('w', 'hard', 'The kiln must be switched off by the last person to leave the unit.'),
    ];
    const precision = scoreHardPrecision(labels, accepted);
    // Held hard: x, y, w. Labelled hard: x only; y states a soft label; w states none.
    expect([precision.strict.successes, precision.strict.total]).toEqual([1, 3]);
    expect([precision.againstLabels.successes, precision.againstLabels.total]).toEqual([1, 2]);
    expect(precision.falseHard).toEqual(['y']);
    expect(precision.unlabelled).toEqual(['w']);
    // Recall is the harness's own: of the two labelled hard, x is found hard and z is found soft.
    expect(scoreConstraints(labels, accepted).hardRecall.successes).toBe(1);
  });

  it('is undefined, not perfect, when nothing is held hard', () => {
    expect(scoreHardPrecision([], []).strict.rate).toBeNull();
  });
});

const dev: Scenario[] = loadScenarios().filter((scenario) => scenario.split === 'dev');

interface Totals {
  hardRecall: Rate;
  recall: Rate;
  precision: HardPrecision;
}

function totalsOf(read: { scenario: Scenario; set: ConstraintSet | null }[]): Totals {
  const hard = { found: 0, of: 0 };
  const any = { found: 0, of: 0 };
  const strict = { right: 0, held: 0 };
  const against = { right: 0, labelled: 0 };
  const falseHard: string[] = [];
  const unlabelled: string[] = [];
  for (const { scenario, set } of read) {
    const labels = goldConstraints(scenario);
    const accepted = set ? acceptedConstraints(set) : [];
    const scores = scoreConstraints(labels, accepted);
    hard.found += scores.hardRecall.successes;
    hard.of += scores.hardRecall.total;
    any.found += scores.recall.successes;
    any.of += scores.recall.total;
    const precision = scoreHardPrecision(labels, accepted);
    strict.right += precision.strict.successes;
    strict.held += precision.strict.total;
    against.right += precision.againstLabels.successes;
    against.labelled += precision.againstLabels.total;
    falseHard.push(...precision.falseHard.map((id) => `${scenario.id} ${id}`));
    unlabelled.push(...precision.unlabelled.map((id) => `${scenario.id} ${id}`));
  }
  return {
    hardRecall: rateOf(hard.found, hard.of),
    recall: rateOf(any.found, any.of),
    precision: {
      strict: rateOf(strict.right, strict.held),
      againstLabels: rateOf(against.right, against.labelled),
      falseHard,
      unlabelled,
    },
  };
}

/** A model that proposes every labelled constraint with its labelled hardness, as the fake mode's clean reply does. */
const gatewayFor = (scenario: Scenario): ModelGateway => ({
  json: async <T>(
    schema: z.ZodType<T>,
    _instructions: string,
    _data: unknown,
    _signal: AbortSignal,
    _max?: number,
    _options?: JsonOptions<T>,
  ): Promise<T> => schema.parse(cleanConstraints(scenario, prepare(scenario, 'full'))),
});

describe('the dev split', () => {
  it('has scenarios to read, and only dev ones are read here', () => {
    expect(dev.length).toBeGreaterThanOrEqual(6);
    expect(dev.every((scenario) => scenario.split === 'dev')).toBe(true);
  });

  it('holds the hard constraints the rules find hard, and none of the soft ones', async () => {
    const read: { scenario: Scenario; set: ConstraintSet | null }[] = [];
    for (const scenario of dev) {
      const answer = await askConstraints(prepare(scenario, 'full'));
      expect(answer.valid, scenario.id).toBe(true);
      read.push({ scenario, set: answer.value });
    }
    const totals = totalsOf(read);
    // Recall rose from about a fifth; precision is held, and no sentence labelled soft is held hard.
    expect(totals.hardRecall.rate ?? 0).toBeGreaterThanOrEqual(0.7);
    expect(totals.precision.strict.rate ?? 0).toBeGreaterThanOrEqual(0.9);
    expect(totals.precision.falseHard).toEqual([]);
    expect(totals.precision.unlabelled).toEqual([]);
  });

  it('holds hard the constraints a model proposes hard, where the words bear it out, and none it should not', async () => {
    const read: { scenario: Scenario; set: ConstraintSet | null }[] = [];
    for (const scenario of dev) {
      const prepared = prepare(scenario, 'full');
      const { set } = await proposeConstraints({
        existing: null,
        context: prepared.discovery,
        mode: 'model',
        model: gatewayFor(scenario),
        modelName: 'scripted',
        signal: new AbortController().signal,
        revisions: { scenario: 0, actors: 0 },
        assumptionIds: new Set(),
        now: new Date('2026-11-03T09:00:00.000Z'),
      });
      read.push({ scenario, set });
    }
    const totals = totalsOf(read);
    expect(totals.hardRecall.rate ?? 0).toBeGreaterThanOrEqual(0.85);
    expect(totals.precision.strict.rate ?? 0).toBeGreaterThanOrEqual(0.9);
    expect(totals.precision.falseHard).toEqual([]);
  });

  it('raises the gap a removed sentence leaves, by asking, in most scenarios, and says how many only because of the removal', async () => {
    const readings: GapReading[] = [];
    for (const scenario of dev) {
      if (!scenario.gap) continue;
      const read = (set: ConstraintSet | null) => ({
        constraints: set
          ? liveConstraints(set).map((item) => ({ category: item.category, source: item.source }))
          : [],
        questions: set
          ? set.clarifications.map((item) => ({ category: item.category, status: item.status }))
          : [],
      });
      const full = await askConstraints(prepare(scenario, 'full'));
      const gap = await askConstraints(prepare(scenario, 'gap'));
      readings.push({
        id: scenario.id,
        accept: scenario.gap.accept,
        ...read(gap.value),
        raisedWithoutGap: raisedCategories(read(full.value)),
      });
    }
    const gaps = scoreGaps(readings);
    expect(gaps.detected.rate ?? 0).toBeGreaterThanOrEqual(0.7);
    // Asking the same of every scenario would raise the first number and not this one: it is held apart.
    expect(gaps.detectedBecauseOfRemoval.successes).toBeGreaterThanOrEqual(3);
    // Three open at most, in every reading.
    for (const reading of readings) {
      expect(reading.questions.filter((item) => item.status === 'open').length).toBeLessThanOrEqual(
        3,
      );
    }
  });
});
