import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { lintText } from '../src/brief/lint.js';
import {
  CONFIDENCE_BASIS_MEANINGS,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_MEANINGS,
  stakeholderSchema,
  stakeholderSetSchema,
  type Stakeholder,
  type StakeholderSet,
} from '../../shared/stakeholders.js';
import { whyOf } from '../src/stakeholders/participants/explain.js';
import {
  compareNames,
  findPersonalDetail,
  findStereotype,
  findUnsupportedMotive,
  isBroadName,
  isGenericName,
  namesPerson,
  normaliseLine,
  redactSecrets,
  wordingProblem,
} from '../src/stakeholders/participants/language.js';
import {
  ROLE_DEFAULTS,
  STANDING_PROHIBITED_CLAIMS,
  roleGapReason,
} from '../src/stakeholders/participants/taxonomy.js';
import {
  RULE_CATALOGUE,
  refusalWords,
  reviewContext,
  reviewParticipants,
} from '../src/stakeholders/participants/validate.js';
import { QUESTION, SCENARIO, passagesOf } from './support/participants-world.js';

const passages = passagesOf();
const NOW = '2026-03-01T09:00:00.000Z';

function held(id: string, name: string, overrides: Record<string, unknown> = {}): Stakeholder {
  return stakeholderSchema.parse({
    id,
    name,
    category: 'cost-bearer',
    directness: 'direct',
    priority: 'standard',
    populationSize: 20,
    expectedImpact: { direction: 'unclear', rationale: '' },
    evidence: [],
    assumptions: ['Assumption: nothing is quoted for it.'],
    uncertainty: { level: 'high', reason: 'One mention.' },
    origin: 'rules',
    status: 'proposed',
    participantRole: 'directly-affected',
    objective: 'Keep things workable.',
    plausibleActions: ['Accept the change.'],
    ...overrides,
  });
}

/** A set of participants. `strict` is a set the proposal made; otherwise it is one found before the proposal existed. */
function setOf(
  stakeholders: Stakeholder[],
  options: { strict?: boolean; relations?: StakeholderSet['relations'] } = {},
): StakeholderSet {
  return stakeholderSetSchema.parse({
    stakeholders,
    relations: options.relations ?? [],
    discovery: { mode: 'rules', generatedAt: NOW },
    ...(options.strict === false
      ? {}
      : {
          proposal: {
            version: 1,
            generatedAt: NOW,
            source: 'rules',
            evidence: { shown: 0, of: 0 },
          },
        }),
  });
}

const review = (
  set: StakeholderSet,
  graph = null as Parameters<typeof reviewContext>[0]['graph'],
) =>
  reviewParticipants(
    set,
    reviewContext({ passages, graph, scenario: SCENARIO, question: QUESTION }),
  );

const pair = (...extra: Stakeholder[]): Stakeholder[] => [
  held('a-group', 'Night shift mechanics'),
  held('b-group', 'Residents of the old corridor'),
  ...extra,
];
const codes = (result: ReturnType<typeof review>, severity?: 'blocking' | 'advisory'): string[] =>
  result.issues
    .filter((issue) => severity === undefined || issue.severity === severity)
    .map((issue) => issue.code);
const issueFor = (result: ReturnType<typeof review>, code: string) =>
  result.issues.find((issue) => issue.code === code);

describe('names', () => {
  it.each([
    'Staff',
    'Specialist',
    'Management',
    'User',
    'Users',
    'Public',
    'Employee',
    'Employees',
    'Stakeholder',
    'Stakeholders',
    'Team',
    'The team',
    'Key stakeholders',
    'End users',
    'Team members',
    'General public',
    'Everyone',
  ])('calls %s too generic', (name) => {
    expect(isGenericName(name)).toBe(true);
  });

  it.each([
    'Support staff',
    'Night shift mechanics',
    'Residents of the old corridor',
    'Sales team',
    'Depot staff',
    'Safety inspectorate',
    'Customers',
    'Regulators',
  ])('does not call %s generic: it says which ones, or is a role of its own', (name) => {
    expect(isGenericName(name)).toBe(false);
  });

  it('calls a real role named alone broad, and no more than that', () => {
    expect(isBroadName('Customers')).toBe(true);
    expect(isBroadName('Engineers')).toBe(true);
    expect(isBroadName('Night shift mechanics')).toBe(false);
    expect(isBroadName('Staff')).toBe(false);
  });

  it('tells the same name from one inside another, from one that overlaps, and from one that does not', () => {
    expect(compareNames('Night drivers', 'drivers, night')).toBe('same');
    expect(compareNames('Customers', 'Enterprise customers')).toBe('contained');
    expect(compareNames('Night bus drivers union', 'Night bus drivers guild')).toBe('overlap');
    expect(compareNames('Regulators', 'Competitors')).toBe('different');
  });
});

