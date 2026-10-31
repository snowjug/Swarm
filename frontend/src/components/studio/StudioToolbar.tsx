import { Download, ExternalLink } from 'lucide-react';
import { STUDIO_STATE_LABELS, isEditableState, type StudioView } from '../../../../shared/studio';
import { api } from '../../api';
import { dateTime } from '../../lib/format';
import { STATE_TONE, actorLabel } from '../../lib/studio';
import { ToneChip } from '../console/LedgerParts';
import { Spinner } from '../ui';
import { STATE_ICON } from './icons';

type Document = NonNullable<StudioView['document']>;

/** The steps that need a person to confirm them, and say why where a reason is needed. */
export type StepKind = 'submit' | 'approve' | 'request-changes' | 'reopen';

export function StudioToolbar({
  projectId,
  view,
  document,
  pending,
  onStep,
  onExport,
}: {
  projectId: string;
  view: StudioView;
  document: Document;
  pending: string | null;
  onStep: (step: StepKind) => void;
  onExport: (format: 'markdown' | 'json') => void;
}) {
  const { capabilities, stale } = view;
  const { state } = document;
  const working = pending !== null;
  const waiting = view.document?.sections.some((section) => section.proposal) ?? false;
  return (
    <div className="studio-toolbar" role="group" aria-label="Report workflow">
      <div className="studio-status">
        <ToneChip
          tone={STATE_TONE[state]}
          label={STUDIO_STATE_LABELS[state]}
          icon={STATE_ICON[state]}
        />
        <span className="mono muted">REVISION {document.revision}</span>
        {document.approval && (
          <span className="field-help">
            Approved by {actorLabel(document.approval.actor)} on {dateTime(document.approval.at)}
            {document.approval.alsoEdited ? ' (who also wrote part of this text)' : ''}.
          </span>
        )}
      </div>
      <div className="stage-actions">
        {capabilities.edit && isEditableState(state) && (
          <button
            className="button button-primary"
            type="button"
            disabled={working || stale || waiting}
            onClick={() => onStep('submit')}
          >
            {pending === 'step:submit' ? <Spinner label="Submitting" /> : null} Submit for review
          </button>
        )}
        {capabilities.review && state === 'in-review' && (
          <>
            <button
              className="button button-primary"
              type="button"
              disabled={working || stale}
              onClick={() => onStep('approve')}
            >
              Approve…
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={working || stale}
              onClick={() => onStep('request-changes')}
            >
              Request changes…
            </button>
          </>
        )}
        {capabilities.edit && (state === 'approved' || state === 'in-review') && (
          <button
            className="button button-secondary"
            type="button"
            disabled={working || stale}
            onClick={() => onStep('reopen')}
          >
            {state === 'approved' ? 'Reopen…' : 'Withdraw from review…'}
          </button>
        )}
      </div>
      {waiting && capabilities.edit && isEditableState(state) && (
        <p className="field-help">
          Accept or reject the regenerated text before submitting the report for review.
        </p>
      )}
      {capabilities.export && (
        <div className="stage-actions studio-export" role="group" aria-label="Export this report">
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={working}
            onClick={() => onExport('markdown')}
          >
            <Download size={13} aria-hidden="true" /> Export Markdown
          </button>
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={working}
            onClick={() => onExport('json')}
          >
            <Download size={13} aria-hidden="true" /> Export JSON
          </button>
          <a
            className="button button-secondary button-small"
            href={api.studioExportUrl(projectId, 'memo')}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={13} aria-hidden="true" /> Open the printable memo
          </a>
        </div>
      )}
    </div>
  );
}
