import type { BriefStatement, DecisionBrief, StatementOrigin } from '../../../shared/brief.js';

/**
 * The wording guard. A simulation explores what could happen under stated assumptions; it does not
 * forecast, and it measures no real population. So nothing the brief says in its own words may
 * predict ("will", "is expected to"), overclaim ("certainly", "guarantee", "proves"), put a
 * percentage on real people, or put a figure on a measure of the real world (a conversion, a share, a
 * level of adoption or of sentiment, revenue) unless the figure itself says whose it is, and anything
 * that sums up the simulation has to say that it is simulated.
 *
 * Text a person, a source or an earlier step supplied is put into a sentence in curly quotation
 * marks (`embed`), and quoted text is theirs and not ours, so it is not checked. The builder runs
 * every statement through these checks as it writes it and withholds one that fails, and the same
 * checks run over a finished brief (`lintBrief`) so that they can be tested on their own.
 */

export type WordingRule =
  'prediction' | 'overclaim' | 'percentage' | 'real-world-claim' | 'missing-simulated';

export interface WordingIssue {
  rule: WordingRule;
  /** The words that broke the rule. */
  match: string;
  /** Where in the brief they are, so that a person can find them. */
  where: string;
}

const NUMBER_WORDS =
  'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?|half';

/** What says that something is bound to happen: a form of "to be", a word of certainty or of forecast, and "to". */
const FORECAST_PHRASE = new RegExp(
  String.raw`\b(?:is|are|was|were|be|been|being)\s+(?:(?:almost|virtually|nearly|very|also|now|still|not|never|all but)\s+){0,2}` +
    // "set to 0.5" says how something was configured, not what will happen.
    String.raw`(?:certain|sure|bound|likely|unlikely|expected|projected|forecast(?:ed)?|predicted|guaranteed|poised|destined|slated|anticipated|set(?!\s+to\s+[+-]?\d))\s+to\b`,
  'giu',
);

/**
 * A verb of forecast with what is forecast: "analysts forecast a rise", "predicts that". Where it is
 * denied ("does not predict the future", "nothing here forecasts a rise") it is a disclaimer, not a forecast.
 */
const FORECAST_VERB = new RegExp(
  String.raw`(?<!\b(?:not|never|neither|nor|cannot|nothing|nobody|without|no|\p{L}+n['’]t)\s+(?:\p{L}+\s+)?)` +
    String.raw`\b(?:forecast(?:s|ed|ing)?|predict(?:s|ed|ing)?|anticipate[sd]?|anticipating)\s+` +
    String.raw`(?:a|an|the|that|more|less|further|continued|some|no)\b`,
  'giu',
);

