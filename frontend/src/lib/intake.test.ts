import { describe, expect, it } from 'vitest';
import { scenarioFixture } from '../../../shared/lab-fixtures';
import { scenarioFrameSchema, scenarioInputSchema } from '../../../shared/scenario';
import type { ScenarioAmbiguity, ScenarioFrame } from '../../../shared/scenario';
import {
  LIMITS,
  applyAnswer,
  blankChange,
  canRead,
  documentSummaries,
  edited,
  frameIssues,
  newId,
  originLabel,
  skipQuestion,
  tidyFrame,
} from './intake';

const ask = (field: string, question = 'A question?'): ScenarioAmbiguity => ({
  field,
  message: 'Not stated.',
  question,
});

/** A frame as it is while being edited: the fixture with changes made, which need not be valid yet. */
const frame = (overrides: Partial<ScenarioFrame> = {}): ScenarioFrame => ({
  ...scenarioFixture(),
  ambiguities: [],
  ...overrides,
});

describe('whether a question can be read', () => {
  it('needs the length the entry form needs, and no more than a project holds', () => {
    expect(canRead('too short')).toBe(false);
    expect(canRead('exactly 10')).toBe(true);
    expect(canRead(`   ${'a'.repeat(9)}   `)).toBe(false);
    expect(canRead('a'.repeat(2_000))).toBe(true);
    expect(canRead('a'.repeat(2_001))).toBe(false);
  });
});

describe('what is said about the documents', () => {
  it('sends names and sizes, and only the start of each text', () => {
    const summaries = documentSummaries([
      { name: '  notes.md ', content: 'x'.repeat(12_000) },
      { name: '', content: 'short' },
    ]);
    expect(summaries[0]).toEqual({
      name: 'notes.md',
      characters: 12_000,
      excerpt: 'x'.repeat(5_000),
    });
    expect(summaries[1]).toEqual({ name: 'document', characters: 5, excerpt: 'short' });
  });

  it('keeps to the number and the length the server takes', () => {
    const many = documentSummaries(
      Array.from({ length: 14 }, (_, n) => ({ name: `${n}`.padEnd(200, 'n'), content: 'y' })),
    );
    expect(many).toHaveLength(10);
    expect(many.every((summary) => summary.name.length <= 120)).toBe(true);
  });
});

describe('the limits on the form', () => {
  it('are the limits of the frame: a frame at every limit is valid, and one character over is not', () => {
    const text = (length: number) => 'x'.repeat(length);
    const full = scenarioFrameSchema.safeParse({
      decision: text(LIMITS.decision),
      system: text(LIMITS.system),
      geography: text(LIMITS.geography),
      horizon: text(LIMITS.horizon),
      changes: Array.from({ length: LIMITS.changes }, () => ({
        name: text(LIMITS.variableName),
        from: text(LIMITS.variableValue),
        to: text(LIMITS.variableValue),
        note: text(LIMITS.variableNote),
      })),
      baseline: text(LIMITS.baseline),
      alternatives: Array.from({ length: LIMITS.alternatives }, (_, n) => ({
        id: `a-${n}`,
        label: text(LIMITS.label),
        description: text(LIMITS.description),
        changes: [],
      })),
      requestedDecision: text(LIMITS.requestedDecision),
      desiredOutput: text(LIMITS.desiredOutput),
      evidenceMissing: Array.from({ length: LIMITS.missingEvidence }, () => text(LIMITS.missing)),
      assumptions: Array.from({ length: LIMITS.assumptions }, (_, n) => ({
        id: `s-${n}`,
        text: text(LIMITS.assumption),
        origin: 'user',
      })),
      likelyStakeholders: Array.from({ length: LIMITS.stakeholders }, () =>
        text(LIMITS.stakeholder),
      ),
      ambiguities: [{ field: 'f', message: 'm', question: text(LIMITS.question) }],
      origin: 'user',
    });
    expect(full.success, JSON.stringify(full.error?.issues)).toBe(true);

    const over = (patch: Record<string, unknown>) =>
      scenarioFrameSchema.safeParse({ ...scenarioFixture(), ...patch }).success;
    expect(over({ decision: text(LIMITS.decision + 1) })).toBe(false);
    expect(over({ system: text(LIMITS.system + 1) })).toBe(false);
    expect(over({ geography: text(LIMITS.geography + 1) })).toBe(false);
    expect(over({ horizon: text(LIMITS.horizon + 1) })).toBe(false);
    expect(over({ baseline: text(LIMITS.baseline + 1) })).toBe(false);
    expect(over({ requestedDecision: text(LIMITS.requestedDecision + 1) })).toBe(false);
    expect(over({ desiredOutput: text(LIMITS.desiredOutput + 1) })).toBe(false);
    expect(
      over({ evidenceMissing: Array.from({ length: LIMITS.missingEvidence + 1 }, () => 'x') }),
    ).toBe(false);
    expect(
      over({ likelyStakeholders: Array.from({ length: LIMITS.stakeholders + 1 }, () => 'x') }),
    ).toBe(false);
  });
});

