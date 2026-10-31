import { describe, expect, it } from 'vitest';
import {
  MAX_ARCHIVES,
  MAX_CHECKED_TEXTS,
  MAX_NOTES_PER_SECTION,
  MAX_VERSIONS_PER_SECTION,
  type StudioDocument,
  type StudioProposal,
} from '../../shared/studio.js';
import type { SimulationReport } from '../../shared/types.js';
import { AppError } from '../src/errors.js';
import {
  addNote,
  addProposal,
  approvalCurrent,
  checkedFor,
  contentHash,
  decideProposal,
  editSection,
  findSection,
  hasPeopleContent,
  normaliseBody,
  reportHash,
  restartDocument,
  restoreVersion,
  setLock,
  sha256,
  startDocument,
  transition,
} from '../src/studio/model.js';

// The rules of Report Studio as functions of a document: each case says what is refused and why, and
// beside it what is allowed, so that a rule that is dropped is noticed from either side.

const T0 = '2026-10-30T10:00:00.000Z';
const at = (minute: number): string => new Date(Date.parse(T0) + minute * 60_000).toISOString();

const GROUNDING = {
  checkedAt: T0,
  method: 'deterministic' as const,
  claims: [],
  counts: { supported: 0, partial: 0, unsupported: 0, contradicted: 0, unchecked: 0 },
  unverifiedFigures: [],
  notes: [],
};

function report(overrides: Partial<SimulationReport> = {}): SimulationReport {
  return {
    generatedBy: 'llm',
    title: 'Ferry report',
    executiveSummary: 'A conditional summary of the ferry scenario, written by the model.',
    sections: [
      {
        title: 'Evidence',
        body: 'Body of the evidence chapter.',
        sourceIds: ['S1'],
        memoryIds: ['M1'],
      },
      { title: 'Trajectories', body: 'Body of the trajectories chapter.', sourceIds: [] },
    ],
    limitations: ['This is not a forecast.', 'Personas are fictional.'],
    grounding: GROUNDING,
    metrics: {
      initialMean: 0,
      finalMean: 0.2,
      finalSupport: 0.5,
      finalOpposition: 0.3,
      polarization: 0.2,
      totalInteractions: 10,
    },
    ...overrides,
  };
}

const PERSON = 'author';
const REVIEWER = 'reviewer';

const fresh = (): StudioDocument => startDocument(report(), PERSON, T0);

function refused(operation: () => unknown): AppError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('The operation was allowed, and should have been refused.');
}

/** Edits S1 and returns the document, for tests that need one with a person's work in it. */
function edited(
  doc = fresh(),
  body = 'The evidence chapter, as a person wrote it.',
): StudioDocument {
  return editSection(
    doc,
    'S1',
    { body, expectedVersion: findSection(doc, 'S1').version, reason: null },
    PERSON,
    at(1),
  );
}

const proposal = (
  doc: StudioDocument,
  overrides: Partial<StudioProposal> = {},
): StudioProposal => ({
  id: 'proposal-1',
  sectionId: 'S1',
  baseVersion: findSection(doc, 'S1').version,
  body: 'Regenerated evidence chapter text.',
  statements: [],
  grounding: { ...GROUNDING, unverifiedFigures: [] },
  instruction: null,
  actor: PERSON,
  at: at(2),
  usage: { modelCalls: 2, inputTokens: 20, outputTokens: 10 },
  ...overrides,
});

