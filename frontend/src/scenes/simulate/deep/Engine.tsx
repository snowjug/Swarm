import { useMemo, useState } from 'react';
import type { OperationTrace } from '../../../../../shared/guided';
import { Button, Chip, Disclosure } from '../../../design/ui';
import { dateTime } from '../../../lib/format';
import { projectUsageText } from '../../../lib/provider';
import { stepLabels, stepOrder } from '../../../lib/console';
import {
  CHART_NOTE,
  LOCAL_NOTE,
  MODEL_NOTE,
  POSITION_NOTE,
  PROXY_LINE,
  STATED_REASON_NOTE,
} from './copy';
import { useDeep } from './context';
import { engineLabel, plural } from './model';
import { SectionHead } from './parts';
import type { Tone } from '../../../design/ui';
import './engine.css';

const TRACE_TONE: Record<OperationTrace['status'], Tone> = {
  running: 'accent',
  completed: 'favor',
  failed: 'critical',
};

const json = (value: unknown): string => JSON.stringify(value, null, 2);

function State({ level }: { level: 2 | 3 }) {
  const { project } = useDeep();
  const state = project.console;
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-engine-state">
      <SectionHead
        id="deep-engine-state"
        level={level}
        title="Engine state"
        lead="The stages the engine keeps for this exploration, and what it recorded about the run."
      />
      <dl className="sw-deep-kv">
        {stepOrder.map((step) => (
          <div key={step}>
            <dt>{stepLabels[step]}</dt>
            <dd>{state ? state.steps[step] : 'not recorded'}</dd>
          </div>
        ))}
        <div>
          <dt>Active stage</dt>
          <dd>{state ? stepLabels[state.activeStep] : 'not recorded'}</dd>
        </div>
        <div>
          <dt>Engine</dt>
          <dd>{engineLabel(project)}</dd>
        </div>
        <div>
          <dt>Seed and network</dt>
          <dd>
            {project.settings.seed} · {project.settings.network}
          </dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd className="sw-mono">{project.id}</dd>
        </div>
        {project.execution && (
          <div>
            <dt>Model use</dt>
            <dd>{projectUsageText(project.execution)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function Trace({ trace, level }: { trace: OperationTrace; level: 2 | 3 }) {
  const Sub = `h${level + 1}` as 'h3' | 'h4';
  return (
    <Disclosure
      className="sw-deep-trace"
      summary={
        <span className="sw-deep-trace__sum">
          <span className="sw-deep-trace__name">{trace.name}</span>
          <Chip size="sm">{trace.kind}</Chip>
          <Chip size="sm" tone={TRACE_TONE[trace.status]} dot={trace.status === 'running'}>
            {trace.status}
          </Chip>
        </span>
      }
    >
      <div className="sw-deep-trace__body">
        <dl className="sw-deep-kv sw-deep-kv--flat">
          <div>
            <dt>Operation</dt>
            <dd className="sw-mono">{trace.id}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{dateTime(trace.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{trace.completedAt ? dateTime(trace.completedAt) : 'not recorded'}</dd>
          </div>
        </dl>
        <Sub className="sw-eyebrow">Recorded input</Sub>
        <pre className="sw-deep-pre" tabIndex={0}>
          {json(trace.input)}
        </pre>
        <Sub className="sw-eyebrow">Recorded output</Sub>
        {trace.output !== null ? (
          <pre className="sw-deep-pre" tabIndex={0}>
            {json(trace.output)}
          </pre>
        ) : (
          <p className="sw-deep-fine">
            No output was recorded{trace.status === 'running' ? ' yet' : ''}.
          </p>
        )}
        {trace.error && (
          <p className="sw-deep-trace__error" role="alert">
            {trace.error}
          </p>
        )}
      </div>
    </Disclosure>
  );
}

function Traces({ level }: { level: 2 | 3 }) {
  const { project } = useDeep();
  const traces = project.console?.traces ?? [];
  const [limit, setLimit] = useState(10);
  const shown = traces.slice().reverse().slice(0, limit);
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-engine-traces">
      <SectionHead
        id="deep-engine-traces"
        level={level}
        title="Operation traces"
        lead="Each tool and engine operation that ran, with what went in and what came out. Newest first."
      />
      {traces.length === 0 ? (
        <p className="sw-deep-fine">No operation traces have been recorded yet.</p>
      ) : (
        <div className="sw-deep-traces">
          {shown.map((trace) => (
            <Trace key={trace.id} trace={trace} level={level} />
          ))}
          {shown.length < traces.length && (
            <Button variant="glass" size="sm" onClick={() => setLimit((old) => old + 10)}>
              Show more ({traces.length - shown.length} left)
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Log({ level }: { level: 2 | 3 }) {
  const { project } = useDeep();
  const [limit, setLimit] = useState(30);
  const lines = useMemo(
    () =>
      [
        ...project.events.map((event) => ({
          id: `event-${event.id}`,
          time: event.createdAt,
          tag: event.stage,
          text: event.message,
        })),
        ...(project.console?.traces ?? []).map((trace) => ({
          id: `trace-${trace.id}`,
          time: trace.startedAt,
          tag: trace.kind,
          text: `${trace.name} · ${trace.status}${trace.error ? ` · ${trace.error}` : ''}`,
        })),
      ].sort((a, b) => b.time.localeCompare(a.time)),
    [project.events, project.console?.traces],
  );
  const shown = lines.slice(0, limit);
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-engine-log">
      <SectionHead
        id="deep-engine-log"
        level={level}
        title="Operation log"
        lead={`${plural(lines.length, 'persisted record')}, the server’s events and the traces together. Newest first.`}
      />
      {lines.length === 0 ? (
        <p className="sw-deep-fine">No persisted events or traces were returned.</p>
      ) : (
        <ol className="sw-deep-log" aria-label="Recorded server events and operation traces">
          {shown.map((line) => (
            <li key={line.id}>
              <time dateTime={line.time}>{dateTime(line.time)}</time>
              <span className="sw-deep-log__tag">{line.tag}</span>
              <span className="sw-deep-log__text">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
      {shown.length < lines.length && (
        <Button variant="glass" size="sm" onClick={() => setLimit((old) => old + 30)}>
          Show earlier ({lines.length - shown.length} left)
        </Button>
      )}
    </section>
  );
}

function Raw({ level }: { level: 2 | 3 }) {
  const { project } = useDeep();
  const state = project.console;
  const record = useMemo(
    () =>
      state
        ? {
            steps: state.steps,
            activeStep: state.activeStep,
            branch: state.branch,
            environment: state.environment,
            platforms: state.platforms.map((run) => ({
              platform: run.platform,
              label: run.label,
              network: run.network,
              status: run.status,
              currentRound: run.currentRound,
              elapsedMinutes: run.elapsedMinutes,
              proxies: run.agents.length,
              savedRounds: run.rounds.length,
            })),
            settings: project.settings,
          }
        : { settings: project.settings },
    [state, project.settings],
  );
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-engine-raw">
      <SectionHead
        id="deep-engine-raw"
        level={level}
        title="Raw record"
        lead="The stage record and the settings as the server holds them, as text."
      />
      <Disclosure summary="Show the record">
        <pre className="sw-deep-pre" tabIndex={0}>
          {json(record)}
        </pre>
      </Disclosure>
    </section>
  );
}

function Reading({ level }: { level: 2 | 3 }) {
  const { project } = useDeep();
  const local = project.mode === 'local';
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-engine-read">
      <SectionHead id="deep-engine-read" level={level} title="How to read it" />
      <ul className="sw-deep-notes" role="list">
        <li>{PROXY_LINE}</li>
        <li>{local ? LOCAL_NOTE : MODEL_NOTE}</li>
        <li>{POSITION_NOTE}</li>
        <li>{CHART_NOTE}</li>
        <li>
          Where a model gave a reason or a firmness for an action, both are text the model chose to
          write. {STATED_REASON_NOTE} Firmness is the proxy’s own report of how firm its new stance
          is, from 0 to 100%.
        </li>
        <li>
          The two platforms differ in who each proxy hears, so they are shown apart and never
          averaged into one audience.
        </li>
      </ul>
    </section>
  );
}

/** The engine's own records: its stages, every operation it ran, its log and the stage record as text, and how to read them. */
export function Engine({ level = 2 }: { level?: 2 | 3 }) {
  return (
    <div className="sw-deep-engine-page">
      <State level={level} />
      <Traces level={level} />
      <Log level={level} />
      <Raw level={level} />
      <Reading level={level} />
    </div>
  );
}

/** For Guided mode, where the engine's records are one press away instead of a tab of their own. */
export function EngineDisclosure() {
  const { project } = useDeep();
  if (!project.console) return null;
  return (
    <div className="sw-deep-engine-fold">
      <Disclosure summary="Engine records: traces, the log and the raw state">
        <Engine level={3} />
      </Disclosure>
    </div>
  );
}
