import {
  DECISION_STATUS_INFO,
  LENS_INFO,
  PRIMARY_LENS,
  LENS_STANDING_WORDS,
  type DecisionStatus,
  type DecisionStatusReading,
  type LensReading,
  type StatusRuleId,
} from '../../../shared/decision.js';
import { Guard, clip, embed, listed, plural } from './words.js';

/**
 * The decision status: which of six things the canvas can honestly say about the choice. It is rules
 * over what the project holds, tried in a fixed order (`STATUS_RULES` in shared/decision.ts), and the
 * first that applies wins. Nothing here weighs the options by a measure of its own: it reads the
 * lenses, the constraints, the evidence and the checks, and says what they allow.
 */

export interface StatusOption {
  id: string;
  label: string;
  kind: 'baseline' | 'alternative';
}

/** A thing that could reverse which option leads, in the words a person reads. */
export interface Flip {
  kind: 'counterfactual' | 'assumption';
  id: string;
  /** The sentence that finishes “It could stop leading if”. */
  text: string;
}

export interface StatusInput {
  options: readonly StatusOption[];
  /** The comparison has options with recorded runs. */
  hasRuns: boolean;
  gate: {
    status: 'clear' | 'provisional' | 'blocked' | 'none';
    blockedBy: readonly string[];
    label: string | null;
    /** Each conflict between hard constraints that cannot hold together, in the gate’s words. */
    hardConflicts: readonly string[];
  };
  /** Alternatives that a confirmed hard constraint rules out, with the statements that do. */
  confirmedViolations: ReadonlyMap<string, readonly string[]>;
  /** Alternatives that a hard constraint nobody has confirmed rules out, with the statements that do. */
  unconfirmedViolations: ReadonlyMap<string, readonly string[]>;
  /** What the comparison recorded of its own constraints, and whether it ran under the ones the project holds now. */
  comparison: { constraints: 'none' | 'clear' | 'provisional' };
  signal: 'clear' | 'no-direction' | 'no-difference';
  /** The option the proposed change is, and the one that is no change. */
  headlineId: string | null;
  baselineId: string | null;
  evidence: { level: 'adequate' | 'limited' | 'insufficient'; reasons: readonly string[] };
  lenses: readonly LensReading[];
  /** What could reverse the leader, worked out for a given leader. */
  flipsFor: (leaderId: string) => readonly Flip[];
  examined: { counterfactuals: boolean; sensitivity: boolean };
  /** The sentence that says the comparison was run before something it is made from changed, or null when it is current. */
  stale: string | null;
  critics: { reviewed: boolean; current: boolean; blockingOpen: number };
}

export interface StatusResult {
  reading: DecisionStatusReading;
  /** The option clearly ahead on the headline lens, when there is one. */
  leaderId: string | null;
  /** The option named as the answer: the leader, when the status recommends an option. */
  preferredId: string | null;
}

const label = (options: readonly StatusOption[], id: string): string =>
  embed(options.find((option) => option.id === id)?.label ?? id, 60);

const names = (options: readonly StatusOption[], ids: readonly string[]): string =>
  listed(ids.map((id) => label(options, id)));

function reading(
  guard: Guard,
  rule: StatusRuleId,
  status: DecisionStatus,
  headline: string,
  why: readonly string[],
  conditions: readonly string[] = [],
): DecisionStatusReading {
  const info = DECISION_STATUS_INFO[status];
  return {
    status,
    rule,
    label: info.label,
    meaning: info.meaning,
    headline: guard.say(headline, 600),
    why: why.slice(0, 8).map((line) => guard.say(line, 400)),
    conditions: conditions.slice(0, 10).map((line) => guard.say(line, 400)),
  };
}

