import type { Inspection } from '../../lib/graph';
import { SourceLinks } from '../ui';

export function Citations({
  sourceIds = [],
  memoryIds = [],
  interviewIds = [],
  onInspect,
}: {
  sourceIds?: string[];
  memoryIds?: string[];
  interviewIds?: string[];
  onInspect: (selection: Inspection) => void;
}) {
  return (
    <div className="citations">
      <SourceLinks ids={sourceIds} onOpen={(id) => onInspect({ kind: 'source', id })} />
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
