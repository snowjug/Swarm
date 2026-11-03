import { describe, expect, it } from 'vitest';
import { lintText } from '../src/brief/lint.js';
import { consequentialScope } from '../src/decision/scope.js';
import { scopeSection } from '../src/decision/scope-words.js';
import { Guard } from '../src/decision/words.js';

// The scope check reads words by rules. What it must do is said by this table: a question about one person’s
// employment, credit, legal, medical or safety situation is recognised as that, and a question about a policy, a
// process or a group, or one that only has a word in common, is not. The rules are not complete, and the last group
// says where they stop.

type Row = readonly [question: string, domains: readonly string[], individual: boolean];

const ONE_PERSON: readonly Row[] = [
  ['Should we fire this employee?', ['employment'], true],
  ['Should we fire Maria Lopez for repeated lateness?', ['employment'], true],
  ['Should I dismiss my assistant after the audit?', ['employment'], true],
  ['Which of these three candidates should we hire?', ['employment'], true],
  ['Rank these five named applicants and say which one must be rejected.', ['employment'], true],
  ['Should we promote her to team lead?', ['employment'], true],
  ['Is it right to let him go after the merger?', ['employment'], true],
  [
    'Priya Raman has missed deadlines again. Should we put her on a performance improvement plan?',
    ['employment'],
    true,
  ],
  ['Should we terminate Tom Becker’s contract?', ['employment'], true],
  ['Should we hire Priya?', ['employment'], true],
  ['Should we fire the CEO?', ['employment'], true],
  ['Our accountant Sarah Kim keeps making errors. Should we let her go?', ['employment'], true],
  [
    'Should I accept the job offer from Northwind or stay in my current role?',
    ['employment'],
    true,
  ],
  ['Do we have grounds to dismiss Mr. Patel?', ['employment'], true],
  ['Can we sack him without notice?', ['employment'], true],
  ['Why was this employee fired?', ['employment'], true],
  ['Should we cut her pay?', ['employment'], true],
  ['Which of our two engineers should be laid off?', ['employment'], true],
  ['Who should we hire as CTO?', ['employment'], true],
  ['Should we offer the Senior Engineer position to Chen Wei or Ana Silva?', ['employment'], true],
  [
    'Set the credit limit for this named customer and approve or decline the card.',
    ['credit'],
    true,
  ],
  ['Should the bank approve John Smith’s mortgage application?', ['credit'], true],
  ['Should we lend to this applicant?', ['credit'], true],
  ['Can I get a loan with my credit history?', ['credit'], true],
  ['Decline her overdraft request.', ['credit'], true],
  ['Should we extend credit to this customer?', ['credit'], true],
  ['Will Mrs Dlamini be approved for the home loan?', ['credit'], true],
  ['Should I sue my landlord over the deposit?', ['legal'], true],
  ['Tell this named tenant whether they should plead guilty.', ['legal'], true],
  ['Should we evict the tenant in flat four?', ['legal'], true],
  ['Decide what sentence this named defendant should get.', ['legal'], true],
  ['Should the judge grant bail to this defendant?', ['legal'], true],
  [
    'Diagnose this named patient from the notes and say which treatment to give.',
    ['medical'],
    true,
  ],
  ['What dose of ibuprofen should my mother take?', ['medical'], true],
  ['Should this patient be admitted to intensive care?', ['medical'], true],
  ['Which treatment should Mrs Alvarez receive for her condition?', ['medical'], true],
  ['Should I stop taking my medication?', ['medical'], true],
  ['What antibiotics should this patient get?', ['medical'], true],
  ['Does this scan show cancer in my daughter’s lungs?', ['medical'], true],
  ['Certify that this named worker is safe to operate the crane.', ['safety'], true],
  ['Should we evacuate Ms. Lee’s family from the flood zone?', ['safety'], true],
  ['Is it safe for him to return to work after the injury?', ['safety'], true],
  ['Ground this pilot until the review is complete.', ['safety'], true],
  ['Should we clear this driver to return to work?', ['safety'], true],
  ['Is this worker fit to drive the forklift?', ['safety'], true],
  ['Is Amara fit to continue as a school bus driver?', ['safety'], true],
];

