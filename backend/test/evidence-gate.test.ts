import type { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, SourceDocument } from '../../shared/types.js';
import type { GroundedClaim, GroundingReview } from '../../shared/grounding.js';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import type { JsonOptions, ModelGateway } from '../src/models/client.js';
import {
  ABSTENTION_MESSAGE,
  abstentionReply,
  assessAnswerability,
  checkAnswer,
  isAbstention,
  partialCoverageNotes,
  projectMaterial,
  stem,
} from '../src/orchestration/evidence-gate.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { modelEnvironment } from './model-fixtures.js';

const COUNCIL =
  'The island council reports that annual ferry ridership reached 412,000 passengers in 2024. ' +
  'The electric option costs $14.2M while a diesel refit costs $3.1M. ' +
  'A 40% grant is available from the regional transport fund.';
const OPERATOR =
  'The ferry operator reports that annual ridership was 365,000 passengers in 2024. ' +
  'It proposes a 12% fare increase and only 4 winter sailings.';

const documents: SourceDocument[] = [
  { id: 'D1', name: 'council.md', content: COUNCIL },
  { id: 'D2', name: 'operator.md', content: OPERATOR },
];
const chunks = chunkDocuments(documents);
const material = ['Ferry report. The council and the operator disagree about ridership figures.'];

const ask = (question: string) => assessAnswerability({ question, chunks, material });

describe('stem', () => {
  it('brings inflections of one word together', () => {
    expect(stem('proposals')).toBe(stem('proposed'));
    expect(stem('proposed')).toBe(stem('propose'));
    expect(stem('passengers')).toBe(stem('passenger'));
    expect(stem('ferries')).toBe(stem('ferry'));
  });

  it('keeps short and unrelated words apart', () => {
    expect(stem('fare')).toBe('fare');
    expect(stem('grant')).not.toBe(stem('ferry'));
  });
});

describe('assessAnswerability', () => {
  it('lets through a question the sources cover', () => {
    const result = ask('How much does the electric option cost?');
    expect(result).toMatchObject({ answerable: true, missingTerms: [], unmatchedYears: [] });
    expect(result.topScore).toBeGreaterThan(0.12);
  });

  it('refuses a question about something the project never mentions', () => {
    const result = ask('What is the capital of France?');
    expect(result.answerable).toBe(false);
    expect(result.missingTerms).toEqual(expect.arrayContaining(['capital', 'france']));
    expect(result.reasons.join(' ')).toContain('key terms');
  });

  it('refuses a year the project never mentions even when the other words match', () => {
    const result = ask('What was ferry ridership in 2019?');
    expect(result.answerable).toBe(false);
    expect(result.unmatchedYears).toEqual(['2019']);
    expect(result.reasons.join(' ')).toContain('2019');
  });

  it('accepts a year the sources do name', () => {
    expect(ask('What was ferry ridership in 2024?')).toMatchObject({
      answerable: true,
      unmatchedYears: [],
    });
  });

  it('treats a request that only frames itself as about the whole project', () => {
    expect(ask('Please summarise the main points.')).toMatchObject({
      answerable: true,
      coverage: 1,
    });
  });

  it('is forgiving about inflection and hyphenation', () => {
    expect(ask('Which proposals concern passengers?').answerable).toBe(true);
    expect(ask('Is the fare-increase proposed?').answerable).toBe(true);
  });

  it('uses the report and persona text as well as the sources', () => {
    const result = assessAnswerability({
      question: 'Why do the council and the operator disagree?',
      chunks: [],
      material,
    });
    expect(result.answerable).toBe(true);
  });

  it('abstains when there is nothing at all to answer from', () => {
    expect(
      assessAnswerability({
        question: 'What did the harbour master say?',
        chunks: [],
        material: [],
      }),
    ).toMatchObject({
      answerable: false,
      coverage: 0,
    });
  });

  it('does not let a figure alone make an unrelated question answerable', () => {
    expect(ask('Is 412000 the right answer to the meaning of life?').answerable).toBe(false);
  });

  it('is deterministic', () => {
    expect(ask('What is the capital of France?')).toEqual(ask('What is the capital of France?'));
  });
});

