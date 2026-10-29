import type { EvidenceChunk } from '../../shared/types.js';
import type { ChapterClaim } from '../../shared/grounding.js';
import { assessAnswerability } from '../../backend/src/orchestration/evidence-gate.js';
import { checkClaim, decideVerdict } from '../../backend/src/grounding/verify.js';
import { classifySupport, decidePublication } from '../../backend/src/grounding/ledger.js';
import { detectContradictions } from '../../backend/src/grounding/contradictions.js';
import { retrieve } from '../../backend/src/knowledge/retrieval.js';
import { inspectText } from '../../backend/src/models/injection.js';
import type {
  AnswerabilityKind,
  AnswerabilitySet,
  ClaimSet,
  ContradictionSet,
  InjectionSet,
  RetrievalSet,
  Split,
  SupportGold,
} from './datasets.js';

const round = (value: number): number => Math.round(value * 1000) / 1000;
const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : round(part / whole));
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length);

export interface RetrievalMetrics {
  questions: number;
  /** Share of the facts a question needs that appear in the top four passages. */
  recallAt4: number;
  /** Share of questions whose first passage contains a needed fact. */
  hitAt1: number;
  /** Mean reciprocal rank of the first passage that contains a needed fact. */
  mrr: number;
  /** Mean number of the four returned passages that contain no needed fact. */
  irrelevantReturned: number;
  /** Labels no passage satisfies: a fault in the dataset, not in retrieval. */
  unreachable: string[];
}

export function measureRetrieval(
  set: RetrievalSet,
  chunks: EvidenceChunk[],
  split: Split | 'all',
): RetrievalMetrics {
  const questions = set.questions.filter((item) => split === 'all' || item.split === split);
  const unreachable: string[] = [];
  const recalls: number[] = [];
  const hits: number[] = [];
  const reciprocal: number[] = [];
  const noise: number[] = [];
  for (const item of questions) {
    const satisfies = (chunk: EvidenceChunk, spec: (typeof item.relevant)[number]): boolean =>
      chunk.documentName === spec.document && chunk.text.includes(spec.contains);
    for (const spec of item.relevant) {
      if (!chunks.some((chunk) => satisfies(chunk, spec))) unreachable.push(item.id);
    }
    const returned = retrieve(chunks, item.question, 4);
    const needed = item.relevant.filter((spec) => returned.some((chunk) => satisfies(chunk, spec)));
    recalls.push(needed.length / item.relevant.length);
    const first = returned.findIndex((chunk) =>
      item.relevant.some((spec) => satisfies(chunk, spec)),
    );
    hits.push(first === 0 ? 1 : 0);
    reciprocal.push(first < 0 ? 0 : 1 / (first + 1));
    noise.push(
      returned.filter((chunk) => !item.relevant.some((spec) => satisfies(chunk, spec))).length,
    );
  }
  return {
    questions: questions.length,
    recallAt4: mean(recalls),
    hitAt1: mean(hits),
    mrr: mean(reciprocal),
    irrelevantReturned: mean(noise),
    unreachable,
  };
}

export interface GateRow {
  id: string;
  kind: AnswerabilityKind;
  answerable: boolean;
  split: Split;
  coverage: number;
  topScore: number;
  unmatchedYears: number;
}

/** The gate's raw readings for every question, from which any threshold can be scored. */
export function readGate(set: AnswerabilitySet, chunks: EvidenceChunk[]): GateRow[] {
  return set.questions.map((item) => {
    const reading = assessAnswerability({ question: item.question, chunks, material: [] });
    return {
      id: item.id,
      kind: item.kind,
      answerable: item.answerable,
      split: item.split,
      coverage: reading.coverage,
      topScore: reading.topScore,
      unmatchedYears: reading.unmatchedYears.length,
    };
  });
}

export interface Thresholds {
  coverage: number;
  score: number;
}

export interface AnswerabilityMetrics {
  answerable: number;
  unanswerable: number;
  /** Answerable questions the gate refused. */
  falseAbstainRate: number;
  /** Unanswerable questions the gate refused. */
  abstentionRecall: number;
  /** Refusals by kind of unanswerable question. */
  byKind: Partial<Record<AnswerabilityKind, { total: number; refused: number }>>;
  missed: string[];
  wronglyRefused: string[];
}

