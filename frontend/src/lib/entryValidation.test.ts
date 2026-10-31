import { describe, expect, it } from 'vitest';
import { nameFromQuestion, validateEntry } from './entryValidation';

const SOURCE =
  'A fictional notes file about a change, with enough characters to be accepted as source material for the scenario.';

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
