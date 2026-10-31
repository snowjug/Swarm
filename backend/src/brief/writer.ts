import {
  BRIEF_SECTION_TITLES,
  type BriefRefs,
  type BriefSection,
  type BriefSectionId,
  type BriefStatement,
  type StatementOrigin,
  type VisualKind,
} from '../../../shared/brief.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import { uniqueRefs } from './evidence.js';
import { lintStatement } from './lint.js';
import { refsSatisfyOrigin, type Reliance } from './rules.js';
import { clip, oneLine } from './text.js';

export const MAX_STATEMENTS = 40;

/** An evidence reference cut to what the schema allows, so that a long quotation cannot make a brief unwritable. */
const boundRef = (ref: EvidenceRef): EvidenceRef => ({
  ...ref,
  passageId: clip(ref.passageId, 40),
  documentId: clip(ref.documentId, 80),
  documentName: clip(ref.documentName, 200),
  quote: ref.quote === null ? null : clip(ref.quote, 600),
  contentHash: clip(ref.contentHash, 100),
  ...(ref.conflictId === undefined ? {} : { conflictId: clip(ref.conflictId, 80) }),
});

/** Fills in and bounds a set of references to what the schema allows. */
export function normaliseRefs(refs: Partial<BriefRefs> = {}): BriefRefs {
  const unique = <T>(items: readonly T[] | undefined, limit: number): T[] =>
    [...new Set(items ?? [])].slice(0, limit);
  return {
    evidence: uniqueRefs(refs.evidence ?? [])
      .slice(0, 4)
      .map(boundRef),
    stakeholderIds: unique(refs.stakeholderIds, 8),
    findingIds: unique(refs.findingIds, 8),
    sensitivityIds: unique(refs.sensitivityIds, 8),
    critiqueIds: unique(refs.critiqueIds, 8),
    assumptions: unique(
      (refs.assumptions ?? []).map((text) => clip(oneLine(text), 300)).filter(Boolean),
      6,
    ),
    documentIds: unique(
      (refs.documentIds ?? []).map((id) => clip(id, 80)),
      8,
    ),
    variantIds: unique(refs.variantIds, 8),
  };
}

/** What the builder did to keep the brief honest, counted so that it can be said. */
export interface Tally {
  /** Statements whose wording broke the guard and were replaced. */
  withheld: number;
  /** Statements that named an origin they had nothing to rest on, and were given the one they have. */
  downgraded: number;
}

export interface Draft {
  origin: StatementOrigin;
  text: string;
  refs?: Partial<BriefRefs>;
  reliance?: Reliance | null;
  /** Overrides the numbered id, for statements other parts of the brief refer to. */
  id?: string;
}

export interface SectionWriter {
  id: BriefSectionId;
  add(draft: Draft): BriefStatement;
  build(visuals?: VisualKind[]): BriefSection;
}

/**
 * Collects the statements of one section. Every statement passes the same two gates: an origin must
 * have what it names to rest on (otherwise it is given the origin that fits, which is that nothing is
 * known), and the wording must pass the guard (otherwise it is withheld and says so).
 */
export function sectionWriter(id: BriefSectionId, tally: Tally): SectionWriter {
  const statements: BriefStatement[] = [];
  const add = (draft: Draft): BriefStatement => {
    const refs = normaliseRefs(draft.refs);
    let origin = draft.origin;
    let reliance = draft.reliance ?? null;
    if (!refsSatisfyOrigin(origin, refs)) {
      origin = 'unresolved-uncertainty';
      tally.downgraded += 1;
    }
    let text = clip(oneLine(draft.text), 700);
    const statementId = draft.id ?? `${id}-${statements.length + 1}`;
    const issues = lintStatement({ text, origin }, `${id}/${statementId}`);
    if (issues.length > 0) {
      tally.withheld += 1;
      text = `A statement was withheld here because its wording broke the guard (${[
        ...new Set(issues.map((issue) => issue.rule)),
      ].join(', ')}).`;
      origin = 'unresolved-uncertainty';
      reliance = null;
    }
    const statement: BriefStatement = { id: statementId, text, origin, refs, reliance };
    statements.push(statement);
    return statement;
  };
  const build = (visuals: VisualKind[] = []): BriefSection => {
    let kept = statements;
    if (statements.length > MAX_STATEMENTS) {
      const omitted = statements.length - (MAX_STATEMENTS - 1);
      kept = [
        ...statements.slice(0, MAX_STATEMENTS - 1),
        {
          id: `${id}-more`,
          text: `${omitted} further statements are not shown here, to keep the brief readable; the technical appendix and the exports hold the full data.`,
          origin: 'unresolved-uncertainty',
          refs: normaliseRefs(),
          reliance: null,
        },
      ];
    }
    return { id, title: BRIEF_SECTION_TITLES[id], statements: kept, visuals };
  };
  return { id, add, build };
}
