import {
  Activity,
  ArrowRight,
  Check,
  Circle,
  Clock3,
  FileText,
  GitBranch,
  Layers3,
  Users,
} from 'lucide-react';
import type { ProjectDetail } from '../../../shared/types';
import { count, dateTime, isActive, percent, stageLabels, stages } from '../lib/format';
import { EmptyPanel, Spinner } from './ui';

export function RunOverview({
  project,
  onDocument,
  onRounds,
  onReport,
}: {
  project: ProjectDetail;
  onDocument: (id: string) => void;
  onRounds: () => void;
  onReport: () => void;
}) {
  const active = isActive(project.status);
  const currentStage = stages.indexOf(project.stage);
  const progress = Math.min(100, Math.max(0, project.progress));
  const latestRound = project.rounds.at(-1);
  return (
    <div className="view-stack">
      <section className="card progress-card" aria-labelledby="progress-heading">
        <div className="progress-heading">
          <div>
            <span className="eyebrow">EXPERIMENT PIPELINE</span>
            <h2 id="progress-heading">
              {project.status === 'draft'
                ? 'Ready when you are.'
                : project.status === 'completed'
                  ? 'Your scenario, explored.'
                  : project.status === 'failed'
                    ? 'The run needs attention.'
                    : project.status === 'cancelled'
                      ? 'The run was cancelled.'
                      : project.status === 'queued'
                        ? 'In the run queue.'
                        : 'A scenario is taking shape.'}
            </h2>
          </div>
          <div className="progress-number">
            {active && <Spinner label="Experiment is active" />}
            <strong>
              {Math.round(progress)}
              <span>%</span>
            </strong>
          </div>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Experiment progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={`${Math.round(progress)} percent, ${stageLabels[project.stage]}, ${project.status}`}
        >
          <div style={{ width: `${progress}%` }} />
        </div>
        <ol className="pipeline-stages">
          {stages.map((stage, index) => {
            const done = project.status === 'completed' || index < currentStage;
            const current = stage === project.stage && project.status !== 'completed';
            return (
              <li
                key={stage}
                className={`${done ? 'stage-done' : ''} ${current ? 'stage-current' : ''}`}
                aria-current={current ? 'step' : undefined}
              >
                <span className="stage-symbol">
                  {done ? (
                    <Check size={13} aria-hidden="true" />
                  ) : current && active ? (
                    <span className="stage-pulse" />
                  ) : (
                    <Circle size={9} aria-hidden="true" />
                  )}
                </span>
                <span>{stageLabels[stage]}</span>
              </li>
            );
          })}
        </ol>
        <div className="pipeline-footnote">
          <span>
            {project.mode === 'local'
              ? 'Rules-based engine · no AI calls'
              : 'Model-assisted engine · provider connectivity is checked by actual requests'}
          </span>
          <span>
            {active ? 'Updates automatically while active' : 'No background polling for this state'}
          </span>
        </div>
      </section>

      <div className="run-facts-grid">
        <div className="card run-fact">
          <span className="fact-icon">
            <FileText size={18} aria-hidden="true" />
          </span>
          <div>
            <span>Source material</span>
            <strong>
              {project.documents.length} document{project.documents.length === 1 ? '' : 's'}
            </strong>
            <small>
              {count(project.documents.reduce((sum, document) => sum + document.content.length, 0))}{' '}
              characters
            </small>
          </div>
        </div>
        <div className="card run-fact">
          <span className="fact-icon violet">
            <Users size={18} aria-hidden="true" />
          </span>
          <div>
            <span>Fictional personas</span>
            <strong>
              {project.agents.length ? `${project.agents.length} created` : 'Not created yet'}
            </strong>
            <small>{project.agentCount} configured</small>
          </div>
        </div>
        <div className="card run-fact">
          <span className="fact-icon">
            <Layers3 size={18} aria-hidden="true" />
          </span>
          <div>
            <span>Recorded rounds</span>
            <strong>
              {project.rounds.length} / {project.roundCount}
            </strong>
            <small>
              {project.settings.network === 'community' ? 'Community network' : 'Broadcast network'}{' '}
              · seed {project.settings.seed}
            </small>
          </div>
        </div>
      </div>

      {latestRound && (
        <section className="latest-round-banner">
          <span className="latest-round-icon">
            <Activity size={21} aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">LATEST RECORDED SNAPSHOT · ROUND {latestRound.round}</span>
            <h3>
              {percent(latestRound.supportShare)} simulated support share <span>·</span>{' '}
              {latestRound.polarization.toFixed(3)} polarization
            </h3>
            <p>Simulated group metrics, not probabilities or a real-world forecast.</p>
          </div>
          <button className="button button-secondary button-small" type="button" onClick={onRounds}>
            Explore rounds <ArrowRight size={15} aria-hidden="true" />
          </button>
        </section>
      )}

      <div className="run-overview-columns">
        <section className="card activity-card">
          <div className="card-toolbar">
            <span>
              <Activity size={15} aria-hidden="true" /> RUN ACTIVITY
            </span>
            <span>{project.events.length} recorded events</span>
          </div>
          {project.events.length ? (
            <ol className="event-list">
              {[...project.events].reverse().map((event, index) => (
                <li key={event.id}>
                  <span
                    className={`event-marker ${index === 0 ? 'event-marker-latest' : ''}`}
                    aria-hidden="true"
                  />
                  <div>
                    <div className="event-heading">
                      <strong>{stageLabels[event.stage]}</strong>
                      <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time>
                    </div>
                    <p className="plain-text">{event.message}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyPanel title="A clean page" icon={<Clock3 size={24} aria-hidden="true" />}>
              Run events will appear here when the backend records them. Saving a draft does not run
              the simulation.
            </EmptyPanel>
          )}
        </section>
        <div className="run-context-column">
          <section className="card source-list-card">
            <div className="card-toolbar">
              <span>
                <FileText size={15} aria-hidden="true" /> SOURCE MATERIAL
              </span>
            </div>
            <ul>
              {project.documents.map((document) => (
                <li key={document.id}>
                  <button type="button" onClick={() => onDocument(document.id)}>
                    <FileText size={17} aria-hidden="true" />
                    <span>
                      <strong>{document.name}</strong>
                      <small>{count(document.content.length)} characters</small>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="card assumptions-card">
            <span className="eyebrow">ASSUMPTIONS MATTER</span>
            <h3>A world with boundaries.</h3>
            <p>
              This experiment uses fictional agents and a chosen network structure. The seed makes
              local rules-based runs reproducible; it does not make them accurate forecasts.
            </p>
            {project.settings.intervention && (
              <div className="assumption-intervention">
                <strong>Scheduled change · round {project.settings.intervention.round}</strong>
                <p className="plain-text">{project.settings.intervention.label}</p>
              </div>
            )}
            <span className="assumption-label">
              <GitBranch size={14} aria-hidden="true" />{' '}
              {project.settings.network === 'community'
                ? 'Community clusters'
                : 'Broadcast network'}
            </span>
          </section>
          {project.execution && (
            <section className="card execution-card">
              <h3>Actual execution</h3>
              <dl>
                <div>
                  <dt>Provider</dt>
                  <dd>
                    {project.execution.provider === 'none'
                      ? 'None · local rules'
                      : project.execution.provider}
                  </dd>
                </div>
                {project.execution.model && (
                  <div>
                    <dt>Model</dt>
                    <dd>{project.execution.model}</dd>
                  </div>
                )}
                <div>
                  <dt>Model calls</dt>
                  <dd>{count(project.execution.modelCalls)}</dd>
                </div>
                <div>
                  <dt>Reported input tokens</dt>
                  <dd>{count(project.execution.inputTokens)}</dd>
                </div>
                <div>
                  <dt>Reported output tokens</dt>
                  <dd>{count(project.execution.outputTokens)}</dd>
                </div>
              </dl>
              <p className="field-help">
                Usage is as recorded by the backend. Zero tokens may mean the provider did not
                report usage.
              </p>
            </section>
          )}
        </div>
      </div>
      {project.report && (
        <button type="button" className="report-ready-card" onClick={onReport}>
          <span className="file-icon">
            <FileText size={21} aria-hidden="true" />
          </span>
          <span>
            <span className="eyebrow">THE RESEARCH NOTE IS READY</span>
            <strong>{project.report.title}</strong>
          </span>
          <ArrowRight size={22} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
