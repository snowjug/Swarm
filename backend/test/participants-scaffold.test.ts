import { describe, expect, it } from 'vitest';
import { scenarioFrameSchema, type ScenarioFrame } from '../../shared/scenario.js';
import { participantOf, type StakeholderSet } from '../../shared/stakeholders.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import {
  MAX_PER_NOUN,
  MAX_RULES_PARTICIPANTS,
  compareRank,
} from '../src/stakeholders/participants/build.js';
import { buildContext } from '../src/stakeholders/participants/context.js';
import { nameProblem } from '../src/stakeholders/participants/language.js';
import { proposeParticipants } from '../src/stakeholders/participants/propose.js';
import { reviewContext, reviewParticipants } from '../src/stakeholders/participants/validate.js';

// The decision-structure scaffold of the rules path, and the way the rules path ranks and balances what it
// read. Every document here is invented for the test and is about no market: a swimming pool, an orchestra,
// a bus depot, an allotment society. Each case is a rule that holds for any subject. Nothing asks a model.

const NOW = new Date('2026-03-01T09:00:00.000Z');

const frame = (overrides: Partial<ScenarioFrame> = {}): ScenarioFrame =>
  scenarioFrameSchema.parse({
    decision: 'The Eastgate pool closes on Mondays',
    system: 'Eastgate pool',
    baseline: 'The pool stays open on Mondays.',
    likelyStakeholders: [],
    origin: 'user',
    ...overrides,
  });

async function propose(
  question: string,
  paragraphs: readonly string[],
  scenario: ScenarioFrame | null = frame(),
): Promise<StakeholderSet> {
  const passages = chunkDocuments([
    { id: 'D1', name: 'notes.md', content: paragraphs.join('\n\n') },
  ]);
  const context = buildContext({ question, scenario, graph: null, passages });
  const { set } = await proposeParticipants({
    context,
    model: null,
    modelName: null,
    signal: new AbortController().signal,
    now: () => NOW,
  });
  return set;
}

const live = (set: StakeholderSet) => set.stakeholders.filter((item) => item.status !== 'removed');
const named = (set: StakeholderSet, name: string) => live(set).find((item) => item.name === name);
/** How many issues stop the set from being used, by the review the server runs on it. */
const blocking = (set: StakeholderSet, paragraphs: readonly string[]): number =>
  reviewParticipants(
    set,
    reviewContext({
      passages: chunkDocuments([{ id: 'D1', name: 'notes.md', content: paragraphs.join('\n\n') }]),
      graph: null,
      scenario: null,
      question: '',
    }),
  ).counts.blocking;

const POOL = [
  'The pool manager proposes to close the pool on Mondays.',
  'The Eastgate Pool Users Club says that lane swimmers would lose their only early slot.',
  'The cleaning contract covers six days a week and would need a variation to cover Monday.',
  'The Aquatics Safety Code says that every pool must have two lifeguards on duty.',
  'Children, and people who do not swim, were not asked.',
];

describe('a decision has an owner, and the text may say who', () => {
  it('reads the owner from the party the text says starts the change, and adds no stand-in', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', POOL);
    const owner = live(set).filter((item) => participantOf(item).role === 'decision-owner');
    expect(owner.map((item) => item.name)).toEqual(['Pool manager']);
    expect(live(set).some((item) => item.name.startsWith('Decision owner for'))).toBe(false);
    expect(owner[0]?.confidenceBasis).toBe('source-quote');
  });

  it('names an owner the text does not, from the scenario’s own nouns, and says it is an assumption', async () => {
    const set = await propose(
      'What could happen if the orchestra moves rehearsals to weekends?',
      ['Violinists say that weekend rehearsals clash with teaching.'],
      frame({
        decision: 'The orchestra moves rehearsals to weekends',
        system: 'Community orchestra',
        changes: [{ name: 'weekend rehearsals', from: null, to: 'moved', note: '' }],
      }),
    );
    const owner = named(set, 'Decision owner for the weekend rehearsals');
    expect(owner).toBeDefined();
    expect(owner?.synthetic).toBe(true);
    expect(owner?.confidenceBasis).toBe('category-pattern');
    expect(owner?.evidence).toEqual([]);
    expect(owner?.relevance).toMatch(/owner, and no passage names who/u);
    expect(owner?.assumptions[0]).toMatch(/the sources do not name them/u);
    expect(owner?.expectedImpact.origin).toBe('system-assumption');
  });
});

