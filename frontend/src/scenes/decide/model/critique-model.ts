import type { BriefSectionId, BriefVisuals, DecisionBrief } from '../../../../../shared/brief';
import {
  CRITIC_ROLES,
  CRITIQUE_SEVERITIES,
  CRITIQUE_STATUSES,
  type CriticRole,
  type Critique,
  type CritiqueSeverity,
  type CritiqueStatus,
  type CritiquesView,
} from '../../../../../shared/critique';
import { clip } from './format';

const SEVERITY_RANK: Record<CritiqueSeverity, number> = {
  blocking: 0,
  major: 1,
  minor: 2,
  note: 3,
};

/** The most serious first; an objection nobody has answered ahead of one that has been; otherwise as the server gave them. */
export function bySeriousness(critiques: readonly Critique[]): Critique[] {
  return critiques
    .map((critique, index) => ({ critique, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.critique.severity] - SEVERITY_RANK[b.critique.severity] ||
        Number(a.critique.status !== 'open') - Number(b.critique.status !== 'open') ||
        a.index - b.index,
    )
    .map((entry) => entry.critique);
}

export interface ReviewTally {
  total: number;
  /** Nobody has answered these. */
  open: number;
  /** A person has responded, accepted or disputed them. */
  answered: number;
  bySeverity: Record<CritiqueSeverity, number>;
  byStatus: Record<CritiqueStatus, number>;
  byRole: Record<CriticRole, number>;
}

export function tally(critiques: readonly Critique[]): ReviewTally {
  const bySeverity = Object.fromEntries(CRITIQUE_SEVERITIES.map((key) => [key, 0])) as Record<
    CritiqueSeverity,
    number
  >;
  const byStatus = Object.fromEntries(CRITIQUE_STATUSES.map((key) => [key, 0])) as Record<
    CritiqueStatus,
    number
  >;
  const byRole = Object.fromEntries(CRITIC_ROLES.map((key) => [key, 0])) as Record<
    CriticRole,
    number
  >;
  for (const critique of critiques) {
    bySeverity[critique.severity] += 1;
    byStatus[critique.status] += 1;
    byRole[critique.role] += 1;
  }
  return {
    total: critiques.length,
    open: byStatus.open,
    answered: critiques.length - byStatus.open,
    bySeverity,
    byStatus,
    byRole,
  };
}

export interface ReviewFilter {
  severity: CritiqueSeverity | null;
  status: 'all' | 'open' | 'answered';
  role: CriticRole | null;
}

export const NO_FILTER: ReviewFilter = { severity: null, status: 'all', role: null };

export function filterCritiques(critiques: readonly Critique[], filter: ReviewFilter): Critique[] {
  return critiques.filter(
    (critique) =>
      (filter.severity === null || critique.severity === filter.severity) &&
      (filter.role === null || critique.role === filter.role) &&
      (filter.status === 'all' ||
        (filter.status === 'open' ? critique.status === 'open' : critique.status !== 'open')),
  );
}

// ---------------------------------------------------------------------------------------------
// Where a criticism sits in the document
// ---------------------------------------------------------------------------------------------

export interface Anchors {
  /** The criticisms that stand beside a statement, by its id. A criticism stands beside one statement only. */
  byStatement: Map<string, Critique[]>;
  /** How many criticisms each chapter holds, by those that stand in it and those about the whole. */
  bySection: Map<string, Critique[]>;
  /** Criticisms of the analysis or the brief as a whole, which have no statement to stand beside. */
  ofTheWhole: Critique[];
}

function push<K>(map: Map<K, Critique[]>, key: K, critique: Critique): void {
  const list = map.get(key);
  if (list) list.push(critique);
  else map.set(key, [critique]);
}

/**
 * Places each criticism beside the statement it is about, as a note in the margin: the statement itself
 * when it names one, else the first statement, in the order the page is read, that cites what the
 * criticism is about (its finding, its stakeholder, the assumption that was moved), else the statement
 * that lists the criticism. A criticism of the analysis or of the brief as a whole stands with the
 * chapter that is about it.
 */
export function anchorCritiques(
  brief: DecisionBrief,
  critiques: readonly Critique[],
  order: readonly BriefSectionId[],
): Anchors {
  const flat = order.flatMap((id) => {
    const section = brief.sections.find((entry) => entry.id === id);
    return section ? section.statements.map((statement) => ({ section: id, statement })) : [];
  });
  const anchors: Anchors = { byStatement: new Map(), bySection: new Map(), ofTheWhole: [] };
  for (const critique of critiques) {
    const { kind, id } = critique.target;
    const found =
      kind === 'statement' || kind === 'recommendation'
        ? flat.find((entry) => entry.statement.id === id)
        : kind === 'finding'
          ? flat.find((entry) => entry.statement.refs.findingIds.includes(id))
          : kind === 'stakeholder'
            ? flat.find((entry) => entry.statement.refs.stakeholderIds.includes(id))
            : kind === 'assumption'
              ? flat.find((entry) => entry.statement.refs.sensitivityIds.includes(id))
              : undefined;
    const listed =
      found ?? flat.find((entry) => entry.statement.refs.critiqueIds.includes(critique.id));
    if (listed) {
      push(anchors.byStatement, listed.statement.id, critique);
      push(anchors.bySection, listed.section, critique);
    } else {
      anchors.ofTheWhole.push(critique);
      push(anchors.bySection, kind === 'analysis' ? 'technical-appendix' : 'limitations', critique);
    }
  }
  return anchors;
}

/** The criticisms about one thing: a finding, a stakeholder, a sensitivity row, a recommendation. */
export function aboutTarget(
  critiques: readonly Critique[],
  kind: Critique['target']['kind'],
  id: string,
): Critique[] {
  return critiques.filter((critique) => critique.target.kind === kind && critique.target.id === id);
}

// ---------------------------------------------------------------------------------------------
// Words for a criticism's subject
// ---------------------------------------------------------------------------------------------

/** What a criticism is about, in the names a reader knows, from the data the brief kept; the id alone where that is gone. */
export function subjectOf(
  target: Critique['target'],
  brief: DecisionBrief | null,
  visuals: BriefVisuals | null,
): string {
  switch (target.kind) {
    case 'analysis':
      return 'The analysis as a whole';
    case 'brief':
      return 'The decision brief';
    case 'finding': {
      const finding = visuals?.lookups.findings.find((entry) => entry.id === target.id);
      return finding ? clip(finding.statement, 110) : `Finding ${target.id}`;
    }
    case 'stakeholder': {
      const name = visuals?.lookups.stakeholders.find((entry) => entry.id === target.id)?.name;
      return name ? `The group \u201c${name}\u201d` : `Stakeholder ${target.id}`;
    }
    case 'assumption': {
      const row = visuals?.sensitivity.find((entry) => entry.id === target.id);
      return row ? clip(row.label, 110) : `Assumption ${target.id}`;
    }
    case 'recommendation': {
      const recommendation = brief?.recommendations.find((entry) => entry.id === target.id);
      return recommendation ? clip(recommendation.text, 110) : `Recommendation ${target.id}`;
    }
    case 'statement': {
      const statement = brief?.sections
        .flatMap((section) => section.statements)
        .find((entry) => entry.id === target.id);
      return statement ? clip(statement.text, 110) : `Statement ${target.id}`;
    }
  }
}

/** The review as the page reports it in a few words, from what it has already read: it adds no request. */
export function reviewHeadline(view: CritiquesView | null, failed: boolean): string | null {
  if (!view) return failed ? 'could not be read' : null;
  if (!view.critiques) return view.analysis ? 'not run yet' : 'no comparison to review';
  const stale = view.critiques.analysisId !== view.analysis?.id && view.analysis !== null;
  const { total, open } = tally(view.critiques.critiques);
  const tail = stale ? ', of an earlier comparison' : '';
  if (total === 0) return `no criticism raised${tail}`;
  return open === 0 ? `all ${total} answered${tail}` : `${open} open${tail}`;
}

/**
 * Whether a note the server made about how the review was made is about the conflicts between the sources. The notes
 * are plain sentences, so this reads the sentence: where it speaks of conflicts, the sheet offers the way to them
 * (Ground builds the check of the sources when it is opened, and the review is run again after it).
 */
export function mentionsConflicts(note: string): boolean {
  return /\bconflicts?\b/iu.test(note);
}
