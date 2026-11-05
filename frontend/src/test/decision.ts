import type { z } from 'zod';
import {
  DECISION_STATUS_INFO,
  LENS_INFO,
  SCOPE_DOMAIN_WORDS,
  SCOPE_NOTICE,
  decisionCanvasSchema,
  type DecisionCanvas,
  type DecisionReadiness,
  type DecisionScope,
  type DecisionStatus,
  type DecisionView,
  type EpistemicLabel,
  type HighStakesDomain,
  type LensId,
} from '../../../shared/decision';

// A decision canvas as the route answers with it, for the tests of the page. It is parsed by the shared schema, so
// that a fixture that no longer matches the contract fails here and not in a screenshot. Two options (“No change” and
// “Proposed change”), thirty seeded runs of each, nothing about constraints reviewed, no counterfactual view run: the
// status is a conditional option, with the conditions that makes it one. The other statuses are made from it.

type Raw = z.input<typeof decisionCanvasSchema>;

const say = (text: string, label: EpistemicLabel, basis?: string) => ({ text, label, basis });
const part = (items: ReturnType<typeof say>[] = [], missing: string | null = null) => ({
  items,
  missing,
});

const lens = (
  id: LensId,
  standing: { baseline: 'leads' | 'level' | 'behind'; proposed: 'leads' | 'level' | 'behind' },
  values: { baseline: number; proposed: number },
): Raw['lenses'][number] => {
  const info = LENS_INFO[id];
  const clear = standing.baseline !== 'level';
  return {
    id,
    name: info.name,
    question: info.question,
    measure: info.measure,
    direction: info.direction,
    computable: true,
    note: null,
    results: [
      {
        alternativeId: 'baseline',
        value: values.baseline,
        low: 0,
        high: 0.2,
        runs: 30,
        standing: standing.baseline,
        detail: null,
      },
      {
        alternativeId: 'proposed-change',
        value: values.proposed,
        low: 0.03,
        high: 0.3,
        runs: 30,
        standing: standing.proposed,
        detail: null,
      },
    ],
    leaderId: clear ? 'baseline' : null,
    levelIds: clear ? [] : ['baseline', 'proposed-change'],
    margin: clear ? Math.abs(values.proposed - values.baseline) : null,
    verdict: clear ? 'clear-leader' : 'tie',
  };
};

export const constraintRow = (
  overrides: Partial<Raw['constraints']['hard'][number]> = {},
): Raw['constraints']['hard'][number] => ({
  id: 'constraint-budget',
  statement: 'The spend stays inside the budget the board approved.',
  category: 'budget',
  hardness: 'hard',
  source: 'From your question',
  label: 'assumption',
  validation: 'unvalidated',
  enforcement: 'enforced',
  inComparison: 'applied',
  effects: [],
  provisional: true,
  violatedBy: [],
  ...overrides,
});

