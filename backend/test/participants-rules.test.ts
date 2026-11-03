import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import {
  participantOf,
  stakeholderSetSchema,
  type StakeholderSet,
} from '../../shared/stakeholders.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { parseScenario } from '../src/scenario/parse.js';
import { findQuote } from '../src/grounding/text.js';
import { buildContext } from '../src/stakeholders/participants/context.js';
import { reasonFromSources } from '../src/stakeholders/participants/fallback.js';
import { isGenericName, nameTokens, wordsIn } from '../src/stakeholders/participants/language.js';
import { proposeParticipants } from '../src/stakeholders/participants/propose.js';
import { reviewContext, reviewParticipants } from '../src/stakeholders/participants/validate.js';
import { approveSet } from '../src/stakeholders/review.js';
import { LIBRARY_PACK } from './support/stakeholder-briefs.js';
import { ScriptedGateway } from './support/participants-world.js';

// What the rules path proposes with no model, on the five worked examples and on a question of a
// person's own, read as a project reads them. Nothing here asks a model: a model that is called fails
// the test, which is how "the rules path must not call a model" is held.

interface Pack {
  id: string;
  question: string;
  documents: readonly { name: string; content: string }[];
}
const PACKS: Pack[] = [...EXAMPLE_SCENARIOS, LIBRARY_PACK];
const NOW = new Date('2026-03-01T09:00:00.000Z');

const refusing = new ScriptedGateway([]);
refusing.json = () => {
  throw new Error('the rules path asked a model');
};

async function inputs(pack: Pack) {
  const parsed = await parseScenario({
    question: pack.question,
    documents: pack.documents.map((document) => ({
      name: document.name,
      characters: document.content.length,
    })),
  });
  const passages = chunkDocuments(
    pack.documents.map((document, index) => ({
      id: `D${index + 1}`,
      name: document.name,
      content: document.content,
    })),
  ).map((chunk) => ({
    ...chunk,
    contentHash: createHash('sha256').update(chunk.text).digest('hex'),
  }));
  return { frame: parsed.frame, passages, question: pack.question };
}

async function propose(pack: Pack, model = null as ScriptedGateway | null) {
  const { frame, passages, question } = await inputs(pack);
  const context = buildContext({ question, scenario: frame, graph: null, passages });
  const result = await proposeParticipants({
    context,
    model,
    modelName: null,
    signal: new AbortController().signal,
    now: () => NOW,
  });
  const review = reviewParticipants(
    result.set,
    reviewContext({ passages, graph: null, scenario: frame, question }),
  );
  return { ...result, review, passages, frame, context };
}

const live = (set: StakeholderSet) =>
  set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');

