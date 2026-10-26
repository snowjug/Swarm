import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { ProjectDetail } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { Notice, Spinner } from '../ui';

export function ReportExport({ project }: { project: ProjectDetail }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      request.current?.abort();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  const download = async () => {
    if (pending || project.status !== 'completed' || !project.report) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const blob = await api.export(project.id, 'markdown', controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `swarm-lab-${project.id}.md`;
      document.body.append(link);
      link.click();
      link.remove();
      requestAnimationFrame(() => {
        URL.revokeObjectURL(url);
        urls.current = urls.current.filter((item) => item !== url);
      });
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  return (
    <div className="report-export">
      <button
        className="button button-secondary button-small"
        type="button"
        disabled={pending || project.status !== 'completed' || !project.report}
        onClick={() => void download()}
      >
        {pending ? <Spinner label="Downloading report" /> : <Download size={14} />} Export Markdown
      </button>
      {project.status !== 'completed' && (
        <small className="muted">Export unlocks when the report completes.</small>
      )}
      {error && (
        <Notice tone="error" title="Export failed">
          {error} Try the download again.
        </Notice>
      )}
    </div>
  );
}
