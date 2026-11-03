import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import {
  EPISTEMIC_LABELS,
  RECOMMENDATION_PARTS,
  decisionCanvasSchema,
  type DecisionCanvas,
  type Labelled,
} from '../../shared/decision.js';
import { scenarioFixture, stakeholderSetFixture } from '../../shared/lab-fixtures.js';
import type { Stakeholder } from '../../shared/stakeholders.js';
import { lintText } from '../src/brief/lint.js';
import { buildCanvas } from '../src/decision/build.js';
import { WITHHELD_TEXT } from '../src/decision/words.js';
import { constraintOf } from './support/constraint-fixtures.js';
import { decisionInputs } from './support/decision-world.js';
import {
  OPTIONS,
  citedActors,
  controlledInputs,
  counterfactualOf,
  counterfactualSet,
  critiqueOf,
  critiqueSet,
  sensitivityRow,
  type ControlledOptions,
  type OptionSpec,
} from './support/decision-fixtures.js';

const WINNER: OptionSpec[] = [
  OPTIONS.baseline(0.4, { favourable: 0.3 }),
  OPTIONS.proposed(0.2, { favourable: 0.6 }),
];
const CALM = [sensitivityRow('small-move', 0.01)];
const canvasOf = (options: OptionSpec[] = WINNER, config: ControlledOptions = {}): DecisionCanvas =>
  buildCanvas(controlledInputs(options, { sensitivity: CALM, ...config }));

/** Words that are a person’s, a source’s or an earlier step’s, shown as theirs and never as a sentence of ours. */
const THEIRS = [
  /^question\.(asked|system)$/u,
  /^question\.(decision|baseline|horizon|geography|successWording)\.text$/u,
  /^(alternatives|futures\.items|interventions)\.\d+\.label$/u,
  /^actors\.(focusLabel|baselineLabel)$/u,
  /^actors\.items\.\d+\.(name|role)$/u,
  /^constraints\.(hard|soft)\.\d+\.(statement|source|effects\.\d+)$/u,
  /^constraints\.notModelled\.\d+$/u,
  /^critic\.challenges\.\d+\.(objection\.text|impact|requestedAction)$/u,
  /^evidence\.(missing|actors\.unsupported|ledger\.reasons)\.\d+$/u,
  /^evidence\.research\.categories\.\d+\.label$/u,
  /^changes\.counterfactuals\.views\.\d+\.(label|change|driver)$/u,
  /^timing\.horizon\.text$/u,
  /^timing\.constraints\.\d+\.text$/u,
  /^uncertainty\.fidelity$/u,
  /^freshness\./u,
];

function* strings(value: unknown, path = ''): Generator<[string, string]> {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      yield* strings(item, path ? `${path}.${index}` : String(index));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      yield* strings(item, path ? `${path}.${key}` : key);
  }
}

const ours = (canvas: DecisionCanvas): [string, string][] =>
  [...strings(canvas)].filter(([path]) => !THEIRS.some((pattern) => pattern.test(path)));

function* statements(value: unknown): Generator<Labelled> {
  if (Array.isArray(value)) for (const item of value) yield* statements(item);
  else if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.text === 'string' && typeof candidate.label === 'string')
      yield candidate as unknown as Labelled;
    for (const item of Object.values(candidate)) yield* statements(item);
  }
}

describe('the canvas on the five worked examples, made by the real pipeline', () => {
  it.each(EXAMPLE_SCENARIOS.map((pack) => [pack.id, pack] as const))(
    '%s: valid, deterministic and honest',
    async (_id, pack) => {
      const inputs = await decisionInputs(pack);
      const canvas = buildCanvas(inputs);
      expect(decisionCanvasSchema.safeParse(canvas).success).toBe(true);
      expect(JSON.stringify(buildCanvas(inputs))).toBe(JSON.stringify(canvas));
      expect(canvas.withheld).toBe(0);
      expect(canvas.notice).toBe('Explore scenarios, not predictions.');
      for (const [path, text] of ours(canvas)) {
        expect(
          lintText(text).map((issue) => issue.rule),
          `${path}: ${text}`,
        ).toEqual([]);
        expect(claimsAgainst(text), `${path}: ${text}`).toEqual([]);
        expect(text, path).not.toBe(WITHHELD_TEXT);
      }
      expect(canvas.alternatives.length).toBeGreaterThanOrEqual(2);
      expect(canvas.lenses.map((lens) => lens.id)).toEqual([
        'overall-resistance',
        'key-actor-support',
        'decision-maker-resistance',
        'worst-affected-downside',
      ]);
      expect(canvas.actors.items.every((actor) => actor.synthetic)).toBe(true);
    },
    60_000,
  );
});

