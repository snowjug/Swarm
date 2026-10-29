import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MIN_RETRIEVAL_SCORE,
  MIN_TERM_COVERAGE,
} from '../../backend/src/orchestration/evidence-gate.js';
import { PINNED_SOURCES, REPOSITORY_ROOT, loadCorpus } from './corpus.js';
import {
  loadAnswerability,
  loadClaims,
  loadContradictions,
  loadInjection,
  loadRetrieval,
} from './datasets.js';
import {
  measureClaims,
  measureContradictions,
  measureInjection,
  measureRetrieval,
  readGate,
  scoreGate,
  sweepGate,
  type AnswerabilityMetrics,
  type ClaimMetrics,
  type ContradictionMetrics,
  type InjectionMetrics,
  type RetrievalMetrics,
  type Thresholds,
} from './measure.js';

export interface EvaluationResults {
  sources: Record<string, string>;
  gate: Thresholds;
  retrieval: { dev: RetrievalMetrics; test: RetrievalMetrics };
  answerability: {
    /** The behaviour before the gate existed: every question was answered. */
    neverAbstains: { falseAbstainRate: number; abstentionRecall: number };
    dev: AnswerabilityMetrics;
    test: AnswerabilityMetrics;
  };
  contradictions: {
    /** Before the detector existed no conflict between sources was reported. */
    before: { recall: number };
    now: ContradictionMetrics;
  };
  claims: { dev: ClaimMetrics; test: ClaimMetrics };
  injection: InjectionMetrics;
}

export function evaluate(
  gate: Thresholds = { coverage: MIN_TERM_COVERAGE, score: MIN_RETRIEVAL_SCORE },
): EvaluationResults {
  const corpus = loadCorpus();
  if (corpus.drift.length > 0) {
    throw new Error(
      `Sources changed since the datasets were labelled: ${corpus.drift.join(', ')}. Re-label, then update PINNED_SOURCES.`,
    );
  }
  const retrieval = loadRetrieval();
  const rows = readGate(loadAnswerability(), corpus.chunks);
  const claims = loadClaims();
  return {
    sources: { ...PINNED_SOURCES },
    gate,
    retrieval: {
      dev: measureRetrieval(retrieval, corpus.chunks, 'dev'),
      test: measureRetrieval(retrieval, corpus.chunks, 'test'),
    },
    answerability: {
      neverAbstains: { falseAbstainRate: 0, abstentionRecall: 0 },
      dev: scoreGate(rows, gate, 'dev'),
      test: scoreGate(rows, gate, 'test'),
    },
    contradictions: {
      before: { recall: 0 },
      now: measureContradictions(loadContradictions(), corpus.chunks),
    },
    claims: {
      dev: measureClaims(claims, corpus.chunks, 'dev'),
      test: measureClaims(claims, corpus.chunks, 'test'),
    },
    injection: measureInjection(loadInjection()),
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function render(results: EvaluationResults): string {
  const { retrieval, answerability, contradictions, claims, injection } = results;
  const line = (...cells: (string | number)[]): string => `| ${cells.join(' | ')} |`;
  const kinds = (metrics: AnswerabilityMetrics): string =>
    Object.entries(metrics.byKind)
      .map(([kind, { total, refused }]) => `${kind} ${refused}/${total}`)
      .join(', ');
  return [
    `Gate: key-term coverage >= ${results.gate.coverage}, best-passage score >= ${results.gate.score}`,
    '',
    '### Retrieval (top four passages)',
    line('split', 'questions', 'recall@4', 'hit@1', 'MRR', 'irrelevant returned'),
    line('---', '---', '---', '---', '---', '---'),
    ...(['dev', 'test'] as const).map((split) => {
      const item = retrieval[split];
      return line(
        split,
        item.questions,
        percent(item.recallAt4),
        percent(item.hitAt1),
        item.mrr,
        item.irrelevantReturned,
      );
    }),
    '',
    '### Analyst abstention',
    line('', 'false abstain', 'abstention recall', 'refused by kind'),
    line('---', '---', '---', '---'),
    line('before (always answers)', percent(0), percent(0), '-'),
    ...(['dev', 'test'] as const).map((split) =>
      line(
        `gate, ${split}`,
        percent(answerability[split].falseAbstainRate),
        percent(answerability[split].abstentionRecall),
        kinds(answerability[split]),
      ),
    ),
    '',
    '### Conflicts between sources',
    line('', 'recall', 'deterministic recall', 'precision', 'detected', 'missed'),
    line('---', '---', '---', '---', '---', '---'),
    line('before (none reported)', percent(0), percent(0), '-', 0, '-'),
    line(
      'detector',
      percent(contradictions.now.recall),
      percent(contradictions.now.deterministicRecall),
      percent(contradictions.now.precision),
      contradictions.now.detected,
      contradictions.now.missed.join(', ') || 'none',
    ),
    '',
    '### Statement support (deterministic checks only)',
    line(
      'split',
      'claims',
      'accuracy',
      'unsupported accepted',
      'false alarms',
      'findings contaminated before',
      'after',
    ),
    line('---', '---', '---', '---', '---', '---', '---'),
    ...(['dev', 'test'] as const).map((split) => {
      const item = claims[split];
      return line(
        split,
        item.claims,
        percent(item.accuracy),
        `${item.unsupportedAccepted} (${percent(item.unsupportedAcceptedRate)})`,
        percent(item.falseAlarmRate),
        percent(item.contaminationBefore),
        `${percent(item.contaminationAfter)} of ${item.findingsAfter}`,
      );
    }),
    '',
    '### Injection patterns in sources',
    line('samples', 'precision', 'recall', 'direct recall', 'false positives', 'missed'),
    line('---', '---', '---', '---', '---', '---'),
    line(
      injection.samples,
      percent(injection.precision),
      percent(injection.recall),
      percent(injection.directRecall),
      injection.falsePositives.join(', ') || 'none',
      injection.missed.join(', ') || 'none',
    ),
  ].join('\n');
}

function main(): void {
  const results = evaluate();
  if (process.argv.includes('--sweep')) {
    const rows = readGate(loadAnswerability(), loadCorpus().chunks);
    console.log('Gate threshold sweep on the dev split (chosen on dev, reported on test):');
    for (const cell of sweepGate(rows, 'dev')) {
      console.log(
        `coverage ${cell.coverage} score ${cell.score}: false abstain ${percent(cell.falseAbstainRate)}, recall ${percent(cell.abstentionRecall)}`,
      );
    }
    return;
  }
  console.log(render(results));
  if (process.argv.includes('--write')) {
    const directory = join(REPOSITORY_ROOT, 'evaluation', 'results');
    writeFileSync(join(directory, 'latest.json'), `${JSON.stringify(results, null, 2)}\n`);
    writeFileSync(join(directory, 'latest.md'), `${render(results)}\n`);
    console.log(`\nWrote ${directory}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
