// What the product may not claim, in the words of its own pages. This is written apart from the guard
// the brief builder runs (backend/src/brief/lint.ts) on purpose: a page is judged here by code that
// shares nothing with the code that wrote it, so that a flaw in one is not a flaw in both. It has no
// imports, so that the unit tests can use it without a browser.

const QUOTED = /“[^”]*”|"[^"]*"|‘[^’]*’/gu;

/** A forecast: what will, shall or is bound to happen, however it is put. */
const FUTURE = [
  /\b(?:will|shall|won['’]t|going to|would certainly|inevitabl[ey])\b/iu,
  new RegExp(
    String.raw`\b(?:is|are|was|were|be|been|being)\s+(?:(?:almost|virtually|nearly|very|all but|also|now|still|not|never)\s+){0,2}` +
      // "set to 0.5" says how something is configured, not what will happen.
      String.raw`(?:certain|sure|bound|likely|unlikely|expected|projected|forecast(?:ed)?|predicted|guaranteed|poised|destined|slated|anticipated|set(?!\s+to\s+[+-]?\d))\s+to\b`,
    'iu',
  ),
];

const NUMBER_WORD =
  /^(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?|half)$/u;
const MEASURE =
  /^(?:conversions?|churn(?:ed|ing)?|retention|attrition|adoption|uptake|take-up|sentiment|satisfaction|revenues?|sales|profits?)$/u;
const OF_THE_SIMULATION =
  /^(?:simulated|simulation|simulations|synthetic|fictional|seeded|paired|modelled|modeled|virtual|assumed|assumption|assumptions|runs?|seeds?)$/u;
const REAL = /^(?:real|actual|genuine|real-world)$/u;
const PEOPLE =
  /^(?:customers?|users?|people|persons?|members?|employees?|staff|subscribers?|shoppers?|buyers?|clients?|consumers?|patients?|residents?|citizens?|households?|voters?|workers?|students?|visitors?|respondents?|participants?)$/u;
const DENIAL = /^(?:not|never|neither|nor|no|none|cannot|without|\p{L}+n['’]t)$/u;
const RELATIVE_CHANGE = /^(?:higher|lower|more|less|greater|larger|smaller|bigger|faster|slower)$/u;
const BEFORE_A_FIGURE = new Set(
  'a an the about around exactly even just only roughly nearly any'.split(' '),
);
const NOUN_BEFORE_SHARE = new Set(
  'the a an market vote its their our simulated real actual'.split(' '),
);

const tokensOf = (sentence: string): string[] =>
  (sentence.toLowerCase().match(/\d[\d.,]*\d|\d|%|\p{L}[\p{L}'’-]*/gu) ?? []).filter(Boolean);

const isFigure = (token: string): boolean => /^\d/u.test(token) || NUMBER_WORD.test(token);
const within = (tokens: string[], from: number, to: number, test: RegExp): boolean =>
  tokens.slice(Math.max(0, from), Math.max(0, to + 1)).some((token) => test.test(token));

/** Whether the word at `at` is a measure of the world: conversion, churn, a share, adoption, sentiment, revenue. */
function measures(tokens: string[], at: number): boolean {
  const token = tokens[at] ?? '';
  // "adoption tendency" is the name of a trait, and "share" is a measure only as a noun.
  if (token === 'adoption') return tokens[at + 1] !== 'tendency';
  if (token === 'share' || token === 'shares') {
    return tokens[at + 1] === 'of' || NOUN_BEFORE_SHARE.has(tokens[at - 1] ?? '');
  }
  return MEASURE.test(token);
}

/**
 * What a figure in a sentence claims about the world, if it does: it is beside a measure of the world,
 * or beside real people ("18 real customers"), or it is a percentage. Beside a measure or real people
 * it is allowed only where the figure is itself attributed to the simulation: what follows it is
 * simulated, seeded or assumed, or the measure is called simulated. A sentence that says "simulated"
 * elsewhere attributes nothing to them. A percentage on its own names no measure, so it is the
 * sentence that has to say whose it is.
 */
function figureClaim(tokens: string[], at: number): boolean {
  const percent =
    tokens[at + 1] === '%' ||
    tokens[at + 1] === 'percent' ||
    (tokens[at + 1] === 'per' && tokens[at + 2] === 'cent');
  let measure = -1;
  for (let other = Math.max(0, at - 6); other <= Math.min(tokens.length - 1, at + 6); other += 1) {
    if (measures(tokens, other) && (measure < 0 || Math.abs(other - at) < Math.abs(measure - at))) {
      measure = other;
    }
  }
  const realWorld =
    within(tokens, at + 1, at + 3, REAL) &&
    (measure >= 0 || within(tokens, at + 2, at + 5, PEOPLE));
  if (!percent && measure < 0 && !realWorld) return false;
  // "not 18 real customers": the sentence says what the figure is not.
  let before = at - 1;
  while (before >= 0 && BEFORE_A_FIGURE.has(tokens[before] ?? '')) before -= 1;
  if (before >= 0 && DENIAL.test(tokens[before] ?? '')) return false;
  if (realWorld) return true;
  if (measure < 0) {
    // "25% higher" is how much a setting was moved, not a share of anyone.
    return !(
      RELATIVE_CHANGE.test(tokens[at + 2] ?? '') ||
      within(tokens, 0, tokens.length - 1, OF_THE_SIMULATION)
    );
  }
  return !(
    within(tokens, at + 1, at + 5, OF_THE_SIMULATION) ||
    within(tokens, measure - 2, measure - 1, OF_THE_SIMULATION)
  );
}

/**
 * What a statement may not claim. Swarm explores scenarios and does not predict: it never says what
 * will happen, and a figure that looks like a rate in the world (a share, a conversion, a churn) is
 * only ever a count of simulated members or of seeded runs, and says so where the figure is. What a
 * source or the person wrote is quoted, and is theirs.
 */
export function claimsAgainst(text: string): string[] {
  const found: string[] = [];
  const own = text.replace(QUOTED, ' ');
  for (const sentence of own.split(/(?<=[.!?])\s+|[;\n]/u)) {
    const said = sentence.trim();
    if (!said) continue;
    if (FUTURE.some((pattern) => pattern.test(said))) found.push(`a prediction: "${said}"`);
    const tokens = tokensOf(said);
    if (tokens.some((token, at) => isFigure(token) && figureClaim(tokens, at))) {
      found.push(`a real-world figure that is not attributed to the simulation: "${said}"`);
    }
  }
  return found;
}
