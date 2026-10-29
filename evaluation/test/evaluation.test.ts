import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EvidenceChunk } from '../../shared/types.js';
import { REPOSITORY_ROOT, loadCorpus, projectMaterialFor } from '../src/corpus.js';
import {
  loadAnswerability,
  loadClaims,
  loadContradictions,
  loadInjection,
  loadRetrieval,
} from '../src/datasets.js';
import {
  measureContradictions,
  measureRetrieval,
  scoreGate,
  type GateRow,
} from '../src/measure.js';
import { evaluate, render } from '../src/run.js';

const thresholds = z
  .object({
    retrieval: z.record(z.string(), z.object({ recallAt4Min: z.number(), mrrMin: z.number() })),
    answerability: z.object({
      falseAbstainRateMax: z.number(),
      abstentionRecallMin: z.record(z.string(), z.number()),
    }),
    contradictions: z.object({ precisionMin: z.number(), deterministicRecallMin: z.number() }),
    claims: z.object({ accuracyMin: z.number(), unsupportedAcceptedRateMax: z.number() }),
    injection: z.object({ precisionMin: z.number(), directRecallMin: z.number() }),
  })
  .parse(JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'evaluation', 'thresholds.json'), 'utf8')));

const material = await projectMaterialFor(loadCorpus());
const results = evaluate(material);

describe('the datasets', () => {
  it('were labelled against the exact text of the sources', () => {
    expect(loadCorpus().drift).toEqual([]);
  });

  it('use unique ids, and every split has both kinds of case', () => {
    for (const items of [
      loadRetrieval().questions,
      loadAnswerability().questions,
      loadClaims().claims,
      loadInjection().samples,
    ]) {
      const ids = items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const split of ['dev', 'test'] as const) {
      const questions = loadAnswerability().questions.filter((item) => item.split === split);
      expect(questions.some((item) => item.answerable)).toBe(true);
      expect(questions.some((item) => !item.answerable)).toBe(true);
      const claims = loadClaims().claims.filter((item) => item.split === split);
      for (const gold of ['supported', 'partial', 'unsupported'] as const) {
        expect(claims.some((item) => item.gold === gold)).toBe(true);
      }
    }
  });

  it('only ask retrieval for facts that a passage actually contains', () => {
    expect(results.retrieval.dev.unreachable).toEqual([]);
    expect(results.retrieval.test.unreachable).toEqual([]);
  });

  it('are deterministic', () => {
    expect(evaluate(material)).toEqual(results);
  });
});

describe('the measured behaviour has not regressed', () => {
  it('retrieval keeps the passages a question needs in its top four', () => {
    for (const split of ['dev', 'test'] as const) {
      expect(results.retrieval[split].recallAt4).toBeGreaterThanOrEqual(
        thresholds.retrieval[split]!.recallAt4Min,
      );
      expect(results.retrieval[split].mrr).toBeGreaterThanOrEqual(
        thresholds.retrieval[split]!.mrrMin,
      );
    }
  });

  it('the analyst never refuses a question the sources answer, and catches unanswerable ones', () => {
    for (const split of ['dev', 'test'] as const) {
      expect(results.answerability[split].falseAbstainRate).toBeLessThanOrEqual(
        thresholds.answerability.falseAbstainRateMax,
      );
      expect(results.answerability[split].abstentionRecall).toBeGreaterThanOrEqual(
        thresholds.answerability.abstentionRecallMin[split]!,
      );
    }
  });

  // A lexical gate lets through a question that happens to share words with the project's own
  // report. Q17 ("weather ... next Tuesday") is that case. It is listed, not tuned away: only the
  // model's cite-or-abstain rule can catch it, and that is measured in live runs, not here. The
  // test fails both if another question joins the list and if one leaves it, so it stays honest.
  it('refuses every off-topic or absent-year question except the documented misses', () => {
    const kindOf = new Map(loadAnswerability().questions.map((item) => [item.id, item.kind]));
    const missed = (['dev', 'test'] as const)
      .flatMap((split) => results.answerability[split].missed)
      .filter((id) => ['off-topic', 'absent-year'].includes(kindOf.get(id) ?? ''));
    expect(missed).toEqual(['Q17']);
  });

  it('conflicts between sources are reported without false alarms', () => {
    expect(results.contradictions.now.precision).toBeGreaterThanOrEqual(
      thresholds.contradictions.precisionMin,
    );
    expect(results.contradictions.now.deterministicRecall).toBeGreaterThanOrEqual(
      thresholds.contradictions.deterministicRecallMin,
    );
  });

  it('the deterministic support checks stay above their floor and below their ceiling', () => {
    for (const split of ['dev', 'test'] as const) {
      expect(results.claims[split].accuracy).toBeGreaterThanOrEqual(thresholds.claims.accuracyMin);
      expect(results.claims[split].unsupportedAcceptedRate).toBeLessThanOrEqual(
        thresholds.claims.unsupportedAcceptedRateMax,
      );
    }
  });

  it('the publication policy presents fewer unsupported statements as findings than before', () => {
    for (const split of ['dev', 'test'] as const) {
      const claims = results.claims[split];
      const before = Math.round(claims.contaminationBefore * claims.findingsBefore);
      const after = Math.round(claims.contaminationAfter * claims.findingsAfter);
      expect(after).toBeLessThan(before);
    }
  });

  it('injection warnings are precise and catch every direct instruction', () => {
    expect(results.injection.precision).toBeGreaterThanOrEqual(thresholds.injection.precisionMin);
    expect(results.injection.directRecall).toBeGreaterThanOrEqual(
      thresholds.injection.directRecallMin,
    );
  });

  it('renders a readable report', () => {
    const text = render(results);
    for (const heading of ['Retrieval', 'Analyst abstention', 'Conflicts between sources']) {
      expect(text).toContain(heading);
    }
  });
});

