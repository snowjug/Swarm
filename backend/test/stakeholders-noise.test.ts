import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Stakeholder, StakeholderSet } from '../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../shared/types.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { discoverStakeholders } from '../src/stakeholders/discover.js';
import { findMentions, occurrencesOf, shapeOf, wordsOf } from '../src/stakeholders/mentions.js';

// Text from a web page carries more than the page's sentences: menus, a table of contents, rows of
// links, headings and footers. They are made of the same words as a sentence about a group ("Users",
// "Management", "Business") but say nothing about it, and a person who is shown "Labour Law Management"
// as a key decision maker stops trusting the list. Every line here is invented, in the shape such text
// takes; none is copied from a page.

const NOW = new Date('2026-03-01T09:00:00.000Z');

function passagesOf(content: string): EvidenceChunk[] {
  return chunkDocuments([{ id: 'D1', name: 'page.md', content }]).map((chunk) => ({
    ...chunk,
    contentHash: createHash('sha256').update(chunk.text).digest('hex'),
  }));
}

const discover = (content: string): Promise<StakeholderSet> =>
  discoverStakeholders({
    project: { question: 'What could happen if the zone fee is raised?', graph: null },
    scenario: null,
    passages: passagesOf(content),
    model: null,
    now: () => NOW,
  });

const live = (set: StakeholderSet): Stakeholder[] =>
  set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
const names = (set: StakeholderSet): string[] => live(set).map((stakeholder) => stakeholder.name);

const PROSE = [
  'Drivers pay a daily fee to enter the central zone, and the city council decides the price each year.',
  'Residents who live inside the zone worry about noise from the extra buses, while shop owners fear fewer visitors.',
  'A rival operator has asked for the same rules, and the regulator requires notice before any change to charges takes effect.',
].join(' ');

const MENUS: [string, string][] = [
  [
    'a row of capitalised words',
    'Applications Agriculture Business Cultural Demographic Education Finance Health Industry',
  ],
  [
    'a row that ends in a word for a decision maker',
    'Labour Law Management Practice Regulation Policy Planning Risk',
  ],
  ['a row around a word for a user', 'Turnover Use User Value Variable Waste Yield'],
  ['a row with a word in lower case', 'Direct Indirect Per unit Fixed Marginal Variable Cost'],
  ['a row with a word for a kind of group', 'Complement Substitute Rival Entry Exit Barrier'],
  ['links between bars', 'Home | About | Contact | Customers | Partners | Developers | Investors'],
  ['links between dots', 'Congestion · Pricing · Road · Users · Business · Management'],
  [
    'a table of contents',
    ['1 Introduction', '2 History', '3 Methods', '3.1 Cordon schemes', '4 Users and Business'].join(
      '\n',
    ),
  ],
  ['a footer', 'Privacy policy About Disclaimers Contact Developers Statistics Cookie statement'],
  [
    'a few short labels, one under another',
    ['Customer Support', 'User Guide', 'Substitute', 'Help for developers'].join('\n'),
  ],
  [
    'a row of titles',
    'Congestion pricing in London Road pricing Toll road Vehicle Excise Duty Low emission zone',
  ],
];

describe('telling a sentence from a line that is not one', () => {
  const shape = (line: string) => shapeOf(line, wordsOf(line));

  it('calls a line that ends in a full stop a sentence, whatever it is made of', () => {
    expect(shape('Customers pay more when the fee rises.')).toBe('sentence');
    expect(shape('Applications Agriculture Business Cultural Demographic.')).toBe('sentence');
    expect(shape('Support?')).toBe('sentence');
  });

  it('calls a short line with no full stop a fragment, and numbers do not make it longer', () => {
    for (const line of [
      'Menu',
      'Customer Support',
      'Help for developers',
      '4 Users and Business',
    ]) {
      expect(shape(line), line).toBe('fragment');
    }
  });

  it('calls a line of three or more words that are nearly all capitalised a list of names', () => {
    for (const [name, line] of MENUS.slice(0, 7)) expect(shape(line), name).toBe('list');
    expect(shape('Products for Customers and Partners')).toBe('list');
  });

  it('leaves a line of prose without its full stop as a sentence, and a bulleted item as a person’s own', () => {
    expect(shape('Customers pay more when the fee rises and resellers worry')).toBe('sentence');
    expect(shape('- Customers')).toBe('sentence');
    expect(shape('Regulators want notice before any change')).toBe('sentence');
  });
});

