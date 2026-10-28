import type {
  ChapterClaim,
  ClaimChecks,
  ClaimKind,
  SupportVerdict,
} from '../../../shared/grounding.js';
import type { ProjectDetail, SimulationReport } from '../../../shared/types.js';
import { findQuote, numbersIn, wordOverlap } from './text.js';

/** Word-overlap thresholds. They are heuristics: explicit, documented and covered by tests. */
export const SUPPORTED_OVERLAP = 0.5;
export const PARTIAL_OVERLAP = 0.25;

export interface VerificationContext {
  /** Source passages the report was allowed to cite. */
  passages: ReadonlyMap<string, string>;
  /** Simulation memories the report was allowed to cite. */
  memories: ReadonlyMap<string, string>;
  /** Figures that appear in the recorded simulation, in every rendering a writer might use. */
  recorded: ReadonlySet<string>;
}

/** Kinds that rest on a source passage. Only these can carry a quote, and only these are model-judged. */
export const SOURCE_KINDS: ReadonlySet<ClaimKind> = new Set(['source-fact', 'extracted-claim']);

function addRenderings(into: Set<string>, value: number): void {
  if (!Number.isFinite(value)) return;
  const magnitude = Math.abs(value);
  for (const digits of [0, 1, 2, 3]) {
    for (const token of numbersIn(magnitude.toFixed(digits))) into.add(token);
  }
  // Shares and inclinations are naturally written as percentages too.
  for (const digits of [0, 1]) {
    for (const token of numbersIn((magnitude * 100).toFixed(digits))) into.add(token);
  }
}

/**
 * Every figure a faithful statement about this simulation could contain. A figure outside this set
 * (and outside the cited passage) is not backed by anything the system recorded.
 */
export function recordedFigures(
  project: ProjectDetail,
  metrics: SimulationReport['metrics'],
): Set<string> {
  const recorded = new Set<string>();
  const add = (value: number | null | undefined): void => {
    if (typeof value === 'number') addRenderings(recorded, value);
  };
  for (const value of Object.values(metrics)) add(value);
  const snapshots = [
    ...project.rounds,
    ...(project.console?.platforms.flatMap((run) => run.rounds) ?? []),
  ];
  let previous: number | null = null;
  for (const round of project.rounds) {
    if (previous !== null) add(round.meanOpinion - previous);
    previous = round.meanOpinion;
  }
  add(metrics.finalMean - metrics.initialMean);
  for (const round of snapshots) {
    for (const value of [
      round.round,
      round.meanOpinion,
      round.supportShare,
      round.oppositionShare,
      round.undecidedShare,
      round.polarization,
      round.activityCount,
      round.interactions,
    ]) {
      add(value);
    }
  }
  const { settings } = project;
  for (const value of [settings.agentCount, settings.rounds, settings.seed]) add(value);
  add(settings.intervention?.round);
  add(settings.intervention?.stance);
  add(settings.intervention?.strength);
  add(project.console?.environment?.minutesPerRound);
  add(project.console?.platforms.length);
  add(project.console?.memories.length);
  // Round and proxy numbers are written everywhere ("round 3", "proxy 7") and are not statistics.
  for (let value = 0; value <= 24; value += 1) add(value);
  return recorded;
}

function textOf(ids: readonly string[], from: ReadonlyMap<string, string>): Map<string, string> {
  const picked = new Map<string, string>();
  for (const id of ids) {
    const value = from.get(id);
    if (value !== undefined) picked.set(id, value);
  }
  return picked;
}

/** Deterministic checks only. The independent model check is added separately, and may not run. */
export function checkClaim(claim: ChapterClaim, context: VerificationContext): ClaimChecks {
  const cited = textOf(claim.sourceIds, context.passages);
  const quote =
    claim.quote === null ? null : findQuote(claim.quote, cited).found ? 'found' : 'not-found';
  const claimNumbers = numbersIn(claim.text);

  let overlap: number | null = null;
  let accepted: ReadonlySet<string> = new Set();
  if (SOURCE_KINDS.has(claim.kind)) {
    const material = [...cited.values()].join('\n');
    overlap = material ? wordOverlap(claim.text, material) : 0;
    accepted = new Set(numbersIn(material));
  } else if (claim.kind === 'simulated-event') {
    const material = [...textOf(claim.memoryIds, context.memories).values()].join('\n');
    overlap = material ? wordOverlap(claim.text, material) : 0;
    accepted = new Set([...numbersIn(material), ...context.recorded]);
  } else if (claim.kind === 'analytical-conclusion') {
    accepted = context.recorded;
  }
  const checkable = claim.kind !== 'ai-hypothesis' && claim.kind !== 'user-assumption';
  const numbers =
    !checkable || claimNumbers.length === 0
      ? null
      : claimNumbers.every((token) => accepted.has(token))
        ? 'match'
        : 'mismatch';
  return { quote, overlap, numbers, entailment: null };
}

const ORDER: SupportVerdict[] = ['unsupported', 'partial', 'supported'];

