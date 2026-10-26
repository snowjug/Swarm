import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppConfig,
  CreateProjectInput,
  ProjectDetail,
  ProjectSummary,
} from '../../../shared/types';
import { api, errorMessage, isAbort } from '../api';
import { isActive } from '../lib/format';

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface DetailResource extends Resource<ProjectDetail> {
  id: string | null;
}

export type Mutation = { kind: 'create' | 'run' | 'cancel' | 'delete'; id: string | null };

const urlSelection = () => new URL(window.location.href).searchParams.get('project') || null;

export function useWorkbench() {
  const [selectedId, setSelectedId] = useState<string | null>(urlSelection);
  const selectedRef = useRef(selectedId);
  const navigationVersion = useRef(0);
  const alive = useRef(true);
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
  const [detail, setDetail] = useState<DetailResource>({
    id: selectedId,
    data: null,
    loading: Boolean(selectedId),
    error: null,
  });
  const [revision, setRevision] = useState(0);
  const [mutation, setMutation] = useState<Mutation | null>(null);
  const mutationRef = useRef<Mutation | null>(null);
  const [actionError, setActionError] = useState<{ id: string | null; message: string } | null>(
    null,
  );
  const detailSession = useRef<{ stop: () => void } | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const configController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);

  const loadConfig = useCallback(async () => {
    configController.current?.abort();
    const controller = new AbortController();
    configController.current = controller;
    setConfig((old) => ({ ...old, loading: true, error: null }));
    try {
      const data = await api.config(controller.signal);
      if (!controller.signal.aborted && alive.current) {
        setConfig({ data, loading: false, error: null });
      }
    } catch (error) {
      if (!controller.signal.aborted && alive.current) {
        setConfig((old) => ({ ...old, loading: false, error: errorMessage(error) }));
      }
    }
  }, []);

  const loadHistory = useCallback(async () => {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    setHistory((old) => ({ ...old, loading: true, error: null }));
    try {
      const data = await api.projects(controller.signal);
      if (!controller.signal.aborted && alive.current) {
        setHistory({ data, loading: false, error: null });
      }
    } catch (error) {
      if (!controller.signal.aborted && alive.current) {
        setHistory((old) => ({ ...old, loading: false, error: errorMessage(error) }));
      }
    }
  }, []);

  const selectProject = useCallback((id: string | null) => {
    navigationVersion.current += 1;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    if (url.href !== window.location.href) window.history.pushState({}, '', url);
    selectedRef.current = id;
    setSelectedId(id);
    setActionError(null);
  }, []);

  const refreshProject = useCallback(() => setRevision((value) => value + 1), []);
  const dismissActionError = useCallback(() => setActionError(null), []);

  useEffect(() => {
    alive.current = true;
    void loadConfig();
    void loadHistory();
    const onPop = () => {
      navigationVersion.current += 1;
      const id = urlSelection();
      selectedRef.current = id;
      setSelectedId(id);
      setActionError(null);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      alive.current = false;
      configController.current?.abort();
      historyController.current?.abort();
      mutationController.current?.abort();
      detailSession.current?.stop();
      window.removeEventListener('popstate', onPop);
    };
  }, [loadConfig, loadHistory]);

  useEffect(() => {
    detailSession.current?.stop();
    if (!selectedId) {
      setDetail({ id: null, data: null, loading: false, error: null });
      return;
    }
    if (mutationRef.current?.id === selectedId) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousStatus: string | undefined;
    const stop = () => {
      disposed = true;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
    detailSession.current = { stop };
    setDetail((old) => ({
      id: selectedId,
      data: old.id === selectedId ? old.data : null,
      loading: true,
      error: null,
    }));
    const fetchProject = async () => {
      controller = new AbortController();
      try {
        const data = await api.project(selectedId, controller.signal);
        if (disposed) return;
        setDetail({ id: selectedId, data, loading: false, error: null });
        if (previousStatus && previousStatus !== data.status) void loadHistory();
        previousStatus = data.status;
        if (isActive(data.status)) timer = setTimeout(() => void fetchProject(), 1_800);
      } catch (error) {
        if (disposed || isAbort(error)) return;
        setDetail((old) => ({
          ...old,
          loading: false,
          error: errorMessage(error),
        }));
      }
    };
    void fetchProject();
    return stop;
  }, [selectedId, revision, loadHistory]);

  const putProject = useCallback((project: ProjectDetail) => {
    if (!alive.current) return;
    if (selectedRef.current === project.id) {
      setDetail({ id: project.id, data: project, loading: false, error: null });
    }
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

  const beginMutation = (value: Mutation) => {
    if (mutationRef.current) throw new Error('Another project operation is still in progress.');
    const controller = new AbortController();
    mutationController.current = controller;
    mutationRef.current = value;
    setMutation(value);
    setActionError(null);
    detailSession.current?.stop();
    return controller;
  };

  const finishMutation = () => {
    mutationRef.current = null;
    if (alive.current) {
      setMutation(null);
      refreshProject();
      void loadHistory();
    }
  };

  const createProject = async (input: CreateProjectInput, start: boolean) => {
    const startedAtNavigation = navigationVersion.current;
    const controller = beginMutation({ kind: 'create', id: null });
    let draft: ProjectDetail | null = null;
    try {
      draft = await api.create(input, controller.signal);
      if (!alive.current) return;
      mutationRef.current = { kind: 'create', id: draft.id };
      setMutation(mutationRef.current);
      if (navigationVersion.current === startedAtNavigation) selectProject(draft.id);
      putProject(draft);
      if (start) {
        try {
          const running = await api.run(draft.id, controller.signal);
          putProject(running);
        } catch (error) {
          if (!controller.signal.aborted && alive.current) {
            setActionError({
              id: draft.id,
              message: `Your draft was saved, but the start request was not confirmed. ${errorMessage(error)}`,
            });
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      finishMutation();
    }
  };

  const actOnProject = async (kind: 'run' | 'cancel' | 'delete', id: string) => {
    if (mutationRef.current) return false;
    const controller = beginMutation({ kind, id });
    try {
      if (kind === 'delete') {
        await api.remove(id, controller.signal);
        if (alive.current && selectedRef.current === id) selectProject(null);
      } else {
        const project =
          kind === 'run'
            ? await api.run(id, controller.signal)
            : await api.cancel(id, controller.signal);
        putProject(project);
      }
      return true;
    } catch (error) {
      if (!controller.signal.aborted && alive.current) {
        setActionError({ id, message: errorMessage(error) });
      }
      return false;
    } finally {
      finishMutation();
    }
  };

  return {
    selectedId,
    selectProject,
    config,
    history,
    detail: detail.id === selectedId ? detail : { ...detail, data: null, loading: true },
    mutation,
    actionError,
    dismissActionError,
    loadConfig,
    loadHistory,
    refreshProject,
    createProject,
    actOnProject,
  };
}