const base = (): Raw => ({
  version: 1,
  notice: 'Explore scenarios, not predictions.',
  question: {
    asked:
      'How might different users react if this online store changes its delivery fees, free-delivery threshold and checkout flow?',
    decision: say(
      'The online store changes its delivery fees, its free-delivery threshold and its checkout flow.',
      'assumption',
      'question',
    ),
    baseline: say(
      'Nothing changes: the declared starting assumptions only. Intensity 0: no change lands.',
      'assumption',
      'variant:baseline',
    ),
    system: '',
    horizon: null,
    geography: null,
    successWording: null,
  },
  status: {
    status: 'conditional-option',
    rule: 'conditional',
    label: DECISION_STATUS_INFO['conditional-option'].label,
    meaning: DECISION_STATUS_INFO['conditional-option'].meaning,
    headline:
      '“No change” is ahead on “Least resistance overall”, on conditions. No constraints were reviewed for this decision, so the answer does not say what limits it.',
    why: [
      'On “Least resistance overall”: clearly ahead.',
      'On “Broadest support among key actors”: level with the best.',
    ],
    conditions: [
      'No constraints were reviewed for this decision, so the answer does not say what limits it.',
      'No counterfactual view was run against it, so no change to the situation was tried to see whether the result holds.',
    ],
  },
  answer: {
    headline: say(
      '“No change” is ahead on “Least resistance overall”, on conditions. No constraints were reviewed for this decision, so the answer does not say what limits it.',
      'recommendation',
      'status:conditional-option',
    ),
    preferredAlternativeId: 'baseline',
    recommendation: {
      kind: 'keep-no-change',
      what: say(
        'Keep “No change”: on the lenses Swarm computed, no alternative came out ahead of it, on the conditions listed. Do not change course until the checks below are done and a named approver agrees.',
        'recommendation',
        'status:conditional-option',
      ),
      forWhom: part([
        say(
          'It lands most on “Employees”: in the simulation this role moves toward resistance.',
          'simulation-event',
          'run:actor-shift',
        ),
      ]),
      assumptions: part([
        say(
          'How strongly and when the change lands was set by Swarm as a default; the simulation did not measure it.',
          'assumption',
          'variant:strength',
        ),
      ]),
      constraints: part([
        say(
          'No constraints were reviewed for this decision, so what limits it is not stated.',
          'validation-requirement',
          'gate:none',
        ),
      ]),
      supportingEvidence: part([
        say(
          '4 source documents attached: 4 supplied by a person, 0 retrieved from public pages by this server and 0 supplied as historical material.',
          'fact',
          'record:documents',
        ),
        say(
          'On “Least resistance overall” “No change” was clearly ahead of the other options across the seeded runs of the simulation.',
          'simulation-event',
          'lens:overall-resistance',
        ),
      ]),
      weakeningEvidence: part(
        [],
        'No evidence that weakens it was found. That does not show that none exists.',
      ),
      invalidatedBy: part([
        say(
          'A real person in the role “Regulators” says no when asked directly.',
          'validation-requirement',
          'stop-holder-regulators',
        ),
      ]),
      testNext: part([
        say(
          'Check with someone who holds the role “Regulators” what they would need to see.',
          'validation-requirement',
          'val-stakeholder-regulators',
        ),
      ]),
      reversibility: {
        value: 'unknown',
        statement: say(
          'Whether the choice can be reversed is unknown: nothing in the project says so. Treat the first step as hard to undo until it is known.',
          'validation-requirement',
          'reversibility:unknown',
        ),
      },
      approval: part([
        say(
          'A named approver agrees to act: a real person who holds the decision.',
          'validation-requirement',
          'approve-named',
        ),
      ]),
      missing: ['weakeningEvidence', 'reversibility'],
    },
  },
  alternatives: [
    {
      id: 'baseline',
      label: 'No change',
      kind: 'baseline',
      verdict: 'preferred',
      why: 'Clearly ahead on “Least resistance overall”.',
      violatedConstraintIds: [],
      violationConfirmed: null,
      standing: {
        'overall-resistance': 'leads',
        'key-actor-support': 'level',
        'decision-maker-resistance': 'level',
        'worst-affected-downside': 'leads',
      },
      runs: 30,
    },
    {
      id: 'proposed-change',
      label: 'Proposed change',
      kind: 'alternative',
      verdict: 'viable',
      why: 'Level with the best on “Broadest support among key actors”.',
      violatedConstraintIds: [],
      violationConfirmed: null,
      standing: {
        'overall-resistance': 'behind',
        'key-actor-support': 'level',
        'decision-maker-resistance': 'level',
        'worst-affected-downside': 'behind',
      },
      runs: 30,
    },
  ],
  lenses: [
    lens(
      'overall-resistance',
      { baseline: 'leads', proposed: 'behind' },
      { baseline: 0.0023, proposed: 0.0649 },
    ),
    lens(
      'key-actor-support',
      { baseline: 'level', proposed: 'level' },
      { baseline: 0, proposed: 0 },
    ),
    lens(
      'decision-maker-resistance',
      { baseline: 'level', proposed: 'level' },
      { baseline: 0, proposed: 0 },
    ),
    lens(
      'worst-affected-downside',
      { baseline: 'leads', proposed: 'behind' },
      { baseline: 0.03, proposed: 0.5 },
    ),
  ],
  lensAgreement: {
    state: 'agree',
    statement:
      '“No change” is clearly ahead on “Least resistance overall” and “Smallest downside for the worst-affected group”; on the other lenses it cannot be told apart from another option.',
  },
  futures: {
    supported: true,
    note: 'Each future is a simulated pattern over 30 or more seeded runs of that option, and “held in” counts runs. They are scenarios to examine, not forecasts, and none is a probability.',
    items: [
      {
        alternativeId: 'baseline',
        label: 'No change',
        kind: 'baseline',
        statement: say(
          'Under “No change” the largest group of simulated members ended up waiting and seeing, in 30 of 30 seeded runs.',
          'scenario-possibility',
          'run:responses',
        ),
        dominant: 'neutral',
        shares: { favourable: 0.1679, neutral: 0.6631, defensive: 0.1667, adverse: 0.0023 },
        adverseRange: { low: 0, high: 0.0166 },
        heldIn: 30,
        of: 30,
        repeatability: 'repeatable',
        standing: 'leads',
      },
      {
        alternativeId: 'proposed-change',
        label: 'Proposed change',
        kind: 'alternative',
        statement: say(
          'Under “Proposed change” the largest group of simulated members ended up waiting and seeing, in 30 of 30 seeded runs.',
          'scenario-possibility',
          'run:responses',
        ),
        dominant: 'neutral',
        shares: { favourable: 0.153, neutral: 0.559, defensive: 0.2231, adverse: 0.0649 },
        adverseRange: { low: 0.03, high: 0.1167 },
        heldIn: 30,
        of: 30,
        repeatability: 'repeatable',
        standing: 'behind',
      },
    ],
  },
  drivers: [
    {
      id: 'actor-employees',
      kind: 'actor',
      statement: say(
        '“Employees” moved the most in the simulation: toward resistance compared with no change.',
        'simulation-event',
        'run:actor-shift',
      ),
      effect: null,
      flipsAnswer: false,
    },
  ],
  constraints: {
    gate: 'none',
    gateSummary: 'No constraints were reviewed.',
    comparisonStatus: 'none',
    provisional: false,
    provisionalLabel: null,
    reviewed: false,
    hard: [],
    soft: [],
    missing: [],
    notModelled: [],
    note: 'No constraints were reviewed for this decision, so the picture does not say what limits it.',
    origin: {
      source: 'none',
      label: 'No constraints were proposed',
      detail:
        'The constraints step was not run, so the model was never asked to propose any. Open the Map, choose Constraints, and ask the model to read them.',
    },
  },
  actors: {
    focusAlternativeId: 'proposed-change',
    focusLabel: 'Proposed change',
    baselineLabel: 'No change',
    items: [
      actor(
        'employees',
        'Employees',
        'operations',
        'Operations: Carries out or supports the change day to day',
        'adverse',
        0.47,
      ),
      actor(
        'delivery-partners',
        'Delivery partners',
        'partner',
        'Partner: Depends on, or is relied on by, the party making the change',
        'defensive',
        0.36,
      ),
      actor(
        'regulators',
        'Regulators',
        'regulator',
        'Regulator: Sets or enforces rules that the change has to meet',
        'neutral',
        0,
        'can-block',
      ),
    ],
    note: 'Roles are simulated: Swarm made them up from the question and the sources, and what they do here is what the simulation does under its assumptions, not what any real person would do.',
    origin: {
      source: 'rules',
      label: 'Participants read from the text by rules',
      detail:
        'No model was used: Swarm read the sources for role words and quoted the sentence for each.',
    },
  },
  changes: {
    counterfactuals: {
      available: false,
      current: false,
      note: 'No counterfactual view has been run, so no change to the situation was tried to see whether the result holds. Run them from the constraints.',
      views: [],
    },
    assumptions: [],
    sensitivity: {
      tested: 12,
      sensitive: 0,
      robust: 10,
      inconclusive: 2,
      note: 'Each row moves one assumption of the proposed change on the same seeds and reports how far the simulated share moved.',
    },
  },
  validation: {
    items: [
      {
        id: 'val-stakeholder-regulators',
        kind: 'stakeholder',
        priority: 'high',
        source: 'stakeholder',
        what: 'Check with someone who holds the role “Regulators” what they would need to see.',
        why: 'The role has real weight in the simulation and its response is uncertain, so what the simulation shows for it is a reading and not a finding.',
        how: 'Speak with a real person in that role, or review how people in it have responded to comparable changes. Swarm does not contact anyone.',
        label: 'validation-requirement',
        refs: ['regulators'],
      },
      {
        id: 'val-stakeholder-advisers',
        kind: 'stakeholder',
        priority: 'medium',
        source: 'stakeholder',
        what: 'Check with someone who holds the role “Advisers” what they would need to see.',
        why: 'The role has real weight in the simulation and its response is uncertain, so what the simulation shows for it is a reading and not a finding.',
        how: 'Speak with a real person in that role, or review how people in it have responded to comparable changes. Swarm does not contact anyone.',
        label: 'validation-requirement',
        refs: ['advisers'],
      },
    ],
    stopConditions: [
      {
        id: 'stop-holder-regulators',
        when: 'A real person in the role “Regulators” says no when asked directly.',
        then: 'Stop and rethink the option or the plan: a simulation cannot overrule someone who can decide or block.',
        basis:
          'The role can decide, approve or block, and its simulated response is only a reading.',
        label: 'validation-requirement',
      },
    ],
    note: 'Worked out by rules from what is missing, unconfirmed or open. Each item is something to check in the real world; Swarm does not do it for you.',
  },
  evidence: {
    level: 'adequate',
    reasons: [],
    documents: { total: 4, supplied: 4, retrieved: 0, historical: 0 },
    actors: { total: 15, supported: 15, unsupported: [] },
    conflicts: null,
    ledger: { assessed: false, level: null, reasons: [] },
    research: null,
    missing: [],
    statements: [
      say(
        '4 source documents attached: 4 supplied by a person, 0 retrieved from public pages by this server and 0 supplied as historical material.',
        'fact',
        'record:documents',
      ),
    ],
  },
  uncertainty: {
    runsPerOption: 30,
    fidelity: 'Rules: outcomes follow from the declared assumptions',
    reasons: [
      say(
        '30 seeded runs per option, from base seed 42. Run-to-run variation is what the spread shows.',
        'fact',
        'record:runs',
      ),
      say('Rules: outcomes follow from the declared assumptions.', 'assumption', 'fidelity'),
    ],
    note: 'These are the named limits of what the simulation can say. None is a probability or a confidence level.',
  },
  reversibility: {
    value: 'unknown',
    statement: say(
      'Whether the choice can be reversed is unknown: nothing in the project says so. Treat the first step as hard to undo until it is known.',
      'validation-requirement',
      'reversibility:unknown',
    ),
  },
  timing: {
    horizon: null,
    lands: say(
      'In the simulation the change lands in round 2 of 12. A round is not a fixed length of time.',
      'assumption',
      'variant:round',
    ),
    constraints: [],
  },
  risks: [
    say(
      'Under “Proposed change” compared with “No change”, “Employees” ended up looking for an alternative or resisting more often in the simulation: 0 to 47 in 100 of its simulated members.',
      'simulation-event',
      'run:group-shift',
    ),
  ],
  opportunities: [],
  interventions: [
    {
      alternativeId: 'proposed-change',
      label: 'Proposed change',
      changes: [],
      setting: say(
        'In the simulation it lands in round 2 with a strength of 0.70, a default Swarm set. Neither was measured.',
        'assumption',
        'variant:system',
      ),
    },
  ],
  noRegret: {
    moves: [],
    note: 'Nothing could be checked against the counterfactual views, because none that still describes the project was run. No move is called a no-regret move without them.',
  },
  critic: {
    reviewed: true,
    current: true,
    open: 1,
    blockingOpen: 0,
    note: 'The independent review raised 1 objection; its most serious are shown.',
    challenges: [
      {
        id: 'adversarial-unstable-majority',
        role: 'adversarial',
        roleLabel: 'Adversarial reviewer',
        severity: 'minor',
        status: 'open',
        objection: say(
          'The finding that the largest group waits and sees holds in 18 of 30 seeded runs and does not hold in the other 12.',
          'validation-requirement',
          'critique-origin:rules',
        ),
        impact: 'If this stands, the statement cannot carry a decision on its own.',
        requestedAction: null,
      },
    ],
  },
  approvals: [
    {
      id: 'approve-actors',
      stage: 'before-simulation',
      text: 'A person reviewed and approved the stakeholders and the simulated actors before the simulation.',
      state: 'done',
    },
    {
      id: 'approve-named',
      stage: 'before-acting',
      text: 'A named approver agrees to act: a real person who holds the decision.',
      state: 'open',
    },
  ],
  scope: {
    notice: null,
    domains: [],
    aboutIndividual: false,
    basis: [],
    exploration: null,
  },
  freshness: {
    analysisId: 'analysis-1',
    completedAt: '2026-02-01T10:00:00.000Z',
    stale: false,
    changedSince: [],
    newerRunning: false,
    inputRevisions: { scenario: 0, stakeholders: 2, actors: 1 },
  },
  notes: [],
  withheld: 0,
});

