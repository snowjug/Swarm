import {
  BRIEF_SECTION_TITLES,
  BRIEF_SIGNAL_NOTICES,
  type BriefComparisonRow,
  type BriefSection,
  type BriefSectionId,
  type BriefSignal,
  type BriefStatement,
  type BriefView,
  type BriefVisuals,
  type DecisionBrief,
} from '../../../../../shared/brief';
import {
  ANALYSIS_INPUT_NAMES,
  COMPARISON_INPUTS_UNRECORDED,
  NEWER_ANALYSIS_EXISTS,
  comparisonInputsUnrecorded,
  inputsInWords,
  staleComparisonInputs,
  type AnalysisInput,
} from '../../../../../shared/analysis';
import { listed, plural } from './format';

// ---------------------------------------------------------------------------------------------
// The executive answer
// ---------------------------------------------------------------------------------------------

/** The parts of the executive answer, which the engine writes in a fixed order and labels in words. */
export type AnswerRole =
  | 'decision'
  | 'recommendation'
  | 'comparison'
  | 'groups'
  | 'caveat'
  | 'also-open'
  | 'settle'
  | 'stability'
  | 'limits';

const ANSWER_PATTERNS: readonly (readonly [AnswerRole, RegExp])[] = [
  ['decision', /^(?:Decision evaluated|The question asked):/u],
  ['recommendation', /^Recommendation, conditional/u],
  [
    'groups',
    /^(?:The groups whose own share|Which groups moved most is not stated|No simulated group)/u,
  ],
  ['caveat', /^Biggest open caveat:/u],
  ['also-open', /^Also open:/u],
  ['settle', /^What would settle/u],
  ['stability', /^Stability:/u],
  ['limits', /^What this does not tell you/u],
  ['comparison', /^With .+?, /u],
];

/** What an executive-answer statement is for, from the words the engine opens it with; null when it is none of them. */
export function answerRole(statement: BriefStatement): AnswerRole | null {
  for (const [role, pattern] of ANSWER_PATTERNS) if (pattern.test(statement.text)) return role;
  return null;
}

/** The statements of the executive answer by what they are for, each kept in the order the brief gives it. */
export function answerParts(
  statements: readonly BriefStatement[],
): Partial<Record<AnswerRole, BriefStatement[]>> {
  const parts: Partial<Record<AnswerRole, BriefStatement[]>> = {};
  for (const statement of statements) {
    const role = answerRole(statement);
    if (role) (parts[role] ??= []).push(statement);
  }
  return parts;
}

/** A statement that opens with a label and a colon, split into the label and what follows. */
export function leadIn(text: string): { label: string; rest: string } | null {
  const match = /^([A-Z][^:\u201c\u201d]{2,60}?):\s+(\S[\s\S]*)$/u.exec(text);
  return match ? { label: match[1]!, rest: match[2]! } : null;
}

// ---------------------------------------------------------------------------------------------
// The hero: what happened, in the brief's own numbers
// ---------------------------------------------------------------------------------------------

/** A difference smaller than this, in a share, is read as no net difference: the engine's own threshold. */
export const NO_NET_DIFFERENCE = 0.0005;

/** What the figures on the first screen are, said under the answer itself so that it is read with it at every width. */
export const SIMULATION_NOTE = 'Counts from a simulation under stated assumptions, not a forecast.';

export interface HeroRow {
  variantId: string;
  label: string;
  baselineLabel: string;
  /** The share of simulated members ending in switch or resist, every actor counting equally: 0 to 1. */
  share: number;
  baselineShare: number | null;
  delta: number | null;
  error: number | null;
  pairedRuns: number;
  /** Paired seeds in which the share was higher under the change. */
  higherIn: number;
  direction: 'higher' | 'lower' | 'same' | null;
  /** How steadily the direction held across paired seeds. */
  steadiness: 'steady' | 'mixed' | 'unpaired';
  findingId: string | null;
  classification: BriefComparisonRow['classification'];
  holdsIn: number | null;
  of: number | null;
  /** True when the comparison must not be read as an effect of the change (the brief's signal says so). */
  unread: boolean;
}

export interface HeroModel {
  signal: BriefSignal;
  rows: HeroRow[];
  runsPerVariant: number;
}

/**
 * The comparison the page leads with, one row for each alternative, from the data the brief kept. A
 * signal other than `clear` is said of the proposed change, the first alternative, and for
 * `no-direction` of all of them: those rows are marked `unread`.
 */
