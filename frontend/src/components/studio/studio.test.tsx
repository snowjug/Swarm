import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  StudioProposal,
  StudioSectionView,
  StudioState,
  StudioView,
} from '../../../../shared/studio';
import { api } from '../../api';
import type { StudioHandle } from '../../hooks/useStudio';
import { claimRecord, evidenceRef } from '../../test/ledger';
import { visibleText } from '../../test/provider';
import { capabilities, sectionView, studioView, version } from '../../test/studio';
import { Diff } from './Diff';
import { ReportStudio } from './ReportStudio';
import { SectionEditor, type SectionActions } from './SectionEditor';
import { SectionOutline } from './SectionOutline';
import { StatementList } from './StatementList';
import { StepDialog } from './StepDialog';
import { StudioToolbar } from './StudioToolbar';

const mocked = vi.hoisted(() => ({ handle: null as unknown as StudioHandle }));
vi.mock('../../hooks/useStudio', () => ({ useStudio: () => mocked.handle }));

const AT = '2026-02-01T10:00:00.000Z';

function buttons(html: string): { attrs: string; text: string }[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)].map((match) => ({
    attrs: match[1] ?? '',
    text: visibleText(match[2] ?? ''),
  }));
}
const find = (html: string, label: string) =>
  buttons(html).find((entry) => entry.text.includes(label));
const present = (html: string, label: string) => find(html, label) !== undefined;
const disabled = (html: string, label: string) => {
  const entry = find(html, label);
  expect(entry, `a button "${label}"`).toBeDefined();
  return /\bdisabled=""/u.test(entry!.attrs);
};

const noop = async () => true;
const actions = (): SectionActions => ({
  edit: noop,
  lock: noop,
  note: noop,
  restore: noop,
  regenerate: noop,
  decide: noop,
});

function viewWith(
  section: StudioSectionView,
  overrides: Parameters<typeof studioView>[0] = {},
): StudioView {
  const base = studioView();
  return studioView({
    ...overrides,
    document: {
      ...(overrides.document ?? {}),
      sections: base.document!.sections.map((entry) => (entry.id === section.id ? section : entry)),
    },
  });
}

function editor(view: StudioView, sectionId = 'S1', pending: string | null = null): string {
  const document = view.document!;
  const section = document.sections.find((entry) => entry.id === sectionId)!;
  return renderToStaticMarkup(
    <SectionEditor
      view={view}
      document={document}
      section={section}
      pending={pending}
      actions={actions()}
    />,
  );
}

const proposal = (overrides: Partial<StudioProposal> = {}): StudioProposal => ({
  id: 'prop-1',
  sectionId: 'S1',
  baseVersion: 1,
  body: 'The council counted 365,000 crossings in 2025 and 90,000 more by ferry.',
  statements: [claimRecord({ id: 'G1', text: 'The council counted 365,000 crossings in 2025.' })],
  grounding: {
    method: 'deterministic+model',
    checkedAt: AT,
    counts: { supported: 1, partial: 0, unsupported: 1, contradicted: 0, unchecked: 0 },
    unverifiedFigures: ['90,000'],
    notes: ['One statement is not supported.'],
  },
  instruction: 'Stress the uncertainty',
  actor: 'local-user',
  at: AT,
  usage: { modelCalls: 2, inputTokens: 934, outputTokens: 321 },
  ...overrides,
});

