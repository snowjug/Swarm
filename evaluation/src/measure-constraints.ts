import { isGrounded, type EvidenceItem, type PassageIndex } from './measure-grounding.js';
import { quotesOverlap, rateOf, type Rate } from './measure-stats.js';

export interface GoldConstraintLabel {
  id: string;
  category: string;
  hardness: 'hard' | 'soft';
  document: string;
  quote: string;
}

export interface AcceptedConstraint {
  id: string;
  category: string;
  hardness: 'hard' | 'soft';
  source: string;
  evidence: readonly EvidenceItem[];
}

/** An accepted constraint states the labelled sentence when one of its quotes overlaps it, in the same document. */
export function statesLabel(label: GoldConstraintLabel, accepted: AcceptedConstraint): boolean {
  return accepted.evidence.some(
    (item) =>
      item.documentName === label.document &&
      item.quote !== null &&
      quotesOverlap(item.quote, label.quote),
  );
}

export interface ConstraintScores {
  /** Share of labelled hard constraints an accepted hard constraint states. */
  hardRecall: Rate;
  /** Share of all labelled constraints an accepted constraint states, whatever its hardness. */
  recall: Rate;
  /** Of the labelled constraints that were found, the share the product gave the labelled category. */
  categoryAgreement: Rate;
  /** Of the labelled constraints that were found, the share the product gave the labelled hardness. */
  hardnessAgreement: Rate;
  /**
   * Of the accepted constraints labelled extracted, the share that state a labelled sentence. The
   * labels are not a list of every constraint a text holds, so this is a lower bound.
   */
  precisionAgainstLabels: Rate;
  missedHard: string[];
}

export function scoreConstraints(
  labels: readonly GoldConstraintLabel[],
  accepted: readonly AcceptedConstraint[],
): ConstraintScores {
  const found = new Map<string, AcceptedConstraint[]>();
  for (const label of labels) {
    found.set(
      label.id,
      accepted.filter((item) => statesLabel(label, item)),
    );
  }
  const hard = labels.filter((label) => label.hardness === 'hard');
  const hardFound = hard.filter((label) =>
    (found.get(label.id) ?? []).some((item) => item.hardness === 'hard'),
  );
  const foundLabels = labels.filter((label) => (found.get(label.id) ?? []).length > 0);
  const extracted = accepted.filter((item) => item.source === 'extracted');
  return {
    hardRecall: rateOf(hardFound.length, hard.length),
    recall: rateOf(foundLabels.length, labels.length),
    categoryAgreement: rateOf(
      foundLabels.filter((label) =>
        (found.get(label.id) ?? []).some((item) => item.category === label.category),
      ).length,
      foundLabels.length,
    ),
    hardnessAgreement: rateOf(
      foundLabels.filter((label) =>
        (found.get(label.id) ?? []).some((item) => item.hardness === label.hardness),
      ).length,
      foundLabels.length,
    ),
    precisionAgainstLabels: rateOf(
      extracted.filter((item) => labels.some((label) => statesLabel(label, item))).length,
      extracted.length,
    ),
    missedHard: hard.filter((label) => !hardFound.includes(label)).map((label) => label.id),
  };
}

/** One scenario read with the sentence of a labelled constraint taken out. */
export interface GapReading {
  id: string;
  /** The categories the label accepts as raising the gap. */
  accept: readonly string[];
  constraints: readonly { category: string; source: string }[];
  questions: readonly { category: string; status: string }[];
  /** The categories raised, in either way, when the same documents were read with the sentence in them. */
  raisedWithoutGap: readonly string[];
}

export interface GapScores {
  detected: Rate;
  /** Detected, and not also raised when the sentence was present: the removal is what raised it. */
  detectedBecauseOfRemoval: Rate;
  viaQuestion: number;
  viaConstraint: number;
  missed: string[];
}

export function raisedCategories(reading: Pick<GapReading, 'constraints' | 'questions'>): string[] {
  return [
    ...reading.questions.filter((item) => item.status === 'open').map((item) => item.category),
    ...reading.constraints
      .filter((item) => item.source !== 'extracted')
      .map((item) => item.category),
  ];
}

export function scoreGaps(readings: readonly GapReading[]): GapScores {
  let detected = 0;
  let because = 0;
  let viaQuestion = 0;
  let viaConstraint = 0;
  const missed: string[] = [];
  for (const reading of readings) {
    const byQuestion = reading.questions.some(
      (item) => item.status === 'open' && reading.accept.includes(item.category),
    );
    const byConstraint = reading.constraints.some(
      (item) => item.source !== 'extracted' && reading.accept.includes(item.category),
    );
    if (byQuestion) viaQuestion += 1;
    if (byConstraint) viaConstraint += 1;
    if (byQuestion || byConstraint) {
      detected += 1;
      if (!reading.raisedWithoutGap.some((category) => reading.accept.includes(category)))
        because += 1;
    } else {
      missed.push(reading.id);
    }
  }
  return {
    detected: rateOf(detected, readings.length),
    detectedBecauseOfRemoval: rateOf(because, readings.length),
    viaQuestion,
    viaConstraint,
    missed,
  };
}

/** Constraints labelled extracted that carry no quote, or a quote that is not in the cited passage. */
export function extractedLabelErrors(
  accepted: readonly Pick<AcceptedConstraint, 'id' | 'source' | 'evidence'>[],
  passages: PassageIndex,
): { count: number; of: number; ids: string[] } {
  const extracted = accepted.filter((item) => item.source === 'extracted');
  const bad = extracted.filter(
    (item) => item.evidence.length === 0 || item.evidence.some((e) => !isGrounded(e, passages)),
  );
  return { count: bad.length, of: extracted.length, ids: bad.map((item) => item.id) };
}
