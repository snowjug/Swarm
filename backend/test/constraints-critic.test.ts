import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import type { AnalysisConstraints } from '../../shared/constraint-effects.js';
import { CRITIC_ROLES, critiqueSchema, type Critique } from '../../shared/critique.js';
import { lintText } from '../src/brief/lint.js';
import { runRuleCritics } from '../src/critics/rules.js';
import { cleanInput, withAnalysis } from './support/critic-world.js';

const recorded = (change: Partial<AnalysisConstraints> = {}): AnalysisConstraints => ({
  revision: 4,
  status: 'clear',
  label: 'No constraint was left unconfirmed when this comparison started.',
  reasons: [],
  applied: [],
  notApplied: [],
  impacts: [],
  ...change,
});

const applied = (
  id: string,
  change: Partial<AnalysisConstraints['applied'][number]> = {},
): AnalysisConstraints['applied'][number] => ({
  constraintId: id,
  statement: `The limit ${id} holds for the change.`,
  category: 'budget',
  hardness: 'hard',
  source: 'extracted',
  validation: 'confirmed',
  effect: { kind: 'add-cost', target: 'adoption', amount: 0.2 },
  actorIds: [],
  alternativeIds: [],
  fromRound: null,
  toRound: null,
  ...change,
});

const read = (
  id: string,
  reason: AnalysisConstraints['notApplied'][number]['reason'],
  change: Partial<AnalysisConstraints['notApplied'][number]> = {},
): AnalysisConstraints['notApplied'][number] => ({
  constraintId: id,
  statement: `The limit ${id} was read.`,
  category: 'legal',
  hardness: 'hard',
  source: 'extracted',
  validation: 'confirmed',
  reason,
  ...change,
});

const impact = (
  id: string,
  shift: number,
  classification: 'material' | 'negligible' | 'inconclusive' = 'material',
): AnalysisConstraints['impacts'][number] => ({
  constraintId: id,
  variantId: 'proposed-change',
  metric:
    'Simulated share of members ending in switch or resist (each actor counts equally), 8 paired seeds',
  seeds: 8,
  withMean: 0.4,
  withoutShift: shift,
  standardError: 0.01,
  classification,
});

const critique = (constraints: AnalysisConstraints | undefined): Critique[] =>
  runRuleCritics(withAnalysis(cleanInput(), constraints ? { constraints } : {}));

const mine = (found: readonly Critique[]): Critique[] =>
  found.filter((item) => item.id.startsWith('constraints-'));

