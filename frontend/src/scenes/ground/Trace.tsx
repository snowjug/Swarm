import { Check, ChevronDown, CircleAlert, Loader } from 'lucide-react';
import { useState } from 'react';
import type { OperationTrace } from '../../../../shared/guided';
import { Chip, Disclosure, Switch } from '../../design/ui';
import { dateTime } from '../../lib/format';
import { useGroundData } from './context';
import { traceDuration } from './model';
import { Reveal } from './Reveal';

const STATUS = {
  completed: { label: 'Completed', tone: 'favor', icon: Check },
  running: { label: 'Running', tone: 'accent', icon: Loader },
  failed: { label: 'Failed', tone: 'critical', icon: CircleAlert },
} as const;

function TraceRow({ trace }: { trace: OperationTrace }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[trace.status];
  const Icon = status.icon;
  const duration = traceDuration(trace);
  return (
    <li className="sw-ground-trace__item" data-status={trace.status}>
      <button
        type="button"
        className="sw-ground-trace__head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sw-ground-trace__kind">{trace.kind}</span>
        <span className="sw-ground-trace__name">{trace.name}</span>
        <Chip size="sm" tone={status.tone} icon={<Icon aria-hidden="true" />}>
          {status.label}
        </Chip>
        {duration && <span className="sw-ground-trace__time num">{duration}</span>}
        <ChevronDown className="sw-ground-trace__chevron" size={16} aria-hidden="true" />
      </button>
      <Reveal open={open}>
        <div className="sw-ground-trace__body">
          <dl className="sw-ground-facts num">
            <div>
              <dt>Started</dt>
              <dd>{dateTime(trace.startedAt)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{trace.completedAt ? dateTime(trace.completedAt) : 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Id</dt>
              <dd className="sw-mono">{trace.id}</dd>
            </div>
          </dl>
          <h3 className="sw-eyebrow">Input</h3>
          <pre className="sw-ground-trace__json" tabIndex={0}>
            {JSON.stringify(trace.input, null, 2)}
          </pre>
          <h3 className="sw-eyebrow">Output</h3>
          {trace.output !== null ? (
            <pre className="sw-ground-trace__json" tabIndex={0}>
              {JSON.stringify(trace.output, null, 2)}
            </pre>
          ) : (
            <p className="sw-caption">None recorded{trace.status === 'running' ? ' yet' : ''}.</p>
          )}
          {trace.error && (
            <p className="sw-ground-trace__error" role="alert">
              {trace.error}
            </p>
          )}
        </div>
      </Reveal>
    </li>
  );
}

/** What the engine recorded as it read the sources: for the person who wants the raw record, and only in Advanced. */
export function Trace() {
  const { project } = useGroundData();
  const [all, setAll] = useState(false);
  const traces = (project.console?.traces ?? []).filter(
    (trace) => all || trace.step === 'knowledge',
  );
  const events = [...project.events]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-120);
  if (traces.length === 0 && events.length === 0 && !project.console) return null;
  return (
    <section
      className="sw-ground__section sw-ground__section--quiet"
      aria-labelledby="ground-trace-title"
    >
      <h2 className="sr-only" id="ground-trace-title">
        Operations
      </h2>
      <span id="ground-trace" tabIndex={-1} />
      <Disclosure summary={`Operations · ${traces.length} recorded`}>
        <div className="sw-ground-trace">
          <Switch
            label="All steps"
            checked={all}
            onChange={(event) => setAll(event.target.checked)}
          />
          {traces.length === 0 ? (
            <p className="sw-caption">No operation was recorded.</p>
          ) : (
            <ul className="sw-ground-trace__list" role="list">
              {traces.map((trace) => (
                <TraceRow key={trace.id} trace={trace} />
              ))}
            </ul>
          )}
          {events.length > 0 && (
            <>
              <h3 className="sw-eyebrow">Events</h3>
              <div
                className="sw-ground-trace__logbox"
                role="log"
                aria-label="Recorded events"
                tabIndex={0}
              >
                <ol className="sw-ground-trace__log" role="list">
                  {events.map((event) => (
                    <li key={event.id}>
                      <time className="num" dateTime={event.createdAt}>
                        {dateTime(event.createdAt)}
                      </time>
                      <span className="sw-ground-trace__stage">{event.stage}</span>
                      <span>{event.message}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      </Disclosure>
    </section>
  );
}