/** The conditions under which a leading option leads, in the order they matter. Empty when it holds under none. */
export function conditionsOf(input: StatusInput, leaderId: string): string[] {
  const conditions: string[] = [];
  const flips = input.flipsFor(leaderId);
  for (const flip of flips.slice(0, 3)) conditions.push(`It could stop leading if ${flip.text}`);
  const violated = input.unconfirmedViolations.get(leaderId);
  if (violated && violated.length > 0) {
    conditions.push(
      `It is ruled out if ${listed(violated.slice(0, 2).map((statement) => embed(statement, 80)))} holds, and that has not been confirmed.`,
    );
  }
  if (input.gate.status === 'none') {
    conditions.push(
      'No constraints were reviewed for this decision, so the answer does not say what limits it.',
    );
  } else if (input.gate.status === 'provisional') {
    conditions.push(input.gate.label ?? 'The constraints are provisional: some are not confirmed.');
  } else if (input.comparison.constraints !== 'clear') {
    conditions.push(
      input.comparison.constraints === 'none'
        ? 'The comparison was run without reviewed constraints.'
        : 'The comparison was run under constraints that were not all confirmed.',
    );
  }
  if (input.evidence.level === 'limited') {
    conditions.push(`The evidence is limited. ${input.evidence.reasons[0] ?? ''}`.trim());
  }
  if (input.stale) conditions.push(input.stale);
  const computed = input.lenses.filter((lens) => lens.computable);
  const missing = input.lenses.filter((lens) => !lens.computable);
  const notClear = computed.filter((lens) => lens.leaderId !== leaderId);
  if (notClear.length > 0) {
    conditions.push(
      `On ${listed(notClear.map((lens) => embed(lens.name, 70)))} it cannot be told apart from another option.`,
    );
  }
  if (missing.length > 0) {
    conditions.push(
      `${listed(missing.map((lens) => embed(lens.name, 70)))} could not be computed.`,
    );
  }
  if (computed.length < 2) {
    conditions.push(
      'Fewer than two lenses could be computed, so its lead across lenses is not shown.',
    );
  }
  if (!input.critics.reviewed) {
    conditions.push('The independent review has not been run for this comparison.');
  } else if (!input.critics.current) {
    conditions.push('The independent review was written for a different comparison.');
  } else if (input.critics.blockingOpen > 0) {
    conditions.push(
      `${input.critics.blockingOpen} blocking ${plural(input.critics.blockingOpen, 'objection')} from the independent review ${plural(input.critics.blockingOpen, 'is', 'are')} still open.`,
    );
  }
  if (!input.examined.counterfactuals) {
    conditions.push(
      'No counterfactual view was run against it, so no change to the situation was tried to see whether the result holds.',
    );
  }
  if (!input.examined.sensitivity) {
    conditions.push('Sensitivity to assumptions was not run.');
  }
  return conditions;
}