function actor(
  id: string,
  name: string,
  category: Raw['actors']['items'][number]['category'],
  role: string,
  alignment: 'favourable' | 'neutral' | 'defensive' | 'adverse',
  change: number,
  position: 'decides' | 'approves' | 'can-block' | 'advises' | 'none' = 'none',
): Raw['actors']['items'][number] {
  return {
    actorId: id,
    name,
    kind: 'cohort',
    category,
    role,
    synthetic: true,
    influence: 'medium',
    position,
    alignment,
    stance: -change,
    stanceChange: -change,
    adverseShare: Math.max(0, change),
    adverseChange: change,
    moves: change > 0.05 ? 'toward-resistance' : 'little',
    directionBasis: say(
      'Which way the change lands on this role rests on a cited source passage, for its direction only; its size is a default.',
      'source-claim',
      'trait-origin:evidence',
    ),
    uncertainty: 'high',
    cited: true,
    plausibleActions: [],
  };
}

/** The canvas of a conditional option: one option ahead on the headline lens, and conditions it holds under. */
export function canvasFixture(patch: (canvas: Raw) => void = () => undefined): DecisionCanvas {
  const raw = base();
  patch(raw);
  return decisionCanvasSchema.parse(raw);
}

/** One counterfactual view, as the server reads it from a run on the same seeds. */
const counterfactualView = (
  id: Raw['changes']['counterfactuals']['views'][number]['id'],
  label: string,
  delta: number,
  reverses: boolean,
): Raw['changes']['counterfactuals']['views'][number] => ({
  id,
  label,
  change: `${label}, all else as run.`,
  applicable: true,
  deltaVsBase: delta,
  standardError: 0.01,
  classification: Math.abs(delta) >= 0.05 ? 'material' : 'negligible',
  driver: 'The constraint was a driver of the simulated resistance.',
  couldChangeAnswer: reverses,
  statement: say(
    `${label}: the simulated share resisting moved by ${Math.round(delta * 100)} in 100 on the same seeds.`,
    'simulation-event',
    'run:counterfactual',
  ),
});