describe('a group that only a menu names is not found', () => {
  it.each(MENUS)('finds no stakeholder in %s', async (_name, text) => {
    expect(names(await discover(text))).toEqual([]);
    expect(findMentions(passagesOf(text))).toEqual([]);
  });

  it('finds the groups the sentences name, and no name or key that a menu around them adds', async () => {
    const menu = MENUS.map(([, text]) => text).join('\n');
    const bare = await discover(PROSE);
    const mixed = await discover(`${menu}\n\n${PROSE}\n\n${menu}`);
    expect(names(mixed).sort()).toEqual(names(bare).sort());
    expect(names(mixed).length).toBeGreaterThanOrEqual(3);
    const key = (set: StakeholderSet) =>
      live(set)
        .filter((stakeholder) => stakeholder.priority === 'key')
        .map((stakeholder) => stakeholder.name)
        .sort();
    expect(key(mixed)).toEqual(key(bare));
    for (const junk of [
      'Law Management',
      'Use User',
      'Agriculture Business',
      'Substitute',
      'Per unit',
    ]) {
      expect(names(mixed).join('|')).not.toContain(junk);
    }
  });

  it('does not find, for a name the question or the graph gives, a sentence that only a menu has', () => {
    const menu = passagesOf(MENUS.map(([, text]) => text).join('\n'));
    expect(occurrencesOf(menu, 'Users')).toEqual({ found: [], sentences: 0 });
    expect(occurrencesOf(menu, 'Developers')).toEqual({ found: [], sentences: 0 });
    const prose = passagesOf(PROSE);
    expect(occurrencesOf(prose, 'Residents').sentences).toBe(1);
  });
});

describe('a heading', () => {
  const REGULATORS = [
    'The scheme was proposed last year and the debate has been long.',
    '',
    '## Regulators',
    '',
    'The agency asked for evidence before it would answer.',
  ].join('\n');

  it('names a group when it stands between sentences, since it introduces what follows', async () => {
    expect(names(await discover(REGULATORS))).toContain('Regulators');
  });

  it('names nothing when headings come one after another, which is an outline or a menu', async () => {
    const outline = ['# Notes', '## Regulators', '## Customers', '## Partners'].join('\n');
    expect(names(await discover(outline))).toEqual([]);
  });

  it('keeps a person’s own bulleted list of groups, an item each', async () => {
    const list = ['The groups are:', '- Customers', '- Resellers', '- Regulators'].join('\n');
    expect(names(await discover(list)).sort()).toEqual(['Customers', 'Regulators', 'Resellers']);
  });
});

describe('names that are joined from capitalised words', () => {
  it('makes no name of five or more capitalised words in a row, which is a list of names', async () => {
    const set = await discover(
      'The report lists Alpha Beta Gamma Delta Epsilon Partners among the sources it read.',
    );
    expect(names(set)).toEqual([]);
  });

  it('keeps a name or a title of up to four, which sentences use', async () => {
    const set = await discover(
      'The Local Council asked the Chief Executive Officer for evidence before approving the budget.',
    );
    expect(names(set)).toEqual(
      expect.arrayContaining(['Local Council', 'Chief Executive Officer']),
    );
  });
});

describe('the word substitute', () => {
  it('names a group only with a word that describes it, and never on its own', async () => {
    expect(names(await discover('A substitute was found for the missing part.'))).toEqual([]);
    expect(names(await discover('Substitute'))).toEqual([]);
  });
});

describe('a link', () => {
  it('is not read for groups: a word in its path is not a word of the sentence', async () => {
    const text = [
      'The notes were first published at https://example.org/customers/regulators/partners in March,',
      'and the page at www.example.net/users/administrators repeats them.',
    ].join(' ');
    expect(names(await discover(text))).toEqual([]);
    expect(names(await discover(`${text} Residents were asked what they thought.`))).toEqual([
      'Residents',
    ]);
  });

  it('does not join the words on each side of it into one name', async () => {
    const set = await discover('The customer https://example.org/x support answered the call.');
    expect(names(set)).toEqual(['Customer']);
  });
});

