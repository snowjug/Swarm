import { describe, expect, it } from 'vitest';
import {
  CONCERN_CUES,
  NEGATION_ENDING,
  NEGATION_PHRASES,
  NEGATION_WORDS,
  SUPPORT_CUES,
  countDirections,
  describeDirections,
  directionOf,
  hasStakes,
  readCited,
  readTone,
  toneRationale,
} from '../src/stakeholders/tone.js';
import { keyOf } from '../src/stakeholders/mentions.js';

/** The cue words that count for a group named in a sentence. */
const cuesFor = (sentence: string, name: string) =>
  readCited([sentence], {
    key: keyOf(name),
    own: new Set(name.toLowerCase().split(' ')),
  });

describe('the two lists of cue words', () => {
  const all = [...CONCERN_CUES, ...SUPPORT_CUES];

  it('are plain lower-case words and short phrases, each listed once', () => {
    for (const entry of all) expect(entry, entry).toMatch(/^[a-z]+(?: [a-z]+){0,2}$/u);
    expect(new Set(CONCERN_CUES).size).toBe(CONCERN_CUES.length);
    expect(new Set(SUPPORT_CUES).size).toBe(SUPPORT_CUES.length);
  });

  it('never put one word on both sides, so that a cue cannot count both ways', () => {
    const support = new Set(SUPPORT_CUES);
    for (const entry of CONCERN_CUES) expect(support.has(entry), entry).toBe(false);
    const words = (list: readonly string[]) => new Set(list.flatMap((entry) => entry.split(' ')));
    // A phrase may use a word that the other list has ("pay more"), but never start with one.
    const supportStarts = new Set(SUPPORT_CUES.map((entry) => entry.split(' ')[0]));
    for (const entry of CONCERN_CUES)
      expect(supportStarts.has(entry.split(' ')[0]), entry).toBe(false);
    expect(words(CONCERN_CUES).size).toBeGreaterThan(100);
    expect(words(SUPPORT_CUES).size).toBeGreaterThan(40);
  });

  it('carry the everyday words a person would expect of each kind', () => {
    for (const word of [
      'worry',
      'concerned',
      'uneasy',
      'risk',
      'oppose',
      'resist',
      'dislike',
      'fear',
    ]) {
      expect(CONCERN_CUES, word).toContain(word);
    }
    for (const phrase of ['burden', 'delay', 'who pays', 'cost rise', 'be charged']) {
      expect(CONCERN_CUES, phrase).toContain(phrase);
    }
    for (const word of ['welcome', 'like', 'favour', 'benefit', 'gain', 'save', 'enjoy']) {
      expect(SUPPORT_CUES, word).toContain(word);
    }
  });

  it('turn a cue round with a short list of words, which is listed too', () => {
    for (const word of ['no', 'not', 'never', 'without', 'nobody', 'cannot']) {
      expect(NEGATION_WORDS).toContain(word);
    }
    expect(NEGATION_ENDING).toBe("n't");
    expect(NEGATION_PHRASES).toContain('free of');
  });
});

