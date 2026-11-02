import { lazy, Suspense } from 'react';
import type { SurveyRecord } from '../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../shared/types';
import type { useConsole } from '../hooks/useConsole';
import type { WorkspaceRole } from '../lib/members';
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
}) {
  const change = (open: boolean) => {
    if (!open) onClose();
  };
  return (
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
        />
      )}
      {panel === 'ask' && project && (
        <AskSheet
          open
          onOpenChange={change}
          project={project}
          config={config}
          onSurvey={onSurvey}
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
  );
}