describe('abstention wording', () => {
  it('is exactly the required sentence', () => {
    expect(ABSTENTION_MESSAGE).toBe(
      'The available project evidence does not support a confident answer.',
    );
  });

  it('leads with that sentence and says what was missing', () => {
    const reply = abstentionReply(ask('What is the capital of France?'));
    expect(reply.startsWith(ABSTENTION_MESSAGE)).toBe(true);
    expect(reply).toContain('Not found in the project: capital, france');
    expect(reply).toContain('Rephrase the question');
  });

  it('recognises an abstention regardless of spacing and case, and nothing weaker', () => {
    expect(isAbstention(ABSTENTION_MESSAGE)).toBe(true);
    expect(isAbstention(`  ${ABSTENTION_MESSAGE.toUpperCase().replace(' ', '\n')}  `)).toBe(true);
    expect(isAbstention('The evidence is limited, so treat this with care.')).toBe(false);
    expect(isAbstention('I am not sure.')).toBe(false);
  });

  it('is only an abstention when the sentence is the whole answer', () => {
    // Wrapping punctuation and a missing full stop are still the sentence.
    expect(isAbstention(`"${ABSTENTION_MESSAGE}"`)).toBe(true);
    expect(isAbstention(`**${ABSTENTION_MESSAGE}**`)).toBe(true);
    expect(isAbstention(ABSTENTION_MESSAGE.replace(/\.$/u, ''))).toBe(true);
    // An answer that merely contains it is an answer, and must be held to the rules for answers.
    const claim = 'Ridership was 999,000 passengers in 2031, up 70%.';
    expect(isAbstention(`${ABSTENTION_MESSAGE} ${claim}`)).toBe(false);
    expect(isAbstention(`${claim} ${ABSTENTION_MESSAGE}`)).toBe(false);
    expect(isAbstention(`${ABSTENTION_MESSAGE}\n\n${claim}`)).toBe(false);
    expect(isAbstention(`Mostly: "${ABSTENTION_MESSAGE}" However, the chair voted against.`)).toBe(
      false,
    );
  });

  it('notes only what a partly covered question lacked', () => {
    expect(partialCoverageNotes(null)).toEqual([]);
    expect(partialCoverageNotes(ask('How much does the electric option cost?'))).toEqual([]);
    const partial = ask('What did the harbour master say about the electric ferry cost?');
    expect(partial.answerable).toBe(true);
    expect(partialCoverageNotes(partial).join(' ')).toContain('harbour');
    expect(partialCoverageNotes(ask('What is the capital of France?'))).toEqual([]);
  });
});

describe('checkAnswer', () => {
  const base = {
    sourceIds: ['S1'],
    memoryIds: [],
    claimIds: [] as string[],
    citedText: COUNCIL,
    recordedFigures: new Set<string>(),
  };

  it('counts a cited report statement as a citation, and its figures as evidenced', () => {
    const result = checkAnswer({
      ...base,
      sourceIds: [],
      claimIds: ['C1'],
      citedText: 'The council reports 412,000 passengers in 2024.',
      answer: 'Statement C1 says the council reports 412,000 passengers.',
    });
    expect(result).toEqual({ status: 'cited', notes: [] });
  });

  it('calls an answer with a citation and only evidenced figures cited', () => {
    expect(
      checkAnswer({ ...base, answer: 'The council reports 412,000 passengers in 2024 [S1].' }),
    ).toEqual({ status: 'cited', notes: [] });
  });

  it('flags a figure that is in neither the cited passage nor the recorded simulation', () => {
    const result = checkAnswer({ ...base, answer: 'Ridership reached 999,000 passengers [S1].' });
    expect(result.status).toBe('caveated');
    expect(result.notes.join(' ')).toContain('999000');
  });

  it('accepts a figure the simulation recorded', () => {
    const result = checkAnswer({
      ...base,
      recordedFigures: new Set(['61']),
      answer: 'The simulation ended with 61% support [S1].',
    });
    expect(result.status).toBe('cited');
  });

  it('flags an answer that cites nothing', () => {
    const result = checkAnswer({ ...base, sourceIds: [], answer: 'Ridership was healthy.' });
    expect(result.status).toBe('uncited');
    expect(result.notes[0]).toContain('cites no source passage');
  });

  it('recognises an abstention before looking for citations or figures', () => {
    expect(checkAnswer({ ...base, sourceIds: [], answer: ABSTENTION_MESSAGE })).toMatchObject({
      status: 'abstained',
    });
  });

  it('does not call an answer an abstention because it begins with the sentence', () => {
    const result = checkAnswer({
      ...base,
      sourceIds: [],
      answer: `${ABSTENTION_MESSAGE} Ridership was 999,000 passengers in 2031.`,
    });
    expect(result.status).toBe('uncited');
    expect(result.notes.join(' ')).toContain('999000');
  });

  it('does not let a figure supplied by the question excuse an answer that adopts it', () => {
    // Nothing here knows the question; only evidence and recorded figures can support a number.
    const result = checkAnswer({ ...base, answer: 'Yes, the fare rises 17% [S1].' });
    expect(result.status).toBe('caveated');
  });
});

