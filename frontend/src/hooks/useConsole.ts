import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BranchInput,
  EnvironmentUpdate,
  ExecutionStep,
  SurveyRecord,
} from '../../../shared/guided';
import type {
  AppConfig,
  CreateProjectInput,
  Intervention,
  ProjectDetail,
  ProjectSummary,
} from '../../../shared/types';
import { api, ApiError, errorMessage } from '../api';
import { researchApi } from '../api/research';
import { keepLab, needsPolling } from '../lib/console';
import { rememberIntake } from '../lib/research';

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

type Operation =
  | 'create'
  | 'cancel'
  | 'pause'
  | 'resume'
  | 'branch'
  | 'intervention'
  | 'delete'
  | 'environment-save'
  | ExecutionStep;
const selection = () => new URL(window.location.href).searchParams.get('project');

export function useConsole() {
  const [selectedId, setSelectedId] = useState<string | null>(selection);
  const selected = useRef(selectedId);
  const alive = useRef(true);
  const navigation = useRef(0);
  const [config, setConfig] = useState<Resource<AppConfig>>({
    data: null,
    loading: true,
    error: null,
  });
  const [history, setHistory] = useState<Resource<{ projects: ProjectSummary[]; total: number }>>({
    data: null,
    loading: true,
    error: null,
  });
  const [detail, setDetail] = useState<Resource<ProjectDetail> & { id: string | null }>({
    id: selectedId,
    data: null,
    loading: Boolean(selectedId),
    error: null,
  });
  const [revision, setRevision] = useState(0);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [actionError, setActionError] = useState<{ id: string | null; message: string } | null>(
    null,
  );
  const configRequest = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const detailSession = useRef<(() => void) | null>(null);

  const loadConfig = useCallback(async () => {
    configRequest.current?.abort();
    const controller = new AbortController();
    configRequest.current = controller;
    setConfig((old) => ({ ...old, loading: true, error: null }));
    try {
      const data = await api.config(controller.signal);
      if (!controller.signal.aborted && alive.current)
        setConfig({ data, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted && alive.current)
        setConfig((old) => ({ ...old, loading: false, error: errorMessage(error) }));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistory((old) => ({ ...old, loading: true, error: null }));
    try {
      const data = await api.projects(controller.signal);
      if (!controller.signal.aborted && alive.current)
        setHistory({ data, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted && alive.current)
        setHistory((old) => ({ ...old, loading: false, error: errorMessage(error) }));
    }
  }, []);

  const selectProject = useCallback((id: string | null) => {
    if (selected.current === id) {
      setActionError(null);
      return;
    }
    navigation.current += 1;
    detailSession.current?.();
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    if (url.href !== window.location.href) window.history.pushState({}, '', url);
    selected.current = id;
    setSelectedId(id);
    setActionError(null);
  }, []);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    alive.current = true;
    void loadConfig();
    void loadHistory();
    const pop = () => {
      navigation.current += 1;
      const next = selection();
      if (selected.current !== next) {
        detailSession.current?.();
        selected.current = next;
        setSelectedId(next);
      }
      setActionError(null);
    };
    window.addEventListener('popstate', pop);
    return () => {
      alive.current = false;
      configRequest.current?.abort();
      historyRequest.current?.abort();
      mutation.current?.abort();
      detailSession.current?.();
      window.removeEventListener('popstate', pop);
    };
  }, [loadConfig, loadHistory]);

  useEffect(() => {
    detailSession.current?.();
    if (!selectedId) {
      setDetail({ id: null, data: null, loading: false, error: null });
      return;
    }
    if (mutation.current) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastStatus: string | undefined;
    const stop = () => {
      disposed = true;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
    detailSession.current = stop;
    setDetail((old) => ({
      id: selectedId,
      data: old.id === selectedId ? old.data : null,
      loading: true,
      error: null,
    }));
    const fetchDetail = async () => {
      controller = new AbortController();
      try {
        const data = await api.project(selectedId, controller.signal);
        if (disposed) return;
        setDetail({ id: selectedId, data, loading: false, error: null });
        if (lastStatus && lastStatus !== data.status) void loadHistory();
        lastStatus = data.status;
        if (needsPolling(data)) timer = setTimeout(() => void fetchDetail(), 1_800);
      } catch (error) {
        if (!disposed) {
          setDetail((old) => ({ ...old, loading: false, error: errorMessage(error) }));
        }
      }
    };
    void fetchDetail();
    return stop;
  }, [selectedId, revision, loadHistory]);

  const put = useCallback((project: ProjectDetail) => {
    if (!alive.current) return;
    if (selected.current === project.id)
      setDetail((old) => ({
        id: project.id,
        data: keepLab(project, old.id === project.id ? old.data : null),
        loading: false,
        error: null,
      }));
    setHistory((old) => {
      if (!old.data) return old;
      const existed = old.data.projects.some((item) => item.id === project.id);
      return {
        ...old,
        data: {
          total: old.data.total + (existed ? 0 : 1),
          projects: [project, ...old.data.projects.filter((item) => item.id !== project.id)]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 100),
        },
      };
    });
  }, []);

  const perform = async (
    kind: Operation,
    id: string | null,
    action: (signal: AbortSignal) => Promise<ProjectDetail | void>,
  ) => {
    if (mutation.current) throw new Error('Another operation is still awaiting a response.');
    const controller = new AbortController();
    mutation.current = controller;
    setOperation(kind);
    setActionError(null);
    detailSession.current?.();
    try {
      const result = await action(controller.signal);
      if (!controller.signal.aborted && result) put(result);
      return result;
    } catch (error) {
      if (!controller.signal.aborted && alive.current) {
        setActionError({ id, message: errorMessage(error) });
        throw error;
      }
    } finally {
      mutation.current = null;
      if (alive.current) {
        setOperation(null);
        refresh();
        void loadHistory();
      }
    }
  };

  const create = async (input: CreateProjectInput) => {
    const version = navigation.current;
    await perform('create', null, async (signal) => {
      const project = await api.create({ ...input, workflow: 'guided' }, signal);
      if (signal.aborted) return;
      put(project);
      rememberIntake(project.id, input.research);
      // A question with no source of its own is made from what research finds: its research is what starts, and the
      // run exists by the time the page that shows it opens.
      if (input.documents.length === 0 && input.research?.auto === true) {
        let failure: unknown = null;
        try {
          await researchApi.start(project.id, { intake: input.research }, signal);
        } catch (error) {
          // A run that is already under way is the one that was asked for.
          if (!(error instanceof ApiError && error.code === 'RESEARCH_ACTIVE')) failure = error;
        }
        if (signal.aborted) return;
        if (version === navigation.current) selectProject(project.id);
        if (failure !== null && alive.current) {
          setActionError({
            id: project.id,
            message: `The exploration was saved, but Swarm could not start researching. ${errorMessage(failure)} Open Ground and press “Start research” to try again.`,
          });
        }
        return project;
      }
      if (version === navigation.current) selectProject(project.id);
      try {
        return await api.step(project.id, 'knowledge', signal);
      } catch (error) {
        if (!signal.aborted && alive.current) {
          setActionError({
            id: project.id,
            message: `The exploration was saved, but Swarm could not start reading its evidence. ${errorMessage(error)} Open Ground and press “Ground it” to try again.`,
          });
        }
        return project;
      }
    });
  };

  const execute = (id: string, step: ExecutionStep) =>
    perform(step, id, (signal) => api.step(id, step, signal));
  const cancel = (id: string) => perform('cancel', id, (signal) => api.cancel(id, signal));
  const pause = (id: string) => perform('pause', id, (signal) => api.pause(id, signal));
  const resume = (id: string) => perform('resume', id, (signal) => api.resume(id, signal));
  const updateIntervention = (id: string, input: Intervention | null) =>
    perform('intervention', id, (signal) => api.intervention(id, input, signal));
  const branch = (id: string, input: BranchInput) => {
    const version = navigation.current;
    return perform('branch', id, async (signal) => {
      const result = await api.branch(id, input, signal);
      if (!signal.aborted && version === navigation.current) selectProject(result.id);
      return result;
    });
  };
  const saveEnvironment = (id: string, input: EnvironmentUpdate) =>
    perform('environment-save', id, (signal) => api.environment(id, input, signal));
  const remove = async (id: string) => {
    await perform('delete', id, async (signal) => {
      await api.remove(id, signal);
      if (selected.current === id) selectProject(null);
    });
  };
  const recordSurvey = (id: string, survey: SurveyRecord) => {
    setDetail((old) => {
      if (old.id !== id || !old.data?.console) return old;
      return {
        ...old,
        data: {
          ...old.data,
          console: {
            ...old.data.console,
            surveys: [...old.data.console.surveys.filter((item) => item.id !== survey.id), survey],
          },
        },
      };
    });
    refresh();
  };

  // The same function on every draw: it is a dependency of what tells the person, which must not run again for it.
  const dismissError = useCallback(() => setActionError(null), []);

  return {
    selectedId,
    config,
    history,
    detail,
    operation,
    actionError,
    selectProject,
    loadConfig,
    loadHistory,
    refresh,
    create,
    execute,
    cancel,
    pause,
    resume,
    updateIntervention,
    branch,
    saveEnvironment,
    remove,
    recordSurvey,
    dismissError,
  };
}
