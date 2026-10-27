import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';

export interface JsonSnapshotExportState {
  pending: boolean;
  error: string | null;
}

export function createJsonSnapshotExport(
  projectId: string,
  onState: (state: JsonSnapshotExportState) => void,
) {
  let request: AbortController | null = null;
  let disposed = false;
  const urls = new Set<string>();
  const frames = new Map<number, string>();
  const release = (url: string) => {
    if (urls.delete(url)) URL.revokeObjectURL(url);
  };
  const releaseAfterClick = (url: string) => {
    const frame = requestAnimationFrame(() => {
      frames.delete(frame);
      release(url);
    });
    frames.set(frame, url);
  };
  const download = async () => {
    if (disposed || request) return;
    const controller = new AbortController();
    request = controller;
    onState({ pending: true, error: null });
    let error: string | null = null;
    try {
      const blob = await api.export(projectId, 'json', controller.signal);
      if (disposed || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urls.add(url);
      let link: HTMLAnchorElement | null = null;
      try {
        link = document.createElement('a');
        link.href = url;
        link.download = `swarm-lab-${projectId}.json`;
        document.body.append(link);
        link.click();
      } finally {
        link?.remove();
        releaseAfterClick(url);
      }
    } catch (failure) {
      if (!disposed && !controller.signal.aborted) error = errorMessage(failure);
    } finally {
      if (request === controller) request = null;
      if (!disposed && !controller.signal.aborted) onState({ pending: false, error });
    }
  };
  return {
    projectId,
    download,
    dispose: () => {
      disposed = true;
      request?.abort();
      frames.forEach((_, frame) => cancelAnimationFrame(frame));
      frames.clear();
      [...urls].forEach(release);
    },
  };
}

export function useJsonSnapshotExport(projectId: string) {
  const [state, setState] = useState<JsonSnapshotExportState & { projectId: string }>({
    projectId,
    pending: false,
    error: null,
  });
  const exporter = useRef<ReturnType<typeof createJsonSnapshotExport> | null>(null);
  const getExporter = useCallback(() => {
    if (exporter.current?.projectId !== projectId) {
      exporter.current?.dispose();
      exporter.current = createJsonSnapshotExport(projectId, (next) =>
        setState({ ...next, projectId }),
      );
    }
    return exporter.current;
  }, [projectId]);
  useEffect(() => {
    const current = getExporter();
    return () => {
      current.dispose();
      if (exporter.current === current) exporter.current = null;
    };
  }, [getExporter]);
  return {
    pending: state.projectId === projectId && state.pending,
    error: state.projectId === projectId ? state.error : null,
    download: () => getExporter().download(),
  };
}