export function deriveHero(brief: DecisionBrief, visuals: BriefVisuals | null): HeroModel | null {
  if (!visuals) return null;
  const baseline = visuals.outcomeDistribution.find((row) => row.kind === 'baseline');
  const rows: HeroRow[] = visuals.scenarioComparison.map((row, index) => {
    const delta = row.shareDelta;
    const steadiness: HeroRow['steadiness'] =
      delta === null || row.pairedRuns === 0
        ? 'unpaired'
        : Math.max(row.worseInRuns, row.pairedRuns - row.worseInRuns) / row.pairedRuns >= 0.8
          ? 'steady'
          : 'mixed';
    return {
      variantId: row.variantId,
      label: row.label,
      baselineLabel: baseline?.label ?? 'No change',
      share: row.adverseShare,
      baselineShare: row.baselineAdverseShare,
      delta,
      error: row.shareDeltaError,
      pairedRuns: row.pairedRuns,
      higherIn: row.worseInRuns,
      direction:
        delta === null
          ? null
          : Math.abs(delta) < NO_NET_DIFFERENCE
            ? 'same'
            : delta > 0
              ? 'higher'
              : 'lower',
      steadiness,
      findingId: row.findingId,
      classification: row.classification,
      holdsIn: row.holdsIn,
      of: row.of,
      unread: brief.signal === 'no-direction' || (brief.signal === 'no-difference' && index === 0),
    };
  });
  return { signal: brief.signal, rows, runsPerVariant: visuals.runsPerVariant };
}

const SHARE_PHRASE = 'the share of simulated members looking for an alternative or resisting';

/** The sentence the page leads with for one comparison, in the brief's own measure and no stronger than it. */
export function verdictOf(row: HeroRow, signal: BriefSignal): string {
  if (row.unread) {
    return signal === 'no-direction'
      ? BRIEF_SIGNAL_NOTICES['no-direction'].title
      : BRIEF_SIGNAL_NOTICES['no-difference'].title;
  }
  if (row.delta === null || row.direction === null) {
    return `Under ${row.label}, simulated members ended up looking for an alternative or resisting in about the numbers shown.`;
  }
  return row.direction === 'same'
    ? `${row.label} made no net difference to ${SHARE_PHRASE}.`
    : `${row.label} ${row.direction === 'higher' ? 'raised' : 'lowered'} ${SHARE_PHRASE}.`;
}

// ---------------------------------------------------------------------------------------------
// The chapters
// ---------------------------------------------------------------------------------------------

export type Act = 'happened' | 'why' | 'do' | 'ground';

export const ACTS: readonly { id: Act; label: string }[] = [
  { id: 'happened', label: 'What happened' },
  { id: 'why', label: 'Why' },
  { id: 'do', label: 'What to do' },
  { id: 'ground', label: 'On what ground' },
];

export type ChapterId = Exclude<BriefSectionId, 'executive-answer'> | 'review';

export interface ChapterSpec {
  id: ChapterId;
  act: Act;
  /** Reference chapters are closed until they are wanted: one line of the page each. */
  reference: boolean;
  /** How many statements are shown before "show all". */
  show: number;
}

/**
 * The order the page is read in. The brief's own order puts the evidence base third; here it follows what
 * the answer rests on, after the recommendations and the checks, and the independent review sits beside it.
 */
export const CHAPTERS: readonly ChapterSpec[] = [
  { id: 'decision', act: 'happened', reference: false, show: 4 },
  { id: 'stakeholders', act: 'happened', reference: false, show: 2 },
  { id: 'reaction-patterns', act: 'happened', reference: false, show: 3 },
  { id: 'alternative-outcomes', act: 'happened', reference: false, show: 3 },
  { id: 'first-order', act: 'happened', reference: false, show: 3 },
  { id: 'second-order', act: 'happened', reference: false, show: 3 },
  { id: 'drivers', act: 'why', reference: false, show: 3 },
  { id: 'assumptions', act: 'why', reference: true, show: 3 },
  { id: 'uncertainty', act: 'why', reference: false, show: 3 },
  { id: 'risks-opportunities', act: 'do', reference: false, show: 6 },
  { id: 'recommendations', act: 'do', reference: false, show: 1 },
  { id: 'validation-plan', act: 'do', reference: false, show: 1 },
  { id: 'evidence-base', act: 'ground', reference: true, show: 4 },
  { id: 'sources', act: 'ground', reference: true, show: 5 },
  { id: 'review', act: 'ground', reference: false, show: 0 },
  { id: 'limitations', act: 'ground', reference: true, show: 4 },
  { id: 'technical-appendix', act: 'ground', reference: true, show: 4 },
];