const POLICY_OR_GROUP: readonly Row[] = [
  ['What happens if we change our hiring policy?', ['employment'], false],
  ['What if we cut our workforce through layoffs?', ['employment'], false],
  ['How might applicants react if a firm moves to anonymised CV screening?', ['employment'], false],
  ['How could our promotion criteria affect retention?', ['employment'], false],
  ['What would happen if we hire fifty more support staff?', ['employment'], false],
  ['How would our staff respond to a new disciplinary procedure?', ['employment'], false],
  ['What if the CEO, Dana Whitfield, announces a hiring freeze?', ['employment'], false],
  ['Should our manager hire two assistants?', ['employment'], false],
  ['What happens to team morale when a manager is fired?', ['employment'], false],
  ['What would a hiring manager look for in a candidate?', ['employment'], false],
  ['How should a manager approach dismissing an employee fairly?', ['employment'], false],
  ['What if our lending criteria become stricter?', ['credit'], false],
  [
    'How might customers react if a lender publishes how its credit scoring works?',
    ['credit'],
    false,
  ],
  ['What happens to default rates if a bank lowers mortgage rates?', ['credit'], false],
  ['How would borrowers respond to a new loan repayment scheme?', ['credit'], false],
  ['What happens if our credit union offers lower mortgage rates?', ['credit'], false],
  ['How might courts respond if a city changes its eviction policy?', ['legal'], false],
  ['What is the liability exposure if a vendor breaches the contract?', ['legal'], false],
  ['How would a sentencing reform change prison numbers?', ['legal'], false],
  ['Should we sue for patent infringement?', ['legal'], false],
  ['What if the defendant company settles the lawsuit early?', ['legal'], false],
  [
    'What could happen if a hospital moves its emergency department to a new triage protocol?',
    ['medical'],
    false,
  ],
  ['How might patients react if a clinic introduces telehealth appointments?', ['medical'], false],
  ['What happens to waiting times if a hospital adds a new surgery wing?', ['medical'], false],
  ['What if vaccination rates drop in a region?', ['medical'], false],
  ['How should we treat patients who miss appointments?', ['medical'], false],
  ['What if this patient pathway redesign shortens the waiting time?', ['medical'], false],
  ['How might people with diabetes respond to a sugar tax?', ['medical'], false],
  ['How would workers respond to mandatory hazard reporting?', ['safety'], false],
  ['What if a factory introduces new emergency shutdown procedures?', ['safety'], false],
  ['How might residents react to a new evacuation plan?', ['safety'], false],
  ['What if we retire a safety-critical system early?', ['safety'], false],
  ['How would drivers react if we ground the fleet during the storm?', ['safety'], false],
  ['How might applicants react if a firm moves to anonymised CV screening?', ['employment'], false],
  [
    'How might customers react if a lender publishes how its credit scoring works?',
    ['credit'],
    false,
  ],
];

/** Looks like a matter of a domain and is not: nothing to notice. */
const LOOK_ALIKES: readonly Row[] = [
  ['How might employees react if we introduce a four-day week?', [], false],
  ['How would this employee benefit scheme change morale?', [], false],
  ['How would the credit card market change if interest caps are introduced?', [], false],
  ['What happens to the credit card market if interest caps arrive?', [], false],
  ['How would a tax credit for solar panels change demand?', [], false],
  ['What happens if we adopt a safety culture programme?', [], false],
  ['How might staff respond to a safety culture programme?', [], false],
  ['What happens to our sales if we delay a medical device launch by a quarter?', [], false],
  ['Would a fire safety campaign reduce incidents?', [], false],
  ['What if we fire up the new production line earlier?', [], false],
  ['What if we promote our new product in three more cities?', [], false],
  ['Should we promote Windows 11 to existing customers?', [], false],
  ['Is it safe to assume the market stays flat?', [], false],
  ['How will this customer segment respond to a price rise?', [], false],
  ['How might customers react if we raise delivery fees?', [], false],
  ['What if the city replaces a bus route with an on-demand shuttle?', [], false],
  ['How might different users react if this online store changes its delivery fees?', [], false],
  ['What happens to housing demand if the government changes immigration rules?', [], false],
  ['What if the regulator fines a vendor for a data breach?', [], false],
  ['What if Dr. Chen’s clinic changes its appointment policy?', [], false],
  ['How would Ms. Lopez, our regional manager, respond to a new bonus scheme?', [], false],
  ['What if our customer Mr. Wu asks for a refund?', [], false],
  ['Sue from accounting asked how a new expenses policy would land.', [], false],
];

