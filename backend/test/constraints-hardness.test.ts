import { describe, expect, it } from 'vitest';
import type { EvidenceChunk } from '../../shared/types.js';
import { buildConstraints, hardnessOf } from '../src/constraints/build.js';
import { detectIn, guessCategory } from '../src/constraints/detect.js';
import { limitSupport, readHardness } from '../src/constraints/deontic.js';
import { HARD_CUE } from '../src/constraints/lexicon.js';
import type { Proposal } from '../src/constraints/types.js';
import { digest } from './support/constraint-world.js';

/**
 * How a limit is told from a wish. Every sentence here is written for this test, in settings (a bakery, a
 * museum, a bike-share, a greenhouse) that no evaluation scenario is about, so that what is shown is the
 * rule and not a fit to the sentences it was first run on.
 */

describe('reading a sentence for a limit that holds', () => {
  const HOLDS: readonly (readonly [sentence: string, shown: string, family: string])[] = [
    ['Every stallholder must display a valid permit.', 'must', 'obligation'],
    ['Visitors have to leave their bags at the desk.', 'have to', 'obligation'],
    ['A licence is required before the kitchen can open.', 'required', 'obligation'],
    ['Attendance at the briefing is mandatory.', 'mandatory', 'obligation'],
    [
      'The new oven needs a safety inspection before it is switched on.',
      'needs … before',
      'obligation',
    ],
    [
      'The venue needs the fire marshal’s sign-off for opening night.',
      'needs the fire marshal’s sign-off',
      'obligation',
    ],
    [
      'The seating plan needs two clear weeks before the opening night.',
      'needs … before',
      'obligation',
    ],
    ['Drivers must not carry more than four passengers.', 'must not', 'prohibition'],
    ['Pets are not allowed in the greenhouse.', 'not allowed', 'prohibition'],
    ['No visitor may enter the vault alone.', 'No visitor may', 'prohibition'],
    ['Smoking is prohibited on the platform.', 'prohibited', 'prohibition'],
    ['The tenant cannot sublet the unit.', 'cannot', 'prohibition'],
    ['Entry is capped at 200 people per session.', 'capped', 'bound'],
    ['Deliveries may not exceed three vans a day.', 'may not', 'prohibition'],
    ['The class needs a minimum of eight students.', 'minimum', 'bound'],
    ['The kiln is at capacity until June.', 'at capacity', 'bound'],
    ['The cooperative will not raise the rent above £900 a month.', 'will not … above', 'bound'],
    ['The side door opens only when the alarm is off.', 'only when', 'condition'],
    ['The prize fund is used only for travel costs.', 'used only for', 'condition'],
    ['Customers have the right to a refund within a fortnight.', 'the right to', 'binding'],
    ['Noise limits are set by law.', 'by law', 'binding'],
    ['The supplier is contractually bound to deliver on Fridays.', 'contractually', 'binding'],
    ['The entry deadline is 15 March.', 'deadline … 15 March', 'fixed'],
    ['The lease on the unit expires in 2031.', 'lease … expires in 2031', 'fixed'],
  ];

  it.each(HOLDS)(
    'reads “%s” as a limit that holds, on the words “%s”',
    (sentence, shown, family) => {
      const reading = readHardness(sentence);
      expect(reading.hard, sentence).toBe(true);
      expect(reading.cue?.shown, sentence).toBe(shown);
      expect(reading.cue?.family, sentence).toBe(family);
    },
  );

  /** Each carries a word that could make a limit hard, and none states one: the words are asked for, hoped, said, possible or denied. */
  const NOT_LIMITS: readonly (readonly [sentence: string, why: string])[] = [
    ['Ideally the stall opens by nine and stays open at least until dusk.', 'asked-for'],
    ['The team would like a minimum of two cashiers on each shift.', 'asked-for'],
    ['It would be good to have at least two cashiers.', 'asked-for'],
    ['The council aims to cap bike hire at two hours.', 'asked-for'],
    ['The residents ask that the pool stay open at least until nine.', 'asked-for'],
    ['The union insists that no one may work a double shift.', 'asked-for'],
    ['Customers requested that refunds must be instant.', 'asked-for'],
    ['Traders say they cannot afford the new fee.', 'asked-for'],
    ['Neighbours feel the noise must stop.', 'asked-for'],
    [
      'Cyclists worry that the lane would have to close for the market, because the stalls need to be set up before dawn.',
      'asked-for',
    ],
    ['The organiser assumed it applied only to the larger stalls.', 'asked-for'],
    ['The venue may need to apply for a licence.', 'hedged'],
    ['Some visitors might have to queue.', 'hedged'],
    ['Parking is usually capped at two hours.', 'hedged'],
    ['Staff typically cannot take leave in December.', 'hedged'],
    ['If the lift cannot be repaired, the upper rooms close.', 'hedged'],
    ['Check whether permits are required for small stalls.', 'hedged'],
    [
      'Opening on Sundays would cut the weekly rest below two days unless a rota is agreed.',
      'hedged',
    ],
    ['A permit is not required for small stalls.', 'negated'],
    ['Visitors do not have to register.', 'negated'],
    ['There is no need to book in advance.', 'negated'],
    ['The figure must not be read as a forecast.', 'interpretive'],
    ['We cannot say how many will come.', 'interpretive'],
    ['The cost must have been higher last year.', 'interpretive'],
    ['At least 40% of visitors said the queue was too long.', 'interpretive'],
    ['Sales rose by at most 3% in March.', 'interpretive'],
  ];

  it.each(NOT_LIMITS)('does not read “%s” as a limit that holds', (sentence, why) => {
    // The test means something only if a word that could make it a limit is in it.
    expect(HARD_CUE.test(sentence), sentence).toBe(true);
    const reading = readHardness(sentence);
    expect(reading.hard, sentence).toBe(false);
    expect(reading.cancelled?.why, sentence).toBe(why);
  });

  it('reads a preference as no limit at all, whatever it says it would like', () => {
    for (const sentence of [
      'We would like to keep the price low.',
      'Staff should wear aprons.',
      'The team prefers a phased launch.',
      'Hopefully the stall opens by nine.',
      'Preferably the order arrives before noon.',
      'The shop ought to open earlier.',
    ]) {
      expect(readHardness(sentence).hard, sentence).toBe(false);
    }
  });

  it('keeps a rule that mentions what someone wants, when the rule is its own clause', () => {
    // "wants to enter" is not a demand that the pass be shown; the rule stands.
    expect(readHardness('Anyone who wants to enter must show a pass.').hard).toBe(true);
    // A rule reported by a body that lays it down is a rule, not a view.
    expect(readHardness('The code says that a seller must state its terms.').hard).toBe(true);
    // A request in one clause does not undo a rule in the next.
    expect(
      readHardness(
        'The members ask for a month’s notice of any change, and the charter says no one may be moved twice.',
      ).hard,
    ).toBe(true);
  });

  it('reads a clause that explains a wish or a fear as part of it', () => {
    expect(
      readHardness(
        'Growers worry about the cold snap, because the seedlings would have to be moved indoors.',
      ).hard,
    ).toBe(false);
  });

  it('reads a question as stating no limit', () => {
    expect(readHardness('Must every stallholder display a permit?').hard).toBe(false);
  });
});

