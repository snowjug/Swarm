import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scenarioFrameSchema } from '../../shared/scenario.js';
import {
  participantOf,
  type ProposedParticipant,
  type ProposedParticipants,
  type StakeholderSet,
} from '../../shared/stakeholders.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { buildContext } from '../src/stakeholders/participants/context.js';
import { partyProblem } from '../src/stakeholders/participants/language.js';
import { proposeParticipants } from '../src/stakeholders/participants/propose.js';
import { readMentions } from '../src/stakeholders/participants/reader.js';
import { ScriptedGateway } from './support/participants-world.js';

// A live pilot read pages of a product's admin documentation without a model and proposed "Auto attendants",
// "Configure Teams", "Manage Teams" and "Azure Content Delivery Network" as the parties to a decision. They
// are headings, menu items, features and a service; none of them is a group of people. The text below is
// written for these tests in the manner of such a page, and quotes none.

const QUESTION = 'What could happen if Microsoft integrates Copilot more deeply into Teams?';
const FRAME = scenarioFrameSchema.parse({
  decision: 'Microsoft integrates Copilot more deeply into Teams',
  system: 'Teams',
  geography: 'Worldwide',
  horizon: 'Next year',
  baseline: 'Copilot stays a separate app.',
  likelyStakeholders: ['Microsoft'],
  origin: 'user',
});

const QUOTES = {
  admins: 'IT admins turn the Copilot setting off for a department',
  frontline: 'Frontline workers see the change in their next meeting',
  organizers: 'Meeting organizers ask for a way to switch it back on',
  group: 'The Teams product group decides what ships in each release',
} as const;

const PAGE = [
  '# Manage Teams',
  '## Configure Teams',
  'Use the Teams admin center to configure Teams for your organization. Select Manage Teams to open the list.',
  '## Auto attendants',
  'Auto attendants let people call your organization and navigate a menu. Create an auto attendant for each office.',
  '## Azure Content Delivery Network',
  'Meeting recordings can be served through the Azure Content Delivery Network for faster playback.',
  `${QUOTES.admins}. ${QUOTES.frontline}. ${QUOTES.organizers}.`,
  `${QUOTES.group}. Microsoft Teams lets people chat and meet.`,
].join('\n\n');

const LABELS = [
  'Auto attendants',
  'Configure Teams',
  'Manage Teams',
  'Select Manage Teams',
  'Azure Content Delivery Network',
  'Teams admin center',
  'Teams admin',
];
// The reader cannot know what the decision changes; a proposal can, and leaves the product out too.
const NOT_PARTIES = [...LABELS, 'Microsoft Teams'];

const NOW = new Date('2026-03-01T09:00:00.000Z');
const passages = chunkDocuments([{ id: 'D1', name: 'teams-admin.md', content: PAGE }]).map(
  (chunk) => ({ ...chunk, contentHash: createHash('sha256').update(chunk.text).digest('hex') }),
);
const contextOf = () =>
  buildContext({ question: QUESTION, scenario: FRAME, graph: null, passages });
const signal = () => new AbortController().signal;
const live = (set: StakeholderSet) => set.stakeholders.filter((item) => item.status !== 'removed');
const names = (set: StakeholderSet) => live(set).map((item) => item.name);

const passageWith = (quote: string): string => {
  const found = passages.find((passage) => passage.text.includes(quote));
  if (!found) throw new Error(`No passage holds: ${quote}`);
  return found.id;
};

/** A participant that passes every check, whose evidence is a sentence of the page. */
function member(
  id: string,
  name: string,
  quote: string | null,
  overrides: Partial<ProposedParticipant> = {},
): ProposedParticipant {
  return {
    id,
    name,
    role: 'directly-affected',
    whyTheyMatter: `${name} could feel the change first (${id}).`,
    description: `The people described as ${name.toLowerCase()} in the sources.`,
    objective: `Keep their own work running while the change settles (${id}).`,
    incentives: [`Keep ${name.toLowerCase()} able to finish what they started.`],
    pressures: [`The change may arrive before ${name.toLowerCase()} are ready.`],
    constraints: [`Works within the settings an administrator leaves open to ${id}.`],
    concerns: [`Losing a setting that ${name.toLowerCase()} rely on.`],
    influence: 'medium',
    decisionAuthority: 'none',
    directness: 'direct',
    impact: {
      direction: 'unclear',
      rationale: `No direction is stated for ${name.toLowerCase()}.`,
    },
    informationAccess: ['Assumed to see the change when it reaches their own meetings.'],
    plausibleActions: ['Adapt to the change.', 'Ask for a way back.', 'Work around it.'],
    prohibitedClaims: ['What any real person has chosen.'],
    evidence: quote ? [{ passageId: passageWith(quote), quote }] : [],
    assumptions: quote ? [] : ['Assumption: no passage is quoted for this group.'],
    uncertainty: { level: 'medium', reason: 'One passage names this group.' },
    confidenceBasis: quote ? 'source-quote' : 'model-inference',
    priority: 'standard',
    synthetic: true,
    ...overrides,
  };
}

