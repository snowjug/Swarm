import {
  UNRECORDED_INPUTS_ADVICE,
  inputsInWords,
  type Analysis,
} from '../../../shared/analysis.js';
import {
  constraintBasisOf,
  summariseCounterfactual,
  type ConstraintSet,
  type CounterfactualSet,
} from '../../../shared/constraints.js';
import { CRITIC_ROLE_LABELS, type CritiqueSet } from '../../../shared/critique.js';
import {
  DECISION_CANVAS_VERSION,
  DECISION_STATUS_INFO,
  EXPLORE_NOT_PREDICT,
  HIGH_STAKES_DOMAINS,
  PRIMARY_LENS,
  decisionCanvasSchema,
  labelOf,
  type AlternativeReading,
  type ApprovalPoint,
  type CounterfactualReading,
  type CritiqueReading,
  type CriticalAssumption,
  type DecisionCanvas,
  type DecisionReadiness,
  type DecisionStatusReading,
  type DriverReading,
  type Labelled,
  type LensReading,
} from '../../../shared/decision.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import type { ResearchRun } from '../../../shared/research.js';
import type { StakeholderSet } from '../../../shared/stakeholders.js';
import { evidenceIndex, type BriefDocument } from '../brief/evidence.js';
import type { BriefLedgerSummary } from '../brief/facts.js';
import { baselineOf, headlineOf, measureVariants } from '../brief/measures.js';
import { readSignal } from '../brief/signal.js';
import { changedInputs } from '../lab/lineage.js';
import { readConstraints } from './constraints.js';
import { readEvidence } from './evidence.js';
import { assumptionFlips, counterfactualFlips, couldReverse, type FlipWorld } from './flips.js';
import { computeLenses } from './lenses.js';
import { participantOrigin, participantsOf } from './participants.js';
import {
  readActors,
  readFutures,
  readInterventions,
  readMovement,
  strengthSetBy,
  type ReadingWorld,
} from './readings.js';
import { buildRecommendation } from './recommendation.js';
import { consequentialScope, type ConsequentialScope } from './scope.js';
import { individualReading, qualifiedApproval, scopeSection } from './scope-words.js';
import { deriveStatus, type Flip, type StatusOption } from './status.js';
import { planValidation } from './validation.js';
import { Guard, clip, embed, listed, oneLine, plural, signed } from './words.js';

/**
 * Builds the Decision Canvas from the documents a project holds. It is a pure function: the same
 * documents give the same canvas, nothing is read or written here, and nothing is stored, so the canvas
 * is never older than what it describes. No model writes any of it: every sentence is assembled by
 * rules, held to the wording guard of the brief, and labelled with what kind of statement it is.
 */

export interface DecisionInputs {
  project: { id: string; name: string; question: string };
  scenario: ScenarioFrame | null;
  stakeholders: StakeholderSet | null;
  /** The newest finished comparison. */
  analysis: Analysis;
  /** The constraints as they stand now, with the gate worked out now; null when the project has none. */
  constraints: ConstraintSet | null;
  counterfactuals: { set: CounterfactualSet; current: boolean } | null;
  critiques: CritiqueSet | null;
  documents: readonly BriefDocument[];
  /** The ledger’s conflicts and its review; null when it has not been built or holds no claim to assess. */
  ledger: BriefLedgerSummary | null;
  research: ResearchRun | null;
  /** The revision of each document the comparison is made from, as the project holds it now. */
  revisionsNow: Readonly<Record<string, number>>;
  /** A comparison newer than this one is queued or running. */
  newerRunning: boolean;
}

const theirs = (text: string, label: Labelled['label'], basis: string): Labelled => ({
  text: clip(oneLine(text), 700),
  label,
  basis,
});

const SEVERITY_RANK = { blocking: 0, major: 1, minor: 2, note: 3 } as const;

/**
 * What the rules say when there is no canvas to put them on: there is nothing to base an answer on, unless the
 * question is one that Swarm does not decide, which is the first thing the rules read.
 */
export function statusWithoutAnalysis(
  why: string,
  scope: ConsequentialScope = { domains: [], aboutIndividual: false, basis: [] },
): DecisionStatusReading {
  if (scope.aboutIndividual) {
    const info = DECISION_STATUS_INFO['needs-human-decision'];
    const guard = new Guard();
    const reading = individualReading(scope);
    return {
      status: 'needs-human-decision',
      rule: 'individual-decision',
      label: info.label,
      meaning: info.meaning,
      headline: guard.say(reading.headline, 600),
      why: reading.why.map((line) => guard.say(line, 400)),
      conditions: [],
    };
  }
  const info = DECISION_STATUS_INFO['insufficient-evidence'];
  return {
    status: 'insufficient-evidence',
    rule: 'no-analysis',
    label: info.label,
    meaning: info.meaning,
    headline:
      'There is no finished comparison of options yet, so Swarm has nothing to recommend from.',
    why: [clip(why, 400)],
    conditions: [],
  };
}

