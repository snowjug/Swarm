import { CONTEXT_CUES } from './lexicon.js';
import { phrasesOf, wordsOf } from './mentions.js';

/**
 * Reading the tone of a sentence from its wording, for the rules path of stakeholder discovery. Two
 * short lists of everyday words say that a group is troubled by something (concern) or welcomes it
 * (support). A cue counts when it stands in a sentence that names the group and nothing within three
 * words before it turns it round ("no concern", "not worried"). It is a reading of tone and not a
 * finding: the lists are transparent so that a person can see exactly what was counted, and the
 * review screen is where the direction is confirmed or changed.
 *
 * Like the role lexicon, these lists name no market, product or organisation.
 */

export type Direction = 'harmed' | 'benefited' | 'mixed' | 'unclear';

/** Words and short phrases that say a group is worried, opposed, burdened or exposed. */
export const CONCERN_CUES: readonly string[] = [
  ...'worry worries worried worrying worrisome concern concerns concerned uneasy unease uncomfortable anxious anxiety nervous wary afraid fear fears feared'.split(
    ' ',
  ),
  ...'sceptical skeptical scepticism skepticism doubt doubts distrust mistrust unhappy upset annoyed angry frustrated frustrating frustration irritated resent resents resented resentment confused confusing confusion'.split(
    ' ',
  ),
  ...'dislike dislikes disliked hate hates hated objection objections objected oppose opposes opposed opposition resist resists resisted resistance'.split(
    ' ',
  ),
  ...'reject rejects rejected rejection refuse refuses refused refusal complain complains complained complaint complaints threat threats threaten threatens threatened'.split(
    ' ',
  ),
  ...'risk risks risky harm harms harmed harmful damage damages damaged damaging loss losses lose loses lost losing'.split(
    ' ',
  ),
  ...'costly expensive unaffordable burden burdens burdensome overload overloaded overwhelmed overwhelming surcharge surcharges'.split(
    ' ',
  ),
  ...'delay delays delayed delaying disrupt disrupts disrupted disruption disruptions difficult difficulty difficulties struggle struggles struggled struggling'.split(
    ' ',
  ),
  ...'penalty penalties penalise penalize penalised penalized unwilling reluctant reluctance hesitant hesitate hesitation vulnerable liability liable breach barrier barriers'.split(
    ' ',
  ),
  ...'worse worsen worsens worsened worsening harder slower unfair unfairly inconvenient inconvenience surprise surprised surprising unexpected unexpectedly hidden'.split(
    ' ',
  ),
  // Cost, charge and workload are cues only in a phrase that makes them a burden: on their own they
  // are as often a plain amount or a technical load.
  'object to',
  'objects to',
  'cannot afford',
  'who pays',
  'who will pay',
  'pay more',
  'pays more',
  'paying more',
  'pay extra',
  'give up',
  'gives up',
  'gave up',
  'cost rise',
  'cost rises',
  'cost increase',
  'cost increases',
  'extra cost',
  'extra costs',
  'additional cost',
  'additional costs',
  'higher cost',
  'higher costs',
  'rising cost',
  'rising costs',
  'costs more',
  'cost more',
  'be charged',
  'been charged',
  'being charged',
  'extra charge',
  'extra charges',
  'additional charge',
  'additional charges',
  'new charge',
  'new charges',
  'extra workload',
  'additional workload',
  'more workload',
  'heavy workload',
  'heavier workload',
  'increased workload',
  'higher workload',
  'workload increase',
  'extra work',
  'more work',
  'additional work',
  'extra effort',
  'more effort',
  'additional effort',
  'take longer',
  'takes longer',
  'took longer',
  'expect more',
  'expects more',
  'less control',
];

/** Words and short phrases that say a group welcomes, gains from or saves by something. */
export const SUPPORT_CUES: readonly string[] = [
  ...'welcome welcomes welcomed like likes liked love loves loved enjoy enjoys enjoyed appreciate appreciates appreciated favour favours favoured favor favors favored'.split(
    ' ',
  ),
  ...'supportive support supports supported endorse endorses endorsed embrace embraces embraced eager enthusiastic enthusiasm excited optimistic keen pleased happy delighted satisfied'.split(
    ' ',
  ),
  ...'benefit benefits benefited beneficial gain gains gained gaining save saves saved saving savings advantage advantages advantageous'.split(
    ' ',
  ),
  ...'improve improves improved improvement improvements improving easier faster simpler cheaper better relief relieved helpful useful valuable positive opportunity opportunities reward rewards rewarded profit profits profitable'.split(
    ' ',
  ),
  'in support of',
];

