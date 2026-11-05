import { createHash } from 'node:crypto';
import {
  CONSTRAINT_CATEGORIES,
  OPEN_WINDOW,
  isHighStakes,
  type Constraint,
  type ConstraintCategory,
  type ConstraintEffect,
  type ConstraintHardness,
  type ConstraintScope,
  type ConstraintSeverity,
  type ConstraintSet,
} from '../../../shared/constraints.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { normalizeText } from '../grounding/text.js';
import { verifiedEvidence, uniqueEvidence } from '../stakeholders/evidence.js';
import { truncate, uniqueId } from '../stakeholders/names.js';
import { limitSupport, readHardness, type Cancellation } from './deontic.js';
import { IMPACT_IF_VIOLATED } from './lexicon.js';
import type { Proposal } from './types.js';

/** The most constraints a set holds, those set aside included: the shared contract's bound. */
export const MAX_SET = 60;

/** What the references a proposal makes have to be checked against. */
export interface BuildContext {
  passages: ReadonlyMap<string, EvidenceChunk>;
  actorIds: ReadonlySet<string>;
  alternativeIds: ReadonlySet<string>;
  assumptionIds: ReadonlySet<string>;
  /** Documents that are illustrative or recorded examples. */
  exampleDocuments?: ReadonlySet<string>;
}

export interface BuildStats {
  proposed: number;
  kept: number;
  quotesKept: number;
  quotesShortened: number;
  quotesDropped: number;
  /** Proposed with a quote that could not be found, and kept as inferred. */
  downgraded: number;
  /** Proposed from a source and dropped: its passage is not one of this project's. */
  dropped: number;
  effectsDropped: number;
}

/** Two proposals of one category with the same words are one constraint. */
export const fingerprintOf = (category: string, statement: string): string =>
  `${category}|${normalizeText(statement)}`;

export const idOfFingerprint = (fingerprint: string): string =>
  `c-${createHash('sha256').update(fingerprint).digest('hex').slice(0, 8)}`;

const SCOPE_OF_CATEGORY: ReadonlySet<ConstraintCategory> = new Set([
  'regulatory',
  'legal',
  'market',
  'environmental',
  'geographic',
  'cultural',
]);

export function scopeOf(
  category: ConstraintCategory,
  actors: readonly string[],
  alternatives: readonly string[],
): ConstraintScope {
  if (alternatives.length > 0) return 'alternatives';
  if (actors.length > 0) return 'actors';
  return SCOPE_OF_CATEGORY.has(category) ? 'environment' : 'decision';
}

/** How much a limit of this kind and hardness would matter if it were broken. A rule, not a measurement. */
export function severityOf(
  category: ConstraintCategory,
  hardness: ConstraintHardness,
): ConstraintSeverity {
  if (hardness === 'hard') return isHighStakes(category) ? 'critical' : 'high';
  return 'medium';
}

function validEffect(effect: ConstraintEffect, context: BuildContext): boolean {
  switch (effect.kind) {
    case 'require-approval':
      return context.actorIds.has(effect.approverActorId);
    case 'force-sequencing':
      return effect.beforeActorIds.every((id) => context.actorIds.has(id));
    default:
      return true;
  }
}

const WHY_NOT_A_LIMIT: Record<Cancellation, string> = {
  'asked-for': 'as something someone asks for, which is not a rule',
  hedged: 'as something that may or may not hold',
  negated: 'to say it is not required',
  interpretive: 'as a caution on how to read, not a limit',
};

/**
 * Whether a limit is held hard, and why: a proposal a person can overrule, with the basis in words they
 * can check against the source. A limit is hard where the words of a source, or of the person, state it
 * as a requirement, a ban, a ceiling or a condition that holds: "hard because the source says ‘must’".
 * A wish, a possibility, a denial and a caution are not read as limits that hold, whatever word they
 * carry. A model's own reading can raise a source's limit to hard only when the quote has some word of
 * a limit to bear it out and nothing in it asks, hedges or denies, so that a model that calls everything
 * hard cannot make a fact, a wish or a guess into a limit that blocks a run; it never lowers a limit the
 * words state, and a guess is never hard.
 */
