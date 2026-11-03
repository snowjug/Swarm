import type { ScenarioFrame } from '../../../../shared/scenario.js';
import {
  MAX_PROPOSED_KEY,
  MAX_PROPOSED_LIVE,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  ROLE_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
  participantOf,
  type IssueFix,
  type IssueSeverity,
  type ParticipantIssue,
  type ParticipantReview,
  type ParticipantRole,
  type RoleCoverage,
  type Stakeholder,
  type StakeholderSet,
} from '../../../../shared/stakeholders.js';
import type { EvidenceChunk, KnowledgeGraph } from '../../../../shared/types.js';
import { explainSet } from './explain.js';
import {
  compareNames,
  findPersonalDetail,
  findStereotype,
  findUnsupportedMotive,
  isBroadName,
  isGenericName,
  namesPerson,
  normaliseLine,
  wordingProblem,
  wordsIn,
} from './language.js';
import { ROLE_CUES, roleGapReason } from './taxonomy.js';

/**
 * What a person or a model has to get right before a set of participants may be used. Each rule has a
 * code, a severity and a sentence that says what to do about it. A set made by the participant
 * proposal (`proposal` is present) is held to every rule. A set found before it existed keeps its old
 * checks: the rules about quality (names, evidence, duplicates, wording) only advise, and the rules
 * about safety and integrity (a person's identity, hidden motives, stereotypes, broken relations,
 * too few participants, a claim of a source with no source) still block, so that nothing the older
 * path made is refused for being what it always was, and nothing unsafe passes for being old.
 */
export interface RuleSeverity {
  strict: IssueSeverity;
  legacy: IssueSeverity | null;
  summary: string;
}

export const RULE_CATALOGUE = {
  'too-few': {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'Fewer than two participants are left: a simulation needs more than one party.',
  },
  'duplicate-id': {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'Two participants share one id.',
  },
  'generic-name': {
    strict: 'blocking',
    legacy: 'advisory',
    summary: 'A name that is only a generic word, such as staff, users, public or team.',
  },
  'broad-name': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'A real role named too broadly to say which ones matter here.',
  },
  'real-person': {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'Text that points at an identified person instead of a public role.',
  },
  'personal-detail': {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'An email address, a phone number, a handle, an address or a credential.',
  },
  stereotype: {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'A sweeping claim about what a kind of person is like.',
  },
  'unsupported-motive': {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'A claim to know a hidden reason, or a mental state put on a named person.',
  },
  wording: {
    strict: 'blocking',
    legacy: 'advisory',
    summary: 'A forecast, a claim of certainty, a percentage or a figure about the real world.',
  },
  'evidence-unknown': {
    strict: 'blocking',
    legacy: 'advisory',
    summary: 'A citation of a passage that is not in the project.',
  },
  'basis-unsupported': {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'A participant said to be quoted from a source that cites no passage.',
  },
  'assumption-unmarked': {
    strict: 'blocking',
    legacy: 'advisory',
    summary: 'A participant with no passage that does not say it is an assumption.',
  },
  'duplicate-participant': {
    strict: 'blocking',
    legacy: 'advisory',
    summary: 'Two participants with the same name.',
  },
  'possible-duplicate': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'Two participants with the same role and overlapping names.',
  },
  'duplicate-incentives': {
    strict: 'blocking',
    legacy: 'advisory',
    summary: 'Two participants with the same incentives, which the simulation cannot tell apart.',
  },
  'relation-invalid': {
    strict: 'blocking',
    legacy: 'blocking',
    summary: 'A relation with a missing end, a loop on one participant, or a repeat.',
  },
  incomplete: {
    strict: 'blocking',
    legacy: null,
    summary: 'A participant with no objective or no plausible action.',
  },
  'role-mismatch': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'A role and a kind of party that do not go together.',
  },
  'missing-decision-owner': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'Nobody is named as the decision owner.',
  },
  'missing-role': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'A role that looks material here and that nobody holds.',
  },
  'over-represented': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'One role makes up most of the list.',
  },
  'many-key': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'More key actors than the simulation runs as individuals.',
  },
  'too-many': {
    strict: 'advisory',
    legacy: 'advisory',
    summary: 'More participants than are easy to review.',
  },
} as const satisfies Record<string, RuleSeverity>;
export type RuleCode = keyof typeof RULE_CATALOGUE;

