import { describe, expect, it } from 'vitest';
import { scenarioFrameSchema } from '../../shared/scenario.js';
import { buildBrief } from '../src/brief/build.js';
import { OWNER_BY_CATEGORY } from '../src/brief/recommend.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { simulate } from '../src/simulation/simulate.js';
import { discoverStakeholders } from '../src/stakeholders/discover.js';
import { HEADS, MODIFIERS } from '../src/stakeholders/lexicon.js';
import { richInputs } from './support/brief-world.js';
import { CHAIN_RELATIONS, chainCast, spec } from './support/simulation-cast.js';

// The engine, the stakeholder reading and the brief know categories, traits and signals, and nothing
// about any subject. A scan of the source can only name a few subjects, and a fixed set of inputs can
// only be one set. So these tests change nothing but the subject, and the name of the people in it,
// and require that nothing else changes: the same structure, the same numbers, the same owner for
// the same category. A branch for one subject, however it is written, shows up as a difference.

/** Subjects that no example, and nothing in the stakeholder lexicon, knows. */
const SUBJECTS = [
  'beekeeping',
  'glassblowing',
  'falconry',
  'lighthouse',
  'cheesemaking',
  'bellringing',
  'saltmarsh',
  'quarrying',
  'shipbreaking',
  'viticulture',
  'puppetry',
  'cartography',
  'taxidermy',
  'horology',
  'basketweaving',
  'apiculture',
  'mycology',
  'ropemaking',
  'candlemaking',
  'lacemaking',
  'bookbinding',
  'blacksmithing',
  'sailmaking',
  'thatching',
  'dowsing',
  'orienteering',
  'lutherie',
  'tapestry',
  'cidermaking',
  'archery',
  'curling',
  'kitemaking',
  'honeyfarming',
  'apiary',
  'sundials',
  'peatcutting',
  'stonewalling',
  'coracles',
  'hedgelaying',
  'rushcutting',
];

const capital = (word: string): string => `${word[0]!.toUpperCase()}${word.slice(1)}`;

describe('the subjects are ones the lexicon does not know', () => {
  it('names no role and no describing word, so that nothing but the subject varies', () => {
    expect(SUBJECTS).toContain('beekeeping');
    expect(new Set(SUBJECTS).size).toBe(SUBJECTS.length);
    for (const subject of SUBJECTS) {
      for (const word of [subject, subject.replace(/s$/u, '')]) {
        expect(HEADS.has(word), word).toBe(false);
        expect(MODIFIERS.has(word), word).toBe(false);
      }
    }
  });
});