export function deriveStatus(input: StatusInput, guard: Guard): StatusResult {
  const { options, lenses } = input;
  const fixed = (
    rule: StatusRuleId,
    status: DecisionStatus,
    headline: string,
    why: string[],
  ): StatusResult => ({
    reading: reading(guard, rule, status, headline, why),
    leaderId: null,
    preferredId: null,
  });

  if (!input.hasRuns || options.length < 2) {
    return fixed(
      'no-analysis',
      'insufficient-evidence',
      'There is no finished comparison of options yet, so Swarm has nothing to recommend from.',
      [
        input.hasRuns
          ? 'The comparison holds only one option, so nothing was compared.'
          : 'No finished comparison with recorded runs exists.',
      ],
    );
  }

  if (input.gate.status === 'blocked') {
    return fixed(
      'gate-blocked',
      'blocked-by-hard-constraint',
      'A hard constraint stands in the way, so Swarm does not recommend going past it.',
      input.gate.blockedBy.length > 0
        ? [...input.gate.blockedBy]
        : ['The constraint gate is blocked by a hard constraint that has not been settled.'],
    );
  }

  const alternatives = options.filter((option) => option.kind === 'alternative');
  if (
    alternatives.length > 0 &&
    alternatives.every((option) => input.confirmedViolations.has(option.id))
  ) {
    return fixed(
      'all-violate',
      'blocked-by-hard-constraint',
      'Every alternative is ruled out by a confirmed hard constraint, so Swarm does not recommend one.',
      alternatives.map(
        (option) =>
          `${label(options, option.id)} is ruled out by ${listed((input.confirmedViolations.get(option.id) ?? []).slice(0, 2).map((statement) => embed(statement, 80)))}.`,
      ),
    );
  }

  if (input.signal === 'no-direction') {
    return fixed(
      'no-direction',
      'insufficient-evidence',
      'The simulation could not tell the change from no change, so Swarm has no result about the change to recommend from.',
      [
        'No stakeholder has an expected direction of impact, so the change cannot move anyone in the simulation and every difference from no change is noise.',
      ],
    );
  }

  if (input.evidence.level === 'insufficient') {
    return fixed(
      'evidence-insufficient',
      'insufficient-evidence',
      `There is not enough evidence behind the comparison to recommend an option. ${input.evidence.reasons[0] ?? ''}`.trim(),
      [...input.evidence.reasons],
    );
  }

  if (input.gate.hardConflicts.length > 0) {
    return fixed(
      'hard-conflict',
      'needs-human-decision',
      'Hard constraints that cannot all hold stand behind this choice, so a person has to settle which one gives way.',
      [...input.gate.hardConflicts],
    );
  }

  const chosen = new Set(options.map((option) => option.id));
  const clear = lenses.filter(
    (lens) =>
      lens.computable &&
      lens.verdict === 'clear-leader' &&
      lens.leaderId &&
      chosen.has(lens.leaderId),
  );
  const leaders = [...new Set(clear.map((lens) => lens.leaderId as string))];
  if (leaders.length > 1) {
    const parts = clear.map(
      (lens) =>
        `${label(options, lens.leaderId as string)} is clearly ahead on ${embed(lens.name, 70)}.`,
    );
    return fixed(
      'value-tradeoff',
      'needs-human-decision',
      `The choice turns on a trade-off between lenses: ${names(options, leaders)} each lead on a different one. A person has to weigh which matters more.`,
      parts,
    );
  }

  const primary = lenses.find((lens) => lens.id === PRIMARY_LENS);
  const leaderId = primary?.verdict === 'clear-leader' ? primary.leaderId : null;
  const aboutTheSame =
    input.signal === 'no-difference' &&
    leaderId !== null &&
    (leaderId === input.headlineId || leaderId === input.baselineId);
  if (!primary || !leaderId || aboutTheSame) {
    const level =
      primary && primary.levelIds.length > 1
        ? primary.levelIds
        : options.map((option) => option.id);
    const why: string[] = [];
    if (aboutTheSame) {
      why.push(
        'The comparison found no measurable difference between the proposed change and no change under these assumptions.',
      );
    } else if (primary?.verdict === 'tie') {
      why.push(
        `On ${embed(LENS_INFO[PRIMARY_LENS].name, 70)}, ${names(options, level)} cannot be told apart within run-to-run variation.`,
      );
    } else {
      why.push(primary?.note ?? 'The headline lens could not tell the options apart.');
    }
    for (const lens of lenses.filter(
      (entry) =>
        entry.id !== PRIMARY_LENS &&
        entry.computable &&
        entry.verdict === 'clear-leader' &&
        entry.leaderId,
    )) {
      why.push(
        `One lens does separate them: on ${embed(lens.name, 70)}, ${label(options, lens.leaderId as string)} is clearly ahead.`,
      );
    }
    return fixed(
      'no-clear-leader',
      'multiple-plausible-options',
      `The simulation cannot tell ${names(options, level.slice(0, 3))} apart, so Swarm does not pick one.`,
      why,
    );
  }

  const conditions = conditionsOf(input, leaderId);
  const lensWhy = lenses
    .filter((lens) => lens.computable)
    .map((lens) => {
      const standing =
        lens.results.find((result) => result.alternativeId === leaderId)?.standing ??
        'not-assessed';
      return `On ${embed(lens.name, 70)}: ${LENS_STANDING_WORDS[standing].toLowerCase()}.`;
    });
  if (conditions.length === 0) {
    return {
      reading: reading(
        guard,
        'robust',
        'robust-option',
        `${label(options, leaderId)} is ahead on every lens Swarm computed, and nothing it tried reverses that. It is a result of the simulation under stated assumptions.`,
        [...lensWhy, 'No counterfactual view or sensitive assumption could reverse it.'],
      ),
      leaderId,
      preferredId: leaderId,
    };
  }
  return {
    reading: reading(
      guard,
      'conditional',
      'conditional-option',
      `${label(options, leaderId)} is ahead on the headline lens, on conditions. ${clip(conditions[0] ?? '', 260)}`,
      lensWhy,
      conditions,
    ),
    leaderId,
    preferredId: leaderId,
  };
}