describe('opening a document from a generated report', () => {
  it('makes a section for the summary, each chapter in order, and the limitations', () => {
    const doc = fresh();
    expect(doc.sections.map((s) => [s.id, s.kind, s.title])).toEqual([
      ['summary', 'summary', 'Executive summary'],
      ['S1', 'chapter', 'Evidence'],
      ['S2', 'chapter', 'Trajectories'],
      ['limitations', 'limitations', 'Limitations'],
    ]);
    expect(findSection(doc, 'limitations').body).toBe(
      'This is not a forecast.\nPersonas are fictional.',
    );
    expect(findSection(doc, 'S1').citations).toEqual({
      sourceIds: ['S1'],
      memoryIds: ['M1'],
      interviewIds: [],
    });
  });

  it('starts as a draft at revision 1 with every section at version 1, as generated', () => {
    const doc = fresh();
    expect(doc).toMatchObject({ state: 'draft', revision: 1, approval: null, proposals: [] });
    for (const section of doc.sections) {
      expect(section).toMatchObject({ version: 1, origin: 'generated', locked: null, notes: [] });
      expect(section.versions).toEqual([
        {
          version: 1,
          body: section.body,
          origin: 'generated',
          actor: 'system',
          at: T0,
          reason: null,
          restoredFrom: null,
        },
      ]);
    }
    expect(doc.decisions).toEqual([
      { action: 'started', actor: PERSON, at: T0, note: null, revision: 1 },
    ]);
  });

  it('records which generated report it was made from, and so notices a different one', () => {
    const doc = fresh();
    expect(doc.baseHash).toBe(reportHash(report()));
    expect(doc.baseHash).not.toBe(
      reportHash(report({ executiveSummary: 'A different summary of the scenario.' })),
    );
  });

  it('leaves the statements of generated chapters to the ledger, and checks only what a review covered', () => {
    const grounded = fresh();
    expect(findSection(grounded, 'S1').checked).toEqual([
      {
        hash: sha256('Body of the evidence chapter.'),
        from: 'ledger',
        statements: [],
        grounding: null,
      },
    ]);
    // The summary and the limitations are not statements the review lists.
    expect(findSection(grounded, 'summary').checked).toEqual([]);
    expect(findSection(grounded, 'limitations').checked).toEqual([]);
    // A rules-based report has no review: nothing was checked.
    const rules = startDocument(report({ generatedBy: 'local', grounding: undefined }), PERSON, T0);
    expect(findSection(rules, 'S1').checked).toEqual([]);
  });
});

