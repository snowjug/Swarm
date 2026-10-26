import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import type { ProjectDetail } from '../../../../shared/types';
import { dateTime } from '../../lib/format';

export function OperationLog({ project }: { project: ProjectDetail }) {
  const [open, setOpen] = useState(true);
  const [follow, setFollow] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
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
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="diagnostic-log-lines"
        >
          <Terminal size={14} />
          <strong>OPERATION LOG</strong>
          <span>{lines.length} PERSISTED RECORDS</span>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        {open && (
          <label>
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />{' '}
            Follow latest
          </label>
        )}
      </div>
      {open && (
        <div
          className="log-lines"
          id="diagnostic-log-lines"
          ref={scroll}
          tabIndex={0}
          aria-label="Recorded server events, scrollable"
        >
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
        </div>
      )}
    </section>
  );
}
