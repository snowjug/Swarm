import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { api, errorMessage } from '../api';
import type { ProjectDetail } from '../../../shared/types';
import { Notice, Orbit, Button, useToast } from '../design/ui';
import { Skeleton } from '../design/ui';
import { useConsole } from '../hooks/useConsole';
import { useJsonSnapshotExport } from '../hooks/useJsonSnapshotExport';
import { useLabRefresh } from '../hooks/useLabRefresh';
import { useWorkspaceRole } from '../hooks/useMembers';
import { useMode } from '../hooks/useMode';
import { useProviderStatus } from '../hooks/useProviderStatus';
import { useTheme } from '../hooks/useTheme';
import { labWatch } from '../lib/console';
import { sourceLink } from '../lib/format';
import { administersWorkspace } from '../lib/members';
import { setMotionPreference, useMotionPreference } from '../design/motion';
import { PanelHost, type PanelName } from './PanelHost';
import { AppShell } from './AppShell';
import { CommandPalette } from './CommandPalette';
import { Dock } from './Dock';
import { SceneHost } from './SceneHost';
import { preloadScene } from './loaders';
import { SettingsMenu } from './SettingsMenu';
import { TopBar } from './TopBar';
import { buildCommands, opensPalette } from './commands';
import { WorkspaceContext, type PanelControls, type Workspace } from './context';
import { navigate, useRoute } from './route';
import {
  frontierScene,
  isProjectScene,
  sceneAvailable,
  sceneInfos,
  type ProjectScene,
  type SceneId,
} from './scenes';
import { AskScene } from '../scenes/ask/AskScene';
import { ProviderStatus } from '../panels/ProviderStatus';
import { BudgetGuard } from '../panels/BudgetGuard';

/** The scene each engine stage belongs to, for the one thing the lab's polling needs to know. */
const STEP_OF_SCENE = {
  ground: 'knowledge',
  map: 'environment',
  simulate: 'simulation',
  compare: 'simulation',
  decide: 'report',
} as const;

/** What stands in the page's place while the project record arrives: the title's shape, and the loader. */
function OpeningProject({ label }: { label: string }) {
  return (
    <div className="sw-opening" aria-busy="true">
      <Orbit size={32} label={label} />
      <div className="sw-opening__lines" aria-hidden="true">
        <Skeleton height="2.4rem" width="min(28rem, 70vw)" />
        <Skeleton height="1rem" width="min(20rem, 50vw)" />
      </div>
    </div>
  );
}

/**
 * Owns the engine's state (the projects, the open project, the operations) and turns it into the one
 * `Workspace` every scene reads. It decides which scene is in view from the address and from what the
 * project has done, and it keeps the address, the focus and the page title in step.
 */
