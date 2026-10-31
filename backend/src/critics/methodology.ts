import { CHANGE_CANNOT_MOVE_ID, type Critique } from '../../../shared/critique.js';
import { NO_DIRECTION_NOTICE } from '../../../shared/signal.js';
import { draft, fixed, level, names, plural, signed, whole } from './text.js';
import type { Resolved, RoleCritic } from './types.js';

/** Are there enough repeated runs, and does the fidelity justify the wording? */
const ROLE = 'methodology' as const;

/** The fewest runs per variant that this check accepts without comment. */
export const MIN_RUNS_PER_VARIANT = 20;
/** A 95% interval wider than this leaves open how repeatable a headline finding is. */
const WIDE_INTERVAL = 0.4;
const Z_SQUARED = 1.96 ** 2;

/** The notice every page uses, split into what is wrong and what to do about it, so that it is never reworded. */
const [NOTICE_CLAIM = NO_DIRECTION_NOTICE, ...NOTICE_STEPS] =
  NO_DIRECTION_NOTICE.split(/(?<=[.!?])\s+/u);
const NOTICE_ACTION =
  NOTICE_STEPS.join(' ') ||
  'Say who is helped or harmed in the stakeholder review, or read the evidence with a model, then compare again.';

/**
 * A comparison in which no scenario can move anyone shows only noise, whatever its numbers say. This is
 * the one criticism that has to be read before the others, so it is pinned to the top of the review.
 */
function changeCannotMove(input: Resolved): Critique[] {
  if (input.facts.changeCanMove) return [];
  const { analysis } = input;
  const cast = input.actors.actors;
  const alternatives = analysis.config.variants.filter((variant) => variant.kind !== 'baseline');
  const directed = cast.filter(
    (actor) =>
      actor.traits.impact.value !== 0 ||
      alternatives.some((variant) => (variant.impactOverrides[actor.id] ?? 0) !== 0),
  );
  const noDirection = directed.length === 0;
  const reported = analysis.findings.find((finding) => finding.kind === 'direction-vs-baseline');
  return [
    draft(input.now, {
      id: CHANGE_CANNOT_MOVE_ID,
      role: ROLE,
      target: whole(analysis.id),
      severity: 'major',
      objection: noDirection
        ? NOTICE_CLAIM
        : 'No scenario other than the baseline both has an intensity above nothing and affects an actor in some direction, so the change cannot move anyone in the simulation and every difference from no change is noise.',
      basis: [
        `Actors with an expected direction of impact: ${directed.length} of ${cast.length}.`,
        alternatives.length === 0
          ? 'Scenarios other than the baseline: none.'
          : `Scenarios other than the baseline: ${names(
              alternatives.map(
                (variant) => `${variant.label} (intensity ${level(variant.intensity)})`,
              ),
              3,
            )}.`,
        ...(reported ? [`${reported.id}: ${reported.statement}`] : []),
      ],
      impact:
        'If this stands, nothing in this comparison is about the change: “about the same”, or any other difference from no change, is noise from the seeds, and the conclusions drawn from it do not follow.',
      action: noDirection
        ? NOTICE_ACTION
        : 'Give the change an intensity above nothing in a scenario that affects at least one actor, then compare again.',
    }),
  ];
}

function fewRuns(input: Resolved): Critique[] {
  const runs = input.analysis.config.runsPerVariant;
  if (runs >= MIN_RUNS_PER_VARIANT) return [];
  // The lower end of the 95% Wilson interval for a finding that holds in every one of `runs` runs.
  const floor = fixed(runs / (runs + Z_SQUARED));
  return [
    draft(input.now, {
      id: 'methodology-few-runs',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: runs < 10 ? 'major' : 'minor',
      objection: `Each variant was run ${runs} times with different seeds. With so few runs, how often a finding holds is only roughly known.`,
      basis: [
        `Runs per variant: ${runs}; this check asks for at least ${MIN_RUNS_PER_VARIANT}.`,
        `Even a finding that holds in all ${runs} runs has a 95% interval that starts at ${floor}.`,
      ],
      impact:
        'If this stands, findings that look repeatable may not be; add runs before using a finding as the basis for a decision.',
    }),
  ];
}

function rulesOnly(input: Resolved): Critique[] {
  const { fidelity } = input.analysis;
  if (fidelity.engine !== 'rules' || fidelity.keyActors !== 'rules') return [];
  return [
    draft(input.now, {
      id: 'methodology-rules-only',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection:
        'Every outcome is a mechanical consequence of the declared assumptions: no model decided how any actor behaves, so the results show what the assumptions imply, not what people would do.',
      basis: [
        `Engine: ${fidelity.engine}; key actors: ${fidelity.keyActors}; cohorts: ${fidelity.cohorts}.`,
        `Fidelity label: ${fidelity.label}.`,
      ],
      impact:
        'If this stands, the findings are consistency checks on the assumptions and must not be worded as observed or predicted behaviour.',
    }),
  ];
}

