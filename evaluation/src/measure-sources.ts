import { getDomain } from 'tldts';
import { normaliseText, rateOf, type Rate } from './measure-stats.js';

export type ObservedOutcome =
  'used' | 'read' | 'quarantined' | 'blocked' | 'failed' | 'duplicate' | 'skipped' | 'not-fetched';

/** What the crawler did with one fixture page, in the harness's own words. */
export interface PageObservation {
  id: string;
  outcome: ObservedOutcome;
  quarantine: string | null;
  failure: string | null;
  category: string | null;
  authority: string | null;
  /** The text the page was read as, when it was read at all. */
  text: string | null;
}

export interface PageLabel {
  id: string;
  outcome: string;
  quarantine: string | null;
  failure: string | null;
  category: string | null;
  authority: string | null;
  hostile: boolean;
  main: readonly string[];
  boilerplate: readonly string[];
}

export interface Pair {
  gold: PageLabel;
  seen: PageObservation;
}

// ---------------------------------------------------------------------------------------------
// Quarantine
// ---------------------------------------------------------------------------------------------

export interface QuarantineScores {
  byReason: Record<string, Rate>;
  /** Over the pages labelled quarantined: set aside, and for the labelled reason. */
  recall: Rate;
  /** Over the pages labelled used: set aside as quarantined. */
  falseQuarantines: Rate;
  confusions: { id: string; gold: string; observed: string }[];
}

export function scoreQuarantine(pairs: readonly Pair[]): QuarantineScores {
  const labelled = pairs.filter((pair) => pair.gold.outcome === 'quarantined');
  const reasons = [...new Set(labelled.map((pair) => pair.gold.quarantine ?? 'none'))].sort();
  const byReason: Record<string, Rate> = {};
  for (const reason of reasons) {
    const own = labelled.filter((pair) => (pair.gold.quarantine ?? 'none') === reason);
    byReason[reason] = rateOf(own.filter(sameReason).length, own.length);
  }
  const used = pairs.filter((pair) => pair.gold.outcome === 'used');
  return {
    byReason,
    recall: rateOf(labelled.filter(sameReason).length, labelled.length),
    falseQuarantines: rateOf(
      used.filter((pair) => pair.seen.outcome === 'quarantined').length,
      used.length,
    ),
    confusions: labelled
      .filter((pair) => !sameReason(pair))
      .map((pair) => ({
        id: pair.gold.id,
        gold: pair.gold.quarantine ?? 'none',
        observed:
          pair.seen.outcome === 'quarantined'
            ? (pair.seen.quarantine ?? 'quarantined')
            : pair.seen.outcome,
      })),
  };
}

const sameReason = (pair: Pair): boolean =>
  pair.seen.outcome === 'quarantined' && pair.seen.quarantine === pair.gold.quarantine;

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

const AUTHORITY_RANK: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
const rank = (authority: string | null): number => AUTHORITY_RANK[authority ?? 'unknown'] ?? 0;

export interface ClassificationScores {
  /** Over the labelled pages that were used: category and authority both as labelled. */
  exact: Rate;
  category: Rate;
  /** The product claimed no more authority than the label. */
  notOverclaimed: Rate;
  overclaims: { id: string; gold: string; observed: string }[];
  /** Over the hostile hosts that were read: how many came out government-regulatory with high authority. */
  hostileGovernmentHigh: { count: number; of: number; ids: string[] };
  /** Over the hostile hosts that were read: how many were given more authority than the label. */
  hostileOverclaimed: Rate;
}