describe('editing a section', () => {
  it('adds a version written by the person, and leaves the earlier text in the history', () => {
    const doc = edited();
    const section = findSection(doc, 'S1');
    expect(section).toMatchObject({
      version: 2,
      origin: 'human',
      body: 'The evidence chapter, as a person wrote it.',
    });
    expect(section.versions.map((v) => [v.version, v.origin, v.actor])).toEqual([
      [1, 'generated', 'system'],
      [2, 'human', PERSON],
    ]);
    expect(section.versions[0]!.body).toBe('Body of the evidence chapter.');
    expect(doc.revision).toBe(fresh().revision + 1);
  });

  it('does not change the other sections', () => {
    const before = fresh();
    const after = edited(before);
    for (const id of ['summary', 'S2', 'limitations']) {
      expect(findSection(after, id)).toEqual(findSection(before, id));
    }
  });

  it('treats line endings and surrounding space as no edit at all, and stores them normalised', () => {
    const doc = fresh();
    expect(normaliseBody('  a\r\nb\r\n\r\n')).toBe('a\nb');
    const same = refused(() =>
      editSection(
        doc,
        'S1',
        { body: '  Body of the evidence chapter.\r\n', expectedVersion: 1, reason: null },
        PERSON,
        at(1),
      ),
    );
    expect(same.code).toBe('NO_CHANGE');
    const changed = editSection(
      doc,
      'S1',
      { body: 'First\r\nSecond  ', expectedVersion: 1, reason: 'tidy' },
      PERSON,
      at(1),
    );
    expect(findSection(changed, 'S1').body).toBe('First\nSecond');
    expect(findSection(changed, 'S1').versions.at(-1)!.reason).toBe('tidy');
  });

  it('refuses an empty section', () => {
    expect(
      refused(() =>
        editSection(
          fresh(),
          'S1',
          { body: ' \n ', expectedVersion: 1, reason: null },
          PERSON,
          at(1),
        ),
      ).code,
    ).toBe('SECTION_EMPTY');
  });

  it('refuses an edit made on a version that is no longer the current one, rather than overwrite', () => {
    const once = edited();
    const error = refused(() =>
      editSection(
        once,
        'S1',
        { body: 'Another person’s text.', expectedVersion: 1, reason: null },
        'other',
        at(3),
      ),
    );
    expect(error).toMatchObject({ statusCode: 409, code: 'SECTION_CONFLICT' });
    // The same text on the current version is allowed.
    expect(
      findSection(
        editSection(
          once,
          'S1',
          { body: 'Another person’s text.', expectedVersion: 2, reason: null },
          'other',
          at(3),
        ),
        'S1',
      ).version,
    ).toBe(3);
  });

  it('refuses a section that does not exist', () => {
    expect(
      refused(() =>
        editSection(
          fresh(),
          'S9',
          { body: 'x text', expectedVersion: 1, reason: null },
          PERSON,
          at(1),
        ),
      ).code,
    ).toBe('SECTION_NOT_FOUND');
  });

  it('refuses a locked section, and allows it again once unlocked', () => {
    const locked = setLock(fresh(), 'S1', true, PERSON, at(1));
    expect(refused(() => edited(locked)).code).toBe('SECTION_LOCKED');
    expect(findSection(edited(setLock(locked, 'S1', false, PERSON, at(2))), 'S1').version).toBe(2);
  });

  it('refuses while regenerated text waits for a decision on that section, and not on another', () => {
    const base = fresh();
    const waiting = addProposal(base, proposal(base), at(2));
    expect(refused(() => edited(waiting)).code).toBe('PROPOSAL_PENDING');
    const other = editSection(
      waiting,
      'S2',
      { body: 'Edited trajectories.', expectedVersion: 1, reason: null },
      PERSON,
      at(3),
    );
    expect(findSection(other, 'S2').version).toBe(2);
  });

  it('keeps every version, and refuses to go past the limit rather than drop history', () => {
    let doc = fresh();
    for (let i = 1; i < MAX_VERSIONS_PER_SECTION; i += 1) {
      doc = editSection(
        doc,
        'S1',
        { body: `Text number ${i}`, expectedVersion: i, reason: null },
        PERSON,
        at(i),
      );
    }
    const section = findSection(doc, 'S1');
    expect(section.versions).toHaveLength(MAX_VERSIONS_PER_SECTION);
    expect(section.versions[0]!.body).toBe('Body of the evidence chapter.');
    const error = refused(() =>
      editSection(
        doc,
        'S1',
        { body: 'One too many.', expectedVersion: MAX_VERSIONS_PER_SECTION, reason: null },
        PERSON,
        at(200),
      ),
    );
    expect(error.code).toBe('VERSION_LIMIT');
  });
});

