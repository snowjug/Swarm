import { inspectText } from '../models/injection.js';
import {
  SCENARIO_QUESTIONS_MAX,
  scenarioFrameSchema,
  type ScenarioAlternative,
  type ScenarioAmbiguity,
  type ScenarioAssumption,
  type ScenarioDocument,
  type ScenarioFrame,
  type ScenarioVariable,
} from '../../../shared/scenario.js';
import {
  AUXILIARIES,
  BOUNDARY_WORDS,
  COMPARATIVES,
  DETERMINERS,
  ENGLISH_WORDS,
  MACRO_REGIONS,
  MOVEMENT_RESULTS,
  NOT_UNITS,
  NUMBER_WORDS,
  PLACE_NOUNS,
  PRONOUNS,
  REQUIREMENT_RESULTS,
  ROLE_MODIFIERS,
  TARGET_RESULTS,
  TIME_UNITS,
  roleOf,
  verbAt,
  type VerbMatch,
} from './lexicon.js';
import { formatQuantity, isAmount, readQuantity, tokenize, type Quantity } from './quantity.js';
import {
  MAX_READ_CHARS,
  clip,
  looksEnglish,
  normalise,
  plainName,
  sentenceCase,
  sentencesOf,
  slugify,
} from './text.js';

/**
 * Reads a what-if question into a scenario frame with plain rules. It always works and it never
 * calls anything: a question in, a valid frame out. It looks for an "if" or "when" clause, the verbs
 * and amounts that say what changes, a place, a span of time, and the groups the question names. What
 * it cannot find it leaves empty and asks about, rather than guessing. It reads English only.
 */

export interface RulesInput {
  question: string;
  documents?: readonly ScenarioDocument[];
}

export interface RulesReading {
  frame: ScenarioFrame;
  /** What was noticed while reading, such as a question cut short or not in English. */
  notes: string[];
}

export const BASELINE = 'The current situation continues without the change.';

const EVIDENCE_PROMPTS: readonly string[] = [
  'How the affected groups reacted to similar changes in the past.',
  'Current baseline measures for what is changing, such as volumes, costs or usage.',
  'Constraints that limit the options, such as contracts, rules or capacity.',
];

const FACE_VALUE: ScenarioAssumption = {
  id: 'face-value',
  text: 'The change happens as the question describes it, and nothing else changes at the same time.',
  origin: 'system',
};

const SUGGESTION_ASSUMPTION: ScenarioAssumption = {
  id: 'suggested-alternatives',
  text: 'The smaller and larger alternatives are suggestions made by Swarm, not figures from the question.',
  origin: 'system',
};

// ---------------------------------------------------------------------------------------------
// Where in the text
// ---------------------------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
  text: string;
}

const spanOf = (match: RegExpExecArray): Span => ({
  start: match.index,
  end: match.index + match[0].length,
  text: match[0],
});

/** The span that starts first (and, among equals, the longest) of every pattern's first match. */
function earliest(spans: readonly (Span | null)[]): Span | null {
  let best: Span | null = null;
  for (const span of spans) {
    if (
      span &&
      (!best || span.start < best.start || (span.start === best.start && span.end > best.end))
    ) {
      best = span;
    }
  }
  return best;
}

const mask = (text: string, spans: readonly (Span | null)[]): string =>
  spans.reduce<string>(
    (out, span) =>
      span
        ? `${out.slice(0, span.start)}${' '.repeat(span.end - span.start)}${out.slice(span.end)}`
        : out,
    text,
  );

