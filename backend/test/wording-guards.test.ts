import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { lintBrief, lintText } from '../src/brief/lint.js';
import { sectionWriter } from '../src/brief/writer.js';
import { briefOfPack, textsOfBrief } from './support/pack-brief.js';

// Two guards stand between the product and a claim it must not make. The brief builder runs one on
// every statement it writes (backend/src/brief/lint.ts); the browser tests run the other over what the
// pages show (e2e/support/claims.ts), written apart from the first so that a flaw in one is not a flaw
// in both. They are held here to the same sentences: what neither may let through, and what both must.

const GUARDS: [string, (text: string) => string[]][] = [
  ['the guard of the brief builder', (text) => lintText(text).map((issue) => issue.rule)],
  ['the guard of the browser tests', (text) => claimsAgainst(text)],
];

/** Prohibited, whichever way it is put: a forecast, or a figure about the world that is not the simulation's. */
const REFUSED = [
  // A forecast, in the words of a person who has not been told not to use "will".
  'Real-world adoption is certain to rise.',
  'Simulated members are expected to leave.',
  'Churn shall fall.',
  'Customers are bound to leave.',
  'Revenue is projected to double.',
  'The company is going to lose market share.',
  'Adoption won’t stall.',
  'Sales are poised to recover.',
  'It is almost certain to rise.',
  'The change is expected to raise churn.',
  'Conversion will increase by 12% after the change.',
  'Customers will switch to a competitor.',
  'Will real-world conversion rise?',
  'Simulated members will certainly improve.',
  'Conversion is expected to rise by 3 of 40 simulated members.',
  // A figure beside a measure of the world, or beside real people, that is not attributed.
  'Simulated counts show conversion increased by 18 real customers.',
  'Simulated counts show conversion increased by 18 customers.',
  'Simulated members were counted. Conversion rose by 18 customers.',
  'Conversion rose by 18 customers.',
  'Revenue rose by 5 million.',
  'Customer satisfaction scored 8 out of 10.',
  'Seven real customers left.',
  'Eighteen real customers converted in the simulation.',
  'Simulated runs suggest sentiment of 0.4 among real users.',
  'The simulation shows 18 real customers converting.',
  '58% of customers left.',
  'It lifts conversion by 8% across the shop.',
  'An adoption rate of 40% is reached within a year.',
  'About 12 per cent of them.',
  'Simulated counts show churn of 18 percent of real users.',
];

/** What the product says about itself and its figures, and what others wrote: none of it a claim. */
const ALLOWED = [
  // Said about the figures, not about the world: an explicit negation.
  'Synthetic actors are not real people.',
  'None is a rate, a share of a real population, a forecast or a measurement.',
  'It does not predict the future, and the counts above are neither rates nor forecasts.',
  'Swarm does not predict conversion or churn.',
  'These counts are not 18 real customers.',
  'The 18 simulated members are not 18 real customers.',
  'No share of a real population is measured.',
  'Revenue is not something this brief measures.',
  'Population sizes are assumptions used to weight each group, not counts of real people: “Supplier” 100, “Administrators” 100, “Support engineers” 100, “Clients” 25, and 11 more.',
  // What someone else wrote is quoted, and is theirs.
  'The poll gives “44%” and the partner’s notes give “16%”.',
  'The person wrote “conversion will rise by 18%” in the question.',
  'The source says “adoption is certain to rise” and nobody has checked it.',
  // Figures that say whose they are: simulated members, seeded runs, an assumption.
  'About 22 simulated members ended up looking for an alternative or resisting under “Proposed change”.',
  'In 11 of 12 paired runs, more simulated members looked for an alternative under the change.',
  'The finding held in 9 of 10 seeded runs (Wilson interval 0.60 to 0.98).',
  'The simulated adoption rose by 3 of 40 simulated members.',
  'Conversion rose by 18, among simulated members.',
  'Every count is a count of simulated members or of seeded runs.',
  'Traits of “Customers” (key, 1 simulated member): prior stance 0.00 [s], adoption tendency 0.60 [s].',
  'Past take-up is in line with the assumed adoption tendency of 0.6.',
  'The share of runs in which the result holds settles clearly above or below one half, and the reaction in the pilot points the same way.',
  'Moving it by +0.25 changed the outcome measure by -0.03 on the same seeds.',
  // Words that are not forecasts, and settings that are not rates.
  'Expected effect on it: unclear.',
  'Baseline, what is expected without the change: “the fee stays”.',
  'Intensity is set to 0.7 for the change.',
  'Each check below would test, against the real world, an assumption the simulated result is sensitive to.',
  'Does the unstable result hold when the analysis is repeated, and does the real group react as the simulation shows?',
];