export function buildCanvas(inputs: DecisionInputs): DecisionCanvas {
  const guard = new Guard();
  const { analysis, scenario, project } = inputs;
  const scope = consequentialScope(project.question, scenario);
  const measures = measureVariants(analysis);
  const baseline = baselineOf(measures);
  const headline = headlineOf(analysis, measures);
  const signal = readSignal(analysis, headline);
  const participants = participantsOf(analysis.actors, inputs.stakeholders?.stakeholders ?? []);
  const positions = new Map([...participants].map(([id, entry]) => [id, entry.position]));
  const index = evidenceIndex(inputs.stakeholders, analysis.actors, inputs.documents);
  const options: StatusOption[] = measures.map((measure) => ({
    id: measure.variant.id,
    label: measure.variant.label,
    kind: measure.variant.kind,
  }));
  const world: ReadingWorld = {
    analysis,
    scenario,
    measures,
    headline,
    baseline,
    evidence: index,
    participants,
    origin: participantOrigin(inputs.stakeholders),
  };

  // ---- Constraints, lenses, evidence ----------------------------------------------------------
  const constraints = readConstraints(inputs.constraints, analysis);
  const blocked = new Set(constraints.confirmedViolations.keys());
  const lenses = computeLenses({ measures, actors: analysis.actors, positions, blocked });
  const evidence = readEvidence(
    {
      analysis,
      stakeholders: inputs.stakeholders,
      documents: inputs.documents,
      ledger: inputs.ledger,
      research: inputs.research,
      scenario,
    },
    guard,
  );

  // ---- What could reverse the answer ----------------------------------------------------------
  const primary = lenses.find((lens) => lens.id === PRIMARY_LENS);
  const values = new Map<string, number>(
    (primary?.results ?? [])
      .filter((result) => result.value !== null && !blocked.has(result.alternativeId))
      .map((result) => [result.alternativeId, result.value as number]),
  );
  const headlineId = headline?.variant.variant.id ?? null;
  const cfSet = inputs.counterfactuals?.set ?? null;
  const cfCurrent = inputs.counterfactuals?.current ?? false;
  const cfWorld: FlipWorld = {
    values,
    proposedId: cfSet && values.has(cfSet.variantId) ? cfSet.variantId : null,
  };
  const rowWorld: FlipWorld = { values, proposedId: headlineId };
  const cfViews = cfSet && cfCurrent ? cfSet.views : [];
  const flipsFor = (leaderId: string): Flip[] => [
    ...counterfactualFlips(cfViews, cfWorld, leaderId),
    ...assumptionFlips(analysis.sensitivity, rowWorld, leaderId),
  ];

  const changed = changedInputs(analysis.inputRevisions, undefined, inputs.revisionsNow);
  const unrecorded = analysis.inputRevisions === undefined;
  const staleSentence =
    changed.length > 0
      ? `The comparison was run before ${inputsInWords(changed)} changed, so it describes the project as it was.`
      : unrecorded
        ? UNRECORDED_INPUTS_ADVICE
        : null;

  // ---- The independent review -----------------------------------------------------------------
  const forThis =
    inputs.critiques !== null &&
    (inputs.critiques.analysisId === null || inputs.critiques.analysisId === analysis.id);
  const critiques = forThis ? (inputs.critiques?.critiques ?? []) : [];
  const stands = (critique: (typeof critiques)[number]): boolean =>
    critique.status !== 'responded' || critique.remainingDisagreement !== null;
  const blockingOpen = critiques.filter(
    (critique) => critique.severity === 'blocking' && stands(critique),
  ).length;
  const critic: DecisionCanvas['critic'] = {
    reviewed: inputs.critiques !== null,
    current: forThis,
    open: critiques.filter((critique) => critique.status === 'open').length,
    blockingOpen,
    note: guard.say(
      inputs.critiques === null
        ? 'The independent review has not been run, so nobody independent has challenged this result.'
        : !forThis
          ? 'The independent review was written for a different comparison, so none of its objections is counted here.'
          : critiques.length === 0
            ? 'The independent review ran and raised nothing. That does not show that nothing is wrong.'
            : `The independent review raised ${critiques.length} ${plural(critiques.length, 'objection')}; its most serious are shown.`,
      400,
    ),
    challenges: [...critiques]
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          Number(b.status === 'open') - Number(a.status === 'open') ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 5)
      .map((critique): CritiqueReading => ({
        id: clip(critique.id, 80),
        role: critique.role,
        roleLabel: CRITIC_ROLE_LABELS[critique.role],
        severity: critique.severity,
        status: critique.status,
        objection: theirs(
          critique.objection,
          labelOf('critique-origin', critique.origin),
          `critique-origin:${critique.origin}`,
        ),
        impact: clip(oneLine(critique.impactOnConclusion), 500),
        requestedAction: critique.requestedAction
          ? clip(oneLine(critique.requestedAction), 300)
          : null,
      })),
  };

  // ---- The status -----------------------------------------------------------------------------
  const counterfactualsExamined =
    cfSet !== null && cfCurrent && cfSet.views.some((view) => view.applicable);
  const result = deriveStatus(
    {
      scope,
      options,
      hasRuns: measures.length > 0,
      gate: {
        status: constraints.gate,
        blockedBy: (constraints.coverage?.blockedBy ?? []).map((entry) => entry.text),
        label: constraints.section.provisionalLabel,
        hardConflicts: constraints.hardConflicts,
      },
      confirmedViolations: constraints.confirmedViolations,
      unconfirmedViolations: constraints.unconfirmedViolations,
      comparison: { constraints: constraints.section.comparisonStatus },
      signal: signal.state,
      headlineId,
      baselineId: baseline?.variant.id ?? null,
      evidence: { level: evidence.level, reasons: evidence.reasons },
      lenses,
      flipsFor,
      examined: {
        counterfactuals: counterfactualsExamined,
        sensitivity: analysis.sensitivity.length > 0,
      },
      stale: staleSentence,
      critics: { reviewed: inputs.critiques !== null, current: forThis, blockingOpen },
    },
    guard,
  );
  const { reading: status, leaderId, preferredId } = result;
  const flips = leaderId ? flipsFor(leaderId) : [];

  // ---- Alternatives, assumptions, counterfactuals -----------------------------------------------
  const computable = lenses.filter((lens) => lens.computable);
  const alternatives: AlternativeReading[] = options.map((option) => {
    const standing = Object.fromEntries(
      lenses.map((lens) => [
        lens.id,
        lens.results.find((entry) => entry.alternativeId === option.id)?.standing ?? 'not-assessed',
      ]),
    ) as AlternativeReading['standing'];
    const confirmed = constraints.confirmedViolations.get(option.id);
    const unconfirmed = constraints.unconfirmedViolations.get(option.id);
    const ids = constraints.rows
      .filter((row) => row.violatedBy.includes(option.id))
      .map((row) => row.id);
    const ahead = computable.filter(
      (lens) => standing[lens.id] === 'leads' || standing[lens.id] === 'level',
    );
    const behind = computable.filter((lens) => standing[lens.id] === 'behind');
    const runs = measures.find((measure) => measure.variant.id === option.id)?.runs.length ?? 0;
    let verdict: AlternativeReading['verdict'];
    let why: string;
    if (confirmed) {
      verdict = 'blocked';
      why = `Ruled out by a confirmed hard constraint: ${embed(confirmed[0] ?? '', 120)}.`;
    } else if (scope.aboutIndividual) {
      verdict = 'not-ranked';
      why = `${ahead.length > 0 ? `Clearly ahead or level on ${listed(ahead.map((lens) => embed(lens.name, 60)))}. ` : ''}Shown as explored and not ranked: a decision about one person is for a qualified person.`;
    } else if (option.id === preferredId) {
      verdict = 'preferred';
      why = `Clearly ahead on ${listed(computable.filter((lens) => standing[lens.id] === 'leads').map((lens) => embed(lens.name, 60)))}.`;
    } else if (behind.length > 0 && behind.length === computable.length) {
      verdict = 'weak';
      why = 'Clearly behind the best option on every lens that was computed.';
    } else {
      verdict = 'viable';
      why =
        ahead.length > 0
          ? `${standing[PRIMARY_LENS] === 'leads' ? 'Clearly ahead' : 'Level with the best'} on ${listed(ahead.map((lens) => embed(lens.name, 60)))}.`
          : 'No lens could tell it from the others.';
    }
    if (unconfirmed && !confirmed) {
      why = `${why} It is ruled out if ${embed(unconfirmed[0] ?? '', 100)} holds, and that is not confirmed.`;
    }
    return {
      id: option.id,
      label: clip(option.label, 120),
      kind: option.kind,
      verdict,
      why: guard.say(why, 500),
      violatedConstraintIds: ids.slice(0, 20),
      violationConfirmed: confirmed ? true : unconfirmed ? false : null,
      standing,
      runs,
    };
  });

  const sensitive = analysis.sensitivity.filter(
    (row) => row.classification === 'assumption-sensitive',
  );
  const assumptions: (CriticalAssumption & { label: string })[] = sensitive
    .slice(0, 8)
    .map((row) => ({
      id: clip(row.id, 100),
      label: row.label,
      statement: guard.statement(
        `The result is sensitive to ${embed(row.label, 140)}.`,
        labelOf('sensitivity-origin', row.assumptionOrigin),
        `sensitivity-origin:${row.assumptionOrigin}`,
      ),
      origin: row.assumptionOrigin,
      classification: row.classification,
      shift: row.shift,
      standardError: row.standardError,
      flipsAnswer: leaderId !== null && couldReverse(rowWorld, leaderId, row.shift),
      evidenced: row.assumptionOrigin === 'evidence',
    }));
  const counterfactualViews: CounterfactualReading[] = (cfSet?.views ?? []).map((view) => {
    const summary = summariseCounterfactual(view);
    const reverses =
      leaderId === null || !view.applicable || view.deltaVsBase === null
        ? null
        : view.classification === 'material'
          ? couldReverse(cfWorld, leaderId, view.deltaVsBase)
          : view.classification === 'negligible'
            ? false
            : null;
    return {
      id: view.id,
      label: clip(view.label, 120),
      change: clip(view.change, 300),
      applicable: view.applicable,
      deltaVsBase: view.deltaVsBase,
      standardError: view.standardError,
      classification: view.classification,
      driver: clip(summary.driver, 240),
      couldChangeAnswer: cfCurrent ? reverses : null,
      statement:
        view.applicable && view.deltaVsBase !== null
          ? guard.statement(
              `${embed(view.label, 60)}: in the simulation it moved the simulated share of members ending in switch or resist by ${signed(view.deltaVsBase)} on the same seeds${view.classification ? `, a ${view.classification === 'material' ? 'material' : view.classification === 'negligible' ? 'negligible' : 'not conclusive'} change` : ''}.`,
              'simulation-event',
              'counterfactual:view',
            )
          : guard.statement(
              `${embed(view.label, 60)} could not be run for this project${view.reason ? `: ${clip(view.reason, 160)}` : ''}.`,
              'validation-requirement',
              'counterfactual:not-run',
            ),
    };
  });

  // ---- Actors, futures, movement ---------------------------------------------------------------
  const preferredMeasure = preferredId
    ? (measures.find((measure) => measure.variant.id === preferredId) ?? null)
    : null;
  const focus =
    preferredMeasure && preferredMeasure.variant.kind === 'alternative'
      ? preferredMeasure
      : (headline?.variant ?? null);
  const actors = readActors(world, focus, guard);
  const futures = readFutures(world, lenses, blocked, guard);
  const movement = readMovement(world, guard);
  const owners = actors.items.filter((actor) => actor.position === 'decides');

  // ---- Drivers ---------------------------------------------------------------------------------
  const basis = constraintBasisOf(analysis.constraints);
  const drivers: DriverReading[] = [
    ...assumptions
      .filter((row) => row.flipsAnswer)
      .map((row) => ({
        id: `assumption-${row.id}`,
        kind: 'assumption' as const,
        statement: row.statement,
        effect: row.shift,
        flipsAnswer: true,
      })),
    ...basis.drivers.slice(0, 2).map((driver) => ({
      id: `constraint-${driver.constraintId}`,
      kind: 'constraint' as const,
      statement: guard.statement(
        `Taking away ${embed(driver.statement, 120)} moved the simulated share of members ending in switch or resist by ${signed(driver.withoutShift)} on the same seeds.`,
        'simulation-event',
        'constraint:impact',
      ),
      effect: driver.withoutShift,
      flipsAnswer: false,
    })),
    ...assumptions
      .filter((row) => !row.flipsAnswer)
      .slice(0, 2)
      .map((row) => ({
        id: `assumption-${row.id}`,
        kind: 'assumption' as const,
        statement: row.statement,
        effect: row.shift,
        flipsAnswer: false,
      })),
    ...actors.items
      .filter((actor) => Math.abs(actor.adverseChange ?? 0) >= 0.05)
      .slice(0, 2)
      .map((actor) => ({
        id: `actor-${actor.actorId}`,
        kind: 'actor' as const,
        statement: guard.statement(
          `${embed(actor.name, 60)} moved the most in the simulation: toward ${actor.moves === 'toward-support' ? 'support' : 'resistance'} compared with no change.`,
          'simulation-event',
          'run:actor-shift',
        ),
        effect: null,
        flipsAnswer: false,
      })),
  ].slice(0, 6);

  // ---- Reversibility, timing, uncertainty ----------------------------------------------------------
  const reversibilityRow = constraints.rows.find((row) => row.category === 'reversibility');
  const reversibility: DecisionCanvas['reversibility'] = {
    value: 'unknown',
    statement: guard.statement(
      reversibilityRow
        ? `A constraint concerns reversibility: ${embed(reversibilityRow.statement, 140)} Nothing shows whether the option meets it.`
        : 'Whether the choice can be reversed is unknown: nothing in the project says so. Treat the first step as hard to undo until it is known.',
      'validation-requirement',
      'reversibility:unknown',
    ),
  };
  const proposed = headline?.variant.variant;
  const timing: DecisionCanvas['timing'] = {
    horizon: scenario?.horizon
      ? theirs(scenario.horizon, labelOf('frame-origin', scenario.origin), 'scenario:horizon')
      : null,
    lands: guard.statement(
      proposed
        ? `In the simulation the change lands in round ${proposed.round} of ${analysis.config.rounds}. A round is not a fixed length of time.`
        : `The simulation runs ${analysis.config.rounds} rounds. A round is not a fixed length of time.`,
      'assumption',
      'variant:round',
    ),
    constraints: constraints.rows
      .filter((row) => row.category === 'time')
      .slice(0, 4)
      .map((row) => theirs(row.statement, row.label, `constraint:${row.id}`)),
  };

  const minRuns =
    measures.length === 0 ? 0 : Math.min(...measures.map((measure) => measure.runs.length));
  const highUncertainty = analysis.actors.filter(
    (actor) => actor.uncertainty.level === 'high',
  ).length;
  const unstable = analysis.findings.filter(
    (finding) => finding.classification === 'unstable' || finding.classification === 'rare',
  ).length;
  const uncertaintyReasons: Labelled[] = [
    guard.statement(
      `${minRuns} seeded ${plural(minRuns, 'run')} per option, from base seed ${analysis.config.baseSeed}. Run-to-run variation is what the spread shows.`,
      'fact',
      'record:runs',
    ),
    guard.statement(`${analysis.fidelity.label}.`.replace(/\.\.$/u, '.'), 'assumption', 'fidelity'),
    ...analysis.fidelity.caveats
      .slice(0, 2)
      .map((caveat) => guard.statement(caveat, 'assumption', 'fidelity:caveat')),
  ];
  if (minRuns > 0 && minRuns < 10) {
    uncertaintyReasons.push(
      guard.statement(
        'Fewer than 10 seeded runs per option: too few to tell options apart.',
        'validation-requirement',
        'record:few-runs',
      ),
    );
  }
  if (highUncertainty > 0) {
    uncertaintyReasons.push(
      guard.statement(
        `${highUncertainty} of ${analysis.actors.length} simulated ${plural(analysis.actors.length, 'actor')} carry high uncertainty about their traits.`,
        'assumption',
        'actor:uncertainty',
      ),
    );
  }
  if (unstable > 0) {
    uncertaintyReasons.push(
      guard.statement(
        `${unstable} of ${analysis.findings.length} simulated findings did not repeat across seeded runs.`,
        'simulation-event',
        'finding:stability',
      ),
    );
  }
  if (analysis.crossCheck?.withinEnsembleRange === false) {
    uncertaintyReasons.push(
      guard.statement(
        'A deeper check of the same project did not agree with the repeated runs.',
        'simulation-event',
        'cross-check',
      ),
    );
  }
  if (measures.some((measure) => measure.detail !== 'runs')) {
    uncertaintyReasons.push(
      guard.statement(
        'The analysis kept only totals over the runs for some options, so some comparisons cannot be told from run-to-run variation.',
        'validation-requirement',
        'record:totals-only',
      ),
    );
  }

  // ---- Validation, recommendation, approvals ---------------------------------------------------------
  const hard = constraints.section.hard;
  const noRegret = readNoRegret(world, actors.items, cfViews, cfCurrent, guard);
  // A legal, regulatory or safety constraint also calls for a qualified person to confirm it, so the approval point
  // stands for those too; the notice does not, for it is about what the question asks.
  const constrained = HIGH_STAKES_DOMAINS.filter(
    (domain) =>
      (domain === 'legal' &&
        hard.some((row) => row.category === 'legal' || row.category === 'regulatory')) ||
      (domain === 'safety' && hard.some((row) => row.category === 'safety')),
  );
  const approvalScope: ConsequentialScope = {
    ...scope,
    domains: HIGH_STAKES_DOMAINS.filter(
      (domain) => scope.domains.includes(domain) || constrained.includes(domain),
    ),
  };
  const point = (
    id: string,
    stage: ApprovalPoint['stage'],
    sentence: string,
    state: ApprovalPoint['state'],
  ): ApprovalPoint => ({ id, stage, text: guard.say(sentence, 400), state });
  const approvals: ApprovalPoint[] = [
    point(
      'approve-actors',
      'before-simulation',
      'A person reviewed and approved the stakeholders and the simulated actors before the simulation.',
      inputs.stakeholders?.approvedAt ? 'done' : 'open',
    ),
    point(
      'approve-constraints',
      'before-simulation',
      'A person reviewed the constraints before the simulation.',
      constraints.coverage?.reviewed ? 'done' : 'open',
    ),
    point(
      'approve-validation',
      'before-acting',
      'The validation plan is done. Swarm does not track this: someone confirms it outside Swarm.',
      'open',
    ),
    point(
      'approve-named',
      'before-acting',
      owners.length > 0
        ? `A named approver agrees to act: a real person who holds the role of ${listed(owners.slice(0, 2).map((actor) => embed(actor.name, 50)))}.`
        : 'A named approver agrees to act: a real person who holds the decision.',
      'open',
    ),
    ...(approvalScope.domains.length > 0
      ? [point('approve-qualified', 'before-acting', qualifiedApproval(approvalScope), 'open')]
      : []),
  ];

  const plan = planValidation(
    {
      status,
      scope,
      evidence,
      scenarioMissing: scenario?.evidenceMissing ?? [],
      hardConstraints: hard,
      openQuestions: constraints.section.missing.slice(1),
      assumptions,
      actors: actors.items,
      conflicts: (inputs.ledger?.conflicts ?? [])
        .filter((conflict) => conflict.status === 'detected' || conflict.status === 'confirmed')
        .map((conflict) => conflict.topic),
      critiques: critiques.filter(stands).map((critique) => ({
        id: critique.id,
        role: critique.role,
        severity: critique.severity,
        objection: critique.objection,
        impact: critique.impactOnConclusion,
        requestedAction: critique.requestedAction ?? null,
      })),
      optionNames:
        status.status === 'needs-human-decision' || status.status === 'multiple-plausible-options'
          ? (primary?.levelIds.length ? primary.levelIds : options.map((option) => option.id)).map(
              (id) => embed(options.find((option) => option.id === id)?.label ?? id, 50),
            )
          : [],
      reversibility: reversibility.value,
    },
    guard,
  );

  const contenders = contendersOf(status, lenses, primary, options);
  const card = buildRecommendation(
    {
      status,
      scope,
      options,
      preferred: preferredId ? (options.find((option) => option.id === preferredId) ?? null) : null,
      contenders,
      owners,
      affected: actors.items
        .filter((actor) => actor.moves === 'toward-resistance' || actor.moves === 'toward-support')
        .slice(0, 3),
      flips,
      flippingAssumptions: assumptions.filter((row) => row.flipsAnswer),
      statedAssumptions: (scenario?.assumptions ?? []).slice(0, 3),
      strengthSetBy: strengthSetBy(world),
      hard,
      soft: constraints.section.soft,
      gateStatus: constraints.gate,
      gateLabel: constraints.section.provisionalLabel,
      evidence,
      lenses,
      critiques: critic.challenges,
      validation: plan.items,
      stops: plan.stopConditions,
      reversibility,
      approvals,
    },
    guard,
  );

  // ---- Assemble ----------------------------------------------------------------------------------------
  const lensTitles = lenses.filter((lens) => lens.verdict === 'clear-leader');
  const leaders = new Set(lensTitles.map((lens) => lens.leaderId));
  const canvas: DecisionCanvas = {
    version: DECISION_CANVAS_VERSION,
    notice: EXPLORE_NOT_PREDICT,
    question: {
      asked: clip(oneLine(project.question), 2000),
      decision: theirs(
        scenario?.decision || project.question,
        scenario ? labelOf('frame-origin', scenario.origin) : 'assumption',
        scenario ? `frame-origin:${scenario.origin}` : 'question',
      ),
      baseline: theirs(
        scenario?.baseline || baseline?.variant.description || 'No baseline was stated.',
        scenario ? labelOf('frame-origin', scenario.origin) : 'assumption',
        scenario ? `frame-origin:${scenario.origin}` : 'variant:baseline',
      ),
      system: clip(oneLine(scenario?.system ?? ''), 300),
      horizon: timing.horizon,
      geography: scenario?.geography
        ? theirs(scenario.geography, labelOf('frame-origin', scenario.origin), 'scenario:geography')
        : null,
      successWording: scenario?.desiredOutput
        ? theirs(
            scenario.desiredOutput,
            labelOf('frame-origin', scenario.origin),
            'scenario:desired-output',
          )
        : null,
    },
    status,
    answer: {
      headline: guard.statement(status.headline, 'recommendation', `status:${status.status}`, 600),
      preferredAlternativeId: preferredId,
      recommendation: card,
    },
    alternatives,
    lenses,
    lensAgreement: {
      state:
        computable.length === 0
          ? 'not-assessed'
          : leaders.size > 1
            ? 'disagree'
            : leaders.size === 1
              ? 'agree'
              : 'tied',
      statement: guard.say(lensAgreement(lenses, options), 600),
    },
    futures,
    drivers,
    constraints: constraints.section,
    actors,
    changes: {
      counterfactuals: {
        available: cfSet !== null,
        current: cfCurrent,
        note: guard.say(
          cfSet === null
            ? 'No counterfactual view has been run, so no change to the situation was tried to see whether the result holds. Run them from the constraints.'
            : !cfCurrent
              ? 'The counterfactual views were made from an earlier version of the constraints, the scenario or the actors, so they are not counted here.'
              : 'Each view changes one thing and runs the proposed change again on the same seeds. None is a forecast, and the other options were not re-run under it.',
          400,
        ),
        views: counterfactualViews,
      },
      assumptions: assumptions.map(({ label: _label, ...row }) => row),
      sensitivity: {
        tested: analysis.sensitivity.length,
        sensitive: sensitive.length,
        robust: analysis.sensitivity.filter((row) => row.classification === 'robust').length,
        inconclusive: analysis.sensitivity.filter((row) => row.classification === 'inconclusive')
          .length,
        note: guard.say(
          analysis.sensitivity.length === 0
            ? 'Sensitivity to assumptions was not run for this comparison.'
            : 'Each row moves one assumption of the proposed change on the same seeds and reports how far the simulated share moved.',
          400,
        ),
      },
    },
    validation: {
      items: plan.items,
      stopConditions: plan.stopConditions,
      note: guard.say(
        'Worked out by rules from what is missing, unconfirmed or open. Each item is something to check in the real world; Swarm does not do it for you.',
        400,
      ),
    },
    evidence,
    uncertainty: {
      runsPerOption: minRuns,
      fidelity: clip(analysis.fidelity.label, 200),
      reasons: uncertaintyReasons.slice(0, 8),
      note: guard.say(
        'These are the named limits of what the simulation can say. None is a probability or a confidence level.',
        400,
      ),
    },
    reversibility,
    timing,
    risks: movement.risks,
    opportunities: movement.opportunities,
    interventions: readInterventions(world, guard),
    noRegret,
    critic,
    approvals,
    scope: scopeSection(scope, guard),
    freshness: {
      analysisId: analysis.id,
      completedAt: analysis.completedAt,
      stale: staleSentence !== null,
      changedSince: changed.map((kind) => kind),
      newerRunning: inputs.newerRunning,
      inputRevisions: { ...(analysis.inputRevisions ?? {}) },
    },
    notes: [
      ...(guard.withheld > 0
        ? [
            `${guard.withheld} ${plural(guard.withheld, 'sentence')} were withheld because the wording broke the guard against forecasts and unattributed figures.`,
          ]
        : []),
      ...(signal.state === 'no-difference'
        ? [
            'The comparison found no measurable difference between the proposed change and no change under these assumptions. That describes the assumptions, not the world.',
          ]
        : []),
    ],
    withheld: guard.withheld,
  };
  return decisionCanvasSchema.parse(canvas);
}