const HORIZON: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:within|over|during|throughout|across|in|for)\s+(?:the\s+)?(?:next|coming|following|first|last)\s+(?:(?:${NUMBER_WORDS})\s+)?(?:${TIME_UNITS})\b`,
    'iu',
  ),
  new RegExp(
    String.raw`\b(?:within|over|in|during)\s+(?:the\s+)?(?:${NUMBER_WORDS})\s+(?:${TIME_UNITS})\b`,
    'iu',
  ),
  /\b(?:next|this|coming|following|current)\s+(?:fiscal\s+)?(?:quarter|year|month|week|decade|half|summer|winter|spring|autumn)\b/iu,
  /\bby\s+(?:the\s+end\s+of\s+)?(?:(?:next|this)\s+(?:quarter|year|month|week|decade)|(?:19|20)\d{2}|Q[1-4](?:\s+(?:19|20)\d{2})?)\b/iu,
  /\bin\s+(?:19|20)\d{2}\b/iu,
  /\b(?:in\s+the\s+)?(?:short|medium|long)[- ]?(?:term|run)\b/iu,
];

function horizonIn(text: string): Span | null {
  return earliest(HORIZON.map((pattern) => pattern.exec(text)).map((m) => (m ? spanOf(m) : null)));
}

const PLACE = new RegExp(
  String.raw`\b(?:in|across|within|throughout|around|for)\s+(?:(?!(?:in|for|by|to|of|from|and|or|with|that|which|across|within|throughout|around|over|at|on)\b)[\p{L}'-]+\s+){0,4}?(?:${PLACE_NOUNS})\b`,
  'iu',
);
const GLOBAL_WORDS =
  /\b(?:worldwide|globally|nationwide|internationally|domestically|overseas)\b/iu;
const MACRO = new RegExp(
  String.raw`\b(?:in|across|throughout|within|for)\s+(?:the\s+)?(?:${MACRO_REGIONS})\b`,
  'u',
);
const NAMED_PLACE =
  /\b([Ii]n|[Aa]cross|[Tt]hroughout|[Ww]ithin)\s+((?:the\s+)?\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,2})/gu;