const specific = (): ProposedParticipant[] => [
  member('product-group', 'Teams product group', QUOTES.group, {
    role: 'decision-owner',
    decisionAuthority: 'decides',
    influence: 'high',
    priority: 'key',
  }),
  member('it-administrators', 'IT administrators', QUOTES.admins, {
    role: 'implementers',
    decisionAuthority: 'advises',
  }),
  member('frontline-workers', 'Frontline workers', QUOTES.frontline),
  member('meeting-organizers', 'Meeting organizers', QUOTES.organizers),
];

/** A reply made of the given participants, ahead of four that are fine. */
function reply(...first: ProposedParticipant[]): ProposedParticipants {
  return { version: 1, participants: [...first, ...specific()], relations: [], gaps: [] };
}

const inferred = (id: string, name: string): ProposedParticipant =>
  member(id, name, null, { role: 'directly-affected' });

async function propose(replies: unknown[]) {
  const model = new ScriptedGateway(replies);
  const result = await proposeParticipants({
    context: contextOf(),
    model,
    modelName: 'fixture-model',
    signal: signal(),
    now: () => NOW,
  });
  return { ...result, model };
}

describe('the reader and a page of product documentation', () => {
  it('takes no heading, menu item, feature or service for a group', () => {
    const surfaces = readMentions(passages).map((mention) => mention.surface.toLowerCase());
    for (const label of LABELS) expect(surfaces, label).not.toContain(label.toLowerCase());
    // The people the page does speak of are still found.
    expect(surfaces).toEqual(expect.arrayContaining(['it admins', 'frontline workers']));
  });

  it('still reads a group that shares a word with those labels', () => {
    const read = (text: string) =>
      readMentions(chunkDocuments([{ id: 'D1', name: 'n.md', content: text }])).map(
        (mention) => mention.surface,
      );
    expect(read('The select committee asked for a review.')).toEqual(['select committee']);
    expect(read('Flight attendants asked for more rest.')).toEqual(['Flight attendants']);
    expect(read('The Eastgate Community Centre asked for a grant.')).toEqual([
      'Eastgate Community Centre',
    ]);
    expect(read('The Eastgate Neighbourhood Network asked for funding.')).toEqual([
      'Eastgate Neighbourhood Network',
    ]);
    expect(read('Meeting organizers ask for a way to switch it back on.')).toEqual([
      'Meeting organizers',
    ]);
  });
});

describe('what is a party', () => {
  it.each([
    ['Configure Teams', 'instruction word'],
    ['Manage Teams', 'instruction word'],
    ['Auto attendants', 'machine or a feature'],
    ['Azure Content Delivery Network', 'names a thing'],
    ['Teams admin center', 'names a thing'],
    ['Microsoft Teams', 'thing the decision changes'],
    ['Teams', 'thing the decision changes'],
  ])('says why %s is not one', (name, why) => {
    expect(partyProblem(name, FRAME)).toContain(why);
  });

  it.each([
    'Microsoft',
    'IT administrators',
    'Frontline workers',
    'Teams product group',
    'Network engineers',
    'Eastgate Community Centre',
    'Automated testing engineers',
  ])('lets %s stand', (name) => {
    expect(partyProblem(name, FRAME)).toBeNull();
  });

  it('lets a name that the decision is worded as doing something stand, though it is the system too', () => {
    const library = scenarioFrameSchema.parse({
      decision: 'Harbour Library closes on Sundays',
      system: 'Harbour Library',
      geography: 'One town',
      horizon: 'This year',
      baseline: 'Open every day.',
      likelyStakeholders: [],
      origin: 'user',
    });
    expect(partyProblem('Harbour Library', library)).toBeNull();
  });
});