describe('Diff', () => {
  it('marks added and removed words with words a screen reader says, so colour is not the only cue', () => {
    const html = renderToStaticMarkup(
      <Diff
        before="The council counted 412,000 crossings."
        after="The council counted 365,000 crossings."
      />,
    );
    expect(html).toMatch(
      /<del><span class="sr-only">\[removed: <\/span>412,000<span class="sr-only">\]<\/span><\/del>/u,
    );
    expect(html).toMatch(
      /<ins><span class="sr-only">\[added: <\/span>365,000<span class="sr-only">\]<\/span><\/ins>/u,
    );
    expect(visibleText(html)).toContain('1 word added, 1 removed.');
  });

  it('shows text with markup in it as text', () => {
    const html = renderToStaticMarkup(<Diff before="a" after="a <script>alert(1)</script>" />);
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('SectionOutline', () => {
  it('lists every section with its origin and version, and marks only the open one as current', () => {
    const view = studioView();
    const html = renderToStaticMarkup(
      <SectionOutline sections={view.document!.sections} selected="S2" onSelect={() => {}} />,
    );
    expect(html.match(/aria-current="true"/gu)).toHaveLength(1);
    expect(html).toMatch(
      /aria-current="true"[^>]*><strong>What the simulation produced<\/strong>/u,
    );
    expect(visibleText(html)).toContain('Executive summary Generated, version 1');
    expect(visibleText(html)).toContain('Limitations');
  });

  it('says what a reader should know before opening a section', () => {
    const edited = sectionView({
      origin: 'human',
      version: 2,
      statementsCurrent: false,
      locked: { actor: 'lead-1', at: AT },
    });
    const html = renderToStaticMarkup(
      <SectionOutline sections={[edited]} selected="S1" onSelect={() => {}} />,
    );
    expect(visibleText(html)).toContain('Written by a person, version 2');
    expect(visibleText(html)).toContain('Locked; Statements describe an earlier text');
  });
});

describe('StatementList', () => {
  const evidence = studioView();

  it('lists the statements the server checked, with the passage behind each and the words matched', () => {
    const html = renderToStaticMarkup(
      <StatementList section={sectionView()} evidence={evidence} />,
    );
    expect(visibleText(html)).toContain('C1 The council counted 412,000 crossings in 2025.');
    expect(visibleText(html)).toContain('Directly supported');
    expect(html).toContain('Supporting passage');
    expect(html).toMatch(/<mark>Council counts show 412,000 one-way crossings in 2025\.<\/mark>/u);
    expect(visibleText(html)).toContain('The highlighted words were found exactly as written');
  });

  it('shows contradicting evidence as contradicting, beside the supporting', () => {
    const claim = claimRecord({
      contradicting: [evidenceRef({ role: 'contradicts', passageId: 'S1', quote: null })],
    });
    const html = renderToStaticMarkup(
      <StatementList section={sectionView({ statements: [claim] })} evidence={evidence} />,
    );
    expect(html).toContain('evidence evidence-supports');
    expect(html).toContain('evidence evidence-contradicts');
    expect(visibleText(html)).toContain('Contradicting passage');
    expect(visibleText(html)).toContain('1 supporting, 1 contradicting');
    expect(visibleText(html)).toContain(
      'No exact quotation was matched; the whole passage was cited.',
    );
  });

  it('does not say words were highlighted when the quoted words are not in the stored passage', () => {
    const claim = claimRecord({
      supporting: [evidenceRef({ quote: 'words that are not in the passage' })],
    });
    const html = renderToStaticMarkup(
      <StatementList section={sectionView({ statements: [claim] })} evidence={evidence} />,
    );
    expect(html).not.toContain('<mark>');
    expect(visibleText(html)).not.toContain('The highlighted words were found');
    expect(visibleText(html)).toContain(
      'The quoted words are not in the passage as it is stored now',
    );
  });

  it('says so when a statement cites nothing, and when a cited passage is no longer there', () => {
    const none = renderToStaticMarkup(
      <StatementList
        section={sectionView({ statements: [claimRecord({ supporting: [] })] })}
        evidence={evidence}
      />,
    );
    expect(visibleText(none)).toContain('No source passage is cited for this statement.');
    const gone = renderToStaticMarkup(
      <StatementList section={sectionView()} evidence={{ ...evidence, passages: [] }} />,
    );
    expect(visibleText(gone)).toContain('The passage text is no longer available.');
  });

  it('keeps the statements of an earlier text apart and says they do not describe the text shown', () => {
    const html = renderToStaticMarkup(
      <StatementList
        section={sectionView({ origin: 'human', statementsCurrent: false })}
        evidence={evidence}
      />,
    );
    const text = visibleText(html);
    expect(text).toContain('These statements describe an earlier text of this section');
    expect(text).toContain('nothing below is a check of it');
    expect(text).toContain('Show the 1 statements of the earlier text');
    expect(html).toContain('role="status"');
  });

  it('does not list statements for a summary or the limitations, and does not claim they were checked', () => {
    const html = renderToStaticMarkup(
      <StatementList
        section={sectionView({ kind: 'summary', statements: [] })}
        evidence={evidence}
      />,
    );
    expect(visibleText(html)).toContain('are not listed statement by statement');
    expect(visibleText(html)).toContain('Figures in them are not checked here');
  });

  it('says that nothing was checked for text a person wrote, and does not show an empty list', () => {
    const html = renderToStaticMarkup(
      <StatementList section={sectionView({ statements: [] })} evidence={evidence} />,
    );
    expect(visibleText(html)).toContain('No statement of this text was checked');
    expect(html).not.toContain('studio-statements');
  });

  it('shows what a statement must be read with, and a reviewer’s note on it', () => {
    const html = renderToStaticMarkup(
      <StatementList
        section={sectionView({
          statements: [
            claimRecord({
              publication: {
                status: 'qualified',
                qualification: 'Counts differ by source.',
                reasons: [],
              },
              review: { result: 'needs-revision', note: 'Check the year.', reviewedAt: AT },
            }),
          ],
        })}
        evidence={evidence}
      />,
    );
    expect(visibleText(html)).toContain('Must be read with: Counts differ by source.');
    expect(visibleText(html)).toContain('Reviewer note: Check the year.');
  });
});

describe('StudioToolbar', () => {
  const render = (view: StudioView, pending: string | null = null): string =>
    renderToStaticMarkup(
      <StudioToolbar
        projectId="p1"
        view={view}
        document={view.document!}
        pending={pending}
        onStep={() => {}}
        onExport={() => {}}
      />,
    );
  const stateView = (state: StudioState, extra: Parameters<typeof studioView>[0] = {}) =>
    studioView({ ...extra, document: { ...(extra.document ?? {}), state } });

  it('lets an author submit a draft, and offers nothing a draft does not allow', () => {
    const html = render(stateView('draft'));
    expect(disabled(html, 'Submit for review')).toBe(false);
    expect(present(html, 'Approve')).toBe(false);
    expect(present(html, 'Reopen')).toBe(false);
    expect(present(html, 'Withdraw')).toBe(false);
    expect(visibleText(html)).toContain('Draft');
  });

  it('does not let a report with regenerated text still waiting be submitted, and says why', () => {
    const waiting = sectionView({ proposal: proposal() });
    const html = render(viewWith(waiting));
    expect(disabled(html, 'Submit for review')).toBe(true);
    expect(visibleText(html)).toContain('Accept or reject the regenerated text before submitting');
  });

  it('does not let a stale document be submitted, approved, sent back or reopened', () => {
    expect(disabled(render(stateView('draft', { stale: true })), 'Submit for review')).toBe(true);
    const review = render(
      stateView('in-review', {
        stale: true,
        capabilities: capabilities({ edit: true, review: true }),
      }),
    );
    expect(disabled(review, 'Approve')).toBe(true);
    expect(disabled(review, 'Request changes')).toBe(true);
    expect(disabled(review, 'Withdraw from review')).toBe(true);
    expect(disabled(render(stateView('approved', { stale: true })), 'Reopen')).toBe(true);
  });

  it('gives a reviewer approve and request-changes for a report in review, and no way to edit it', () => {
    const html = render(
      stateView('in-review', { capabilities: capabilities({ edit: false, review: true }) }),
    );
    expect(disabled(html, 'Approve')).toBe(false);
    expect(disabled(html, 'Request changes')).toBe(false);
    expect(present(html, 'Submit for review')).toBe(false);
    expect(present(html, 'Withdraw')).toBe(false);
  });

  it('gives an author who cannot review no approve button, and a way to withdraw from review', () => {
    const html = render(stateView('in-review'));
    expect(present(html, 'Approve')).toBe(false);
    expect(present(html, 'Request changes')).toBe(false);
    expect(present(html, 'Withdraw from review')).toBe(true);
  });

  it('says who approved a report, and when they also wrote part of it', () => {
    const html = render(
      stateView('approved', {
        document: {
          approval: {
            actor: 'reviewer-1',
            at: AT,
            revision: 5,
            contentHash: 'b'.repeat(64),
            alsoEdited: true,
          },
        },
      }),
    );
    expect(visibleText(html)).toContain('Approved by reviewer-1');
    expect(visibleText(html)).toContain('who also wrote part of this text');
    expect(present(html, 'Reopen')).toBe(true);
  });

  it('shows the state as a word, so colour is not the only cue', () => {
    for (const [state, word] of [
      ['draft', 'Draft'],
      ['in-review', 'In review'],
      ['changes-requested', 'Changes requested'],
      ['approved', 'Approved'],
    ] as const) {
      expect(visibleText(render(stateView(state)))).toContain(word);
    }
  });

  it('offers the exports to those who may export, with the memo opening in a tab that cannot reach the app', () => {
    const html = render(studioView());
    expect(present(html, 'Export Markdown')).toBe(true);
    expect(present(html, 'Export JSON')).toBe(true);
    const link = /<a ([^>]*)>/u.exec(html)?.[1] ?? '';
    expect(link).toContain(`href="${api.studioExportUrl('p1', 'memo')}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    const refused = render(studioView({ capabilities: capabilities({ export: false }) }));
    expect(refused).not.toContain('Export Markdown');
    expect(refused).not.toContain('printable memo');
  });

  it('disables every control while a change is being made, so that two cannot be in flight', () => {
    const html = render(
      stateView('in-review', { capabilities: capabilities({ edit: true, review: true }) }),
      'step:approve',
    );
    for (const entry of buttons(html)) expect(entry.attrs, entry.text).toMatch(/\bdisabled=""/u);
  });
});

describe('StepDialog', () => {
  const render = (props: { noteLabel?: string; working?: boolean }) =>
    renderToStaticMarkup(
      <StepDialog
        title="Send the report back for changes"
        confirmLabel="Send it back"
        working={props.working ?? false}
        noteLabel={props.noteLabel}
        onConfirm={() => {}}
        onClose={() => {}}
      >
        <p>Explain.</p>
      </StepDialog>,
    );

  it('does not let a step that needs a reason be confirmed before one is written', () => {
    const html = render({ noteLabel: 'What needs to change?' });
    expect(html).toContain('What needs to change?');
    expect(html).toMatch(/<textarea[^>]*\brequired=""/u);
    expect(disabled(html, 'Send it back')).toBe(true);
    expect(visibleText(html)).toContain('At least three characters');
  });

  it('lets a step that needs no reason be confirmed at once, with no field to fill', () => {
    const html = render({});
    expect(html).not.toContain('<textarea');
    expect(disabled(html, 'Send it back')).toBe(false);
  });

  it('cannot be confirmed or cancelled while it is working', () => {
    const html = render({ working: true });
    expect(disabled(html, 'Send it back')).toBe(true);
    expect(disabled(html, 'Cancel')).toBe(true);
  });
});

describe('SectionEditor', () => {
  it('gives an author of a draft the controls to edit, lock and write a chapter again', () => {
    const html = editor(studioView());
    expect(disabled(html, 'Edit text')).toBe(false);
    expect(present(html, 'Lock this section')).toBe(true);
    expect(present(html, 'Write this chapter again')).toBe(true);
    expect(visibleText(html)).toContain('Version history (1)');
    expect(visibleText(html)).toContain('Statements in this chapter');
  });

  it('shows a reviewer the text and a way to leave a note, and nothing that changes the text', () => {
    const html = editor(
      studioView({
        capabilities: capabilities({ edit: false, review: true }),
        document: { state: 'in-review' },
      }),
    );
    expect(present(html, 'Edit text')).toBe(false);
    expect(present(html, 'Lock this section')).toBe(false);
    expect(present(html, 'Write this chapter again')).toBe(false);
    expect(visibleText(html)).toContain(
      'You can read this report. Editing it needs the analyst or lead role.',
    );
    expect(html).toContain('Add a note for the author');
    expect(visibleText(html)).toContain('does not change the text or an approval');
  });

  it('shows an author no note form, because only a reviewer leaves notes', () => {
    const html = editor(studioView());
    expect(html).not.toContain('Add a note for the author');
    expect(visibleText(html)).toContain('No reviewer has left a note on this section.');
  });

  it.each([
    ['approved', 'This report is approved. Reopen it to change it.'],
    ['in-review', 'This report is in review. Withdraw it to change it.'],
  ] as const)(
    'does not let a report that is %s be edited, and says what to do',
    (state, message) => {
      const html = editor(studioView({ document: { state } }));
      expect(present(html, 'Edit text')).toBe(false);
      expect(present(html, 'Lock this section')).toBe(false);
      expect(visibleText(html)).toContain(message);
    },
  );

  it('lets a report with changes requested be edited again', () => {
    const html = editor(studioView({ document: { state: 'changes-requested' } }));
    expect(disabled(html, 'Edit text')).toBe(false);
  });

  it('does not let a stale document be changed, and says why', () => {
    const html = editor(
      studioView({ stale: true, capabilities: capabilities({ edit: true, review: true }) }),
    );
    expect(present(html, 'Edit text')).toBe(false);
    expect(visibleText(html)).toContain('The generated report has been replaced');
    expect(html).not.toContain('Add a note for the author');
  });

  it('does not let a locked section be edited, restored or written again, and offers to unlock it', () => {
    const locked = sectionView({
      locked: { actor: 'lead-1', at: AT },
      versions: [version(), version({ version: 2, body: 'x', origin: 'human' })],
      version: 2,
      origin: 'human',
      body: 'x',
    });
    const html = editor(viewWith(locked));
    expect(disabled(html, 'Edit text')).toBe(true);
    expect(present(html, 'Unlock this section')).toBe(true);
    expect(disabled(html, 'Write this chapter again')).toBe(true);
    expect(present(html, 'Restore this version')).toBe(false);
    expect(visibleText(html)).toContain('A locked section is final wording');
    expect(visibleText(html)).toContain('Unlock the section to write it again.');
    expect(html).toContain('aria-pressed="true"');
  });

  it('shows regenerated text waiting with what changed, how it was checked, and figures that match nothing', () => {
    const waiting = sectionView({ proposal: proposal() });
    const html = editor(viewWith(waiting));
    const text = visibleText(html);
    expect(text).toContain('Regenerated text, waiting for your decision');
    expect(text).toContain('The request: Stress the uncertainty');
    expect(text).toContain('2 model calls');
    expect(text).toContain(
      '1 supported, 0 partly supported, 1 not supported, 0 contradicted, 0 not checkable',
    );
    expect(text).toContain('quotations, wording, figures and an independent model check');
    expect(text).toContain('Figures that match nothing in the cited material');
    expect(text).toContain('90,000');
    expect(text).toContain('One statement is not supported.');
    expect(html).toContain('<ins>');
    expect(html).toContain('<del>');
    expect(present(html, 'Accept the regenerated text')).toBe(true);
    expect(present(html, 'Reject it')).toBe(true);
  });

  it('does not let the section be edited or written again while regenerated text waits for a decision', () => {
    const html = editor(viewWith(sectionView({ proposal: proposal() })));
    expect(disabled(html, 'Edit text')).toBe(true);
    expect(disabled(html, 'Lock this section')).toBe(true);
    expect(disabled(html, 'Write this chapter again')).toBe(true);
    expect(visibleText(html)).toContain('Decide on the regenerated text below first.');
  });

  it('shows regenerated text to someone who cannot edit, with no way to accept it', () => {
    const html = editor(
      viewWith(sectionView({ proposal: proposal() }), {
        capabilities: capabilities({ edit: false, review: true }),
        document: { state: 'in-review' },
      }),
    );
    expect(visibleText(html)).toContain(
      'Only someone who can edit this report can accept or reject it.',
    );
    expect(present(html, 'Accept the regenerated text')).toBe(false);
  });

  it('says only that the deterministic checks ran when no independent model check did', () => {
    const waiting = sectionView({
      proposal: proposal({
        grounding: { ...proposal().grounding, method: 'deterministic', unverifiedFigures: [] },
      }),
    });
    const text = visibleText(editor(viewWith(waiting)));
    expect(text).toContain('quotations, wording and figures only');
    expect(text).not.toContain('Figures that match nothing');
  });

  it('says that text a person wrote is theirs and has not been checked, and that its statements are an earlier text’s', () => {
    const edited = sectionView({
      origin: 'human',
      version: 2,
      body: 'A person wrote this.',
      versions: [version(), version({ version: 2, origin: 'human', body: 'A person wrote this.' })],
      statementsCurrent: false,
    });
    const html = editor(viewWith(edited));
    const text = visibleText(html);
    expect(text).toContain(
      'A person wrote this text. It has not been checked statement by statement.',
    );
    expect(text).toContain('Written by a person');
    expect(text).toContain('These statements describe an earlier text of this section');
  });

  it('says that regenerated text was checked, as the report’s own text was', () => {
    const regenerated = sectionView({
      origin: 'regenerated',
      version: 2,
      body: 'The model wrote this.',
      versions: [
        version(),
        version({ version: 2, origin: 'regenerated', body: 'The model wrote this.' }),
      ],
      statements: [claimRecord({ id: 'G1' })],
    });
    const text = visibleText(editor(viewWith(regenerated)));
    expect(text).toContain('The model wrote this text and the server checked its statements');
    expect(text).toContain('Regenerated, then accepted');
  });

  it('gives the reason when writing a chapter again is not available, and no button', () => {
    const html = editor(
      studioView({
        regeneration: { available: false, reason: 'No model is configured for this project.' },
      }),
    );
    expect(visibleText(html)).toContain('No model is configured for this project.');
    expect(present(html, 'Write this chapter again')).toBe(false);
  });

  it('offers neither a rewrite nor a statement list for the summary and the limitations', () => {
    const summary = editor(studioView(), 'summary');
    expect(present(summary, 'Write this chapter again')).toBe(false);
    expect(summary).not.toContain('Statements in this chapter');
    expect(present(summary, 'Edit text')).toBe(true);
    const limitations = editor(studioView(), 'limitations');
    expect(limitations).toMatch(
      /<ul class="studio-body">\s*<li class="preserve-text">Fictional proxies, not observations\.<\/li><li class="preserve-text">The sources are few\.<\/li>/u,
    );
  });

  it('lists the versions newest first, marks the current one, and offers to restore only an earlier one', () => {
    const history = sectionView({
      version: 3,
      origin: 'human',
      body: 'Third.',
      versions: [
        version({ version: 1, body: 'First.' }),
        version({
          version: 2,
          body: 'Second.',
          origin: 'human',
          actor: 'analyst-1',
          reason: 'Clearer wording',
        }),
        version({
          version: 3,
          body: 'Third.',
          origin: 'human',
          actor: 'analyst-1',
          restoredFrom: 1,
        }),
      ],
    });
    const html = editor(viewWith(history));
    const text = visibleText(html);
    expect(text.indexOf('Version 3 (current)')).toBeGreaterThan(-1);
    expect(text.indexOf('Version 3')).toBeLessThan(text.indexOf('Version 2'));
    expect(text.indexOf('Version 2')).toBeLessThan(text.indexOf('Version 1'));
    expect(text).toContain('restored from version 1');
    expect(text).toContain('Why: Clearer wording');
    expect(buttons(html).filter((entry) => entry.text === 'Restore this version')).toHaveLength(2);
    expect(
      buttons(html).filter((entry) => entry.text.includes('Compare with the current text')),
    ).toHaveLength(2);
  });

  it('shows no restore button to someone who cannot write the section', () => {
    const history = sectionView({
      version: 2,
      body: 'Second.',
      versions: [version(), version({ version: 2, body: 'Second.', origin: 'human' })],
    });
    const html = editor(viewWith(history, { document: { state: 'approved' } }));
    expect(present(html, 'Restore this version')).toBe(false);
    expect(present(html, 'Compare with the current text')).toBe(true);
  });

  it('shows the notes reviewers left, with who left them, and says they cannot be changed', () => {
    const noted = sectionView({
      notes: [{ id: 'n1', actor: 'reviewer-1', at: AT, text: 'Please check the 2025 figure.' }],
    });
    const html = editor(
      viewWith(noted, {
        capabilities: capabilities({ edit: false, review: true }),
        document: { state: 'in-review' },
      }),
    );
    const text = visibleText(html);
    expect(text).toContain('Reviewer notes (1)');
    expect(text).toContain('Please check the 2025 figure.');
    expect(text).toContain('reviewer-1');
    expect(text).toContain('cannot be edited or removed');
  });

  it('shows text with markup in it, from a person or a model, as text', () => {
    const hostile = sectionView({
      body: '<img src=x onerror=alert(1)> <script>alert(2)</script>',
      versions: [version({ body: '<img src=x onerror=alert(1)> <script>alert(2)</script>' })],
      proposal: proposal({
        body: '<b onclick=alert(3)>bold</b>',
        instruction: '<script>x</script>',
      }),
      notes: [{ id: 'n1', actor: 'reviewer-1', at: AT, text: '<iframe src=x></iframe>' }],
    });
    const html = editor(viewWith(hostile));
    expect(html).not.toMatch(/<(?:img|script|iframe)\b/u);
    expect(html).not.toMatch(/<b\b/u);
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('says which control is working, and disables the others', () => {
    const html = editor(studioView(), 'S1', 'lock:S1');
    expect(visibleText(html)).toContain('Lock this section…');
    expect(disabled(html, 'Edit text')).toBe(true);
  });
});

describe('ReportStudio', () => {
  const handle = (overrides: Partial<StudioHandle> = {}): string => {
    mocked.handle = {
      view: null,
      loadError: null,
      actionError: null,
      pending: null,
      loading: false,
      reload: () => {},
      clearActionError: () => {},
      act: async () => true,
      ...overrides,
    };
    return renderToStaticMarkup(<ReportStudio projectId="p1" onClose={() => {}} />);
  };

  it('always says what Swarm is and is not, and how the studio treats the generated report', () => {
    const text = visibleText(handle({ loading: true }));
    expect(text).toContain('Swarm explores possible scenarios. It does not predict the future.');
    expect(text).toContain('the generated report itself is never changed');
    expect(text).toContain('Loading the report studio…');
    expect(present(handle({ loading: true }), 'Back to current stage')).toBe(true);
  });

  it('shows why the studio could not load, in the server’s words, with a way to try again', () => {
    const html = handle({ loadError: 'The server is not reachable.' });
    expect(visibleText(html)).toContain('The report studio could not be loaded');
    expect(visibleText(html)).toContain('The server is not reachable.');
    expect(present(html, 'Retry')).toBe(true);
    expect(html).toContain('role="alert"');
  });

  it('shows why a change was refused, and lets the person dismiss it', () => {
    const html = handle({
      view: studioView(),
      actionError: 'Another person changed this section.',
    });
    expect(visibleText(html)).toContain('That change was not made');
    expect(visibleText(html)).toContain('Another person changed this section.');
    expect(present(html, 'Dismiss')).toBe(true);
  });

  it('offers an author a report nobody has opened, and says the generated report stays as it is', () => {
    const html = handle({ view: studioView({ document: null }) });
    const text = visibleText(html);
    expect(text).toContain('Nobody has opened this report in the studio yet');
    expect(text).toContain('Ferry crossing decision');
    expect(text).toContain('The generated report stays as it is.');
    expect(disabled(html, 'Open the report in the studio')).toBe(false);
  });

  it('tells someone who cannot edit that an author must open it, and gives no button', () => {
    const html = handle({
      view: studioView({ document: null, capabilities: capabilities({ edit: false }) }),
    });
    expect(visibleText(html)).toContain(
      'Someone with the analyst or lead role needs to open it first.',
    );
    expect(present(html, 'Open the report in the studio')).toBe(false);
  });

  it('says there is nothing to open until the report exists, and does not offer to open it', () => {
    const html = handle({ view: studioView({ document: null, reportReady: false }) });
    expect(visibleText(html)).toContain('There is no report to open yet');
    expect(present(html, 'Open the report in the studio')).toBe(false);
  });

  it('shows the document with its workflow, its sections, its record, its open conflicts and its assumptions', () => {
    const html = handle({ view: studioView() });
    const text = visibleText(html);
    expect(html).toContain('aria-label="Report workflow"');
    expect(html).toContain('aria-label="Report sections"');
    expect(text).toContain('Review record (1)');
    expect(text).toContain('Opened in the studio');
    expect(text).toContain('Open conflicts between sources (1)');
    expect(text).toContain('Neither passage is declared true.');
    expect(text).toContain('Assumptions behind the simulated results (1)');
    expect(text).toContain('The proxies start from recorded opinions.');
    expect(text).toContain('What the sources show');
    expect(html).not.toContain('Earlier documents kept');
  });

  it('opens the first chapter, not the summary', () => {
    const html = handle({ view: studioView() });
    expect(html).toMatch(/aria-current="true"[^>]*><strong>What the sources show<\/strong>/u);
  });

  it('says there is no conflict, and that this is not proof that sources agree', () => {
    const text = visibleText(handle({ view: studioView({ conflicts: [] }) }));
    expect(text).toContain(
      'No conflict between the sources was detected. That is not proof that they agree.',
    );
  });

  it('says a stale document cannot be changed, and offers a new one only to those who can edit', () => {
    const stale = handle({ view: studioView({ stale: true }) });
    expect(visibleText(stale)).toContain(
      'The generated report was replaced after this document was made',
    );
    expect(present(stale, 'Start again from the new report')).toBe(true);
    const reader = handle({
      view: studioView({ stale: true, capabilities: capabilities({ edit: false }) }),
    });
    expect(visibleText(reader)).toContain(
      'The generated report was replaced after this document was made',
    );
    expect(present(reader, 'Start again from the new report')).toBe(false);
  });

  it('keeps the text of earlier documents, and the approval’s hash, where a reader can find them', () => {
    const html = handle({
      view: studioView({
        document: {
          state: 'approved',
          approval: {
            actor: 'reviewer-1',
            at: AT,
            revision: 5,
            contentHash: 'c'.repeat(64),
            alsoEdited: false,
          },
          archive: [
            {
              archivedAt: AT,
              actor: 'analyst-1',
              state: 'draft',
              approval: null,
              sections: [
                {
                  id: 'S1',
                  title: 'What the sources show',
                  body: 'Old text.',
                  origin: 'generated',
                  version: 1,
                },
              ],
            },
          ],
        },
      }),
    });
    const text = visibleText(html);
    expect(text).toContain('Earlier documents kept (1)');
    expect(text).toContain('Old text.');
    expect(text).toContain('c'.repeat(64));
  });

  it('shows no endpoint, credential, tenant or private identifier', () => {
    const text = visibleText(handle({ view: studioView() }));
    expect(text).not.toMatch(/https?:\/\//u);
    expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu);
  });
});