describe('what a model may add to what the words say', () => {
  const quoted = (text: string) => [text];

  it('holds a limit hard for the words that state it, and says which', () => {
    expect(
      hardnessOf({
        source: 'extracted',
        proposal: { hardness: 'soft', origin: { kind: 'model' }, statement: '' },
        quotes: quoted('Every stallholder must display a valid permit.'),
      }),
    ).toEqual({ hardness: 'hard', basis: 'Hard because the source says “must”.' });
  });

  it('does not let a model lower what the words state', () => {
    expect(
      hardnessOf({
        source: 'extracted',
        proposal: { hardness: 'soft', origin: { kind: 'model' }, statement: '' },
        quotes: quoted('Drivers must not carry more than four passengers.'),
      }).hardness,
    ).toBe('hard');
  });

  it('lets a model raise a limit its quote bears out with a word of limits, and says so', () => {
    const raised = hardnessOf({
      source: 'extracted',
      proposal: { hardness: 'hard', origin: { kind: 'model' }, statement: '' },
      quotes: quoted('The kitchen has response-time commitments to its largest customers.'),
    });
    expect(raised.hardness).toBe('hard');
    expect(raised.basis).toMatch(
      /^A model read it as a firm limit, and the source’s words \(“commitments”\)/u,
    );
  });

  it('does not let a model make a fact, a wish or a guess a limit', () => {
    for (const quote of [
      'The bakery sells about four hundred loaves a day.',
      'The cooks would like Mondays off.',
      'Customers on the late shift may need to queue.',
      'It is not yet decided how the rota will work.',
      'The stalls near the gate are busiest at noon.',
    ]) {
      const read = hardnessOf({
        source: 'extracted',
        proposal: { hardness: 'hard', origin: { kind: 'model' }, statement: '' },
        quotes: quoted(quote),
      });
      expect(read.hardness, quote).toBe('soft');
    }
  });

  it('never raises what a rule read, only what a model read', () => {
    const fromRules = hardnessOf({
      source: 'extracted',
      proposal: { hardness: 'hard', origin: { kind: 'passage', passageId: 'S1' }, statement: '' },
      quotes: quoted('The kitchen has response-time commitments to its largest customers.'),
    });
    expect(fromRules.hardness).toBe('soft');
  });

  it('says why a limit that looks hard is held soft', () => {
    expect(
      hardnessOf({
        source: 'extracted',
        proposal: { hardness: 'hard', origin: { kind: 'model' }, statement: '' },
        quotes: quoted('The team would like a minimum of two cashiers on each shift.'),
      }),
    ).toEqual({
      hardness: 'soft',
      basis:
        'Soft: the source says “minimum”, but as something someone asks for, which is not a rule.',
    });
  });

  it('never holds a guess hard, and reads a person’s words as theirs', () => {
    expect(
      hardnessOf({
        source: 'inferred',
        proposal: { hardness: 'hard', origin: { kind: 'model' }, statement: '' },
        quotes: [],
      }).hardness,
    ).toBe('soft');
    expect(
      hardnessOf({
        source: 'user',
        proposal: {
          hardness: 'hard',
          origin: { kind: 'question' },
          statement: 'The stall must be packed away by six.',
        },
        quotes: [],
      }),
    ).toEqual({ hardness: 'hard', basis: 'Hard because your words say “must”.' });
  });

  it('shows the basis on every constraint it builds', () => {
    const text = 'Every stallholder must display a valid permit. The cooks would like Mondays off.';
    const passage: EvidenceChunk = {
      id: 'S1',
      documentId: 'doc-1',
      documentName: 'doc-1.md',
      text,
      start: 0,
      end: text.length,
      contentHash: digest(text),
    };
    const proposal = (statement: string, hardness: 'hard' | 'soft'): Proposal => ({
      category: 'regulatory',
      statement,
      hardness,
      origin: { kind: 'model' },
      quotes: [{ passageId: 'S1', quote: statement }],
      affectedActorIds: [],
      affectedAlternativeIds: [],
      windowText: '',
      effects: [],
      assumptionId: null,
      rank: 2.5,
    });
    const { constraints } = buildConstraints(
      [
        proposal('Every stallholder must display a valid permit.', 'hard'),
        proposal('The cooks would like Mondays off.', 'hard'),
      ],
      {
        passages: new Map([[passage.id, passage]]),
        actorIds: new Set(),
        alternativeIds: new Set(),
        assumptionIds: new Set(),
      },
      new Set(),
    );
    expect(constraints.map((item) => [item.hardness, item.hardnessBasis])).toEqual([
      ['hard', 'Hard because the source says “must”.'],
      ['soft', 'Soft: a model called it hard, but nothing in the quoted words states a limit.'],
    ]);
  });
});