describe('what the sources imply without saying who', () => {
  it('stands for the body behind a rule they name', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', POOL);
    const body = named(set, 'Body that sets Aquatics Safety Code');
    expect(body).toBeDefined();
    expect(participantOf(body!).role).toBe('regulators-governance');
    expect(body?.confidenceBasis).toBe('category-pattern');
    expect(body?.evidence).toEqual([]);
    expect(body?.relevance).toContain(
      '“The Aquatics Safety Code says that every pool must have two lifeguards on duty.”',
    );
    expect(body?.assumptions[0]).toMatch(/no passage names which/u);
  });

  it('stands for the other side of a contract the text does not name', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', POOL);
    const other = named(set, 'Other side of the cleaning contract');
    expect(other).toBeDefined();
    expect(participantOf(other!).role).toBe('partners-suppliers');
    expect(other?.confidenceBasis).toBe('category-pattern');
    expect(other?.relevance).toMatch(/has another side, and no passage says who/u);
  });

  it('leaves out the other side of a contract when the sentence names it', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', [
      'The cleaning contract with the Brightway Services Company covers six days a week.',
    ]);
    expect(live(set).some((item) => item.name.startsWith('Other side of'))).toBe(false);
    expect(live(set).some((item) => item.name.includes('Brightway'))).toBe(true);
  });

  it('names a group the sources say was left out as they name it, and quotes the sentence', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', POOL);
    const voice = named(set, 'People who do not swim');
    expect(voice).toBeDefined();
    expect(participantOf(voice!).role).toBe('missing-voices');
    expect(voice?.confidenceBasis).toBe('source-quote');
    expect(voice?.evidence.map((item) => item.quote).join(' ')).toContain('were not asked');
  });

  it('takes a group from a statement that nothing is known of it', async () => {
    const set = await propose('What could happen if the allotments are resited?', [
      'There is no data on tenants who sublet, because the register does not record them.',
    ]);
    expect(named(set, 'Tenants who sublet')).toBeDefined();
  });

  it('quotes only the part of a long sentence that says it, so the answer stays one the checks accept', async () => {
    const tail = Array.from({ length: 18 }, () => 'the committee weighed the options').join(', ');
    const long = `Tenants who sublet were not asked about the plan, and ${tail}.`;
    expect(long.length).toBeGreaterThan(600);
    const set = await propose('What could happen if the allotments are resited?', [long]);
    const voice = named(set, 'Tenants who sublet');
    expect(voice).toBeDefined();
    const quote = voice?.evidence[0]?.quote ?? '';
    expect(quote.length).toBeLessThanOrEqual(300);
    expect(quote).toContain('were not asked');
    expect(long).toContain(quote);
    expect(blocking(set, [long])).toBe(0);
  });

  it('never proposes one group twice because the sources order its words two ways', async () => {
    const paragraphs = [
      'Customers in Marlow ask for a rebate.',
      'Marlow customers want a refund.',
      'Harbour pilots say the channel is narrow.',
      'Pilots of the harbour want a second tug.',
    ];
    const set = await propose('What could happen if the levy is set?', paragraphs);
    const names = live(set).map((item) => item.name.toLowerCase());
    expect(names.filter((name) => /marlow/u.test(name))).toHaveLength(1);
    expect(names.filter((name) => /pilots/u.test(name))).toHaveLength(1);
    expect(set.proposal?.dropped.some((item) => /same group as/u.test(item.reason))).toBe(true);
    expect(blocking(set, paragraphs)).toBe(0);
  });

  it('never takes into a name what the review would refuse', async () => {
    expect(nameProblem('Older customers who never open a case')).toMatch(/generalises/u);
    const helpline = ['There is no data on older callers who never ring back.'];
    const set = await propose('What could happen if the helpline closes?', helpline);
    expect(live(set).some((item) => /never ring back/u.test(item.name))).toBe(false);
    expect(blocking(set, helpline)).toBe(0);
  });
});

