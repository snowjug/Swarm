import { describe, expect, it } from 'vitest';
import { actorFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import type { EvidenceChunk } from '../../shared/types.js';
import { headingsOf, impliedBy, topicOf } from '../src/constraints/situation.js';
import type { DiscoveryContext } from '../src/constraints/types.js';
import { digest } from './support/constraint-world.js';

/**
 * What a situation points to: who is involved, what kind of change it is, what the sources are headed.
 * The sentences and sections here are written for this test, in settings (a bakery, a greenhouse, a bike
 * hire shop) that no evaluation scenario is about.
 */

const chunk = (id: string, text: string): EvidenceChunk => ({
  id,
  documentId: `doc-${id}`,
  documentName: `${id}.md`,
  text,
  start: 0,
  end: text.length,
  contentHash: digest(text),
});

const context = (overrides: Partial<DiscoveryContext> = {}): DiscoveryContext => ({
  question: 'Should the shop change how it works?',
  scenario: scenarioFixture({ geography: null, horizon: null }),
  actors: [],
  actorRelations: [],
  alternatives: [],
  passages: [],
  ...overrides,
});

const categoriesOf = (implied: ReturnType<typeof impliedBy>) =>
  implied.map((item) => item.situation.category);

describe('what a sentence is about, by its own words', () => {
  it('names the kind of limit when the words of one kind are enough, and not before', () => {
    expect(topicOf('The kiln operator and the power supplier signed a ten-year contract.')).toBe(
      'contractual',
    );
    expect(topicOf('The night rota pays overtime to the nurses.')).toBe('staffing');
    expect(topicOf('The co-operative needs a licence from the regulator.')).toBe('regulatory');
    // One word of ordinary talk, or no word at all, says nothing of the kind.
    expect(topicOf('The kiln is old and the roof leaks.')).toBeNull();
    expect(topicOf('The shop opens at nine.')).toBeNull();
  });
});

describe('the headings of the sources', () => {
  it('takes the lines a source marks as headings, and nothing else', () => {
    const passages = [
      chunk(
        'P1',
        '# Greenhouse plan\nSome text.\n## Heating and power ##\nMore text with a #hashtag in it.',
      ),
      chunk('P2', '   ### Staff rota\nNothing here.'),
    ];
    expect(headingsOf(passages)).toEqual(['Greenhouse plan', 'Heating and power', 'Staff rota']);
  });
});

describe('what the situation points to', () => {
  it('points to a kind where one specific word of it is in the person’s own words', () => {
    const implied = impliedBy(
      context({ question: 'Should the bike hire shop install a camera at the door?' }),
      [],
    );
    const privacy = implied.find((item) => item.situation.category === 'privacy');
    expect(privacy?.points).toBeGreaterThanOrEqual(2);
    expect(privacy?.reason).toMatch(/^Your question and scenario mention “cameras?”/u);
  });

  it('counts a heading above the person’s words and the sources’ body', () => {
    const passages = [
      chunk(
        'P1',
        '## Data protection\nThe shop keeps customer details on a shelf.\n## Opening hours\nNine to five.',
      ),
    ];
    const privacy = impliedBy(context(), passages).find(
      (item) => item.situation.category === 'privacy',
    );
    expect(privacy?.reason).toMatch(/^A section of the sources is about “data protection”/u);
    const buried = impliedBy(context(), [
      chunk('P2', 'The shop keeps data protection notes on a shelf.'),
    ]).find((item) => item.situation.category === 'privacy');
    expect(buried?.points).toBeLessThan(privacy?.points ?? 0);
  });

  it('points to a kind from who is involved, and says who', () => {
    const implied = impliedBy(
      context({ actors: [actorFixture('trading-standards', 'regulator')] }),
      [],
    );
    const regulatory = implied.find((item) => item.situation.category === 'regulatory');
    expect(regulatory?.reason).toMatch(/^Trading standards is involved/u);
    // A cast that depends on one another points to a limit on what the change relies on.
    const dependent = impliedBy(
      context({
        actors: [actorFixture('shop', 'operations'), actorFixture('bakery', 'partner')],
        actorRelations: [{ from: 'shop', to: 'bakery', type: 'depends-on', strength: 0.5 }],
      }),
      [],
    ).find((item) => item.situation.category === 'dependency');
    expect(dependent?.points).toBeGreaterThanOrEqual(2);
  });

  it('does not point to a kind on one word of ordinary talk', () => {
    const implied = impliedBy(context(), [chunk('P1', 'The team met on Tuesday.')]);
    expect(categoriesOf(implied)).not.toContain('capacity');
  });

  it('keeps the kinds every decision has, with no reason, when nothing points to them', () => {
    const implied = impliedBy(context(), []);
    expect(categoriesOf(implied).sort()).toEqual(['budget', 'reversibility', 'time']);
    for (const item of implied) {
      expect(item.situation.universal).toBe(true);
      expect(item.reason).toBe('');
    }
  });

  it('reads only the passages it is given', () => {
    // A passage that was held back from reading is not passed, so what it says points to nothing.
    const held = chunk('P9', 'The surveillance cameras record the loading bay.');
    expect(categoriesOf(impliedBy(context(), []))).not.toContain('privacy');
    expect(categoriesOf(impliedBy(context(), [held]))).toContain('privacy');
  });
});