describe.each(PACKS)('the rules proposal for the $id pack', (pack) => {
  const made = propose(pack);

  it('is complete and valid with no model: nothing blocks, and it says it was made by rules', async () => {
    const { set, review, source, failure } = await made;
    expect(source).toBe('rules');
    expect(failure).toBeNull();
    expect(set.discovery).toMatchObject({ mode: 'rules', model: null });
    expect(set.proposal).toMatchObject({ source: 'rules', failure: null, version: 1 });
    expect(review.issues.filter((issue) => issue.severity === 'blocking')).toEqual([]);
    expect(review.valid).toBe(true);
    expect(review.profile).toBe('strict');
    expect(live(set).length).toBeGreaterThanOrEqual(2);
    expect(live(set).length).toBeLessThanOrEqual(25);
  });

  it('covers the decision: someone decides, and someone is reached by the change', async () => {
    const { set, review } = await made;
    const roles = live(set).map((stakeholder) => participantOf(stakeholder).role);
    expect(roles).toContain('decision-owner');
    const reached = [
      'directly-affected',
      'customers-users',
      'beneficiaries',
      'indirectly-affected',
    ];
    if (pack.id !== 'custom-library')
      expect(roles.some((role) => reached.includes(role))).toBe(true);
    const held = review.coverage.filter((item) => item.status === 'covered');
    expect(held.length).toBeGreaterThanOrEqual(3);
    // A role nobody holds is named, never filled to look whole.
    for (const item of review.coverage.filter((entry) => entry.status === 'missing')) {
      expect(item.count).toBe(0);
      expect(item.reason).toBeTruthy();
    }
    // A voice nobody stands for is named, never dropped: a participant stands for it, as an assumption, or
    // the proposal names the gap.
    expect(
      roles.includes('missing-voices') ||
        set.proposal?.missingVoices.some((voice) => voice.role === 'missing-voices'),
    ).toBe(true);
  });

  it('never names a participant by a generic word alone, and says what it left out', async () => {
    const { set } = await made;
    for (const stakeholder of live(set)) {
      expect(isGenericName(stakeholder.name), stakeholder.name).toBe(false);
    }
    for (const dropped of set.proposal?.dropped ?? []) {
      expect(dropped.reason.length, dropped.name).toBeGreaterThan(10);
    }
  });

  it('quotes only words that are in the sources, and labels what it could not quote as an assumption', async () => {
    const { set, passages } = await made;
    const texts = new Map(passages.map((passage) => [passage.id, passage.text]));
    for (const stakeholder of live(set)) {
      const participant = participantOf(stakeholder);
      for (const ref of stakeholder.evidence) {
        expect(
          findQuote(ref.quote ?? '', new Map([[ref.passageId, texts.get(ref.passageId) ?? '']]))
            .found,
          stakeholder.name,
        ).toBe(true);
      }
      if (stakeholder.evidence.length === 0) {
        expect(participant.confidenceBasis, stakeholder.name).not.toBe('source-quote');
        expect(stakeholder.assumptions.join(' '), stakeholder.name).toMatch(/assum/iu);
      } else {
        expect(participant.confidenceBasis, stakeholder.name).toBe('source-quote');
      }
      expect(participant.synthetic).toBe(true);
      expect(participant.plausibleActions.length, stakeholder.name).toBeGreaterThan(0);
      expect(participant.prohibitedClaims.join(' '), stakeholder.name).toContain(
        'real, identified person',
      );
    }
  });

  it('uses only words of the question, the scenario and the sources in its names, apart from its own few', async () => {
    const { set, passages, frame } = await made;
    const own = new Set(
      nameTokens(
        [
          pack.question,
          frame.decision,
          frame.system,
          ...frame.likelyStakeholders,
          ...passages.map((p) => p.text),
        ].join(' '),
      ),
    );
    // The role patterns are the only wording of its own: a decision owner, the people a change lands on or
    // reaches with no say, the body behind a named rule, the other side of a contract, and a role the text
    // speaks of that nobody holds.
    const patterns = new Set(
      (
        'decision owner directly affected change reached who have no say it approver body set oversee ' +
        'supplier partner alternative may object would carry out other side'
      ).split(' '),
    );
    for (const stakeholder of live(set)) {
      for (const token of nameTokens(stakeholder.name)) {
        expect(own.has(token) || patterns.has(token), `${stakeholder.name}: ${token}`).toBe(true);
      }
    }
  });

  it('says nothing that is a forecast, a figure about the world or a claim of certainty, in its summary or its fields', async () => {
    const { set, review } = await made;
    expect(claimsAgainst(review.summary)).toEqual([]);
    for (const stakeholder of live(set)) {
      const view = participantOf(stakeholder);
      const visible = [
        stakeholder.description,
        stakeholder.relevance,
        view.objective,
        ...view.plausibleActions,
        ...view.informationAccess,
        ...view.prohibitedClaims,
        ...stakeholder.assumptions,
        stakeholder.uncertainty.reason,
        stakeholder.expectedImpact.rationale,
      ].join('\n');
      expect(claimsAgainst(visible), stakeholder.name).toEqual([]);
    }
    expect(claimsAgainst(set.discovery.note)).toEqual([]);
  });

  it('gives the same answer for the same input, byte for byte', async () => {
    const again = await propose(pack);
    expect(JSON.stringify(again.set)).toBe(JSON.stringify((await made).set));
  });

  it('is a set that parses, and that approving accepts', async () => {
    const { set } = await made;
    expect(stakeholderSetSchema.parse(set)).toEqual(set);
    expect(approveSet(set, NOW).approvedAt).toBe(NOW.toISOString());
  });
});

