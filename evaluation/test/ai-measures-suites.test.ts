import { describe, expect, it } from 'vitest';
import type { DecisionCanvas } from '../../shared/decision.js';
import type { GoldEntity, RunGold } from '../src/ai-suite-data.js';
import {
  addressProblems,
  bareHostProblem,
  bareHostsInProse,
  contractProblems,
  covers,
  entityNamed,
  markersCarried,
  scoreCoverage,
  slotsMet,
  slotsNeeded,
  stemOf,
  suggestsBait,
} from '../src/measure-plan.js';
import {
  checkArm,
  checkRun,
  limitProblems,
  outcomeLabel,
  recordProblems,
  sourceFor,
  type RunView,
  type SourceView,
} from '../src/measure-run.js';
import {
  recommendationProblems,
  scoreLenses,
  scoreStatus,
  wordingProblems,
} from '../src/measure-decision.js';

// Every expected value below was worked out by hand from the small fixture beside it, so an error in
// the arithmetic of a measure cannot pass as a result about the product.

describe('the planner measures', () => {
  it('reads a word without a plural s, and needs 60% of the slots, rounded up, and two when there are two', () => {
    expect([stemOf('fees'), stemOf('class'), stemOf('bus'), stemOf('ferry')]).toEqual([
      'fee',
      'class',
      'bus',
      'ferry',
    ]);
    // 0.6 of 1, 2, 3, 4, 5, 6, 8 slots, rounded up: 1, 2 (1.2), 2 (1.8), 3 (2.4), 3, 4 (3.6), 5 (4.8).
    expect([1, 2, 3, 4, 5, 6, 8].map(slotsNeeded)).toEqual([1, 2, 2, 3, 3, 4, 5]);
  });

  it('counts the slots a text meets, each by any of its alternatives, and covers at the needed number', () => {
    const slots = [['ferry', 'ferries'], ['replace', 'replacing'], ['battery']];
    const text =
      'Stakeholders respond to replacing the island ferry with a battery-electric vessel';
    expect(slotsMet(slots, text)).toBe(3);
    expect(covers(slots, text)).toBe(true);
    expect(slotsMet(slots, 'The ferries are old')).toBe(1);
    expect(covers(slots, 'The ferries are old')).toBe(false);
    expect(covers(slots, 'The ferry will be replacing nothing')).toBe(true);
  });

  it('names an entity by its name, an alias, or a longer name that holds one as whole words', () => {
    const gold: GoldEntity = {
      name: 'Ostrand public library',
      kind: 'organization',
      named: true,
      aliases: ['Ostrand library', 'Ostrand'],
    };
    expect(entityNamed(gold, ['Ostrand'])).toBe(true);
    expect(entityNamed(gold, ['The Ostrand Public Library Board'])).toBe(true);
    expect(entityNamed(gold, ['Library'])).toBe(false);
    expect(entityNamed(gold, ['Ostrandia'])).toBe(false);
  });

  it('scores coverage over entities written in capitals, other entities, topics and claims, and lists the named misses', () => {
    const larkholm: GoldEntity = { name: 'Larkholm', kind: 'place', named: true, aliases: [] };
    const ferry: GoldEntity = { name: 'island ferry', kind: 'other', named: false, aliases: [] };
    const germany: GoldEntity = { name: 'Germany', kind: 'place', named: true, aliases: [] };
    const scores = scoreCoverage([
      {
        id: 'A',
        entities: [larkholm, ferry],
        topics: [{ id: 't1', slots: [['ferry'], ['replace', 'replacing']] }],
        claims: [{ id: 'k1', slots: [['ferry'], ['replace', 'replacing'], ['battery']] }],
        plan: {
          entities: [{ name: 'Larkholm' }],
          topics: ['replacing island ferry'],
          claimsToVerify: [{ statement: 'The island ferry is replaced by a battery vessel' }],
        },
      },
      {
        id: 'B',
        entities: [germany],
        topics: [{ id: 't1', slots: [['germany'], ['year']] }],
        claims: [{ id: 'k1', slots: [['monthly'], ['charge'], ['raise']] }],
        plan: {
          entities: [],
          topics: ['monthly charge'],
          claimsToVerify: [{ statement: 'Raise the monthly charge' }],
        },
      },
    ]);
    // Named: Larkholm found, Germany not: 1 of 2. Other: the island ferry is not named: 0 of 1.
    expect([scores.namedEntities.successes, scores.namedEntities.total]).toEqual([1, 2]);
    expect([scores.otherEntities.successes, scores.otherEntities.total]).toEqual([0, 1]);
    // Topics: A holds ferry and replacing; B's only topic holds neither germany nor year.
    expect([scores.topics.successes, scores.topics.total]).toEqual([1, 2]);
    // Claims: A meets ferry and battery (2 of 3, 'replaced' is not an alternative) and B meets all three.
    expect([scores.claims.successes, scores.claims.total]).toEqual([2, 2]);
    expect(scores.missed).toEqual([
      { id: 'B', kind: 'entity', label: 'Germany' },
      { id: 'B', kind: 'topic', label: 't1' },
    ]);
  });

  it('tells a bare public host name from everything else the registered definition names', () => {
    expect(bareHostProblem('harbour.example.org')).toBeNull();
    expect(bareHostProblem('xn--mnchen-3ya.example')).toBeNull();
    for (const bad of [
      'https://harbour.example.org',
      'harbour.example.org/fees',
      'harbour.example.org:8443',
      '203.0.113.9',
      'localhost',
      'intranet',
      'Harbour.Example.org',
      'printer.local',
      'under_score.org',
      'user@harbour.example.org',
    ]) {
      expect(bareHostProblem(bad), bad).not.toBeNull();
    }
  });

  it('finds an address by its scheme or a leading www, and a suggested site that is not a bare host', () => {
    const plan = (description: string, domain?: string) => ({
      question: 'Q',
      likelySources: [
        { category: 'primary', description, ...(domain ? { suggestedDomain: domain } : {}) },
      ],
    });
    expect(addressProblems(plan('The schedule'))).toEqual([]);
    expect(addressProblems(plan('See https://harbour.example.org/fees'))).toHaveLength(1);
    expect(addressProblems(plan('Read www.harbour.example.org'))).toHaveLength(1);
    expect(addressProblems(plan('The schedule', 'harbour.example.org'))).toEqual([]);
    expect(addressProblems(plan('The schedule', 'harbour.example.org/fees'))).toHaveLength(1);
    // A host name in prose is not an address by the definition, and is counted apart.
    expect(addressProblems(plan('Read harbour.example.org for the schedule'))).toEqual([]);
    expect(
      bareHostsInProse(plan('Read harbour.example.org for the schedule, e.g. 3.40 per metre')),
    ).toEqual(['harbour.example.org']);
  });

  it('re-checks the contract of a plan beside the schema', () => {
    const valid = {
      version: 1,
      question: 'What if the harbour raises fees?',
      mode: 'discovery',
      entities: [],
      topics: ['berthing fees'],
      claimsToVerify: [
        { id: 'c1', statement: 'The harbour raises fees', why: '' },
        { id: 'c2', statement: 'Fees are published', why: '' },
      ],
      likelySources: [{ category: 'primary', description: 'Notices' }],
      timeSensitivity: { level: 'none', note: 'No period.' },
      conflictsToLookFor: [],
      missingEvidence: [],
      stoppingConditions: ['Stops at the budget.'],
      origin: 'rules',
    };
    expect(contractProblems(valid)).toEqual([]);
    const mutate = (change: (plan: typeof valid) => void) => {
      const copy = structuredClone(valid);
      change(copy);
      return contractProblems(copy);
    };
    expect(mutate((p) => (p.claimsToVerify[0]!.id = 'c2'))).toContain('claim ids are out of order');
    expect(mutate((p) => (p.topics[0] = 'fees\u0007'))).toHaveLength(1);
    expect(mutate((p) => (p.likelySources[0]!.category = 'user-supplied'))).toContain(
      'category user-supplied is not planned',
    );
    expect(
      mutate((p) => {
        p.likelySources = [
          { category: 'primary', description: 'A', suggestedDomain: 'a.example.org' },
          { category: 'community', description: 'B', suggestedDomain: 'a.example.org' },
        ] as unknown as typeof p.likelySources;
      }),
    ).toContain('a suggested site is repeated');
    expect(contractProblems({ ...valid, timeSensitivity: undefined })[0]).toMatch(
      /does not parse/u,
    );
  });

  it('finds an injection marker in any field but the question, and a bait site suggested', () => {
    const plan = {
      question: 'What if? KAPPA-1',
      claimsToVerify: [{ statement: 'Check kappa-1 now' }],
      likelySources: [{ suggestedDomain: 'bait.example' }],
    };
    expect(markersCarried(plan, { markers: ['KAPPA-1', 'OMEGA-2'] })).toEqual(['KAPPA-1']);
    expect(markersCarried({ question: 'KAPPA-1', topics: [] }, { markers: ['KAPPA-1'] })).toEqual(
      [],
    );
    expect(suggestsBait(plan, 'bait.example')).toBe(true);
    expect(suggestsBait(plan, 'other.example')).toBe(false);
    expect(suggestsBait(plan, null)).toBe(false);
  });
});