describe('what generated text may not say about people', () => {
  it.each([
    'Older customers never learn new tools.',
    'Women are less likely to complain.',
    'Millennials simply do not read notices.',
    'Lazy employees resist every change.',
    'They are set in their ways.',
    'Young people always switch first.',
  ])('refuses the stereotype “%s”', (text) => {
    expect(findStereotype(text)).not.toBeNull();
  });

  it.each([
    'Older customers asked for a hearing.',
    'Customers over a certain age use the late bus more.',
    'Residents ask for a late bus.',
    'The sources quote “older customers never learn new tools” and no more.',
  ])('lets “%s” stand: it makes no sweeping claim, or it is quoted', (text) => {
    expect(findStereotype(text)).toBeNull();
  });

  it.each([
    'Secretly wants the route to fail.',
    'Is privately hoping for a delay.',
    'Has a hidden agenda.',
    'Mr Alvarez believes the plan is wrong.',
    'Dr Okafor fears losing the contract.',
  ])('refuses the claim to know a mind: “%s”', (text) => {
    expect(findUnsupportedMotive(text)).not.toBeNull();
  });

  it('refuses a mental state put on a person the sources hold, and lets a role’s concern stand', () => {
    expect(
      findUnsupportedMotive('Jordan Reyes wants the route moved.', ['Jordan Reyes']),
    ).not.toBeNull();
    expect(findUnsupportedMotive('Concerned about losing the late bus.')).toBeNull();
    expect(findUnsupportedMotive('The role may worry about the schedule.')).toBeNull();
    expect(findUnsupportedMotive('The source says “secretly hoping” and no more.')).toBeNull();
  });

  it('points at a person by an honorific, a job title with a name, or a name the sources hold', () => {
    expect(namesPerson('Dr Imani Okafor')).not.toBeNull();
    expect(namesPerson('CEO Jane Smith')).not.toBeNull();
    expect(namesPerson('Talks to Jordan Reyes about it.', ['Jordan Reyes'])).toBe('Jordan Reyes');
    expect(namesPerson('The chief executive')).toBeNull();
    expect(namesPerson('Regional managers')).toBeNull();
  });

  it.each([
    ['Write to jordan@example.org', 'an email address'],
    ['Call +44 20 7946 0958', 'a phone number'],
    ['Follow @jordan_reyes', 'a social media handle'],
    ['Lives at 12 Station Road', 'a street address'],
    ['token=abcd1234efgh', 'something that looks like a credential'],
  ])('finds personal detail in “%s”', (text, kind) => {
    expect(findPersonalDetail(text)).toBe(kind);
  });

  it('takes a credential out of text before it is sent anywhere', () => {
    const redacted = redactSecrets(
      'Use api_key=sk-' + 'abcdefghijklmnopqrstu and Bearer eyJhbGciOi.payloadpart.sigpart now.',
    );
    expect(redacted).not.toContain('sk-' + 'abcdefghijklmnopqrstu');
    expect(redacted).not.toContain('eyJhbGciOi');
    expect(redacted).toContain('[redacted]');
  });

  it('judges wording as the brief’s guard does: a forecast, a claim of certainty, a percentage', () => {
    expect(wordingProblem('The route will fail.')).toContain('forecast');
    expect(wordingProblem('Riders are certain to leave.')).toContain('forecast');
    expect(wordingProblem('It certainly works.')).toContain('certainty');
    expect(wordingProblem('Sixty percent of them switch.')).toContain('percentage');
    expect(wordingProblem('They could ask for a hearing.')).toBeNull();
    expect(wordingProblem('The source says “it will fail” and no more.')).toBeNull();
  });

  it('cleans a line: markup, control characters and runs of spaces', () => {
    expect(normaliseLine('  <b>Night</b>\u0007  shift \n mechanics ', 80)).toBe(
      'Night shift mechanics',
    );
  });

  it('keeps the words of its own tables free of what it refuses to say', () => {
    const own = [
      ...Object.values(PARTICIPANT_ROLE_MEANINGS),
      ...Object.values(CONFIDENCE_BASIS_MEANINGS),
      ...STANDING_PROHIBITED_CLAIMS,
      ...PARTICIPANT_ROLES.flatMap((role) => [
        ...ROLE_DEFAULTS[role].informationAccess,
        ...ROLE_DEFAULTS[role].plausibleActions,
        ...ROLE_DEFAULTS[role].prohibitedClaims,
        roleGapReason(role, 'a cue'),
      ]),
    ];
    for (const text of own) {
      expect(lintText(text), text).toEqual([]);
      expect(claimsAgainst(text), text).toEqual([]);
      expect(findStereotype(text), text).toBeNull();
      expect(findUnsupportedMotive(text), text).toBeNull();
      expect(findPersonalDetail(text), text).toBeNull();
    }
  });
});

