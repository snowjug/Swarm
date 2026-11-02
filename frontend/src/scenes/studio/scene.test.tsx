import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StudioView } from '../../../../shared/studio';
import { ToastProvider, TooltipProvider } from '../../design/ui';
import type { StudioHandle } from '../../hooks/useStudio';
import { modelReportFixture } from '../../test/grounding';
import { capabilities, defaultSections, hash, sectionView, studioView } from '../../test/studio';
import type { StudioActions } from './actions';
import { Opening } from './Opening';
import { Workbench } from './Workbench';

const noop = () => undefined;
const yes = async () => true;

const actions: StudioActions = {
  pending: null,
  exporting: false,
  edit: yes,
  lock: yes,
  note: yes,
  restore: yes,
  regenerate: yes,
  decide: yes,
  step: yes,
  start: yes,
  exportAs: async () => undefined,
};

function handle(view: StudioView): StudioHandle {
  return {
    view,
    loadError: null,
    actionError: null,
    pending: null,
    loading: false,
    reload: noop,
    clearActionError: noop,
    act: yes,
  };
}

/** What a reader would read: the markup and the comments React leaves between text nodes are taken out. */
function text(html: string): string {
  return html
    .replace(/<!--.*?-->/gu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ');
}

function workbench(view: StudioView): string {
  if (!view.document) throw new Error('The fixture needs a document.');
  return text(
    renderToStaticMarkup(
      <TooltipProvider>
        <ToastProvider>
          <Workbench
            projectId="project-1"
            view={view}
            document={view.document}
            studio={handle(view)}
            actions={actions}
            onBack={noop}
            onReport={noop}
            onAudit={noop}
          />
        </ToastProvider>
      </TooltipProvider>,
    ),
  );
}

function opening(view: StudioView): string {
  return text(
    renderToStaticMarkup(
      <TooltipProvider>
        <Opening
          view={view}
          report={view.reportReady ? modelReportFixture() : null}
          actions={actions}
          onBack={noop}
          onReport={noop}
        />
      </TooltipProvider>,
    ),
  );
}

const AT = '2026-02-02T10:00:00.000Z';

describe('opening the studio', () => {
  it('lets someone who can edit open a working copy, and tells them what it will and will not do', () => {
    const html = opening(studioView({ document: null }));
    expect(html).toContain('Open in the studio');
    expect(html).toContain('the generated report is never changed');
  });

  it('asks someone who cannot edit to have it opened for them', () => {
    const html = opening(
      studioView({ document: null, capabilities: capabilities({ edit: false }) }),
    );
    expect(html).not.toContain('Open in the studio');
    expect(html).toContain('needs to open it first');
  });

  it('sends a person to the detailed report when there is no report to work on', () => {
    const html = opening(studioView({ document: null, reportReady: false }));
    expect(html).toContain('There is no report to work on yet');
    expect(html).toContain('Go to the detailed report');
  });
});

describe('the report studio', () => {
  it('shows a draft as a document that can be edited and sent for review', () => {
    const html = workbench(studioView());
    expect(html).toContain('Executive summary');
    expect(html).toContain('Submit for review');
    expect(html).toContain('Edit');
  });

  it('gives a reviewer the decision, and no way to change the text under review', () => {
    const html = workbench(
      studioView({
        document: { state: 'in-review' },
        capabilities: capabilities({ edit: false, review: true }),
      }),
    );
    expect(html).toContain('Approve…');
    expect(html).toContain('Request changes…');
    expect(html).not.toContain('Submit for review');
  });

  it('puts what the reviewer said first when a report was sent back', () => {
    const html = workbench(
      studioView({
        document: {
          state: 'changes-requested',
          decisions: [
            { action: 'started', actor: 'local-user', at: AT, note: null, revision: 1 },
            {
              action: 'changes-requested',
              actor: 'reviewer',
              at: AT,
              note: 'The second chapter needs its source named.',
              revision: 4,
            },
          ],
        },
      }),
    );
    expect(html).toContain('A reviewer sent it back for changes');
    expect(html).toContain('The second chapter needs its source named.');
  });

  it('records who approved it, and that approval is only a reading of this text', () => {
    const html = workbench(
      studioView({
        document: {
          state: 'approved',
          approval: {
            actor: 'reviewer',
            at: AT,
            revision: 5,
            contentHash: hash('b'),
            alsoEdited: true,
          },
        },
      }),
    );
    expect(html).toContain('Approved by');
    expect(html).toContain('who also wrote part of this text');
    expect(html).toContain('Reopen…');
  });

  it('says the copy is out of date when the generated report was replaced, and offers a fresh start', () => {
    const html = workbench(studioView({ stale: true }));
    expect(html).toContain('The generated report was replaced after this copy was made');
    expect(html).toContain('Start again from the new report');
  });

  it('flags statements that describe an earlier text of an edited chapter', () => {
    const sections = defaultSections();
    sections[1] = sectionView({ ...sections[1], origin: 'human', statementsCurrent: false });
    const html = workbench(studioView({ document: { sections } }));
    expect(html).toContain('Statements describe an earlier text');
    expect(workbench(studioView())).not.toContain('Statements describe an earlier text');
  });
});