const PATTERNS: {
  rule: Exclude<WordingRule, 'real-world-claim' | 'missing-simulated'>;
  pattern: RegExp;
}[] = [
  { rule: 'prediction', pattern: /\b(?:will|shall|won['’]t|going to)\b/giu },
  { rule: 'prediction', pattern: FORECAST_PHRASE },
  { rule: 'prediction', pattern: FORECAST_VERB },
  {
    rule: 'overclaim',
    pattern:
      /\b(?:certainly|guarantee[ds]?|guaranteeing|proves?|proven|definitely|undoubtedly|inevitabl[ey])\b/giu,
  },
  // Every number written as a percentage: ours are counts of simulated members and runs, never rates.
  {
    rule: 'percentage',
    pattern: new RegExp(
      String.raw`(?:\d[\d.,]*|\b(?:one|${NUMBER_WORDS}))\s*(?:%|per ?cent\b)`,
      'giu',
    ),
  },
];

/** What sums up, or interprets, the simulation must say so. */
export const SIMULATION_ORIGINS: ReadonlySet<StatementOrigin> = new Set([
  'simulation-aggregation',
  'actor-behavior',
  'model-interpretation',
]);

const QUOTED = /“[^”]*”/gu;

/** The words that are ours: what is left when quoted text is taken out. */
export const ownWords = (text: string): string => text.replace(QUOTED, ' ');

export const mentionsSimulated = (text: string): boolean => /\bsimulated\b/iu.test(ownWords(text));

// A figure about the world, in the words of the brief, is a claim it cannot make. What is meant here
// is a quantity next to a measure of the real world ("conversion increased by 18"), or next to real
// people ("18 real customers"). It is allowed where the figure itself is attributed: what follows the
// number is simulated or seeded ("18 of 40 simulated members", "11 of 12 paired runs"), or the measure
// is called so ("simulated share"). That the sentence says "simulated" somewhere else is not enough:
// "Simulated counts show conversion increased by 18 real customers" attributes nothing to anything.

/**
 * Words for a measure of the real world, as patterns for one whole word. A figure beside one is a
 * figure about the world. These two lists are the guard's subject and the only place in the brief's
 * source that such words stand: the domain scan of brief-neutrality.test.ts skips them and nothing else.
 * (A "share" is a measure only as a noun, and "adoption tendency" is a trait, so both are read in
 * `isMeasure`.)
 */
export const REAL_WORLD_MEASURES: readonly string[] = [
  'conversions?',
  'churn(?:ed|ing)?',
  'retention',
  'attrition',
  'adoption',
  'uptake',
  'take-up',
  'sentiment',
  'satisfaction',
  'revenues?',
  'sales',
  'profits?',
];

/** Words for the people a figure would count if it were about the world and not about simulated members. */
export const REAL_PEOPLE: readonly string[] = [
  'customers?',
  'users?',
  'people',
  'persons?',
  'members?',
  'employees?',
  'staff',
  'subscribers?',
  'shoppers?',
  'buyers?',
  'clients?',
  'consumers?',
  'patients?',
  'residents?',
  'citizens?',
  'households?',
  'voters?',
  'workers?',
  'students?',
  'visitors?',
  'respondents?',
  'participants?',
];
const QUANTITY = new RegExp(String.raw`^(?:\d|(?:${NUMBER_WORDS})$)`, 'u');
const OF_THE_SIMULATION =
  /^(?:simulated|simulation|simulations|synthetic|fictional|seeded|paired|modelled|modeled|virtual|assumed|assumption|assumptions|runs?|seeds?)$/u;
const REAL = /^(?:real|actual|genuine|real-world)$/u;
/** Words that put what follows in the world: "18 customers actually left". */
const REALLY = /^(?:actually|really|truly|genuinely)$/u;
const MEASURE = new RegExp(`^(?:${REAL_WORLD_MEASURES.join('|')})$`, 'u');
const PEOPLE = new RegExp(`^(?:${REAL_PEOPLE.join('|')})$`, 'u');
const DENIAL = /^(?:not|never|neither|nor|no|none|cannot|without|\p{L}+n['’]t)$/u;
const LEADING = new Set([
  'a',
  'an',
  'the',
  'about',
  'around',
  'exactly',
  'even',
  'just',
  'only',
  'roughly',
  'nearly',
  'any',
]);
const SHARE_AFTER = new Set([
  'the',
  'a',
  'an',
  'market',
  'vote',
  'its',
  'their',
  'our',
  'simulated',
  'real',
  'actual',
]);

interface Word {
  text: string;
  start: number;
  end: number;
}

const wordsOf = (sentence: string): Word[] =>
  [...sentence.matchAll(/\d[\d.,]*\d|\d|\p{L}[\p{L}'’-]*/gu)].map((found) => ({
    text: found[0].toLowerCase(),
    start: found.index ?? 0,
    end: (found.index ?? 0) + found[0].length,
  }));

function isMeasure(words: readonly Word[], at: number): boolean {
  const word = words[at]?.text ?? '';
  // The name of a trait ("adoption tendency 0.60") is not a rate; "share" is a measure only as a noun.
  if (word === 'adoption') return words[at + 1]?.text !== 'tendency';
  if (word === 'share' || word === 'shares') {
    return words[at + 1]?.text === 'of' || SHARE_AFTER.has(words[at - 1]?.text ?? '');
  }
  return MEASURE.test(word);
}

const anyIn = (words: readonly Word[], from: number, to: number, test: RegExp): boolean =>
  words.slice(Math.max(0, from), Math.max(0, to) + 1).some((word) => test.test(word.text));

/** What the figure at `at` claims about the real world, as the first and last word of the claim; null when it claims none. */
function claimAt(words: readonly Word[], at: number): [number, number] | null {
  let measure = -1;
  for (let other = Math.max(0, at - 6); other <= Math.min(words.length - 1, at + 6); other += 1) {
    if (isMeasure(words, other) && (measure < 0 || Math.abs(other - at) < Math.abs(measure - at))) {
      measure = other;
    }
  }
  const realPeople =
    (anyIn(words, at + 1, at + 3, REAL) && anyIn(words, at + 2, at + 5, PEOPLE)) ||
    // "18 customers actually left": the people are named first, and the word that puts them in the world comes after.
    (PEOPLE.test(words[at + 1]?.text ?? '') && anyIn(words, at + 2, at + 3, REALLY));
  const realMeasure = measure >= 0 && anyIn(words, at + 1, at + 3, REAL);
  if (measure < 0 && !realPeople) return null;
  // "not 18 real customers": the sentence is saying what the figure is not.
  let before = at - 1;
  while (before >= 0 && LEADING.has(words[before]!.text)) before -= 1;
  if (before >= 0 && DENIAL.test(words[before]!.text)) return null;
  const ofSimulation =
    anyIn(words, at + 1, at + 4, OF_THE_SIMULATION) ||
    (measure >= 0 && anyIn(words, measure - 2, measure - 1, OF_THE_SIMULATION));
  if (!realPeople && !realMeasure && ofSimulation) return null;
  return [
    Math.min(at, measure < 0 ? at : measure),
    Math.min(words.length - 1, Math.max(at, measure, realPeople || realMeasure ? at + 3 : at)),
  ];
}

/** The stretches of a text, one to a sentence, that put a figure on the real world without saying it is the simulation's. */
function realWorldClaims(own: string): string[] {
  const claims: string[] = [];
  for (const sentence of own.split(/(?<=[.!?])\s+|[;\n]/u)) {
    const words = wordsOf(sentence);
    for (let at = 0; at < words.length; at += 1) {
      // "one" is a number only where it counts real people: "no one" and "one of them" are not.
      const counts =
        QUANTITY.test(words[at]!.text) ||
        (words[at]!.text === 'one' && REAL.test(words[at + 1]?.text ?? ''));
      const span = counts ? claimAt(words, at) : null;
      if (span) {
        claims.push(sentence.slice(words[span[0]]!.start, words[span[1]]!.end));
        break;
      }
    }
  }
  return claims;
}

export function lintText(text: string, where = 'text'): WordingIssue[] {
  const own = ownWords(text);
  return [
    ...PATTERNS.flatMap(({ rule, pattern }) =>
      [...own.matchAll(pattern)].map((match) => ({ rule, match: match[0], where })),
    ),
    ...realWorldClaims(own).map((match) => ({ rule: 'real-world-claim' as const, match, where })),
  ];
}

export function lintStatement(
  statement: Pick<BriefStatement, 'text' | 'origin'>,
  where: string,
): WordingIssue[] {
  const issues = lintText(statement.text, where);
  if (SIMULATION_ORIGINS.has(statement.origin) && !mentionsSimulated(statement.text)) {
    issues.push({ rule: 'missing-simulated', match: statement.origin, where });
  }
  return issues;
}

/** Every piece of prose in a brief that is the brief's own. */
export function lintBrief(brief: DecisionBrief): WordingIssue[] {
  const issues: WordingIssue[] = [...lintText(brief.headline, 'headline')];
  if (!mentionsSimulated(brief.headline)) {
    issues.push({ rule: 'missing-simulated', match: 'headline', where: 'headline' });
  }
  for (const section of brief.sections) {
    for (const statement of section.statements) {
      issues.push(...lintStatement(statement, `${section.id}/${statement.id}`));
    }
  }
  for (const recommendation of brief.recommendations) {
    const where = `recommendation/${recommendation.id}`;
    issues.push(
      ...lintText(
        [
          recommendation.text,
          recommendation.horizon,
          recommendation.ownerFunction,
          recommendation.validation,
          ...recommendation.leadingIndicators,
        ].join('\n'),
        where,
      ),
    );
    if (!mentionsSimulated(recommendation.text)) {
      issues.push({ rule: 'missing-simulated', match: 'recommendation', where });
    }
  }
  for (const experiment of brief.validationPlan) {
    issues.push(
      ...lintText(
        [
          experiment.question,
          experiment.method,
          experiment.successSignal,
          experiment.duration,
        ].join('\n'),
        `validation/${experiment.id}`,
      ),
    );
  }
  brief.limitations.forEach((limitation, index) =>
    issues.push(...lintText(limitation, `limitation/${index + 1}`)),
  );
  brief.methodology.notes.forEach((note, index) =>
    issues.push(...lintText(note, `methodology/${index + 1}`)),
  );
  return issues;
}
