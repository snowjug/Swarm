import { RECOMMENDATION_PARTS, type DecisionCanvas, type LensId } from '../../shared/decision.js';
import type { DecisionGold } from './ai-suite-data.js';

/**
 * What a decision canvas is measured on: whether its status is the one the documented rules give,
 * whether each lens names the leader the lens definitions give, whether its recommendation states
 * every part or says it is missing, and whether any sentence of it forecasts or claims a figure no
 * simulation accounts for. Plain comparisons over a built canvas; nothing here builds one.
 */

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

export interface StatusScore {
  ok: boolean;
  problems: string[];
}

/** Whether the canvas has the status, a rule the document allows, and the listed conditions the gold names. */
export function scoreStatus(
  gold: Pick<DecisionGold, 'status' | 'rules' | 'conditions' | 'preferred'>,
  canvas: Pick<DecisionCanvas, 'status' | 'answer'>,
): StatusScore {
  const problems: string[] = [];
  const { status } = canvas;
  if (status.status !== gold.status) problems.push(`status ${status.status}, gold ${gold.status}`);
  if (!gold.rules.includes(status.rule))
    problems.push(`rule ${status.rule}, gold ${gold.rules.join(' or ')}`);
  if (gold.status === 'robust-option' && status.conditions.length !== 0)
    problems.push(`a robust option lists ${status.conditions.length} conditions`);
  if (gold.status === 'conditional-option' && status.conditions.length < gold.conditions)
    problems.push(
      `${status.conditions.length} conditions listed, at least ${gold.conditions} expected`,
    );
  if (canvas.answer.preferredAlternativeId !== gold.preferred)
    problems.push(`preferred ${canvas.answer.preferredAlternativeId}, gold ${gold.preferred}`);
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------------------------------

export interface LensScore {
  checked: number;
  agreed: number;
  misses: { what: string; gold: string | null; got: string | null }[];
}

/** Each lens the gold names a leader (or no leader) for, and the agreement the gold names, against the canvas. */
export function scoreLenses(
  gold: Pick<DecisionGold, 'leaders' | 'agreement'>,
  canvas: Pick<DecisionCanvas, 'lenses' | 'lensAgreement'>,
): LensScore {
  const misses: LensScore['misses'] = [];
  let checked = 0;
  for (const [id, wanted] of Object.entries(gold.leaders) as [LensId, string | null][]) {
    const lens = canvas.lenses.find((item) => item.id === id);
    const got = lens && lens.verdict === 'clear-leader' ? lens.leaderId : null;
    checked += 1;
    if (got !== wanted) misses.push({ what: id, gold: wanted, got });
  }
  if (gold.agreement !== null) {
    checked += 1;
    if (canvas.lensAgreement.state !== gold.agreement)
      misses.push({ what: 'agreement', gold: gold.agreement, got: canvas.lensAgreement.state });
  }
  return { checked, agreed: checked - misses.length, misses };
}

// ---------------------------------------------------------------------------------------------
// The recommendation
// ---------------------------------------------------------------------------------------------

/** What the status table says a recommendation of each status is. */
export const KIND_OF_STATUS: Record<DecisionCanvas['status']['status'], readonly string[]> = {
  'robust-option': ['proceed', 'keep-no-change'],
  'conditional-option': ['proceed', 'keep-no-change'],
  'multiple-plausible-options': ['hold'],
  'insufficient-evidence': ['gather-evidence'],
  'blocked-by-hard-constraint': ['resolve-constraint'],
  'needs-human-decision': ['decide'],
};

/**
 * Where a recommendation leaves a part out without saying so, says it is missing and also holds
 * something, lists the wrong parts as missing, or is of a kind its status does not give. Empty when
 * it is complete and right. `kind` is the gold's own kind when a fixture has one.
 */
export function recommendationProblems(
  canvas: Pick<DecisionCanvas, 'status' | 'answer' | 'reversibility'>,
  kind: string | null = null,
): string[] {
  const card = canvas.answer.recommendation;
  const problems: string[] = [];
  const missing = new Set<string>();
  for (const name of RECOMMENDATION_PARTS) {
    const part = card[name];
    const stated = part.items.length > 0;
    const said = part.missing !== null && part.missing.trim().length > 0;
    if (stated && part.missing !== null)
      problems.push(`${name} is stated and also said to be missing`);
    if (!stated && !said) problems.push(`${name} is neither stated nor said to be missing`);
    if (!stated) missing.add(name);
    for (const item of part.items) {
      if (item.text.trim().length === 0) problems.push(`${name} holds an empty statement`);
    }
  }
  if (card.what.text.trim().length === 0) problems.push('what is recommended is empty');
  if (card.reversibility.statement.text.trim().length === 0)
    problems.push('reversibility has no statement');
  if (card.reversibility.value === 'unknown') missing.add('reversibility');
  const listed = new Set<string>(card.missing);
  for (const name of missing)
    if (!listed.has(name)) problems.push(`${name} is missing and not listed`);
  for (const name of listed)
    if (!missing.has(name)) problems.push(`${name} is listed as missing and is not`);
  if (!KIND_OF_STATUS[canvas.status.status].includes(card.kind))
    problems.push(`kind ${card.kind} for status ${canvas.status.status}`);
  if (kind !== null && card.kind !== kind) problems.push(`kind ${card.kind}, gold ${kind}`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

export interface WordingProblem {
  path: string;
  text: string;
  why: string;
}

const NEGATION =
  /\b(?:not|never|none|nothing|nobody|cannot|can['’]t|without|no|neither|nor)\b|n['’]t\b/iu;

/** Words that forecast, or claim a measure no simulation took. A match that a denial just before it excuses is a disclaimer. */
const WORDING: readonly { why: string; pattern: RegExp }[] = [
  { why: 'prediction: will', pattern: /\bwill\b/giu },
  { why: 'prediction: shall', pattern: /\bshall\b/giu },
  { why: 'prediction: going to', pattern: /\bgoing to\b/giu },
  { why: 'prediction: won’t', pattern: /\bwon['’]t\b/giu },
  {
    why: 'prediction: bound or expected to',
    pattern:
      /\b(?:is|are|was|were|be)\s+(?:certain|sure|bound|expected|projected|forecast|predicted|guaranteed|poised|destined|anticipated)\s+to\b/giu,
  },
  {
    why: 'prediction: predict or forecast',
    pattern: /\b(?:predict|forecast|anticipate)(?:s|ed|ing)?\b/giu,
  },
  { why: 'prediction: projection', pattern: /\bprojections?\b/giu },
  {
    why: 'probability or confidence',
    pattern: /\b(?:probabilit(?:y|ies)|likelihood|confidence (?:level|interval))\b/giu,
  },
  {
    why: 'overclaim',
    pattern:
      /\b(?:certainly|definitely|undoubtedly|guarantee[ds]?|proves?|proven|inevitabl[ey])\b/giu,
  },
];

/** A figure that stands for the world: a percentage, a year, an amount of money, a large count. */
const FIGURES: readonly { why: string; pattern: RegExp }[] = [
  { why: 'a percentage', pattern: /\d[\d.,]*\s*(?:%|percent\b|per ?cent\b)/giu },
  { why: 'a year', pattern: /\b(?:19|20)\d{2}\b/gu },
  { why: 'an amount of money', pattern: /[$€£]\s?\d/gu },
  { why: 'a large count', pattern: /\b\d{1,3}(?:,\d{3})+\b|\b\d{5,}\b/gu },
];

/** What attributes a figure to the simulation: it says whose it is. A bare 'members' does not: members of what? */
const ATTRIBUTED = /\b(?:simulat\w*|seeded|runs?|paired|synthetic|modelled)\b/iu;
const QUOTED = /“[^”]*”|‘[^’]*’/gu;
const DATE = /^\d{4}-\d{2}-\d{2}/u;

const normal = (text: string): string => text.replaceAll(/\s+/gu, ' ').trim().toLowerCase();

/** Every string a value holds, with where it is. */
export function canvasStrings(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      canvasStrings(item, path ? `${path}.${index}` : String(index)),
    );
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      canvasStrings(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/**
 * The strings of a canvas that carry forecast or overclaim wording, or a figure nothing attributes to
 * the simulation. A string that is a person's own (equal to, or a clipped part of, a string of the
 * inputs) is not read, and neither is what stands inside curly quotation marks, which is how the
 * canvas puts a person's words into a sentence of its own.
 */
export function wordingProblems(canvas: DecisionCanvas, inputs: unknown): WordingProblem[] {
  const theirs = canvasStrings(inputs)
    .map(({ text }) => normal(text))
    .filter((text) => text.length > 0);
  const problems: WordingProblem[] = [];
  for (const { path, text } of canvasStrings(canvas)) {
    if (DATE.test(text)) continue;
    const own = normal(text.replace(/…$/u, ''));
    if (own.length === 0) continue;
    if (theirs.some((item) => item === own || (own.length >= 12 && item.includes(own)))) continue;
    const read = text.replaceAll(QUOTED, ' ');
    for (const { why, pattern } of WORDING) {
      for (const match of read.matchAll(pattern)) {
        const before = read.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
        if (NEGATION.test(before)) continue;
        problems.push({ path, text, why: `${why} (${match[0]})` });
      }
    }
    if (!ATTRIBUTED.test(read)) {
      for (const { why, pattern } of FIGURES) {
        for (const match of read.matchAll(pattern)) {
          problems.push({
            path,
            text,
            why: `${why} that nothing attributes to the simulation (${match[0]})`,
          });
        }
      }
    }
  }
  return problems;
}