const COUNTERFACTUAL_NOTE =
  'Each view takes one constraint away or changes it, on the same seeds. A view that could reverse the answer is marked.';

/** A canvas with every part full: what a project with its constraints reviewed, views run and a review made looks like. */
export function richFixture(): DecisionCanvas {
  const view = counterfactualView;
  const assumption = (
    id: string,
    text: string,
    shift: number,
    flipsAnswer: boolean,
  ): Raw['changes']['assumptions'][number] => ({
    id,
    statement: say(text, 'assumption', 'sensitivity'),
    origin: 'system-assumption',
    classification: flipsAnswer ? 'assumption-sensitive' : 'robust',
    shift,
    standardError: 0.01,
    flipsAnswer,
    evidenced: false,
  });
  const check = (
    id: string,
    priority: 'high' | 'medium' | 'low',
    what: string,
  ): Raw['validation']['items'][number] => ({
    id,
    kind: 'constraint',
    priority,
    source: 'unvalidated-constraint',
    what,
    why: 'Nobody has confirmed it, so the result rests on it provisionally.',
    how: 'Ask the person who owns the budget to confirm or correct it. Swarm does not contact anyone.',
    label: 'validation-requirement',
    refs: [],
  });
  return canvasFixture((raw) => {
    raw.status.headline =
      '“Proposed change” is ahead on “Least resistance overall”, on conditions. It could stop leading if the budget constraint is taken away.';
    raw.status.conditions = [
      'It could stop leading if the budget constraint is taken away.',
      'The constraints are provisional: some are not confirmed.',
      'On “Broadest support among key actors” it cannot be told apart from another option.',
    ];
    raw.answer.headline = say(raw.status.headline, 'recommendation', 'status:conditional-option');
    raw.constraints = {
      gate: 'provisional',
      gateSummary:
        'One hard constraint is not confirmed, so the comparison ran under it provisionally.',
      comparisonStatus: 'provisional',
      provisional: true,
      provisionalLabel: 'The answer rests on a hard constraint that nobody has confirmed.',
      reviewed: true,
      hard: [
        constraintRow({ id: 'budget', provisional: true }),
        constraintRow({
          id: 'staffing',
          category: 'staffing',
          statement: 'No more than two people are taken off their current work.',
          validation: 'confirmed',
          provisional: false,
          label: 'fact',
          source: 'From evidence',
        }),
        constraintRow({
          id: 'regulation',
          category: 'regulatory',
          statement: 'The change is approved by the regulator before it starts.',
          validation: 'confirmed',
          provisional: false,
          inComparison: 'read-only',
          enforcement: 'read-only',
          source: 'From evidence',
        }),
      ],
      soft: [
        constraintRow({
          id: 'timing',
          category: 'time',
          hardness: 'soft',
          statement: 'The first step is done within a quarter.',
          provisional: false,
          validation: 'assumed',
        }),
        constraintRow({
          id: 'tone',
          category: 'reputational',
          hardness: 'soft',
          statement: 'The announcement does not criticise the previous approach.',
          provisional: false,
          validation: 'assumed',
        }),
      ],
      missing: ['Whether the staffing limit applies to contractors is not stated.'],
      notModelled: ['The regulator’s approval was read by the simulation, not run.'],
      note: 'Five constraints, one of them not confirmed.',
      origin: {
        source: 'model',
        label: 'Constraints proposed by a model',
        detail:
          'The model gpt-5-mini read your sources, and so did the rules. A person has not reviewed them yet.',
      },
    };
    raw.actors.items = [
      actor(
        'employees',
        'Employees',
        'operations',
        'Operations: Carries out or supports the change day to day',
        'adverse',
        0.47,
      ),
      actor(
        'regulators',
        'Regulators',
        'regulator',
        'Regulator: Sets or enforces rules that the change has to meet',
        'neutral',
        0.01,
        'can-block',
      ),
      actor(
        'delivery-partners',
        'Delivery partners',
        'partner',
        'Partner: Depends on, or is relied on by, the party making the change',
        'defensive',
        0.36,
      ),
      actor(
        'board',
        'Board',
        'governance',
        'Governance: Approves or oversees the decision',
        'favourable',
        -0.12,
        'approves',
      ),
      actor(
        'advisers',
        'Advisers',
        'influencer',
        'Influencer: Can change how others see and respond to the change',
        'neutral',
        0.02,
        'advises',
      ),
      actor(
        'buyers',
        'Buyers',
        'end-user',
        'End user: Uses or experiences what the change alters',
        'neutral',
        0.02,
      ),
    ];
    raw.changes.counterfactuals = {
      available: true,
      current: true,
      note: COUNTERFACTUAL_NOTE,
      views: [
        view('without-budget', 'Without the budget constraint', 0.12, true),
        view('delayed-implementation', 'Implementation delayed one quarter', -0.04, false),
        view('stronger-regulation', 'Stronger regulation', 0.07, false),
        view('lower-adoption', 'Lower adoption', 0.02, false),
      ],
    };
    raw.changes.assumptions = [
      assumption(
        'strength',
        'The change lands with a strength of 0.70, a default Swarm set.',
        0.18,
        true,
      ),
      assumption('round', 'The change lands in round 2.', 0.03, false),
    ];
    raw.drivers = [
      ...raw.drivers,
      {
        id: 'constraint-budget',
        kind: 'constraint',
        statement: say(
          'Taking the budget constraint away moved the simulated share resisting by 12 in 100.',
          'simulation-event',
          'run:counterfactual',
        ),
        effect: 0.12,
        flipsAnswer: true,
      },
      {
        id: 'assumption-strength',
        kind: 'assumption',
        statement: say(
          'The strength with which the change lands, a default Swarm set, moved the share by 18 in 100.',
          'simulation-event',
          'sensitivity',
        ),
        effect: 0.18,
        flipsAnswer: true,
      },
    ];
    raw.validation.items = [
      check(
        'val-budget',
        'high',
        'Confirm with the budget owner that the spend stays inside the approved budget.',
      ),
      check(
        'val-contractors',
        'high',
        'Confirm whether the staffing limit applies to contractors.',
      ),
      check('val-timing', 'medium', 'Confirm that the first step can be done within a quarter.'),
      check('val-tone', 'medium', 'Confirm the announcement wording with the communications lead.'),
      check('val-regulator', 'low', 'Ask the regulator what they would need to see.'),
    ];
    raw.validation.stopConditions = [
      ...raw.validation.stopConditions,
      {
        id: 'stop-budget',
        when: 'The budget owner says the spend is not approved.',
        then: 'Stop: the answer rests on it.',
        basis: 'A hard constraint that nobody had confirmed.',
        label: 'validation-requirement',
      },
      {
        id: 'stop-new',
        when: 'Something the simulation did not include appears.',
        then: 'Pause and run the comparison again with it included.',
        basis: 'The comparison only knows what the project held when it was run.',
        label: 'validation-requirement',
      },
    ];
    raw.answer.recommendation.what = say(
      'Take “Proposed change” forward, only on the conditions listed, in steps that can be checked, once the high-priority checks below are done and a named approver agrees.',
      'recommendation',
      'status:conditional-option',
    );
    raw.answer.preferredAlternativeId = 'proposed-change';
    raw.answer.recommendation.kind = 'proceed';
  });
}