const NOT_PLACES =
  /^(?:the\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu;

/**
 * A place: a phrase such as "in a selected region", a worldwide word, a large named area, or a named
 * place where the pattern is clear (after an amount or a comma, or after "across"). A capitalised
 * word after a bare "in" is not taken as a place, because it is as likely to be a product.
 */
function placeIn(text: string): Span | null {
  const named: Span[] = [];
  for (const match of text.matchAll(NAMED_PLACE)) {
    const preposition = (match[1] ?? '').toLowerCase();
    const before = text.slice(0, match.index).trimEnd();
    const clear = preposition !== 'in' || /(?:\d%?|,|percent|per cent)$/iu.test(before);
    if (clear && !NOT_PLACES.test(match[2] ?? '')) {
      named.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      break;
    }
  }
  const place = PLACE.exec(text);
  const worldwide = GLOBAL_WORDS.exec(text);
  const macro = MACRO.exec(text);
  return earliest([
    place ? spanOf(place) : null,
    worldwide ? spanOf(worldwide) : null,
    macro ? spanOf(macro) : null,
    ...named,
  ]);
}

const LEADING_PREPOSITION = /^(?:in|across|within|throughout|around|for)\s+/iu;

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

interface Lead {
  /** The decision or event, as shown. */
  decision: string;
  /** The text that says what changes. */
  clause: string;
  requested: string | null;
}

const stripEnd = (text: string): string => text.replace(/[\s?.!,;:]+$/u, '').trim();

const CONDITIONAL =
  /\b(?:if|when|whenever|once|after|assuming|suppose|supposing|imagine|in case)\b\s*(?:that\s+)?/iu;
const QUESTION_WORDS =
  /,\s*(?:then\s+)?(?:what|how|who|which|why|where|will|would|could|can|should|do|does|is|are)\b.*$/iu;
const SHOULD =
  /\bshould\s+(?:we|i|they|you)\s+(.+?)(?=\s+(?:if|when|whenever|once|after)\b|[?.!]*$)/iu;
const WHETHER =
  /\bwhether\s+(?:or\s+not\s+)?(?:to\s+)?(.+?)(?=\s+(?:if|when|whenever|once|after)\b|[?.!]*$)/iu;
const SHOULD_LEAD = /^(?:(?:so|well|ok|okay|also),?\s+)?should\s+(we|i|they|you)\s+(.+)$/iu;
const REACTION =
  /\b(?:react|reacts|reacted|respond|responds|responded|affected|impacts?|effects?|consequences?|implications?|results?|fallout|reaction|response)\s+(?:of|to|from|by|on)\s+(.+)$/iu;

function requestedOf(sentence: string): string | null {
  const found = SHOULD.exec(sentence) ?? WHETHER.exec(sentence);
  const asked = stripEnd(found?.[1] ?? '');
  return asked.length >= 3 ? `Whether to ${asked}` : null;
}

function leadOf(sentences: readonly string[]): Lead | null {
  for (const sentence of sentences) {
    const match = CONDITIONAL.exec(sentence);
    if (!match) continue;
    let clause = sentence.slice(match.index + match[0].length);
    // "If A, what happens?": the question follows the first comma.
    if (match.index === 0) clause = clause.replace(QUESTION_WORDS, '');
    clause = stripEnd(clause);
    if (clause.length >= 3) {
      return { decision: sentenceCase(clause), clause, requested: requestedOf(sentence) };
    }
  }
  for (const sentence of sentences) {
    const should = SHOULD_LEAD.exec(stripEnd(sentence));
    if (should?.[1] && should[2]) {
      const clause = `${should[1]} ${stripEnd(should[2])}`;
      return {
        decision: sentenceCase(clause),
        clause,
        requested: `Whether to ${stripEnd(should[2])}`,
      };
    }
    const whether = WHETHER.exec(sentence);
    if (whether?.[1] && stripEnd(whether[1]).length >= 3) {
      const clause = stripEnd(whether[1]);
      return { decision: sentenceCase(clause), clause, requested: `Whether to ${clause}` };
    }
  }
  for (const sentence of sentences) {
    const reaction = REACTION.exec(sentence);
    if (reaction?.[1] && stripEnd(reaction[1]).length >= 3) {
      return {
        decision: sentenceCase(stripEnd(sentence)),
        clause: stripEnd(reaction[1]),
        requested: null,
      };
    }
  }
  const first = sentences[0];
  if (!first) return null;
  const bare = stripEnd(first);
  return { decision: sentenceCase(bare), clause: bare, requested: null };
}

// ---------------------------------------------------------------------------------------------
// What changes
// ---------------------------------------------------------------------------------------------

type Magnitude =
  | { kind: 'by'; quantity: Quantity }
  | { kind: 'to'; quantity: Quantity }
  | { kind: 'between'; from: Quantity; to: Quantity }
  | { kind: 'words'; from: string; to: string };

interface Change {
  name: string;
  verb: VerbMatch;
  magnitude: Magnitude | null;
  byDefault: boolean;
}

interface Segment {
  tokens: string[];
  joiner: 'and' | 'or' | null;
}

const BY_DEFAULT = 'BYDEFAULT';

const lowered = (tokens: readonly string[]): string[] => tokens.map((token) => token.toLowerCase());
const isBoundary = (token: string): boolean => BOUNDARY_WORDS.has(token.toLowerCase());

function hasVerbSoon(tokens: readonly string[]): boolean {
  const words = lowered(tokens.slice(0, 5));
  return words.some((_, index) => verbAt(words, index) !== null);
}

/** Pulls "A or B" amounts out as options, leaving only the first of each group in the text. */
function takeOptions(tokens: readonly string[]): { tokens: string[]; options: Quantity[] } {
  const kept: string[] = [];
  let options: Quantity[] = [];
  let index = 0;
  while (index < tokens.length) {
    const first = readQuantity(tokens, index);
    if (!first || first.quantity.time) {
      kept.push(tokens[index] ?? '');
      index += 1;
      continue;
    }
    const range = kept.at(-1)?.toLowerCase() === 'between';
    const found = [first.quantity];
    let end = index + first.length;
    for (;;) {
      const comma = tokens[end] === ',' ? 1 : 0;
      const connector = tokens[end + comma]?.toLowerCase();
      const joins =
        connector === 'or' ||
        connector === 'versus' ||
        connector === 'vs' ||
        (range && connector === 'and');
      const next = joins ? readQuantity(tokens, end + comma + 1) : null;
      if (!next || next.quantity.time) break;
      found.push(next.quantity);
      end += comma + 1 + next.length;
    }
    if (found.length > 1 && options.length === 0) {
      options = found;
      if (range) kept.pop();
    }
    kept.push(...tokens.slice(index, index + first.length));
    index = end;
  }
  return { tokens: kept, options };
}

function segmentsOf(tokens: readonly string[]): Segment[] {
  const list = tokens.includes(',') || tokens.includes(';');
  const segments: Segment[] = [];
  let current: string[] = [];
  let joiner: Segment['joiner'] = null;
  const close = (next: Segment['joiner']): void => {
    if (current.length > 0) segments.push({ tokens: current, joiner });
    current = [];
    joiner = next;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const word = token.toLowerCase();
    if (token === ',' || token === ';') {
      const next = tokens[index + 1]?.toLowerCase();
      if (next === 'and' || next === 'or') {
        close(next);
        index += 1;
      } else close('and');
    } else if (word === 'and' || word === 'or' || word === '&' || word === 'plus') {
      if (list || hasVerbSoon(tokens.slice(index + 1))) close(word === 'or' ? 'or' : 'and');
      else current.push(token);
    } else current.push(token);
  }
  close(null);
  return segments;
}

/** The words of a name: no leading article, no auxiliaries, amounts or separators. */
function nameOf(tokens: readonly string[]): string {
  const kept: string[] = [];
  for (const token of tokens) {
    const word = token.toLowerCase();
    if (token === BY_DEFAULT || /^[,;&]$/u.test(token) || isAmount(token)) continue;
    if (AUXILIARIES.has(word)) continue;
    if (kept.length === 0 && DETERMINERS.has(word)) continue;
    kept.push(token);
  }
  return kept.join(' ');
}

function stopsName(token: string): boolean {
  return isBoundary(token) || isAmount(token) || token === BY_DEFAULT;
}

/** A value after "to" or "from": an amount, or a few words. */
function valueAt(
  tokens: readonly string[],
  index: number,
): { quantity: Quantity | null; text: string } | null {
  const amount = readQuantity(tokens, index);
  if (amount) return { quantity: amount.quantity, text: amount.quantity.raw };
  const words: string[] = [];
  for (let at = index; at < tokens.length && words.length < 6; at += 1) {
    const token = tokens[at] ?? '';
    if (token === 'to' || stopsName(token) || /^[,;&]$/u.test(token)) break;
    words.push(token);
  }
  return words.length > 0 ? { quantity: null, text: words.join(' ') } : null;
}

function magnitudeOf(tokens: readonly string[], verb: VerbMatch): Magnitude | null {
  const words = lowered(tokens);
  const from = words.indexOf('from');
  if (from >= 0) {
    const to = words.indexOf('to', from + 1);
    if (to > from + 1) {
      const start = valueAt(tokens, from + 1);
      const end = valueAt(tokens, to + 1);
      const middle = tokens.slice(from + 1, to);
      if (start && end && middle.length <= 6) {
        return start.quantity && end.quantity
          ? { kind: 'between', from: start.quantity, to: end.quantity }
          : { kind: 'words', from: middle.join(' '), to: end.text };
      }
    }
  }
  const to = words.indexOf('to');
  if (to >= 0) {
    const amount = readQuantity(tokens, to + 1);
    if (amount) return { kind: 'to', quantity: amount.quantity };
    const target = MOVEMENT_RESULTS.has(verb.result) ? valueAt(tokens, to + 1) : null;
    if (target) return { kind: 'words', from: '', to: target.text };
  }
  const by = words.indexOf('by');
  if (by >= 0) {
    const amount = readQuantity(tokens, by + 1);
    if (amount) return { kind: 'by', quantity: amount.quantity };
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const amount = readQuantity(tokens, index);
    if (amount && !amount.quantity.time) return { kind: 'by', quantity: amount.quantity };
  }
  return null;
}

/** Who makes the change, when the question says so with a noun phrase and not a pronoun. */
function subjectOf(tokens: readonly string[]): string | null {
  const name = nameOf(tokens);
  const words = name.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 6) return null;
  if (words.some((word) => PRONOUNS.has(word.toLowerCase()) || isBoundary(word))) return null;
  return /^\p{L}/u.test(name) ? name : null;
}