describe('limit words a model can lean on', () => {
  it('finds a word of limits that no one asks for, hedges or denies', () => {
    expect(limitSupport('The courier has a notice period of two weeks.')).toBe('notice');
    expect(limitSupport('The depot is closed to lorries over the weekend.')).toBeNull();
    expect(limitSupport('Neighbours would like a longer notice period.')).toBeNull();
    expect(limitSupport('It is not yet clear what the contract says.')).toBeNull();
  });
});

describe('finding limits in sentences that need more than one clause', () => {
  const find = (text: string) => detectIn(text, { kind: 'passage', passageId: 'S1' }).candidates;

  it('reads a clause that names the subject with the clause that goes on from it', () => {
    // "some" goes back to what the clause before it named.
    const [found] = find(
      'The heating contracts run to the end of the season, and some require ninety days’ notice.',
    );
    expect(found).toMatchObject({ category: 'contractual', hardness: 'hard', guessed: false });
    // "so" gives a consequence of what the clause before it said.
    const [consequence] = find(
      'The warehouse stock is stored under strict temperature rules, so staff cannot leave the doors open.',
    );
    expect(consequence?.hardness).toBe('hard');
  });

  it('does not join clauses that only share a sentence', () => {
    // The budget is not limited by what staff must wear, or by who must attend.
    expect(
      find(
        'The marketing budget is a matter for the board, and staff must wear their badges.',
      ).filter((item) => item.category === 'budget'),
    ).toEqual([]);
    // A quantifier before a noun starts a new subject; before a verb it stands for what was named.
    expect(
      find(
        'The marketing budget is reviewed every year, and all staff must attend the review.',
      ).filter((item) => item.category === 'budget'),
    ).toEqual([]);
  });

  it('keeps a limit that names no subject, with a category that is a guess and said to be', () => {
    const [found] = find('Customers may not take glass bottles beyond the second gate.');
    expect(found).toMatchObject({ hardness: 'hard', guessed: true, category: 'operational' });
    const [timed] = find('Every parcel must be logged within 24 hours of arrival.');
    expect(timed).toMatchObject({ hardness: 'hard', guessed: true, category: 'time' });
    const [ordered] = find('The shutters must stay down until the inspector has signed the sheet.');
    expect(ordered).toMatchObject({ guessed: true, category: 'sequencing' });
  });

  it('judges a limit that names no subject by what it is about', () => {
    expect(
      guessCategory(
        'A patient may not be moved until the clinical lead has signed the infection checklist.',
      ),
    ).toBe('safety');
    expect(
      guessCategory(
        'The vendors’ own contract terms set the cancellation window and the shop cannot change them.',
      ),
    ).toBe('contractual');
    expect(guessCategory('Staff must clock out before they leave.')).toBe('sequencing');
  });

  it('does not make a limit of a floor, an exception or a date that names nothing', () => {
    // These say nothing alone: "at least once a week" and "unless it rains" are not limits on anything.
    expect(find('Replies came mostly from adults who visit at least once a week.')).toEqual([]);
    expect(find('The match goes ahead unless the pitch is waterlogged.')).toEqual([]);
    // Nor is a noun that only names a kind of thing a limit: "requirements" is not "must".
    expect(find('The requirements for the new till are listed in the appendix.')).toEqual([]);
  });

  it('keeps a survey count a count, and a heading a heading', () => {
    expect(find('At least 40% of the members said the rota is unfair.')).toEqual([]);
    expect(find('## Who depends on the bakery in winter')).toEqual([]);
  });

  it('keeps a wish soft where it names the subject', () => {
    const [found] = find('The union asks for at least a month’s notice of any rota change.');
    expect(found).toMatchObject({ hardness: 'soft' });
  });
});