/** A word that turns a cue round when it comes within three words before it. */
export const NEGATION_WORDS: readonly string[] =
  'no not never without neither nor none nothing nobody cannot hardly barely scarcely'.split(' ');
/** Every word ending in this turns a cue round too: "isn't", "doesn't", "won't". */
export const NEGATION_ENDING = "n't";
/** Two-word turns of phrase that do the same. */
export const NEGATION_PHRASES: readonly string[] = ['free of', 'lack of', 'absence of'];

/** Words that, with a role noun, show that something is decided, paid for or at risk. */
const DECISION_WORDS =
  'decide decides decided deciding decision decisions approve approves approved approval authorise authorises authorised authorize authorizes authorized authorisation authorization veto vetoes vetoed mandate mandates mandated choose chooses chose chosen sign-off signoff budget budgets'.split(
    ' ',
  );

const STAKES: ReadonlySet<string> = new Set([
  ...DECISION_WORDS,
  ...CONTEXT_CUES.cost,
  ...CONTEXT_CUES.risk,
]);

interface CueEntry {
  kind: 'concern' | 'support';
  words: string[];
  text: string;
}

const ENTRIES: ReadonlyMap<string, readonly CueEntry[]> = (() => {
  const byFirst = new Map<string, CueEntry[]>();
  for (const [kind, list] of [
    ['concern', CONCERN_CUES],
    ['support', SUPPORT_CUES],
  ] as const) {
    for (const text of list) {
      const words = text.split(' ');
      const first = words[0];
      if (first === undefined) continue;
      byFirst.set(first, [...(byFirst.get(first) ?? []), { kind, words, text }]);
    }
  }
  for (const entries of byFirst.values()) entries.sort((a, b) => b.words.length - a.words.length);
  return byFirst;
})();

const NEGATION_SET: ReadonlySet<string> = new Set(NEGATION_WORDS);
const NEGATION_PAIRS: readonly (readonly string[])[] = NEGATION_PHRASES.map((phrase) =>
  phrase.split(' '),
);

const SUPPORT_AFTER: ReadonlySet<string> = new Set(
  'will would may might can could should must to also generally broadly strongly fully largely mostly mainly overall publicly openly still'.split(
    ' ',
  ),
);
const LIKE_NOT_AFTER: ReadonlySet<string> = new Set(
  'look looks looked looking feel feels felt seem seems seemed would could might may much just something nothing anything more less very'.split(
    ' ',
  ),
);
const LIKE_BEFORE: ReadonlySet<string> = new Set(
  'the this that these those it them its their our a an to having being how what using when'.split(
    ' ',
  ),
);

export interface Hit {
  kind: 'concern' | 'support';
  /** The cue as listed, in lower case. */
  text: string;
  /** The words it covers, in lower case, so that a group's own name is never read as tone. */
  words: string[];
  /** Where it starts and how many words it covers, among the words of the sentence. */
  first: number;
  length: number;
}

/** A group named in the sentence by a role noun: the words it covers, among the words of the sentence. */
export interface Named {
  key: string;
  first: number;
  head: number;
}

export interface Tone {
  concern: string[];
  support: string[];
  hits: Hit[];
  /** Cues that a negation turned round, which count for nothing. */
  negated: string[];
  /** The groups the sentence names, so that a cue can be read as about the nearest of them. */
  named: Named[];
  /** The words of the sentence, without plural or possessive ending. */
  bases: string[];
}

const lowerOf = (raw: string): string => raw.toLowerCase().replaceAll('’', "'");

