import { describe, expect, it } from 'vitest';
import { claimRecord } from '../../test/ledger';
import { sectionView, studioView } from '../../test/studio';
import {
  authorship,
  checkDraft,
  chapterNumber,
  draftState,
  excerpt,
  frozenReason,
  isDirty,
  listItems,
  neighbour,
  paragraphs,
  provenanceNote,
  rebase,
  sectionAccess,
  sectionKicker,
  sectionMarks,
  splitEdges,
  startDraft,
  submitBlocker,
  supportSegments,
  toolsOf,
  workflowSteps,
  type StudioDocument,
} from './model';

const documentOf = (overrides: Parameters<typeof studioView>[0] = {}): StudioDocument =>
  studioView(overrides).document!;

describe('workflowSteps', () => {
  it('places a draft at the first place and nothing done', () => {
    const steps = workflowSteps('draft');
    expect(steps.map((step) => step.status)).toEqual(['current', 'upcoming', 'upcoming']);
    expect(steps[0]).toMatchObject({ label: 'Draft', tone: 'accent' });
  });

  it('puts a report sent back at the first place and says why in its name, with the caution tone', () => {
    const steps = workflowSteps('changes-requested');
    expect(steps.map((step) => step.status)).toEqual(['current', 'upcoming', 'upcoming']);
    expect(steps[0]).toMatchObject({ label: 'Changes requested', tone: 'caution' });
  });

  it('marks the places passed as done, and an approved report as favourable', () => {
    expect(workflowSteps('in-review').map((step) => step.status)).toEqual([
      'done',
      'current',
      'upcoming',
    ]);
    const approved = workflowSteps('approved');
    expect(approved.map((step) => step.status)).toEqual(['done', 'done', 'current']);
    expect(approved[2]!.tone).toBe('favor');
  });
});

describe('frozenReason', () => {
  it('says nothing of a draft that its author can change', () => {
    const view = studioView();
    expect(frozenReason(view, view.document!)).toBeNull();
  });

  it('offers a new copy only to someone who can edit, and only while there is a report to start from', () => {
    const stale = studioView({ stale: true });
    expect(frozenReason(stale, stale.document!)).toMatchObject({
      kind: 'stale',
      action: 'restart',
    });
    const reader = studioView({
      stale: true,
      capabilities: { edit: false, review: false, export: true },
    });
    expect(frozenReason(reader, reader.document!)).toMatchObject({ kind: 'stale', action: null });
    const gone = studioView({ stale: true, reportReady: false });
    expect(frozenReason(gone, gone.document!)?.action).toBeNull();
  });

  it('names the one thing that unfreezes the text of an approved report and of one in review', () => {
    const approved = studioView({ document: { state: 'approved' } });
    expect(frozenReason(approved, approved.document!)).toMatchObject({
      kind: 'approved',
      action: 'reopen',
    });
    const review = studioView({ document: { state: 'in-review' } });
    expect(frozenReason(review, review.document!)).toMatchObject({
      kind: 'in-review',
      action: 'withdraw',
    });
  });

  it('says that a person without the edit capability can only read', () => {
    const view = studioView({ capabilities: { edit: false, review: true, export: true } });
    expect(frozenReason(view, view.document!)).toMatchObject({ kind: 'read-only', action: null });
  });
});

