import { describe, expect, it } from 'vitest';
import { subjectCoverage, subjectCoverageWords, subjectsOf } from './subject';

const QUESTION = 'What could happen if Microsoft integrates Copilot more deeply into Teams?';

// Pages about a product's channels and licensing, written for this test: they talk about Teams all the way
// through and never mention what the question is about.
const PAGES = [
  {
    content:
      'Shared channels in Teams let people from other teams collaborate. Microsoft Teams admins set the policy.',
  },
  {
    content:
      'A Teams Premium licence adds meeting protection. Admins assign it to the users who need it.',
  },
];

describe('the names a question uses', () => {
  it('takes the words with a capital that do not open a sentence, once each', () => {
    expect(subjectsOf(QUESTION)).toEqual(['Microsoft', 'Copilot', 'Teams']);
    expect(
      subjectsOf('Will Harbour Pilots object? The Council may ask the Pilots to wait.'),
    ).toEqual(['Harbour', 'Pilots', 'Council']);
  });

  it('takes none from a question that names nothing', () => {
    expect(subjectsOf('What could happen if the night bus moves to a new route?')).toEqual([]);
  });
});

describe('whether the sources mention them', () => {
  it('names the subject that no source mentions, and still counts the ones that are', () => {
    const coverage = subjectCoverage(QUESTION, PAGES);
    expect(coverage).toEqual({
      subjects: ['Microsoft', 'Copilot', 'Teams'],
      missing: ['Copilot'],
      sources: 2,
    });
  });

  it('says nothing when every name is mentioned, when there is no source, or when the question names nothing', () => {
    const covered = [...PAGES, { content: 'Copilot can summarise a meeting for Teams users.' }];
    expect(subjectCoverage(QUESTION, covered)).toBeNull();
    expect(subjectCoverage(QUESTION, [])).toBeNull();
    expect(subjectCoverage('What could happen if the night bus moves?', PAGES)).toBeNull();
  });

  it('matches a name at the start of a word only, and whatever its case', () => {
    expect(
      subjectCoverage('Might Copilot help?', [{ content: 'copilots fly aircraft' }]),
    ).toBeNull();
    expect(
      subjectCoverage('Might Copilot help?', [{ content: 'The co-pilot flies.' }])?.missing,
    ).toEqual(['Copilot']);
  });

  it('says, in words a person can act on, which name is missing and what to do', () => {
    const words = subjectCoverageWords(subjectCoverage(QUESTION, PAGES)!);
    expect(words.title).toBe('No source mentions “Copilot”');
    expect(words.body).toContain(
      '“Copilot” is in your question and is not mentioned in the 2 sources read',
    );
    expect(words.body).toContain(
      'Name a more specific page in your question, such as one about Copilot',
    );
  });

  it('says so when none of the names appears', () => {
    const words = subjectCoverageWords(
      subjectCoverage(QUESTION, [{ content: 'Ferries cross the harbour twice a day.' }])!,
    );
    expect(words.title).toBe('No source mentions “Microsoft”, “Copilot” or “Teams”');
    expect(words.body).toContain(
      'None of the names in your question (“Microsoft”, “Copilot” and “Teams”) appears',
    );
    expect(words.body).toContain('in the 1 source read');
  });
});
