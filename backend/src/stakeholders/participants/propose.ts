import {
  proposedParticipantsSchema,
  PROPOSED_PARTICIPANTS_VERSION,
  ROLE_CATEGORIES,
  participantOf,
  type ParticipantReview,
  type ProposedParticipant,
  type ProposedParticipants,
  type Stakeholder,
  type StakeholderSet,
} from '../../../../shared/stakeholders.js';
import { AppError } from '../../errors.js';
import type { ModelGateway } from '../../models/client.js';
import { runStructuredTask, type TaskFailure, type TaskSource } from '../../models/task.js';
import { productSignals, type ProposalOrigin } from '../../telemetry/product-signals.js';
import { occurrencesOf } from '../mentions.js';
import { impactFor, uncertaintyFor } from '../rules.js';
import { CATEGORY_PURPOSE } from '../priors.js';
import { buildParticipant, buildSet, newStats } from './build.js';
import { proposalChecker } from './checks.js';
import { modelData, type ProposalContext } from './context.js';
import { newSide, reasonFromSources, rulesProposal } from './fallback.js';
import { PROPOSAL_INSTRUCTIONS, REGENERATE_INSTRUCTIONS } from './instructions.js';
import { compareNames, normaliseLine } from './language.js';
import { ROLE_DEFAULTS } from './taxonomy.js';

/** A proposal asks once and may be corrected once, so it is never more than two calls. */
export const MAX_PROPOSAL_CALLS = 2;
const MAX_OUTPUT_TOKENS = 7_000;
const MAX_REGENERATE_TOKENS = 2_500;

export interface ProposeInput {
  context: ProposalContext;
  /** A model to ask, or null: the rules path never calls one. */
  model: ModelGateway | null;
  modelName: string | null;
  signal: AbortSignal;
  /** The set this replaces, so that a participant found again keeps its id. */
  existing?: StakeholderSet | null;
  now?: () => Date;
}

export interface ProposeResult {
  set: StakeholderSet;
  source: 'model' | 'rules';
  /** Why rules answered when a model was asked; null otherwise. It holds none of the model's words. */
  failure: TaskFailure | null;
}

const sourceOf = (task: TaskSource): 'model' | 'rules' => (task === 'model' ? 'model' : 'rules');

/**
 * Tells the product's metrics how a proposal went, once it has been kept: where it came from (the model;
 * rules, as asked; or the fallback, rules after the model failed), how many participants it made, how
 * many of them passed the review that followed, and which rules it broke. It is given the review the
 * caller has just worked out for the person, so nothing is checked twice. Counts and rule codes only:
 * no name, quote or id of a participant, and no word of the model's.
 */
export function recordProposal(
  result: Pick<ProposeResult, 'set' | 'source' | 'failure'>,
  review: ParticipantReview,
): void {
  const origin: ProposalOrigin =
    result.source === 'model' ? 'model' : result.failure ? 'fallback' : 'rules';
  const issues: Record<string, number> = {};
  const blocked = new Set<string>();
  for (const issue of review.issues) {
    issues[issue.code] = (issues[issue.code] ?? 0) + 1;
    if (issue.severity === 'blocking' && issue.participantId) blocked.add(issue.participantId);
  }
  const proposed = result.set.stakeholders.filter(
    (stakeholder) => stakeholder.status !== 'removed',
  ).length;
  productSignals.actorProposal({ origin, proposed, valid: proposed - blocked.size, issues });
}

/**
 * Proposes the participants of a decision. With a model it asks for `ProposedParticipants` v1 under the
 * product's output policy (strict schema, the server's own checks, one correction, then rules, with a
 * sanitised reason and none of the model's words); without one it runs the rules path and calls no
 * model. Either way the proposal then goes through the same deterministic steps, and the result says
 * how it was made. A refusal and a cancelled request are never answered from rules.
 */
export async function proposeParticipants(input: ProposeInput): Promise<ProposeResult> {
  const { context } = input;
  const side = newSide();
  const data = modelData(context);
  const outcome = await runStructuredTask(input.model, {
    role: 'actor',
    name: 'participant-proposal.v1',
    schema: proposedParticipantsSchema,
    instructions: PROPOSAL_INSTRUCTIONS,
    data,
    signal: input.signal,
    maxTokens: MAX_OUTPUT_TOKENS,
    validate: proposalChecker(context, data),
    fallback: () => rulesProposal(context, side),
  });
  const source = sourceOf(outcome.source);
  return {
    set: buildSet({
      proposal: outcome.value,
      context,
      source,
      modelName: input.modelName,
      failure: outcome.failure,
      side,
      existing: input.existing ?? null,
      now: (input.now ?? (() => new Date()))(),
    }),
    source,
    failure: outcome.failure,
  };
}

// ---------------------------------------------------------------------------------------------
// Regenerating one participant
// ---------------------------------------------------------------------------------------------

/**
 * The target as the sources and its role support, and nothing a person added: the quotes that name it,
 * the defaults of its role, the uncertainty its evidence earns. It is what regenerating means without a
 * model, and what stands in when a model's replacement cannot be used.
 */