describe('tidying a frame before it is used', () => {
  it('removes rows with nothing in them, trims text, and turns empty values into none', () => {
    const tidy = tidyFrame(
      frame({
        decision: '  Decide  ',
        system: '  ',
        geography: '   ',
        changes: [{ name: ' Rate ', from: ' ', to: ' 5% ', note: ' n ' }, blankChange()],
        alternatives: [
          { id: 'one', label: '  Smaller  ', description: ' d ', changes: [blankChange()] },
          { id: 'two', label: '   ', description: '', changes: [] },
        ],
        evidenceMissing: [' a ', 'a', '', 'b'],
        assumptions: [
          { id: 'x', text: ' kept ', origin: 'user' },
          { id: 'y', text: '  ', origin: 'user' },
        ],
        likelyStakeholders: [' regulators ', 'regulators', ''],
      }),
    );
    expect(tidy).toMatchObject({
      decision: 'Decide',
      system: '',
      geography: null,
      changes: [{ name: 'Rate', from: null, to: '5%', note: 'n' }],
      alternatives: [{ id: 'one', label: 'Smaller', description: 'd', changes: [] }],
      evidenceMissing: ['a', 'b'],
      assumptions: [{ id: 'x', text: 'kept', origin: 'user' }],
      likelyStakeholders: ['regulators'],
    });
  });

  it('gives an alternative or assumption an id when it has none that is valid and its own', () => {
    const tidy = tidyFrame(
      frame({
        alternatives: [
          { id: 'same', label: 'A', description: '', changes: [] },
          { id: 'same', label: 'B', description: '', changes: [] },
          { id: 'Not A Slug', label: 'C', description: '', changes: [] },
        ],
        assumptions: [
          { id: 'x', text: 'A', origin: 'user' },
          { id: 'x', text: 'B', origin: 'system' },
        ],
      }),
    );
    const ids = tidy.alternatives.map((alternative) => alternative.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('same');
    expect(tidy.assumptions.map((item) => item.id)[0]).toBe('x');
    expect(new Set(tidy.assumptions.map((item) => item.id)).size).toBe(2);
    // And what comes out is a frame the server takes.
    expect(scenarioInputSchema.safeParse(tidy).success).toBe(true);
  });

  it('keeps to the number of rows the server takes, and does nothing to a frame that is already tidy', () => {
    const many = tidyFrame(
      frame({
        changes: Array.from({ length: 14 }, (_, n) => ({ ...blankChange(), name: `c${n}` })),
        likelyStakeholders: Array.from({ length: 30 }, (_, n) => `g${n}`),
      }),
    );
    expect(many.changes).toHaveLength(LIMITS.changes);
    expect(many.likelyStakeholders).toHaveLength(LIMITS.stakeholders);
    expect(tidyFrame(many)).toEqual(many);
    const fixture = scenarioFixture();
    expect(tidyFrame(fixture)).toEqual(fixture);
  });
});

describe('what stops a frame from being used', () => {
  it('names the decision, the baseline, and rows that have no name', () => {
    expect(frameIssues(frame())).toEqual([]);
    expect(frameIssues(frame({ decision: '  ' }))).toEqual([
      'Say what decision or event you want to explore.',
    ]);
    expect(frameIssues(frame({ baseline: '' }))).toEqual([
      'Say what is expected without the change.',
    ]);
    expect(
      frameIssues(
        frame({
          alternatives: [{ id: 'a', label: ' ', description: '', changes: [] }],
          changes: [blankChange()],
        }),
      ),
    ).toEqual(['Give every alternative a name, or remove it.', 'Name every change, or remove it.']);
  });
});

describe('answering a question', () => {
  it.each([
    ['system', 'system', 'A regional service'],
    ['geography', 'geography', 'Two regions'],
    ['horizon', 'horizon', 'The next year'],
    ['decision', 'decision', 'Whether to hold'],
    ['baseline', 'baseline', 'Nothing moves'],
    ['requestedDecision', 'requestedDecision', 'Go or hold'],
    ['desiredOutput', 'desiredOutput', 'A short brief'],
  ] as const)(
    'puts an answer about %s in that field, and takes the question away',
    (field, key, answer) => {
      const start = frame({ ambiguities: [ask(field), ask('other')] });
      const next = applyAnswer(start, 0, `  ${answer}  `);
      expect(next[key]).toBe(answer);
      expect(next.ambiguities.map((item) => item.field)).toEqual(['other']);
      expect(next.origin).toBe('user');
      // The frame that was given is not changed.
      expect(start.ambiguities).toHaveLength(2);
      expect(start.origin).toBe('user');
    },
  );

  it('adds the groups an answer names, once each', () => {
    const start = frame({
      likelyStakeholders: ['regulators'],
      ambiguities: [ask('likelyStakeholders')],
    });
    const next = applyAnswer(start, 0, 'Regulators, small suppliers; staff\nregulators');
    expect(next.likelyStakeholders).toEqual([
      'regulators',
      'Regulators',
      'small suppliers',
      'staff',
    ]);
    expect(next.ambiguities).toEqual([]);
  });

  it('puts the size of a change where it is missing', () => {
    const open = frame({
      changes: [
        { name: 'Rate', from: null, to: 'raised', note: '' },
        { name: 'Cap', from: null, to: null, note: '' },
      ],
      ambiguities: [ask('changes')],
    });
    expect(applyAnswer(open, 0, 'to 5 per cent').changes[1]?.to).toBe('to 5 per cent');
    const settled = frame({
      changes: [{ name: 'Rate', from: null, to: 'raised', note: 'Stated.' }],
      ambiguities: [ask('changes')],
    });
    expect(applyAnswer(settled, 0, 'about 5%').changes[0]).toMatchObject({
      to: 'raised',
      note: 'Stated. about 5%',
    });
    const none = frame({ changes: [], ambiguities: [ask('changes')] });
    expect(applyAnswer(none, 0, 'the monthly rate').changes).toEqual([
      { name: 'the monthly rate', from: null, to: null, note: '' },
    ]);
  });

  it('keeps an answer about success, or about anything else, as the person’s own assumption', () => {
    const success = applyAnswer(frame({ ambiguities: [ask('success')] }), 0, 'Fewer complaints');
    expect(success.assumptions.at(-1)).toMatchObject({
      text: 'Success is judged by: Fewer complaints',
      origin: 'user',
    });
    const other = applyAnswer(
      frame({ ambiguities: [ask('notice-wording', 'How is it worded?')] }),
      0,
      'In March',
    );
    expect(other.assumptions.at(-1)).toMatchObject({
      text: 'In answer to "How is it worded?": In March',
      origin: 'user',
    });
    const ids = other.assumptions.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does nothing with an empty answer or a question that is not there', () => {
    const start = frame({ ambiguities: [ask('system')] });
    expect(applyAnswer(start, 0, '   ')).toBe(start);
    expect(applyAnswer(start, 3, 'text')).toBe(start);
  });

  it('keeps an answer within the size of the field it goes to', () => {
    const next = applyAnswer(frame({ ambiguities: [ask('horizon')] }), 0, 'y'.repeat(900));
    expect(next.horizon).toHaveLength(LIMITS.horizon);
    expect(scenarioFrameSchema.safeParse(next).success).toBe(true);
  });

  it('finds the field under whatever name a model gave the question', () => {
    const horizon = applyAnswer(frame({ ambiguities: [ask('time horizon')] }), 0, 'Two years');
    expect(horizon.horizon).toBe('Two years');
    const where = applyAnswer(frame({ ambiguities: [ask('Geographic scope')] }), 0, 'Two regions');
    expect(where.geography).toBe('Two regions');
    const who = applyAnswer(frame({ ambiguities: [ask('Who is affected')] }), 0, 'Staff, partners');
    expect(who.likelyStakeholders).toEqual(expect.arrayContaining(['Staff', 'partners']));
    const size = applyAnswer(
      frame({
        changes: [{ name: 'Rate', from: null, to: null, note: '' }],
        ambiguities: [ask('magnitude of changes')],
      }),
      0,
      'About 5%',
    );
    expect(size.changes[0]?.to).toBe('About 5%');
    const success = applyAnswer(frame({ ambiguities: [ask('success measure')] }), 0, 'Less churn');
    expect(success.assumptions.at(-1)?.text).toBe('Success is judged by: Less churn');
  });

  it('can skip a question without answering it', () => {
    const start = frame({ ambiguities: [ask('a'), ask('b')] });
    expect(skipQuestion(start, 0).ambiguities.map((item) => item.field)).toEqual(['b']);
  });
});

describe('small helpers', () => {
  it('makes an id that is not taken', () => {
    expect(newId('option', [])).toBe('option-1');
    expect(newId('option', ['option-1'])).toBe('option-2');
    expect(newId('option', ['option-2', 'option-1'])).toBe('option-3');
  });

  it('marks a frame as the person’s once they change it', () => {
    const read = frame({ origin: 'rules' });
    expect(edited(read, { decision: 'New' })).toMatchObject({ decision: 'New', origin: 'user' });
    expect(read.origin).toBe('rules');
  });

  it('says how a frame came to be', () => {
    expect(originLabel(frame({ origin: 'rules' }), 'rules')).toBe('Read by rules, not a model');
    expect(originLabel(frame({ origin: 'rules' }), null)).toBe('Read by rules, not a model');
    expect(originLabel(frame({ origin: 'model' }), 'model')).toBe('Read by a model');
    expect(originLabel(frame({ origin: 'user' }), 'model')).toBe('Edited by you');
  });
});