export function Application() {
  const engine = useConsole();
  const provider = useProviderStatus();
  const theme = useTheme();
  const { mode, choose: chooseMode } = useMode();
  const route = useRoute();
  const toast = useToast();
  const main = useRef<HTMLElement>(null);

  const [panel, setPanel] = useState<PanelName | null>(null);
  const [palette, setPalette] = useState(false);
  const motionPreference = useMotionPreference();
  const [askSeed, setAskSeed] = useState<{ target?: string; message?: string }>({});
  const [creation, setCreation] = useState<{ key: number; project?: ProjectDetail }>({ key: 0 });
  const [quiet, setQuiet] = useState(false);

  const authentication = engine.config.data?.capabilities.authentication ?? 'local-single-user';
  const signedIn = authentication === 'entra-session';
  const workspaceRole = useWorkspaceRole(signedIn);
  const busy = Boolean(engine.operation);

  const project =
    engine.detail.id === engine.selectedId && engine.detail.data?.id === engine.selectedId
      ? engine.detail.data
      : null;
  const config = engine.config.error ? null : engine.config.data;

  // ---- Which scene is in view ------------------------------------------------------------------
  const requested = route.scene;
  const scene: SceneId = !engine.selectedId
    ? 'ask'
    : project && requested && requested !== 'ask' && sceneAvailable(project, requested)
      ? requested
      : project
        ? frontierScene(project)
        : 'ground';
  const view = route.scene === scene ? route.view : null;
  const journey = useMemo(() => sceneInfos(project, scene), [project, scene]);

  // The address says what is shown. A project opened without a scene is given the one it opens to, so that a reload
  // and a shared link land in the same place; one asked for a scene that is not open yet is shown where its work
  // has got to, and the address follows, so that it does not jump there later on its own.
  useEffect(() => {
    if (!project) return;
    const wanted = route.scene;
    if (!wanted || wanted === 'ask' || !sceneAvailable(project, wanted)) {
      navigate({ scene: frontierScene(project), view: null }, { replace: true });
    }
  }, [project, route.scene]);

  // The next scenes' code is fetched while the person is in this one.
  useEffect(() => {
    if (!project) return;
    for (const candidate of ['map', 'simulate', 'decide'] as const) {
      if (sceneAvailable(project, candidate)) preloadScene(candidate);
    }
  }, [project, scene]);

  // ---- Navigation -----------------------------------------------------------------------------------
  const newProject = useCallback(
    (initial?: ProjectDetail) => {
      if (busy) return;
      navigate({ scene: null, view: null }, { replace: true });
      engine.selectProject(null);
      setCreation((old) => ({ key: old.key + 1, project: initial }));
    },
    [busy, engine],
  );

  const openProject = useCallback(
    (id: string, target?: { scene?: ProjectScene; view?: string | null }) => {
      if (id === engine.selectedId) {
        if (target?.scene) navigate({ scene: target.scene, view: target.view ?? null });
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set('project', id);
      url.searchParams.delete('scene');
      url.searchParams.delete('view');
      if (target?.scene) url.searchParams.set('scene', target.scene);
      if (target?.view) url.searchParams.set('view', target.view);
      window.history.pushState({}, '', url);
      engine.selectProject(id);
    },
    [engine],
  );

  const go = useCallback<Workspace['go']>(
    (target, options) => {
      if (target === 'ask') {
        newProject();
        return;
      }
      if (!project) return;
      if (!sceneAvailable(project, target)) {
        const reason = sceneInfos(project, scene).find((step) => step.id === target)?.reason;
        toast({ title: reason ?? 'Not open yet', tone: 'info', duration: 2600 });
        return;
      }
      navigate({ scene: target, view: options?.view ?? null }, { replace: options?.replace });
    },
    [newProject, project, scene, toast],
  );

  // Back to the entry screen by the browser's Back button.
  useEffect(() => {
    const pop = () => setCreation((old) => ({ key: old.key + 1 }));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  // ---- Focus, scroll and title on a change of scene ---------------------------------------------
  // Opening a project is not a change of scene: while its record arrives the scene in view is a placeholder, and the
  // first real one is where the page loads, so a Tab then starts at the top (the skip link), as it does on any page.
  const shown = useRef<string | null>(null);
  const opened = !engine.selectedId || project !== null;
  useEffect(() => {
    if (!opened) return;
    const key = `${engine.selectedId ?? ''}|${scene}|${creation.key}`;
    if (shown.current === null) {
      shown.current = key;
      return;
    }
    if (shown.current === key) return;
    shown.current = key;
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [opened, scene, engine.selectedId, creation.key]);

  useEffect(() => {
    const name =
      project && scene !== 'ask'
        ? `${project.name} · ${scene[0]!.toUpperCase()}${scene.slice(1)}`
        : null;
    document.title = name ? `${name} | Swarm` : 'Swarm | Explore what could happen next';
  }, [project, scene]);

  // ---- Reading the project again ------------------------------------------------------------------
  useEffect(() => {
    if (!engine.detail.loading) setQuiet(false);
  }, [engine.detail.loading]);
  const readQuietly = useCallback(() => {
    setQuiet(true);
    engine.refresh();
  }, [engine]);
  const guided = Boolean(project?.console && project.workflow === 'guided');
  useLabRefresh({
    step: scene === 'ask' ? 'knowledge' : STEP_OF_SCENE[scene],
    enabled: guided,
    watch: project && scene !== 'ask' ? labWatch(project, STEP_OF_SCENE[scene]) : null,
    refresh: readQuietly,
  });

  // ---- Failures that were not confirmed ---------------------------------------------------------
  // A refused creation has no project yet and says so where the question is (the bar of the scenario); only what
  // went wrong with a project that is open is told here, once.
  const actionError =
    engine.actionError?.id && engine.actionError.id === engine.selectedId
      ? engine.actionError
      : null;
  useEffect(() => {
    if (!actionError) return;
    toast({
      title: 'That was not confirmed',
      description: `${actionError.message} What is saved has been read again.`,
      tone: 'error',
      action: { label: 'Dismiss', onPress: engine.dismissError },
    });
  }, [actionError, engine.dismissError, toast]);

  // ---- The workspace every scene reads --------------------------------------------------------------
  const panels = useMemo<PanelControls>(
    () => ({
      history: () => setPanel('history'),
      ask: (options) => {
        setAskSeed(options ?? {});
        setPanel('ask');
      },
      audit: () => setPanel('audit'),
      budget: () => setPanel('budget'),
      access: () => setPanel('access'),
      provider: () => {
        if (!provider.open) provider.toggle();
      },
      snapshot: () => undefined,
    }),
    [provider],
  );

  // `/` asks the analyst about what is on the screen, as the button in the bar says; never while typing, or over
  // something that is already open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))
      )
        return;
      if (!project || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      panels.ask();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, panels]);

  // Ctrl or ⌘ with K opens the palette from anywhere, also while typing, as it does in every tool that has one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !opensPalette(event)) return;
      event.preventDefault();
      setPalette((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const workspace = useMemo<Workspace | null>(() => {
    if (!project) return null;
    const refreshLoud = () => {
      setQuiet(false);
      engine.refresh();
      void engine.loadHistory();
    };
    return {
      project,
      config,
      mode,
      busy,
      refreshing: engine.detail.loading && !quiet,
      refresh: refreshLoud,
      run: (step) => engine.execute(project.id, step),
      cancel: () => engine.cancel(project.id),
      pause: async () => {
        await engine.pause(project.id);
      },
      resume: async () => {
        await engine.resume(project.id);
      },
      setIntervention: async (value) => {
        await engine.updateIntervention(project.id, value);
      },
      branch: async (input) => {
        await engine.branch(project.id, input);
      },
      saveEnvironment: async (input) => {
        await engine.saveEnvironment(project.id, input);
      },
      recordSurvey: (record) => engine.recordSurvey(project.id, record),
      duplicate: () => newProject(project),
      openProject,
      projects: engine.history.data?.projects ?? [],
      scene: scene === 'ask' ? 'ground' : scene,
      view,
      go,
      setView: (next) => navigate({ view: next }, { replace: true }),
      journey,
      sharing: signedIn,
      panels,
    };
  }, [
    project,
    config,
    mode,
    busy,
    engine,
    quiet,
    newProject,
    openProject,
    scene,
    view,
    go,
    journey,
    signedIn,
    panels,
  ]);

  const recentProjects = engine.history.data?.projects;
  const commands = useMemo(
    () =>
      buildCommands({
        journey: project ? journey : null,
        go,
        newQuestion: () => newProject(),
        history: () => setPanel('history'),
        provider: panels.provider,
        project:
          project && workspace
            ? {
                ask: () => panels.ask(),
                refresh: workspace.refresh,
                duplicate: busy ? null : workspace.duplicate,
                audit: panels.audit,
                budget: project.mode === 'llm' ? panels.budget : null,
                access: signedIn ? panels.access : null,
              }
            : null,
        theme: { value: theme.preference, set: theme.choose },
        motion: { value: motionPreference, set: setMotionPreference },
        mode: { value: mode, set: chooseMode },
        recent: (recentProjects ?? [])
          .filter((entry) => entry.id !== engine.selectedId)
          .slice(0, 6)
          .map(({ id, name }) => ({ id, name })),
        openProject: (id) => openProject(id),
      }),
    [
      busy,
      chooseMode,
      engine.selectedId,
      go,
      journey,
      mode,
      motionPreference,
      newProject,
      openProject,
      panels,
      project,
      recentProjects,
      signedIn,
      theme.choose,
      theme.preference,
      workspace,
    ],
  );

  const signOut = async () => {
    try {
      await api.signOut();
      window.location.assign('/');
    } catch (failure) {
      toast({
        title: 'Could not sign out',
        description: `${errorMessage(failure)} You are still signed in.`,
        tone: 'error',
      });
    }
  };

  const version = engine.config.data?.version ?? null;
  const source = sourceLink(engine.config.data?.sourceUrl);
  const account = {
    label:
      authentication === 'local-single-user'
        ? 'Local · single user'
        : 'Signed in · Microsoft Entra',
    onPeople: signedIn && administersWorkspace(workspaceRole) ? () => setPanel('people') : null,
    onSignOut: signedIn ? () => void signOut() : null,
  };

  const menuProps = {
    theme: theme.preference,
    onTheme: theme.choose,
    mode,
    onMode: chooseMode,
    onPalette: () => setPalette(true),
    account,
    version,
    sourceUrl: source,
  };

  const statusChip = (
    <ProviderStatus
      state={provider.state}
      open={provider.open}
      onOpenChange={(next) => {
        if (next === provider.open) return;
        if (next) provider.toggle();
        else provider.close(true);
      }}
      onVerify={() => void provider.verify()}
      onRetry={() => void provider.retry()}
    />
  );

  return (
    <AppShell
      scene={scene}
      mainRef={main}
      bar={
        <TopBar
          steps={journey}
          scene={scene}
          hasProject={Boolean(project) || (Boolean(engine.selectedId) && !engine.detail.error)}
          onGo={go}
          onHome={() => newProject()}
          homeDisabled={busy}
          historyTotal={engine.history.data?.total ?? null}
          onHistory={() => setPanel('history')}
          onAsk={() => panels.ask()}
          onPalette={() => setPalette(true)}
          status={statusChip}
          menu={
            project && workspace ? (
              <ProjectMenu
                project={project}
                workspace={workspace}
                {...menuProps}
                budget={project.mode === 'llm'}
              />
            ) : (
              <SettingsMenu {...menuProps} project={null} />
            )
          }
        />
      }
      dock={project ? <Dock steps={journey} onGo={go} /> : null}
    >
      {engine.config.error && !engine.selectedId && (
        <div className="sw-banner">
          <Notice
            tone="error"
            title="The server's settings could not be read"
            action={
              <Button
                size="sm"
                variant="glass"
                busy={engine.config.loading}
                onClick={() => void engine.loadConfig()}
              >
                Retry
              </Button>
            }
          >
            Starting a question and model assistance wait until they can.
          </Notice>
        </div>
      )}
      {engine.selectedId ? (
        <>
          {engine.detail.error && (
            <div className="sw-banner">
              <Notice
                tone="error"
                title={
                  project
                    ? 'Could not refresh this exploration'
                    : 'This exploration could not be opened'
                }
                action={
                  <span className="sw-banner__actions">
                    <Button
                      size="sm"
                      variant="glass"
                      busy={engine.detail.loading}
                      onClick={engine.refresh}
                    >
                      Retry
                    </Button>
                    {!project && (
                      <Button size="sm" variant="ghost" onClick={() => newProject()}>
                        Start a new question
                      </Button>
                    )}
                  </span>
                }
              >
                {project
                  ? 'Showing what was last loaded. Updates have paused.'
                  : `${engine.detail.error} Retry, open another from the history, or start again.`}
              </Notice>
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            {project && workspace ? (
              <WorkspaceContext.Provider value={workspace} key={project.id}>
                <m.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {project.mode === 'llm' && (
                    <BudgetGuard project={project} onOpen={() => setPanel('budget')} />
                  )}
                  <SceneHost scene={(isProjectScene(scene) ? scene : 'ground') as ProjectScene} />
                </m.div>
              </WorkspaceContext.Provider>
            ) : engine.detail.loading || !engine.detail.error ? (
              <m.div key="opening" exit={{ opacity: 0 }}>
                <OpeningProject label="Opening" />
              </m.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : (
        <AskScene
          key={creation.key}
          config={config}
          connectivity={provider.state.status?.connectivity ?? null}
          initialProject={creation.project}
          busy={busy}
          onSubmit={engine.create}
          history={{
            projects: engine.history.data?.projects ?? null,
            loading: engine.history.loading,
            error: engine.history.error,
          }}
          onOpenProject={openProject}
          onRetryHistory={() => void engine.loadHistory()}
          onHistory={() => setPanel('history')}
          mode={mode}
        />
      )}
      <CommandPalette open={palette} onOpenChange={setPalette} commands={commands} />
      <PanelHost
        panel={panel}
        onClose={() => setPanel(null)}
        engine={engine}
        project={project}
        config={config}
        workspaceRole={workspaceRole}
        askSeed={askSeed}
        onOpenProject={openProject}
        onSurvey={(record) => project && engine.recordSurvey(project.id, record)}
        onDeepDive={
          project && sceneAvailable(project, 'simulate')
            ? () => go('simulate', { view: 'deep' })
            : null
        }
      />
    </AppShell>
  );
}

/** The settings menu for an open project: it owns the snapshot download, which belongs to one project. */
function ProjectMenu({
  project,
  workspace,
  budget,
  ...rest
}: Omit<Parameters<typeof SettingsMenu>[0], 'project'> & {
  project: ProjectDetail;
  workspace: Workspace;
  budget: boolean;
}) {
  const snapshot = useJsonSnapshotExport(project.id);
  const toast = useToast();
  useEffect(() => {
    if (snapshot.error)
      toast({ title: 'Could not export', description: snapshot.error, tone: 'error' });
  }, [snapshot.error, toast]);
  return (
    <SettingsMenu
      {...rest}
      project={{
        onRefresh: workspace.refresh,
        onAudit: workspace.panels.audit,
        onDuplicate: workspace.duplicate,
        onSnapshot: () => void snapshot.download(),
        onBudget: budget ? workspace.panels.budget : null,
        onAccess: workspace.sharing ? workspace.panels.access : null,
        busy: workspace.busy,
      }}
    />
  );
}