/** A canvas that lands on each of the six statuses, with only what differs in each. */
export function statusFixture(status: DecisionStatus): DecisionCanvas {
  const info = DECISION_STATUS_INFO[status];
  return canvasFixture((canvas) => {
    canvas.status.status = status;
    canvas.status.label = info.label;
    canvas.status.meaning = info.meaning;
    switch (status) {
      case 'robust-option':
        canvas.status.rule = 'robust';
        canvas.status.headline =
          '“Proposed change” is ahead on every lens Swarm computed, and nothing it tried reverses that. It is a result of the simulation under stated assumptions.';
        canvas.status.conditions = [];
        canvas.status.why = [
          'On “Least resistance overall”: clearly ahead.',
          'No counterfactual view or sensitive assumption reverses it.',
        ];
        canvas.changes.counterfactuals = {
          available: true,
          current: true,
          note: COUNTERFACTUAL_NOTE,
          views: [
            counterfactualView(
              'delayed-implementation',
              'Implementation delayed one quarter',
              -0.01,
              false,
            ),
          ],
        };
        canvas.constraints = {
          gate: 'clear',
          gateSummary: 'Every hard constraint is confirmed and none is broken.',
          comparisonStatus: 'clear',
          provisional: false,
          provisionalLabel: null,
          reviewed: true,
          hard: [
            constraintRow({
              provisional: false,
              validation: 'confirmed',
              label: 'fact',
              source: 'From evidence',
            }),
          ],
          soft: [],
          missing: [],
          notModelled: [],
          note: 'One constraint, confirmed.',
          origin: {
            source: 'rules',
            label: 'Constraints read by rules',
            detail:
              'No model was used: rules read your words, your sources and who is involved. A person has been through them.',
          },
        };
        canvas.answer.recommendation.constraints = {
          items: [
            say(
              'The spend stays inside the budget the board approved: confirmed.',
              'fact',
              'constraint:constraint-budget',
            ),
          ],
          missing: null,
        };
        canvas.answer.preferredAlternativeId = 'proposed-change';
        canvas.answer.recommendation.kind = 'proceed';
        canvas.answer.recommendation.what = say(
          'Take “Proposed change” forward in steps that can be checked, once the high-priority checks below are done and a named approver agrees.',
          'recommendation',
          'status:robust-option',
        );
        break;
      case 'multiple-plausible-options':
        canvas.status.rule = 'no-clear-leader';
        canvas.status.headline =
          'The simulation cannot tell “No change” and “Proposed change” apart, so Swarm does not pick one.';
        canvas.status.conditions = [];
        canvas.status.why = [
          'On “Least resistance overall”, “No change” and “Proposed change” cannot be told apart within run-to-run variation.',
        ];
        canvas.answer.preferredAlternativeId = null;
        canvas.answer.recommendation.kind = 'hold';
        canvas.answer.recommendation.what = say(
          'Do not choose between “No change” and “Proposed change” on this result. Test what separates them first, in a small and reversible way.',
          'recommendation',
          'status:multiple-plausible-options',
        );
        break;
      case 'insufficient-evidence':
        canvas.status.rule = 'evidence-insufficient';
        canvas.status.headline =
          'There is not enough evidence behind the comparison to recommend an option. No actor has a cited supporting passage.';
        canvas.status.conditions = [];
        canvas.status.why = ['No actor has a cited supporting passage.'];
        canvas.answer.preferredAlternativeId = null;
        canvas.answer.recommendation.kind = 'gather-evidence';
        canvas.evidence.level = 'insufficient';
        canvas.evidence.reasons = ['No actor has a cited supporting passage.'];
        canvas.evidence.actors = {
          total: 15,
          supported: 0,
          unsupported: ['Employees', 'Delivery partners', 'Regulators'],
        };
        canvas.answer.recommendation.what = say(
          'Do not act on this result. Gather the evidence listed below, then run the comparison again.',
          'recommendation',
          'status:insufficient-evidence',
        );
        break;
      case 'blocked-by-hard-constraint':
        canvas.status.rule = 'all-violate';
        canvas.status.headline =
          'Every alternative is ruled out by a confirmed hard constraint, so Swarm does not recommend one.';
        canvas.status.conditions = [];
        canvas.status.why = [
          '“Proposed change” is ruled out by “The spend stays inside the budget the board approved”.',
        ];
        canvas.answer.preferredAlternativeId = null;
        canvas.answer.recommendation.kind = 'resolve-constraint';
        canvas.constraints.gate = 'blocked';
        canvas.constraints.reviewed = true;
        canvas.constraints.hard = [
          constraintRow({
            provisional: false,
            validation: 'confirmed',
            label: 'fact',
            source: 'From evidence',
            violatedBy: ['baseline', 'proposed-change'],
          }),
        ];
        canvas.answer.recommendation.what = say(
          'Do not go past the hard constraint. Settle it first with its owner: confirm it, correct it or set it aside, then run the comparison again.',
          'recommendation',
          'status:blocked-by-hard-constraint',
        );
        break;
      case 'needs-human-decision':
        canvas.status.rule = 'value-tradeoff';
        canvas.status.headline =
          'The choice turns on a trade-off between lenses: “No change” and “Proposed change” each lead on a different one. A person has to weigh which matters more.';
        canvas.status.conditions = [];
        canvas.status.why = [
          '“No change” is clearly ahead on “Least resistance overall”.',
          '“Proposed change” is clearly ahead on “Broadest support among key actors”.',
        ];
        canvas.answer.preferredAlternativeId = null;
        canvas.answer.recommendation.kind = 'decide';
        canvas.answer.recommendation.what = say(
          'Take the choice to the decision owner with the trade-off in front of them: “No change” and “Proposed change” lead on different lenses.',
          'recommendation',
          'status:needs-human-decision',
        );
        break;
      case 'conditional-option':
        break;
    }
    // The sentence at the top of the page is the status's own.
    canvas.answer.headline = say(canvas.status.headline, 'recommendation', `status:${status}`);
  });
}