/** The words of a question that is about a person but that a reading of words does not catch, said so that the limit is on record. */
const NOT_CAUGHT: readonly string[] = [
  'What should we do about our employee who keeps stealing?',
  'Would it be wise to reject the mortgage for the Hernandez family?',
  'Should we settle with Jane Foster out of court?',
  'Should we report him to the police?',
];

const asked = (rows: readonly Row[]): [string, readonly string[], boolean][] =>
  rows.map(([question, domains, individual]) => [question, domains, individual]);

describe('the scope check: one person’s matter, or a policy, or a word in common', () => {
  it.each(asked(ONE_PERSON))('%s is about one person’s %j', (question, domains, individual) => {
    const scope = consequentialScope(question);
    expect({ domains: scope.domains, aboutIndividual: scope.aboutIndividual }).toEqual({
      domains,
      aboutIndividual: individual,
    });
  });

  it.each(asked(POLICY_OR_GROUP))(
    '%s lists %j and is not about one person',
    (question, domains, individual) => {
      const scope = consequentialScope(question);
      expect({ domains: scope.domains, aboutIndividual: scope.aboutIndividual }).toEqual({
        domains,
        aboutIndividual: individual,
      });
    },
  );

  it.each(asked(LOOK_ALIKES))('%s has nothing to notice', (question, domains, individual) => {
    const scope = consequentialScope(question);
    expect({ domains: scope.domains, aboutIndividual: scope.aboutIndividual }).toEqual({
      domains,
      aboutIndividual: individual,
    });
  });

  it('holds at least thirty questions, in both directions, across all five domains', () => {
    const rows = [...ONE_PERSON, ...POLICY_OR_GROUP, ...LOOK_ALIKES];
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(rows.filter((row) => row[2]).length).toBeGreaterThanOrEqual(15);
    expect(rows.filter((row) => !row[2]).length).toBeGreaterThanOrEqual(15);
    const seen = new Set(rows.flatMap((row) => row[1]));
    expect([...seen].sort()).toEqual(['credit', 'employment', 'legal', 'medical', 'safety']);
  });

  it('does not recognise what it has no words for, and says in its table that it does not', () => {
    for (const question of NOT_CAUGHT) {
      expect(consequentialScope(question).aboutIndividual, question).toBe(false);
    }
  });
});

