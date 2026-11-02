import { createContext, useContext } from 'react';
import type {
  BranchInput,
  EnvironmentUpdate,
  ExecutionStep,
  SurveyRecord,
} from '../../../shared/guided';
import type { AppConfig, Intervention, ProjectDetail, ProjectSummary } from '../../../shared/types';
import type { UiMode } from '../lib/mode';
import type { ProjectScene, SceneId, SceneInfo } from './scenes';

/** The overlays any scene may ask the shell to open, so that a scene never has to own one. */
export interface PanelControls {
  history: () => void;
  ask: (options?: { target?: string; message?: string }) => void;
  audit: () => void;
  budget: () => void;
  access: () => void;
  provider: () => void;
  snapshot: () => void;
}

/**
 * Everything a scene may read of the open project and everything it may ask for. Scenes take no props:
 * they call `useWorkspace()`. The shell owns the polling, the operations and the address; a scene
 * decides only what to show and which of these to call.
 */
export interface Workspace {
  project: ProjectDetail;
  config: AppConfig | null;
  /** Guided shows less and says more; Advanced shows engine terms and diagnostics. */
  mode: UiMode;
  /** An engine operation is in flight (a stage run, a pause, a branch): controls that start another wait. */
  busy: boolean;
  /** The project is being read again. */
  refreshing: boolean;
  /** Reads the project again, with the person's request for it. */
  refresh: () => void;
  /** Starts an engine stage. Resolves when the server has accepted it; progress is read by polling. */
  run: (step: ExecutionStep) => Promise<unknown>;
  cancel: () => Promise<unknown>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setIntervention: (value: Intervention | null) => Promise<void>;
  branch: (input: BranchInput) => Promise<void>;
  saveEnvironment: (input: EnvironmentUpdate) => Promise<void>;
  recordSurvey: (record: SurveyRecord) => void;
  /** Opens the entry screen with this project's question and evidence filled in. */
  duplicate: () => void;
  /** Opens another project (from the history, or a branch), optionally into a scene and a view of it. */
  openProject: (id: string, target?: { scene?: ProjectScene; view?: string | null }) => void;
  projects: ProjectSummary[];
  /** The scene in view, and the view inside it (`story`, `live`, `network`, and so on). */
  scene: SceneId;
  view: string | null;
  /** Opens a scene (and a view in it). Scenes that are locked are refused with a toast. */
  go: (scene: SceneId, options?: { view?: string | null; replace?: boolean }) => void;
  /** Changes only the view inside the scene in view. */
  setView: (view: string | null) => void;
  /** The journey as the rail shows it. */
  journey: SceneInfo[];
  /** People sign in: who has access to the project is something to show and change. */
  sharing: boolean;
  panels: PanelControls;
}

export const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace needs the workspace shell above it.');
  return workspace;
}
