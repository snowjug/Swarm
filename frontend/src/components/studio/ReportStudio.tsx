import { useId, useState } from 'react';
import {
  DECISION_LABELS,
  MAX_NOTE,
  STUDIO_STATE_LABELS,
  type StudioView,
} from '../../../../shared/studio';
import { api, errorMessage } from '../../api';
import { useStudio } from '../../hooks/useStudio';
import { saveBlob } from '../../lib/download';
import { dateTime } from '../../lib/format';
import { actorLabel, reviewSummary } from '../../lib/studio';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { SectionEditor, type SectionActions } from './SectionEditor';
import { SectionOutline } from './SectionOutline';
import { StepDialog } from './StepDialog';
import { StudioToolbar, type StepKind } from './StudioToolbar';

type Document = NonNullable<StudioView['document']>;

/** The report's record: what was decided and by whom, what is still open, and what an earlier document held. */
function RecordPanel({ view, document }: { view: StudioView; document: Document }) {
  return (
    <section className="studio-record view-stack" aria-label="Review record and open questions">
      <details className="record-details">
        <summary>Review record ({document.decisions.length})</summary>
        <ol className="studio-versions">
          {[...document.decisions].reverse().map((decision) => (
            <li key={`${decision.revision}-${decision.action}`}>
              <p>
                <strong>{DECISION_LABELS[decision.action]}</strong> · {actorLabel(decision.actor)} ·{' '}
                {dateTime(decision.at)} · revision {decision.revision}
              </p>
              {decision.note && <p className="field-help preserve-text">{decision.note}</p>}
            </li>
          ))}
        </ol>
        {document.approval && (
          <p className="field-help">
            The approval is of exactly the text with this content hash (SHA-256):{' '}
            <span className="mono">{document.approval.contentHash}</span>. A printed memo shows the
            same hash.
          </p>
        )}
      </details>
      <details className="record-details">
        <summary>Open conflicts between sources ({view.conflicts.length})</summary>
        {view.conflicts.length === 0 ? (
          <p className="field-help">
            No conflict between the sources was detected. That is not proof that they agree.
          </p>
        ) : (
          <ul className="evidence-list">
            {view.conflicts.map((conflict) => (
              <li key={conflict.id} className="evidence evidence-contradicts">
                <p>
                  <strong>{conflict.id}</strong> · {conflict.topic}
                </p>
                {[conflict.left, conflict.right].map((side) => (
                  <blockquote key={`${side.passageId}-${side.start}`} className="preserve-text">
                    {side.quote ?? 'The whole passage'}{' '}
                    <cite>
                      {side.documentName}, {side.passageId}
                    </cite>
                  </blockquote>
                ))}
                <p className="field-help">Neither passage is declared true.</p>
              </li>
            ))}
          </ul>
        )}
      </details>
      <details className="record-details">
        <summary>Assumptions behind the simulated results ({view.assumptions.length})</summary>
        <ul>
          {view.assumptions.map((assumption) => (
            <li key={assumption.id} className="preserve-text">
              <span className="mono muted">{assumption.id}</span> {assumption.statement}
            </li>
          ))}
        </ul>
      </details>
      {document.archive.length > 0 && (
        <details className="record-details">
          <summary>Earlier documents kept ({document.archive.length})</summary>
          {document.archive.map((entry) => (
            <div key={entry.archivedAt}>
              <p>
                <strong>Set aside {dateTime(entry.archivedAt)}</strong> by {actorLabel(entry.actor)}
                ; it was {STUDIO_STATE_LABELS[entry.state].toLowerCase()}.
              </p>
              {entry.sections.map((section) => (
                <details key={section.id} className="record-details">
                  <summary>{section.title}</summary>
                  <div className="studio-body preserve-text">{section.body}</div>
                </details>
              ))}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

/**
 * Report Studio: where a person works on the generated report. They read it section by section with
 * the statements the server checked, change the text (every change a new version), ask for a chapter to
 * be written again, send it for review, and a reviewer approves it or sends it back. The generated report
 * itself is never changed.
 */
export function ReportStudio({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const studio = useStudio(projectId);
  const { view, pending } = studio;
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<StepKind | 'restart' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const titleId = useId();

  const document = view?.document ?? null;
  const section =
    document?.sections.find((candidate) => candidate.id === selected) ??
    document?.sections.find((candidate) => candidate.kind === 'chapter') ??
    document?.sections[0] ??
    null;

  const done = (message: string) => (made: boolean) => {
    if (made) setAnnouncement(message);
    return made;
  };
  const actions: SectionActions | null =
    document && section
      ? {
          edit: ({ body, reason }) =>
            studio
              .act(`edit:${section.id}`, () =>
                api.editSection(projectId, section.id, {
                  body,
                  expectedVersion: section.version,
                  reason,
                }),
              )
              .then(done(`Saved a new version of ${section.title}.`)),
          lock: (locked) =>
            studio
              .act(`lock:${section.id}`, () => api.lockSection(projectId, section.id, locked))
              .then(done(`${section.title} is ${locked ? 'locked' : 'unlocked'}.`)),
          note: (text) =>
            studio
              .act(`note:${section.id}`, () => api.addNote(projectId, section.id, text))
              .then(done(`Added a note to ${section.title}.`)),
          restore: (version, reason) =>
            studio
              .act(`restore:${section.id}:${version}`, () =>
                api.restoreVersion(projectId, section.id, {
                  version,
                  expectedVersion: section.version,
                  reason,
                }),
              )
              .then(done(`Restored version ${version} of ${section.title} as a new version.`)),
          regenerate: (instruction) =>
            studio
              .act(`regenerate:${section.id}`, () =>
                api.regenerateSection(projectId, section.id, {
                  expectedVersion: section.version,
                  instruction,
                }),
              )
              .then(done(`The regenerated text for ${section.title} is ready for your decision.`)),
          decide: (decision) =>
            studio
              .act(`proposal:${section.id}:${decision}`, () =>
                api.decideProposal(projectId, section.id, {
                  decision,
                  proposalId: section.proposal?.id ?? '',
                  expectedVersion: section.version,
                }),
              )
              .then(
                done(
                  decision === 'accept'
                    ? `Accepted the regenerated text of ${section.title}.`
                    : `Rejected the regenerated text of ${section.title}.`,
                ),
              ),
        }
      : null;

  const start = (confirm: boolean) =>
    studio
      .act('start', () => api.startStudio(projectId, confirm), {
        handled: (code) => {
          if (code !== 'CONFIRM_REQUIRED') return false;
          setDialog('restart');
          return true;
        },
      })
      .then((made) => {
        if (made) {
          setDialog(null);
          setAnnouncement('The report is open in the studio.');
        }
      });

  const step = (kind: StepKind, note: string | null) => {
    if (!document) return Promise.resolve();
    return studio
      .act(`step:${kind}`, () =>
        api.studioStep(projectId, kind, { expectedRevision: document.revision, note }),
      )
      .then((made) => {
        if (made) {
          setDialog(null);
          setAnnouncement(
            {
              submit: 'The report was submitted for review.',
              approve: 'The report was approved.',
              'request-changes': 'The report was sent back for changes.',
              reopen: 'The report was reopened.',
            }[kind],
          );
        }
      });
  };

  const exportAs = async (format: 'markdown' | 'json') => {
    setExporting(true);
    setExportError(null);
    try {
      saveBlob(
        await api.exportStudio(projectId, format),
        format === 'json' ? 'swarm-report-studio.json' : 'swarm-report-studio.md',
      );
      setAnnouncement(`Exported the report as ${format === 'json' ? 'JSON' : 'Markdown'}.`);
    } catch (failure) {
      setExportError(errorMessage(failure));
    } finally {
      setExporting(false);
    }
  };

  const summary = view ? reviewSummary(view) : null;
  const working = pending !== null;
  return (
    <section className="studio view-stack" aria-labelledby={titleId}>
      <div className="section-heading">
        <h2 id={titleId}>Report Studio</h2>
        <button className="button button-secondary" type="button" onClick={onClose}>
          Back to current stage
        </button>
      </div>
      <p className="field-help">
        Swarm explores possible scenarios. It does not predict the future. Here a person works on
        the generated report: every change is a new version, a reviewer approves or sends back what
        they read, and the generated report itself is never changed.
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {studio.loading && !view && (
        <div className="inline-pending" role="status">
          <Spinner /> Loading the report studio…
        </div>
      )}
      {studio.loadError && (
        <Notice
          tone="error"
          title="The report studio could not be loaded"
          action={
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={studio.reload}
            >
              Retry
            </button>
          }
        >
          {studio.loadError}
        </Notice>
      )}
      {studio.actionError && (
        <Notice
          tone="error"
          title="That change was not made"
          action={
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={studio.clearActionError}
            >
              Dismiss
            </button>
          }
        >
          {studio.actionError}
        </Notice>
      )}
      {exportError && (
        <Notice tone="error" title="The export failed">
          {exportError}
        </Notice>
      )}

      {view && !document && (
        <section className="stage-card" aria-label="Open the report in the studio">
          {view.reportReady ? (
            <>
              <h3>Nobody has opened this report in the studio yet</h3>
              <p>
                Opening it makes a document from the generated report: {view.report?.title}. The
                generated report stays as it is.
              </p>
              {view.capabilities.edit ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={working}
                  onClick={() => void start(false)}
                >
                  {pending === 'start' ? <Spinner label="Opening" /> : null} Open the report in the
                  studio
                </button>
              ) : (
                <p className="field-help">
                  Someone with the analyst or lead role needs to open it first.
                </p>
              )}
            </>
          ) : (
            <EmptyPanel title="There is no report to open yet">
              Run the Report stage and wait for it to finish. The studio works on a finished report.
            </EmptyPanel>
          )}
        </section>
      )}

      {view && document && section && actions && (
        <>
          {view.stale && (
            <Notice
              tone="warning"
              title="The generated report was replaced after this document was made"
              action={
                view.capabilities.edit && view.reportReady ? (
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    disabled={working}
                    onClick={() => void start(false)}
                  >
                    Start again from the new report
                  </button>
                ) : undefined
              }
            >
              This document can still be read and exported, but not changed. Starting again makes a
              new document from the new report and keeps the text of this one in its archive.
            </Notice>
          )}
          <StudioToolbar
            projectId={projectId}
            view={view}
            document={document}
            pending={pending ?? (exporting ? 'export' : null)}
            onStep={(kind) => (kind === 'submit' ? void step('submit', null) : setDialog(kind))}
            onExport={(format) => void exportAs(format)}
          />
          <div className="studio-grid">
            <SectionOutline
              sections={document.sections}
              selected={section.id}
              onSelect={setSelected}
            />
            <SectionEditor
              key={section.id}
              view={view}
              document={document}
              section={section}
              pending={pending}
              actions={actions}
            />
          </div>
          <RecordPanel view={view} document={document} />
        </>
      )}

      {dialog === 'approve' && summary && (
        <StepDialog
          title="Approve this report"
          confirmLabel="Approve this text"
          working={pending === 'step:approve'}
          onConfirm={() => void step('approve', null)}
          onClose={() => setDialog(null)}
        >
          <p>
            You are approving the text as it stands now: {summary.sections} sections, of which{' '}
            {summary.byPeople} were written or regenerated by people, with {summary.notes} reviewer{' '}
            {summary.notes === 1 ? 'note' : 'notes'}.
          </p>
          <ul>
            <li>{summary.findings} statements are shown as findings or qualified findings.</li>
            <li>
              {summary.labelled} are shown with a label instead (hypothesis, simulation result,
              input, contradiction or not verified) and are not findings.
            </li>
            {summary.notCurrent > 0 && (
              <li>
                {summary.notCurrent} {summary.notCurrent === 1 ? 'chapter has' : 'chapters have'}{' '}
                text changed after its statements were checked; those statements are not listed as
                findings.
              </li>
            )}
          </ul>
          <p className="field-help">
            The approval is recorded with a hash of this exact text. Any later change needs the
            report to be reopened first, and the approval is then gone.
          </p>
        </StepDialog>
      )}
      {dialog === 'request-changes' && (
        <StepDialog
          title="Send the report back for changes"
          noteLabel="What needs to change?"
          confirmLabel="Send it back"
          confirmTone="secondary"
          working={pending === 'step:request-changes'}
          onConfirm={(note) => void step('request-changes', note)}
          onClose={() => setDialog(null)}
        >
          <p>The author can then edit the report and submit it for review again.</p>
        </StepDialog>
      )}
      {dialog === 'reopen' && (
        <StepDialog
          title={
            document?.state === 'approved' ? 'Reopen the approved report' : 'Withdraw from review'
          }
          noteLabel="Why is it being reopened?"
          confirmLabel={document?.state === 'approved' ? 'Reopen it' : 'Withdraw it'}
          confirmTone="secondary"
          working={pending === 'step:reopen'}
          onConfirm={(note) => void step('reopen', note)}
          onClose={() => setDialog(null)}
        >
          <p>
            {document?.state === 'approved'
              ? 'Reopening takes the approval away. The report must be reviewed and approved again.'
              : 'The reviewer’s decision is withdrawn and the report becomes a draft.'}
          </p>
        </StepDialog>
      )}
      {dialog === 'restart' && (
        <StepDialog
          title="Start again from the new report"
          confirmLabel="Start again"
          confirmTone="secondary"
          working={pending === 'start'}
          onConfirm={() => void start(true)}
          onClose={() => setDialog(null)}
        >
          <p>
            This document has edits, notes or a decision in it. Starting again replaces it with one
            made from the newer generated report. The old text is kept in the new document’s
            archive, and the record of what was decided stays.
          </p>
        </StepDialog>
      )}
      <p className="sr-only">Notes can be up to {MAX_NOTE} characters.</p>
    </section>
  );
}