/** The options a recommendation that does not pick one has to say it will not choose between. */
function contendersOf(
  status: DecisionStatusReading,
  lenses: readonly LensReading[],
  primary: LensReading | undefined,
  options: readonly StatusOption[],
): StatusOption[] {
  const byId = (ids: readonly string[]): StatusOption[] =>
    ids.flatMap((id) => options.filter((option) => option.id === id));
  if (status.status === 'needs-human-decision') {
    return byId([
      ...new Set(
        lenses
          .filter((lens) => lens.verdict === 'clear-leader' && lens.leaderId)
          .map((lens) => lens.leaderId as string),
      ),
    ]);
  }
  if (status.status === 'multiple-plausible-options') {
    return byId(
      primary && primary.levelIds.length > 1
        ? primary.levelIds
        : options.map((option) => option.id),
    );
  }
  return [];
}

function lensAgreement(lenses: readonly LensReading[], options: readonly StatusOption[]): string {
  const computed = lenses.filter((lens) => lens.computable);
  if (computed.length === 0)
    return 'No lens could be computed, so there is nothing to compare across lenses.';
  const name = (id: string): string =>
    embed(options.find((option) => option.id === id)?.label ?? id, 50);
  const clear = computed.filter((lens) => lens.verdict === 'clear-leader' && lens.leaderId);
  const leaders = [...new Set(clear.map((lens) => lens.leaderId as string))];
  if (leaders.length > 1) {
    return `The lenses disagree: ${listed(clear.map((lens) => `${name(lens.leaderId as string)} leads on ${embed(lens.name, 60)}`))}. Swarm shows the disagreement and does not average it away.`;
  }
  if (leaders.length === 1 && clear.length === computed.length) {
    return `Every lens that could be computed has ${name(leaders[0] as string)} clearly ahead.`;
  }
  if (leaders.length === 1) {
    return `${name(leaders[0] as string)} is clearly ahead on ${listed(clear.map((lens) => embed(lens.name, 60)))}; on the other lenses it cannot be told apart from another option.`;
  }
  return 'On every lens that could be computed, the leading options cannot be told apart within run-to-run variation.';
}

