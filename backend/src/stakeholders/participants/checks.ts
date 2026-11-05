import {
  ROLE_CATEGORIES,
  type ProposedParticipant,
  type ProposedParticipants,
} from '../../../../shared/stakeholders.js';
import { AppError } from '../../errors.js';
import {
  INJECTION_ECHO_PROBLEM,
  echoesInjection,
  findInjectionPayloads,
} from '../../models/injection.js';
import type { ProposalContext } from './context.js';
import {
  compareNames,
  findPersonalDetail,
  findStereotype,
  findUnsupportedMotive,
  isGenericName,
  namesPerson,
  normaliseLine,
  partyProblem,
  wordingProblem,
  wordsIn,
} from './language.js';

const MAX_PROBLEMS = 6;

/** The prose of a proposed participant that a person will read as the proposal's own words. */
export const proseOfProposed = (participant: ProposedParticipant): string[] =>
  [
    participant.description,
    participant.whyTheyMatter,
    participant.objective,
    ...participant.incentives,
    ...participant.pressures,
    ...participant.constraints,
    ...participant.concerns,
    ...participant.informationAccess,
    ...participant.plausibleActions,
    ...participant.assumptions,
    participant.impact.rationale,
    participant.uncertainty.reason,
  ].filter(Boolean);

const first = <T>(items: readonly T[], find: (item: T) => string | null): string | null => {
  for (const item of items) {
    const found = find(item);
    if (found) return found;
  }
  return null;
};

/**
 * The server's checks of a proposal, as one function that throws `MODEL_OUTPUT_INVALID`. The schema
 * has already refused fields that were not asked for and values out of bounds; this refuses what a
 * shape cannot say: ids that repeat, evidence that is not in the project, a name that says nothing, a
 * claim to know a mind, an identified person, a stereotype, a forecast, an unsourced participant that
 * does not say it is an assumption, two participants that are one, and a reply that repeats text an
 * instruction in a source asked for. The problems are listed in words that name ids and fields, never
 * the text of a source, because they are sent back to the model for one correction.
 *
 * The rules path is held to the same function: its answer must pass it before it is used.
 */
export function proposalChecker(
  context: ProposalContext,
  data: unknown,
  options: {
    /** Fewest participants a reply may have: two for a proposal, one for the replacement of a single participant. */
    minimum?: number;
    /** Names a person gave, which are the person's to choose and are not judged for being generic. */
    ownNames?: ReadonlySet<string>;
  } = {},
): (value: ProposedParticipants) => void {
  const payloads = findInjectionPayloads(data);
  const known = new Set(context.passages.map((passage) => passage.id));
  const minimum = options.minimum ?? 2;
  return (value) => {
    const problems: string[] = [];
    const problem = (text: string): void => {
      if (problems.length < MAX_PROBLEMS) problems.push(text);
    };
    const { participants } = value;
    if (participants.length < minimum) {
      problem(
        minimum > 1
          ? 'Propose at least two participants: a decision involves more than one party.'
          : 'Propose exactly one participant.',
      );
    }

    const ids = new Set<string>();
    for (const participant of participants) {
      const label = `“${normaliseLine(participant.name, 40)}” (${participant.id})`;
      if (ids.has(participant.id))
        problem(`${participant.id}: each participant needs an id of its own.`);
      ids.add(participant.id);
      if (isGenericName(participant.name) && !options.ownNames?.has(participant.name)) {
        problem(
          `${label}: the name is too generic. Name the specific role it stands for in this scenario, never staff, users, public, employee, management, stakeholder or team alone.`,
        );
      }
      const notParty = options.ownNames?.has(participant.name)
        ? null
        : partyProblem(participant.name, context.scenario);
      if (notParty) {
        problem(
          `${label}: ${notParty}. Name the people or bodies who decide or are affected, never a heading, a menu item, a feature or the product being changed.`,
        );
      }
      if (
        participant.category &&
        !ROLE_CATEGORIES[participant.role].includes(participant.category)
      ) {
        problem(
          `${label}: category ${participant.category} does not go with role ${participant.role}; use one of ${ROLE_CATEGORIES[participant.role].join(', ')} or leave category out.`,
        );
      }
      const unknown = participant.evidence.find((item) => !known.has(item.passageId));
      if (unknown) {
        problem(
          `${label}: evidence cites passage id ${normaliseLine(unknown.passageId, 20)}, which was not supplied. Use ids from data.evidence.`,
        );
      }
      if (participant.confidenceBasis === 'user-assertion') {
        problem(`${label}: confidenceBasis user-assertion is for a person's own additions.`);
      }
      if (participant.confidenceBasis === 'source-quote' && participant.evidence.length === 0) {
        problem(
          `${label}: confidenceBasis source-quote needs at least one evidence item; otherwise use scenario-statement, category-pattern or model-inference.`,
        );
      }
      if (participant.evidence.length === 0 && participant.assumptions.length === 0) {
        problem(`${label}: with no evidence it must say in assumptions that it is an assumption.`);
      }
      const prose = proseOfProposed(participant);
      const everything = [participant.name, ...prose];
      const person = first(everything, (text) => namesPerson(text, context.personLabels));
      if (person) {
        problem(
          `${label}: it points at an identified person. Represent the public role, not the person.`,
        );
      }
      if (first(everything, findPersonalDetail)) {
        problem(`${label}: it carries a contact detail or a credential. Roles carry neither.`);
      }
      if (first(everything, findStereotype)) {
        problem(
          `${label}: it generalises about what a kind of person is like. Describe the role's constraints and concerns instead.`,
        );
      }
      if (first(prose, (text) => findUnsupportedMotive(text, context.personLabels))) {
        problem(
          `${label}: it claims to know a hidden or private reason. State objectives and concerns as assumptions about the role.`,
        );
      }
      const wording = first(prose, wordingProblem);
      if (wording) {
        problem(
          `${label}: it uses wording that reads as ${wording}. Write possibilities (could, may, might) and attribute any figure to the simulation.`,
        );
      }
    }

    for (let a = 0; a < participants.length; a += 1) {
      for (let b = a + 1; b < participants.length; b += 1) {
        const left = participants[a]!;
        const right = participants[b]!;
        if (compareNames(left.name, right.name) === 'same') {
          problem(`${left.id} and ${right.id} are the same participant: keep one.`);
        }
        const key = (item: ProposedParticipant): string =>
          item.incentives
            .map((line) => wordsIn(line).join(' '))
            .sort()
            .join('|');
        if (left.incentives.length > 0 && key(left) === key(right)) {
          problem(
            `${left.id} and ${right.id} have identical incentives: say what differs for each.`,
          );
        }
      }
    }
    if (echoesInjection(JSON.stringify(value), payloads)) problem(INJECTION_ECHO_PROBLEM);
    if (problems.length > 0) {
      throw new AppError(502, 'MODEL_OUTPUT_INVALID', problems.join(' '));
    }
  };
}
