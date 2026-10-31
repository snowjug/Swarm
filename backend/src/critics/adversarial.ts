import type { Analysis, RunSummary, SensitivityRow } from '../../../shared/analysis.js';
import type { Critique } from '../../../shared/critique.js';
import { byText, clip, draft, fixed, signed, stableId } from './text.js';
import type { Resolved, RoleCritic } from './types.js';

/** What would have to be true for the conclusion to be wrong? */
const ROLE = 'adversarial' as const;

/** A gap between variants smaller than this is within what the analysis itself treats as immaterial. */
const MIN_GAP = 0.05;
/** A sensitivity row is about the headline measure only when its base value matches the runs this closely. */
const BASE_TOLERANCE = 0.05;
/** A tested change that covers less of the gap than this is not worth raising. */
const WORTH_RAISING = 0.25;
/** Unstable findings are raised one by one up to this many; the methodology critic counts the rest. */
const MAX_UNSTABLE = 6;

const adverseShare = (run: RunSummary): number =>
  run.responseShares.switch + run.responseShares.resist;

/** The mean share of simulated members ending in switch or resist, over a variant's runs. */
function shareOf(analysis: Analysis, variantId: string): number | null {
  const runs = analysis.variants.find((variant) => variant.variantId === variantId)?.runs ?? [];
  if (runs.length === 0) return null;
  return runs.reduce((sum, run) => sum + adverseShare(run), 0) / runs.length;
}

interface Candidate {
  row: SensitivityRow;
  gap: number;
  closes: number;
  baselineLabel: string;
  baselineShare: number;
  proposedLabel: string;
  proposedShare: number;
}

/**
 * The assumption whose tested change covers most of the gap between no change and a proposed change.
 * The gap is recomputed from the runs, on the headline measure the sensitivity rows are about; a row
 * whose base value does not match that measure is left out rather than compared with the wrong thing.
 */
function gapClosers(input: Resolved): Critique[] {
  const { analysis } = input;
  const baseline = analysis.config.variants.find((variant) => variant.kind === 'baseline');
  const baselineShare = baseline ? shareOf(analysis, baseline.id) : null;
  if (!baseline || baselineShare === null) return [];

  const byRow = new Map<string, Candidate>();
  for (const variant of analysis.config.variants) {
    if (variant.kind !== 'alternative') continue;
    const proposedShare = shareOf(analysis, variant.id);
    if (proposedShare === null) continue;
    const gap = proposedShare - baselineShare;
    if (Math.abs(gap) < MIN_GAP) continue;
    for (const row of analysis.sensitivity) {
      if (
        row.classification !== 'assumption-sensitive' ||
        byRow.has(row.id) ||
        Math.abs(row.baseMean - proposedShare) > BASE_TOLERANCE ||
        Math.sign(row.shift) !== -Math.sign(gap)
      ) {
        continue;
      }
      byRow.set(row.id, {
        row,
        gap,
        closes: Math.abs(row.shift) / Math.abs(gap),
        baselineLabel: baseline.label,
        baselineShare,
        proposedLabel: variant.label,
        proposedShare,
      });
    }
  }

  const ranked = [...byRow.values()].sort(
    (a, b) => b.closes - a.closes || byText(a.row.id, b.row.id),
  );
  const [top] = ranked;
  if (!top || top.closes < WORTH_RAISING) return [];
  const { row, gap } = top;
  const unevidenced = row.assumptionOrigin !== 'evidence';
  const severity =
    top.closes >= 1 ? (unevidenced ? 'blocking' : 'major') : top.closes >= 0.5 ? 'major' : 'minor';
  const needed = Math.abs(row.perturbation) * (Math.abs(gap) / Math.abs(row.shift));
  return [
    draft(input.now, {
      id: stableId('adversarial-gap', row.id),
      role: ROLE,
      target: { kind: 'assumption', id: row.id },
      severity,
      objection: `The conclusion could be wrong if "${row.label}" is not what was assumed: testing that one assumption moved the measure by ${signed(row.shift)}, which covers ${fixed(Math.abs(row.shift))} of the ${fixed(Math.abs(gap))} gap between no change and the proposed change${top.closes >= 1 ? ' and could erase it' : ''}.`,
      basis: [
        `Gap on "${row.metric}": ${fixed(top.proposedShare)} under ${top.proposedLabel} against ${fixed(top.baselineShare)} under ${top.baselineLabel}, a difference of ${signed(gap)}.`,
        `Tested: ${row.label} (change of ${signed(row.perturbation)}); shift ${signed(row.shift)}, standard error ${fixed(row.standardError)}.`,
        `Origin of the assumption: ${row.assumptionOrigin}${row.assumptionOrigin === 'system-assumption' ? ' (no evidence supplied)' : ''}.`,
        ...(row.perturbation !== 0
          ? [`If the effect is linear, a change of about ${fixed(needed)} would close the gap.`]
          : []),
        ...ranked
          .slice(1, 3)
          .map(
            (next) =>
              `Next: ${next.row.label} covers ${fixed(Math.abs(next.row.shift))} of the gap.`,
          ),
      ],
      impact:
        'If this stands, the direction of the headline difference depends on whether this assumption holds; until it is checked, do not present the difference as settled.',
    }),
  ];
}

function unstableFindings(input: Resolved): Critique[] {
  return input.analysis.findings
    .filter((finding) => finding.classification === 'unstable')
    .slice(0, MAX_UNSTABLE)
    .map((finding) =>
      draft(input.now, {
        id: stableId('adversarial-unstable', finding.id),
        role: ROLE,
        target: { kind: 'finding', id: finding.id },
        severity: finding.actorId === null ? 'major' : 'minor',
        objection: `The finding "${clip(finding.statement, 220)}" holds in ${finding.holdsIn} of ${finding.of} seeded runs and does not hold in the other ${Math.max(0, finding.of - finding.holdsIn)}, so a conclusion that rests on it would be wrong in those runs.`,
        basis: [
          `Test applied to each run: ${finding.predicate}`,
          `Holds in ${finding.holdsIn} of ${finding.of} runs; 95% interval ${fixed(finding.interval.lo)} to ${fixed(finding.interval.hi)}; classed ${finding.classification}.`,
        ],
        impact:
          'If this stands, the statement holds in some seeded runs and fails in others, so it cannot carry a decision on its own; show it only as one possible outcome.',
      }),
    );
}

export const adversarialCritic: RoleCritic = (input) => [
  ...gapClosers(input),
  ...unstableFindings(input),
];