const pronounOnly = (name: string): boolean =>
  name.split(' ').every((word) => PRONOUNS.has(word.toLowerCase()));

/** The name that follows `tokens[0]` (a preposition), up to the next word that ends a name. */
function nameAfterPreposition(tokens: readonly string[]): string {
  const rest = tokens.slice(1);
  const stop = rest.findIndex(stopsName);
  return nameOf(stop === -1 ? rest : rest.slice(0, stop));
}

/** Changes that follow the main one in a segment: "a higher rate", and "with a feature removed". */
function extrasOf(tail: readonly string[]): Change[] {
  const words = lowered(tail);
  const extras: Change[] = [];
  for (let index = 0; index < tail.length; index += 1) {
    const word = words[index] ?? '';
    const comparative = COMPARATIVES.get(word);
    if (comparative) {
      const name = nameAfterPreposition(['', ...tail.slice(index + 1)]);
      if (name) extras.push({ name, verb: comparative, magnitude: null, byDefault: false });
      continue;
    }
    // A participle after a noun phrase: the phrase is what was changed.
    const verb =
      /(?:ed|en|wn)$/u.test(word) && words[index - 1] !== 'to' ? verbAt(words, index) : null;
    if (!verb) continue;
    let start = index;
    while (start > 0 && !stopsName(tail[start - 1] ?? '')) start -= 1;
    const name = nameOf(tail.slice(start, index));
    if (name) extras.push({ name, verb, magnitude: null, byDefault: false });
  }
  return extras;
}