describe('the constraint critic', () => {
  it('says nothing about a comparison that was run without a reviewed set of constraints', () => {
    expect(mine(critique(undefined))).toEqual([]);
    expect(critique(undefined)).toEqual(runRuleCritics(cleanInput()));
  });

  it('has nothing to say about a comparison whose constraints were all confirmed and all applied, but notes that effect sizes are chosen', () => {
    const found = mine(critique(recorded({ applied: [applied('c-a')] })));
    expect(found.map((item) => [item.id, item.severity, item.role])).toEqual([
      ['constraints-effect-sizes', 'note', 'methodology'],
    ]);
    expect(mine(critique(recorded()))).toEqual([]);
  });

  it('calls a provisional comparison provisional, and makes it major when a hard limit is unsettled', () => {
    const soft = mine(
      critique(
        recorded({
          status: 'provisional',
          label:
            'Provisional: the simulation ran with 1 constraint not yet validated. Treat what it shows as conditional on them.',
          reasons: ['1 constraint has not been validated.'],
          applied: [applied('c-a', { hardness: 'soft', validation: 'unvalidated' })],
        }),
      ),
    ).find((item) => item.id === 'constraints-provisional');
    expect(soft).toMatchObject({
      role: 'assumption',
      severity: 'minor',
      origin: 'rules',
      status: 'open',
    });
    expect(soft?.basis[0]).toContain('Provisional: the simulation ran with 1 constraint');
    expect(soft?.requestedAction).toMatch(/run the comparison again/u);
    const hard = mine(
      critique(
        recorded({
          status: 'provisional',
          applied: [applied('c-a', { validation: 'assumed' })],
        }),
      ),
    ).find((item) => item.id === 'constraints-provisional');
    expect(hard?.severity).toBe('major');
  });

  it('names the constraints whose removal moves the result and that nobody confirmed, and no more than the five that move it most', () => {
    const found = mine(
      critique(
        recorded({
          status: 'provisional',
          applied: [
            applied('c-weak', { validation: 'unvalidated' }),
            applied('c-strong', { validation: 'assumed', source: 'user' }),
            applied('c-guess', { validation: 'unvalidated', source: 'inferred' }),
            applied('c-confirmed', { validation: 'confirmed' }),
            applied('c-flat', { validation: 'unvalidated' }),
          ],
          impacts: [
            impact('c-weak', 0.06),
            impact('c-strong', -0.2),
            impact('c-guess', 0.1),
            impact('c-confirmed', 0.3),
            impact('c-flat', 0.001, 'negligible'),
          ],
        }),
      ),
    ).filter((item) => item.id.startsWith('constraints-driver-'));
    // A confirmed constraint, and one that moves nothing, are not leaned on without being confirmed.
    // The review lists the most severe first, then by id.
    expect(found.map((item) => [item.id, item.severity])).toEqual([
      ['constraints-driver-c-guess', 'major'],
      ['constraints-driver-c-strong', 'major'],
      ['constraints-driver-c-weak', 'minor'],
    ]);
    const byId = new Map(found.map((item) => [item.id, item]));
    expect(byId.get('constraints-driver-c-strong')?.objection).toContain('it is an assumption');
    expect(byId.get('constraints-driver-c-guess')?.objection).toContain(
      'inferred from who is involved, not found in a source',
    );
    expect(byId.get('constraints-driver-c-weak')?.objection).toContain(
      'a source says so, and no person has checked it',
    );
    expect(byId.get('constraints-driver-c-strong')?.basis.join(' ')).toMatch(
      /shift -0\.20 with standard error 0\.01/u,
    );
    // Seven could be named; the five that move the result most are.
    const many = Array.from({ length: 7 }, (_, at) => `c-${at}`);
    const crowded = mine(
      critique(
        recorded({
          status: 'provisional',
          applied: many.map((id) => applied(id, { validation: 'unvalidated' })),
          impacts: many.map((id, at) => impact(id, 0.05 + at / 100)),
        }),
      ),
    ).filter((item) => item.id.startsWith('constraints-driver-'));
    expect(crowded.map((item) => item.id).sort()).toEqual(
      ['c-2', 'c-3', 'c-4', 'c-5', 'c-6'].map((id) => `constraints-driver-${id}`),
    );
  });

  it('says that a hard limit the simulation could not test leaves the result silent on it, and more so for a legal one', () => {
    const budget = mine(
      critique(recorded({ notApplied: [read('c-a', 'interpretive', { category: 'budget' })] })),
    ).find((item) => item.id === 'constraints-hard-not-modelled');
    expect(budget).toMatchObject({ role: 'methodology', severity: 'minor' });
    const legal = mine(
      critique(
        recorded({
          notApplied: [
            read('c-a', 'interpretive'),
            read('c-b', 'interpretive', { category: 'privacy' }),
          ],
        }),
      ),
    ).find((item) => item.id === 'constraints-hard-not-modelled');
    expect(legal).toMatchObject({ role: 'methodology', severity: 'major' });
    expect(legal?.objection).toContain('2 hard constraints were read and not tested');
    expect(legal?.requestedAction).toMatch(/outside the simulation/u);
    // A soft constraint that is only read is not this objection, and nor is one the person set aside.
    expect(
      mine(
        critique(
          recorded({
            notApplied: [
              read('c-s', 'interpretive', { hardness: 'soft' }),
              read('c-x', 'excluded'),
              read('c-d', 'soft-block', { hardness: 'soft' }),
            ],
          }),
        ),
      ),
    ).toEqual([]);
  });

  it('says that what was marked unknown was treated as absent, not as false', () => {
    const found = mine(
      critique(
        recorded({ notApplied: [read('c-a', 'unknown', { hardness: 'soft', category: 'time' })] }),
      ),
    ).find((item) => item.id === 'constraints-unknown-left-out');
    expect(found).toMatchObject({ role: 'assumption', severity: 'minor' });
    expect(found?.objection).toBe(
      '1 constraint was marked unknown and left out of the runs, which treats it as absent, not as false.',
    );
    expect(
      mine(critique(recorded({ notApplied: [read('c-a', 'unknown', { hardness: 'hard' })] }))).find(
        (item) => item.id === 'constraints-unknown-left-out',
      )?.severity,
    ).toBe('major');
  });

  it('says that a constraint naming what is not in the comparison, or beyond the limit, was not applied', () => {
    const found = mine(
      critique(recorded({ notApplied: [read('c-a', 'dangling'), read('c-b', 'over-limit')] })),
    ).find((item) => item.id === 'constraints-not-applied-names');
    expect(found).toMatchObject({ role: 'methodology', severity: 'minor' });
    expect(found?.objection).toMatch(/2 constraints could not be applied/u);
  });

  it('is pure, uses the roles there are, and every critique it raises fits the schema and is worded within the guards', () => {
    const everything = recorded({
      status: 'provisional',
      label:
        'Provisional: the simulation ran with 2 constraints not yet validated. Treat what it shows as conditional on them.',
      reasons: [
        '2 constraints have not been validated.',
        '1 constraint is marked unknown and is not applied.',
      ],
      applied: [
        applied('c-a', { validation: 'unvalidated', source: 'inferred' }),
        applied('c-b', {
          validation: 'assumed',
          effect: { kind: 'require-approval', approverActorId: 'regulator', threshold: 0.1 },
        }),
      ],
      notApplied: [
        read('c-c', 'interpretive'),
        read('c-d', 'unknown', { hardness: 'soft', category: 'time' }),
        read('c-e', 'dangling'),
      ],
      impacts: [impact('c-a', 0.12), impact('c-b', -0.08)],
    });
    const found = mine(critique(everything));
    expect(found.map((item) => item.id).sort()).toEqual([
      'constraints-driver-c-a',
      'constraints-driver-c-b',
      'constraints-effect-sizes',
      'constraints-hard-not-modelled',
      'constraints-not-applied-names',
      'constraints-provisional',
      'constraints-unknown-left-out',
    ]);
    expect(JSON.stringify(mine(critique(everything)))).toBe(JSON.stringify(found));
    for (const item of found) {
      expect(() => critiqueSchema.parse(item)).not.toThrow();
      expect(CRITIC_ROLES).toContain(item.role);
      expect(item.target).toEqual({ kind: 'analysis', id: cleanInput().analysis.id });
      for (const text of [
        item.objection,
        item.impactOnConclusion,
        item.requestedAction ?? '',
        ...item.basis,
      ]) {
        expect(lintText(text), text).toEqual([]);
        expect(claimsAgainst(text), text).toEqual([]);
      }
    }
  });

  it('does not change what the other critics say', () => {
    const without = runRuleCritics(cleanInput());
    const withRecord = critique(recorded({ applied: [applied('c-a')] })).filter(
      (item) => !item.id.startsWith('constraints-'),
    );
    expect(withRecord).toEqual(without);
  });
});