describe('what the check says of how it read', () => {
  it('lists the cues and never a name, and never more of the question than a few words', () => {
    const question = 'Should we fire Maria Lopez for repeated lateness and poor timekeeping?';
    const { basis } = consequentialScope(question);
    expect(basis).toEqual(['employment: “fire”', 'about one person: a named person']);
    for (const line of basis) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toMatch(/maria|lopez/iu);
    }
    expect(
      consequentialScope('Is Amara fit to continue as a school bus driver?').basis.join(' '),
    ).not.toMatch(/amara/iu);
  });

  it('says which part of the words is the cue for each reading', () => {
    expect(consequentialScope('Should we fire this employee?').basis).toEqual([
      'employment: “fire”',
      'about one person: “this employee”',
    ]);
    expect(consequentialScope('What happens if we change our hiring policy?').basis).toEqual([
      'employment: “hiring”',
    ]);
  });

  it('gives the same answer every time, and does not depend on case, spacing or the curly apostrophe', () => {
    const question = 'Should we FIRE   Tom Becker’s assistant,\nor hire Priya?';
    const first = consequentialScope(question);
    for (let round = 0; round < 3; round += 1) expect(consequentialScope(question)).toEqual(first);
    expect(consequentialScope('should we fire this employee?')).toEqual(
      consequentialScope('SHOULD WE FIRE   THIS\nEMPLOYEE?'),
    );
    expect(consequentialScope('Should we terminate Tom Becker’s contract?')).toEqual(
      consequentialScope("Should we terminate Tom Becker's contract?"),
    );
  });

  it('reads the framing as well as the question, in each part of it', () => {
    const vague = 'What should we do next?';
    expect(consequentialScope(vague).domains).toEqual([]);
    expect(
      consequentialScope(vague, { decision: 'Whether to dismiss this employee.' }),
    ).toMatchObject({ domains: ['employment'], aboutIndividual: true });
    expect(
      consequentialScope(vague, { requestedDecision: 'Decide whether to approve her loan.' }),
    ).toMatchObject({ domains: ['credit'], aboutIndividual: true });
    expect(
      consequentialScope(vague, { alternatives: [{ label: 'Diagnose this named patient' }] }),
    ).toMatchObject({ domains: ['medical'], aboutIndividual: true });
    expect(
      consequentialScope(vague, { system: 'A hospital’s emergency department.' }),
    ).toMatchObject({
      domains: ['medical'],
      aboutIndividual: false,
    });
    expect(consequentialScope(vague, null)).toEqual({
      domains: [],
      aboutIndividual: false,
      basis: [],
    });
  });

  it('reads an act and a person together only where they stand in one clause', () => {
    expect(
      consequentialScope('How would this employee react if we hire a new manager?'),
    ).toMatchObject({ domains: ['employment'], aboutIndividual: false });
    expect(
      consequentialScope('Should we hire a new manager, or fire this employee?'),
    ).toMatchObject({ aboutIndividual: true });
  });

  it('returns quickly on text made to be slow, and reads only so much of it', () => {
    const hostile = [
      'this '.repeat(500),
      `Should we fire ${'Maria '.repeat(300)}now?`,
      'fire,'.repeat(600),
      `which of our ${'very '.repeat(300)}`,
      `this ${'quiet '.repeat(300)} employee`,
    ];
    const started = performance.now();
    for (const text of hostile) consequentialScope(text, { decision: text });
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('the section of the canvas that says it', () => {
  it('carries the notice and the domains for a matter of the five, and neither for any other', () => {
    const guard = new Guard();
    const policy = scopeSection(
      consequentialScope('What happens if we change our hiring policy?'),
      guard,
    );
    expect(policy).toMatchObject({
      domains: ['employment'],
      aboutIndividual: false,
      exploration: null,
    });
    expect(policy.notice).toMatch(/^Swarm explores scenarios\. It does not make or recommend/u);
    const none = scopeSection(
      consequentialScope('How might customers react if we raise fees?'),
      guard,
    );
    expect(none).toMatchObject({ notice: null, domains: [], aboutIndividual: false });
  });

  it('says what the exploration can and cannot tell a person who decides, only for one person’s matter', () => {
    const guard = new Guard();
    const one = scopeSection(consequentialScope('Should we fire this employee?'), guard);
    expect(one.exploration?.canTell.length).toBeGreaterThan(0);
    expect(one.exploration?.cannotTell.length).toBeGreaterThan(0);
    expect(one.exploration?.canTell.every((line) => line.label === 'simulation-event')).toBe(true);
    expect(
      one.exploration?.cannotTell.every((line) => line.label === 'validation-requirement'),
    ).toBe(true);
    expect(guard.withheld).toBe(0);
  });

  it('is worded so that the guard against forecasts and unattributed figures lets all of it through', () => {
    const guard = new Guard();
    for (const [question] of ONE_PERSON) {
      const section = scopeSection(consequentialScope(question), guard);
      const sentences = [
        section.notice ?? '',
        ...section.basis,
        ...(section.exploration?.canTell.map((line) => line.text) ?? []),
        ...(section.exploration?.cannotTell.map((line) => line.text) ?? []),
      ];
      for (const sentence of sentences) expect(lintText(sentence), sentence).toEqual([]);
    }
    expect(guard.withheld).toBe(0);
  });
});