describe('every statement says what it is', () => {
  const rich = (): DecisionCanvas =>
    canvasOf(WINNER, {
      constraints: [
        constraintOf({ id: 'c-0001', statement: 'Spending on the change is capped.' }),
        constraintOf({
          id: 'c-0002',
          category: 'capacity',
          source: 'extracted',
          hardness: 'hard',
          statement: 'The team can take on one change at a time.',
          confidenceBasis: { kind: 'evidence-quote', note: '' },
          validation: 'confirmed',
        }),
        constraintOf({
          id: 'c-0003',
          category: 'time',
          source: 'inferred',
          statement: 'The change has to land before the review.',
          confidenceBasis: { kind: 'model-reading', note: '' },
          validation: 'assumed',
        }),
      ],
      sensitivity: [
        sensitivityRow('trust-down', 0.3),
        sensitivityRow('minor', 0.06, { assumptionOrigin: 'evidence' }),
        ...CALM,
      ],
      critiques: critiqueSet([
        critiqueOf({ severity: 'blocking' }),
        critiqueOf({ id: 'c2', origin: 'model', severity: 'major' }),
      ]),
    });

  it('gives every statement one of the eight labels, and only a record or a verified quote the label of a fact', () => {
    const canvas = rich();
    const all = [...statements(canvas)];
    expect(all.length).toBeGreaterThan(40);
    for (const statement of all) {
      expect(EPISTEMIC_LABELS).toContain(statement.label);
      if (statement.label === 'fact') {
        expect(statement.basis, statement.text).toMatch(/^(record:|constraint:)/u);
      }
    }
    const facts = all.filter((statement) => statement.label === 'fact');
    expect(facts.some((statement) => statement.basis?.startsWith('record:'))).toBe(true);
  });

  it('labels a constraint by what it was read from: a verified quote is a fact, an inferred reading is not', () => {
    const rows = [...rich().constraints.hard, ...rich().constraints.soft];
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('c-0002')?.label).toBe('fact');
    expect(byId.get('c-0003')?.label).toBe('model-inference');
    expect(byId.get('c-0001')?.label).toBe('assumption');
  });

  it('never lets a simulation result stand without saying that it is simulated', () => {
    for (const statement of statements(rich())) {
      if (statement.label === 'simulation-event' || statement.label === 'scenario-possibility') {
        expect(statement.text, statement.text).toMatch(/simulat/iu);
      }
    }
  });

  it('marks a model’s objection as a model inference and a rule’s as something to validate', () => {
    const labels = new Map(
      rich().critic.challenges.map((challenge) => [challenge.id, challenge.objection.label]),
    );
    expect(labels.get('critique-1')).toBe('validation-requirement');
    expect(labels.get('c2')).toBe('model-inference');
  });

  it('labels the direction of an actor’s impact by where it came from, so that a default is never shown as a source', () => {
    const canvas = rich();
    expect(canvas.actors.items.every((actor) => actor.directionBasis.label === 'assumption')).toBe(
      true,
    );
    const cited = canvasOf(WINNER, {
      actors: citedActors().map((actor) => ({
        ...actor,
        traits: { ...actor.traits, impact: { ...actor.traits.impact, origin: 'model' as const } },
      })),
    });
    expect(
      cited.actors.items.every((actor) => actor.directionBasis.label === 'model-inference'),
    ).toBe(true);
  });
});

describe('a person’s own words never become a sentence of ours', () => {
  it('keeps prediction words and figures in a question, an option and an actor inside quotation marks, so nothing is withheld', () => {
    const hostile = 'Will we lose 40% of customers? They will certainly leave.';
    const actors = citedActors().map((actor, index) =>
      index === 0 ? { ...actor, name: hostile } : actor,
    );
    const canvas = buildCanvas(
      controlledInputs(
        [
          OPTIONS.baseline(0.4, { favourable: 0.3, label: 'We will win everything' }),
          OPTIONS.proposed(0.2, { favourable: 0.6, label: hostile }),
        ],
        {
          actors,
          scenario: scenarioFixture({
            decision: hostile,
            baseline: 'It will stay as it is.',
            horizon: 'Within 90% of the year',
          }),
          sensitivity: CALM,
        },
      ),
    );
    expect(canvas.withheld).toBe(0);
    for (const [path, text] of ours(canvas)) {
      expect(
        lintText(text).map((issue) => issue.rule),
        `${path}: ${text}`,
      ).toEqual([]);
    }
    expect(canvas.question.decision.text).toBe(hostile);
    expect(canvas.alternatives.find((option) => option.id === 'proposed-change')?.label).toBe(
      hostile,
    );
    expect(canvas.status.headline).toContain(
      '“Will we lose 40% of customers? They will certainly leave”',
    );
  });
});