function fromOverlap(overlap: number): SupportVerdict {
  if (overlap >= SUPPORTED_OVERLAP) return 'supported';
  return overlap >= PARTIAL_OVERLAP ? 'partial' : 'unsupported';
}

function lower(verdict: SupportVerdict): SupportVerdict {
  const index = ORDER.indexOf(verdict);
  return index <= 0 ? verdict : (ORDER[index - 1] ?? verdict);
}

function cap(verdict: SupportVerdict, ceiling: SupportVerdict): SupportVerdict {
  return ORDER.indexOf(verdict) > ORDER.indexOf(ceiling) ? ceiling : verdict;
}

export interface Decision {
  verdict: SupportVerdict;
  reason: string;
}

/**
 * The verdict is a pure function of the checks, so every outcome can be explained and tested.
 * A model judgement can lower or confirm a verdict, but it can never create support on its own:
 * `supported` always needs word overlap with the cited material.
 */
export function decideVerdict(
  claim: Pick<ChapterClaim, 'kind' | 'sourceIds' | 'memoryIds'>,
  checks: ClaimChecks,
): Decision {
  switch (claim.kind) {
    case 'ai-hypothesis':
      return {
        verdict: 'unchecked',
        reason:
          'Labelled an AI hypothesis. It is not claimed to be backed by a source, so it is shown as speculation and was not verified.',
      };
    case 'user-assumption':
      return {
        verdict: 'unchecked',
        reason:
          'Labelled a user assumption (a setting, intervention or seed post you chose). It is an input, not evidence, so it was not verified.',
      };
    case 'analytical-conclusion':
      if (checks.numbers === null) {
        return {
          verdict: 'unchecked',
          reason: 'An interpretation of the recorded metrics with no figure that can be checked.',
        };
      }
      return checks.numbers === 'match'
        ? { verdict: 'supported', reason: 'Every figure appears in the recorded simulation data.' }
        : {
            verdict: 'unsupported',
            reason: 'A figure in this statement does not appear in the recorded simulation data.',
          };
    case 'simulated-event': {
      if (claim.memoryIds.length === 0) {
        return { verdict: 'unsupported', reason: 'It cites no recorded simulation memory.' };
      }
      let verdict = fromOverlap(checks.overlap ?? 0);
      let reason =
        verdict === 'supported'
          ? 'Matches the cited simulation memory.'
          : verdict === 'partial'
            ? 'Only partly matches the cited simulation memory.'
            : 'Does not match the cited simulation memory.';
      if (checks.numbers === 'mismatch') {
        verdict = lower(verdict);
        reason += ' A figure in it is not in the recorded data.';
      }
      return { verdict, reason };
    }
    default:
      return decideSourceClaim(claim, checks);
  }
}

function decideSourceClaim(
  claim: Pick<ChapterClaim, 'kind' | 'sourceIds'>,
  checks: ClaimChecks,
): Decision {
  if (claim.sourceIds.length === 0) {
    return { verdict: 'unsupported', reason: 'It cites no source passage.' };
  }
  if (checks.entailment === 'contradicts') {
    return {
      verdict: 'contradicted',
      reason:
        'An independent check found text in the cited passage that conflicts with this statement.',
    };
  }
  if (checks.quote === 'not-found') {
    return { verdict: 'unsupported', reason: 'The quoted text is not in the cited passage.' };
  }
  if (checks.entailment === 'not-supported') {
    return {
      verdict: 'unsupported',
      reason: 'An independent check found that the cited passage does not support this statement.',
    };
  }
  let verdict = fromOverlap(checks.overlap ?? 0);
  const notes: string[] = [];
  if (claim.kind === 'source-fact' && checks.quote !== 'found') {
    verdict = cap(verdict, 'partial');
    notes.push('No verbatim quote was supplied for a statement labelled a source fact.');
  }
  if (checks.entailment === 'supports') {
    if (verdict === 'unsupported') {
      verdict = 'partial';
      notes.push(
        'The model check says it is supported, but the statement shares few words with the cited passage.',
      );
    } else if (verdict === 'partial' && claim.kind === 'extracted-claim') {
      verdict = 'supported';
      notes.push('A paraphrase confirmed by the independent check.');
    }
  } else if (checks.entailment === 'partial') {
    verdict = cap(verdict, 'partial');
    notes.push('The independent check found only part of it in the cited passage.');
  } else if (checks.entailment === null) {
    notes.push('Quote and word-overlap checks only; no independent model check ran.');
  }
  if (checks.numbers === 'mismatch') {
    verdict = lower(verdict);
    notes.push('A figure in it does not appear in the cited passage.');
  }
  if (checks.quote === 'found') notes.unshift('The quoted text is verbatim in the cited passage.');
  const lead =
    verdict === 'supported'
      ? 'Backed by the cited passage.'
      : verdict === 'partial'
        ? 'Only partly backed by the cited passage.'
        : 'Not backed by the cited passage.';
  return { verdict, reason: [lead, ...notes].join(' ') };
}