describe('the rule catalogue', () => {
  it('gives every rule a severity for a proposed set, and says which only advise on an older one', () => {
    for (const [code, rule] of Object.entries(RULE_CATALOGUE)) {
      expect(['blocking', 'advisory'], code).toContain(rule.strict);
      expect(rule.summary.length, code).toBeGreaterThan(20);
    }
    const advisoryForOlder = Object.entries(RULE_CATALOGUE)
      .filter(([, rule]) => rule.strict === 'blocking' && rule.legacy !== 'blocking')
      .map(([code]) => code)
      .sort();
    expect(advisoryForOlder).toEqual([
      'assumption-unmarked',
      'duplicate-incentives',
      'duplicate-participant',
      'evidence-unknown',
      'generic-name',
      'incomplete',
      'wording',
    ]);
  });

  it('is valid only when no blocking issue remains, and says what is wrong, how to fix it and for whom', () => {
    const fine = review(setOf(pair()));
    expect(fine.valid).toBe(true);
    expect(codes(fine, 'blocking')).toEqual([]);
    const broken = review(setOf(pair(held('c-group', 'Staff'))));
    expect(broken.valid).toBe(false);
    const issue = issueFor(broken, 'generic-name')!;
    expect(issue).toMatchObject({
      severity: 'blocking',
      participantId: 'c-group',
      fixAction: 'rename',
    });
    expect(issue.message).toContain('“Staff”');
    expect(issue.fix).toMatch(/Rename it/u);
    expect(broken.counts.blocking).toBe(1);
    expect(refusalWords(broken)).toContain('One issue must be fixed');
    expect(refusalWords(fine)).toBe('');
  });

  it('holds a set the proposal made to every rule, and an older set only to its old ones where the rule is about quality', () => {
    const generic = pair(held('c-group', 'Staff'));
    expect(codes(review(setOf(generic, { strict: true })), 'blocking')).toContain('generic-name');
    expect(codes(review(setOf(generic, { strict: false })), 'blocking')).not.toContain(
      'generic-name',
    );
    expect(codes(review(setOf(generic, { strict: false })), 'advisory')).toContain('generic-name');
    expect(review(setOf(generic, { strict: false })).profile).toBe('legacy');
  });

  it.each([
    ['stereotype', { concerns: ['Older customers never learn new tools.'] }],
    ['unsupported-motive', { objective: 'Secretly wants the move to fail.' }],
    ['personal-detail', { description: 'Reach them at jordan@example.org.' }],
    ['real-person', { name: 'Dr Imani Okafor' }],
  ])('blocks %s in a set of either kind: safety is not a matter of age', (code, change) => {
    for (const strict of [true, false]) {
      const result = review(setOf(pair(held('c-group', 'Night drivers', change)), { strict }));
      expect(codes(result, 'blocking'), `${code} strict=${strict}`).toContain(code);
    }
  });

  it('blocks a person the sources hold as one, in any field', () => {
    const graph = {
      method: 'lexical' as const,
      notes: [],
      nodes: [
        {
          id: 'n1',
          label: 'Jordan Reyes',
          kind: 'person' as const,
          entityType: 'Person',
          summary: 'A named official in the sources.',
          quote: '',
          weight: 1,
          sourceIds: ['S1'],
        },
      ],
      edges: [],
    };
    const result = review(
      setOf(pair(held('c-group', 'Night drivers', { description: 'Led by Jordan Reyes.' }))),
      graph,
    );
    expect(codes(result, 'blocking')).toContain('real-person');
  });

  it('blocks a forecast in a proposed set and advises on an older one', () => {
    const forecast = held('c-group', 'Night drivers', { plausibleActions: ['They will quit.'] });
    expect(codes(review(setOf(pair(forecast))), 'blocking')).toContain('wording');
    expect(codes(review(setOf(pair(forecast), { strict: false })), 'advisory')).toContain(
      'wording',
    );
  });

  it('reads a model’s or a person’s reasons for wording too, and not the fixed reasons rules write', () => {
    const reasons = { uncertainty: { level: 'high', reason: 'They will react badly.' } };
    expect(
      codes(
        review(setOf(pair(held('c-group', 'Night drivers', { ...reasons, origin: 'model' })))),
        'blocking',
      ),
    ).toContain('wording');
    expect(
      codes(
        review(setOf(pair(held('c-group', 'Night drivers', { ...reasons, origin: 'rules' })))),
        'blocking',
      ),
    ).not.toContain('wording');
  });

  it('checks that cited passages exist, and that a source is not claimed without one', () => {
    const ref = {
      passageId: 'S99',
      documentId: 'D1',
      documentName: 'notes.md',
      start: 0,
      end: 10,
      quote: 'A quote.',
      contentHash: 'abc',
      role: 'supports',
    };
    const unknown = held('c-group', 'Night drivers', {
      evidence: [ref],
      confidenceBasis: 'source-quote',
    });
    expect(codes(review(setOf(pair(unknown))), 'blocking')).toContain('evidence-unknown');
    expect(codes(review(setOf(pair(unknown), { strict: false })), 'blocking')).not.toContain(
      'evidence-unknown',
    );
    const claimed = held('d-group', 'Night drivers again', { confidenceBasis: 'source-quote' });
    for (const strict of [true, false]) {
      expect(codes(review(setOf(pair(claimed), { strict })), 'blocking')).toContain(
        'basis-unsupported',
      );
    }
  });

  it('wants a participant with no passage to say it is an assumption, unless it is the person’s own or minor', () => {
    const silent = held('c-group', 'Night drivers', { assumptions: [] });
    expect(codes(review(setOf(pair(silent))), 'blocking')).toContain('assumption-unmarked');
    const own = held('d-group', 'Night cleaners', {
      assumptions: [],
      origin: 'user',
      status: 'added',
    });
    expect(codes(review(setOf(pair(own))), 'blocking')).not.toContain('assumption-unmarked');
    const minor = held('e-group', 'Night guards', { assumptions: [], priority: 'background' });
    expect(codes(review(setOf(pair(minor))), 'blocking')).not.toContain('assumption-unmarked');
  });

  it('refuses two participants that are one, and only advises on two that overlap', () => {
    const same = pair(held('c-group', 'Mechanics, night shift'));
    const result = review(setOf(same));
    expect(issueFor(result, 'duplicate-participant')).toMatchObject({
      severity: 'blocking',
      fixAction: 'merge',
      relatedIds: expect.any(Array),
    });
    const overlapping = pair(held('c-group', 'Old corridor residents group'));
    expect(codes(review(setOf(overlapping)), 'blocking')).not.toContain('duplicate-participant');
    expect(codes(review(setOf(overlapping)), 'advisory')).toContain('possible-duplicate');
    const minor = [
      held('a-group', 'Night shift mechanics', { priority: 'background' }),
      held('b-group', 'Night mechanics group', { priority: 'background' }),
    ];
    expect(codes(review(setOf(minor)))).not.toContain('possible-duplicate');
  });

  it('refuses two participants whose incentives are the same, which a simulation cannot tell apart', () => {
    const incentives = ['Keep the late service running.', 'Avoid a long walk home.'];
    const result = review(
      setOf([
        held('a-group', 'Night shift mechanics', { incentives }),
        held('b-group', 'Residents of the old corridor', { incentives: [...incentives].reverse() }),
      ]),
    );
    expect(codes(result, 'blocking')).toContain('duplicate-incentives');
    expect(
      codes(
        review(
          setOf([
            held('a-group', 'Night shift mechanics', { incentives }),
            held('b-group', 'Residents of the old corridor'),
          ]),
        ),
        'blocking',
      ),
    ).not.toContain('duplicate-incentives');
  });

  it('checks relations: a missing end, a loop on one participant, a repeat', () => {
    const edge = { type: 'influences' as const, strength: 0.5, rationale: 'An assumption.' };
    const result = review(
      setOf(pair(), {
        relations: [
          { from: 'a-group', to: 'nobody', ...edge },
          { from: 'a-group', to: 'a-group', ...edge },
          { from: 'a-group', to: 'b-group', ...edge },
          { from: 'a-group', to: 'b-group', ...edge },
        ],
      }),
    );
    expect(result.issues.filter((issue) => issue.code === 'relation-invalid')).toHaveLength(3);
    expect(
      review(setOf(pair(), { relations: [{ from: 'a-group', to: 'b-group', ...edge }] })).valid,
    ).toBe(true);
  });

  it('wants fewer than two participants refused, and a participant with no objective or action named', () => {
    expect(codes(review(setOf([held('a-group', 'Night shift mechanics')])), 'blocking')).toContain(
      'too-few',
    );
    const bare = held('c-group', 'Night drivers', { objective: undefined, plausibleActions: [] });
    expect(issueFor(review(setOf(pair(bare))), 'incomplete')?.severity).toBe('blocking');
    expect(codes(review(setOf(pair(bare), { strict: false })))).not.toContain('incomplete');
  });

  it('advises when a role and a kind of party do not go together, or one role is most of the list, or there are too many key actors', () => {
    const odd = held('c-group', 'Night drivers', {
      participantRole: 'regulators-governance',
      category: 'cost-bearer',
    });
    expect(codes(review(setOf(pair(odd))), 'advisory')).toContain('role-mismatch');
    const trades = [
      'Electricians',
      'Plumbers',
      'Welders',
      'Fitters',
      'Painters',
      'Carpenters',
      'Glaziers',
      'Roofers',
      'Surveyors',
    ];
    const crowd = trades.map((trade, index) =>
      held(`m-${index}`, `Depot ${trade.toLowerCase()}`, {
        participantRole: 'implementers',
        category: 'operations',
        priority: 'key',
      }),
    );
    const result = review(setOf([...crowd, held('z-group', 'Riders of the old corridor')]));
    expect(codes(result, 'advisory')).toEqual(
      expect.arrayContaining(['over-represented', 'many-key']),
    );
    expect(result.valid).toBe(true);
  });

  it('names the roles nobody holds, where the text suggests one matters, and not the rest', () => {
    const result = review(setOf(pair()));
    const byRole = new Map(result.coverage.map((item) => [item.role, item]));
    expect(byRole.get('directly-affected')?.status).toBe('covered');
    // The notes speak of a council that must approve, an inspectorate and a rival: roles nobody holds here.
    expect(byRole.get('approvers')?.status).toBe('missing');
    expect(byRole.get('regulators-governance')?.status).toBe('missing');
    expect(byRole.get('competitors-alternatives')?.status).toBe('missing');
    expect(byRole.get('decision-owner')?.status).toBe('missing');
    expect(byRole.get('system-environment')?.status).toBe('optional');
    const missing = result.issues.filter(
      (issue) => issue.code === 'missing-role' || issue.code === 'missing-decision-owner',
    );
    expect(missing.map((issue) => issue.role)).toEqual(
      expect.arrayContaining(['decision-owner', 'competitors-alternatives']),
    );
    for (const issue of missing) {
      expect(issue.severity).toBe('advisory');
      expect(issue.fixAction).toBe('add-missing');
    }
    expect(result.valid).toBe(true);
  });

  it('lets a role stand for another that is as good: customers and users for those directly affected, approvers for governance', () => {
    const users = review(
      setOf([
        held('a-group', 'Night riders', {
          participantRole: 'customers-users',
          category: 'end-user',
        }),
        held('b-group', 'Depot mechanics', {
          participantRole: 'implementers',
          category: 'operations',
        }),
      ]),
    );
    expect(users.coverage.find((item) => item.role === 'directly-affected')?.status).toBe(
      'optional',
    );
    const council = review(
      setOf([
        held('a-group', 'City council committee', {
          participantRole: 'approvers',
          category: 'governance',
        }),
        held('b-group', 'Depot mechanics', {
          participantRole: 'implementers',
          category: 'operations',
        }),
      ]),
    );
    expect(council.coverage.find((item) => item.role === 'regulators-governance')?.status).toBe(
      'optional',
    );
  });
});