describe('reading the tone of a sentence', () => {
  it('finds concern, support, both or neither, and says each cue once, as listed', () => {
    expect(readTone('The managers worry about the delay.')).toMatchObject({
      concern: ['worry', 'delay'],
      support: [],
    });
    expect(readTone('Customers welcome the change and enjoy the speed.')).toMatchObject({
      concern: [],
      support: ['welcome', 'enjoy'],
    });
    expect(readTone('Managers like the idea but are uneasy about the notice.')).toMatchObject({
      concern: ['uneasy'],
      support: ['like'],
    });
    expect(readTone('The managers met on Monday.')).toMatchObject({ concern: [], support: [] });
    expect(readTone('Worried staff worry, and worried staff worry.').concern).toEqual([
      'worried',
      'worry',
    ]);
  });

  it('reads a cue in any case, and with a curly apostrophe in a negation', () => {
    expect(readTone('Staff WORRY about it.').concern).toEqual(['worry']);
    expect(readTone('Staff don’t dislike it.')).toMatchObject({
      concern: [],
      negated: ['dislike'],
    });
  });

  it('lets a negation within three words before a cue turn it round', () => {
    for (const sentence of [
      'There is no concern about the change.',
      'Staff are not worried.',
      'Nobody objected.',
      'The partner doesn’t dislike it.',
      'The plan goes ahead without any risk.',
      'There is a lack of concern among staff.',
    ]) {
      const tone = readTone(sentence);
      expect(tone.concern, sentence).toEqual([]);
      expect(tone.negated.length, sentence).toBeGreaterThan(0);
    }
  });

  it('lets a negation reach no further than three words, or past a comma', () => {
    expect(readTone('Not once did the board say so, and staff worry about it.').concern).toEqual([
      'worry',
    ]);
    const tone = readTone('Nobody objected, concerns were raised.');
    expect(tone.concern).toEqual(['concerns']);
    expect(tone.negated).toEqual(['objected']);
    expect(readTone('Not every manager at the firm is worried.').concern).toEqual(['worried']);
  });

  it('reads a cue that means something else as nothing', () => {
    for (const sentence of [
      'It looks like the plan.',
      'Staff would like a guide.',
      'Tools like email stay.',
      'The partner that supports the tenant bills by the hour.',
      'The support team handles the tickets.',
      'The risk reviewers met on Monday.',
      'Competitor A charges $22 per seat each month.',
      'The delivery cost was compared with other sellers.',
      'Any workload moved to the other region keeps running.',
    ]) {
      const tone = readTone(sentence);
      expect([...tone.concern, ...tone.support], sentence).toEqual([]);
    }
  });

  it('counts a cue that means what it says in the same words', () => {
    expect(readTone('Staff like the guide.').support).toEqual(['like']);
    expect(readTone('Managers would support the change.').support).toEqual(['support']);
    expect(readTone('Managers are in support of the change.').support).toEqual(['in support of']);
    expect(readTone('A cost rise would fall on vendors.').concern).toEqual(['cost rise']);
    expect(readTone('Finance asked who pays.').concern).toEqual(['who pays']);
    expect(readTone('Staff expect an extra workload.').concern).toEqual(['extra workload']);
    expect(readTone('Orders take longer to pack.').concern).toEqual(['take longer']);
  });

  it('is the same for the same sentence every time', () => {
    const sentence = 'Managers like the idea but are uneasy about the notice.';
    expect(readTone(sentence)).toEqual(readTone(sentence));
  });
});

describe('whose tone it is', () => {
  it('gives every cue to the one group a sentence names', () => {
    expect(
      cuesFor('Customers enjoy the speed and would complain if it went.', 'customers'),
    ).toEqual({
      concern: ['complain'],
      support: ['enjoy'],
    });
  });

  it('gives a cue to the group named just before it, not to one named after', () => {
    const sentence =
      'Department managers like the idea but are uneasy about clients receiving summaries.';
    expect(cuesFor(sentence, 'manager')).toEqual({ concern: ['uneasy'], support: ['like'] });
    expect(cuesFor(sentence, 'client')).toEqual({ concern: [], support: [] });
  });

  it('does not make a group named in a reason the one that would object', () => {
    const sentence =
      'The firm has no estimate of how many customers would object to a move, because the sales team has not been asked.';
    expect(cuesFor(sentence, 'customer')).toEqual({ concern: ['object to'], support: [] });
    expect(cuesFor(sentence, 'sales team')).toEqual({ concern: [], support: [] });
  });

  it('gives a cue to the group it lands on when none comes before it', () => {
    expect(cuesFor('The new charge falls on customers.', 'customer').concern).toEqual([
      'new charge',
    ]);
    expect(cuesFor('Unhappy customers wrote in.', 'customer').concern).toEqual(['unhappy']);
    expect(cuesFor('A concern for staff was raised.', 'staff').concern).toEqual(['concern']);
  });

  it('does not give a cue to a group named further on, which it is more likely about someone else', () => {
    expect(cuesFor('The chief wants better revenue per customer.', 'customer')).toEqual({
      concern: [],
      support: [],
    });
    expect(
      cuesFor('They would be unwilling to explain a rise to their own clients.', 'client'),
    ).toEqual({ concern: [], support: [] });
  });

  it('never reads the words of a group’s own name as its tone', () => {
    expect(cuesFor('The risk committee met.', 'risk committee')).toEqual({
      concern: [],
      support: [],
    });
    expect(cuesFor('The support desk would support the change.', 'support desk').support).toEqual(
      [],
    );
  });

  it('reads every sentence cited for a group and lists each cue once', () => {
    const cited = readCited(
      ['Staff worry about it.', 'Staff worry and staff enjoy it.', 'Staff met on Monday.'],
      { key: 'staff', own: new Set(['staff']) },
    );
    expect(cited).toEqual({ concern: ['worry'], support: ['enjoy'] });
  });
});

