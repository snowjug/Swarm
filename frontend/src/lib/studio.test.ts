import { describe, expect, it } from 'vitest';
import { claimRecord } from '../test/ledger';
import { sectionView, studioView, version } from '../test/studio';
import {
  actorLabel,
  diffCounts,
  diffWords,
  refusalKind,
  reviewSummary,
  sectionFlags,
  writtenByPerson,
  type DiffPart,
} from './studio';

const joined = (parts: DiffPart[], ...kinds: DiffPart['kind'][]): string =>
  parts
    .filter((part) => kinds.includes(part.kind))
    .map((part) => part.text)
    .join('');

/** The same text every run: a small linear congruential generator over a fixed vocabulary. */
function sample(seed: number, words: number): string {
  const vocabulary = ['ferry', 'fare', 'council', 'crossings', '412,000', 'the', 'a', 'may', 'not'];
  let state = seed;
  const pieces: string[] = [];
  for (let index = 0; index < words; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    pieces.push(vocabulary[state % vocabulary.length]!);
    pieces.push(state % 7 === 0 ? '\n' : ' ');
  }
  return pieces.join('');
}

describe('diffWords', () => {
  it('gives the text back whole when nothing changed', () => {
    const parts = diffWords(
      'The council counted 412,000 crossings.',
      'The council counted 412,000 crossings.',
    );
    expect(parts).toEqual([{ kind: 'same', text: 'The council counted 412,000 crossings.' }]);
  });

  it('shows a replaced figure as one removal and one addition, not as a rewrite', () => {
    const parts = diffWords(
      'The council counted 412,000 crossings.',
      'The council counted 365,000 crossings.',
    );
    expect(parts.map((part) => part.kind)).toEqual(['same', 'removed', 'added', 'same']);
    expect(parts.filter((part) => part.kind === 'removed').map((part) => part.text)).toEqual([
      '412,000',
    ]);
    expect(parts.filter((part) => part.kind === 'added').map((part) => part.text)).toEqual([
      '365,000',
    ]);
  });

  it('shows text added at the end as added only, without marking the word before it as changed', () => {
    const parts = diffWords('The council voted.', 'The council voted.\n\nAn analyst re-read it.');
    expect(parts).toEqual([
      { kind: 'same', text: 'The council voted.' },
      { kind: 'added', text: '\n\nAn analyst re-read it.' },
    ]);
    expect(diffCounts(parts)).toEqual({ added: 4, removed: 0 });
  });
  it('is empty for two empty texts and all-added or all-removed against an empty one', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(diffWords('', 'new text')).toEqual([{ kind: 'added', text: 'new text' }]);
    expect(diffWords('old text', '')).toEqual([{ kind: 'removed', text: 'old text' }]);
  });

  it('reports a change that is only in the spacing, so that it is not hidden', () => {
    const parts = diffWords('one two', 'one  two');
    expect(parts.some((part) => part.kind !== 'same')).toBe(true);
    expect(joined(parts, 'same', 'removed')).toBe('one two');
    expect(joined(parts, 'same', 'added')).toBe('one  two');
  });

  it('gives back both texts exactly, from the unchanged and the removed parts and from the unchanged and the added', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const before = sample(seed, 5 + (seed % 23));
      const after = sample(seed * 31 + 7, 4 + (seed % 19));
      const parts = diffWords(before, after);
      expect(joined(parts, 'same', 'removed'), `before, seed ${seed}`).toBe(before);
      expect(joined(parts, 'same', 'added'), `after, seed ${seed}`).toBe(after);
    }
  });

  it('never leaves two neighbouring parts of the same kind', () => {
    const parts = diffWords(sample(3, 40), sample(11, 40));
    parts.slice(1).forEach((part, index) => expect(part.kind).not.toBe(parts[index]!.kind));
  });

  it('shows what differs between two texts too long to compare word by word as all removed and all added, and still round-trips', () => {
    const before = `START-A ${sample(5, 2_100)} END-A`;
    const after = `START-B ${sample(9, 2_100)} END-B`;
    const parts = diffWords(before, after);
    expect(parts.map((part) => part.kind)).toEqual(['removed', 'added']);
    expect(joined(parts, 'removed')).toBe(before);
    expect(joined(parts, 'added')).toBe(after);
  });

  it('still finds a small edit in a very long text word by word, because what the two share is set aside first', () => {
    const long = sample(5, 3_000);
    const parts = diffWords(`one two three ${long} last`, `one TWO three ${long} last`);
    expect(parts.map((part) => part.kind)).toEqual(['same', 'removed', 'added', 'same']);
    expect(parts[1]!.text).toBe('two');
    expect(parts[2]!.text).toBe('TWO');
  });
});

describe('diffCounts', () => {
  it('counts words, not parts or characters', () => {
    const parts = diffWords(
      'the council counted 412,000 crossings',
      'the council counted about 365,000 or so crossings',
    );
    expect(diffCounts(parts)).toEqual({ added: 4, removed: 1 });
    expect(diffCounts([])).toEqual({ added: 0, removed: 0 });
  });
});