const ADOPTED: VerbMatch = { result: 'adopted', words: 1, scalar: false };

/** Words that open a reason or a purpose, which says why something changes and not what changes. */
const PURPOSE_WORDS: ReadonlySet<string> = new Set([
  'so',
  'because',
  'since',
  'while',
  'whereas',
  'although',
  'though',
  'unless',
  'to',
  'which',
  'who',
]);

function readSegment(
  segment: readonly string[],
  inherited: VerbMatch | null,
): { changes: Change[]; subject: string | null } | null {
  const words = lowered(segment);
  if (PURPOSE_WORDS.has(words[0] ?? '')) return null;
  let at = -1;
  let verb: VerbMatch | null = null;
  for (let index = 0; index < Math.min(words.length, 9) && !verb; index += 1) {
    verb = verbAt(words, index);
    if (verb) at = index;
  }
  if (!verb) {
    if (!inherited) return null;
    verb = inherited;
  }
  const before = at >= 0 ? segment.slice(0, at) : [];
  const after = segment.slice(at >= 0 ? at + verb.words : 0);
  // "an increase of 10%": nothing follows the verb that is the thing changed.
  const end = after[0]?.toLowerCase() === 'of' ? 0 : after.findIndex(stopsName);
  const object = end === -1 ? after : after.slice(0, end);
  const tail = end === -1 ? [] : after.slice(end);
  const lead = tail[0]?.toLowerCase();
  let name = nameOf(object);
  let magnitude = magnitudeOf(segment, verb);
  let used = verb;
  if (!name) {
    const counted = readQuantity(tail, 0)?.quantity;
    if (counted?.unit) {
      // "cut 20 jobs": what is counted is what changes.
      const rest = tail.slice(2);
      const stop = rest.findIndex(stopsName);
      name = nameOf([counted.unit, ...(stop === -1 ? rest : rest.slice(0, stop))]);
      magnitude = {
        kind: 'by',
        quantity: { ...counted, raw: String(counted.value), suffix: '', unit: null },
      };
    } else if (MOVEMENT_RESULTS.has(verb.result) && lead === 'to' && !readQuantity(tail, 1)) {
      name = nameAfterPreposition(tail);
      used = ADOPTED;
      magnitude = null;
    } else {
      const subject = nameOf(before);
      if (subject && !pronounOnly(subject)) name = subject;
      else if (lead === 'in' || lead === 'of' || lead === 'on' || lead === 'for') {
        name = nameAfterPreposition(tail);
      }
    }
  } else if (REQUIREMENT_RESULTS.has(verb.result) && lead === 'to') {
    // "require employers to publish reports": the requirement is what changes.
    name = nameAfterPreposition(tail) || name;
  } else if (verb.result === 'replaced' && lead === 'with') {
    const instead = nameAfterPreposition(tail);
    if (instead) magnitude = { kind: 'words', from: '', to: `replaced with ${instead}` };
  }
  if (!name) return null;
  const main: Change = {
    name,
    verb: used,
    magnitude,
    byDefault: segment.includes(BY_DEFAULT),
  };
  return {
    changes: [main, ...extrasOf(tail)],
    subject: object.length > 0 ? subjectOf(before) : null,
  };
}

interface ClauseReading {
  changes: Change[];
  groups: Change[][];
  options: Quantity[];
  subject: string | null;
}

function readClause(clause: string): ClauseReading {
  const prepared = tokenize(clause.replace(/\bby\s+default\b/giu, ` ${BY_DEFAULT} `));
  const { tokens, options } = takeOptions(prepared);
  const groups: Change[][] = [[]];
  const changes: Change[] = [];
  const seen = new Set<string>();
  let inherited: VerbMatch | null = null;
  let subject: string | null = null;
  for (const segment of segmentsOf(tokens)) {
    if (segment.joiner === 'or' && (groups.at(-1)?.length ?? 0) > 0) groups.push([]);
    const read = readSegment(segment.tokens, inherited);
    if (!read) continue;
    inherited = read.changes[0]?.verb ?? inherited;
    subject ??= read.subject;
    for (const change of read.changes) {
      const key = change.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      groups.at(-1)?.push(change);
      changes.push(change);
    }
  }
  return { changes, groups: groups.filter((group) => group.length > 0), options, subject };
}