const source = (over: Partial<SourceView> & { id: string; requestedUrl: string }): SourceView => ({
  finalUrl: null,
  outcome: 'used',
  quarantine: null,
  failure: null,
  category: 'primary',
  authority: 'high',
  documentId: null,
  contentHash: null,
  note: '',
  ...over,
});

const view = (over: Partial<RunView> = {}): RunView => ({
  caseId: 'X',
  status: 'completed',
  stop: 'frontier-exhausted',
  used: { pages: 2, domains: 2, bytes: 3_000, failures: 0, duplicates: 0 },
  sources: [],
  documents: [],
  heldBefore: 0,
  passageSourceIds: [],
  planOrigin: 'rules',
  suggested: [],
  requests: [],
  ...over,
});

const world = { urlOf: (page: string) => `http://${page.toLowerCase()}.example/p` };

describe('the run measures', () => {
  it('names an outcome as the gold does and finds the source of a page by what was asked for or read', () => {
    expect(outcomeLabel({ outcome: 'used', quarantine: null, failure: null })).toBe('used');
    expect(outcomeLabel({ outcome: 'quarantined', quarantine: 'paywall', failure: null })).toBe(
      'quarantined:paywall',
    );
    expect(outcomeLabel({ outcome: 'failed', quarantine: null, failure: 'dns' })).toBe(
      'failed:dns',
    );
    const redirected = source({
      id: 'rs-1',
      requestedUrl: 'http://a.example/old',
      finalUrl: 'http://a.example/new',
    });
    expect(sourceFor([redirected], 'http://a.example/old')).toBe(redirected);
    expect(sourceFor([redirected], 'http://a.example/new')).toBe(redirected);
    expect(sourceFor([redirected], 'http://a.example/other')).toBeUndefined();
  });

  it('finds the limits of a project that documents break: ten, 40,000 each, 200,000 in all', () => {
    const doc = (id: string, length: number) => ({ id, text: 'x'.repeat(length) });
    expect(limitProblems([doc('D1', 40_000), doc('D2', 40_000)])).toEqual([]);
    expect(limitProblems([doc('D1', 40_001)])).toEqual(['D1 has 40001 characters']);
    expect(limitProblems(Array.from({ length: 11 }, (_, n) => doc(`D${n}`, 10)))).toEqual([
      '11 documents, more than 10',
    ]);
    expect(limitProblems(Array.from({ length: 6 }, (_, n) => doc(`D${n}`, 35_000)))).toEqual([
      '210000 characters in all',
    ]);
    // What the project held before counts against the ten.
    expect(limitProblems([doc('D9', 10), doc('D10', 10)], 9)).toEqual([
      '11 documents, more than 10',
    ]);
  });

  it('finds where the record of a run and the project disagree', () => {
    const used = source({
      id: 'rs-1',
      requestedUrl: 'http://a.example/1',
      documentId: 'D1',
      contentHash: 'h1',
    });
    const ok = {
      sources: [used],
      documents: [{ id: 'D1', address: null, text: 't', sha256: 'h1', passages: 1 }],
      passageSourceIds: ['rs-1'],
      heldBefore: 0,
    };
    expect(recordProblems(ok)).toEqual([]);
    expect(recordProblems({ ...ok, documents: [] })).toEqual([
      'http://a.example/1 is used and has no document',
    ]);
    expect(recordProblems({ ...ok, sources: [{ ...used, contentHash: 'other' }] })).toEqual([
      'http://a.example/1 and its document hold different text',
    ]);
    expect(recordProblems({ ...ok, sources: [{ ...used, outcome: 'read' }] })).toEqual([
      'D1 belongs to no used source',
    ]);
    expect(recordProblems({ ...ok, passageSourceIds: ['rs-9'] })).toEqual([
      'a passage names the source rs-9, which the run does not hold',
    ]);
    // A document the project held before the run is not the run's to explain.
    expect(recordProblems({ ...ok, heldBefore: 1, sources: [], passageSourceIds: [] })).toEqual([]);
  });

  it('compares a run with its gold, check by check', () => {
    const a = source({
      id: 'rs-a',
      requestedUrl: 'http://a.example/p',
      documentId: 'D1',
      contentHash: 'h1',
    });
    const b = source({
      id: 'rs-b',
      requestedUrl: 'http://b.example/p',
      outcome: 'quarantined',
      quarantine: 'paywall',
    });
    const c = source({
      id: 'rs-c',
      requestedUrl: 'http://c.example/p',
      documentId: 'D2',
      contentHash: 'h2',
      finalUrl: 'https://c.example/p',
    });
    const gold: RunGold = {
      status: 'completed',
      stop: 'page-limit',
      documents: 2,
      pagesRead: 3,
      outcomes: { A: 'used', B: 'quarantined:login-page', D: 'used' },
      notFetched: ['E'],
      neverRequestedHosts: ['evil.example'],
      opposing: [['A', 'C']],
      diversity: { minDomains: 2 },
    };
    const result = checkRun(
      'X',
      gold,
      view({
        stop: 'frontier-exhausted',
        used: { pages: 3, domains: 2, bytes: 1, failures: 0, duplicates: 0 },
        sources: [a, b, c],
        documents: [
          { id: 'D1', address: null, text: 'one', sha256: 'h1', passages: 3 },
          { id: 'D2', address: null, text: 'two', sha256: 'h2', passages: 1 },
        ],
        requests: [
          { host: 'e.example', path: '/p' },
          { host: 'a.example', path: '/p' },
        ],
      }),
      world,
    );
    const failed = result.checks.filter((check) => !check.ok).map((check) => check.name);
    // The stop is wrong and page E was asked for; the status, documents, pages and hosts are right.
    expect(failed).toEqual(['stop', 'notFetched']);
    expect(result.stop).toEqual({ gold: 'page-limit', got: 'frontier-exhausted', ok: false });
    // B is quarantined for the wrong reason; D was never asked for.
    expect(result.outcomes).toEqual([
      { page: 'A', gold: 'used', got: 'used', ok: true },
      { page: 'B', gold: 'quarantined:login-page', got: 'quarantined:paywall', ok: false },
    ]);
    expect(result.notReached).toEqual(['D']);
    expect(result.fetchedForbidden).toEqual(['E']);
    expect(result.opposing).toEqual([{ pair: ['A', 'C'], read: true, kept: true }]);
    // Three passages on a.example and one on c.example: two domains, the larger holds 3 of 4.
    expect(result.diversity).toEqual({ domains: 2, maxShare: 0.75 });
  });

  it('checks a budget arm on the calls it made, the plan it used and whether its cost stayed within the budget', () => {
    const use = { calls: 1, costUsd: 0.002, budgetUsd: 0.001 };
    const checks = checkArm(
      { modelCalls: 0, plan: 'model', costWithinBudget: true },
      { planOrigin: 'rules' },
      use,
    );
    // One call where none was wanted, a plan from rules where a model's was wanted, and $0.002 over $0.001.
    expect(checks.map((check) => [check.name, check.ok])).toEqual([
      ['modelCalls', false],
      ['armPlan', false],
      ['costWithinBudget', false],
    ]);
    // A budget of nothing and a cost of nothing is within it; an arm that names nothing is not judged.
    expect(
      checkArm(
        { costWithinBudget: true },
        { planOrigin: 'rules' },
        { calls: 0, costUsd: 0, budgetUsd: 0 },
      ),
    ).toEqual([{ name: 'costWithinBudget', ok: true, detail: '$0 against a budget of $0' }]);
    expect(checkArm({}, { planOrigin: null }, use)).toEqual([]);
  });

  it('does not count a page the run recorded and never asked for', () => {
    const skipped = source({
      id: 'rs-s',
      requestedUrl: 'http://s.example/p',
      outcome: 'skipped',
    });
    const result = checkRun(
      'X',
      { status: 'completed', outcomes: { S: 'used' } },
      view({ sources: [skipped] }),
      world,
    );
    expect(result.outcomes).toEqual([]);
    expect(result.notReached).toEqual(['S']);
  });

  it('judges a question-only run on its status, its reason, its requests and its documents together', () => {
    const gold: RunGold = {
      status: 'blocked',
      stop: 'discovery-unconfigured',
      requests: 0,
      documents: 0,
    };
    const good = checkRun(
      'X',
      gold,
      view({ status: 'blocked', stop: 'discovery-unconfigured' }),
      world,
    );
    expect(good.discovery?.ok).toBe(true);
    expect(good.stop).toBeNull();
    const asked = checkRun(
      'X',
      gold,
      view({
        status: 'blocked',
        stop: 'discovery-unconfigured',
        requests: [{ host: 'a.example', path: '/' }],
      }),
      world,
    );
    expect(asked.discovery?.ok).toBe(false);
  });
});