/**
 * Moves that hold whichever option is taken: a group that ends up resisting more than under no change
 * in every option that can be chosen, and in every counterfactual view that ran. The views measure the
 * proposed change’s overall share, so “holds under every view” means the proposed change still ends up
 * at least as resisted as no change under each of them. It may be empty, and then it says so.
 */
function readNoRegret(
  world: ReadingWorld,
  actors: DecisionCanvas['actors']['items'],
  views: readonly CounterfactualSet['views'][number][],
  current: boolean,
  guard: Guard,
): DecisionCanvas['noRegret'] {
  const none = (note: string): DecisionCanvas['noRegret'] => ({
    moves: [],
    note: guard.say(note, 400),
  });
  const { baseline } = world;
  if (!baseline)
    return none(
      'Nothing could be checked: the comparison has no option that changes nothing to read the others against.',
    );
  const changes = world.measures.filter((measure) => measure.variant.kind === 'alternative');
  if (changes.length === 0)
    return none('Nothing could be checked: the comparison has no alternative.');
  if (!current || views.filter((view) => view.applicable).length === 0) {
    return none(
      'Nothing could be checked against the counterfactual views, because none that still describes the project was run. No move is called a no-regret move without them.',
    );
  }
  const headline = world.headline;
  const proposedShare = headline
    ? mean2(
        headline.variant.runs.map((run) => run.responseShares.switch + run.responseShares.resist),
      )
    : null;
  const baseShare = mean2(
    baseline.runs.map((run) => run.responseShares.switch + run.responseShares.resist),
  );
  const holdsUnderViews =
    proposedShare === null ||
    views
      .filter((view) => view.applicable && view.deltaVsBase !== null)
      .every((view) => proposedShare + (view.deltaVsBase ?? 0) >= baseShare);
  if (!holdsUnderViews) {
    return none(
      'Under at least one counterfactual view the proposed change ends up less resisted than no change, so no group-level move holds under every view.',
    );
  }
  const moves: Labelled[] = [];
  for (const actor of actors) {
    if (moves.length >= 4) break;
    const own = world.analysis.actors.find((entry) => entry.id === actor.actorId);
    if (!own) continue;
    const everywhere = changes.every((measure) => {
      const mine = measure.actors.find((entry) => entry.actorId === actor.actorId);
      const base = baseline.actors.find((entry) => entry.actorId === actor.actorId);
      if (!mine || !base) return false;
      const share = (shares: typeof mine.shares): number => shares.switch + shares.resist;
      return share(mine.shares) - share(base.shares) >= 0.05;
    });
    if (everywhere) {
      moves.push(
        guard.statement(
          `Prepare a response for ${embed(actor.name, 60)}: in the simulation this role ends up looking for an alternative or resisting more often than under no change in every option tried, and under every counterfactual view that ran.`,
          'recommendation',
          'no-regret',
        ),
      );
    }
  }
  return {
    moves,
    note: guard.say(
      moves.length === 0
        ? 'No move holds under every option and every counterfactual view in this comparison. That does not mean none exists.'
        : 'These hold in every option the comparison tried and under every counterfactual view that ran. Neither list is exhaustive.',
      400,
    ),
  };
}

