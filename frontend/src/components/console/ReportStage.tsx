import { ArrowRight, Check, FilePenLine } from 'lucide-react';
import type { ConsoleStep, ExecutionStep } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { stepStatus } from '../../lib/console';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel, Notice } from '../ui';
import { RunStepButton, StageStatus } from './StageControls';
import { TraceList } from './TraceList';

export function ReportStage({
  project,
  busy,
  onRun,
  onNavigate,
  onInspect,
  onCompare,
  onOpenStudio,
}: {
  project: ProjectDetail;
  busy: boolean;
  onRun: (step: ExecutionStep) => void;
  onNavigate: (step: ConsoleStep) => void;
  onInspect: (selection: Inspection) => void;
  onCompare?: () => void;
  onOpenStudio?: () => void;
}) {
  const plan = project.console?.reportPlan;
  const traces = project.console?.traces.filter((trace) => trace.step === 'report') ?? [];
  return (
    <div className="stage-content view-stack">
      <div>
        <span className="eyebrow">04 / REPORT</span>
        <h2>Review the evidence trail</h2>
      </div>
      {(onCompare || onOpenStudio) && (
        <div className="stage-actions primary-stage-actions">
          {onOpenStudio && (
            <>
              <button
                className="button button-primary"
                type="button"
                disabled={!project.report}
                onClick={onOpenStudio}
              >
                <FilePenLine size={14} aria-hidden="true" /> Open Report Studio
              </button>
              {!project.report && (
                <span className="field-help">
                  Generate the report before opening it in the studio.
                </span>
              )}
            </>
          )}
          {onCompare && (
            <>
              <button
                className="button button-secondary"
                type="button"
                disabled={!project.rounds.length}
                onClick={onCompare}
              >
                Compare recorded runs
              </button>
              {!project.rounds.length && (
                <span className="field-help">
                  Save at least one simulation round before comparing.
                </span>
              )}
            </>
          )}
        </div>
      )}
      <StageStatus project={project} step="report" />
      <RunStepButton
        project={project}
        step="report"
        busy={busy}
        onRun={onRun}
        label="Generate Report"
      />
      <section className="stage-card">
        <div className="section-heading">
          <h3>Recorded report plan</h3>
          <span className="mono muted">
            {plan ? `${plan.completedSections} / ${plan.sections.length} CHAPTERS` : 'NO RECORD'}
          </span>
        </div>
        {plan ? (
          <div className="view-stack">
            <strong>{plan.title}</strong>
            <ol className="report-outline">
              {plan.sections.map((section, index) => (
                <li
                  key={`${index}-${section}`}
                  className={index < plan.completedSections ? 'complete' : ''}
                >
                  <span className="outline-marker">
                    {index < plan.completedSections ? <Check size={13} /> : index + 1}
                  </span>
                  <div>
                    {section}
                    <small>
                      {index < plan.completedSections
                        ? 'Recorded complete'
                        : 'Planned — not yet recorded complete'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
            {!!plan.evidenceQueries.length && (
              <details className="record-details">
                <summary>Planned evidence queries ({plan.evidenceQueries.length})</summary>
                {plan.evidenceQueries.map((query, index) => (
                  <button
                    className="source-chip"
                    type="button"
                    key={index}
                    onClick={() => onInspect({ kind: 'sources', query })}
                  >
                    {query}
                  </button>
                ))}
              </details>
            )}
            {!!plan.interviewAgentIds.length && (
              <details className="record-details">
                <summary>Planned fictional proxy interviews</summary>
                <p className="preserve-text">{plan.interviewQuestion}</p>
                <div className="source-links">
                  {plan.interviewAgentIds.map((id) => (
                    <button
                      className="source-chip memory-chip"
                      type="button"
                      key={id}
                      onClick={() => onInspect({ kind: 'agent', id })}
                    >
                      {project.agents.find((agent) => agent.id === id)?.name ?? id}
                    </button>
                  ))}
                </div>
                <small className="muted">
                  A plan is not evidence that an interview ran. Inspect completed operation output
                  below.
                </small>
              </details>
            )}
          </div>
        ) : (
          <EmptyPanel title="No saved plan">
            {project.console
              ? 'The server has not recorded a report plan yet.'
              : 'This quick run did not persist a guided outline or chapter-progress record.'}
          </EmptyPanel>
        )}
      </section>
      <Notice title="Observable operations, not hidden reasoning">
        Expand actual provider inputs, tool outputs and retrieved evidence below. No private
        chain-of-thought is requested or displayed. Source material and model text are rendered as
        plain text.
      </Notice>
      <section className="stage-card">
        <div className="section-heading">
          <h3>Report operations</h3>
          <span className="mono muted">{traces.length} RECORDED</span>
        </div>
        <TraceList traces={traces} />
      </section>
      {project.console?.interviews.length ? (
        <section className="stage-card">
          <h3>Recorded fictional interviews</h3>
          {project.console.interviews.map((interview) => (
            <button
              className="document-row"
              type="button"
              key={interview.id}
              onClick={() => onInspect({ kind: 'interview', id: interview.id })}
            >
              <span>
                <strong>
                  {project.agents.find((agent) => agent.id === interview.agentId)?.name ??
                    interview.agentId}
                </strong>
                <small>{interview.question}</small>
              </span>
              <ArrowRight size={14} />
            </button>
          ))}
        </section>
      ) : null}
      {(stepStatus(project, 'report') === 'ready' ||
        (!project.console && project.status === 'completed' && project.report)) && (
        <button
          className="button button-primary"
          type="button"
          onClick={() => onNavigate('interaction')}
        >
          Open Interaction <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}