export function scoreGate(
  rows: GateRow[],
  thresholds: Thresholds,
  split: Split | 'all',
): AnswerabilityMetrics {
  const selected = rows.filter((row) => split === 'all' || row.split === split);
  const refuses = (row: GateRow): boolean =>
    row.unmatchedYears > 0 || row.coverage < thresholds.coverage || row.topScore < thresholds.score;
  const answerable = selected.filter((row) => row.answerable);
  const unanswerable = selected.filter((row) => !row.answerable);
  const byKind: AnswerabilityMetrics['byKind'] = {};
  for (const row of unanswerable) {
    const entry = (byKind[row.kind] ??= { total: 0, refused: 0 });
    entry.total += 1;
    if (refuses(row)) entry.refused += 1;
  }
  return {
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    falseAbstainRate: ratio(answerable.filter(refuses).length, answerable.length),
    abstentionRecall: ratio(unanswerable.filter(refuses).length, unanswerable.length),
    byKind,
    missed: unanswerable.filter((row) => !refuses(row)).map((row) => row.id),
    wronglyRefused: answerable.filter(refuses).map((row) => row.id),
  };
}

export interface SweepCell extends Thresholds {
  falseAbstainRate: number;
  abstentionRecall: number;
}

/** Scores a grid of thresholds on one split. Used to choose the gate's settings on `dev` only. */
export function sweepGate(rows: GateRow[], split: Split): SweepCell[] {
  const cells: SweepCell[] = [];
  for (const coverage of [0.2, 0.3, 0.4, 0.5, 0.6]) {
    for (const score of [0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2]) {
      const result = scoreGate(rows, { coverage, score }, split);
      cells.push({
        coverage,
        score,
        falseAbstainRate: result.falseAbstainRate,
        abstentionRecall: result.abstentionRecall,
      });
    }
  }
  return cells;
}

export interface ContradictionMetrics {
  expected: number;
  detected: number;
  truePositives: number;
  precision: number;
  recall: number;
  /** Recall over the conflicts a figure-and-polarity detector could be expected to find. */
  deterministicRecall: number;
  missed: string[];
  /** Detections that match no labelled conflict, for a person to adjudicate. */
  unmatched: string[];
}

export function measureContradictions(
  set: ContradictionSet,
  chunks: EvidenceChunk[],
): ContradictionMetrics {
  const detections = detectContradictions(chunks, new Date('2026-01-01T00:00:00.000Z'));
  const textOf = (detection: (typeof detections)[number]): string =>
    `${detection.left.quote ?? ''} ${detection.right.quote ?? ''}`.toLowerCase();
  const matches = (
    expected: (typeof set.expected)[number],
    detection: (typeof detections)[number],
  ) =>
    [detection.left.documentName, detection.right.documentName].sort().join('|') ===
      [...expected.documents].sort().join('|') &&
    expected.mustContain.every((phrase) => textOf(detection).includes(phrase.toLowerCase()));
  const found = set.expected.filter((expected) =>
    detections.some((detection) => matches(expected, detection)),
  );
  const matched = detections.filter((detection) =>
    set.expected.some((expected) => matches(expected, detection)),
  );
  const deterministic = set.expected.filter((expected) => expected.kind === 'deterministic');
  return {
    expected: set.expected.length,
    detected: detections.length,
    truePositives: matched.length,
    precision: ratio(matched.length, detections.length),
    recall: ratio(found.length, set.expected.length),
    deterministicRecall: ratio(
      deterministic.filter((expected) => found.includes(expected)).length,
      deterministic.length,
    ),
    missed: set.expected.filter((expected) => !found.includes(expected)).map(({ id }) => id),
    unmatched: detections
      .filter((detection) => !matched.includes(detection))
      .map(
        (detection) =>
          `${detection.left.documentName} ~ ${detection.right.documentName}: ${detection.topic}`,
      ),
  };
}

export type Predicted = SupportGold;