describe('sectionAccess and submitBlocker', () => {
  it('lets a draft be written, and says why a locked section or one with a rewrite waiting cannot', () => {
    const view = studioView();
    const document = view.document!;
    expect(sectionAccess(view, document, { locked: null, proposal: null })).toEqual({
      editable: true,
      canWrite: true,
      blocked: null,
    });
    const locked = sectionAccess(view, document, {
      locked: { actor: 'local-user', at: 'x' },
      proposal: null,
    });
    expect(locked.canWrite).toBe(false);
    expect(locked.blocked).toMatch(/locked/iu);
    const waiting = sectionAccess(view, document, {
      locked: null,
      proposal: sectionView().proposal ?? ({ id: 'P' } as never),
    });
    expect(waiting.blocked).toMatch(/rewrite is waiting/iu);
  });

  it('does not let anything be written in a report that is in review or approved, or that is stale', () => {
    for (const state of ['in-review', 'approved'] as const) {
      const view = studioView({ document: { state } });
      expect(sectionAccess(view, view.document!, { locked: null, proposal: null }).editable).toBe(
        false,
      );
    }
    const stale = studioView({ stale: true });
    expect(sectionAccess(stale, stale.document!, { locked: null, proposal: null }).editable).toBe(
      false,
    );
  });

  it('holds back a submission while a rewrite waits, naming the chapter or counting the chapters', () => {
    const view = studioView();
    const document = view.document!;
    expect(submitBlocker(view, document)).toBeNull();
    const proposal = { id: 'P-1' } as never;
    document.sections[1]!.proposal = proposal;
    expect(submitBlocker(view, document)).toContain(document.sections[1]!.title);
    document.sections[2]!.proposal = proposal;
    expect(submitBlocker(view, document)).toMatch(/2 waiting rewrites/u);
    expect(submitBlocker({ ...view, stale: true }, document)).toMatch(/replaced/u);
  });
});

describe('drafts', () => {
  const section = { body: 'The first text.', version: 3 };

  it('is not dirty until the words differ, and does not count line endings or the white space around the text', () => {
    const draft = startDraft(section);
    expect(isDirty(draft)).toBe(false);
    expect(isDirty({ ...draft, text: '  The first text.\r\n' })).toBe(false);
    expect(isDirty({ ...draft, text: 'The first text, changed.' })).toBe(true);
    expect(isDirty(undefined)).toBe(false);
  });

  it('says a draft is behind only when it holds words and the section has moved on', () => {
    const draft = { ...startDraft(section), text: 'Mine.' };
    expect(draftState(undefined, section)).toBe('none');
    expect(draftState(startDraft(section), section)).toBe('clean');
    expect(draftState(draft, section)).toBe('dirty');
    expect(draftState(draft, { version: 4 })).toBe('behind');
  });

  it('follows the section when nobody has written in it, and never moves words that were written', () => {
    const untouched = startDraft(section);
    const moved = rebase(untouched, { body: 'Newer.', version: 4 });
    expect(moved).toMatchObject({ text: 'Newer.', baseVersion: 4 });
    const written = { ...untouched, text: 'Mine.' };
    expect(rebase(written, { body: 'Newer.', version: 4 })).toBe(written);
  });

  it('refuses what the server refuses: nothing changed, nothing at all, and more than the limit', () => {
    const draft = startDraft(section);
    const limits = { maxBody: 20 };
    expect(checkDraft(draft, section, limits)).toEqual({
      ok: false,
      reason: 'Nothing has changed.',
    });
    expect(checkDraft({ ...draft, text: '   ' }, section, limits).reason).toMatch(/empty/u);
    expect(checkDraft({ ...draft, text: 'x'.repeat(21) }, section, limits).reason).toMatch(
      /too long/iu,
    );
    expect(checkDraft({ ...draft, text: 'A new text.' }, section, limits)).toEqual({
      ok: true,
      reason: null,
    });
  });
});

describe('text', () => {
  it('splits paragraphs at blank lines and keeps a single line break inside one', () => {
    expect(paragraphs('One\nstill one.\n\n\nTwo.\r\n\r\n  \nThree.')).toEqual([
      'One\nstill one.',
      'Two.',
      'Three.',
    ]);
    expect(paragraphs('   ')).toEqual([]);
  });

  it('reads a list one entry to a line, without bullets', () => {
    expect(listItems('- One\n* Two\n\n  Three  ')).toEqual(['One', 'Two', 'Three']);
  });

  it('shows the quoted words with a little around them, and says where it stopped', () => {
    const passage = `${'alpha '.repeat(60)}the quoted words ${'omega '.repeat(60)}`;
    const part = excerpt(passage, 'the quoted words', 40);
    expect(part.quote).toBe('the quoted words');
    expect(part.clippedStart && part.clippedEnd).toBe(true);
    expect(part.before.length).toBeLessThanOrEqual(40);
    expect(part.after.length).toBeLessThanOrEqual(40);
    expect(`${part.before}${part.quote}${part.after}`.length).toBeLessThan(passage.length);
  });

  it('starts at the start of a passage when the quotation is not in it, and never invents a highlight', () => {
    const part = excerpt('A short passage.', 'words that are not there');
    expect(part).toMatchObject({ quote: null, before: 'A short passage.', clippedEnd: false });
    expect(excerpt('Plain.', null).quote).toBeNull();
  });

  it('sets the white space at either end of a change apart from its words', () => {
    expect(splitEdges('  two words \n')).toEqual({ lead: '  ', core: 'two words', trail: ' \n' });
    expect(splitEdges('  ')).toEqual({ lead: '  ', core: '', trail: '' });
  });
});