describe.each(GUARDS)('%s', (_name, refuses) => {
  it.each(REFUSED)('refuses “%s”', (text) => {
    expect(refuses(text), text).not.toEqual([]);
  });

  it.each(ALLOWED)('allows “%s”', (text) => {
    expect(refuses(text), text).toEqual([]);
  });

  it('judges the words that are the product’s own, and never those in quotation marks', () => {
    for (const text of REFUSED) {
      expect(refuses(`The source says “${text}” and no more.`), text).toEqual([]);
      expect(refuses(`The source says “fine” and ${text}`), text).not.toEqual([]);
    }
  });

  it('wants a figure attributed where it is stated, not by a word elsewhere in the sentence', () => {
    // The same words, with "simulated" beside the figure and then not.
    expect(refuses('Conversion rose by 18 simulated members.')).toEqual([]);
    expect(refuses('Simulated members were asked. Conversion rose by 18.')).not.toEqual([]);
    expect(
      refuses('Simulated members were asked, and conversion rose by 18 customers.'),
    ).not.toEqual([]);
    expect(refuses('Simulated counts show conversion increased by 18 real customers.')).not.toEqual(
      [],
    );
  });
});

describe('where the two guards differ', () => {
  const attributed =
    'In 10 of 10 seeded runs, at least 30% of simulated members were looking for an alternative.';
  // What the Simulation stage says, which is only ever about simulated members and seeded runs.
  const OF_THE_PAGES = [
    attributed,
    'Mostly repeatable: it holds in 10 of 10 seeded runs (95% interval 72–100%).',
    'In a typical run the middle 80% of runs ranged from 0% to 1%.',
    'Looking for an alternative or resisting: 0% of the simulated members in a typical run',
    // How far a setting was moved, which the validation plan names as what to check.
    'sensitivity intensity-up: Intensity of Proposed change: 25% higher (0.7 to 0.875)',
  ];

  it('lets the pages show a percentage of simulated members or of runs, which no brief may contain', () => {
    for (const text of OF_THE_PAGES) {
      expect(claimsAgainst(text), text).toEqual([]);
      expect(
        lintText(text).map((issue) => issue.rule),
        text,
      ).toContain('percentage');
    }
    // A percentage that no word of the sentence attributes to the simulation is still refused.
    expect(claimsAgainst('At least 30% of them looked for an alternative.')).not.toEqual([]);
    expect(claimsAgainst('A 95% interval for the share of customers.')).not.toEqual([]);
    expect(claimsAgainst('Sales are 25% higher.')).not.toEqual([]);
  });

  it('names the rule that a statement breaks, so that a person can see why it was withheld', () => {
    const rules = (text: string) => lintText(text).map((issue) => issue.rule);
    expect(rules('Real-world adoption is certain to rise.')).toEqual(['prediction']);
    expect(rules('Simulated counts show conversion increased by 18 real customers.')).toEqual([
      'real-world-claim',
    ]);
    expect(rules('Over 60% of them stay.')).toEqual(['percentage']);
    expect(rules('This is guaranteed to work.')).toEqual(['prediction', 'overclaim']);
    expect(lintText('Conversion rose by 18 customers.')[0]?.match).toBe('Conversion rose by 18');
  });
});

describe('the brief builder withholds what the guard refuses, and keeps what it allows', () => {
  const write = (text: string) => {
    const tally = { withheld: 0, downgraded: 0 };
    const statement = sectionWriter('limitations', tally).add({
      origin: 'unresolved-uncertainty',
      text,
    });
    return { statement, tally };
  };

  it.each(REFUSED)('withholds “%s”', (text) => {
    const { statement, tally } = write(text);
    expect(statement.text).toMatch(
      /^A statement was withheld here because its wording broke the guard \(/u,
    );
    expect(statement.text).not.toContain(text);
    expect(tally.withheld).toBe(1);
  });

  it('says why: the rule that was broken', () => {
    expect(write('Real-world adoption is certain to rise.').statement.text).toContain(
      '(prediction)',
    );
    expect(
      write('Simulated counts show conversion increased by 18 real customers.').statement.text,
    ).toContain('(real-world-claim)');
  });

  it.each(ALLOWED)('keeps “%s”', (text) => {
    const { statement, tally } = write(text);
    expect(statement.text).toBe(text);
    expect(tally.withheld).toBe(0);
  });
});

describe('the briefs of the example packs, and of a question no example knows, pass both guards', () => {
  const custom = {
    title: 'Library late fees',
    question:
      'What could happen if the city library network stops charging late fees on all borrowed items?',
    documents: [
      {
        name: 'council-briefing.md',
        content:
          'The city library network is considering an end to late fees on all borrowed items. Library patrons have asked for it for years, and families with children say fines keep them away. The library board expects some books to come back later, and the branch librarians worry about shelves staying empty while items are overdue. The city council must approve the change, and the finance committee has asked what the fees currently bring in. Volunteers who run the community reading programmes say they would welcome fewer arguments at the desk. A taxpayers’ association has said before that it dislikes any change that moves costs onto the general budget.',
        provenance: { kind: 'paste' as const },
      },
    ],
  };

  it.each([...EXAMPLE_SCENARIOS, custom])(
    'finds nothing to refuse in the brief for “$title”',
    async (pack) => {
      const brief = await briefOfPack(pack);
      const texts = textsOfBrief(brief);
      expect(texts.length).toBeGreaterThan(50);
      expect(lintBrief(brief)).toEqual([]);
      // Nothing was withheld, so what the builder's guard refuses is not in the wording of its own rules.
      expect(brief.methodology.notes.join(' ')).not.toContain('withheld');
      for (const { where, text } of texts) {
        expect(lintText(text, where), where).toEqual([]);
        expect(claimsAgainst(text), where).toEqual([]);
      }
    },
  );
});
