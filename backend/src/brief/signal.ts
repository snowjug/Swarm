import type { Analysis, Finding, StabilityClass } from '../../../shared/analysis.js';
import { BRIEF_READING_NOTES, type BriefSignal } from '../../../shared/brief.js';
import { actorsWithDirection, changeCanMoveAnyone } from '../../../shared/signal.js';
import { MATERIAL_SHIFT } from '../analysis/sensitivity.js';
import { classifyStability } from '../analysis/stats.js';
import {
  measureVariants,
  pairRuns,
  type Headline,
  type Pairing,
  type VariantMeasure,
} from './measures.js';
import { IMPACT_CUTS } from './rules.js';
import type { Draft } from './writer.js';

/**
 * Whether the comparison of the proposed change with no change can be read as a result about the change.
 *
 * It cannot when the simulator is certain to give the same outcome with the change as without it, which
 * is so when no stakeholder has an expected direction of impact and nothing else in the scenarios
 * reaches anyone (`no-direction`). It also says nothing when the change can move members and the
 * comparison still found the two about the same, in most paired seeded runs, with no other finding
 * against it and no group moving clearly on its own (`no-difference`). In both cases the brief says so
 * first and does not lead with counts.
 *
 * The state is the proposed change's, the first alternative the analysis ran. Every other scenario is
 * read against no change on its own findings (`sameAs`): one that differs repeatably is never worded as
 * about the same because the proposed change was.
 */

const SAME = /\bended up about the same under\b/u;

/** The analysis's finding that the change and no change ended up about the same on the same seeds. */
export const isAboutTheSame = (finding: Finding): boolean =>
  finding.kind === 'direction-vs-baseline' && SAME.test(finding.statement);

const often = (classification: StabilityClass): boolean =>
  classification === 'repeatable' || classification === 'mostly-repeatable';
const holdsOften = (finding: Finding): boolean => often(finding.classification);

export interface SignalReading {
  /** What the proposed change's comparison with no change can be read as. */
  state: BriefSignal;
  /** The finding about the direction against the baseline that the state rests on, when there is one. */
  finding: Finding | null;
  /** No stakeholder has an expected direction of impact, yet the change can move members, in either direction. */
  undirected: boolean;
  /** The scenarios that read as about the same as no change, each with the finding that says so. */
  sameAs: ReadonlyMap<string, Finding>;
  /** When the proposed change reads as about the same: the findings that say another scenario did not. */
  differing: readonly Finding[];
}

/** The one note a section that sets scenarios side by side opens with when no stakeholder has a direction but members can still move. */
export const UNDIRECTED_READING_NOTE =
  'No stakeholder has an expected direction of impact, so a difference between a scenario and no change in this section follows from how widely members of a group are assumed to differ in how the change lands on them, or from edits to a scenario, and not from anyone being helped or harmed. Say who is helped or harmed in the stakeholder review before reading it as an effect of the change.';

/**
 * Whether a comparison of one scenario with the baseline on the same seeds shows a movement: in the
 * mean final stance or in the share of simulated members looking for an alternative or resisting by
 * the medium cut-off of an impact, or in that share by at least what sensitivity calls too small to
 * matter and in most of the paired runs the same way. A small shift that holds in nearly every
 * paired run is measured, and is not called no difference.
 */
function moves(pairing: Pairing, members: number): boolean {
  if (pairing.pairs === 0 || members === 0) return false;
  const share = Math.abs(pairing.adverseDelta) / members;
  const steady = often(classifyStability(Math.max(pairing.worse, pairing.better), pairing.pairs));
  return (
    Math.abs(pairing.stanceDelta) >= IMPACT_CUTS.medium ||
    share >= IMPACT_CUTS.medium ||
    (steady && share >= MATERIAL_SHIFT)
  );
}

/**
 * Some group moves clearly, or all the members together do. Overall stance is a mean over groups, so
 * groups moving in opposite ways can hide there. Where the runs kept no per-group detail, the totals
 * kept for each scenario are compared instead; with neither, nothing says that no group moved, so one
 * is taken to have.
 */