describe('the recommendation is complete, or says what is missing', () => {
  const cases: [string, OptionSpec[], ControlledOptions][] = [
    ['robust', WINNER, {}],
    ['multiple', [OPTIONS.baseline(0.3), OPTIONS.proposed(0.3)], {}],
    [
      'blocked',
      WINNER,
      {
        constraints: [
          constraintOf({
            id: 'c-0009',
            category: 'legal',
            hardness: 'hard',
            statement: 'A licence is needed.',
            validation: 'unvalidated',
          }),
        ],
      },
    ],
    [
      'insufficient',
      WINNER,
      { documents: [], actors: citedActors().map((actor) => ({ ...actor, evidence: [] })) },
    ],
  ];
  it.each(cases)(
    '%s: every part is there or named as missing, and “unknown” is said for reversibility',
    (_name, options, config) => {
      const card = canvasOf(options, config).answer.recommendation;
      for (const part of RECOMMENDATION_PARTS) {
        const value = card[part];
        expect(value.items.length > 0 || value.missing !== null, part).toBe(true);
        expect(value.items.length > 0 && value.missing !== null, part).toBe(false);
      }
      expect(card.missing).toEqual(
        RECOMMENDATION_PARTS.filter((part) => card[part].missing !== null),
      );
      expect(card.reversibility.value).toBe('unknown');
      expect(card.reversibility.statement.text).toMatch(/unknown/u);
      expect(card.approval.items.length).toBeGreaterThan(0);
      expect(card.what.label).toBe('recommendation');
    },
  );

  it('says who has to approve before acting, and that nothing is done by Swarm', () => {
    const canvas = canvasOf();
    const before = canvas.approvals.filter((point) => point.stage === 'before-acting');
    expect(before.map((point) => point.id)).toEqual(['approve-validation', 'approve-named']);
    expect(before.every((point) => point.state === 'open')).toBe(true);
    expect(
      canvas.approvals
        .filter((point) => point.stage === 'before-simulation')
        .map((point) => point.state),
    ).toEqual(['done', 'done']);
    expect(before[1]?.text).toMatch(/real person/u);
  });

  it('flags a decision that may touch employment, credit, legal, medical or safety matters, and asks for a qualified person', () => {
    const canvas = buildCanvas(
      controlledInputs(WINNER, {
        sensitivity: CALM,
        scenario: scenarioFixture({
          decision: 'Whether to change the treatment given to each patient',
        }),
      }),
    );
    expect(canvas.highStakes).toMatchObject({ flagged: true, domains: ['medical'] });
    expect(canvas.approvals.some((point) => point.id === 'approve-qualified')).toBe(true);
    expect(canvasOf().highStakes.flagged).toBe(false);
  });
});