// The harness is only worth trusting if its own arithmetic is right.
describe('the measurement code', () => {
  const row = (
    id: string,
    kind: GateRow['kind'],
    answerable: boolean,
    split: GateRow['split'],
    coverage: number,
    topScore: number,
    unmatchedYears = 0,
  ): GateRow => ({ id, kind, answerable, split, coverage, topScore, unmatchedYears });
  const rows: GateRow[] = [
    row('a', 'direct', true, 'dev', 1, 0.3),
    row('b', 'direct', true, 'dev', 0.3, 0.3),
    row('c', 'off-topic', false, 'dev', 0, 0),
    row('d', 'absent-year', false, 'dev', 1, 0.3, 1),
    row('e', 'plausible-absent', false, 'dev', 1, 0.3),
    row('f', 'off-topic', false, 'test', 0, 0),
  ];

  it('scores a gate by split, counting wrongly refused and missed questions', () => {
    const dev = scoreGate(rows, { coverage: 0.4, score: 0.1 }, 'dev');
    expect(dev).toMatchObject({
      answerable: 2,
      unanswerable: 3,
      falseAbstainRate: 0.5,
      abstentionRecall: 0.667,
      wronglyRefused: ['b'],
      missed: ['e'],
    });
    expect(scoreGate(rows, { coverage: 0.4, score: 0.1 }, 'test').abstentionRecall).toBe(1);
    expect(scoreGate(rows, { coverage: 0.4, score: 0.1 }, 'all').answerable).toBe(2);
  });

  const passage = (id: string, documentName: string, text: string): EvidenceChunk => ({
    id,
    documentId: documentName,
    documentName,
    text,
    start: 0,
    end: text.length,
  });

  it('measures retrieval against the passage a question needs, and flags an unsatisfiable label', () => {
    const chunks = [
      passage('S1', 'a.md', 'The ferry operator proposes four winter sailings each day.'),
      passage('S2', 'b.md', 'Island bakeries open early on market mornings and sell bread.'),
    ];
    const set = {
      version: 1 as const,
      questions: [
        {
          id: 'R1',
          split: 'dev' as const,
          question: 'What winter sailings does the operator propose?',
          relevant: [{ document: 'a.md', contains: 'four winter sailings' }],
        },
        {
          id: 'R2',
          split: 'dev' as const,
          question: 'What does the operator propose?',
          relevant: [{ document: 'a.md', contains: 'text that is not there' }],
        },
      ],
    };
    const metrics = measureRetrieval(set, chunks, 'dev');
    expect(metrics.unreachable).toEqual(['R2']);
    expect(metrics.hitAt1).toBe(0.5);
    expect(metrics.recallAt4).toBe(0.5);
  });

  it('matches a detected conflict only when it pairs the named documents and quotes the phrases', () => {
    const chunks = [
      passage('S1', 'one.md', 'Council counts show 412,000 one-way crossings in 2025.'),
      passage('S2', 'two.md', 'Our ticketing system recorded 365,000 one-way crossings in 2025.'),
    ];
    const set = (documents: [string, string], phrase: string) => ({
      version: 1 as const,
      knownNonConflicts: [],
      expected: [
        {
          id: 'K',
          kind: 'deterministic' as const,
          description: 'x',
          documents,
          mustContain: [phrase],
        },
      ],
    });
    expect(measureContradictions(set(['one.md', 'two.md'], '412,000'), chunks).recall).toBe(1);
    expect(measureContradictions(set(['one.md', 'three.md'], '412,000'), chunks)).toMatchObject({
      recall: 0,
      precision: 0,
    });
    expect(measureContradictions(set(['one.md', 'two.md'], '999,000'), chunks).recall).toBe(0);
    expect(loadContradictions().expected.length).toBeGreaterThan(0);
  });
});
