import {
  RESPONSE_CATEGORIES,
  STABILITY_CLASSES,
  type ResponseCategory,
  type StabilityClass,
} from '../../../../../shared/analysis';
import type {
  BriefAssumptionRow,
  BriefEvidenceRow,
  BriefSensitivityRow,
  BriefVisuals,
  Recommendation,
} from '../../../../../shared/brief';

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

/** The responses from the most favourable to the least, which is the order they are drawn in. */
export const RESPONSE_ORDER: readonly ResponseCategory[] = RESPONSE_CATEGORIES;

/** How far toward the adverse end of the diverging scale each response sits, from 0 (in favour) to 1 (against). */
export const RESPONSE_POSITION: Record<ResponseCategory, number> = {
  adopt: 0,
  'accept-with-conditions': 0.2,
  wait: 0.5,
  'adapt-defensively': 0.72,
  switch: 0.88,
  resist: 1,
};

// ---------------------------------------------------------------------------------------------
// Stability of findings
// ---------------------------------------------------------------------------------------------

export interface StabilityBand {
  classification: StabilityClass;
  findings: BriefVisuals['lookups']['findings'];
}

/** The findings grouped by how steadily they held across the seeded runs, the steadiest first. */
export function stabilityBands(findings: BriefVisuals['lookups']['findings']): StabilityBand[] {
  return STABILITY_CLASSES.flatMap((classification) => {
    const own = findings
      .filter((finding) => finding.classification === classification)
      .sort((a, b) => b.interval.lo - a.interval.lo || b.holdsIn / b.of - a.holdsIn / a.of);
    return own.length > 0 ? [{ classification, findings: own }] : [];
  });
}

// ---------------------------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------------------------

/** The assumptions that moved the outcome most first, each by how far it moved it, whichever way. */
export function tornadoRows(rows: readonly BriefSensitivityRow[]): BriefSensitivityRow[] {
  return [...rows].sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift));
}

/** The longest reach of any bar, a shift and its standard error either side of it, so that every bar fits on one scale. */
export function tornadoReach(rows: readonly BriefSensitivityRow[]): number {
  return Math.max(...rows.map((row) => Math.abs(row.shift) + row.standardError), Number.EPSILON);
}

// ---------------------------------------------------------------------------------------------
// Evidence and assumptions
// ---------------------------------------------------------------------------------------------

/** The groups nothing cited supports first, then those with the least, then by name: where the evidence is thinnest. */
export function evidenceByThinness(rows: readonly BriefEvidenceRow[]): BriefEvidenceRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.gap) - Number(a.gap) ||
      a.supporting - b.supporting ||
      b.contradicting - a.contradicting ||
      a.name.localeCompare(b.name),
  );
}

export type AssumptionFilter = 'all' | 'sensitive' | 'unevidenced';

export function filterAssumptions(
  rows: readonly BriefAssumptionRow[],
  filter: AssumptionFilter,
): BriefAssumptionRow[] {
  if (filter === 'sensitive') return rows.filter((row) => row.sensitive);
  if (filter === 'unevidenced') return rows.filter((row) => !row.evidenced);
  return [...rows];
}

// ---------------------------------------------------------------------------------------------
// Recommendations: impact against effort
// ---------------------------------------------------------------------------------------------

export type Level = 'low' | 'medium' | 'high';
export const LEVELS: readonly Level[] = ['low', 'medium', 'high'];

export interface PlotCell {
  /** 0 is the lowest effort, on the left. */
  column: number;
  /** 0 is the highest impact, at the top. */
  row: number;
  impact: Level;
  effort: Level;
  recommendations: Recommendation[];
}

/** The nine cells of the plot, each with the recommendations that fall in it, the best-ranked first. */
export function plotCells(recommendations: readonly Recommendation[]): PlotCell[] {
  const ordered = [...recommendations].sort((a, b) => a.priority - b.priority);
  const cells: PlotCell[] = [];
  for (let row = 0; row < LEVELS.length; row += 1) {
    for (let column = 0; column < LEVELS.length; column += 1) {
      const impact = LEVELS[LEVELS.length - 1 - row]!;
      const effort = LEVELS[column]!;
      cells.push({
        column,
        row,
        impact,
        effort,
        recommendations: ordered.filter(
          (recommendation) => recommendation.impact === impact && recommendation.effort === effort,
        ),
      });
    }
  }
  return cells;
}

/** The recommendation text as a short sentence for a label, from the plot's own words. */
export function plotSummary(recommendations: readonly Recommendation[]): string {
  const ordered = [...recommendations].sort((a, b) => a.priority - b.priority);
  return ordered
    .map(
      (recommendation) =>
        `Recommendation ${recommendation.priority}: ${recommendation.impact} impact, ${recommendation.effort} effort`,
    )
    .join('; ');
}

// ---------------------------------------------------------------------------------------------
// Validation: effort and time
// ---------------------------------------------------------------------------------------------

/** How many of the three effort steps are filled. */
export const effortSteps = (level: Level): number => LEVELS.indexOf(level) + 1;