export interface ReviewContext {
  /** The project's passages by id, to check that cited evidence is real; null when not known. */
  passages: ReadonlyMap<string, EvidenceChunk> | null;
  /** Names the sources hold as persons, so that a participant cannot be one of them. */
  personLabels: readonly string[];
  scenario: ScenarioFrame | null;
  question: string;
}

/** The context a review needs, from what a project holds. */
export function reviewContext(input: {
  passages: readonly EvidenceChunk[];
  graph: KnowledgeGraph | null;
  scenario: ScenarioFrame | null;
  question: string;
}): ReviewContext {
  return {
    passages: new Map(input.passages.map((passage) => [passage.id, passage])),
    personLabels: (input.graph?.nodes ?? [])
      .filter((node) => node.kind === 'person')
      .map((node) => node.label),
    scenario: input.scenario,
    question: input.question,
  };
}

/** The roles whose absence is worth saying, because a decision always involves them or the text speaks of them. */
const ADVISED_ROLES: ReadonlySet<ParticipantRole> = new Set<ParticipantRole>([
  'decision-owner',
  'directly-affected',
  'implementers',
  'approvers',
  'regulators-governance',
  'opponents-resistors',
  'partners-suppliers',
  'competitors-alternatives',
  'missing-voices',
]);
/** Roles that stand in for each other when asking whether one is missing: someone holding one of these already speaks for the role. */
const STANDS_IN: Readonly<Partial<Record<ParticipantRole, readonly ParticipantRole[]>>> = {
  approvers: ['regulators-governance'],
  'regulators-governance': ['approvers'],
  'directly-affected': ['customers-users', 'beneficiaries'],
  'customers-users': ['directly-affected'],
};
const MAX_MISSING_ADVISORIES = 5;

const textsOf = (context: ReviewContext): string => {
  const scenario = context.scenario;
  const parts = [
    context.question,
    scenario?.decision,
    scenario?.system,
    scenario?.baseline,
    ...(scenario?.likelyStakeholders ?? []),
    ...(scenario?.changes.map((change) => change.name) ?? []),
    ...(scenario?.alternatives.map((alternative) => alternative.label) ?? []),
    ...[...(context.passages?.values() ?? [])].map((passage) => passage.text),
  ];
  return parts.filter(Boolean).join('\n');
};

/** The first word of the text that makes a role look material, or null when none does. */
export function cueFor(role: ParticipantRole, text: string): string | null {
  const cue = ROLE_CUES[role];
  if (!cue) return null;
  const found = cue.exec(text)?.[0];
  return found ? found.toLowerCase().slice(0, 24) : null;
}

export function coverageOf(
  live: readonly Stakeholder[],
  context: ReviewContext,
): { coverage: RoleCoverage[]; missing: { role: ParticipantRole; cue: string | null }[] } {
  const text = textsOf(context);
  const held = new Map<ParticipantRole, number>();
  for (const stakeholder of live) {
    const role = participantOf(stakeholder).role;
    held.set(role, (held.get(role) ?? 0) + 1);
  }
  const missing: { role: ParticipantRole; cue: string | null }[] = [];
  const coverage = PARTICIPANT_ROLES.map((role): RoleCoverage => {
    const count = held.get(role) ?? 0;
    if (count > 0) return { role, count, status: 'covered', reason: null };
    const always = ROLE_CUES[role] === null;
    const cue = always ? null : cueFor(role, text);
    const material = always || cue !== null;
    const stood = (STANDS_IN[role] ?? []).some((other) => (held.get(other) ?? 0) > 0);
    if (!material || stood) return { role, count, status: 'optional', reason: null };
    if (ADVISED_ROLES.has(role)) missing.push({ role, cue });
    return { role, count, status: 'missing', reason: roleGapReason(role, cue) };
  });
  return { coverage, missing };
}

/** The prose a participant carries that Swarm or a model wrote, which the language rules read. */
function proseOf(stakeholder: Stakeholder): string[] {
  const view = participantOf(stakeholder);
  const lines = [
    stakeholder.description,
    stakeholder.relevance,
    view.objective,
    ...view.incentives,
    ...view.pressures,
    ...view.constraints,
    ...view.concerns,
    ...view.informationAccess,
    ...view.plausibleActions,
    ...stakeholder.assumptions,
  ];
  // What rules wrote about impact and uncertainty is fixed text of ours; a model's or a person's is read.
  if (stakeholder.origin === 'model' || stakeholder.origin === 'user') {
    lines.push(stakeholder.expectedImpact.rationale, stakeholder.uncertainty.reason);
  }
  return lines.filter(Boolean);
}

