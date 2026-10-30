import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { AuditState, Verification } from '../../hooks/useAudit';
import { useAudit } from '../../hooks/useAudit';
import { actionLabel, detailText, newestFirst, shortValue } from '../../lib/audit';
import { dateTime } from '../../lib/format';
import { EmptyPanel, Modal, Notice, Spinner } from '../ui';

function VerificationResult({ verification }: { verification: Verification }) {
  switch (verification.state) {
    case 'idle':
      return null;
    case 'running':
      return (
        <div className="inline-pending" role="status">
          <Spinner label="Checking the audit chain" /> Recomputing the hash chain…
        </div>
      );
    case 'failed':
      return (
        <Notice tone="error" title="Integrity could not be checked">
          {verification.error}
        </Notice>
      );
    case 'done':
      return verification.result.ok ? (
        <Notice tone="success" title="Chain intact">
          {verification.result.checked} entries checked across the whole log. None was altered or
          removed.
        </Notice>
      ) : (
        <Notice tone="error" title="Chain broken">
          Entry #{verification.result.brokenAt} does not match the one before it, after{' '}
          {verification.result.checked} entries that did. The log was altered, or an entry was
          removed.
        </Notice>
      );
  }
}

/** The entries and the integrity check, without the dialog around them. */
export function AuditLog({ state }: { state: AuditState }) {
  const { entries, loading, error, reload, verification, verify } = state;
  return (
    <div className="audit-log">
      <p className="audit-intro">
        Who did what to this project, and when. Entries hold identifiers, counts and short labels,
        never questions, answers or source text. Each entry commits to the one before it, so an edit
        or a removal shows up as a broken chain.
      </p>
      <div className="audit-toolbar">
        <button
          className="button button-secondary button-small"
          type="button"
          disabled={verification.state === 'running'}
          onClick={verify}
        >
          <ShieldCheck size={14} aria-hidden="true" /> Verify integrity
        </button>
        <button
          className="icon-button"
          type="button"
          disabled={loading}
          onClick={reload}
          aria-label="Refresh the audit log"
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      <VerificationResult verification={verification} />
      {error && (
        <Notice
          tone="error"
          title="The audit log could not be read"
          action={
            <button className="button button-secondary button-small" type="button" onClick={reload}>
              Retry
            </button>
          }
        >
          {error}
        </Notice>
      )}
      {loading && !entries && (
        <div className="inline-pending" role="status">
          <Spinner label="Loading the audit log" /> Reading the audit log…
        </div>
      )}
      {entries && entries.length === 0 && (
        <EmptyPanel title="No recorded actions yet">
          Actions on this project, such as starting a stage or exporting, appear here as they
          happen.
        </EmptyPanel>
      )}
      {entries && entries.length > 0 && (
        <div className="audit-scroll" role="region" aria-label="Audit log entries" tabIndex={0}>
          <table className="audit-table">
            <caption className="sr-only">Audit log entries, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Detail</th>
                <th scope="col">Entry</th>
              </tr>
            </thead>
            <tbody>
              {newestFirst(entries).map((entry) => (
                <tr key={entry.seq}>
                  <td>{dateTime(entry.at)}</td>
                  <td className="mono" title={entry.actor}>
                    {shortValue(entry.actor)}
                  </td>
                  <td>
                    <strong>{actionLabel(entry.action)}</strong>
                    <span className="mono audit-code">{entry.action}</span>
                  </td>
                  <td>{detailText(entry.detail)}</td>
                  <td className="mono">#{entry.seq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AuditDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const state = useAudit(projectId);
  return (
    <Modal title="Audit log" onClose={onClose}>
      <AuditLog state={state} />
    </Modal>
  );
}