describe('what may be changed in which state', () => {
  const submitted = (doc: StudioDocument) =>
    transition(doc, 'submit', { expectedRevision: doc.revision, note: null }, PERSON, at(5));
  const approved = (doc: StudioDocument) =>
    transition(
      submitted(doc),
      'approve',
      { expectedRevision: submitted(doc).revision, note: null },
      REVIEWER,
      at(6),
    );

  it.each([
    ['in review', (doc: StudioDocument) => submitted(doc)],
    ['approved', (doc: StudioDocument) => approved(doc)],
  ])('refuses every change of the text while %s', (_name, make) => {
    const doc = make(fresh());
    const code = (operation: () => unknown) => refused(operation).code;
    expect(code(() => edited(doc))).toBe('STUDIO_NOT_EDITABLE');
    expect(code(() => setLock(doc, 'S1', true, PERSON, at(7)))).toBe('STUDIO_NOT_EDITABLE');
    expect(
      code(() =>
        restoreVersion(doc, 'S1', { version: 1, expectedVersion: 1, reason: null }, PERSON, at(7)),
      ),
    ).toBe('STUDIO_NOT_EDITABLE');
    expect(code(() => addProposal(doc, proposal(doc), at(7)))).toBe('STUDIO_NOT_EDITABLE');
  });

  it('allows a reviewer’s note in every state, and the note does not disturb an approval', () => {
    for (const make of [fresh, () => submitted(fresh()), () => approved(fresh())]) {
      const doc = make();
      const noted = addNote(doc, 'S1', 'Check the ridership figure.', REVIEWER, at(8), 'n1');
      expect(findSection(noted, 'S1').notes).toEqual([
        { id: 'n1', actor: REVIEWER, at: at(8), text: 'Check the ridership figure.' },
      ]);
      expect(contentHash(noted.sections)).toBe(contentHash(doc.sections));
      expect(noted.state).toBe(doc.state);
    }
    const done = approved(fresh());
    expect(
      approvalCurrent(addNote(done, 'S1', 'A note after approval.', REVIEWER, at(9), 'n2')),
    ).toBe(true);
  });

  it('allows a note on a section that is locked, and refuses the 51st note', () => {
    let doc = setLock(fresh(), 'S1', true, PERSON, at(1));
    for (let i = 0; i < MAX_NOTES_PER_SECTION; i += 1)
      doc = addNote(doc, 'S1', `Note ${i}`, REVIEWER, at(2), `n${i}`);
    expect(findSection(doc, 'S1').notes).toHaveLength(MAX_NOTES_PER_SECTION);
    expect(refused(() => addNote(doc, 'S1', 'One too many', REVIEWER, at(3), 'x')).code).toBe(
      'NOTE_LIMIT',
    );
  });

  it('refuses to lock what is locked, or unlock what is not, and not while regenerated text waits', () => {
    const doc = fresh();
    expect(refused(() => setLock(doc, 'S1', false, PERSON, at(1))).code).toBe('NO_CHANGE');
    const locked = setLock(doc, 'S1', true, PERSON, at(1));
    expect(findSection(locked, 'S1').locked).toEqual({ actor: PERSON, at: at(1) });
    expect(refused(() => setLock(locked, 'S1', true, PERSON, at(2))).code).toBe('NO_CHANGE');
    const waiting = addProposal(doc, proposal(doc), at(2));
    expect(refused(() => setLock(waiting, 'S1', true, PERSON, at(3))).code).toBe(
      'PROPOSAL_PENDING',
    );
  });
});