describe('the validation plan and the stop conditions come from what is missing, and nothing else', () => {
  const sources = (canvas: DecisionCanvas): string[] => [
    ...new Set(canvas.validation.items.map((item) => item.source)),
  ];

  it('derives an item from each source: constraints, assumptions, evidence, roles, conflicts and objections', () => {
    const uncited = citedActors().map((actor) =>
      actor.id === 'regulator'
        ? { ...actor, evidence: [], uncertainty: { level: 'high' as const, reason: 'Fixture.' } }
        : actor,
    );
    const canvas = canvasOf(WINNER, {
      actors: uncited,
      constraints: [
        constraintOf({
          id: 'c-0001',
          category: 'capacity',
          hardness: 'hard',
          statement: 'One change at a time.',
          validation: 'assumed',
        }),
      ],
      sensitivity: [sensitivityRow('trust-down', 0.3)],
      scenario: scenarioFixture({ evidenceMissing: ['Measured response of the key group'] }),
      critiques: critiqueSet([
        critiqueOf({
          severity: 'blocking',
          role: 'assumption',
          requestedAction: 'Show where the figure comes from.',
        }),
      ]),
      ledger: {
        conflicts: [
          {
            id: 'k1',
            topic: 'the size of the fee',
            status: 'confirmed',
            left: {
              passageId: 'S1',
              documentId: 'd',
              documentName: 'a.md',
              start: 0,
              end: 1,
              quote: null,
              contentHash: 'h',
              role: 'supports',
            },
            right: {
              passageId: 'S2',
              documentId: 'd',
              documentName: 'a.md',
              start: 2,
              end: 3,
              quote: null,
              contentHash: 'h',
              role: 'contradicts',
            },
            leftValue: null,
            rightValue: null,
          },
        ],
        sufficiency: null,
      },
    });
    expect(sources(canvas)).toEqual(
      expect.arrayContaining([
        'unvalidated-constraint',
        'flipping-assumption',
        'missing-evidence',
        'stakeholder',
        'conflict',
        'critic',
      ]),
    );
    const kinds = new Set(canvas.validation.items.map((item) => item.kind));
    expect(kinds).toEqual(new Set(['constraint', 'assumption', 'evidence', 'stakeholder']));
    for (const item of canvas.validation.items) {
      expect(item.label).toBe('validation-requirement');
      expect(item.what.length).toBeGreaterThan(10);
      expect(item.why.length).toBeGreaterThan(10);
      expect(item.how.length).toBeGreaterThan(10);
    }
    const critic = canvas.validation.items.find((item) => item.source === 'critic');
    expect(critic).toMatchObject({ kind: 'assumption', priority: 'high' });
    expect(critic?.how).toBe('Show where the figure comes from.');
    // High-priority items come first, and the order does not depend on how the inputs were listed.
    const priorities = canvas.validation.items.map((item) => item.priority);
    expect(priorities).toEqual(
      [...priorities].sort(
        (a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b),
      ),
    );
    expect(canvas.validation.items.length).toBeLessThanOrEqual(12);
  });

  it('has no item for a hard constraint that a person confirmed, or for an assumption that is robust', () => {
    const canvas = canvasOf(WINNER, {
      constraints: [
        constraintOf({
          id: 'c-0001',
          category: 'capacity',
          hardness: 'hard',
          statement: 'One change at a time.',
          validation: 'confirmed',
        }),
      ],
    });
    expect(
      canvas.validation.items.filter((item) => item.source === 'unvalidated-constraint'),
    ).toEqual([]);
    expect(canvas.validation.items.filter((item) => item.source === 'flipping-assumption')).toEqual(
      [],
    );
  });

  it('always has stop conditions, and ties them to what the result rests on', () => {
    const canvas = canvasOf(WINNER, {
      constraints: [
        constraintOf({
          id: 'c-0001',
          category: 'capacity',
          hardness: 'hard',
          statement: 'One change at a time.',
          validation: 'unvalidated',
        }),
      ],
      sensitivity: [sensitivityRow('trust-down', 0.3)],
    });
    const when = canvas.validation.stopConditions.map((stop) => stop.when).join('\n');
    expect(when).toMatch(/One change at a time/u);
    expect(when).toMatch(/real measurement/u);
    expect(when).toMatch(/real person in the role/u);
    expect(when).toMatch(/first step turns out to be impossible to undo/u);
    expect(canvas.validation.stopConditions.length).toBeLessThanOrEqual(8);
  });
});

describe('what could change the result', () => {
  it('lists the seven counterfactual views as the constraints engineer made them, and says which could reverse the answer', () => {
    const canvas = canvasOf(WINNER, {
      counterfactuals: counterfactualSet([
        counterfactualOf('without-budget', 0.25),
        counterfactualOf('stronger-regulation', null),
        counterfactualOf('higher-capacity', 0.02, { classification: 'inconclusive' }),
      ]),
    });
    const views = canvas.changes.counterfactuals.views;
    expect(views.map((view) => [view.id, view.couldChangeAnswer])).toEqual([
      ['without-budget', true],
      ['stronger-regulation', null],
      ['higher-capacity', null],
    ]);
    expect(views[1]?.statement.label).toBe('validation-requirement');
    expect(views[0]?.statement.label).toBe('simulation-event');
  });

  it('does not count views that were made from an earlier project, and says so', () => {
    const canvas = canvasOf(WINNER, {
      counterfactuals: counterfactualSet([counterfactualOf('without-budget', 0.25)]),
      counterfactualsCurrent: false,
    });
    expect(canvas.changes.counterfactuals).toMatchObject({ available: true, current: false });
    expect(canvas.changes.counterfactuals.views[0]?.couldChangeAnswer).toBeNull();
    expect(canvas.status.conditions.join(' ')).not.toMatch(/could stop leading/u);
  });

  it('finds a move that holds under every option and every view, and says plainly when there is none', () => {
    const lands = canvasOf([
      OPTIONS.baseline({
        provider: 0.1,
        'rival-provider': 0.1,
        regulator: 0.1,
        subscribers: 0.1,
        resellers: 0.1,
      }),
      OPTIONS.proposed({
        provider: 0.1,
        'rival-provider': 0.1,
        regulator: 0.1,
        subscribers: 0.5,
        resellers: 0.1,
      }),
      OPTIONS.smaller({
        provider: 0.1,
        'rival-provider': 0.1,
        regulator: 0.1,
        subscribers: 0.3,
        resellers: 0.1,
      }),
    ]);
    expect(lands.noRegret.moves.map((move) => move.text).join(' ')).toMatch(/“Subscribers”/u);
    expect(lands.noRegret.moves.every((move) => move.label === 'recommendation')).toBe(true);
    const none = canvasOf([OPTIONS.baseline(0.2), OPTIONS.proposed(0.22)], {
      counterfactuals: counterfactualSet([
        counterfactualOf('without-budget', 0.01),
        counterfactualOf('lower-adoption', 0.02),
      ]),
    });
    expect(none.noRegret.moves).toEqual([]);
    expect(none.noRegret.note).toMatch(/No move holds/u);
    const better = canvasOf(WINNER);
    expect(better.noRegret.moves).toEqual([]);
    expect(better.noRegret.note).toMatch(/less resisted than no change/u);
    const unchecked = canvasOf(WINNER, { counterfactuals: null });
    expect(unchecked.noRegret.note).toMatch(/Nothing could be checked/u);
  });
});

