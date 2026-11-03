import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { COUNTERFACTUAL_IDS, type Counterfactual } from '../../shared/constraints.js';
import { FIXTURE_VARIANTS, actorSetFixture } from '../../shared/lab-fixtures.js';
import { lintText } from '../src/brief/lint.js';
import {
  ADOPTION_DROP,
  COUNTERFACTUAL_SEEDS,
  DELAY_ROUNDS,
  runCounterfactuals,
  type CounterfactualInput,
} from '../src/constraints/counterfactuals.js';
import { simulateEachSpecOnce } from '../src/simulation/simulate.js';
import { NOW, constraintOf } from './support/constraint-fixtures.js';

const cast = actorSetFixture();
const proposed = FIXTURE_VARIANTS[1]!;

const input = (
  constraints: CounterfactualInput['constraints'],
  overrides: Partial<CounterfactualInput> = {},
): CounterfactualInput => ({
  actors: cast.actors,
  relations: cast.relations,
  rounds: 12,
  variant: proposed,
  variantIds: new Set(FIXTURE_VARIANTS.map((variant) => variant.id)),
  constraints,
  seeds: Array.from({ length: COUNTERFACTUAL_SEEDS }, (_, at) => 100 + at),
  simulator: simulateEachSpecOnce(),
  inputs: { constraints: 3, actors: 2, scenario: 1 },
  now: NOW,
  ...overrides,
});

const viewOf = (views: readonly Counterfactual[], id: Counterfactual['id']) => {
  const found = views.find((view) => view.id === id);
  if (!found) throw new Error(`No view ${id}.`);
  return found;
};

const budget = constraintOf({
  id: 'c-budget',
  category: 'budget',
  statement: 'Spending on the change is capped by the finance office.',
  hardness: 'hard',
  effects: [{ kind: 'add-cost', target: 'adoption', amount: 0.3 }],
});
const approval = constraintOf({
  id: 'c-approval',
  category: 'regulatory',
  statement: 'The change needs the regulator’s approval before it lands.',
  hardness: 'hard',
  effects: [{ kind: 'require-approval', approverActorId: 'regulator', threshold: 0.1 }],
});
const capacity = constraintOf({
  id: 'c-capacity',
  category: 'capacity',
  statement: 'Resellers cannot absorb more than ten extra cases a week.',
  hardness: 'hard',
  affectedActorIds: ['resellers'],
  effects: [{ kind: 'delay', rounds: 2 }],
});
const dependency = constraintOf({
  id: 'c-dependency',
  category: 'dependency',
  statement: 'The change depends on the resellers’ systems being ready.',
  affectedActorIds: ['resellers'],
});