describe('sections', () => {
  const sections = documentOf().sections;

  it('numbers the chapters and leaves the summary and the limitations to be named by their titles', () => {
    expect(chapterNumber({ id: 'S12', kind: 'chapter' })).toBe(12);
    expect(chapterNumber({ id: 'summary', kind: 'summary' })).toBeNull();
    expect(sectionKicker({ id: 'S2', kind: 'chapter' })).toBe('Chapter 2');
    expect(sectionKicker({ id: 'limitations', kind: 'limitations' })).toBeNull();
  });

  it('gives a chapter its four tools and the rest two', () => {
    expect(toolsOf({ kind: 'chapter' })).toEqual(['statements', 'notes', 'history', 'rewrite']);
    expect(toolsOf({ kind: 'summary' })).toEqual(['notes', 'history']);
  });

  it('walks to the next and the previous section and stops at the ends', () => {
    expect(neighbour(sections, sections[0]!.id, -1)).toBeNull();
    expect(neighbour(sections, sections[0]!.id, 1)).toBe(sections[1]!.id);
    expect(neighbour(sections, sections.at(-1)!.id, 1)).toBeNull();
    expect(neighbour(sections, 'missing', 1)).toBeNull();
  });

  it('counts who wrote what, and the sections as a whole', () => {
    const mixed = [
      { origin: 'generated' as const },
      { origin: 'human' as const },
      { origin: 'human' as const },
      { origin: 'regenerated' as const },
    ];
    expect(authorship(mixed)).toEqual({ generated: 1, human: 2, regenerated: 1, total: 4 });
  });

  it('lists what a reader should know of a section, most pressing first, in words', () => {
    const section = sectionView({
      origin: 'human',
      locked: { actor: 'local-user', at: 'x' },
      notes: [{ id: 'n', actor: 'a', at: 'x', text: 'y' }],
      statementsCurrent: false,
    });
    expect(sectionMarks(section, { unsaved: true }).map((mark) => mark.kind)).toEqual([
      'unsaved',
      'locked',
      'earlier',
      'notes',
      'person',
    ]);
    expect(sectionMarks(section).find((mark) => mark.kind === 'notes')?.label).toBe('1 note');
    expect(sectionMarks(sectionView())).toEqual([]);
  });

  it('does not say the statements describe an earlier text when there are none', () => {
    const none = sectionView({ statements: [], statementsCurrent: false });
    expect(sectionMarks(none).map((mark) => mark.kind)).not.toContain('earlier');
  });

  it('says only what is true about how far a section was checked', () => {
    expect(provenanceNote({ kind: 'chapter', origin: 'generated' })).toBeNull();
    expect(provenanceNote({ kind: 'chapter', origin: 'human' })).toMatch(/not been checked/u);
    expect(provenanceNote({ kind: 'chapter', origin: 'regenerated' })).toMatch(/server checked/u);
    expect(provenanceNote({ kind: 'summary', origin: 'generated' })).toMatch(/not checked/u);
  });
});

describe('supportSegments', () => {
  it('divides the statements in the order of the taxonomy and leaves out what none has', () => {
    const statements = [
      claimRecord({ supportClass: 'unsupported' }),
      claimRecord({ supportClass: 'directly-supported' }),
      claimRecord({ supportClass: 'directly-supported' }),
    ];
    expect(supportSegments(statements)).toEqual([
      { support: 'directly-supported', count: 2 },
      { support: 'unsupported', count: 1 },
    ]);
  });
});