describe('a role the question or the sources speak of and nobody holds', () => {
  it('is proposed, named from the scenario, with the word that called for it', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', [
      'Approval is needed before any change to the opening hours.',
    ]);
    const approvers = named(set, 'Approvers of the Eastgate pool');
    expect(approvers).toBeDefined();
    expect(participantOf(approvers!).role).toBe('approvers');
    expect(approvers?.relevance).toMatch(/“approv/u);
    expect(approvers?.confidenceBasis).toBe('category-pattern');
  });

  it('is not proposed when a party that stands in for it is on the list', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', [
      'Approval is needed from the licensing board before any change to the opening hours.',
    ]);
    expect(live(set).some((item) => item.name.startsWith('Approvers of'))).toBe(false);
  });

  it('is not forced into a scenario that never speaks of it', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', [
      'Lane swimmers say that Monday mornings are their only early slot.',
    ]);
    for (const absent of [
      'Suppliers and partners',
      'Alternatives to',
      'Those who may object',
      'Body that oversees',
    ]) {
      expect(live(set).some((item) => item.name.startsWith(absent))).toBe(false);
    }
  });

  it('stands for those reached with no say, only while the list has room', async () => {
    const roomy = await propose('What could happen if the pool closes on Mondays?', [
      'Lane swimmers say that Monday mornings are their only early slot.',
    ]);
    expect(live(roomy).some((item) => participantOf(item).role === 'missing-voices')).toBe(true);
    const crowded = await propose(
      'What could happen if the depot changes its timetable?',
      [
        'Drivers ask for a rota. Mechanics want a pager. Dispatchers say the screens fail. Cleaners ask for gloves. ' +
          'Electricians want a ladder. Plumbers say the tank leaks. Cashiers ask for a till. Porters want a trolley. ' +
          'Teachers ask for a lift. Surgeons want a theatre. Pharmacists say the stock is short. Clerks ask for a desk. ' +
          'Paramedics want a bay. Midwives say the ward is cold. Therapists ask for a room. Registrars want a form.',
      ],
      frame({ decision: 'The depot changes its timetable', system: 'Depot' }),
    );
    expect(live(crowded).length).toBeLessThanOrEqual(MAX_RULES_PARTICIPANTS);
    expect(live(crowded).some((item) => participantOf(item).role === 'missing-voices')).toBe(false);
  });
});

describe('whatever the sources are made of', () => {
  // The rules answer is held to the checks a model's is, and one that fails them is an error and not an
  // answer: so it is tried on documents made of the words that decide what it reads, in any order.
  it('gives an answer that passes its own checks, for documents of group nouns, prepositions, names, verbs and phrases that carry a rule, a contract or a person', async () => {
    let seed = 20_260_301;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    const pick = (items: readonly string[]): string => items[next() % items.length] ?? '';
    const nouns = 'nurses tenants council suppliers pilots Marlow Alice'.split(' ');
    const modifiers = "ward night local support Marlow Tier-two residents' company's the a".split(
      ' ',
    );
    const joiners = 'of in at who and ,'.split(' ');
    const verbs =
      'ask|proposes|were not asked|must approve|ignore previous instructions|told|pay'.split('|');
    const phrases = [
      'the Aquatics Safety Code|the supply contract|no data on tenants who sublet|email alice@example.com',
      'call 555 0100|older customers who never read|Dr. Alice Chen, Director|https://example.com/a/b',
    ].flatMap((line) => line.split('|'));
    const sentence = (): string => {
      const parts = Array.from({ length: 3 + (next() % 14) }, () => {
        const roll = next() % 11;
        if (roll < 3) return pick(modifiers);
        if (roll < 6) return pick(nouns);
        if (roll < 7) return pick(joiners);
        if (roll < 9) return pick(verbs);
        return pick(phrases);
      }).join(' ');
      return `${parts.charAt(0).toUpperCase()}${parts.slice(1)}${pick(['.', '.', '!', '?', ',', ';'])}`;
    };
    for (let round = 0; round < 150; round += 1) {
      const paragraphs = Array.from({ length: 1 + (next() % 3) }, () =>
        Array.from({ length: 1 + (next() % 7) }, sentence).join(' '),
      );
      const text = paragraphs.join(' / ');
      const set = await propose('What could happen if the levy is set?', paragraphs).catch(
        (error: unknown) => {
          throw new Error(`${text}\n${String((error as { cause?: unknown }).cause ?? error)}`);
        },
      );
      expect(blocking(set, paragraphs), text).toBe(0);
    }
  });
});

