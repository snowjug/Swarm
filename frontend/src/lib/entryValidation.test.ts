import { describe, expect, it } from 'vitest';
import { scenarioFixture } from '../../../shared/lab-fixtures';
import { entryInput, nameFromQuestion, validateEntry } from './entryValidation';

const SOURCE =
  'A fictional notes file about a change, with enough characters to be accepted as source material for the scenario.';
const settings = {
  mode: 'local',
  agentCount: 12,
  rounds: 8,
  seed: 42,
  network: 'community',
  intervention: null,
} as const;
const form = {
  name: '',
  question: 'What could happen if the opening hours change?',
  documents: [{ name: 'notes.md', content: SOURCE }],
  settings,
  frame: null,
};

describe('what the entry form sends', () => {
  it('is a guided project, named from the question when the person gave no name', () => {
    const input = entryInput(form);
    expect(input.workflow).toBe('guided');
    expect(input.name).toBe('What could happen if the opening hours change?');
    expect(entryInput({ ...form, name: 'Opening hours' }).name).toBe('Opening hours');
    expect(entryInput({ ...form, name: '   ' }).name).toBe(input.name);
  });

  it('carries no scenario unless the person went through intake', () => {
    expect('scenario' in entryInput(form)).toBe(false);
    expect(validateEntry(entryInput(form)).data?.scenario).toBeUndefined();
  });

  it('sends the scenario read from the question, as the schema validates it', () => {
    const frame = scenarioFixture();
    const input = entryInput({ ...form, frame });
    expect(input.scenario).toEqual(frame);
    const result = validateEntry(input);
    expect(result.error).toBeUndefined();
    expect(result.data?.scenario?.decision).toBe(frame.decision);
    expect(result.data?.scenario?.origin).toBe(frame.origin);
  });

  it('refuses a scenario that does not fit the schema, saying where', () => {
    const frame = { ...scenarioFixture(), decision: 'x'.repeat(500) };
    const result = validateEntry(entryInput({ ...form, frame }));
    expect(result.error).toContain('scenario.decision');
  });

  it('keeps the documents and the run settings as they were entered', () => {
    const result = validateEntry(entryInput(form));
    expect(result.data?.documents).toHaveLength(1);
    expect(result.data?.settings).toMatchObject({ agentCount: 12, rounds: 8, seed: 42 });
  });
});

describe('a project name from the question', () => {
  it('is the question itself when it is short enough, with its spaces tidied', () => {
    expect(nameFromQuestion('  What could happen   if the\nopening hours change?  ')).toBe(
      'What could happen if the opening hours change?',
    );
  });

  it('is cut at a word and marked as cut when the question is long', () => {
    const name = nameFromQuestion(
      'What could happen to the number of evening visitors if the library extends its weekday opening hours but closes earlier on Sundays?',
    );
    expect(name.endsWith('…')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(81);
    expect(name).toBe(
      'What could happen to the number of evening visitors if the library extends its…',
    );
    expect(name.slice(0, -1).endsWith(' ')).toBe(false);
  });

  it('is cut mid-word only when there is no word to cut at', () => {
    expect(nameFromQuestion('x'.repeat(200))).toBe(`${'x'.repeat(80)}…`);
  });

  it('is never shorter than a project name may be, so that a blank question reports the question', () => {
    expect(nameFromQuestion('')).toBe('Untitled scenario');
    expect(nameFromQuestion('  ?  ')).toBe('Untitled scenario');
    const result = validateEntry({
      name: nameFromQuestion(''),
      question: '',
      documents: [{ name: 'notes.md', content: SOURCE }],
      workflow: 'guided',
    });
    expect(result.error).toContain('Enter a research question');
    expect(result.error).not.toContain('project name');
  });

  it('always makes a name the project schema accepts', () => {
    for (const question of ['What if?', 'y'.repeat(2_000), 'A question long enough to be valid.']) {
      const result = validateEntry({
        name: nameFromQuestion(question),
        question: question.length < 10 ? 'A question long enough to be valid.' : question,
        documents: [{ name: 'notes.md', content: SOURCE }],
        workflow: 'guided',
      });
      expect(result.error, question).toBeUndefined();
    }
  });
});