function resetFromSources(target: Stakeholder, context: ProposalContext): ProposedParticipants {
  const view = participantOf(target);
  const defaults = ROLE_DEFAULTS[view.role];
  const { found, sentences } = occurrencesOf(context.passages, target.name, 6);
  const category = ROLE_CATEGORIES[view.role].includes(target.category)
    ? target.category
    : (ROLE_CATEGORIES[view.role][0] ?? 'other');
  const passageCount = new Set(found.map((item) => item.passageId)).size;
  const reason = uncertaintyFor(sentences, passageCount, false).reason.replace(
    /\bwill react\b/gu,
    'might react',
  );
  const impact = impactFor(category);
  const participant: ProposedParticipant = {
    id: target.id,
    name: target.name,
    role: view.role,
    category,
    whyTheyMatter: reasonFromSources(view.role, found[0]?.quote, target.origin),
    description: target.description,
    objective: CATEGORY_PURPOSE[category],
    incentives: [],
    pressures: [],
    constraints: [],
    concerns: [],
    influence: defaults.influence,
    decisionAuthority: defaults.decisionAuthority,
    directness: target.directness,
    impact: { direction: impact.direction, rationale: impact.rationale },
    informationAccess: defaults.informationAccess,
    plausibleActions: defaults.plausibleActions,
    prohibitedClaims: defaults.prohibitedClaims,
    evidence: found.map((item) => ({ passageId: item.passageId, quote: item.quote })),
    assumptions: [
      'Reset from the sources and the defaults of its role; what was changed by hand is gone.',
      ...(found.length === 0 ? ['Assumption: no passage names this participant.'] : []),
    ],
    uncertainty: {
      level:
        found.length === 0
          ? 'high'
          : sentences >= 4 && passageCount >= 2
            ? 'low'
            : sentences >= 2
              ? 'medium'
              : 'high',
      reason: found.length === 0 ? 'No passage names this participant.' : reason,
    },
    confidenceBasis: found.length > 0 ? 'source-quote' : 'category-pattern',
    priority: target.priority,
    populationSize: target.populationSize,
    synthetic: true,
  };
  return {
    version: PROPOSED_PARTICIPANTS_VERSION,
    participants: [participant],
    relations: [],
    gaps: [],
  };
}

export interface RegenerateInput {
  context: ProposalContext;
  set: StakeholderSet;
  targetId: string;
  model: ModelGateway | null;
  modelName: string | null;
  signal: AbortSignal;
}

export interface RegenerateResult {
  participant: Stakeholder;
  source: 'model' | 'rules';
  failure: TaskFailure | null;
}

/**
 * Proposes one participant again, given the rest, under the same checks as a whole proposal: the model
 * (if one was chosen) is shown the others and asked for one replacement that must keep the target's id
 * and role and must not repeat any other; rules reset it from the sources. The rest of the list, and
 * every relation, stay as they are. The result is the new participant, still only proposed.
 */
export async function regenerateParticipant(input: RegenerateInput): Promise<RegenerateResult> {
  const target = input.set.stakeholders.find((item) => item.id === input.targetId);
  if (!target || target.status === 'removed') {
    throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'There is no such participant in the list.');
  }
  const { context } = input;
  const others = input.set.stakeholders.filter(
    (item) => item.id !== target.id && item.status !== 'removed',
  );
  const view = participantOf(target);
  const data = modelData(context, {
    target: {
      id: target.id,
      name: normaliseLine(target.name, 120),
      role: view.role,
      category: target.category,
      whyTheyMatter: normaliseLine(target.relevance, 300),
      objective: normaliseLine(view.objective, 200),
    },
    others: others.map((item) => ({
      id: item.id,
      name: normaliseLine(item.name, 120),
      role: participantOf(item).role,
      objective: normaliseLine(participantOf(item).objective, 160),
    })),
  });
  const check = proposalChecker(context, data, {
    minimum: 1,
    ownNames: new Set([target.name]),
  });
  const outcome = await runStructuredTask(input.model, {
    role: 'actor',
    name: 'participant-regeneration.v1',
    schema: proposedParticipantsSchema,
    instructions: REGENERATE_INSTRUCTIONS,
    data,
    signal: input.signal,
    maxTokens: MAX_REGENERATE_TOKENS,
    validate: (value) => {
      const problems: string[] = [];
      const [replacement] = value.participants;
      if (value.participants.length !== 1 || !replacement) {
        problems.push('Propose exactly one participant: the replacement for data.target.');
      } else {
        if (replacement.id !== target.id)
          problems.push(`The replacement keeps the id ${target.id}.`);
        if (replacement.role !== view.role)
          problems.push(`The replacement keeps the role ${view.role}.`);
        for (const other of others) {
          const match = compareNames(replacement.name, other.name);
          if (match === 'same' || match === 'contained') {
            problems.push(
              `The replacement repeats the participant ${other.id}; name a different one.`,
            );
            break;
          }
        }
      }
      if (problems.length > 0) throw new AppError(502, 'MODEL_OUTPUT_INVALID', problems.join(' '));
      check(value);
    },
    fallback: () => resetFromSources(target, context),
  });
  const source = sourceOf(outcome.source);
  const byPassage = new Map(context.passages.map((passage) => [passage.id, passage]));
  const [proposed] = outcome.value.participants;
  const built = proposed
    ? buildParticipant(proposed, { source, side: newSide() }, byPassage, newStats(), target.id)
    : null;
  if (!built) {
    throw new AppError(
      500,
      'PARTICIPANT_NOT_BUILT',
      'The regenerated participant did not fit the participant contract.',
    );
  }
  return {
    participant: { ...built, mergedFrom: target.mergedFrom },
    source,
    failure: outcome.failure,
  };
}