describe('the direction a reading gives', () => {
  it('is harmed for concern only, benefited for support only, mixed for both and unclear for neither', () => {
    expect(directionOf(2, 0)).toBe('harmed');
    expect(directionOf(0, 1)).toBe('benefited');
    expect(directionOf(1, 1)).toBe('mixed');
    expect(directionOf(0, 0)).toBe('unclear');
  });

  it('says in the rationale which words were counted, and that it is a reading of tone, not a finding', () => {
    expect(toneRationale(['uneasy', 'delay'], [])).toBe(
      'Concern cues in the cited passage: “uneasy”, “delay”. This is a reading of tone from the cited passage, not a finding.',
    );
    expect(toneRationale([], ['welcome'])).toBe(
      'Support cues in the cited passage: “welcome”. This is a reading of tone from the cited passage, not a finding.',
    );
    expect(toneRationale(['uneasy'], ['like'])).toContain(
      'Concern cues in the cited passage: “uneasy”; support cues: “like”, so the direction is mixed.',
    );
  });

  it('keeps a rationale within the room the contract gives it, however many cues there were', () => {
    const many = CONCERN_CUES.slice(0, 40);
    const rationale = toneRationale(many, SUPPORT_CUES.slice(0, 40));
    expect(rationale.length).toBeLessThan(400);
    expect(rationale).toContain('and 36 more');
    expect(rationale).toContain('not a finding');
  });
});

describe('whether anything is at stake for a group in a sentence', () => {
  it('is so when something is decided, paid for, at risk or felt', () => {
    for (const sentence of [
      'The managers decide which features are on.',
      'The staff pay for it themselves.',
      'Staff are exposed to the outage.',
      'Staff worry about the notice.',
      'Staff welcome the notice.',
    ]) {
      expect(hasStakes(sentence), sentence).toBe(true);
    }
  });

  it('is not so for a role that is only named', () => {
    expect(hasStakes('The manager met the team on Monday.')).toBe(false);
    expect(hasStakes('About 3,900 employees use it in a typical week.')).toBe(false);
  });
});

describe('saying where the directions came from', () => {
  const stakeholder = (
    direction: 'harmed' | 'benefited' | 'mixed' | 'unclear',
    origin?: 'evidence' | 'system-assumption' | 'model' | 'user',
    status = 'proposed',
  ) => ({ status, expectedImpact: { direction, origin } });

  it('counts each way a direction came about, and leaves out what was removed', () => {
    const counts = countDirections([
      stakeholder('harmed', 'evidence'),
      stakeholder('mixed', 'evidence'),
      stakeholder('harmed', 'system-assumption'),
      stakeholder('benefited', 'model'),
      stakeholder('mixed', 'user'),
      stakeholder('unclear', 'system-assumption'),
      stakeholder('unclear'),
      stakeholder('harmed', 'evidence', 'removed'),
    ]);
    expect(counts).toEqual({ total: 7, wording: 2, category: 1, stated: 2, unclear: 2 });
  });

  it('says it plainly: how many were read from wording and how many remain unclear', () => {
    expect(
      describeDirections({ total: 25, wording: 7, category: 2, stated: 0, unclear: 16 }, 'groups'),
    ).toBe(
      '7 of 25 groups have a direction of impact read from the wording of their cited sentences; 2 take the default of their category; 16 remain unclear, so the change cannot move them.',
    );
    expect(
      describeDirections({ total: 4, wording: 1, category: 0, stated: 1, unclear: 2 }, 'actors'),
    ).toBe(
      '1 of 4 actors have a direction of impact read from the wording of their cited sentences; 1 were set by a model or a person; 2 remain unclear, so the change cannot move them.',
    );
  });

  it('says so when nothing could be read, and what that means for the change', () => {
    const sentence = describeDirections(
      { total: 5, wording: 0, category: 0, stated: 0, unclear: 5 },
      'groups',
    );
    expect(sentence).toContain('No direction of impact could be read from the wording');
    expect(sentence).toContain('all 5 groups are unclear');
    expect(sentence).toContain('cannot move any of them');
    expect(
      describeDirections({ total: 0, wording: 0, category: 0, stated: 0, unclear: 0 }, 'groups'),
    ).toBe('');
  });
});