export const viewFixture = (canvas: DecisionCanvas = canvasFixture()): DecisionView => ({
  canvas,
  readiness: {
    state: 'ready',
    missing: [],
    next: null,
    status: canvas.status,
    scope: canvas.scope,
  },
  may: { run: true, export: true },
});

/** One cue for each matter, as the scope check words it in the basis. */
const CUE: Record<HighStakesDomain, string> = {
  employment: 'fire',
  credit: 'loan',
  legal: 'sue',
  medical: 'prescribe',
  safety: 'evacuation',
};

const listedWords = (words: string[]): string =>
  words.length < 3
    ? words.join(' and ')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** What the scope check finds in a question that touches a matter Swarm does not decide, and in one about a person. */
export function scopeFixture(
  kind: 'domain' | 'individual',
  domains: HighStakesDomain[] = ['employment'],
): DecisionScope {
  const basis = [
    ...domains.map((domain) => `${domain}: “${CUE[domain]}”`),
    ...(kind === 'individual' ? ['about one person: “this employee”'] : []),
  ];
  return {
    notice: SCOPE_NOTICE,
    domains,
    aboutIndividual: kind === 'individual',
    basis,
    exploration:
      kind === 'individual'
        ? {
            canTell: [
              say(
                'How the simulated roles responded in each option, under the assumptions the project states.',
                'simulation-event',
                'scope:can-tell',
              ),
              say(
                'Which of the stated assumptions and constraints the simulated result is most sensitive to.',
                'simulation-event',
                'scope:can-tell',
              ),
            ],
            cannotTell: [
              say(
                'What is right, fair or lawful for this person: the exploration knows nothing of their circumstances beyond the question.',
                'validation-requirement',
                'scope:cannot-tell',
              ),
              say(
                'How this person responds or what happens to them: a simulated role stands for a group and not for one person.',
                'validation-requirement',
                'scope:cannot-tell',
              ),
              say(
                'Whether a decision follows the rules and the process that apply: that is for the person who decides.',
                'validation-requirement',
                'scope:cannot-tell',
              ),
            ],
          }
        : null,
  };
}

