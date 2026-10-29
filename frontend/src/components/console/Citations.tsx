import type { Inspection } from '../../lib/graph';
import { SourceLinks } from '../ui';

export function Citations({
  sourceIds = [],
  memoryIds = [],
  interviewIds = [],
  claimIds = [],
  onInspect,
}: {
  sourceIds?: string[];
  memoryIds?: string[];
  interviewIds?: string[];
  /** Statements of the report's evidence ledger. They are shown as labels, not links. */
  claimIds?: string[];
  onInspect: (selection: Inspection) => void;
}) {
  return (
    <div className="citations">
      <SourceLinks ids={sourceIds} onOpen={(id) => onInspect({ kind: 'source', id })} />
      {!!claimIds.length && (
        <div className="source-links">
          <span className="source-label">Report statements</span>
          {[...new Set(claimIds)].map((id) => (
            <span
              className="claim-ref mono"
              key={id}
              title="A statement in this report’s evidence ledger"
            >
              {id}
            </span>
          ))}
        </div>
      )}
      {!!memoryIds.length && (
        <div className="source-links">
          <span className="source-label">Simulated memory</span>
          {[...new Set(memoryIds)].map((id) => (
            <button
              className="source-chip memory-chip"
              type="button"
              key={id}
              onClick={() => onInspect({ kind: 'memory', id })}
            >
              {id}
            </button>
          ))}
        </div>
      )}
      {!!interviewIds.length && (
        <div className="source-links">
          <span className="source-label">Fictional interviews</span>
          {[...new Set(interviewIds)].map((id) => (
            <button
              className="source-chip memory-chip"
              type="button"
              key={id}
              onClick={() => onInspect({ kind: 'interview', id })}
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