export function hardnessOf(input: {
  source: Constraint['source'];
  proposal: Pick<Proposal, 'hardness' | 'origin' | 'statement'>;
  quotes: readonly string[];
}): { hardness: ConstraintHardness; basis: string } {
  const { source, proposal, quotes } = input;
  if (source === 'inferred') {
    return { hardness: 'soft', basis: 'Held soft: no source or person says it is firm.' };
  }
  const user = source === 'user';
  const whose = user ? 'your words say' : 'the source says';
  const texts = user ? [proposal.statement] : quotes;
  let cancelled: ReturnType<typeof readHardness>['cancelled'] = null;
  for (const text of texts) {
    const reading = readHardness(text);
    if (reading.hard && reading.cue) {
      return { hardness: 'hard', basis: `Hard because ${whose} “${reading.cue.shown}”.` };
    }
    cancelled ??= reading.cancelled;
  }
  if (user && proposal.hardness === 'hard') {
    return { hardness: 'hard', basis: 'Hard as read from your words.' };
  }
  if (cancelled) {
    return {
      hardness: 'soft',
      basis: `Soft: ${user ? 'your words say' : 'the source says'} “${cancelled.cue.shown}”, but ${WHY_NOT_A_LIMIT[cancelled.why]}.`,
    };
  }
  if (!user && proposal.origin.kind === 'model' && proposal.hardness === 'hard') {
    const support = quotes.map((quote) => limitSupport(quote)).find((found) => found !== null);
    if (support) {
      return {
        hardness: 'hard',
        basis: `A model read it as a firm limit, and the source’s words (“${support}”) bear that out. They are not a word of obligation, so check it.`,
      };
    }
    return {
      hardness: 'soft',
      basis: 'Soft: a model called it hard, but nothing in the quoted words states a limit.',
    };
  }
  return {
    hardness: 'soft',
    basis: `Soft: ${user ? 'your words have' : 'the source has'} no word that makes it an obligation, a ban or a ceiling.`,
  };
}

const sourceNote = (proposal: Proposal, refs: readonly EvidenceRef[]): string => {
  const { origin } = proposal;
  switch (origin.kind) {
    case 'question':
      return 'You wrote it in your question.';
    case 'scenario':
      return `You wrote it in the scenario (${origin.field}).`;
    case 'assumption':
      return origin.fromUser
        ? 'You wrote it as an assumption of the scenario.'
        : 'A system assumption of the scenario, which nobody has confirmed.';
    case 'passage':
      return refs[0] ? `Found in ${refs[0].documentName.slice(0, 160)}.` : '';
    case 'actor':
      return 'Listed as a limit of a simulated actor.';
    case 'category':
      return origin.reason.slice(0, 240);
    case 'model':
      return refs[0]
        ? `Proposed by a model; its quote was found in ${refs[0].documentName.slice(0, 160)}.`
        : 'Proposed by a model.';
  }
};

/**
 * Makes constraints of proposals, by rules that do not ask who proposed them. What a constraint is
 * labelled follows from what could be checked: a quote that is found in a passage makes it `extracted`,
 * the person's own words make it `user`, and everything else is `inferred`. Whether it is hard follows
 * from the words of what was quoted or written, with a model's reading allowed to raise it only where
 * those words bear it out (`hardnessOf`); an inferred one is never hard. Nothing is validated, and
 * nothing is reviewed.
 */
