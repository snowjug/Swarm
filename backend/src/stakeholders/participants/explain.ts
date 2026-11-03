import type { ScenarioFrame } from '../../../../shared/scenario.js';
import {
  CONFIDENCE_BASIS_LABELS,
  CONFIDENCE_BASIS_MEANINGS,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLE_MEANINGS,
  participantOf,
  type ParticipantWhy,
  type RoleCoverage,
  type Stakeholder,
  type StakeholderSet,
} from '../../../../shared/stakeholders.js';
import { normaliseLine } from './language.js';
import { ROLE_COUNT_PHRASE } from './taxonomy.js';

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const DIRECTION_WORDS: Readonly<Record<Stakeholder['expectedImpact']['direction'], string>> = {
  harmed: 'it is harmed',
  benefited: 'it benefits',
  mixed: 'it is both helped and harmed',
  unclear: 'no direction is assumed',
};

/** The part of the question or the scenario the summary leans on: the decision, in the person's words, kept short. */
function topicOf(scenario: ScenarioFrame | null): string {
  const decision = scenario?.decision.trim();
  return decision ? `“${normaliseLine(decision, 110)}”` : 'your question';
}

/**
 * "Swarm proposes these participants because…": a few sentences made from the participants' own fields
 * and nothing else. It counts the roles held, says how many rest on a quoted passage and how many on an
 * assumption, says what they are, and names the roles nobody holds. It is never a model's prose.
 */
export function explainSet(
  set: StakeholderSet,
  coverage: readonly RoleCoverage[],
  scenario: ScenarioFrame | null = null,
): string {
  const live = set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
  if (live.length === 0) return 'There are no participants yet.';
  const roles = PARTICIPANT_ROLES.flatMap((role) => {
    const held = coverage.find((item) => item.role === role)?.count ?? 0;
    const [one, many] = ROLE_COUNT_PHRASE[role];
    return held > 0 ? [count(held, one, many)] : [];
  });
  const list =
    roles.length > 1 ? `${roles.slice(0, -1).join(', ')} and ${roles.at(-1)}` : (roles[0] ?? '');
  const sourced = live.filter((stakeholder) => stakeholder.evidence.length > 0).length;
  const assumed = live.length - sourced;
  const sentences = [
    `Swarm proposes these ${live.length} participants because ${topicOf(scenario)} involves ${list}.`,
    sourced === 0
      ? 'None is tied to a quoted passage: every participant rests on an assumption and is labelled so.'
      : `${sourced} ${sourced === 1 ? 'is' : 'are'} tied to quoted passages${assumed > 0 ? `, and the other ${assumed} ${assumed === 1 ? 'rests' : 'rest'} on assumptions and ${assumed === 1 ? 'is' : 'are'} labelled so` : ''}.`,
    'They are synthetic roles, not real people.',
  ];
  const missing = coverage.filter((item) => item.status === 'missing');
  if (missing.length > 0) {
    const names = missing
      .slice(0, 4)
      .map((item) => PARTICIPANT_ROLE_LABELS[item.role].toLowerCase());
    const more = missing.length - names.length;
    sentences.push(
      `Roles nobody holds yet: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`,
    );
  }
  return sentences.join(' ');
}

const ASSUMED_ROLE_LINE =
  'Its objective, pressures and actions are assumptions for the simulation to explore, not findings.';

/**
 * Why a participant is on the list, from what it already holds: its role, its stated reason, the
 * passages it cites and what its place rests on. Nothing is asked of a model and nothing is added, so
 * the answer is the same every time and says nothing the participant itself does not.
 */
export function whyOf(stakeholder: Stakeholder): ParticipantWhy {
  const view = participantOf(stakeholder);
  const label = PARTICIPANT_ROLE_LABELS[view.role];
  const meaning = PARTICIPANT_ROLE_MEANINGS[view.role];
  const relevance = stakeholder.relevance.trim();
  const useful = relevance !== '' && !/Category default/u.test(relevance);
  const cited = stakeholder.evidence.length;
  const because = [
    `Role in the decision: ${label}. ${meaning}`,
    ...(useful ? [`Why it matters here: ${relevance}`] : []),
    ...(view.objective
      ? [`What the role is trying to achieve (an assumption): ${view.objective}`]
      : []),
    `How the change is assumed to land on it: ${DIRECTION_WORDS[stakeholder.expectedImpact.direction]}.${stakeholder.expectedImpact.rationale ? ` ${stakeholder.expectedImpact.rationale}` : ''}`,
    `${CONFIDENCE_BASIS_LABELS[view.confidenceBasis]}: ${CONFIDENCE_BASIS_MEANINGS[view.confidenceBasis]}`,
    cited > 0
      ? `${count(cited, 'passage is', 'passages are')} cited for it.`
      : 'No passage is cited for it, so it is held as an assumption.',
  ];
  return {
    id: stakeholder.id,
    name: stakeholder.name,
    roleLabel: label,
    headline: `${stakeholder.name} is on the list as ${label.toLowerCase()}.`,
    because,
    evidence: stakeholder.evidence.map((ref) => ({
      passageId: ref.passageId,
      documentName: ref.documentName,
      quote: ref.quote ?? '',
    })),
    basis: {
      kind: view.confidenceBasis,
      label: CONFIDENCE_BASIS_LABELS[view.confidenceBasis],
      explanation: CONFIDENCE_BASIS_MEANINGS[view.confidenceBasis],
    },
    assumptions: stakeholder.assumptions,
    uncertainty: stakeholder.uncertainty,
    limits: [
      'This is a synthetic role, not a person. Nothing here describes what any real person thinks, wants or does.',
      ASSUMED_ROLE_LINE,
      ...view.prohibitedClaims.slice(0, 3).map((claim) => `Never asserted: ${claim}`),
    ],
  };
}
