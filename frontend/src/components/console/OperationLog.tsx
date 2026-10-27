import { useEffect, useId, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import type { ProjectDetail } from '../../../../shared/types';
import { dateTime } from '../../lib/format';

export function OperationLog({
  project,
  initialExpanded = false,
}: {
  project: ProjectDetail;
  initialExpanded?: boolean;
}) {
  const [open, setOpen] = useState(initialExpanded);
  const [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const id = useId();
  const lines = [
    ...project.events.map((event) => ({
      id: `event-${event.id}`,
      time: event.createdAt,
      tag: event.stage,
      text: event.message,
      status: '',
    })),
    ...(project.console?.traces ?? []).map((trace) => ({
      id: `trace-${trace.id}`,
      time: trace.startedAt,
      tag: trace.kind,
      text: `${trace.name} · ${trace.status}${trace.error ? ` · ${trace.error}` : ''}`,
      status: trace.status,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const signature = lines.map((line) => `${line.id}:${line.status}:${line.text}`).join('|');
  useEffect(() => {
    if (open && follow && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [signature, open, follow]);
  return (
    <section
      className={`diagnostic-log ${open ? 'open' : ''}`}
      aria-label="Persisted diagnostic event log"
    >
      <div className="log-toolbar">
        <span className="log-heading">
          <Terminal size={16} aria-hidden="true" /> OPERATION LOG · {lines.length} records
        </span>
        <p className="log-latest" title={lines.at(-1)?.text}>
          {lines.at(-1)?.text ?? 'No persisted events returned.'}
        </p>
        <button
          className="button log-expand"
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={id}
        >
          {open ? 'Collapse' : 'Expand'} log
        </button>
      </div>
      {open && (
        <label className="log-follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />{' '}
          Follow latest saved event
        </label>
      )}
      <div
        id={id}
        hidden={!open}
        className="log-lines"
        ref={scroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        tabIndex={open ? 0 : -1}
        aria-label="Recorded server events and operation traces"
      >
        {open && (
          <>
            {!lines.length && (
              <p className="log-empty">
                No persisted events or operation traces returned by the API.
              </p>
            )}
            {lines.slice(-120).map((line) => (
              <div className={`log-line log-${line.status}`} key={line.id}>
                <time dateTime={line.time}>{dateTime(line.time)}</time>
                <span className="log-tag">{line.tag}</span>
                <span>{line.text}</span>
              </div>
            ))}
            {lines.length > 120 && (
              <p className="log-empty">Showing latest 120 of {lines.length} loaded records.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