describe('the counterfactual views of the proposed change', () => {
  it('gives the seven views, in order, each on the same seeds as the base, and the same views again from the same inputs', async () => {
    const first = await runCounterfactuals(input([budget, approval, capacity, dependency]));
    expect(first.views.map((view) => view.id)).toEqual([...COUNTERFACTUAL_IDS]);
    expect(first).toMatchObject({
      variantId: 'proposed-change',
      seeds: COUNTERFACTUAL_SEEDS,
      inputs: { constraints: 3, actors: 2, scenario: 1 },
    });
    expect(first.metric).toMatch(/12 paired seeds/u);
    for (const view of first.views) {
      expect(view.applicable, view.id).toBe(true);
      expect(view.deltaVsBase, view.id).toBeGreaterThanOrEqual(-1);
      expect(view.deltaVsBase, view.id).toBeLessThanOrEqual(1);
      expect(['material', 'negligible', 'inconclusive']).toContain(view.classification);
      expect(view.standardError, view.id).toBeGreaterThanOrEqual(0);
    }
    expect(await runCounterfactuals(input([budget, approval, capacity, dependency]))).toEqual(
      first,
    );
  });

  it('says why a view does not apply, and runs nothing for it', async () => {
    const { views } = await runCounterfactuals(input([]));
    const reasons = Object.fromEntries(
      views.filter((view) => !view.applicable).map((view) => [view.id, view.reason]),
    );
    expect(Object.keys(reasons)).toEqual([
      'without-budget',
      'higher-capacity',
      'different-decision-owner',
      'dependency-fails',
    ]);
    expect(reasons['without-budget']).toMatch(/No budget constraint is applied/u);
    expect(reasons['higher-capacity']).toMatch(/No capacity constraint is applied/u);
    expect(reasons['different-decision-owner']).toMatch(/asks for an approval/u);
    expect(reasons['dependency-fails']).toMatch(/nothing that can fail/u);
    for (const view of views.filter((item) => !item.applicable)) {
      expect(view).toMatchObject({
        deltaVsBase: null,
        standardError: null,
        classification: null,
        driver: '',
      });
    }
    // What is the same whatever the constraints are still runs: a setting of the view, not a constraint.
    expect(viewOf(views, 'delayed-implementation').applicable).toBe(true);
    expect(viewOf(views, 'lower-adoption').applicable).toBe(true);
    expect(viewOf(views, 'stronger-regulation').applicable).toBe(true);
  });

  it('does not take away a limit it only read, and says that a limit it read is not modelled', async () => {
    const read = constraintOf({
      id: 'c-read',
      category: 'budget',
      statement: 'Spending is tight this year.',
    });
    const { views } = await runCounterfactuals(input([read]));
    const view = viewOf(views, 'without-budget');
    expect(view.applicable).toBe(false);
    expect(view.reason).toMatch(/read but not modelled/u);
  });

  it('takes away what the simulation applies of a kind, and names the constraint that drove the difference', async () => {
    const { views } = await runCounterfactuals(input([budget, capacity]));
    const without = viewOf(views, 'without-budget');
    expect(without.driverConstraintIds).toEqual(['c-budget']);
    expect(without.driver).toContain('capped by the finance office');
    expect(without.deltaVsBase).not.toBe(0);
    const higher = viewOf(views, 'higher-capacity');
    expect(higher.driverConstraintIds).toEqual(['c-capacity']);
    expect(higher.applicable).toBe(true);
  });

  it('measures a delay and lower adoption as settings of the view, whatever the constraints say', async () => {
    const { views } = await runCounterfactuals(input([budget]));
    const delayed = viewOf(views, 'delayed-implementation');
    expect(delayed.driver).toBe(
      `Setting: the change lands in round ${proposed.round + DELAY_ROUNDS} instead of round ${proposed.round}.`,
    );
    expect(delayed.driverConstraintIds).toEqual([]);
    expect(viewOf(views, 'lower-adoption').change).toContain(String(ADOPTION_DROP));
    // Too short a run to land later: not run, and says so.
    const short = await runCounterfactuals(input([], { rounds: 4 }));
    expect(viewOf(short.views, 'delayed-implementation')).toMatchObject({
      applicable: false,
      reason: 'A run of 4 rounds is too short for a change that lands in round 5.',
    });
  });

  it('moves the approval to another authority when the cast has one, and says so when it has none', async () => {
    const { views } = await runCounterfactuals(input([approval]));
    const owner = viewOf(views, 'different-decision-owner');
    expect(owner.applicable).toBe(true);
    expect(owner.driverConstraintIds).toEqual(['c-approval']);
    const alone = {
      actors: cast.actors.filter((actor) => actor.category !== 'decision-maker'),
    };
    const only = await runCounterfactuals(input([approval], alone));
    expect(viewOf(only.views, 'different-decision-owner')).toMatchObject({
      applicable: false,
      reason: 'There is no other authority in the cast to ask for the approval.',
    });
  });

  it('strengthens regulation by who regulates and by the regulatory limits that are applied', async () => {
    const { views } = await runCounterfactuals(input([approval]));
    const stronger = viewOf(views, 'stronger-regulation');
    expect(stronger.applicable).toBe(true);
    expect(stronger.driverConstraintIds).toEqual(['c-approval']);
    expect(stronger.driver).toMatch(/authority up by 0\.2/u);
    const without = await runCounterfactuals(
      input([], { actors: cast.actors.filter((actor) => actor.category !== 'regulator') }),
    );
    expect(viewOf(without.views, 'stronger-regulation')).toMatchObject({
      applicable: false,
      reason: expect.stringContaining('Nobody in the cast is a regulator'),
    });
  });

  it('stops the change for the actors a dependency names, and for no one when none is named', async () => {
    const named = await runCounterfactuals(input([dependency]));
    const failing = viewOf(named.views, 'dependency-fails');
    expect(failing.applicable).toBe(true);
    expect(failing.change).toContain('does not reach the actors named as depending on it');
    expect(failing.driverConstraintIds).toEqual(['c-dependency']);
    const unnamed = await runCounterfactuals(
      input([
        constraintOf({
          id: 'c-vague',
          category: 'dependency',
          statement: 'The change depends on a supplier.',
        }),
      ]),
    );
    expect(viewOf(unnamed.views, 'dependency-fails').change).toContain('reaches no one');
  });

  it('does not change what it was given, and does not apply a constraint a person has not looked at', async () => {
    const waiting = constraintOf({
      ...budget,
      id: 'c-waiting',
      review: 'proposed',
      validation: 'unvalidated',
    });
    const before = JSON.stringify([budget, waiting, cast.actors]);
    const { views } = await runCounterfactuals(input([waiting]));
    expect(JSON.stringify([budget, waiting, cast.actors])).toBe(before);
    expect(viewOf(views, 'without-budget').applicable).toBe(false);
  });

  it('writes its copy without a promise, a forecast or a figure', async () => {
    const set = await runCounterfactuals(input([budget, approval, capacity, dependency]));
    const empty = await runCounterfactuals(input([]));
    const copy = [set, empty].flatMap((item) => [
      item.metric,
      ...item.views.flatMap((view) => [view.label, view.change, view.driver, view.reason ?? '']),
    ]);
    for (const line of copy.filter(Boolean)) {
      expect(lintText(line), line).toEqual([]);
      expect(claimsAgainst(line), line).toEqual([]);
    }
  });
});