describe('projectMaterial', () => {
  it('gathers the report, personas, graph and recorded activity a question may be about', async () => {
    const harness = await buildApp({ config: testConfig() });
    try {
      const project = harness.repository.create(fixtureInput());
      const updated = harness.repository.update(project.id, {
        report: {
          generatedBy: 'local',
          title: 'Zebra report',
          executiveSummary: 'Quokka summary.',
          sections: [{ title: 'Wombat', body: 'Platypus body.', sourceIds: [] }],
          limitations: ['Echidna limitation.'],
          metrics: {
            initialMean: 0,
            finalMean: 0,
            finalSupport: 0,
            finalOpposition: 0,
            polarization: 0,
            totalInteractions: 0,
          },
        },
      });
      const text = projectMaterial(updated).join('\n');
      for (const expected of ['Zebra', 'Quokka', 'Wombat', 'Platypus', 'Echidna', 'polarization']) {
        expect(text).toContain(expected);
      }
      expect(text).toContain(updated.question);
    } finally {
      await harness.app.close();
    }
  });
});

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

/** A model double that, like the real client, retries after a rejected reply with the next one. */
function repairing(replies: unknown[]) {
  const rejected: string[] = [];
  const state = { calls: 0 };
  /** What the model was sent, so a test can check what it was and was not shown. */
  const seen: Record<string, unknown>[] = [];
  const gateway: ModelGateway = {
    json: async <T>(
      schema: z.ZodType<T>,
      _instructions: string,
      data: unknown,
      _signal?: AbortSignal,
      _maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> => {
      state.calls += 1;
      seen.push(data as Record<string, unknown>);
      for (const raw of replies) {
        const parsed = schema.parse(raw);
        try {
          options?.validate?.(parsed);
          return parsed;
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'MODEL_OUTPUT_INVALID') throw error;
          rejected.push(error.message);
        }
      }
      throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'The model kept returning invalid output.');
    },
  };
  return { gateway, rejected, state, seen };
}

const groundedClaim = (
  id: string,
  text: string,
  kind: GroundedClaim['kind'],
  verdict: GroundedClaim['verdict'],
  sourceIds: string[],
): GroundedClaim => ({
  id,
  section: 'Ridership',
  text,
  kind,
  sourceIds,
  memoryIds: [],
  quote: null,
  verdict,
  checks: { quote: null, overlap: 0.8, numbers: null, entailment: null },
  reason: 'Checked against the cited passage.',
});

/** A review with one well-supported, one unsupported and one unchecked statement, in that id order. */
const groundedReview: GroundingReview = {
  checkedAt: '2026-01-01T00:00:00.000Z',
  method: 'deterministic',
  claims: [
    groundedClaim(
      'C1',
      'The council reports 412,000 passengers in 2024.',
      'source-fact',
      'supported',
      ['S1'],
    ),
    groundedClaim(
      'C2',
      'Residents may switch to the ferry if fares fall.',
      'ai-hypothesis',
      'unchecked',
      [],
    ),
    groundedClaim(
      'C3',
      'The operator guarantees no cancellations.',
      'extracted-claim',
      'unsupported',
      ['S2'],
    ),
  ],
  counts: { supported: 1, partial: 0, unsupported: 1, contradicted: 0, unchecked: 1 },
  unverifiedFigures: [],
  notes: [],
};