describe('the rules path on that page', () => {
  it('proposes people and bodies, not the page’s own labels, and says what it left out', async () => {
    const model = new ScriptedGateway([]);
    model.json = () => {
      throw new Error('the rules path asked a model');
    };
    const { set, source } = await proposeParticipants({
      context: contextOf(),
      model: null,
      modelName: null,
      signal: signal(),
      now: () => NOW,
    });
    expect(source).toBe('rules');
    const listed = names(set).map((name) => name.toLowerCase());
    for (const label of NOT_PARTIES) expect(listed, label).not.toContain(label.toLowerCase());
    expect(listed).toEqual(expect.arrayContaining(['microsoft', 'frontline workers', 'it admins']));
    expect(live(set).every((item) => item.origin !== 'model')).toBe(true);
    // The question's own decision-maker is not swallowed by the product that carries its name.
    expect(live(set).find((item) => item.name === 'Microsoft')?.category).toBe('decision-maker');
    expect(set.proposal?.dropped).toContainEqual({
      name: 'Microsoft Teams',
      reason: expect.stringContaining('names the thing the decision changes'),
    });
  });
});

describe('a model’s proposal on that page', () => {
  it('is corrected once when it names headings, features, a service or the product, and then used', async () => {
    const bad = reply(
      inferred('configure-teams', 'Configure Teams'),
      inferred('auto-attendants', 'Auto attendants'),
      inferred('content-network', 'Azure Content Delivery Network'),
      inferred('microsoft-teams', 'Microsoft Teams'),
    );
    const { set, source, model } = await propose([bad, reply()]);
    expect(model.attempts).toBe(2);
    expect(model.refused).toHaveLength(1);
    expect(model.refused[0]).toContain('“Configure Teams” (configure-teams)');
    expect(model.refused[0]).toContain('instruction word');
    expect(model.refused[0]).toContain('machine or a feature');
    expect(model.refused[0]).toContain('names a thing');
    expect(model.refused[0]).toContain('thing the decision changes');
    // What the model is told names ids and fields and quotes no source.
    expect(model.refused[0]).not.toContain(QUOTES.admins);
    expect(source).toBe('model');
    expect([...names(set)].sort()).toEqual([
      'Frontline workers',
      'IT administrators',
      'Meeting organizers',
      'Teams product group',
    ]);
  });

  it('is corrected once when it names Staff, User, Public and Management, and then used', async () => {
    const generic = reply(
      inferred('staff', 'Staff'),
      inferred('user', 'User'),
      inferred('public', 'Public'),
      inferred('management', 'Management'),
    );
    const { set, source, model } = await propose([generic, reply()]);
    expect(source).toBe('model');
    expect(model.refused[0]).toContain('too generic');
    for (const id of ['staff', 'user', 'public', 'management']) {
      expect(model.refused[0]).toContain(`(${id})`);
    }
    expect(names(set)).not.toEqual(expect.arrayContaining(['Staff']));
    expect(names(set)).toHaveLength(4);
  });

  it('is labelled a model’s, each participant linked to the sentence it was read in, and left for a person to review', async () => {
    const { set, source, failure } = await propose([reply()]);
    expect(source).toBe('model');
    expect(failure).toBeNull();
    expect(set.discovery).toMatchObject({ mode: 'model', model: 'fixture-model' });
    expect(set.discovery.note).toContain('Proposed by a model (fixture-model)');
    expect(set.proposal).toMatchObject({ source: 'model', failure: null });
    expect(live(set).every((item) => item.origin === 'model' && item.status === 'proposed')).toBe(
      true,
    );
    expect(live(set).every((item) => participantOf(item).synthetic)).toBe(true);
    for (const item of live(set)) {
      expect(item.evidence.length, item.name).toBeGreaterThan(0);
      for (const ref of item.evidence)
        expect(passages.some((p) => p.id === ref.passageId)).toBe(true);
    }
    // Nothing is approved by being proposed.
    expect(set.approvedAt).toBeNull();
  });

  it('keeps one participant when the model proposes the same group twice', async () => {
    const twice = reply(member('frontline-again', 'Frontline workers', QUOTES.frontline));
    const { source, model } = await propose([twice, reply()]);
    expect(model.attempts).toBe(2);
    expect(model.refused[0]).toContain('are the same participant');
    expect(source).toBe('model');
  });

  it('falls back to the rules, labelled as such and with none of the labels, when the model keeps naming them', async () => {
    const bad = reply(
      inferred('configure-teams', 'Configure Teams'),
      inferred('microsoft-teams', 'Microsoft Teams'),
    );
    const { set, source, failure } = await propose([bad, bad]);
    expect(source).toBe('rules');
    expect(failure?.code).toBe('MODEL_OUTPUT_INVALID');
    expect(set.discovery.mode).toBe('rules');
    expect(set.discovery.note).toContain('The model could not be used');
    expect(set.proposal).toMatchObject({
      source: 'rules',
      failure: { code: 'MODEL_OUTPUT_INVALID' },
    });
    const listed = names(set).map((name) => name.toLowerCase());
    for (const label of NOT_PARTIES) expect(listed, label).not.toContain(label.toLowerCase());
  });
});