const mean2 = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

/** What the canvas still lacks, in plain words, for the page and the route to say beside it. */
export function readinessOf(canvas: DecisionCanvas): DecisionReadiness {
  const missing: string[] = [];
  if (canvas.constraints.gate === 'none') missing.push('The constraints have not been reviewed.');
  else if (!canvas.constraints.reviewed)
    missing.push('The constraints have not been confirmed as reviewed.');
  if (!canvas.critic.reviewed) missing.push('The independent review has not been run.');
  else if (!canvas.critic.current)
    missing.push('The independent review was written for a different comparison.');
  if (!canvas.changes.counterfactuals.available)
    missing.push('No counterfactual view has been run.');
  else if (!canvas.changes.counterfactuals.current)
    missing.push('The counterfactual views are out of date.');
  if (canvas.changes.sensitivity.tested === 0)
    missing.push('Sensitivity to assumptions was not run.');
  if (canvas.freshness.stale)
    missing.push('The comparison was run before something it is made from changed.');
  for (const lens of canvas.lenses.filter((entry) => !entry.computable)) {
    missing.push(`${lens.name} could not be computed.`);
  }
  if (canvas.evidence.level !== 'adequate') {
    missing.push(`The evidence is ${canvas.evidence.level}.`);
  }
  return {
    state: 'ready',
    missing: missing.map((line) => clip(line, 300)),
    next: null,
    status: canvas.status,
    scope: canvas.scope,
  };
}
