import type { Analysis, Finding, StabilityClass } from '../../../../shared/analysis';
import { chainOf, rankFindings } from '../../lib/analysis';
import { acrossRuns, secondOrderFindings } from './chain';
import { topMover, type Mover } from './movement';
import type { Pair } from './pair';
import { directionFindingOf, type Gap, type Scenario } from './scenarios';

/** The three short answers the first screen gives besides the headline: who moves, what it sets off, how sure. */
export interface Answers {
  /** The actor that moved most. `null` with `known` when nobody moved, or with `known` false when no per-actor results were kept. */
  moves: { known: boolean; mover: Mover | null };
  setsOff: SetsOff;
  sure: Sure;
}

export type SetsOff =
  | {
      kind: 'event';
      /** What it was, in the engine's word, and who did it, and when in the run read in detail. */
      event: string;
      actor: string | null;
      round: number;
      /** How many of the seeded runs had an event like it, when the engine counted that. */
      across: { holdsIn: number; of: number } | null;
    }
  | { kind: 'counted'; statement: string; holdsIn: number; of: number }
  | { kind: 'none' };

export type Sure =
  | {
      kind: 'finding';
      classification: StabilityClass;
      holdsIn: number;
      of: number;
      finding: Finding;
    }
  | { kind: 'paired'; higher: number; paired: number }
  | { kind: 'none' };

export function answersOf(input: {
  analysis: Analysis;
  scenarios: readonly Scenario[];
  pair: Pair;
  gap: Gap | null;
  movers: readonly Mover[];
}): Answers {
  const { analysis, pair, gap, movers } = input;
  const b = input.scenarios.find((scenario) => scenario.id === pair.b) ?? null;
  const a = input.scenarios.find((scenario) => scenario.id === pair.a) ?? null;
  const known = movers.length > 0;

  let setsOff: SetsOff = { kind: 'none' };
  const run = analysis.representativeRun;
  if (b && run && run.variantId === b.id && run.events.length > 0) {
    const first = chainOf(run, analysis.actors)[0];
    const raw = run.events.find((event) => event.id === first?.id);
    if (first && raw) {
      const found = acrossRuns(analysis.findings, b.id, raw);
      setsOff = {
        kind: 'event',
        event: first.kind,
        actor: first.actor,
        round: first.round,
        across: found ? { holdsIn: found.holdsIn, of: found.of } : null,
      };
    }
  } else if (b) {
    const counted = rankFindings(
      secondOrderFindings(analysis.findings, b.id),
      analysis.config.variants,
    )[0];
    if (counted && counted.holdsIn > 0) {
      setsOff = {
        kind: 'counted',
        statement: counted.statement,
        holdsIn: counted.holdsIn,
        of: counted.of,
      };
    }
  }

  let sure: Sure = { kind: 'none' };
  const finding = a && b ? directionFindingOf(analysis.findings, a, b) : null;
  if (finding) {
    sure = {
      kind: 'finding',
      classification: finding.classification,
      holdsIn: finding.holdsIn,
      of: finding.of,
      finding,
    };
  } else if (gap && gap.paired > 0) {
    sure = { kind: 'paired', higher: gap.higher, paired: gap.paired };
  }

  return { moves: { known, mover: topMover(movers) }, setsOff, sure };
}