const quoted = (name: string): string => `“${normaliseLine(name, 60)}”`;

const incentiveKey = (stakeholder: Stakeholder): string =>
  [...(stakeholder.incentives ?? [])]
    .map((line) => wordsIn(line).join(' '))
    .filter(Boolean)
    .sort()
    .join('|');

/**
 * Checks a set of participants. It is made from the set and the project's passages and is never
 * stored, so it cannot be out of date: whoever reads a set gets the check of that set as it is.
 */
export function reviewParticipants(set: StakeholderSet, context: ReviewContext): ParticipantReview {
  const profile = set.proposal ? 'strict' : 'legacy';
  const live = set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
  const issues: ParticipantIssue[] = [];
  const named = new Map(set.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));

  const add = (
    code: RuleCode,
    input: {
      participantId?: string | null;
      relatedIds?: string[];
      role?: ParticipantRole | null;
      message: string;
      fix: string;
      fixAction: IssueFix | null;
      suffix?: string;
    },
  ): void => {
    const severity = RULE_CATALOGUE[code][profile];
    if (severity === null) return;
    const participantId = input.participantId ?? null;
    issues.push({
      id: [code, participantId ?? input.role ?? '-', input.suffix ?? ''].filter(Boolean).join(':'),
      code,
      severity,
      participantId,
      relatedIds: input.relatedIds ?? [],
      role: input.role ?? null,
      message: input.message,
      fix: input.fix,
      fixAction: input.fixAction,
    });
  };

  if (live.length < 2) {
    add('too-few', {
      message: `Only ${live.length} participant${live.length === 1 ? ' is' : 's are'} left, and a simulation needs more than one party.`,
      fix: 'Add a participant, or restore one you removed.',
      fixAction: 'add-missing',
    });
  }
  const seen = new Set<string>();
  for (const stakeholder of set.stakeholders) {
    if (seen.has(stakeholder.id)) {
      add('duplicate-id', {
        participantId: stakeholder.id,
        message: `Two participants share the id ${stakeholder.id}.`,
        fix: 'Remove one of them.',
        fixAction: 'remove',
      });
    }
    seen.add(stakeholder.id);
  }

  for (const stakeholder of live) {
    const view = participantOf(stakeholder);
    const name = quoted(stakeholder.name);
    const id = stakeholder.id;
    const prose = proseOf(stakeholder);
    const everything = [stakeholder.name, ...prose];

    if (isGenericName(stakeholder.name)) {
      add('generic-name', {
        participantId: id,
        message: `${name} is too generic to simulate: it does not say which people or roles are meant here.`,
        fix: 'Rename it to the specific role it stands for in this scenario, or remove it.',
        fixAction: 'rename',
      });
    } else if (stakeholder.priority !== 'background' && isBroadName(stakeholder.name)) {
      add('broad-name', {
        participantId: id,
        message: `${name} is a broad role.`,
        fix: 'Say which ones matter here, for example by the group they belong to or what they do.',
        fixAction: 'rename',
      });
    }

    const person = everything
      .map((text) => namesPerson(text, context.personLabels))
      .find((found) => found !== null);
    if (person) {
      add('real-person', {
        participantId: id,
        message: `${name} points at an identified person (“${normaliseLine(person, 40)}”).`,
        fix: 'Represent the public role instead of the person.',
        fixAction: 'edit',
      });
    }
    const detail = everything.map(findPersonalDetail).find((found) => found !== null);
    if (detail) {
      add('personal-detail', {
        participantId: id,
        message: `${name} contains ${detail}.`,
        fix: 'Take it out: a participant is a role and never carries contact details or credentials.',
        fixAction: 'edit',
      });
    }
    const stereotype = everything.map(findStereotype).find((found) => found !== null);
    if (stereotype) {
      add('stereotype', {
        participantId: id,
        message: `${name} generalises about people (“${normaliseLine(stereotype, 60)}”).`,
        fix: 'Say what the role is constrained by or concerned about, not what a kind of person is like.',
        fixAction: 'edit',
      });
    }
    const motive = prose
      .map((text) => findUnsupportedMotive(text, context.personLabels))
      .find((found) => found !== null);
    if (motive) {
      add('unsupported-motive', {
        participantId: id,
        message: `${name} claims to know what someone keeps private (“${normaliseLine(motive, 60)}”).`,
        fix: 'State it as an assumption about the role, or quote the passage that says it.',
        fixAction: 'edit',
      });
    }
    const wording = prose.map(wordingProblem).find((found) => found !== null);
    if (wording) {
      add('wording', {
        participantId: id,
        message: `${name} uses wording that reads as ${wording}.`,
        fix: 'Say what the role could do or may be concerned about, as a possibility.',
        fixAction: 'edit',
      });
    }

    const unknown = context.passages
      ? stakeholder.evidence.find((ref) => !context.passages?.has(ref.passageId))
      : undefined;
    if (unknown) {
      add('evidence-unknown', {
        participantId: id,
        message: `${name} cites a passage that is not in this project (${unknown.passageId}).`,
        fix: 'Regenerate it from the sources, or remove the citation.',
        fixAction: 'regenerate',
      });
    }
    const sourced = stakeholder.evidence.length > 0;
    if (view.confidenceBasis === 'source-quote' && !sourced) {
      add('basis-unsupported', {
        participantId: id,
        message: `${name} is said to be quoted from a source, but cites no passage.`,
        fix: 'Change its basis to an assumption, or regenerate it from the sources.',
        fixAction: 'regenerate',
      });
    }
    if (
      !sourced &&
      stakeholder.origin !== 'user' &&
      stakeholder.priority !== 'background' &&
      stakeholder.assumptions.length === 0
    ) {
      add('assumption-unmarked', {
        participantId: id,
        message: `${name} cites no passage and does not say it is an assumption.`,
        fix: 'Write the assumption it rests on, or regenerate it from the sources.',
        fixAction: 'edit',
      });
    }
    if (!view.objective.trim() || view.plausibleActions.length === 0) {
      add('incomplete', {
        participantId: id,
        message: `${name} has no ${view.objective.trim() ? 'plausible action' : 'objective'}.`,
        fix: 'Add one, or regenerate it.',
        fixAction: 'edit',
      });
    }
    if (!ROLE_CATEGORIES[view.role].includes(stakeholder.category)) {
      add('role-mismatch', {
        participantId: id,
        message: `${name} is held as ${PARTICIPANT_ROLE_LABELS[view.role].toLowerCase()}, but its kind of party is ${STAKEHOLDER_CATEGORY_LABELS[stakeholder.category].toLowerCase()}.`,
        fix: 'Change one so that they agree.',
        fixAction: 'edit',
      });
    }
  }

  for (let first = 0; first < live.length; first += 1) {
    for (let second = first + 1; second < live.length; second += 1) {
      const a = live[first]!;
      const b = live[second]!;
      const match = compareNames(a.name, b.name);
      const pair = `${quoted(a.name)} and ${quoted(b.name)}`;
      if (match === 'same') {
        add('duplicate-participant', {
          participantId: a.id,
          relatedIds: [b.id],
          message: `${pair} are the same participant.`,
          fix: 'Merge them.',
          fixAction: 'merge',
          suffix: b.id,
        });
      } else if (
        (match === 'contained' || match === 'overlap') &&
        participantOf(a).role === participantOf(b).role &&
        (a.priority !== 'background' || b.priority !== 'background')
      ) {
        add('possible-duplicate', {
          participantId: a.id,
          relatedIds: [b.id],
          message: `${pair} overlap.`,
          fix: 'Merge them if they are one participant, or keep both and make each more specific.',
          fixAction: 'merge',
          suffix: b.id,
        });
      }
      const key = incentiveKey(a);
      if (key !== '' && key === incentiveKey(b) && match !== 'same') {
        add('duplicate-incentives', {
          participantId: a.id,
          relatedIds: [b.id],
          message: `${pair} have the same incentives, so the simulation cannot tell them apart.`,
          fix: 'Say what differs for each, or merge them.',
          fixAction: 'edit',
          suffix: b.id,
        });
      }
    }
  }

  const relationSeen = new Set<string>();
  for (const relation of set.relations) {
    const mark = `${relation.from}|${relation.to}|${relation.type}`;
    const from = named.get(relation.from);
    const to = named.get(relation.to);
    const problem =
      !from || !to
        ? 'joins a participant that is not in the list'
        : relation.from === relation.to
          ? `joins ${quoted(from.name)} to itself`
          : relationSeen.has(mark)
            ? `repeats the ${relation.type.replaceAll('-', ' ')} between ${quoted(from.name)} and ${quoted(to.name)}`
            : null;
    relationSeen.add(mark);
    if (problem) {
      add('relation-invalid', {
        message: `A relation ${problem}.`,
        fix: 'Save the list again, or propose the participants again.',
        fixAction: null,
        suffix: mark,
      });
    }
  }

  const { coverage, missing } = coverageOf(live, context);
  if (profile === 'strict' || live.length > 0) {
    for (const { role, cue } of missing.slice(0, MAX_MISSING_ADVISORIES)) {
      // A legacy set is not asked for a standing voice it never had the means to name.
      if (profile === 'legacy' && role === 'missing-voices') continue;
      add(role === 'decision-owner' ? 'missing-decision-owner' : 'missing-role', {
        role,
        message:
          role === 'decision-owner'
            ? 'Nobody is named as the decision owner.'
            : `Nobody holds the role of ${PARTICIPANT_ROLE_LABELS[role].toLowerCase()}. ${roleGapReason(role, cue)}`,
        fix:
          role === 'decision-owner'
            ? 'Add who decides, even if it is you.'
            : 'Add a participant for it if it matters here.',
        fixAction: 'add-missing',
      });
    }
  }
  if (live.length >= 5) {
    const counts = new Map<ParticipantRole, number>();
    for (const stakeholder of live) {
      const role = participantOf(stakeholder).role;
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    const [role, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    if (role && count * 2 > live.length) {
      add('over-represented', {
        role,
        message: `${count} of ${live.length} participants hold the role of ${PARTICIPANT_ROLE_LABELS[role].toLowerCase()}, so the list may lean on one view.`,
        fix: 'Check that the other roles are not missing, and merge any that are one.',
        fixAction: null,
      });
    }
  }
  const keys = live.filter((stakeholder) => stakeholder.priority === 'key').length;
  if (keys > MAX_PROPOSED_KEY) {
    add('many-key', {
      message: `${keys} participants are key actors, and the simulation runs at most ${MAX_PROPOSED_KEY} as individuals.`,
      fix: 'Keep the ones that matter most as key actors; the others stay as groups.',
      fixAction: null,
    });
  }
  if (live.length > MAX_PROPOSED_LIVE) {
    add('too-many', {
      message: `${live.length} participants are listed, and more than ${MAX_PROPOSED_LIVE} are hard to review.`,
      fix: 'Merge or remove the ones that matter least.',
      fixAction: 'remove',
    });
  }

  issues.sort(
    (a, b) =>
      Number(b.severity === 'blocking') - Number(a.severity === 'blocking') ||
      Object.keys(RULE_CATALOGUE).indexOf(a.code) - Object.keys(RULE_CATALOGUE).indexOf(b.code) ||
      a.id.localeCompare(b.id),
  );
  const blocking = issues.filter((issue) => issue.severity === 'blocking').length;
  const sourced = live.filter((stakeholder) => stakeholder.evidence.length > 0).length;
  return {
    valid: blocking === 0,
    profile,
    summary: explainSet(set, coverage, context.scenario),
    counts: {
      participants: live.length,
      key: keys,
      sourced,
      assumed: live.length - sourced,
      proposed: live.filter((stakeholder) => stakeholder.status === 'proposed').length,
      removed: set.stakeholders.length - live.length,
      blocking,
      advisory: issues.length - blocking,
    },
    coverage,
    issues,
  };
}

/** The sentence an approval refused for blocking issues says, so that it can be acted on without opening anything. */
export function refusalWords(review: ParticipantReview): string {
  const blocking = review.issues.filter((issue) => issue.severity === 'blocking');
  const first = blocking[0];
  if (!first) return '';
  const more = blocking.length - 1;
  return `${blocking.length === 1 ? 'One issue' : `${blocking.length} issues`} must be fixed before these participants can be used. ${first.message} ${first.fix}${more > 0 ? ` ${more} more ${more === 1 ? 'is' : 'are'} listed in the review.` : ''}`;
}