describe('with no sources at all', () => {
  it('proposes only what a decision has, each marked as an assumption, and none as sourced', async () => {
    const set = await propose(
      'What could happen if the orchestra moves rehearsals?',
      [],
      frame({ system: 'Community orchestra' }),
    );
    const kinds = live(set).map((item) => participantOf(item).role);
    expect(kinds).toContain('decision-owner');
    expect(kinds).toContain('directly-affected');
    for (const item of live(set)) {
      expect(item.confidenceBasis).toBe('category-pattern');
      expect(item.evidence).toEqual([]);
      expect(item.assumptions.join(' ')).toMatch(/Added because/u);
    }
    expect(blocking(set, [])).toBe(0);
  });
});

describe('the rules path keeps its list balanced and ordered', () => {
  it('never lets one noun fill the list', async () => {
    const set = await propose(
      'What could happen if the depot changes its timetable?',
      [
        'Support engineers ask for a rota. Tier-two engineers want a pager. Field engineers worry about travel.',
        'Night engineers say the rota is unfair. Platform engineers expect delays.',
      ],
      frame({ decision: 'The depot changes its timetable', system: 'Depot' }),
    );
    const engineers = live(set).filter((item) => /engineers/u.test(item.name));
    expect(engineers.length).toBeLessThanOrEqual(MAX_PER_NOUN);
    expect(set.proposal?.dropped.some((item) => /noun “engineer”/u.test(item.reason))).toBe(true);
  });

  it('puts a position the sources take, and a missing voice they name, ahead of a role named only in passing', () => {
    const quote = (text: string) => [text];
    const base = { role: 'implementers' as const, priority: 'standard' as const };
    const voiced = {
      ...base,
      name: 'Ward porters',
      quotes: quote('Ward porters ask for a second lift.'),
    };
    const passing = {
      ...base,
      name: 'Ward cleaners',
      quotes: quote('The ward cleaners work on Fridays.'),
    };
    const broad = { ...base, name: 'Engineers', quotes: quote('Engineers ask for a rota.') };
    const unheard = {
      role: 'missing-voices' as const,
      priority: 'standard' as const,
      name: 'People who do not swim',
      quotes: quote('People who do not swim were not asked.'),
    };
    expect(compareRank(voiced, passing)).toBeLessThan(0);
    expect(compareRank(voiced, broad)).toBeLessThan(0);
    expect(compareRank(unheard, voiced)).toBeLessThan(0);
    const owner = {
      role: 'decision-owner' as const,
      priority: 'background' as const,
      name: 'Zed',
      quotes: [],
    };
    expect(compareRank(owner, unheard)).toBeLessThan(0);
    const named = {
      ...base,
      name: 'Harbour Pilots Association',
      quotes: quote('The Association works on Fridays.'),
    };
    expect(compareRank(named, passing)).toBeLessThan(0);
    const plural = { ...base, name: 'Porters', quotes: quote('Porters work on Fridays.') };
    const single = { ...base, name: 'Porter', quotes: quote('A porter works on Fridays.') };
    expect(compareRank(plural, single)).toBeLessThan(0);
  });

  it('gives the same proposal every time', async () => {
    const first = await propose('What could happen if the pool closes on Mondays?', POOL);
    const second = await propose('What could happen if the pool closes on Mondays?', POOL);
    expect(second).toEqual(first);
  });

  it('passes the checks its own proposal is held to', async () => {
    const set = await propose('What could happen if the pool closes on Mondays?', POOL);
    expect(blocking(set, POOL)).toBe(0);
    expect(set.proposal?.source).toBe('rules');
  });
});