// A second live pilot read a page of release notes by rules, because its model's reply had been cut off, and
// proposed these six as the parties to the decision: they drove its headline ("Allowing developers +47 in
// 100") and its first recommendation ("Build on Executive Offices"). Each is the shape of a line of notes and
// not of a group: a verb and what it did, the name of a capability, a tier of one, or a department by its rank.
// The text below is written for these tests in the manner of such notes, and quotes none.

const SIX = [
  ['Added advanced management', 'begins with a verb'],
  ['Calendar Management', 'names a capability or a feature'],
  ['Executive Offices', 'department or an office by its rank alone'],
  ['SharePoint Advanced Management', 'names a capability or a feature'],
  ['Allowing developers', 'begins with a verb'],
  ['Help users', 'begins with a verb'],
] as const;

const NOTES = [
  '# What is new in the admin guide',
  'Added advanced management for IT admins.',
  'Calendar Management now lets meeting organizers hand a calendar to a delegate.',
  'The Executive Offices ask for a way to keep their own settings.',
  'SharePoint Advanced Management helps administrators find sites that need a review.',
  'Allowing developers to build agents for the company is on the roadmap.',
  'Help users find the right agent, the page says, and frontline workers ask for the same.',
  `${QUOTES.group}.`,
].join('\n\n');
const notesPassages = chunkDocuments([{ id: 'D2', name: 'release-notes.md', content: NOTES }]).map(
  (chunk) => ({ ...chunk, contentHash: createHash('sha256').update(chunk.text).digest('hex') }),
);

describe('the six that a page of release notes made parties', () => {
  it('are read as mentions by the reader, as the pilot’s were: the page is the real path to them', () => {
    const surfaces = readMentions(notesPassages).map((mention) => mention.surface);
    expect(surfaces).toEqual(expect.arrayContaining(SIX.map(([name]) => name)));
  });

  it.each(SIX)('says why %s is not a party', (name, why) => {
    expect(partyProblem(name, FRAME)).toContain(why);
  });

  it.each([
    'Senior management',
    'Store management',
    'Project management',
    'Help desk',
    'Help desk staff',
    'Visiting lecturers',
    'Registered nurses',
    'Managing director',
    'Elected officials',
    'Finance department',
    'Sales office',
    'Head office staff',
    'Executive team',
    'Fixed income investors',
    'Letting agents',
    'Extended families',
    'Supporting actors',
    'Developers',
  ])('still lets %s stand: the rules refuse a form of words, not a word', (name) => {
    expect(partyProblem(name, FRAME)).toBeNull();
  });

  it('are left out by the rules path, which says why, and the people the page speaks of are kept', async () => {
    const { set, source } = await proposeParticipants({
      context: buildContext({
        question: QUESTION,
        scenario: FRAME,
        graph: null,
        passages: notesPassages,
      }),
      model: null,
      modelName: null,
      signal: signal(),
      now: () => NOW,
    });
    expect(source).toBe('rules');
    const listed = names(set).map((name) => name.toLowerCase());
    for (const [name] of SIX) expect(listed, name).not.toContain(name.toLowerCase());
    expect(listed).toEqual(expect.arrayContaining(['it admins', 'frontline workers']));
    for (const [name, why] of SIX) {
      expect(set.proposal?.dropped, name).toContainEqual({
        name,
        reason: expect.stringMatching(new RegExp(`^Left out of the proposal: .*${why}`, 'u')),
      });
    }
  });

  it('are refused when a model proposes them, each with its reason, and the corrected reply is used', async () => {
    const bad = reply(...SIX.map(([name], index) => inferred(`six-${index}`, name)));
    const { set, source, model } = await propose([bad, reply()]);
    expect(model.attempts).toBe(2);
    expect(model.refused).toHaveLength(1);
    for (const [name, why] of SIX) {
      expect(model.refused[0], name).toContain(`“${name}”`);
      expect(model.refused[0], name).toContain(why);
    }
    expect(source).toBe('model');
    const listed = names(set).map((name) => name.toLowerCase());
    for (const [name] of SIX) expect(listed, name).not.toContain(name.toLowerCase());
  });
});