function variableOf(change: Change, to?: string): ScenarioVariable {
  const { magnitude, verb } = change;
  const by = change.byDefault ? ' by default' : '';
  let from: string | null = null;
  let result = `${verb.result}${by}`;
  if (magnitude?.kind === 'by') result = `${verb.result} by ${magnitude.quantity.raw}${by}`;
  else if (magnitude?.kind === 'to') result = magnitude.quantity.raw;
  else if (magnitude?.kind === 'between') {
    from = magnitude.from.raw;
    result = magnitude.to.raw;
  } else if (magnitude?.kind === 'words') {
    from = magnitude.from || null;
    result = magnitude.to;
  }
  return {
    name: clip(change.name, 120),
    from: from === null ? null : clip(from, 200),
    to: clip(to ?? result, 200),
    note: '',
  };
}

/** A label that reads as what happens: "Rate raised by 5%". */
const labelOf = (variables: readonly ScenarioVariable[]): string =>
  clip(
    sentenceCase(
      variables.map((variable) => `${variable.name} ${variable.to ?? ''}`.trim()).join(' and '),
    ),
    120,
  );

// ---------------------------------------------------------------------------------------------
// Alternatives: what the question states, and clearly labelled suggestions
// ---------------------------------------------------------------------------------------------

const withValue = (quantity: Quantity, value: number): Quantity => ({
  ...quantity,
  value,
  raw: formatQuantity(quantity, value),
});

/** The change made `factor` times as large, when it is an amount that can be scaled. */
function scaled(change: Change, factor: number): Change | null {
  const { magnitude } = change;
  if (magnitude?.kind === 'by' && magnitude.quantity.value > 0 && !magnitude.quantity.time) {
    return {
      ...change,
      magnitude: {
        kind: 'by',
        quantity: withValue(magnitude.quantity, magnitude.quantity.value * factor),
      },
    };
  }
  if (
    magnitude?.kind === 'between' &&
    magnitude.from.prefix === magnitude.to.prefix &&
    magnitude.from.suffix === magnitude.to.suffix &&
    magnitude.from.value !== magnitude.to.value
  ) {
    const target = magnitude.from.value + (magnitude.to.value - magnitude.from.value) * factor;
    return { ...change, magnitude: { ...magnitude, to: withValue(magnitude.to, target) } };
  }
  return null;
}

function alternativesOf(reading: ClauseReading): {
  alternatives: ScenarioAlternative[];
  /** The change as written when the question names several amounts for it. */
  override: string | null;
  suggested: boolean;
} {
  const taken = new Set<string>();
  const [first] = reading.changes;
  if (first && reading.options.length >= 2) {
    const kind = first.magnitude?.kind === 'to' ? 'to' : 'by';
    const alternatives = reading.options.slice(0, 4).map((quantity): ScenarioAlternative => {
      const changes = [variableOf({ ...first, magnitude: { kind, quantity } })];
      const label = labelOf(changes);
      return { id: slugify(label, taken), label, description: 'Stated in the question.', changes };
    });
    const raws = reading.options
      .slice(0, 4)
      .map((quantity) => quantity.raw)
      .join(' or ');
    return {
      alternatives,
      override: kind === 'to' ? raws : `${first.verb.result} by ${raws}`,
      suggested: false,
    };
  }
  if (reading.groups.length >= 2) {
    const alternatives = reading.groups.slice(0, 4).map((group): ScenarioAlternative => {
      const changes = group.slice(0, 10).map((change) => variableOf(change));
      const label = labelOf(changes);
      return { id: slugify(label, taken), label, description: 'Stated in the question.', changes };
    });
    return { alternatives, override: null, suggested: false };
  }
  const sized = reading.changes.filter((change) => scaled(change, 2) !== null);
  const only = sized.length === 1 ? sized[0] : undefined;
  if (only) {
    const alternatives: ScenarioAlternative[] = [];
    for (const [word, factor] of [
      ['smaller', 0.5],
      ['larger', 2],
    ] as const) {
      const option = scaled(only, factor);
      if (!option) continue;
      alternatives.push({
        id: slugify(`${word} change`, taken),
        label: `${sentenceCase(word)} change (suggestion)`,
        description: `A ${word} version of the change, suggested by Swarm. It is not in the question: edit or delete it.`,
        changes: [variableOf(option)],
      });
    }
    return { alternatives, override: null, suggested: alternatives.length > 0 };
  }
  return { alternatives: [], override: null, suggested: false };
}

