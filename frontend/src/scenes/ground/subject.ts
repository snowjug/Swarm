/**
 * Whether what the sources talk about is what the question is about. A question names its subject (a product, a
 * body, a place, a policy) with a capital in the middle of a sentence; if no source mentions one of those names the
 * evidence may be about something nearby and not bear on the question at all, and the person is told so before
 * they rely on it. This is a word count over the sources' own text, not a judgement of relevance, and it never
 * says a source is wrong: it says what the sources do not mention.
 */

/** Words that begin a question or join one, and are written with a capital only at its start. */
const NOT_NAMES: ReadonlySet<string> = new Set(
  'i the a an if and or but so then what how why when where who whom whose which will would could should can may might must shall does did do is are was were be been being has have had'.split(
    ' ',
  ),
);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const MOST_SUBJECTS = 6;

/** The names a question uses, in the order it uses them: words with a capital that do not open a sentence. */
export function subjectsOf(question: string): string[] {
  const subjects = new Map<string, string>();
  let opens = true;
  let last = 0;
  for (const match of question.matchAll(WORD)) {
    const word = match[0];
    const between = question.slice(last, match.index);
    if (/[.!?]\s*$/u.test(between) || /\n\s*\n/u.test(between)) opens = true;
    last = (match.index ?? 0) + word.length;
    const capital = /^\p{Lu}/u.test(word);
    const lower = word.toLowerCase();
    if (capital && !opens && word.length >= 3 && !NOT_NAMES.has(lower) && !subjects.has(lower)) {
      subjects.set(lower, word);
    }
    opens = false;
  }
  return [...subjects.values()].slice(0, MOST_SUBJECTS);
}

const escapePattern = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

export interface SubjectCoverage {
  /** The names the question uses. */
  subjects: string[];
  /** Those that no source mentions. */
  missing: string[];
  /** How many sources were read. */
  sources: number;
}

/**
 * The names of the question that no source mentions, or null when there is nothing to say: no source, no name in the
 * question, or every name mentioned.
 */
export function subjectCoverage(
  question: string,
  documents: readonly { content: string }[],
): SubjectCoverage | null {
  if (documents.length === 0) return null;
  const subjects = subjectsOf(question);
  if (subjects.length === 0) return null;
  const missing = subjects.filter((name) => {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(name)}`, 'iu');
    return !documents.some((document) => pattern.test(document.content));
  });
  return missing.length === 0 ? null : { subjects, missing, sources: documents.length };
}

/** What the notice says, in words a person can act on. */
export function subjectCoverageWords(coverage: SubjectCoverage): { title: string; body: string } {
  const names = coverage.missing.map((name) => `“${name}”`);
  const joined = (word: 'and' | 'or'): string =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}`;
  const one = names.length === 1;
  const lead =
    coverage.missing.length === coverage.subjects.length
      ? `None of the names in your question (${joined('and')}) appears`
      : `${joined('and')} ${one ? 'is' : 'are'} in your question and ${one ? 'is' : 'are'} not mentioned`;
  const sources = `${coverage.sources} ${coverage.sources === 1 ? 'source' : 'sources'}`;
  return {
    title: `No source mentions ${joined('or')}`,
    body: `${lead} in the ${sources} read, so they may be about something nearby and not bear on it. Name a more specific page in your question, such as one about ${coverage.missing[0]}, or add a source that is.`,
  };
}