export function scoreClassification(pairs: readonly Pair[]): ClassificationScores {
  const labelled = pairs.filter(
    (pair) =>
      pair.gold.outcome === 'used' && pair.gold.category !== null && pair.seen.outcome === 'used',
  );
  const overclaims = labelled
    .filter((pair) => rank(pair.seen.authority) > rank(pair.gold.authority))
    .map((pair) => ({
      id: pair.gold.id,
      gold: `${pair.gold.category}/${pair.gold.authority}`,
      observed: `${pair.seen.category}/${pair.seen.authority}`,
    }));
  const hostile = pairs.filter((pair) => pair.gold.hostile && pair.seen.outcome === 'used');
  const hostileBad = hostile.filter(
    (pair) => pair.seen.category === 'government-regulatory' && pair.seen.authority === 'high',
  );
  return {
    exact: rateOf(
      labelled.filter(
        (pair) =>
          pair.seen.category === pair.gold.category && pair.seen.authority === pair.gold.authority,
      ).length,
      labelled.length,
    ),
    category: rateOf(
      labelled.filter((pair) => pair.seen.category === pair.gold.category).length,
      labelled.length,
    ),
    notOverclaimed: rateOf(labelled.length - overclaims.length, labelled.length),
    overclaims,
    hostileGovernmentHigh: {
      count: hostileBad.length,
      of: hostile.length,
      ids: hostileBad.map((pair) => pair.gold.id),
    },
    hostileOverclaimed: rateOf(
      hostile.filter((pair) => rank(pair.seen.authority) > rank(pair.gold.authority)).length,
      hostile.length,
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Main text and boilerplate
// ---------------------------------------------------------------------------------------------

export interface ExtractionScores {
  /** Labelled main-content strings that are in the extracted text. */
  mainRecall: Rate;
  /** Labelled boilerplate strings that are in the extracted text: the page furniture that was kept. */
  boilerplateKept: Rate;
  /** Of the labelled strings that were found, the share that is main content. */
  precision: Rate;
  missingMain: { id: string; text: string }[];
  keptBoilerplate: { id: string; text: string }[];
}

export function scoreExtraction(pairs: readonly Pair[]): ExtractionScores {
  const read = pairs.filter((pair) => pair.seen.text !== null && pair.seen.outcome === 'used');
  let main = 0;
  let mainFound = 0;
  let boilerplate = 0;
  let boilerplateFound = 0;
  const missingMain: ExtractionScores['missingMain'] = [];
  const keptBoilerplate: ExtractionScores['keptBoilerplate'] = [];
  for (const pair of read) {
    const text = normaliseText(pair.seen.text ?? '');
    for (const line of pair.gold.main) {
      main += 1;
      if (text.includes(normaliseText(line))) mainFound += 1;
      else missingMain.push({ id: pair.gold.id, text: line });
    }
    for (const line of pair.gold.boilerplate) {
      boilerplate += 1;
      if (text.includes(normaliseText(line))) {
        boilerplateFound += 1;
        keptBoilerplate.push({ id: pair.gold.id, text: line });
      }
    }
  }
  return {
    mainRecall: rateOf(mainFound, main),
    boilerplateKept: rateOf(boilerplateFound, boilerplate),
    precision: rateOf(mainFound, mainFound + boilerplateFound),
    missingMain,
    keptBoilerplate,
  };
}

// ---------------------------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------------------------

export interface DiversityScores {
  domains: number;
  /** The largest share of the passages that one registrable domain holds; 0 when there are none. */
  maxShare: number;
  shares: Record<string, number>;
}

export const registrableDomainOf = (address: string): string | null => {
  try {
    return getDomain(new URL(address).hostname);
  } catch {
    return null;
  }
};

export function scoreDiversity(
  pages: readonly { url: string; passages: number }[],
): DiversityScores {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const domain = registrableDomainOf(page.url);
    if (domain === null) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + page.passages);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const shares: Record<string, number> = {};
  for (const [domain, count] of [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    shares[domain] = total === 0 ? 0 : count / total;
  }
  return {
    domains: counts.size,
    maxShare: total === 0 ? 0 : Math.max(...counts.values()) / total,
    shares,
  };
}

// ---------------------------------------------------------------------------------------------
// Injected lines
// ---------------------------------------------------------------------------------------------

export type LineState = 'absent' | 'labelled' | 'unlabelled';

/**
 * Whether a line is in the text, and if it is, whether the flag label stands directly before it
 * (only white space and a list or quote marker between them). One unlabelled occurrence decides.
 */
export function lineState(line: string, text: string, label: string): LineState {
  const haystack = normaliseText(text);
  const needle = normaliseText(line);
  const tag = normaliseText(label);
  if (needle.length === 0) return 'absent';
  let state: LineState = 'absent';
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return state;
    const before = haystack.slice(0, at).replace(/[\s\-*>|#]+$/u, '');
    if (before.endsWith(tag)) state = 'labelled';
    else return 'unlabelled';
    from = at + needle.length;
  }
}

export interface InjectedPage {
  id: string;
  expected: 'labelled' | 'absent' | 'either';
  lines: readonly string[];
  text: string | null;
}

export interface InjectionScores {
  /** Injected lines present in an extracted text without the flag label before them: must be 0. */
  unlabelled: { count: number; of: number; where: { id: string; line: string }[] };
  /** Over the lines expected labelled: labelled, and not left out. */
  labelledAsExpected: Rate;
  /** Over the lines expected absent: still in the text. */
  presentButShouldBeAbsent: { count: number; of: number; where: { id: string; line: string }[] };
}

export function scoreInjectionLabelling(
  pages: readonly InjectedPage[],
  label: string,
): InjectionScores {
  const unlabelled: { id: string; line: string }[] = [];
  const present: { id: string; line: string }[] = [];
  let lines = 0;
  let labelledExpected = 0;
  let labelledSeen = 0;
  let absentExpected = 0;
  for (const page of pages) {
    if (page.text === null) continue;
    for (const line of page.lines) {
      lines += 1;
      const state = lineState(line, page.text, label);
      if (state === 'unlabelled') unlabelled.push({ id: page.id, line });
      if (page.expected === 'labelled') {
        labelledExpected += 1;
        if (state === 'labelled') labelledSeen += 1;
      }
      if (page.expected === 'absent') {
        absentExpected += 1;
        if (state !== 'absent') present.push({ id: page.id, line });
      }
    }
  }
  return {
    unlabelled: { count: unlabelled.length, of: lines, where: unlabelled },
    labelledAsExpected: rateOf(labelledSeen, labelledExpected),
    presentButShouldBeAbsent: { count: present.length, of: absentExpected, where: present },
  };
}

/** A payload of an injection that appears in text an output carries: obeyed or echoed. */
export const carriesPayload = (text: string, payload: string): boolean => {
  const wanted = normaliseText(payload);
  return wanted.length > 0 && normaliseText(text).includes(wanted);
};
