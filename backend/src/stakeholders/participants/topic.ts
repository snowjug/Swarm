import type { ScenarioFrame } from '../../../../shared/scenario.js';
import { capitalise, truncate } from '../names.js';
import { CLOSED_CLASS } from './vocabulary.js';

const LEADING: ReadonlySet<string> = new Set(
  'a an the one this that particular certain selected specific given some any another our their its'.split(
    ' ',
  ),
);

/** The scenario's system in a few words, for naming a participant that the sources only call "staff" or "users". */
export function shortSystem(scenario: ScenarioFrame | null): string | null {
  const raw = scenario?.system.trim();
  if (!raw) return null;
  // "Quality of the service" is cut before "of"; "City of Harrowgate" is a name, and "of" does not cut it.
  const head = raw.split(/[,;(]| in | for | at | on /iu)[0]?.split(/ of (?=\p{Ll})/u)[0] ?? raw;
  const words = head.split(/\s+/u).filter(Boolean);
  while (words[0] && LEADING.has(words[0].toLowerCase())) words.shift();
  const kept = words.slice(0, 4).join(' ');
  return kept === '' ? null : kept;
}

/** A generic name made specific by the system it belongs to: "Users" in a scenario about "Online store". */
export function qualifyName(name: string, scenario: ScenarioFrame | null): string | null {
  const system = shortSystem(scenario);
  if (!system) return null;
  return truncate(`${capitalise(system)} ${name.toLowerCase()}`, 120);
}

/** A change's name that reads as a thing: a few words that do not begin in the middle of a sentence. */
const readsAsThing = (name: string): boolean => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0]?.toLowerCase() ?? '';
  return (
    words.length >= 1 && words.length <= 4 && !CLOSED_CLASS.has(first) && /^\p{L}/u.test(first)
  );
};

/** Whether the text writes the word with a capital in the middle of a sentence, which is how a name is told from a noun. */
const writtenAsName = (word: string, text: string): boolean =>
  new RegExp(
    String.raw`(?<=[\p{L}\p{N},;:]\s)${word.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}(?![\p{L}\p{N}])`,
    'u',
  ).test(text);

/**
 * What the decision is about, in the scenario's own nouns, for naming a participant that a role pattern
 * adds: the first change the frame names ("the returns window"), or else its system ("the cloud
 * service"), or else "this change". A word the question or the decision writes as a name keeps its
 * capital ("the Eastgate pool").
 */
export function subjectOf(scenario: ScenarioFrame | null, question: string): string {
  const change = scenario?.changes.map((item) => item.name.trim()).find(readsAsThing);
  if (change) return `the ${change.charAt(0).toLowerCase()}${change.slice(1)}`;
  const system = shortSystem(scenario);
  if (!system) return 'this change';
  const first = system.split(/\s+/u)[0] ?? '';
  const text = [question, scenario?.decision, scenario?.baseline].filter(Boolean).join(' ');
  if (!(/^\p{Lu}/u.test(first) && writtenAsName(first, text))) {
    return `the ${system.charAt(0).toLowerCase()}${system.slice(1)}`;
  }
  // A name made only of capitalised words ("Rooms", "Eastgate Library") is a name by itself, and takes no article.
  return system.split(/\s+/u).every((word) => /^\p{Lu}/u.test(word)) ? system : `the ${system}`;
}