describe('the futures are shown only where the simulation supports them', () => {
  it('describes up to three, with the option that changes nothing among them, as scenario possibilities with run counts', () => {
    const canvas = canvasOf([
      OPTIONS.baseline(0.4, { favourable: 0.3 }),
      OPTIONS.proposed(0.2, { favourable: 0.6 }),
      OPTIONS.smaller(0.3, { favourable: 0.4 }),
    ]);
    expect(canvas.futures.supported).toBe(true);
    expect(canvas.futures.items.length).toBe(3);
    expect(canvas.futures.items.some((future) => future.kind === 'baseline')).toBe(true);
    for (const future of canvas.futures.items) {
      expect(future.statement.label).toBe('scenario-possibility');
      expect(future.of).toBe(20);
      expect(future.adverseRange).not.toBeNull();
    }
    expect(canvas.futures.note).toMatch(/not forecasts/u);
  });

  it('shows no future at all when there are too few seeded runs', () => {
    const canvas = canvasOf(WINNER, { runs: 9 });
    expect(canvas.futures).toMatchObject({ supported: false, items: [] });
    expect(canvas.futures.note).toMatch(/at least 10 are needed/iu);
  });
});

describe('participants are read defensively, before and after the proposal fields exist', () => {
  const withFields = (fields: Record<string, unknown>) => {
    const set = stakeholderSetFixture();
    set.stakeholders = set.stakeholders.map((stakeholder) =>
      stakeholder.id === 'resellers' ? ({ ...stakeholder, ...fields } as Stakeholder) : stakeholder,
    );
    return set;
  };
  const actor = (canvas: DecisionCanvas, id: string) =>
    canvas.actors.items.find((entry) => entry.actorId === id);

  it('reads a set saved before them: the role is the actor’s own and the authority comes from the category', () => {
    const canvas = canvasOf();
    expect(actor(canvas, 'provider')).toMatchObject({ position: 'decides', synthetic: true });
    expect(actor(canvas, 'regulator')).toMatchObject({ position: 'can-block' });
    expect(actor(canvas, 'resellers')).toMatchObject({ position: 'none', influence: 'medium' });
  });

  it('uses the participant role, influence, authority and plausible actions when they are there', () => {
    const canvas = canvasOf(WINNER, {
      stakeholders: withFields({
        participantRole: 'approvers',
        influence: 'high',
        decisionAuthority: 'approves',
        plausibleActions: [
          'Asks for a delay',
          'Requests an audit',
          'Escalates',
          'A fourth that is cut',
        ],
        synthetic: true,
      }),
    });
    expect(actor(canvas, 'resellers')).toMatchObject({
      role: 'Approvers',
      influence: 'high',
      position: 'approves',
      plausibleActions: ['Asks for a delay', 'Requests an audit', 'Escalates'],
    });
    expect(canvas.lenses[2]?.note).toMatch(/Resellers/u);
  });

  it('ignores a field that is not what it should be, and falls back, without failing', () => {
    const canvas = canvasOf(WINNER, {
      stakeholders: withFields({
        participantRole: 42,
        influence: { level: 'high' },
        decisionAuthority: 'everything',
        plausibleActions: 'not a list',
        synthetic: 'yes',
      }),
    });
    expect(actor(canvas, 'resellers')).toMatchObject({
      position: 'none',
      influence: 'medium',
      plausibleActions: [],
    });
  });
});
