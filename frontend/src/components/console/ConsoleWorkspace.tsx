import { useState } from 'react';
import {
  Check,
  Copy,
  GitBranch,
  LayoutPanelLeft,
  PanelRight,
  RefreshCw,
  Square,
} from 'lucide-react';
import type {
  ConsoleStep,
  EnvironmentUpdate,
  ExecutionStep,
  SurveyRecord,
} from '../../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../../shared/types';
import {
  initialStep,
  isBusy,
  isGuided,
  stepAvailable,
  stepLabels,
  stepOrder,
  stepStatus,
} from '../../lib/console';
import type { Inspection } from '../../lib/graph';
import { Notice, Spinner, StatusBadge } from '../ui';
import { EnvironmentStage } from './EnvironmentStage';
import { GraphCanvas } from './GraphCanvas';
import { Inspector } from './Inspector';
import { InteractionStage } from './InteractionStage';
import { KnowledgeStage } from './KnowledgeStage';
import { OperationLog } from './OperationLog';
import { ReportReader } from './ReportReader';
import { ReportStage } from './ReportStage';
import { SimulationStage } from './SimulationStage';

type View = 'graph' | 'split' | 'workbench';

export function ConsoleWorkspace({
  project,
  config,
  busy,
  refreshing,
  onRun,
  onSave,
  onCancel,
  onRefresh,
  onDuplicate,
  onSurvey,
}: {
  project: ProjectDetail;
  config: AppConfig | null;
  busy: boolean;
  refreshing: boolean;
  onRun: (step: ExecutionStep) => Promise<unknown>;
  onSave: (input: EnvironmentUpdate) => Promise<void>;
  onCancel: () => Promise<unknown>;
  onRefresh: () => void;
  onDuplicate: () => void;
  onSurvey: (record: SurveyRecord) => void;
}) {
  const [step, setStep] = useState<ConsoleStep>(() => initialStep(project));
  const [view, setView] = useState<View>('split');
  const [mobilePane, setMobilePane] = useState<'canvas' | 'stage'>('stage');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const guided = isGuided(project);
  const reportView = step === 'report' || step === 'interaction';
  const navigate = (next: ConsoleStep) => {
    if (!stepAvailable(project, next)) return;
    setStep(next);
    setMobilePane('stage');
  };
  const run = (next: ExecutionStep) => {
    setStep(next);
    setMobilePane('stage');
    void onRun(next).catch(() => {
      // The operation hook displays the API error and refreshes persisted state.
    });
  };
  const cancel = () => {
    void onCancel().catch(() => {
      // The operation hook displays cancellation errors.
    });
  };
  const inspect = (selection: Inspection) => setInspection(selection);
  let stage;
  switch (step) {
    case 'knowledge':
      stage = (
        <KnowledgeStage
          project={project}
          busy={busy}
          onRun={run}
          onNavigate={navigate}
          onInspect={inspect}
        />
      );
      break;
    case 'environment':
      stage = (
        <EnvironmentStage
          project={project}
          busy={busy}
          onSave={onSave}
          onRun={run}
          onNavigate={navigate}
          onInspect={inspect}
        />
      );
      break;
    case 'simulation':
      stage = (
        <SimulationStage
          project={project}
          busy={busy}
          onRun={run}
          onNavigate={navigate}
          onCancel={cancel}
          onInspect={inspect}
        />
      );
      break;
    case 'report':
      stage = (
        <ReportStage
          project={project}
          busy={busy}
          onRun={run}
          onNavigate={navigate}
          onInspect={inspect}
        />
      );
      break;
    case 'interaction':
      stage = (
        <InteractionStage
          project={project}
          config={config}
          onSurvey={onSurvey}
          onInspect={inspect}
        />
      );
  }
  const provider = project.execution
    ? `${project.execution.provider}${project.execution.model ? ` / ${project.execution.model}` : ''}`
    : project.mode === 'local'
      ? 'local rules · execution not yet recorded'
      : 'model provider · execution not yet recorded';

  return (
    <div className="console-workspace">
      <section className="project-heading">
        <div className="project-identity">
          <span className="eyebrow">
            {guided
              ? 'GUIDED CONSOLE'
              : project.workflow === 'guided'
                ? 'GUIDED RECORD UNAVAILABLE'
                : 'LEGACY QUICK-RUN RESULT'}
          </span>
          <h1>{project.name}</h1>
          <p>{project.question}</p>
        </div>
        <div className="project-actions">
          <StatusBadge status={project.status} />
          <button
            className="icon-button"
            type="button"
            disabled={refreshing || busy}
            onClick={onRefresh}
            aria-label="Refresh project from server"
          >
            {refreshing ? <Spinner label="Refreshing project" /> : <RefreshCw size={16} />}
          </button>
          {guided && isBusy(project) && (
            <button
              className="button button-danger button-small"
              type="button"
              disabled={busy}
              onClick={cancel}
            >
              <Square size={12} /> Cancel stage
            </button>
          )}
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={busy}
            onClick={onDuplicate}
          >
            <Copy size={13} /> Duplicate as guided
          </button>
        </div>
      </section>
      <div className="project-metadata mono">
        <span>PROJECT {project.id}</span>
        <span>
          {project.mode === 'local' ? 'LOCAL / NO MODEL ASSISTANCE' : 'MODEL ASSISTED'} · {provider}
        </span>
        {project.execution && (
          <span>
            {project.execution.modelCalls} REAL MODEL CALLS · {project.execution.inputTokens} IN /{' '}
            {project.execution.outputTokens} OUT TOKENS
          </span>
        )}
      </div>
      {!guided && (
        <Notice
          tone="warning"
          title={
            project.workflow === 'guided'
              ? 'Guided console state is missing'
              : 'Read-only legacy quick run'
          }
        >
          {project.workflow === 'guided'
            ? 'The API did not return a guided stage record. Available stored fields are readable below, but stage operations are disabled. Refresh to recover the actual record.'
            : 'This is an existing quick-run result, not a staged guided run. Only recorded graph, proxy, round, report and event data is shown. No ontology, dual-platform runs, tool traces or guided memory IDs are invented.'}{' '}
          Duplicate inputs as guided to start a new staged workflow. Completed quick-run chat,
          evidence and Markdown export remain available.
        </Notice>
      )}
      {project.error && (
        <Notice tone="error" title="Recorded execution error">
          {project.error}
        </Notice>
      )}
      <div className="workspace-navigation">
        <nav className="console-stepper" aria-label="Guided workflow steps">
          {stepOrder.map((item, index) => {
            const status = stepStatus(project, item);
            const enabled = stepAvailable(project, item);
            return (
              <button
                type="button"
                className={`console-step ${step === item ? 'active' : ''} step-${status ?? 'unknown'}`}
                key={item}
                disabled={!enabled}
                aria-current={step === item ? 'step' : undefined}
                aria-label={`Step ${index + 1}: ${stepLabels[item]}, ${status ?? 'historical view'}${!enabled ? ', prerequisite not ready' : ''}`}
                onClick={() => navigate(item)}
              >
                <span className="step-index">
                  {status === 'ready' ? <Check size={13} /> : index + 1}
                </span>
                <span>
                  <strong>{stepLabels[item]}</strong>
                  <small>{status ?? 'historical view'}</small>
                </span>
                {(status === 'queued' || status === 'running') && (
                  <Spinner label={`${stepLabels[item]} ${status}`} />
                )}
              </button>
            );
          })}
        </nav>
        <div className="segmented view-toggle" role="group" aria-label="Console view">
          <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>
            <GitBranch size={14} /> Graph
          </button>
          <button type="button" aria-pressed={view === 'split'} onClick={() => setView('split')}>
            <LayoutPanelLeft size={14} /> Split
          </button>
          <button
            type="button"
            aria-pressed={view === 'workbench'}
            onClick={() => setView('workbench')}
          >
            <PanelRight size={14} /> Workbench
          </button>
        </div>
      </div>
      {view === 'split' && (
        <div className="mobile-pane-tabs segmented" role="group" aria-label="Mobile console pane">
          <button
            type="button"
            aria-pressed={mobilePane === 'canvas'}
            onClick={() => setMobilePane('canvas')}
          >
            {reportView ? 'Report reader' : 'Graph'}
          </button>
          <button
            type="button"
            aria-pressed={mobilePane === 'stage'}
            onClick={() => setMobilePane('stage')}
          >
            {stepLabels[step]} workbench
          </button>
        </div>
      )}
      <div
        className={`console-grid view-${view} ${reportView ? 'report-layout' : ''} mobile-${mobilePane}`}
      >
        {view === 'graph' ? (
          <div className="console-canvas">
            <GraphCanvas project={project} onInspect={inspect} />
          </div>
        ) : (
          <>
            {(view === 'split' || reportView) && (
              <div className="console-canvas">
                {reportView ? (
                  <ReportReader project={project} onInspect={inspect} />
                ) : (
                  <GraphCanvas project={project} onInspect={inspect} />
                )}
              </div>
            )}
            <section className="console-stage" aria-label={`${stepLabels[step]} workbench`}>
              {stage}
            </section>
          </>
        )}
      </div>
      <OperationLog project={project} />
      {inspection && (
        <Inspector
          project={project}
          selection={inspection}
          onInspect={inspect}
          onClose={() => setInspection(null)}
        />
      )}
    </div>
  );
}