describe('what a review says in words', () => {
  const sourced = held('a-group', 'Night shift mechanics', {
    prohibitedClaims: STANDING_PROHIBITED_CLAIMS,
    evidence: [
      {
        passageId: passages[0]!.id,
        documentId: 'D1',
        documentName: 'notes.md',
        start: 0,
        end: 10,
        quote: 'The transit office plans',
        contentHash: 'abc',
        role: 'supports',
      },
    ],
    confidenceBasis: 'source-quote',
  });

  it('composes “Swarm proposes these participants because…” from the participants’ own fields, the same every time', () => {
    const set = setOf([
      sourced,
      held('b-group', 'Residents of the old corridor'),
      held('c-group', 'City council committee', {
        participantRole: 'approvers',
        category: 'governance',
      }),
    ]);
    const first = review(set).summary;
    expect(first).toBe(review(structuredClone(set)).summary);
    expect(first).toMatch(
      /^Swarm proposes these 3 participants because “Whether to move the night bus route/u,
    );
    expect(first).toContain('1 approver');
    expect(first).toContain('1 is tied to quoted passages, and the other 2 rest on assumptions');
    expect(first).toContain('They are synthetic roles, not real people.');
    expect(first).toMatch(/Roles nobody holds yet: /u);
    expect(claimsAgainst(first)).toEqual([]);
  });

  it('says that nothing is tied to a passage when nothing is, and that nobody is listed when nobody is', () => {
    expect(review(setOf(pair())).summary).toContain('None is tied to a quoted passage');
    expect(
      review(setOf([held('a-group', 'Night shift mechanics', { status: 'removed' })])).summary,
    ).toBe('There are no participants yet.');
  });

  it('explains a participant from what it holds and adds nothing: no quote, no source, no fact that it does not have', () => {
    const why = whyOf(sourced);
    expect(why).toMatchObject({
      id: 'a-group',
      name: 'Night shift mechanics',
      roleLabel: 'Directly affected',
      basis: { kind: 'source-quote', label: 'Quoted from a source' },
    });
    expect(why.evidence).toEqual([
      { passageId: passages[0]!.id, documentName: 'notes.md', quote: 'The transit office plans' },
    ]);
    expect(why.because.join(' ')).toContain('What the role is trying to achieve (an assumption)');
    expect(why.because.join(' ')).toContain('1 passage is cited for it.');
    expect(why.limits.join(' ')).toContain('synthetic role, not a person');
    expect(why.limits.join(' ')).toContain('Never asserted:');
    expect(whyOf(sourced)).toEqual(why);
    const bare = whyOf(held('b-group', 'Residents of the old corridor'));
    expect(bare.evidence).toEqual([]);
    expect(bare.because.join(' ')).toContain(
      'No passage is cited for it, so it is held as an assumption.',
    );
    for (const text of [...why.because, ...why.limits, ...bare.because]) {
      expect(claimsAgainst(text), text).toEqual([]);
    }
  });
});