describe('restoring an earlier version', () => {
  it('brings the text back as a new version that says where it came from, and keeps the history', () => {
    const doc = edited();
    const restored = restoreVersion(
      doc,
      'S1',
      { version: 1, expectedVersion: 2, reason: 'The first was better' },
      PERSON,
      at(4),
    );
    const section = findSection(restored, 'S1');
    expect(section).toMatchObject({
      version: 3,
      body: 'Body of the evidence chapter.',
      origin: 'generated',
    });
    expect(section.versions.at(-1)).toMatchObject({
      version: 3,
      restoredFrom: 1,
      reason: 'The first was better',
      actor: PERSON,
    });
    expect(section.versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('makes the statements that were checked against that text describe the section again', () => {
    const original = findSection(fresh(), 'S1');
    expect(checkedFor(original)?.from).toBe('ledger');
    const doc = edited();
    expect(checkedFor(findSection(doc, 'S1'))).toBeUndefined();
    const restored = restoreVersion(
      doc,
      'S1',
      { version: 1, expectedVersion: 2, reason: null },
      PERSON,
      at(4),
    );
    expect(checkedFor(findSection(restored, 'S1'))?.from).toBe('ledger');
  });

  it('refuses a version that does not exist, the text already there, a stale version number and a locked section', () => {
    const doc = edited();
    expect(
      refused(() =>
        restoreVersion(doc, 'S1', { version: 9, expectedVersion: 2, reason: null }, PERSON, at(4)),
      ).code,
    ).toBe('VERSION_NOT_FOUND');
    expect(
      refused(() =>
        restoreVersion(doc, 'S1', { version: 2, expectedVersion: 2, reason: null }, PERSON, at(4)),
      ).code,
    ).toBe('NO_CHANGE');
    expect(
      refused(() =>
        restoreVersion(doc, 'S1', { version: 1, expectedVersion: 1, reason: null }, PERSON, at(4)),
      ).code,
    ).toBe('SECTION_CONFLICT');
    const locked = setLock(doc, 'S1', true, PERSON, at(3));
    expect(
      refused(() =>
        restoreVersion(
          locked,
          'S1',
          { version: 1, expectedVersion: 2, reason: null },
          PERSON,
          at(4),
        ),
      ).code,
    ).toBe('SECTION_LOCKED');
  });
});

describe('regenerated text', () => {
  const decide = (
    doc: StudioDocument,
    decision: 'accept' | 'reject',
    expectedVersion?: number,
    proposalId = 'proposal-1',
  ) =>
    decideProposal(
      doc,
      'S1',
      { decision, proposalId, expectedVersion: expectedVersion ?? findSection(doc, 'S1').version },
      REVIEWER,
      at(5),
    );

  it('changes nothing in the section until a person accepts it', () => {
    const base = fresh();
    const waiting = addProposal(base, proposal(base), at(2));
    expect(waiting.proposals).toHaveLength(1);
    expect(findSection(waiting, 'S1')).toEqual(findSection(base, 'S1'));
    expect(contentHash(waiting.sections)).toBe(contentHash(base.sections));
  });

  it('is accepted as a version that says it was regenerated, with its own checked statements', () => {
    const base = fresh();
    const waiting = addProposal(
      base,
      proposal(base, { instruction: 'Shorter and plainer' }),
      at(2),
    );
    const accepted = decide(waiting, 'accept');
    const section = findSection(accepted, 'S1');
    expect(section).toMatchObject({
      version: 2,
      origin: 'regenerated',
      body: 'Regenerated evidence chapter text.',
    });
    expect(section.versions.at(-1)).toMatchObject({
      actor: REVIEWER,
      reason: 'Regenerated: Shorter and plainer',
    });
    expect(checkedFor(section)).toMatchObject({
      from: 'section',
      hash: sha256('Regenerated evidence chapter text.'),
    });
    expect(accepted.proposals).toEqual([]);
  });

  it('is turned down without any change to the text, and then another may be asked for', () => {
    const base = fresh();
    const waiting = addProposal(base, proposal(base), at(2));
    const rejected = decide(waiting, 'reject');
    expect(findSection(rejected, 'S1')).toEqual(findSection(base, 'S1'));
    expect(rejected.proposals).toEqual([]);
    expect(
      addProposal(rejected, proposal(rejected, { id: 'proposal-2' }), at(6)).proposals,
    ).toHaveLength(1);
  });

  it('allows only one waiting proposal for a section, and none for a locked one', () => {
    const base = fresh();
    const waiting = addProposal(base, proposal(base), at(2));
    expect(
      refused(() => addProposal(waiting, proposal(base, { id: 'proposal-2' }), at(3))).code,
    ).toBe('PROPOSAL_PENDING');
    const locked = setLock(base, 'S1', true, PERSON, at(1));
    expect(refused(() => addProposal(locked, proposal(locked), at(2))).code).toBe('SECTION_LOCKED');
  });

  it('is refused if the section changed while it was being written', () => {
    const base = fresh();
    const stale = proposal(base);
    expect(refused(() => addProposal(edited(base), stale, at(3))).code).toBe('SECTION_CONFLICT');
  });

  it('is not accepted on a section that has moved on, and not under another proposal’s name', () => {
    const base = fresh();
    const waiting = addProposal(base, proposal(base), at(2));
    expect(refused(() => decide(waiting, 'accept', 5)).code).toBe('SECTION_CONFLICT');
    expect(refused(() => decide(waiting, 'accept', 1, 'someone-else')).code).toBe(
      'PROPOSAL_NOT_FOUND',
    );
    // Defence in depth: a proposal written for an older version is stale even if the numbers line up elsewhere.
    const behind: StudioDocument = {
      ...waiting,
      proposals: [{ ...waiting.proposals[0]!, baseVersion: 0 }],
    };
    expect(refused(() => decide(behind, 'accept')).code).toBe('PROPOSAL_STALE');
    expect(findSection(decide(behind, 'reject'), 'S1').version).toBe(1);
  });

  it('is not accepted into a section that is locked, nor decided on in another section’s name', () => {
    const base = fresh();
    const waiting = addProposal(base, proposal(base), at(2));
    const locked: StudioDocument = {
      ...waiting,
      sections: waiting.sections.map((s) =>
        s.id === 'S1' ? { ...s, locked: { actor: PERSON, at: at(3) } } : s,
      ),
    };
    expect(refused(() => decide(locked, 'accept')).code).toBe('SECTION_LOCKED');
    expect(
      refused(() =>
        decideProposal(
          waiting,
          'S2',
          { decision: 'accept', proposalId: 'proposal-1', expectedVersion: 1 },
          REVIEWER,
          at(5),
        ),
      ).code,
    ).toBe('PROPOSAL_NOT_FOUND');
  });

  it('keeps the statements of a regenerated text only up to a bound, and says so', () => {
    const base = fresh();
    const crowded: StudioDocument = {
      ...base,
      sections: base.sections.map((s) =>
        s.id === 'S1'
          ? {
              ...s,
              checked: Array.from({ length: MAX_CHECKED_TEXTS }, (_, i) => ({
                hash: sha256(`t${i}`),
                from: 'section' as const,
                statements: [],
                grounding: null,
              })),
            }
          : s,
      ),
    };
    const waiting = addProposal(crowded, proposal(crowded), at(2));
    expect(refused(() => decide(waiting, 'accept')).code).toBe('CHECKED_LIMIT');
  });
});

describe('the review workflow', () => {
  const move = (
    doc: StudioDocument,
    kind: Parameters<typeof transition>[1],
    actor = PERSON,
    note: string | null = null,
  ) =>
    transition(doc, kind, { expectedRevision: doc.revision, note }, actor, at(10 + doc.revision));

  it('goes from draft to review to approved, and records each step with who took it', () => {
    const inReview = move(fresh(), 'submit');
    expect(inReview.state).toBe('in-review');
    const approved = move(inReview, 'approve', REVIEWER);
    expect(approved.state).toBe('approved');
    expect(approved.decisions.map((d) => [d.action, d.actor])).toEqual([
      ['started', PERSON],
      ['submitted', PERSON],
      ['approved', REVIEWER],
    ]);
  });

  it('ties an approval to the exact text, so that a printed memo can be matched to it', () => {
    const doc = edited();
    const approved = move(move(doc, 'submit'), 'approve', REVIEWER);
    expect(approved.approval).toMatchObject({
      actor: REVIEWER,
      revision: approved.revision,
      contentHash: contentHash(doc.sections),
    });
    expect(approvalCurrent(approved)).toBe(true);
    // Anything that changes the text behind it is visibly not what was approved.
    const tampered: StudioDocument = {
      ...approved,
      sections: approved.sections.map((s) =>
        s.id === 'S2' ? { ...s, body: 'Changed behind the approval.' } : s,
      ),
    };
    expect(approvalCurrent(tampered)).toBe(false);
    expect(approvalCurrent(fresh())).toBe(false);
  });

  it('says whether the approver also wrote part of what they approved', () => {
    const byOther = move(move(edited(), 'submit'), 'approve', REVIEWER);
    expect(byOther.approval?.alsoEdited).toBe(false);
    const bySelf = move(move(edited(), 'submit'), 'approve', PERSON);
    expect(bySelf.approval?.alsoEdited).toBe(true);
    // A person who only read it has not edited it; the generated text is the system’s, not theirs.
    expect(move(move(fresh(), 'submit'), 'approve', PERSON).approval?.alsoEdited).toBe(false);
  });

  it('is decided on the revision the person looked at: any other is refused', () => {
    const inReview = move(fresh(), 'submit');
    for (const kind of ['approve', 'request-changes'] as const) {
      const error = refused(() =>
        transition(
          inReview,
          kind,
          { expectedRevision: inReview.revision - 1, note: 'Because.' },
          REVIEWER,
          at(20),
        ),
      );
      expect(error).toMatchObject({ statusCode: 409, code: 'STUDIO_CHANGED' });
    }
  });

  it('refuses a step from the wrong state, and says which state it needs', () => {
    const doc = fresh();
    const error = refused(() => move(doc, 'approve', REVIEWER));
    expect(error).toMatchObject({ code: 'STUDIO_STATE' });
    expect(error.message).toContain('draft');
    expect(error.message).toContain('in review');
    expect(refused(() => move(move(doc, 'submit'), 'submit')).code).toBe('STUDIO_STATE');
    const approved = move(move(doc, 'submit'), 'approve', REVIEWER);
    expect(refused(() => move(approved, 'approve', REVIEWER)).code).toBe('STUDIO_STATE');
    expect(refused(() => move(doc, 'reopen', PERSON, 'Reason given.')).code).toBe('STUDIO_STATE');
  });

  it('needs a reason to send a report back or to reopen it, and not to submit or approve', () => {
    const inReview = move(fresh(), 'submit');
    expect(refused(() => move(inReview, 'request-changes', REVIEWER, null)).code).toBe(
      'NOTE_REQUIRED',
    );
    expect(refused(() => move(inReview, 'request-changes', REVIEWER, ' ')).code).toBe(
      'NOTE_REQUIRED',
    );
    const sentBack = move(
      inReview,
      'request-changes',
      REVIEWER,
      'The ridership figure needs a source.',
    );
    expect(sentBack).toMatchObject({ state: 'changes-requested', approval: null });
    expect(sentBack.decisions.at(-1)).toMatchObject({
      action: 'changes-requested',
      note: 'The ridership figure needs a source.',
    });
    const approved = move(inReview, 'approve', REVIEWER);
    expect(refused(() => move(approved, 'reopen', PERSON, null)).code).toBe('NOTE_REQUIRED');
  });

  it('lets a report that was sent back be edited and submitted again', () => {
    const sentBack = move(
      move(fresh(), 'submit'),
      'request-changes',
      REVIEWER,
      'Fix the figure please.',
    );
    const fixed = edited(sentBack);
    expect(fixed.state).toBe('changes-requested');
    expect(move(fixed, 'submit').state).toBe('in-review');
  });

  it('takes the approval away when the report is reopened, and keeps the record that it was given', () => {
    const approved = move(move(fresh(), 'submit'), 'approve', REVIEWER);
    const reopened = move(approved, 'reopen', PERSON, 'New evidence arrived.');
    expect(reopened).toMatchObject({ state: 'draft', approval: null });
    expect(reopened.decisions.map((d) => d.action)).toEqual([
      'started',
      'submitted',
      'approved',
      'reopened',
    ]);
    // It may be edited again, and approved again only after review again.
    expect(findSection(edited(reopened), 'S1').version).toBe(2);
    expect(refused(() => move(reopened, 'approve', REVIEWER)).code).toBe('STUDIO_STATE');
  });

  it('can be withdrawn from review by reopening it', () => {
    const inReview = move(fresh(), 'submit');
    expect(move(inReview, 'reopen', PERSON, 'I found a mistake.').state).toBe('draft');
  });

  it('is not submitted while regenerated text is waiting for a decision', () => {
    const base = fresh();
    const waiting = addProposal(base, proposal(base), at(2));
    expect(refused(() => move(waiting, 'submit')).code).toBe('PROPOSAL_PENDING');
  });

  it('bumps the revision on every change, and only then', () => {
    let doc = fresh();
    const seen = [doc.revision];
    for (const next of [
      (d: StudioDocument) => edited(d),
      (d: StudioDocument) => setLock(d, 'S2', true, PERSON, at(3)),
      (d: StudioDocument) => addNote(d, 'S2', 'A note', REVIEWER, at(4), 'n'),
      (d: StudioDocument) => move(d, 'submit'),
    ]) {
      doc = next(doc);
      seen.push(doc.revision);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('a newer generated report', () => {
  const newer = report({
    executiveSummary: 'A newer summary, from a report that was generated again.',
  });

  it('is refused when the document is already made from the report that is there', () => {
    expect(refused(() => restartDocument(fresh(), report(), PERSON, at(30), true)).code).toBe(
      'STUDIO_CURRENT',
    );
  });

  it('restarts a document nobody worked on without asking, and keeps its text in the archive', () => {
    expect(hasPeopleContent(fresh())).toBe(false);
    const restarted = restartDocument(fresh(), newer, PERSON, at(30), false);
    expect(restarted.baseHash).toBe(reportHash(newer));
    expect(findSection(restarted, 'summary').body).toBe(newer.executiveSummary);
    expect(restarted.archive).toHaveLength(1);
    expect(restarted.archive[0]!.sections.find((s) => s.id === 'S1')!.body).toBe(
      'Body of the evidence chapter.',
    );
    expect(restarted.revision).toBe(2);
    expect(restarted.decisions.map((d) => d.action)).toEqual(['started', 'restarted']);
  });

  it('needs a person’s say-so before it replaces edits, notes, a lock or a decision', () => {
    const worked = [
      edited(),
      addNote(fresh(), 'S1', 'A note', REVIEWER, at(1), 'n'),
      setLock(fresh(), 'S1', true, PERSON, at(1)),
      transition(fresh(), 'submit', { expectedRevision: 1, note: null }, PERSON, at(1)),
    ];
    for (const doc of worked) {
      expect(hasPeopleContent(doc)).toBe(true);
      expect(refused(() => restartDocument(doc, newer, PERSON, at(30), false)).code).toBe(
        'CONFIRM_REQUIRED',
      );
      expect(restartDocument(doc, newer, PERSON, at(30), true).archive).toHaveLength(1);
    }
  });

  it('keeps the person’s text, and the approval that was given, in the archive', () => {
    const approved = transition(
      transition(edited(), 'submit', { expectedRevision: 2, note: null }, PERSON, at(5)),
      'approve',
      { expectedRevision: 3, note: null },
      REVIEWER,
      at(6),
    );
    const restarted = restartDocument(approved, newer, PERSON, at(30), true);
    const [kept] = restarted.archive;
    expect(kept).toMatchObject({ state: 'approved', approval: { actor: REVIEWER } });
    expect(kept!.sections.find((s) => s.id === 'S1')).toMatchObject({
      body: 'The evidence chapter, as a person wrote it.',
      origin: 'human',
      version: 2,
    });
    // The new document is a draft made from the newer report, with no approval of its own.
    expect(restarted).toMatchObject({ state: 'draft', approval: null });
  });

  it('keeps the archive of earlier restarts up to a bound, and says when the oldest is dropped', () => {
    let doc = fresh();
    for (let i = 0; i < MAX_ARCHIVES; i += 1) {
      doc = restartDocument(
        doc,
        report({ executiveSummary: `Summary of generation ${i + 1} of the report.` }),
        PERSON,
        at(40 + i),
        true,
      );
    }
    expect(doc.archive).toHaveLength(MAX_ARCHIVES);
    const last = restartDocument(
      doc,
      report({ executiveSummary: 'The summary of one more generation.' }),
      PERSON,
      at(60),
      true,
    );
    expect(last.archive).toHaveLength(MAX_ARCHIVES);
    expect(last.decisions.at(-1)!.note).toContain('oldest archived document was dropped');
  });
});

describe('the hash of the content', () => {
  it('changes with any section’s text, and not with notes, locks or the order of events', () => {
    const doc = fresh();
    expect(contentHash(doc.sections)).toBe(contentHash(fresh().sections));
    expect(contentHash(edited(doc).sections)).not.toBe(contentHash(doc.sections));
    expect(contentHash(setLock(doc, 'S1', true, PERSON, at(1)).sections)).toBe(
      contentHash(doc.sections),
    );
    // Moving text between sections is a change: the identifier is part of what is hashed.
    const swapped = doc.sections.map((s) =>
      s.id === 'S1' ? { ...s, body: 'x' } : s.id === 'S2' ? { ...s, body: 'y' } : s,
    );
    const swappedBack = doc.sections.map((s) =>
      s.id === 'S1' ? { ...s, body: 'y' } : s.id === 'S2' ? { ...s, body: 'x' } : s,
    );
    expect(contentHash(swapped)).not.toBe(contentHash(swappedBack));
  });
});
