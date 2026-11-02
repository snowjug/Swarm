import { lazy, Suspense } from 'react';
import type { SurveyRecord } from '../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../shared/types';
import { useToast } from '../design/ui';
import type { useConsole } from '../hooks/useConsole';
import type { WorkspaceRole } from '../lib/members';
import { PanelBoundary } from '../panels/shared/PanelBoundary';
import type { ProjectScene } from './scenes';

const HistorySheet = lazy(() =>
  import('../panels/HistorySheet').then((m) => ({ default: m.HistorySheet })),
);
const AskSheet = lazy(() => import('../panels/AskSheet').then((m) => ({ default: m.AskSheet })));
const AuditSheet = lazy(() =>
  import('../panels/AuditSheet').then((m) => ({ default: m.AuditSheet })),
);
const BudgetDialog = lazy(() =>
  import('../panels/BudgetDialog').then((m) => ({ default: m.BudgetDialog })),
);
const ProjectAccess = lazy(() =>
  import('../panels/AccessDialog').then((m) => ({ default: m.ProjectAccess })),
);
const PeopleDialog = lazy(() =>
  import('../panels/AccessDialog').then((m) => ({ default: m.PeopleDialog })),
);

export type PanelName = 'history' | 'ask' | 'audit' | 'budget' | 'access' | 'people';

/** The question field of the first screen, or failing that the page itself: where "Ask a question" leaves a person. */
function focusTheQuestion(): void {
  const field = document.querySelector<HTMLElement>('[aria-label="Your what-if question"]');
  (field ?? document.getElementById('main-content'))?.focus();
}

/**
 * The overlays: each is mounted only while it is open, and its code is fetched when it is first wanted.
 * Closing one is the host's business; every panel is told `open` and `onOpenChange` and leaves by itself.
 */
export function PanelHost({
  panel,
  onClose,
  engine,
  project,
  config,
  workspaceRole,
  askSeed,
  onOpenProject,
  onSurvey,
  onDeepDive,
}: {
  panel: PanelName | null;
  onClose: () => void;
  engine: ReturnType<typeof useConsole>;
  project: ProjectDetail | null;
  config: AppConfig | null;
  workspaceRole: WorkspaceRole | null;
  askSeed: { target?: string; message?: string };
  onOpenProject: (id: string, target?: { scene?: ProjectScene; view?: string | null }) => void;
  onSurvey: (record: SurveyRecord) => void;
  /** Opens the deep dive of the open project, where Ask's report is written; null while it is shut. */
  onDeepDive: (() => void) | null;
}) {
  const toast = useToast();
  const change = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    // A panel that cannot be drawn (its code did not arrive) is told and let go; the page behind it is unharmed.
    <PanelBoundary
      key={panel ?? 'none'}
      onFail={() => {
        onClose();
        toast({
          title: 'That could not be opened',
          description: 'Check the connection and try again.',
          tone: 'error',
        });
      }}
    >
      <Suspense fallback={null}>
        {panel === 'history' && (
          <HistorySheet
            open
            onOpenChange={change}
            projects={engine.history.data?.projects ?? []}
            total={engine.history.data?.total ?? 0}
            loading={engine.history.loading}
            error={engine.history.error}
            selectedId={engine.selectedId}
            busy={Boolean(engine.operation)}
            onSelect={(id) => {
              onClose();
              onOpenProject(id);
            }}
            whatIf={Boolean(config?.capabilities.whatIf)}
            onCompare={(id) => {
              onClose();
              onOpenProject(id, { scene: 'compare', view: 'runs' });
            }}
            onRefresh={() => void engine.loadHistory()}
            onDelete={engine.remove}
            onNew={() => {
              onClose();
              window.setTimeout(focusTheQuestion, 0);
            }}
          />
        )}
        {panel === 'ask' && project && (
          <AskSheet
            open
            onOpenChange={change}
            project={project}
            config={config}
            onSurvey={onSurvey}
            onDeepDive={
              onDeepDive
                ? () => {
                    onClose();
                    onDeepDive();
                  }
                : null
            }
            initialTarget={askSeed.target}
            initialMessage={askSeed.message}
          />
        )}
        {panel === 'audit' && project && (
          <AuditSheet open onOpenChange={change} projectId={project.id} />
        )}
        {panel === 'budget' && project && (
          <BudgetDialog
            open
            onOpenChange={change}
            projectId={project.id}
            onChanged={engine.refresh}
          />
        )}
        {panel === 'access' && project && (
          <ProjectAccess open onOpenChange={change} projectId={project.id} />
        )}
        {panel === 'people' && <PeopleDialog open onOpenChange={change} actor={workspaceRole} />}
      </Suspense>
    </PanelBoundary>
  );
}
