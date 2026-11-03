import {
  SCOPE_DOMAIN_WORDS,
  SCOPE_NOTICE,
  type DecisionScope,
  type HighStakesDomain,
} from '../../../shared/decision.js';
import type { ConsequentialScope } from './scope.js';
import { Guard, listed } from './words.js';

/**
 * What the canvas says of a question that touches a matter Swarm does not decide. The reading itself is in
 * `scope.ts`; these are the sentences that follow from it, written in one place so that the page, the status, the
 * recommendation, the approval points and the exports all say the same thing, and so that each is held to the same
 * wording guard as every other sentence of the canvas.
 */

/** “employment”, “credit and legal”. */
export const domainsInWords = (domains: readonly HighStakesDomain[]): string =>
  listed(domains.map((domain) => SCOPE_DOMAIN_WORDS[domain].label.toLowerCase()));

/** The people whose review stands in for Swarm’s: “a qualified lawyer and a qualified clinician”. */
export const reviewersOf = (domains: readonly HighStakesDomain[]): string =>
  listed(domains.map((domain) => SCOPE_DOMAIN_WORDS[domain].reviewer));

/** The sentences of the status when the question is about one person. */
export function individualReading(scope: ConsequentialScope): { headline: string; why: string[] } {
  return {
    headline: `The question reads as a decision about one person’s ${domainsInWords(scope.domains)} situation, so Swarm does not make or recommend it: a qualified person decides.`,
    why: [
      `Cues found in the question and its framing: ${scope.basis.join('; ')}.`,
      'What the simulation shows is still shown, as exploration and not as a recommendation.',
      'This is read from the words of the question by rules, so it can be mistaken in either direction.',
    ],
  };
}

/** The approval point that stands for a qualified person, in the words that fit what the question is about. */
export function qualifiedApproval(scope: ConsequentialScope): string {
  const reviewers = reviewersOf(scope.domains);
  return scope.aboutIndividual
    ? `A qualified person decides: ${reviewers}. Swarm does not make or recommend a decision about one person’s ${domainsInWords(scope.domains)} situation, and a named approver agrees to act on it.`
    : `A qualified person reviews anything that touches ${domainsInWords(scope.domains)} matters before it is acted on: ${reviewers}. Swarm does not make or recommend such decisions.`;
}

/** The check that comes first when the question is about one person. */
export function qualifiedCheck(scope: ConsequentialScope): {
  what: string;
  why: string;
  how: string;
} {
  return {
    what: `Have ${reviewersOf(scope.domains)} decide this, with this view as one input.`,
    why: `The question reads as a decision about one person’s ${domainsInWords(scope.domains)} situation. Swarm explores scenarios and does not make or recommend such decisions.`,
    how: 'Take the question to the person who is qualified and accountable for it, and tell them what the exploration can and cannot show. Swarm does not contact anyone.',
  };
}

/** The scope of a canvas, or of a project that has none yet. */
export function scopeSection(scope: ConsequentialScope, guard: Guard): DecisionScope {
  return {
    notice: scope.domains.length > 0 ? SCOPE_NOTICE : null,
    domains: scope.domains,
    aboutIndividual: scope.aboutIndividual,
    basis: scope.basis,
    exploration: scope.aboutIndividual
      ? {
          canTell: [
            guard.statement(
              'How the simulated roles responded in each option, under the assumptions the project states.',
              'simulation-event',
              'scope:can-tell',
            ),
            guard.statement(
              'Which of the stated assumptions and constraints the simulated result is most sensitive to.',
              'simulation-event',
              'scope:can-tell',
            ),
          ],
          cannotTell: [
            guard.statement(
              'What is right, fair or lawful for this person: the exploration knows nothing of their circumstances beyond the question.',
              'validation-requirement',
              'scope:cannot-tell',
            ),
            guard.statement(
              'How this person responds or what happens to them: a simulated role stands for a group and not for one person.',
              'validation-requirement',
              'scope:cannot-tell',
            ),
            guard.statement(
              'Whether a decision follows the rules and the process that apply: that is for the person who decides.',
              'validation-requirement',
              'scope:cannot-tell',
            ),
          ],
        }
      : null,
  };
}