/** The cue words in a sentence that count, each listed once, in the order they appear. */
export function readTone(sentence: string): Tone {
  const words = wordsOf(sentence);
  const lower = words.map((word) => lowerOf(word.raw));
  const phrases = phrasesOf(sentence);
  const tone: Tone = {
    concern: [],
    support: [],
    hits: [],
    negated: [],
    named: phrases.map((phrase) => ({
      key: phrase.key,
      first: phrase.firstIndex,
      head: phrase.headIndex,
    })),
    bases: words.map((word) => word.base),
  };
  // Words inside a group's name ("risk reviewers", "support team") describe the group, not its mood.
  const inside = new Set<number>();
  for (const phrase of phrases) {
    for (let at = phrase.firstIndex; at <= phrase.headIndex; at += 1) inside.add(at);
  }

  const matchAt = (index: number): CueEntry | null => {
    for (const entry of ENTRIES.get(lower[index] ?? '') ?? []) {
      const fits = entry.words.every(
        (part, offset) => lower[index + offset] === part && !inside.has(index + offset),
      );
      if (fits) return entry;
    }
    return null;
  };

  const guarded = (entry: CueEntry, index: number): boolean => {
    const before = lower[index - 1] ?? '';
    const after = lower[index + entry.words.length] ?? '';
    // "looks like", "would like" and "things like" say nothing about a group's mood.
    if (entry.text === 'like') return LIKE_NOT_AFTER.has(before) || !LIKE_BEFORE.has(after);
    // "support" is a function ("the support team", "the partner that supports the tenant") unless it follows a modal.
    if (['support', 'supports', 'supported'].includes(entry.text))
      return !SUPPORT_AFTER.has(before);
    return false;
  };

  const turnedRound = (index: number): boolean => {
    const cue = words[index];
    if (!cue) return false;
    for (let at = index - 1; at >= Math.max(0, index - 3); at -= 1) {
      const word = words[at];
      const token = lower[at];
      if (!word || token === undefined) break;
      // A comma, colon or bracket between the two ends the reach of a negation.
      if (/[,;:()—–]/u.test(sentence.slice(word.end, (words[at + 1] ?? cue).start))) break;
      if (NEGATION_SET.has(token) || token.endsWith(NEGATION_ENDING)) return true;
      const prior = lower[at - 1];
      if (NEGATION_PAIRS.some(([first, second]) => prior === first && token === second))
        return true;
    }
    return false;
  };

  for (let index = 0; index < words.length; index += 1) {
    const entry = inside.has(index) ? null : matchAt(index);
    if (!entry || guarded(entry, index)) continue;
    if (turnedRound(index)) {
      tone.negated.push(entry.text);
    } else {
      tone.hits.push({
        kind: entry.kind,
        text: entry.text,
        words: lower.slice(index, index + entry.words.length),
        first: index,
        length: entry.words.length,
      });
      const list = entry.kind === 'concern' ? tone.concern : tone.support;
      if (!list.includes(entry.text)) list.push(entry.text);
    }
    index += entry.words.length - 1;
  }
  return tone;
}

/** A group whose cues are being read: its key, and the words of its name. */
export interface Group {
  /** The group's key, as `keyOf` makes it. */
  key: string;
  /** The words of its name, lower case, which are never read as tone. */
  own: ReadonlySet<string>;
}

/** A word that says where a burden or a benefit lands: "falls on customers", "a concern for staff". */
const LANDS_ON: ReadonlySet<string> = new Set('on upon for to towards among amongst'.split(' '));

/**
 * The group a cue is about: the one named just before it, which in a sentence that says what a group
 * feels is the one that feels it; or, when none comes before, the one the cue lands on ("unhappy
 * customers", "a charge that falls on customers"), but not one further on, where the cue is more
 * likely about someone else.
 */
function owner(hit: Hit, named: readonly Named[], bases: readonly string[]): Named | undefined {
  const before = named.filter((group) => group.head < hit.first).sort((a, b) => b.head - a.head)[0];
  if (before) return before;
  const end = hit.first + hit.length;
  return named
    .filter((group) => {
      const between = group.first - end;
      if (between < 0) return false;
      return between <= 1 || (between <= 3 && LANDS_ON.has(bases[group.first - 1] ?? ''));
    })
    .sort((a, b) => a.first - b.first)[0];
}

/**
 * The cue words several cited sentences carry between them for one group. A cue counts for the group
 * when it is not part of the group's own name and the group is the one the cue is about (see
 * `owner`): a sentence that names one group says each cue of that group, and one that names several
 * gives each cue to the one named just before it ("..., because the sales team has not been asked"
 * does not make the sales team the one that would object).
 */