export const REVIEW_TITLE = 'Independent review';

export interface Chapter {
  spec: ChapterSpec;
  /** The brief's own section; null for the review, which the brief does not hold. */
  section: BriefSection | null;
  title: string;
}

/** The chapters the brief holds, in reading order, with the review in its place. Sections the page does not know are kept at the end. */
export function chaptersOf(brief: DecisionBrief): Chapter[] {
  const byId = new Map(brief.sections.map((section) => [section.id, section]));
  const known = new Set<string>(CHAPTERS.map((spec) => spec.id));
  const chapters: Chapter[] = [];
  for (const spec of CHAPTERS) {
    if (spec.id === 'review') {
      chapters.push({ spec, section: null, title: REVIEW_TITLE });
      continue;
    }
    const section = byId.get(spec.id);
    if (section)
      chapters.push({ spec, section, title: section.title || BRIEF_SECTION_TITLES[spec.id] });
  }
  for (const section of brief.sections) {
    if (section.id === 'executive-answer' || known.has(section.id)) continue;
    chapters.push({
      spec: { id: section.id as ChapterId, act: 'ground', reference: true, show: 4 },
      section,
      title: section.title,
    });
  }
  return chapters;
}

/** The first chapter of each act, so that a contents list can say where a new act begins. */
export function actsOf(
  chapters: readonly Chapter[],
): { act: Act; label: string; chapters: Chapter[] }[] {
  return ACTS.flatMap(({ id, label }) => {
    const own = chapters.filter((chapter) => chapter.spec.act === id);
    return own.length > 0 ? [{ act: id, label, chapters: own }] : [];
  });
}

export const ANSWER_ANCHOR = 'brief-answer';
/** The column of chapters, which the contents can be skipped to. */
export const CHAPTERS_ANCHOR = 'brief-chapters';
export const anchorOf = (id: ChapterId): string => `brief-${id}`;