describe('refusalKind', () => {
  it('leaves a refusal the caller deals with itself unshown, and only if the caller says so', () => {
    const asksForConfirmation = (code: string) => code === 'CONFIRM_REQUIRED';
    expect(refusalKind('CONFIRM_REQUIRED', asksForConfirmation)).toBe('handled');
    expect(refusalKind('CONFIRM_REQUIRED')).toBe('other');
    expect(refusalKind('SECTION_LOCKED', asksForConfirmation)).toBe('other');
  });

  it.each([
    'SECTION_CONFLICT',
    'STUDIO_CHANGED',
    'STUDIO_STALE',
    'PROPOSAL_STALE',
    'PROPOSAL_NOT_FOUND',
    'STUDIO_EXISTS',
  ])('loads the studio again after %s, which means the page was out of date', (code) => {
    expect(refusalKind(code)).toBe('out-of-date');
  });

  it.each(['SECTION_LOCKED', 'STUDIO_NOT_EDITABLE', 'NOTE_REQUIRED', 'FORBIDDEN', 'PROJECT_BUSY'])(
    'only shows %s, which the person can act on without reloading',
    (code) => {
      expect(refusalKind(code)).toBe('other');
    },
  );

  it('treats a failure with no code, such as a lost connection, as shown and not as out of date', () => {
    expect(refusalKind(null)).toBe('other');
    expect(refusalKind(null, () => true)).toBe('other');
  });
});

describe('sectionFlags', () => {
  it('says nothing about a section no one has touched', () => {
    expect(sectionFlags(sectionView())).toEqual([]);
  });

  it('says so, in words, when a section is locked, has regenerated text waiting, or has notes', () => {
    const note = {
      id: 'n1',
      actor: 'reviewer-1',
      at: '2026-02-01T10:00:00.000Z',
      text: 'Check the figure.',
    };
    expect(
      sectionFlags(
        sectionView({
          locked: { actor: 'lead-1', at: '2026-02-01T10:00:00.000Z' },
          notes: [note],
        }),
      ),
    ).toEqual(['Locked', '1 reviewer note']);
    expect(sectionFlags(sectionView({ notes: [note, { ...note, id: 'n2' }] }))).toEqual([
      '2 reviewer notes',
    ]);
  });

  it('warns when the statements describe an earlier text, and not when there are none to describe', () => {
    expect(sectionFlags(sectionView({ origin: 'human', statementsCurrent: false }))).toEqual([
      'Statements describe an earlier text',
    ]);
    expect(sectionFlags(sectionView({ statements: [], statementsCurrent: false }))).toEqual([]);
  });
});

describe('writtenByPerson and actorLabel', () => {
  it('counts a regenerated section as the model’s writing that a person accepted, not as generated', () => {
    expect(writtenByPerson({ origin: 'generated' })).toBe(false);
    expect(writtenByPerson({ origin: 'human' })).toBe(true);
    expect(writtenByPerson({ origin: 'regenerated' })).toBe(true);
  });

  it('names the report writer and the local user, shortens a principal id, and shows anything else whole', () => {
    expect(actorLabel('system')).toBe('The report writer');
    expect(actorLabel('local-user')).toBe('You (local user)');
    expect(actorLabel('de300001-0000-4000-8000-000000000001')).toBe('de300001…');
    expect(actorLabel('reviewer@example.test')).toBe('reviewer@example.test');
  });
});

describe('reviewSummary', () => {
  it('counts what a reviewer is about to approve, from the same view the page shows', () => {
    const summary = reviewSummary(studioView());
    expect(summary).toEqual({
      sections: 4,
      byPeople: 0,
      notes: 0,
      findings: 1,
      labelled: 1,
      notCurrent: 0,
    });
  });

  it('does not count the statements of a text a person has changed as findings, and says how many chapters that is', () => {
    const edited = sectionView({
      id: 'S2',
      origin: 'human',
      body: 'Edited by a person.',
      versions: [version(), version({ version: 2, origin: 'human', body: 'Edited by a person.' })],
      version: 2,
      statementsCurrent: false,
      statements: [claimRecord({ id: 'C9' }), claimRecord({ id: 'C10' })],
    });
    const base = studioView();
    const summary = reviewSummary(
      studioView({
        document: {
          sections: [...base.document!.sections.filter((section) => section.id !== 'S2'), edited],
        },
      }),
    );
    expect(summary.byPeople).toBe(1);
    expect(summary.notCurrent).toBe(1);
    expect(summary.findings).toBe(1);
  });

  it('counts a withheld statement as neither a finding nor a labelled one, and counts every reviewer note', () => {
    const note = {
      id: 'n1',
      actor: 'reviewer-1',
      at: '2026-02-01T10:00:00.000Z',
      text: 'Check it.',
    };
    const summary = reviewSummary(
      studioView({
        document: {
          sections: [
            sectionView({
              notes: [note, { ...note, id: 'n2' }],
              statements: [
                claimRecord({ id: 'C1' }),
                claimRecord({
                  id: 'C2',
                  publication: { status: 'withheld', qualification: null, reasons: [] },
                }),
                claimRecord({
                  id: 'C3',
                  publication: {
                    status: 'qualified',
                    qualification: 'Read with care.',
                    reasons: [],
                  },
                }),
                claimRecord({
                  id: 'C4',
                  publication: { status: 'contradiction-shown', qualification: null, reasons: [] },
                }),
              ],
            }),
          ],
        },
      }),
    );
    expect(summary).toMatchObject({ findings: 2, labelled: 1, notes: 2, sections: 1 });
  });

  it('is empty before anyone has opened the report', () => {
    expect(reviewSummary(studioView({ document: null }))).toEqual({
      sections: 0,
      byPeople: 0,
      notes: 0,
      findings: 0,
      labelled: 0,
      notCurrent: 0,
    });
  });
});