export function readCited(
  sentences: readonly string[],
  group: Group,
  read: (sentence: string) => Tone = readTone,
): { concern: string[]; support: string[] } {
  const concern: string[] = [];
  const support: string[] = [];
  const wanted = group.key.split(' ').filter(Boolean);
  for (const sentence of sentences) {
    const tone = read(sentence);
    if (tone.hits.length === 0) continue;
    // Where the sentence names this group: by a role noun, or else by the words of its name.
    const named = [...tone.named];
    if (!named.some((item) => item.key === group.key) && wanted.length > 0) {
      tone.bases.forEach((_, index) => {
        if (wanted.every((part, offset) => tone.bases[index + offset] === part)) {
          named.push({ key: group.key, first: index, head: index + wanted.length - 1 });
        }
      });
    }
    const placed = named.some((item) => item.key === group.key);
    for (const hit of tone.hits) {
      if (hit.words.some((word) => group.own.has(word))) continue;
      if (placed && owner(hit, named, tone.bases)?.key !== group.key) continue;
      const list = hit.kind === 'concern' ? concern : support;
      if (!list.includes(hit.text)) list.push(hit.text);
    }
  }
  return { concern, support };
}

/** Concern only is harmed, support only is benefited, both is mixed, neither is unclear. */
export function directionOf(concern: number, support: number): Direction {
  if (concern > 0 && support > 0) return 'mixed';
  if (concern > 0) return 'harmed';
  if (support > 0) return 'benefited';
  return 'unclear';
}

const SHOWN = 4;
const quoted = (words: readonly string[]): string => {
  const shown = words.slice(0, SHOWN).map((word) => `“${word}”`);
  const more = words.length - SHOWN;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
};

/** Why a direction was read, quoting the words that decided it and saying what kind of reading it is. */
export function toneRationale(concern: readonly string[], support: readonly string[]): string {
  const lead =
    concern.length > 0 && support.length > 0
      ? `Concern cues in the cited passage: ${quoted(concern)}; support cues: ${quoted(support)}, so the direction is mixed.`
      : concern.length > 0
        ? `Concern cues in the cited passage: ${quoted(concern)}.`
        : `Support cues in the cited passage: ${quoted(support)}.`;
  return `${lead} This is a reading of tone from the cited passage, not a finding.`;
}

/** Whether a sentence shows that something is decided, paid for, at risk or felt by the group it names. */
export function hasStakes(sentence: string, read: (sentence: string) => Tone = readTone): boolean {
  const tone = read(sentence);
  if (tone.hits.length > 0) return true;
  return wordsOf(sentence).some((word) => STAKES.has(lowerOf(word.raw)) || STAKES.has(word.base));
}

export interface DirectionCounts {
  total: number;
  /** Read from the wording of cited sentences. */
  wording: number;
  /** Taken from the group's category, which implies a direction for two categories. */
  category: number;
  /** Set by a model, or by a person. */
  stated: number;
  unclear: number;
}

/** How the live stakeholders' directions of impact came about, for the notes a person reads. */
export function countDirections(
  stakeholders: readonly {
    status: string;
    expectedImpact: { direction: Direction; origin?: string | undefined };
  }[],
): DirectionCounts {
  const live = stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
  const counts: DirectionCounts = {
    total: live.length,
    wording: 0,
    category: 0,
    stated: 0,
    unclear: 0,
  };
  for (const { expectedImpact } of live) {
    if (expectedImpact.direction === 'unclear') counts.unclear += 1;
    else if (expectedImpact.origin === 'evidence') counts.wording += 1;
    else if (expectedImpact.origin === 'model' || expectedImpact.origin === 'user')
      counts.stated += 1;
    else counts.category += 1;
  }
  return counts;
}

/** One plain sentence on where the directions came from and how many are still unclear. */
export function describeDirections(counts: DirectionCounts, noun: string): string {
  if (counts.total === 0) return '';
  if (counts.unclear === counts.total) {
    return `No direction of impact could be read from the wording: all ${counts.total} ${noun} are unclear, so the change cannot move any of them until a person says who is helped or harmed.`;
  }
  const parts = [
    `${counts.wording} of ${counts.total} ${noun} have a direction of impact read from the wording of their cited sentences`,
    ...(counts.stated > 0 ? [`${counts.stated} were set by a model or a person`] : []),
    ...(counts.category > 0 ? [`${counts.category} take the default of their category`] : []),
    `${counts.unclear} remain unclear, so the change cannot move them`,
  ];
  return `${parts.join('; ')}.`;
}
