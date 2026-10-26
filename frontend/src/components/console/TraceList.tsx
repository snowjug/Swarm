import type { OperationTrace } from '../../../../shared/guided';
import { dateTime } from '../../lib/format';
import { EmptyPanel } from '../ui';

export function TraceList({ traces }: { traces: OperationTrace[] }) {
  return (
    <div className="trace-list">
      {!traces.length && (
        <EmptyPanel title="No operation traces recorded">
          Only actual tool and provider operation records are shown. Historical quick runs did not
          save these guided traces.
        </EmptyPanel>
      )}
      {traces.map((trace) => (
        <details className={`operation-trace trace-${trace.status}`} key={trace.id}>
          <summary>
            <span className="trace-kind mono">{trace.kind}</span>
            <strong>{trace.name}</strong>
            <span className="mono">{trace.status}</span>
          </summary>
          <div className="trace-content">
            <dl className="record-grid">
              <dt>Operation ID</dt>
              <dd className="mono">{trace.id}</dd>
              <dt>Started</dt>
              <dd>{dateTime(trace.startedAt)}</dd>
              <dt>Completed</dt>
              <dd>{trace.completedAt ? dateTime(trace.completedAt) : 'Not recorded'}</dd>
            </dl>
            <h4>Recorded input</h4>
            <pre>{JSON.stringify(trace.input, null, 2)}</pre>
            <h4>Recorded output / evidence</h4>
            {trace.output !== null ? (
              <pre>{JSON.stringify(trace.output, null, 2)}</pre>
            ) : (
              <p className="field-help">
                No output was recorded{trace.status === 'running' ? ' yet' : ''}.
              </p>
            )}
            {trace.error && (
              <p className="trace-error" role="alert">
                {trace.error}
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
