import type { Analysis, Finding } from '../../../shared/analysis.js';
import { BRIEF_READING_NOTES, type BriefSignal } from '../../../shared/brief.js';
import { changeCanMoveAnyone } from '../../../shared/signal.js';
import { pairRuns, type Headline } from './measures.js';
import { IMPACT_CUTS } from './rules.js';
import type { Draft } from './writer.js';

/**
 * Whether the comparison of the change with no change can be read as a result about the change.
 *
 * It cannot when no stakeholder has an expected direction of impact: the change then moves no one in
 * the simulation, and every difference between it and no change is noise (`no-direction`). It also
 * says nothing when stakeholders do have directions and the comparison still found the two about the
 * same, in most paired seeded runs, with no other finding against it and no group moving clearly on
 * its own (`no-difference`). In both cases the brief says so first and does not lead with counts.
 */

const SAME = /\bended up about the same under\b/u;

/** The analysis's finding that the change and no change ended up about the same on the same seeds. */
export const isAboutTheSame = (finding: Finding): boolean =>
  finding.kind === 'direction-vs-baseline' && SAME.test(finding.statement);

const holdsOften = (finding: Finding): boolean =>
  finding.classification === 'repeatable' || finding.classification === 'mostly-repeatable';

export interface SignalReading {
  state: BriefSignal;
  /** The finding about the direction against the baseline that the state rests on, when there is one. */
  finding: Finding | null;
}

/** Whether any stakeholder has an expected direction of impact under any change: its own, or a variant's override. */
const anyDirection = (analysis: Analysis): boolean =>
  analysis.actors.some((actor) =>
    analysis.config.variants.some(
      (variant) =>
        variant.kind !== 'baseline' &&
        (variant.impactOverrides[actor.id] ?? actor.traits.impact.value) !== 0,
    ),
  );

/**
 * A group moves clearly when its mean final stance, or its share of simulated members looking for an
 * alternative or resisting, differs from the baseline's by the medium cut-off of an impact, on the
 * same seeds. Overall stance is a mean over groups, so groups moving in opposite ways can hide here.
 */
function someGroupMoved(analysis: Analysis, headline: Headline): boolean {
  const { baseline, variant } = headline;
  if (!baseline) return false;
  return analysis.actors.some((actor) => {
    const pairing = pairRuns(variant.runs, baseline.runs, actor.id);
    if (pairing.pairs === 0) return false;
    const members =
      variant.runs[0]?.byActor.find((entry) => entry.actorId === actor.id)?.members ?? 0;
    return (
      Math.abs(pairing.stanceDelta) >= IMPACT_CUTS.medium ||
      (members > 0 && Math.abs(pairing.adverseDelta) / members >= IMPACT_CUTS.medium)
    );
  });
}

export function readSignal(analysis: Analysis, headline: Headline | null): SignalReading {
  const finding = headline?.finding ?? null;
  // With nothing to compare against there is no comparison to read; the brief says that elsewhere.
  if (!headline || !headline.baseline || headline.variant.variant.kind !== 'alternative') {
    return { state: 'clear', finding };
  }
  // `changeCanMoveAnyone` is also false when every change has no strength. That is not a missing
  // direction, and the notice says that no stakeholder has one, so it must hold for every stakeholder.
  if (!changeCanMoveAnyone(analysis.actors, analysis.config.variants) && !anyDirection(analysis)) {
    return { state: 'no-direction', finding };
  }
  const directions = analysis.findings.filter(
    (candidate) =>
      candidate.kind === 'direction-vs-baseline' &&
      candidate.variantId === headline.variant.variant.id,
  );
  const same = directions.find((candidate) => isAboutTheSame(candidate) && holdsOften(candidate));
  const against = directions.some(
    (candidate) => !isAboutTheSame(candidate) && holdsOften(candidate),
  );
  if (same && !against && !someGroupMoved(analysis, headline)) {
    return { state: 'no-difference', finding: same };
  }
  return { state: 'clear', finding };
}

/** The statement that says so, or nothing when the comparison can be read. */
export function readingNote(signal: SignalReading): Draft | null {
  const findingIds = signal.finding ? [signal.finding.id] : [];
  if (signal.state === 'no-direction') {
    return {
      origin: 'system-assumption',
      text: BRIEF_READING_NOTES['no-direction'],
      refs: {
        assumptions: ['No stakeholder has an expected direction of impact.'],
        findingIds,
      },
    };
  }
  if (signal.state === 'no-difference') {
    return {
      origin: 'unresolved-uncertainty',
      text: BRIEF_READING_NOTES['no-difference'],
      refs: { findingIds },
    };
  }
  return null;
}