describe('finding stakeholders reads the evidence and not the subject', () => {
  const documentOf = (subject: string): string =>
    [
      `${capital(subject)} brief (illustrative, synthetic). The ${subject} office plans a change to how ${subject} permits are issued.`,
      'Administrators can switch it off, but many administrators only read notices after the change has shipped.',
      'Regulators in several regions require notice before new rules begin.',
      'Suppliers who resell materials want a transition guide, and competitors have already moved to a different scheme.',
      'Support teams expect more tickets in the first weeks, and engineers warn of load at peak times.',
      'Customers worry about the cost, while compliance officers want an audit trail.',
    ].join(' ');

  async function read(subject: string) {
    const question = `What could happen if ${subject} permits are issued differently?`;
    const hints = [`${subject} members`];
    const document = documentOf(subject);
    const set = await discoverStakeholders({
      project: { question, graph: null },
      scenario: scenarioFrameSchema.parse({
        decision: 'd',
        system: 's',
        baseline: 'b',
        likelyStakeholders: hints,
        origin: 'user',
      }),
      passages: chunkDocuments([{ id: 'D1', name: 'brief.md', content: document }]),
      model: null,
      now: () => new Date('2026-03-02T10:00:00.000Z'),
    });
    return { set, input: [question, ...hints, document].join(' ') };
  }

  /** Everything about a stakeholder but its name. */
  const structureOf = (set: Awaited<ReturnType<typeof read>>['set']) =>
    set.stakeholders.map((stakeholder) => [
      stakeholder.category,
      stakeholder.priority,
      stakeholder.directness,
      stakeholder.origin,
      stakeholder.evidence.length,
      stakeholder.expectedImpact.direction,
      stakeholder.expectedImpact.origin,
      stakeholder.uncertainty.level,
    ]);
  const namesWithout = (set: Awaited<ReturnType<typeof read>>['set'], subject: string): string[] =>
    set.stakeholders.map((stakeholder) =>
      stakeholder.name.toLowerCase().replaceAll(subject, '<subject>'),
    );
  const stems = (text: string): string[] =>
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .map((word) => word.replace(/s$/u, ''))
      .filter(Boolean);

  it('finds the same groups in the same shape whatever the subject, differing only in the subject’s own word', async () => {
    const reference = await read(SUBJECTS[0]!);
    expect(reference.set.stakeholders.length).toBeGreaterThanOrEqual(8);
    for (const subject of SUBJECTS) {
      const { set } = await read(subject);
      expect(namesWithout(set, subject), subject).toEqual(
        namesWithout(reference.set, SUBJECTS[0]!),
      );
      expect(structureOf(set), subject).toEqual(structureOf(reference.set));
      expect(set.gaps, subject).toEqual(reference.set.gaps);
      expect(set.relations.length, subject).toBe(reference.set.relations.length);
    }
  });

  it('invents no group the evidence does not name: every name is made of words of the question, the hints and the text', async () => {
    for (const subject of SUBJECTS) {
      const { set, input } = await read(subject);
      const own = new Set(stems(input));
      for (const stakeholder of set.stakeholders) {
        for (const stem of stems(stakeholder.name)) {
          expect(own, `${subject}: ${stakeholder.name} (${stem})`).toContain(stem);
        }
      }
    }
  });

  it('can say where each group found by reading came from: it quotes the passage, and the name is in the quote', async () => {
    for (const subject of ['beekeeping', 'glassblowing', 'lighthouse']) {
      const { set } = await read(subject);
      const found = set.stakeholders.filter((stakeholder) => stakeholder.origin === 'rules');
      expect(found.length, subject).toBeGreaterThanOrEqual(6);
      for (const stakeholder of found) {
        expect(stakeholder.evidence.length, `${subject}: ${stakeholder.name}`).toBeGreaterThan(0);
        const quoted = new Set(
          stems(stakeholder.evidence.map((item) => item.quote ?? '').join(' ')),
        );
        for (const stem of stems(stakeholder.name)) {
          expect(quoted, `${subject}: ${stakeholder.name} (${stem})`).toContain(stem);
        }
      }
    }
  });

  it('adds no group for a subject that is named in the question: beekeeping gives no honey inspectors', async () => {
    const { set } = await read('beekeeping');
    const names = set.stakeholders.map((stakeholder) => stakeholder.name.toLowerCase());
    expect(names.some((name) => /honey|inspector|apiar|queen/u.test(name))).toBe(false);
    expect(set.stakeholders).toHaveLength((await read('glassblowing')).set.stakeholders.length);
  });
});