export function buildConstraints(
  proposals: readonly Proposal[],
  context: BuildContext,
  used: Set<string>,
): { constraints: Constraint[]; stats: BuildStats } {
  const stats: BuildStats = {
    proposed: proposals.length,
    kept: 0,
    quotesKept: 0,
    quotesShortened: 0,
    quotesDropped: 0,
    downgraded: 0,
    dropped: 0,
    effectsDropped: 0,
  };
  const constraints: Constraint[] = [];
  for (const proposal of proposals) {
    if (!CONSTRAINT_CATEGORIES.includes(proposal.category)) continue;
    const statement = truncate(proposal.statement, 400);
    if (statement.length < 3) continue;

    const refs: EvidenceRef[] = [];
    for (const item of proposal.quotes) {
      const verified = verifiedEvidence(context.passages, item.passageId, item.quote);
      if (!verified) {
        stats.quotesDropped += 1;
        continue;
      }
      stats.quotesKept += 1;
      if (verified.shortened) stats.quotesShortened += 1;
      refs.push(verified.ref);
    }
    const evidence = uniqueEvidence(refs, 5);
    const fromSource = proposal.origin.kind === 'passage' || proposal.origin.kind === 'model';
    if (proposal.origin.kind === 'passage' && evidence.length === 0) {
      stats.dropped += 1;
      continue;
    }
    if (proposal.origin.kind === 'model' && evidence.length === 0) stats.downgraded += 1;

    const person =
      proposal.origin.kind === 'question' ||
      proposal.origin.kind === 'scenario' ||
      (proposal.origin.kind === 'assumption' && proposal.origin.fromUser);
    const source: Constraint['source'] = person
      ? 'user'
      : fromSource && evidence.length > 0
        ? 'extracted'
        : 'inferred';
    // A source's words make a limit hard only if they state it as one, and a guess is never hard.
    const decided = hardnessOf({
      source,
      proposal,
      quotes: evidence.flatMap((ref) => (ref.quote === null ? [] : [ref.quote])),
    });
    const hardness = decided.hardness;

    const kind: Constraint['confidenceBasis']['kind'] =
      proposal.origin.kind === 'question'
        ? 'question-quote'
        : proposal.origin.kind === 'scenario' || proposal.origin.kind === 'assumption'
          ? 'scenario-quote'
          : proposal.origin.kind === 'model'
            ? evidence.length > 0
              ? 'model-quote'
              : 'model-reading'
            : source === 'extracted'
              ? 'evidence-quote'
              : proposal.origin.kind === 'actor'
                ? 'actor-statement'
                : proposal.origin.kind === 'category'
                  ? 'category-prompt'
                  : 'model-reading';
    const examples = evidence.filter((ref) => context.exampleDocuments?.has(ref.documentId));
    const basisNote = [
      sourceNote(proposal, evidence),
      examples.length > 0 ? 'That document is an illustrative example, not a real source.' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const effects = proposal.effects.filter((effect) => {
      const fine = validEffect(effect, context);
      if (!fine) stats.effectsDropped += 1;
      return fine;
    });
    const actors = proposal.affectedActorIds.filter((id) => context.actorIds.has(id));
    const alternatives = proposal.affectedAlternativeIds.filter((id) =>
      context.alternativeIds.has(id),
    );
    const assumed =
      proposal.origin.kind === 'assumption' &&
      proposal.assumptionId !== null &&
      context.assumptionIds.has(proposal.assumptionId);
    const distinctPassages = new Set(evidence.map((ref) => ref.passageId)).size;
    const reason =
      source === 'user'
        ? 'Read from your own words by rules; nobody has checked that it is a limit.'
        : source === 'extracted'
          ? 'A source says so; nobody has validated it against anything else.'
          : proposal.origin.kind === 'actor'
            ? 'Listed as a limit of a simulated actor, which Swarm wrote, not a source.'
            : proposal.origin.kind === 'model'
              ? 'A model proposed it and no quote of it could be found in the sources.'
              : proposal.origin.kind === 'assumption'
                ? 'A system assumption of the scenario that nobody has confirmed.'
                : 'Suggested by who is involved; no source or person says it holds.';
    const level: Constraint['uncertainty']['level'] =
      source === 'inferred'
        ? 'high'
        : source === 'extracted' && distinctPassages > 1
          ? 'low'
          : 'medium';

    const fingerprint = fingerprintOf(proposal.category, statement);
    const id = uniqueId(idOfFingerprint(fingerprint), used);
    constraints.push({
      id,
      category: proposal.category,
      statement,
      source,
      evidenceRefs: evidence,
      hardness,
      hardnessBasis: truncate(decided.basis, 240),
      scope: scopeOf(proposal.category, actors, alternatives),
      affectedActorIds: actors,
      affectedAlternativeIds: alternatives,
      window: { ...OPEN_WINDOW, text: truncate(proposal.windowText, 120) },
      severity: severityOf(proposal.category, hardness),
      confidenceBasis: { kind, note: truncate(basisNote, 240) },
      uncertainty: {
        level,
        reason: truncate(proposal.note ? `${reason} ${proposal.note}` : reason, 300),
      },
      validation: assumed ? 'assumed' : 'unvalidated',
      conflict: [],
      impactIfViolated: IMPACT_IF_VIOLATED[hardness],
      assumptionId: assumed ? proposal.assumptionId : null,
      mitigations: [],
      enforcement: 'interpretive',
      effects,
      consideredIn: [],
      review: 'proposed',
      note: '',
    });
  }
  stats.kept = constraints.length;
  return { constraints, stats };
}

/**
 * What a new proposal adds to the constraints already held. A proposal that is one of them already
 * (same category, same words, or the words it had before a person changed them: its id is made from
 * them) is not added again, whatever has become of it: one the person set aside stays set aside, and
 * one they changed stays as they made it. Nothing the person decided is undone.
 */
export function mergeProposed(
  existing: readonly Constraint[],
  built: readonly Constraint[],
): { constraints: Constraint[]; added: number; room: number } {
  const known = new Set(
    existing.map((constraint) => fingerprintOf(constraint.category, constraint.statement)),
  );
  const held = new Set(existing.map((constraint) => constraint.id));
  const constraints = [...existing];
  let added = 0;
  for (const constraint of built) {
    const mark = fingerprintOf(constraint.category, constraint.statement);
    if (known.has(mark) || held.has(idOfFingerprint(mark))) continue;
    if (constraints.length >= MAX_SET) break;
    known.add(mark);
    constraints.push(constraint);
    added += 1;
  }
  return { constraints, added, room: MAX_SET - constraints.length };
}

export function emptySet(
  now: Date,
  mode: ConstraintSet['mode'],
  revisions: { scenario: number; actors: number },
): ConstraintSet {
  return {
    version: 1,
    constraints: [],
    coverage: null,
    clarifications: [],
    generatedAt: now.toISOString(),
    mode,
    model: null,
    note: '',
    scenarioRevision: revisions.scenario,
    actorsRevision: revisions.actors,
    reviewedAt: null,
  };
}