// ---------------------------------------------------------------------------------------------
// Who, what is affected, and what is missing
// ---------------------------------------------------------------------------------------------

/** Words that can follow a role without making it part of a longer name ("vendor platform"). */
const ENDS_A_ROLE = (word: string): boolean =>
  NOT_UNITS.has(word) ||
  ENGLISH_WORDS.has(word) ||
  verbAt([word], 0) !== null ||
  /(?:s|ed|ing)$/u.test(word);

/**
 * The groups the question names, from a small list of roles that exist in any setting. A singular
 * role directly followed by another word is read as part of a longer name, not as a group.
 */
function groupsIn(text: string): string[] {
  const words = (text.match(/\p{L}[\p{L}'’-]*/gu) ?? []).map((word) =>
    word.replace(/['’]s?$/u, ''),
  );
  const found = new Set<string>();
  words.forEach((word, index) => {
    const plural = roleOf(word);
    const next = words[index + 1]?.toLowerCase();
    if (!plural || (plural !== word.toLowerCase() && next !== undefined && !ENDS_A_ROLE(next)))
      return;
    const modifiers: string[] = [];
    for (let back = 1; back <= 2; back += 1) {
      const previous = words[index - back]?.toLowerCase();
      if (previous === undefined || !ROLE_MODIFIERS.has(previous)) break;
      modifiers.unshift(previous);
    }
    found.add([...modifiers, plural].join(' '));
  });
  return [...found].slice(0, 12);
}

/** What the change is made to: the "of" or "into" part of what changes, else whoever makes the change. */
function systemOf(reading: ClauseReading): string {
  const [first] = reading.changes;
  const name = first?.name ?? '';
  const of = / of (.+)$/iu.exec(name)?.[1];
  const into =
    first && TARGET_RESULTS.has(first.verb.result)
      ? /\b(?:into|onto) (.+)$/iu.exec(name)?.[1]
      : undefined;
  return sentenceCase(of ?? into ?? reading.subject ?? '');
}

const SUCCESS_WORDS =
  /\b(?:success|successful|succeed|goals?|objectives?|targets?|kpis?|metrics?|measured?|outcomes?|so that|in order to|aims?|aiming)\b|\bto\s+(?:increase|reduce|improve|grow|boost|protect|cut|lower|raise|retain|win|save)\b/iu;

function ambiguitiesOf(found: {
  reading: ClauseReading;
  system: string;
  groups: readonly string[];
  horizon: string | null;
  text: string;
}): ScenarioAmbiguity[] {
  const { reading, system, groups, horizon, text } = found;
  const asked: ScenarioAmbiguity[] = [];
  if (reading.changes.length === 0) {
    asked.push({
      field: 'changes',
      message: 'The question does not say what exactly changes.',
      question: 'What exactly changes, and from what to what?',
    });
  } else if (
    reading.options.length < 2 &&
    reading.changes.some((change) => change.verb.scalar && change.magnitude === null)
  ) {
    asked.push({
      field: 'changes',
      message: 'The question does not say how large the change is.',
      question: 'How large is the change, or what exactly is different afterwards?',
    });
  }
  if (groups.length === 0 && !system) {
    asked.push({
      field: 'system',
      message: 'The question does not say who or what is affected.',
      question: 'Who or what is affected by this change?',
    });
  } else if (groups.length === 0) {
    asked.push({
      field: 'likelyStakeholders',
      message: 'The question does not name the groups that are affected.',
      question: 'Which groups of people or organisations are affected?',
    });
  }
  if (!horizon) {
    asked.push({
      field: 'horizon',
      message: 'The question does not say over what period to look.',
      question: 'Over what period should the effects be judged?',
    });
  }
  if (!SUCCESS_WORDS.test(text)) {
    asked.push({
      field: 'success',
      message: 'The question does not say how a good outcome would be judged.',
      question: 'What would count as a good outcome?',
    });
  }
  return asked.slice(0, SCENARIO_QUESTIONS_MAX);
}

export function evidenceListed(documents: readonly ScenarioDocument[]): string[] {
  return documents
    .slice(0, 12)
    .map(
      (document) =>
        `${plainName(document.name, 120)} (${document.characters.toLocaleString('en-GB')} characters)`,
    );
}

// ---------------------------------------------------------------------------------------------
// The whole reading
// ---------------------------------------------------------------------------------------------

function read(input: RulesInput, notes: string[]): ScenarioFrame {
  const { text, truncated } = normalise(input.question);
  if (truncated) {
    notes.push(
      `Only the first ${MAX_READ_CHARS.toLocaleString('en-GB')} characters of the question were read.`,
    );
  }
  if (!looksEnglish(text)) {
    notes.push(
      'This question does not look like English, and the rules read English only. Check every field.',
    );
  }
  // A sentence that reads as an instruction to an AI is left out of the frame: it is not part of the scenario.
  const sentences = sentencesOf(text).filter((sentence) => !inspectText(sentence).suspicious);
  const readable = sentences.join(' ');
  const lead = leadOf(sentences);
  const clause = lead?.clause ?? '';

  const horizon = horizonIn(clause) ?? horizonIn(readable);
  const place = placeIn(clause) ?? placeIn(readable);
  const reading = readClause(mask(clause, [horizonIn(clause), placeIn(clause)]));
  const { alternatives, override, suggested } = alternativesOf(reading);
  const variables = reading.changes
    .slice(0, 10)
    .map((change, index) => variableOf(change, index === 0 ? (override ?? undefined) : undefined));

  const groups = groupsIn(readable);
  const stakeholders = [...groups];
  const subject = reading.subject;
  if (subject) {
    // Whoever makes the change is a stakeholder too, unless the question already named their role.
    const role = roleOf(subject.split(' ').at(-1) ?? '');
    const named = role !== null && groups.some((group) => group.endsWith(role));
    if (!named && !stakeholders.some((item) => item.toLowerCase() === subject.toLowerCase())) {
      stakeholders.push(clip(subject, 120));
    }
  }
  const system = systemOf(reading);
  const horizonText = horizon ? sentenceCase(horizon.text.trim()) : null;
  const assumptions = [FACE_VALUE, ...(suggested ? [SUGGESTION_ASSUMPTION] : [])];
  if (suggested) {
    notes.push(
      'The smaller and larger alternatives are suggestions, labelled as such. Edit or delete them.',
    );
  }

  return scenarioFrameSchema.parse({
    decision: clip(lead?.decision ?? '', 400),
    system: clip(system, 300),
    geography: place
      ? clip(sentenceCase(place.text.replace(LEADING_PREPOSITION, '').trim()), 200)
      : null,
    horizon: horizonText ? clip(horizonText, 200) : null,
    changes: variables,
    baseline: BASELINE,
    alternatives: alternatives.slice(0, 6),
    requestedDecision: lead?.requested ? clip(lead.requested, 400) : null,
    desiredOutput: /\brecommend/iu.test(readable)
      ? 'A recommendation, with the reasons and the uncertainty behind it.'
      : null,
    evidenceAvailable: evidenceListed(input.documents ?? []),
    evidenceMissing: [...EVIDENCE_PROMPTS],
    assumptions,
    likelyStakeholders: stakeholders.slice(0, 20),
    ambiguities: ambiguitiesOf({ reading, system, groups, horizon: horizonText, text: readable }),
    origin: 'rules',
  });
}

/** What the rules can say when everything else has failed: the question as the decision, and every question asked. */
function bareFrame(input: RulesInput): ScenarioFrame {
  return scenarioFrameSchema.parse({
    decision: clip(normalise(input.question).text, 400),
    system: '',
    baseline: BASELINE,
    evidenceAvailable: evidenceListed(input.documents ?? []),
    evidenceMissing: [...EVIDENCE_PROMPTS],
    ambiguities: [
      {
        field: 'changes',
        message: 'The question does not say what exactly changes.',
        question: 'What exactly changes, and from what to what?',
      },
    ],
    origin: 'rules',
  });
}

export function readByRules(input: RulesInput): RulesReading {
  const notes: string[] = [];
  try {
    return { frame: read(input, notes), notes };
  } catch {
    notes.push('The rules could not read this question. Fill in the fields yourself.');
    return { frame: bareFrame(input), notes };
  }
}