export interface ClaimMetrics {
  claims: number;
  accuracy: number;
  /** Unsupported statements the deterministic checks rated supported. */
  unsupportedAccepted: number;
  unsupportedAcceptedRate: number;
  /** Supported statements the checks rated unsupported. */
  falseAlarmRate: number;
  confusion: Record<SupportGold, Record<Predicted, number>>;
  /**
   * Share of the statements presented as findings that the gold labels say are not fully
   * supported. Before the publication policy every statement was presented as a finding.
   */
  contaminationBefore: number;
  contaminationAfter: number;
  findingsBefore: number;
  findingsAfter: number;
}

export function measureClaims(
  set: ClaimSet,
  chunks: EvidenceChunk[],
  split: Split | 'all',
): ClaimMetrics {
  const claims = set.claims.filter((item) => split === 'all' || item.split === split);
  const confusion: ClaimMetrics['confusion'] = {
    supported: { supported: 0, partial: 0, unsupported: 0 },
    partial: { supported: 0, partial: 0, unsupported: 0 },
    unsupported: { supported: 0, partial: 0, unsupported: 0 },
  };
  let published = 0;
  let publishedNotSupported = 0;
  for (const item of claims) {
    const cited = chunks.filter((chunk) => item.documents.includes(chunk.documentName));
    const claim: ChapterClaim = {
      text: item.text,
      kind: item.kind,
      sourceIds: cited.map((chunk) => chunk.id),
      memoryIds: [],
      quote: null,
    };
    const checks = checkClaim(claim, {
      passages: new Map(cited.map((chunk) => [chunk.id, chunk.text])),
      memories: new Map(),
      recorded: new Set(),
    });
    const decision = decideVerdict(claim, checks);
    const predicted: Predicted =
      decision.verdict === 'supported'
        ? 'supported'
        : decision.verdict === 'partial'
          ? 'partial'
          : 'unsupported';
    confusion[item.gold][predicted] += 1;
    const supportClass = classifySupport({
      statementType: item.kind,
      verdict: decision.verdict,
      contradicting: 0,
      assumptions: 0,
    });
    const publication = decidePublication({
      statementType: item.kind,
      supportClass,
      supporting: cited.map((chunk) => ({
        passageId: chunk.id,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        start: chunk.start,
        end: chunk.end,
        quote: null,
        contentHash: 'x'.repeat(64),
        role: 'supports' as const,
      })),
      contradicting: [],
      assumptionIds: [],
      review: { result: 'pending', note: null, reviewedAt: null },
      reason: decision.reason,
    });
    if (publication.status === 'finding') {
      published += 1;
      if (item.gold !== 'supported') publishedNotSupported += 1;
    }
  }
  const total = claims.length;
  const correct =
    confusion.supported.supported + confusion.partial.partial + confusion.unsupported.unsupported;
  const goldUnsupported = Object.values(confusion.unsupported).reduce((sum, n) => sum + n, 0);
  const goldSupported = Object.values(confusion.supported).reduce((sum, n) => sum + n, 0);
  return {
    claims: total,
    accuracy: ratio(correct, total),
    unsupportedAccepted: confusion.unsupported.supported,
    unsupportedAcceptedRate: ratio(confusion.unsupported.supported, goldUnsupported),
    falseAlarmRate: ratio(confusion.supported.unsupported, goldSupported),
    confusion,
    contaminationBefore: ratio(claims.filter((item) => item.gold !== 'supported').length, total),
    contaminationAfter: ratio(publishedNotSupported, published),
    findingsBefore: total,
    findingsAfter: published,
  };
}

export interface InjectionMetrics {
  samples: number;
  precision: number;
  recall: number;
  directRecall: number;
  falsePositives: string[];
  missed: string[];
}

export function measureInjection(set: InjectionSet): InjectionMetrics {
  const flagged = set.samples.filter((sample) => inspectText(sample.text).suspicious);
  const positives = set.samples.filter((sample) => sample.injection);
  const direct = positives.filter((sample) => sample.kind === 'direct');
  const truePositives = flagged.filter((sample) => sample.injection);
  return {
    samples: set.samples.length,
    precision: ratio(truePositives.length, flagged.length),
    recall: ratio(truePositives.length, positives.length),
    directRecall: ratio(
      truePositives.filter((sample) => direct.includes(sample)).length,
      direct.length,
    ),
    falsePositives: flagged.filter((sample) => !sample.injection).map(({ id }) => id),
    missed: positives.filter((sample) => !flagged.includes(sample)).map(({ id }) => id),
  };
}