async function completedModelProject(replies: unknown[], options: { grounded?: boolean } = {}) {
  const model = repairing(replies);
  const harness = await buildApp({
    config: testConfig(modelEnvironment),
    modelFactory: () => model.gateway,
  });
  applications.push(harness);
  const project = harness.repository.create(
    fixtureInput({
      documents: documents.map(({ name, content }) => ({ name, content })),
      settings: { mode: 'llm', agentCount: 4, rounds: 3, seed: 7, network: 'community' },
    }),
  );
  harness.repository.update(project.id, {
    status: 'completed',
    execution: {
      provider: 'openai',
      model: 'fixture-model',
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    report: {
      generatedBy: 'llm',
      title: 'Ferry report',
      executiveSummary: 'The council and operator disagree about ferry ridership.',
      sections: [
        { title: 'Ridership', body: 'Two sources give different ridership.', sourceIds: ['S1'] },
      ],
      limitations: ['Synthetic sources.'],
      ...(options.grounded ? { grounding: groundedReview } : {}),
      metrics: {
        initialMean: 0,
        finalMean: 0.1,
        finalSupport: 0.5,
        finalOpposition: 0.3,
        polarization: 0.2,
        totalInteractions: 10,
      },
    },
  });
  return { ...harness, id: project.id, model };
}

async function chat(
  harness: Awaited<ReturnType<typeof completedModelProject>>,
  message: string,
  target = 'report',
) {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/projects/${harness.id}/chat`,
    payload: { target, message },
  });
  return {
    response,
    messages:
      response.statusCode === 200 ? response.json<{ messages: ChatMessage[] }>().messages : [],
  };
}

describe('analyst chat evidence gate', () => {
  it('abstains with the exact sentence, and spends no model call, when the project cannot answer', async () => {
    const harness = await completedModelProject([
      {
        answer: 'Paris is the capital of France, a country in Europe.',
        sourceIds: [],
        memoryIds: [],
      },
    ]);
    const { response, messages } = await chat(harness, 'What is the capital of France?');
    expect(response.statusCode).toBe(200);
    const reply = messages.at(-1)!;
    expect(reply.content.startsWith(ABSTENTION_MESSAGE)).toBe(true);
    expect(reply.sourceIds).toEqual([]);
    expect(reply.grounding).toMatchObject({ status: 'abstained', coverage: 0 });
    expect(harness.model.state.calls).toBe(0);
    expect(harness.repository.get(harness.id).execution?.modelCalls).toBe(0);
  });

  it('abstains on a year the project never mentions', async () => {
    const harness = await completedModelProject([]);
    const { messages } = await chat(harness, 'What was ferry ridership in 2019?');
    expect(messages.at(-1)!.content.startsWith(ABSTENTION_MESSAGE)).toBe(true);
    expect(messages.at(-1)!.grounding?.notes.join(' ')).toContain('2019');
  });

  it('answers a covered question with citations and marks it cited', async () => {
    const harness = await completedModelProject([
      {
        answer: 'The council reports 412,000 passengers in 2024, citing its own count.',
        sourceIds: ['S1'],
        memoryIds: [],
      },
    ]);
    const { messages } = await chat(harness, 'How many passengers did the council report?');
    const reply = messages.at(-1)!;
    expect(reply.sourceIds).toEqual(['S1']);
    expect(reply.grounding).toMatchObject({ status: 'cited' });
    expect(harness.model.state.calls).toBe(1);
  });

  it('rejects an uncited factual answer and accepts the repaired, cited one', async () => {
    const harness = await completedModelProject([
      { answer: 'The council reports 412,000 passengers.', sourceIds: [], memoryIds: [] },
      {
        answer: 'The council reports 412,000 passengers in 2024.',
        sourceIds: ['S1'],
        memoryIds: [],
      },
    ]);
    const { messages } = await chat(harness, 'How many passengers did the council report?');
    expect(harness.model.rejected).toHaveLength(1);
    expect(harness.model.rejected[0]).toContain(ABSTENTION_MESSAGE);
    expect(messages.at(-1)!.grounding).toMatchObject({ status: 'cited' });
  });

  it('accepts the model declining to answer, and records that it abstained', async () => {
    const harness = await completedModelProject([
      { answer: ABSTENTION_MESSAGE, sourceIds: [], memoryIds: [] },
    ]);
    const { messages } = await chat(harness, 'How much does the council dislike the operator?');
    expect(messages.at(-1)!.grounding).toMatchObject({ status: 'abstained' });
    expect(harness.model.rejected).toEqual([]);
  });

  it('does not let an uncited claim through by putting the abstention sentence in front of it', async () => {
    const harness = await completedModelProject([
      {
        answer: `${ABSTENTION_MESSAGE} The council reports 999,000 passengers in 2031, up 70%.`,
        sourceIds: [],
        memoryIds: [],
      },
      {
        answer: 'The council reports 412,000 passengers in 2024.',
        sourceIds: ['S1'],
        memoryIds: [],
      },
    ]);
    const { messages } = await chat(harness, 'How many passengers did the council report?');
    // The first reply was refused and the model asked again, as for any uncited answer.
    expect(harness.model.rejected).toHaveLength(1);
    const reply = messages.at(-1)!;
    expect(reply.grounding).toMatchObject({ status: 'cited' });
    expect(reply.content).not.toContain('999,000');
    expect(reply.sourceIds).toEqual(['S1']);
  });

  it('flags a model answer whose figure is nowhere in the evidence', async () => {
    const harness = await completedModelProject([
      {
        answer: 'The council reports 999,000 passengers in 2024.',
        sourceIds: ['S1'],
        memoryIds: [],
      },
    ]);
    const { messages } = await chat(harness, 'How many passengers did the council report?');
    expect(messages.at(-1)!.grounding).toMatchObject({ status: 'caveated' });
    expect(messages.at(-1)!.grounding?.notes.join(' ')).toContain('999000');
  });

  it('keeps the abstention across a reload from storage', async () => {
    const harness = await completedModelProject([]);
    await chat(harness, 'What is the capital of France?');
    const stored = harness.repository.conversation(harness.id, 'report').at(-1)!;
    expect(stored.grounding?.status).toBe('abstained');
    expect(stored.content).toContain(ABSTENTION_MESSAGE);
  });

  describe('citing the report’s own statements', () => {
    const QUESTION = 'Which statements in the report are least supported by the sources?';

    it('shows the analyst the ledger, least supported first, and accepts an answer that cites it', async () => {
      const harness = await completedModelProject(
        [
          {
            answer: 'The least supported statement is C3: no cited source states it.',
            sourceIds: [],
            memoryIds: [],
            claimIds: ['C3'],
          },
        ],
        { grounded: true },
      );
      const { response, messages } = await chat(harness, QUESTION);
      expect(response.statusCode, response.body).toBe(200);

      const sent = harness.model.seen[0]!;
      const ledger = sent.ledger as {
        claims: { id: string; support: string }[];
        conflicts: { documents: string[] }[];
        sufficiency: { level: string };
      };
      // Least supported first. C1 is stated by the council but the operator source gives a
      // different figure, so mixed evidence makes it only partially supported.
      expect(ledger.claims.map((claim) => [claim.id, claim.support])).toEqual([
        ['C3', 'unsupported'],
        ['C1', 'partially-supported'],
        ['C2', 'not-checkable'],
      ]);
      expect(ledger.conflicts).toHaveLength(1);
      expect(ledger.conflicts[0]!.documents.sort()).toEqual(['council.md', 'operator.md']);
      expect(ledger.sufficiency.level).toBeTruthy();

      const reply = messages.at(-1)!;
      expect(reply.claimIds).toEqual(['C3']);
      expect(reply.sourceIds).toEqual([]);
      expect(reply.grounding).toMatchObject({ status: 'cited' });
      expect(harness.repository.conversation(harness.id, 'report').at(-1)!.claimIds).toEqual([
        'C3',
      ]);
    });

    it('rejects a statement id the model was not shown, and says which ids are valid', async () => {
      const harness = await completedModelProject(
        [
          {
            answer: 'C99 is the weakest statement.',
            sourceIds: [],
            memoryIds: [],
            claimIds: ['C99'],
          },
          {
            answer: 'C3 is the weakest statement.',
            sourceIds: [],
            memoryIds: [],
            claimIds: ['C3'],
          },
        ],
        { grounded: true },
      );
      const { messages } = await chat(harness, QUESTION);
      expect(harness.model.rejected).toHaveLength(1);
      expect(harness.model.rejected[0]).toContain('valid IDs: C3, C1, C2');
      expect(messages.at(-1)!.claimIds).toEqual(['C3']);
    });

    it('still requires a citation when the project holds statements it could cite', async () => {
      const harness = await completedModelProject(
        [
          {
            answer: 'The weakest statement is the one about cancellations.',
            sourceIds: [],
            memoryIds: [],
          },
          {
            answer: 'The weakest statement is C3.',
            sourceIds: [],
            memoryIds: [],
            claimIds: ['C3'],
          },
        ],
        { grounded: true },
      );
      await chat(harness, QUESTION);
      expect(harness.model.rejected).toHaveLength(1);
      expect(harness.model.rejected[0]).toContain('report statement');
    });

    it('lets an answer stand, marked unverified, when nothing in the project can be cited', async () => {
      const harness = await completedModelProject([
        {
          answer: 'The report says the two sources give different ridership.',
          sourceIds: [],
          memoryIds: [],
        },
      ]);
      const { response, messages } = await chat(harness, 'What do the two sources give?');
      expect(response.statusCode, response.body).toBe(200);
      expect(harness.model.rejected).toEqual([]);
      const grounding = messages.at(-1)!.grounding!;
      expect(grounding.status).toBe('uncited');
      expect(grounding.notes.join(' ')).toContain('rests on the report text alone');
      expect((harness.model.seen[0]!.ledger as { claims: unknown[] }).claims).toEqual([]);
    });

    it('does not show a persona the ledger', async () => {
      const harness = await completedModelProject(
        [{ answer: 'I stay cautious about the plan, for now.', sourceIds: [], memoryIds: [] }],
        { grounded: true },
      );
      harness.repository.update(harness.id, {
        agents: [
          {
            id: 'agent-1',
            name: 'Ferry commuter',
            role: 'Daily commuter',
            persona: 'A fictional commuter who uses the island ferry.',
            topicIds: [],
            initialOpinion: 0,
            opinion: 0.2,
            influence: 1,
            openness: 0.5,
            memory: [],
            sourceIds: [],
          },
        ],
      });
      await chat(harness, 'How did your position change?', 'agent-1');
      expect(harness.model.seen[0]!.ledger).toBeNull();
    });
  });

  it('does not apply the gate to a persona, which speaks from its own recorded state', async () => {
    const harness = await completedModelProject([
      {
        answer: 'I stay cautious about the plan, given what I have seen.',
        sourceIds: [],
        memoryIds: [],
      },
    ]);
    harness.repository.update(harness.id, {
      agents: [
        {
          id: 'agent-1',
          name: 'Ferry commuter',
          role: 'Daily commuter',
          persona: 'A fictional commuter who uses the island ferry.',
          topicIds: [],
          initialOpinion: 0,
          opinion: 0.2,
          influence: 1,
          openness: 0.5,
          memory: [],
          sourceIds: [],
        },
      ],
    });
    const { response, messages } = await chat(harness, 'What is the capital of France?', 'agent-1');
    expect(response.statusCode).toBe(200);
    const reply = messages.at(-1)!;
    expect(reply.content).toBe('I stay cautious about the plan, given what I have seen.');
    // The persona is asked, and may answer without a citation; only the analyst must cite or abstain.
    expect(harness.model.state.calls).toBe(1);
    expect(harness.model.rejected).toEqual([]);
    expect(reply.grounding?.status).toBe('uncited');
  });
});

describe('local analyst chat', () => {
  it('abstains instead of printing unrelated passages', async () => {
    const harness = await buildApp({ config: testConfig() });
    applications.push(harness);
    const project = harness.repository.create(fixtureInput());
    harness.jobs.enqueue(project.id);
    await harness.jobs.idle();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/chat`,
      payload: { target: 'report', message: 'What is the quarterly revenue of Contoso Airlines?' },
    });
    expect(response.statusCode).toBe(200);
    const reply = response.json<{ messages: ChatMessage[] }>().messages.at(-1)!;
    expect(reply.content.startsWith(ABSTENTION_MESSAGE)).toBe(true);
    expect(reply.sourceIds).toEqual([]);
    expect(reply.grounding?.status).toBe('abstained');
  });

  it('still answers a covered question from the sources', async () => {
    const harness = await buildApp({ config: testConfig() });
    applications.push(harness);
    const project = harness.repository.create(fixtureInput());
    harness.jobs.enqueue(project.id);
    await harness.jobs.idle();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/chat`,
      payload: { target: 'report', message: 'What do the sources say about transit?' },
    });
    const reply = response.json<{ messages: ChatMessage[] }>().messages.at(-1)!;
    expect(reply.sourceIds).toEqual(['S1']);
    expect(reply.grounding?.status).toBe('cited');
  });
});