describe('the rules proposal and the model', () => {
  it('never calls one, whatever is configured, when none is asked for', async () => {
    const { source } = await propose(PACKS[0]!, null);
    expect(source).toBe('rules');
    expect(refusing.attempts).toBe(0);
  });

  it('keeps every id when it is made again, so that a reference to a participant stays good', async () => {
    const pack = PACKS[1]!;
    const first = await propose(pack);
    const { frame, passages, question } = await inputs(pack);
    const again = await proposeParticipants({
      context: buildContext({ question, scenario: frame, graph: null, passages }),
      model: null,
      modelName: null,
      signal: new AbortController().signal,
      existing: first.set,
      now: () => NOW,
    });
    expect(again.set.stakeholders.map((stakeholder) => stakeholder.id)).toEqual(
      first.set.stakeholders.map((stakeholder) => stakeholder.id),
    );
  });

  it('turns a name only a generic word into a specific one from the scenario’s system, or leaves it out and says so', async () => {
    const { frame, passages, question } = await inputs({
      id: 'plain',
      question: 'What if the service changes how it handles requests?',
      documents: [
        {
          name: 'notes.md',
          content:
            'The service plans a change. Staff handle every request by hand. Users ask for quicker answers. The regulator wants notice.',
        },
      ],
    });
    const named = await proposeParticipants({
      context: buildContext({
        question,
        scenario: { ...frame, system: 'Request desk' },
        graph: null,
        passages,
      }),
      model: null,
      modelName: null,
      signal: new AbortController().signal,
      now: () => NOW,
    });
    const names = live(named.set).map((stakeholder) => stakeholder.name);
    expect(names).toEqual(expect.arrayContaining(['Request desk staff', 'Request desk users']));
    const unnamed = await proposeParticipants({
      context: buildContext({
        question,
        scenario: { ...frame, system: '' },
        graph: null,
        passages,
      }),
      model: null,
      modelName: null,
      signal: new AbortController().signal,
      now: () => NOW,
    });
    expect(
      live(unnamed.set).map((stakeholder) => wordsIn(stakeholder.name).join(' ')),
    ).not.toContain('staff');
    expect(unnamed.set.proposal?.dropped.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Staff', 'Users']),
    );
  });

  it('never makes a person named in the sources a participant: only the role is modelled', async () => {
    const { frame, passages, question } = await inputs(PACKS[0]!);
    const person = {
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
          sourceIds: [passages[0]!.id],
        },
      ],
      edges: [],
    };
    const result = await proposeParticipants({
      context: buildContext({ question, scenario: frame, graph: person, passages }),
      model: null,
      modelName: null,
      signal: new AbortController().signal,
      now: () => NOW,
    });
    expect(live(result.set).map((stakeholder) => stakeholder.name)).not.toContain('Jordan Reyes');
  });

  it('still produces a valid pair when the sources name nobody at all', async () => {
    const { frame, question } = await inputs(PACKS[0]!);
    const result = await proposeParticipants({
      context: buildContext({
        question,
        scenario: { ...frame, system: '', likelyStakeholders: [] },
        graph: null,
        passages: chunkDocuments([
          { id: 'D1', name: 'empty.md', content: 'Nothing here names a group.' },
        ]),
      }),
      model: null,
      modelName: null,
      signal: new AbortController().signal,
      now: () => NOW,
    });
    expect(live(result.set).length).toBeGreaterThanOrEqual(2);
    expect(live(result.set).map((stakeholder) => participantOf(stakeholder).role)).toEqual(
      expect.arrayContaining(['decision-owner', 'directly-affected']),
    );
  });

  it('sets a quotation into the reason without doubling its stop, and says when no passage names the group', () => {
    expect(reasonFromSources('approvers', 'The panel signs off.', 'rules')).toMatch(
      /reads “The panel signs off\.”$/u,
    );
    expect(reasonFromSources('approvers', 'The panel signs off', 'rules')).toMatch(
      /reads “The panel signs off”\.$/u,
    );
    expect(reasonFromSources('approvers', undefined, 'scenario')).toContain(
      'Your question names this group.',
    );
    expect(reasonFromSources('approvers', undefined, 'rules')).toContain(
      'it is here because of its role',
    );
  });
});