function modelRepeats(input: Resolved): Critique[] {
  const { fidelity } = input.analysis;
  const modelDriven = fidelity.engine === 'hybrid' || fidelity.keyActors === 'model';
  if (!modelDriven || fidelity.modelRepeats > 1) return [];
  return [
    draft(input.now, {
      id: 'methodology-model-repeats',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'major',
      objection: `A model drove part of the behaviour, but that part was run ${fidelity.modelRepeats === 0 ? 'no times' : 'once'}, so how much it varies from run to run is not measured.`,
      basis: [
        `Model repeats: ${fidelity.modelRepeats}.`,
        `Engine: ${fidelity.engine}; key actors: ${fidelity.keyActors}.`,
      ],
      impact:
        'If this stands, the model-driven part of the result is a single draw that could differ on another run; repeat it before relying on it.',
    }),
  ];
}

function manyUnstable(input: Resolved): Critique[] {
  const { findings } = input.analysis;
  const unstable = findings.filter((finding) => finding.classification === 'unstable');
  if (unstable.length < 2 || unstable.length / findings.length < 1 / 3) return [];
  return [
    draft(input.now, {
      id: 'methodology-unstable-findings',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: unstable.length / findings.length > 0.5 ? 'major' : 'minor',
      objection: `${unstable.length} of ${findings.length} findings are unstable: they hold in some seeded runs and not in others.`,
      basis: [
        `Unstable findings: ${unstable.length} of ${findings.length}.`,
        ...unstable.slice(0, 3).map((finding) => `${finding.id}: ${finding.statement}`),
      ],
      impact:
        'If this stands, much of the finding list could change on another set of runs; rely only on the repeatable findings and re-run with more seeds.',
    }),
  ];
}

function crossCheck(input: Resolved): Critique[] {
  const check = input.analysis.crossCheck;
  if (check === null) {
    return [
      draft(input.now, {
        id: 'methodology-no-cross-check',
        role: ROLE,
        target: whole(input.analysis.id),
        severity: 'minor',
        objection:
          'No deeper run was compared with the repeated runs, so nothing checks whether a different engine agrees with these results.',
        basis: ['Cross-check recorded: none.'],
        impact:
          'If this stands, the ensemble has only been checked against itself, and a deeper run could disagree with it.',
      }),
    ];
  }
  if (check.withinEnsembleRange !== false) return [];
  return [
    draft(input.now, {
      id: 'methodology-cross-check-disagrees',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'major',
      objection:
        'A deeper run of the same project does not agree with the repeated runs: its overall stance lies outside the range they span.',
      basis: [
        `Deeper run overall stance: ${check.primaryStanceMean === null ? 'not recorded' : signed(check.primaryStanceMean)}.`,
        'Within the range of the repeated runs: no.',
        check.note,
      ],
      impact:
        'If this stands, the repeated runs and the deeper run tell different stories, and the findings should be read as unsettled until the difference is explained.',
    }),
  ];
}

function wideIntervals(input: Resolved): Critique[] {
  const wide = input.analysis.findings.filter(
    (finding) =>
      finding.actorId === null && finding.interval.hi - finding.interval.lo > WIDE_INTERVAL,
  );
  const [first] = wide;
  if (!first) return [];
  return [
    draft(input.now, {
      id: 'methodology-wide-intervals',
      role: ROLE,
      target: { kind: 'finding', id: first.id },
      severity: wide.some((finding) => finding.interval.lo < 0.5) ? 'major' : 'minor',
      objection: `${plural(wide.length, 'headline finding')} ${wide.length === 1 ? 'has' : 'have'} a wide 95% interval for how often ${wide.length === 1 ? 'it holds' : 'they hold'}, so how repeatable ${wide.length === 1 ? 'it is' : 'they are'} is poorly pinned down.`,
      basis: wide
        .slice(0, 4)
        .map(
          (finding) =>
            `${finding.id}: holds in ${finding.holdsIn} of ${finding.of} runs; 95% interval ${fixed(finding.interval.lo)} to ${fixed(finding.interval.hi)}.`,
        ),
      impact:
        'If this stands, the headline could be weaker or stronger than it looks; add runs to narrow the interval before leaning on it.',
    }),
  ];
}

export const methodologyCritic: RoleCritic = (input) => [
  ...changeCannotMove(input),
  ...fewRuns(input),
  ...rulesOnly(input),
  ...modelRepeats(input),
  ...manyUnstable(input),
  ...crossCheck(input),
  ...wideIntervals(input),
];