/** The chapter a link or an address names: `#brief-<id>`, or null for anything else. */
export function chapterFromHash(
  hash: string,
  present: readonly ChapterId[],
): ChapterId | 'answer' | null {
  const name = hash.replace(/^#/u, '');
  if (name === ANSWER_ANCHOR || name === 'brief-executive-answer') return 'answer';
  return present.find((id) => anchorOf(id) === name) ?? null;
}

const count = (value: number, one: string, many?: string): string => plural(value, one, many);

/** A line of numbers under a chapter's title, from the structured data the brief keeps; null when there is nothing to count. */
export function gistOf(
  id: ChapterId,
  brief: DecisionBrief,
  visuals: BriefVisuals | null,
): string | null {
  switch (id) {
    case 'decision':
      return brief.methodology.variants.length > 0
        ? `${count(brief.methodology.variants.length, 'scenario')} simulated`
        : null;
    case 'stakeholders': {
      if (!visuals) return null;
      const all = visuals.stakeholderMap.flatMap((group) => group.stakeholders);
      const harmed = all.filter((entry) => entry.direction === 'harmed').length;
      return all.length === 0
        ? null
        : `${count(all.length, 'group')}${harmed > 0 ? ` \u00b7 ${harmed} expected to be harmed` : ''}`;
    }
    case 'reaction-patterns':
      return visuals
        ? `${count(visuals.runsPerVariant, 'seeded run')} for each of ${count(visuals.outcomeDistribution.length, 'scenario')}`
        : null;
    case 'alternative-outcomes':
      return visuals && visuals.scenarioComparison.length > 0
        ? `${count(visuals.scenarioComparison.length, 'alternative')} against the baseline, on the same seeds`
        : null;
    case 'drivers':
      return visuals && visuals.sensitivity.length > 0
        ? `${count(visuals.sensitivity.length, 'move')} tested, one assumption at a time`
        : null;
    case 'assumptions': {
      const rows = visuals?.assumptionRegister ?? [];
      const sensitive = rows.filter((row) => row.sensitive).length;
      return rows.length === 0
        ? null
        : `${count(rows.length, 'assumption')}${sensitive > 0 ? ` \u00b7 ${sensitive} the result is sensitive to` : ''}`;
    }
    case 'uncertainty': {
      const findings = visuals?.lookups.findings ?? [];
      const steady = findings.filter((finding) => finding.classification === 'repeatable').length;
      return findings.length === 0
        ? null
        : `${count(findings.length, 'finding')} \u00b7 ${steady} repeatable`;
    }
    case 'recommendations':
      return brief.recommendations.length > 0
        ? `${count(brief.recommendations.length, 'recommendation')}, best first`
        : null;
    case 'validation-plan':
      return brief.validationPlan.length > 0
        ? `${count(brief.validationPlan.length, 'check')} \u00b7 none has been run`
        : null;
    case 'evidence-base': {
      const rows = visuals?.evidenceMap ?? [];
      const gaps = rows.filter((row) => row.gap).length;
      return rows.length === 0
        ? null
        : `${rows.length - gaps} of ${count(rows.length, 'group')} have cited support`;
    }
    case 'sources':
      return visuals && visuals.lookups.documents.length > 0
        ? count(visuals.lookups.documents.length, 'document')
        : null;
    case 'limitations':
      return brief.limitations.length > 0 ? count(brief.limitations.length, 'limitation') : null;
    case 'technical-appendix': {
      const { runsPerVariant, baseSeed, rounds } = brief.methodology;
      return `${runsPerVariant} runs of ${rounds} rounds \u00b7 seeds ${baseSeed} to ${baseSeed + runsPerVariant - 1}`;
    }
    default:
      return null;
  }
}

/** The statements of a chapter that its own visual does not already say: recommendations and checks are drawn from their own lists. */
export function chapterStatements(section: BriefSection): BriefStatement[] {
  return section.statements.filter(
    (statement) =>
      !(section.id === 'recommendations' && statement.id.startsWith('rec-')) &&
      !(section.id === 'validation-plan' && statement.id.startsWith('val-')),
  );
}

/** What kind of line a risks-and-opportunities statement is, from the label the engine opens it with. */
export function riskKind(text: string): 'risk' | 'opportunity' | null {
  if (/^Risk(?: from outside the organisation)?:/u.test(text)) return 'risk';
  if (/^Opportunity(?: from outside the organisation)?:/u.test(text)) return 'opportunity';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------------------------

export interface Freshness {
  /** Nothing the brief rests on has changed. */
  current: boolean;
  /** The documents the comparison was made from that changed after it ran: only running it again helps. */
  rerun: AnalysisInput[];
  /** The comparison recorded nothing of what it was made from, so whether it is current cannot be told. */
  unrecorded: boolean;
  /** Everything that changed, in words. */
  changed: string[];
  /** What a person would do: run the comparison again, or write the brief again. */
  action: 'rerun' | 'regenerate' | null;
  /** The charts show the project as it is now, not as it was when the brief was made. */
  chartsFromNow: boolean;
  summary: string;
}

const CHANGE_WORDS: Record<string, string> = {
  critiques: 'the independent review',
  analysis: 'the comparison',
  ...ANALYSIS_INPUT_NAMES,
};

const NO_LONGER_STORED = 'analysis (no longer stored)';

export function freshnessOf(view: Pick<BriefView, 'changedSince' | 'visualsFrom'>): Freshness {
  const { changedSince } = view;
  const unrecorded = comparisonInputsUnrecorded(changedSince);
  const entries = changedSince.filter((entry) => entry !== COMPARISON_INPUTS_UNRECORDED);
  const rerun = staleComparisonInputs(changedSince);
  const action: Freshness['action'] =
    rerun.length > 0 || unrecorded ? 'rerun' : entries.length > 0 ? 'regenerate' : null;
  const others = entries
    .filter(
      (entry) =>
        !(rerun as string[]).includes(entry) &&
        entry !== NEWER_ANALYSIS_EXISTS &&
        entry !== NO_LONGER_STORED,
    )
    .map((entry) => CHANGE_WORDS[entry] ?? entry);
  const sentences = [
    rerun.length > 0
      ? `The comparison it rests on was run before ${inputsInWords(rerun)} changed, so it describes the project as it was.`
      : '',
    others.length > 0 ? `Since it was made, ${listed(others)} changed.` : '',
    entries.includes(NEWER_ANALYSIS_EXISTS) ? 'A newer comparison exists.' : '',
    entries.includes(NO_LONGER_STORED)
      ? 'The comparison it was made from is no longer stored.'
      : '',
  ].filter((sentence) => sentence !== '');
  return {
    current: changedSince.length === 0,
    rerun,
    unrecorded,
    changed: entries.map((entry) => CHANGE_WORDS[entry] ?? entry),
    action,
    chartsFromNow: view.visualsFrom === 'current',
    summary: sentences.join(' '),
  };
}