function someGroupMoved(
  analysis: Analysis,
  measure: VariantMeasure,
  baseline: VariantMeasure,
): boolean {
  if (moves(pairRuns(measure.runs, baseline.runs), measure.members ?? 0)) return true;
  const totals = (variantId: string, actorId: string) =>
    analysis.variants
      .find((result) => result.variantId === variantId)
      ?.actors?.find((entry) => entry.actorId === actorId);
  return analysis.actors.some((actor) => {
    const pairing = pairRuns(measure.runs, baseline.runs, actor.id);
    if (pairing.pairs > 0) {
      const members =
        measure.runs[0]?.byActor.find((entry) => entry.actorId === actor.id)?.members ?? 0;
      return moves(pairing, members);
    }
    const after = totals(measure.variant.id, actor.id);
    const before = totals(baseline.variant.id, actor.id);
    if (!after || !before) return true;
    const adverse = (entry: typeof after): number =>
      entry.responseShares.switch + entry.responseShares.resist;
    return (
      Math.abs(after.stanceMean - before.stanceMean) >= IMPACT_CUTS.medium ||
      Math.abs(adverse(after) - adverse(before)) >= IMPACT_CUTS.medium
    );
  });
}

/**
 * The finding that reads one scenario as about the same as no change, when its own findings allow it:
 * the finding held in most seeded runs, no other finding about it says it moved things, repeatably, and
 * no group moved clearly on its own.
 */
function aboutTheSame(
  analysis: Analysis,
  measure: VariantMeasure,
  baseline: VariantMeasure,
): Finding | null {
  const directions = analysis.findings.filter(
    (candidate) =>
      candidate.kind === 'direction-vs-baseline' && candidate.variantId === measure.variant.id,
  );
  const same = directions.find((candidate) => isAboutTheSame(candidate) && holdsOften(candidate));
  const against = directions.some(
    (candidate) => !isAboutTheSame(candidate) && holdsOften(candidate),
  );
  return same && !against && !someGroupMoved(analysis, measure, baseline) ? same : null;
}

export function readSignal(analysis: Analysis, headline: Headline | null): SignalReading {
  const finding = headline?.finding ?? null;
  const { actors } = analysis;
  const { variants } = analysis.config;
  // With nothing to compare against there is no comparison to read; the brief says that elsewhere.
  if (!headline || !headline.baseline || headline.variant.variant.kind !== 'alternative') {
    return { state: 'clear', finding, undirected: false, sameAs: new Map(), differing: [] };
  }
  const canMove = changeCanMoveAnyone(actors, variants);
  const directed = actorsWithDirection(actors, variants).length > 0;
  // The notice says that no stakeholder has a direction, so it must hold for every stakeholder: a
  // change that has no strength is not a missing direction, and reads on its findings like any other.
  if (!canMove && !directed) {
    return {
      state: 'no-direction',
      finding,
      undirected: false,
      sameAs: new Map(),
      differing: [],
    };
  }
  const { baseline } = headline;
  const sameAs = new Map<string, Finding>();
  for (const measure of measureVariants(analysis)) {
    if (measure.variant.kind !== 'alternative') continue;
    const same = aboutTheSame(analysis, measure, baseline);
    if (same) sameAs.set(measure.variant.id, same);
  }
  const headlineId = headline.variant.variant.id;
  const own = sameAs.get(headlineId);
  const alternatives = new Set(
    variants.filter((variant) => variant.kind === 'alternative').map((variant) => variant.id),
  );
  return {
    state: own ? 'no-difference' : 'clear',
    finding: own ?? finding,
    undirected: !directed,
    sameAs,
    differing: own
      ? analysis.findings.filter(
          (candidate) =>
            candidate.kind === 'direction-vs-baseline' &&
            candidate.variantId !== headlineId &&
            alternatives.has(candidate.variantId) &&
            !isAboutTheSame(candidate) &&
            holdsOften(candidate),
        )
      : [],
  };
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
      text: signal.undirected
        ? `${BRIEF_READING_NOTES['no-difference']} ${UNDIRECTED_READING_NOTE}`
        : BRIEF_READING_NOTES['no-difference'],
      refs: { findingIds },
    };
  }
  if (signal.undirected) {
    return {
      origin: 'system-assumption',
      text: UNDIRECTED_READING_NOTE,
      refs: {
        assumptions: ['No stakeholder has an expected direction of impact.'],
        findingIds,
      },
    };
  }
  return null;
}