/**
 * A canvas whose question touches a matter that Swarm does not decide. For a decision about one person the status is a
 * human decision by the first rule, no option is named, the options are shown and not ranked, and the next move is a
 * qualified person's; for a matter in general the canvas is whatever it was, with the notice and a stronger approval.
 */
export function scopedFixture(
  kind: 'domain' | 'individual',
  from: DecisionCanvas = canvasFixture(),
  domains: HighStakesDomain[] = ['employment'],
): DecisionCanvas {
  const scope = scopeFixture(kind, domains);
  const matters = listedWords(
    domains.map((domain) => SCOPE_DOMAIN_WORDS[domain].label.toLowerCase()),
  );
  const reviewers = listedWords(domains.map((domain) => SCOPE_DOMAIN_WORDS[domain].reviewer));
  const approval = {
    id: 'approve-qualified',
    stage: 'before-acting' as const,
    text:
      kind === 'individual'
        ? `A qualified person decides: ${reviewers}. Swarm does not make or recommend a decision about one person’s ${matters} situation, and a named approver agrees to act on it.`
        : `A qualified person reviews anything that touches ${matters} matters before it is acted on: ${reviewers}. Swarm does not make or recommend such decisions.`,
    state: 'open' as const,
  };
  const approvals = [...from.approvals.filter((point) => point.id !== 'approve-named'), approval];
  if (kind === 'domain') return decisionCanvasSchema.parse({ ...from, scope, approvals });

  const info = DECISION_STATUS_INFO['needs-human-decision'];
  const headline = `The question reads as a decision about one person’s ${matters} situation, so Swarm does not make or recommend it: a qualified person decides.`;
  return decisionCanvasSchema.parse({
    ...from,
    status: {
      ...from.status,
      status: 'needs-human-decision',
      rule: 'individual-decision',
      label: info.label,
      meaning: info.meaning,
      headline,
      why: [
        `Cues found in the question and its framing: ${scope.basis.join('; ')}.`,
        'What the simulation shows is still shown, as exploration and not as a recommendation.',
        'This is read from the words of the question by rules, so it can be mistaken in either direction.',
      ],
      conditions: [],
    },
    answer: {
      ...from.answer,
      headline: say(headline, 'recommendation', 'status:needs-human-decision'),
      preferredAlternativeId: null,
      recommendation: {
        ...from.answer.recommendation,
        kind: 'decide',
        what: say(
          'A qualified person decides this; here is what the exploration can and cannot tell them.',
          'recommendation',
          'status:needs-human-decision',
        ),
      },
    },
    alternatives: from.alternatives.map((option) =>
      option.verdict === 'blocked'
        ? option
        : {
            ...option,
            verdict: 'not-ranked',
            why: 'Shown as explored and not ranked: a decision about one person is for a qualified person.',
          },
    ),
    // With no answer named, no view, assumption or driver could reverse one.
    drivers: from.drivers.map((driver) => ({ ...driver, flipsAnswer: false })),
    changes: {
      ...from.changes,
      counterfactuals: {
        ...from.changes.counterfactuals,
        views: from.changes.counterfactuals.views.map((view) => ({
          ...view,
          couldChangeAnswer: null,
        })),
      },
      assumptions: from.changes.assumptions.map((row) => ({ ...row, flipsAnswer: false })),
    },
    // A decision about one person is a qualified person's: the check that comes before every other, and the stop.
    validation: {
      ...from.validation,
      items: [
        {
          id: 'val-scope-qualified-person',
          kind: 'stakeholder',
          priority: 'high',
          source: 'scope',
          what: `Have ${reviewers} decide this, with this view as one input.`,
          why: `The question reads as a decision about one person’s ${matters} situation. Swarm explores scenarios and does not make or recommend such decisions.`,
          how: 'Take the question to the person who is qualified and accountable for it, and tell them what the exploration can and cannot show. Swarm does not contact anyone.',
          label: 'validation-requirement',
          refs: [],
        },
        ...from.validation.items,
      ].slice(0, 12),
      stopConditions: [
        {
          id: 'stop-qualified-person',
          when: 'This view is used in place of the decision of a qualified person.',
          then: 'Stop and take the decision to the qualified person.',
          basis: 'Swarm does not make or recommend decisions about one person’s situation.',
          label: 'validation-requirement',
        },
        ...from.validation.stopConditions,
      ],
    },
    approvals,
    scope,
  });
}

export function emptyFixture(
  state: DecisionReadiness['state'] = 'no-analysis',
  next: DecisionReadiness['next'] = 'simulate',
  scope: DecisionScope | null = null,
): DecisionView {
  const missing =
    state === 'running'
      ? 'A comparison is running. The decision picture appears when it finishes.'
      : state === 'failed'
        ? 'The last comparison did not finish, so there is no result to read.'
        : 'No comparison has been run yet.';
  const individual = scope?.aboutIndividual
    ? scopedFixture('individual', canvasFixture(), scope.domains).status
    : null;
  return {
    canvas: null,
    readiness: {
      state,
      missing: [missing],
      next,
      status: individual ?? {
        ...canvasFixture().status,
        status: 'insufficient-evidence',
        rule: 'no-analysis',
        label: DECISION_STATUS_INFO['insufficient-evidence'].label,
        meaning: DECISION_STATUS_INFO['insufficient-evidence'].meaning,
        headline:
          'There is no finished comparison of options yet, so Swarm has nothing to recommend from.',
        why: [missing],
        conditions: [],
      },
      scope,
    },
    may: { run: true, export: true },
  };
}