describe('a sentence written in capitals', () => {
  const SHOUTED =
    'THE CUSTOMERS WILL PAY MORE AND THE SUPPORT TEAM WILL LOSE STAFF. THE REGULATOR HAS NOT APPROVED THE CHANGE.';
  const WRITTEN =
    'The customers will pay more and the support team will lose staff. The regulator has not approved the change.';

  it('is prose, and names the groups it names when it is written in lower case', async () => {
    const written = names(await discover(WRITTEN)).sort();
    expect(written).toEqual(['Customers', 'Regulator', 'Staff', 'Support team']);
    expect(names(await discover(SHOUTED)).sort()).toEqual(written);
  });

  it('cites the sentence as it was written, and never takes "the" for a word of a name', async () => {
    const set = await discover(SHOUTED);
    const customers = live(set).find((stakeholder) => stakeholder.name === 'Customers');
    expect(customers?.evidence[0]?.quote).toBe(
      'THE CUSTOMERS WILL PAY MORE AND THE SUPPORT TEAM WILL LOSE STAFF.',
    );
    expect(findMentions(passagesOf(SHOUTED)).map((mention) => mention.key)).toEqual([
      'customer',
      'support team',
      'staff',
      'regulator',
    ]);
  });

  it('reads a legal notice in capitals for the groups it names', async () => {
    const notice =
      'THE SOFTWARE IS PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND AND THE USERS BEAR ALL RISK.';
    expect(names(await discover(notice))).toEqual(['Users']);
  });

  it('is still no list of names when it has no more than a word or two of prose: menus, footers and rows', async () => {
    for (const text of [
      'HOME CUSTOMERS SUPPORT SIGN IN ADMIN.',
      'TERMS OF USE PRIVACY POLICY CUSTOMERS PARTNERS DEVELOPERS INVESTORS.',
      'ABOUT US TERMS OF USE AND PRIVACY POLICY SUPPORT CUSTOMERS PARTNERS.',
      'HOME CUSTOMERS SUPPORT SIGN IN ADMIN',
    ]) {
      expect(names(await discover(text)), text).toEqual([]);
    }
  });
});

describe('a role word that does not name a group', () => {
  it('is not taken when it is the first word of a compound that names what a group has or uses', async () => {
    for (const text of [
      'The plan comes with more reporting and admin controls.',
      'The admin panel and the manager tools changed in March.',
      'Reseller rates and customer fees will rise, and the customer record was lost.',
      'Admin settings are shared, and the user console is new.',
    ]) {
      expect(names(await discover(text)), text).toEqual([]);
    }
  });

  it('is taken when the same words are a group that does something: a verb, or a plural subject', async () => {
    expect(names(await discover('The admin controls access to the panel.'))).toEqual(['Admin']);
    expect(
      names(await discover('Customers control the rollout, and resellers rate the offer.')).sort(),
    ).toEqual(['Customers', 'Resellers']);
    expect(names(await discover('Employees record their hours each week.'))).toEqual(['Employees']);
  });

  it('is not taken when only a count stands before it, which says how many and not who', async () => {
    for (const text of [
      'The organisation is a professional-services firm with about 4,200 employees.',
      'There are 14 groups with more than 500 members that still have access.',
      'About 3 million customers and 2 thousand partners use it.',
    ]) {
      expect(names(await discover(text)), text).toEqual([]);
    }
    expect(names(await discover('Employees were told in March.'))).toEqual(['Employees']);
    expect(names(await discover('Many members asked what the 500 new members would pay.'))).toEqual(
      ['Members'],
    );
  });

  it('is not taken when it is only the tail of a title for a function: the position alone names no group', async () => {
    for (const text of [
      'One carrier’s account manager declined to compare quotes.',
      'The records manager asked how long they are kept.',
      'Customer success managers say retailers react quickly.',
    ]) {
      expect(names(await discover(text)), text).toEqual([]);
    }
    expect(names(await discover('Managers asked what to tell guests.'))).toEqual(['Managers']);
    expect(
      names(await discover('The support manager and the sales manager agreed.')).sort(),
    ).toEqual(['Sales manager', 'Support manager']);
  });
});