describe('the simulator does not read names', () => {
  const rounds = 12;
  const seed = 4242;
  const originals = chainCast();

  /** A name for each actor that is the subject's, with the actor's number in it so that none is a part of another. */
  const renamed = (subject: string) =>
    originals.map((actor, index) => ({
      ...actor,
      name: `${capital(subject)} inspectors ${index}`,
    }));
  const run = (cast: ReturnType<typeof chainCast>) =>
    JSON.stringify(simulate(spec(cast, { relations: CHAIN_RELATIONS, rounds }), seed));
  const baseline = run(originals);

  it('has a run with a chain of events to compare, in which the names are said', () => {
    const outcome = JSON.parse(baseline) as { events: { description: string }[] };
    expect(outcome.events.length).toBeGreaterThan(0);
    expect(outcome.events.some((event) => event.description.includes(originals[1]!.name))).toBe(
      true,
    );
  });

  it.each(SUBJECTS)(
    'gives the same numbers when the actors are called after %s, and the same words but for the names',
    (subject) => {
      const cast = renamed(subject);
      let outcome = run(cast);
      cast.forEach((actor, index) => {
        outcome = outcome.replaceAll(actor.name, originals[index]!.name);
      });
      expect(outcome).toBe(baseline);
    },
  );

  it('gives the same numbers for a name that says what the actor would be if the name were read', () => {
    for (const name of ['Honey inspectors', 'Beekeepers', 'Apiary wardens', 'Harmed customers']) {
      const cast = originals.map((actor) => ({ ...actor, name }));
      const outcome = JSON.parse(run(cast)) as { final: unknown; rounds: unknown };
      const reference = JSON.parse(baseline) as { final: unknown; rounds: unknown };
      expect(outcome.final, name).toEqual(reference.final);
      expect(outcome.rounds, name).toEqual(reference.rounds);
    }
  });
});

describe('the brief gives an actor the owner of its category, whatever the actor is called', () => {
  const original = richInputs();
  const baseline = buildBrief(original);
  const stable = <T extends { generatedAt: string }>(brief: T): T => ({
    ...brief,
    generatedAt: '',
  });

  /**
   * The same inputs with each actor and stakeholder named for the subject; what is named alike is named
   * alike. A name is as long as the one it replaces, because the headline is cut at a length and so
   * says what fits, which depends on how long the names in it are.
   */
  function renamed(subject: string) {
    const inputs = structuredClone(original);
    const names = new Map<string, string>();
    const rename = (name: string): string => {
      if (!names.has(name)) {
        const word = `${String(names.size).padStart(2, '0')}${capital(subject)}`;
        names.set(name, word.padEnd(name.length, 'x').slice(0, name.length));
      }
      return names.get(name)!;
    };
    for (const actor of inputs.analysis.actors) actor.name = rename(actor.name);
    for (const actor of inputs.actors?.actors ?? []) actor.name = rename(actor.name);
    for (const stakeholder of inputs.stakeholders?.stakeholders ?? []) {
      stakeholder.name = rename(stakeholder.name);
    }
    return { inputs, names };
  }

  it('has recommendations that name actors, so that the names are in what is compared', () => {
    expect(baseline.recommendations.some((entry) => /“Subscribers”/u.test(entry.text))).toBe(true);
    expect(baseline.recommendations.length).toBeGreaterThan(3);
  });

  it.each(SUBJECTS)(
    'writes the same brief when the actors are called after %s: the same owners, the same words but for the names',
    (subject) => {
      const { inputs, names } = renamed(subject);
      const brief = buildBrief(inputs);
      expect(brief.recommendations.map((entry) => entry.ownerFunction)).toEqual(
        baseline.recommendations.map((entry) => entry.ownerFunction),
      );
      let written = JSON.stringify(stable(brief));
      for (const [from, to] of names) written = written.replaceAll(to, from);
      expect(JSON.parse(written)).toEqual(stable(baseline));
    },
  );

  it('takes the owner of a recommendation from the category of the actor it is about', () => {
    const categories = new Map(
      original.analysis.actors.map((actor) => [actor.name, actor.category]),
    );
    const about = baseline.recommendations.filter((entry) =>
      /^Mitigate or stage/u.test(entry.text),
    );
    expect(about.length).toBeGreaterThan(0);
    for (const entry of about) {
      const name = /“([^”]+)”/u.exec(entry.text)?.[1] ?? '';
      expect(entry.ownerFunction, name).toBe(OWNER_BY_CATEGORY[categories.get(name)!]);
    }
  });
});