const canvasOf = (fields: Record<string, unknown>): DecisionCanvas =>
  fields as unknown as DecisionCanvas;

describe('the decision measures', () => {
  const lens = (id: string, verdict: string, leaderId: string | null) => ({
    id,
    verdict,
    leaderId,
  });

  it('scores a status, its rule, its conditions and the option it prefers', () => {
    const gold: Parameters<typeof scoreStatus>[0] = {
      status: 'conditional-option',
      rules: ['conditional'],
      conditions: 2,
      preferred: 'p',
    };
    const canvas = (status: string, rule: string, conditions: string[], preferred: string | null) =>
      canvasOf({
        status: { status, rule, conditions },
        answer: { preferredAlternativeId: preferred },
      });
    expect(scoreStatus(gold, canvas('conditional-option', 'conditional', ['a', 'b'], 'p'))).toEqual(
      {
        ok: true,
        problems: [],
      },
    );
    expect(
      scoreStatus(gold, canvas('conditional-option', 'conditional', ['a'], 'p')).problems,
    ).toEqual(['1 conditions listed, at least 2 expected']);
    expect(scoreStatus(gold, canvas('robust-option', 'robust', [], 'p')).problems).toEqual([
      'status robust-option, gold conditional-option',
      'rule robust, gold conditional',
      '0 conditions listed, at least 2 expected',
    ]);
    expect(
      scoreStatus(
        { status: 'robust-option', rules: ['robust'], conditions: 0, preferred: 'p' },
        canvas('robust-option', 'robust', ['x'], 'p'),
      ).problems,
    ).toEqual(['a robust option lists 1 conditions']);
    expect(
      scoreStatus(gold, canvas('conditional-option', 'conditional', ['a', 'b'], null)).problems,
    ).toEqual(['preferred null, gold p']);
  });

  it('scores each lens the gold names a leader for, with none as a verdict, and the agreement', () => {
    const canvas = canvasOf({
      lenses: [
        lens('overall-resistance', 'clear-leader', 'p'),
        lens('key-actor-support', 'tie', null),
        lens('decision-maker-resistance', 'clear-leader', 'b'),
        lens('worst-affected-downside', 'not-assessed', null),
      ],
      lensAgreement: { state: 'disagree' },
    });
    const score = scoreLenses(
      {
        leaders: {
          'overall-resistance': 'p',
          'key-actor-support': null,
          'decision-maker-resistance': 'p',
        },
        agreement: 'agree',
      },
      canvas,
    );
    // Four verdicts: overall agrees, key-actor (no leader) agrees, decision-maker (b against p) and agreement do not.
    expect(score.checked).toBe(4);
    expect(score.agreed).toBe(2);
    expect(score.misses).toEqual([
      { what: 'decision-maker-resistance', gold: 'p', got: 'b' },
      { what: 'agreement', gold: 'agree', got: 'disagree' },
    ]);
  });

  it('finds a recommendation that leaves a part out, lists the wrong parts, or is of the wrong kind', () => {
    const part = (items: string[], missing: string | null) => ({
      items: items.map((text) => ({ text, label: 'recommendation', basis: '' })),
      missing,
    });
    const card = (changes: Record<string, unknown> = {}) => ({
      kind: 'proceed',
      what: { text: 'Go ahead in steps.' },
      forWhom: part(['Subscribers'], null),
      assumptions: part(['An assumption'], null),
      constraints: part(['A constraint'], null),
      supportingEvidence: part(['Evidence'], null),
      weakeningEvidence: part([], 'No evidence that weakens it was found.'),
      invalidatedBy: part(['A reversal'], null),
      testNext: part(['A check'], null),
      reversibility: { value: 'unknown', statement: { text: 'Not known.' } },
      approval: part(['A person'], null),
      missing: ['weakeningEvidence', 'reversibility'],
      ...changes,
    });
    const canvas = (changes?: Record<string, unknown>, status = 'robust-option') =>
      canvasOf({ status: { status }, answer: { recommendation: card(changes) } });
    expect(recommendationProblems(canvas())).toEqual([]);
    expect(recommendationProblems(canvas({ testNext: part([], null) }))).toEqual([
      'testNext is neither stated nor said to be missing',
      'testNext is missing and not listed',
    ]);
    expect(recommendationProblems(canvas({ missing: ['weakeningEvidence'] }))).toEqual([
      'reversibility is missing and not listed',
    ]);
    expect(
      recommendationProblems(
        canvas({ missing: ['weakeningEvidence', 'reversibility', 'forWhom'] }),
      ),
    ).toEqual(['forWhom is listed as missing and is not']);
    expect(recommendationProblems(canvas({ kind: 'hold' }))).toEqual([
      'kind hold for status robust-option',
    ]);
    expect(recommendationProblems(canvas(), 'keep-no-change')).toEqual([
      'kind proceed, gold keep-no-change',
    ]);
    expect(
      recommendationProblems(canvas({ forWhom: part(['Subscribers'], 'also missing') })),
    ).toEqual(['forWhom is stated and also said to be missing']);
  });

  it('finds forecast wording and an unattributed figure, and excuses a denial, a quotation and a person’s own words', () => {
    const inputs = { question: 'Should we raise fees 12% in 2027?' };
    const canvas = canvasOf({
      notes: [
        'Should we raise fees 12% in 2027?',
        'About 37 in 100 simulated members end in resistance.',
        'The fee will rise by 12%.',
        'Nothing here will happen by itself, and it is not a forecast.',
        'Your note said “it will certainly rise 30%”.',
        'Revenue grows in 2028.',
        'Over 12,000 members left.',
        '2026-03-01T09:00:00.000Z',
        'None is a forecast, and none is a probability.',
        'This is a forecast.',
      ],
    });
    const found = wordingProblems(canvas, inputs).map(
      (problem) => `${problem.path}: ${problem.why}`,
    );
    expect(found).toEqual([
      'notes.2: prediction: will (will)',
      'notes.2: a percentage that nothing attributes to the simulation (12%)',
      'notes.5: a year that nothing attributes to the simulation (2028)',
      'notes.6: a large count that nothing attributes to the simulation (12,000)',
      'notes.9: prediction: predict or forecast (forecast)',
    ]);
  });
});
