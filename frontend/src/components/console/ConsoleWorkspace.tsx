import { useState } from 'react';
import { Copy, Gauge, RefreshCw, ShieldCheck, Square, Users } from 'lucide-react';
import type {
  ConsoleStep,
  BranchInput,
  EnvironmentUpdate,
  ExecutionStep,
  SurveyRecord,
} from '../../../../shared/guided';
import type {
  AppConfig,
  Intervention,
  ProjectDetail,
  ProjectSummary,
} from '../../../../shared/types';
import {
  initialStep,
  isBusy,
  isGuided,
  stepAvailable,
  stepLabels,
  stepStatus,
} from '../../lib/console';
import type { Inspection } from '../../lib/graph';
import { Notice, Spinner, StatusBadge } from '../ui';
import { budgetButtonLabel, budgetSummary } from '../../lib/budget';
import { projectUsageText } from '../../lib/provider';
import { ProjectModeChip } from './ProjectModeChip';
import { EnvironmentStage } from './EnvironmentStage';
import { GraphCanvas } from './GraphCanvas';
import { Inspector } from './Inspector';
import { InteractionStage } from './InteractionStage';
import { KnowledgeStage } from './KnowledgeStage';
import { OperationLog } from './OperationLog';
import { ReportReader } from './ReportReader';
import { ReportStage } from './ReportStage';
import { SimulationStage } from './SimulationStage';
import { BranchDialog } from './BranchDialog';
import { AuditDialog } from './AuditDialog';
import { ProjectAccessDialog } from './AccessDialog';
import { BudgetDialog, BudgetNotice } from './BudgetDialog';
import { BranchBanner } from './BranchBanner';
import { CompareView } from './CompareView';
import { ReportStudio } from '../studio/ReportStudio';
import { useBudget } from '../../hooks/useBudget';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ConsoleViewControls, CONSOLE_NARROW_QUERY } from './ConsoleViewControls';
import type { ConsoleView } from './ConsoleViewControls';
import { ConsoleStepper } from './ConsoleStepper';
import { useJsonSnapshotExport } from '../../hooks/useJsonSnapshotExport';
import { JsonSnapshotExportButton, JsonSnapshotExportError } from './JsonSnapshotExport';

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
  onPause,
  onResume,
  onIntervention,
  onBranch,
  onSelectProject,
  projects,
  comparisonRequested = false,
  onCloseComparison,
  sharing = false,
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
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onIntervention: (value: Intervention | null) => Promise<void>;
  onBranch: (input: BranchInput) => Promise<void>;
  onSelectProject: (id: string) => void;
  projects: ProjectSummary[];
  comparisonRequested?: boolean;
  onCloseComparison: () => void;
  /** Whether people sign in, so that who has access to the project is something to show and change. */
  sharing?: boolean;
}) {
  const [step, setStep] = useState<ConsoleStep>(() => initialStep(project));
  const snapshotExport = useJsonSnapshotExport(project.id);
  const [view, setView] = useState<ConsoleView>('split');
  const narrow = useMediaQuery(CONSOLE_NARROW_QUERY);
  const effectiveView = narrow && view === 'split' ? 'workbench' : view;
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  // Only a project that calls a model has a budget to speak of; it is read again as its calls are counted.
  const budget = useBudget(project.id, project.mode === 'llm', project.execution?.modelCalls ?? 0);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonOther, setComparisonOther] = useState<string | null>(null);
  const [comparisonRevision, setComparisonRevision] = useState(0);
  const [studioOpen, setStudioOpen] = useState(false);
  const guided = isGuided(project);
  const whatIf = guided && Boolean(config?.capabilities.whatIf);
  const comparing = whatIf && (comparisonOpen || comparisonRequested);
  const compare = (otherId?: string) => {
    setComparisonOther(otherId ?? project.parentId);
    setComparisonRevision((value) => value + 1);
    setComparisonOpen(true);
    setStudioOpen(false);
  };
  const changeView = (next: ConsoleView) => {
    setView(next);
    setComparisonOpen(false);
    setStudioOpen(false);
    onCloseComparison();
  };
  const reportView = step === 'report' || step === 'interaction';
  const navigate = (next: ConsoleStep) => {
    if (!stepAvailable(project, next)) return;
    setStep(next);
    setComparisonOpen(false);
    setStudioOpen(false);
    onCloseComparison();
    if (narrow) setView('workbench');
  };
  const run = (next: ExecutionStep) => {
    setStep(next);
    if (narrow) setView('workbench');
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
          whatIf={whatIf}
          onPause={onPause}
          onResume={onResume}
          onRestart={async () => {
            await onRun('simulation');
          }}
          onIntervention={onIntervention}
          onBranch={() => setBranchOpen(true)}
          onCompare={() => compare()}
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
          onCompare={whatIf ? () => compare() : undefined}
          onOpenStudio={() => {
            setComparisonOpen(false);
            onCloseComparison();
            setStudioOpen(true);
          }}
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
          <StatusBadge
            status={stepStatus(project, 'simulation') === 'paused' ? 'paused' : project.status}
          />
          {whatIf && project.rounds.length > 0 && (
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => compare()}
            >
              Compare
            </button>
          )}
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
            onClick={() => setAuditOpen(true)}
          >
            <ShieldCheck size={13} aria-hidden="true" /> Audit log
          </button>
          {sharing && (
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => setAccessOpen(true)}
            >
              <Users size={13} aria-hidden="true" /> Access
            </button>
          )}
          {project.mode === 'llm' && (
            <button
              className="button button-secondary button-small"
              type="button"
              title={
                budget.budget
                  ? budgetSummary(budget.budget)
                  : 'What this project may spend on the model'
              }
              onClick={() => setBudgetOpen(true)}
            >
              <Gauge size={13} aria-hidden="true" /> {budgetButtonLabel(budget.budget)}
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
          <JsonSnapshotExportButton
            pending={snapshotExport.pending}
            onExport={snapshotExport.download}
          />
        </div>
      </section>
      <JsonSnapshotExportError error={snapshotExport.error} />
      <div className="project-provenance">
        <ProjectModeChip project={project} />
        <details className="project-metadata mono">
          <summary>Project {project.id.slice(0, 8)} · usage and full ID</summary>
          <div>
            <span>Full project ID: {project.id}</span>
            {project.execution && <span>{projectUsageText(project.execution)}</span>}
          </div>
        </details>
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
      {project.mode === 'llm' && (
        <BudgetNotice budget={budget.budget} onOpen={() => setBudgetOpen(true)} />
      )}
      {project.error && (
        <Notice tone="error" title="Recorded execution error">
          {project.error}
        </Notice>
      )}
      <div className="workspace-navigation">
        <ConsoleStepper project={project} step={step} onNavigate={navigate} />
        <ConsoleViewControls
          narrow={narrow}
          leftLabel={reportView ? 'Report' : 'Graph'}
          view={view}
          onChange={changeView}
        />
      </div>
      {whatIf && (
        <BranchBanner
          project={project}
          enabled={whatIf}
          onNavigate={onSelectProject}
          onCompare={compare}
        />
      )}
      {comparing ? (
        <CompareView
          key={comparisonRevision}
          project={project}
          projects={projects}
          defaultOtherId={comparisonOther ?? project.parentId}
          onClose={() => {
            setComparisonOpen(false);
            onCloseComparison();
          }}
        />
      ) : studioOpen ? (
        <ReportStudio projectId={project.id} onClose={() => setStudioOpen(false)} />
      ) : (
        <div
          className={`console-grid view-${effectiveView} ${reportView && effectiveView === 'split' ? 'report-layout' : ''}`}
        >
          {effectiveView === 'graph' ? (
            <div className="console-canvas">
              {reportView ? (
                <ReportReader project={project} onInspect={inspect} />
              ) : (
                <GraphCanvas
                  project={project}
                  onInspect={inspect}
                  evolution={whatIf && step === 'simulation'}
                />
              )}
            </div>
          ) : (
            <>
              {effectiveView === 'split' && (
                <div className="console-canvas">
                  {reportView ? (
                    <ReportReader project={project} onInspect={inspect} />
                  ) : (
                    <GraphCanvas
                      project={project}
                      onInspect={inspect}
                      evolution={whatIf && step === 'simulation'}
                    />
                  )}
                </div>
              )}
              <section className="console-stage" aria-label={`${stepLabels[step]} workbench`}>
                {stage}
              </section>
            </>
          )}
        </div>
      )}
      <OperationLog project={project} />
      {branchOpen && whatIf && (
        <BranchDialog
          project={project}
          busy={busy}
          onSubmit={onBranch}
          onClose={() => setBranchOpen(false)}
        />
      )}
      {auditOpen && <AuditDialog projectId={project.id} onClose={() => setAuditOpen(false)} />}
      {accessOpen && (
        <ProjectAccessDialog projectId={project.id} onClose={() => setAccessOpen(false)} />
      )}
      {budgetOpen && (
        <BudgetDialog
          projectId={project.id}
          onClose={() => {
            setBudgetOpen(false);
            budget.reload();
          }}
        />
      )}
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
