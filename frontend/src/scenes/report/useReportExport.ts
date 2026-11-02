import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api';
import { useToast } from '../../design/ui';
import { saveBlob } from '../../lib/download';

export type ExportFormat = 'markdown' | 'json';

const FILE: Record<ExportFormat, { extension: string; done: string }> = {
  markdown: { extension: 'md', done: 'Markdown exported' },
  json: { extension: 'json', done: 'Snapshot exported' },
};

/**
 * Downloads the report as the server writes it. One download at a time; leaving the page stops the request, and
 * a failure says what happened and that the report is as it was.
 */
export function useReportExport(projectId: string): {
  pending: ExportFormat | null;
  download: (format: ExportFormat) => Promise<void>;
} {
  const toast = useToast();
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const download = useCallback(
    async (format: ExportFormat) => {
      if (request.current && pending) return;
      const controller = new AbortController();
      request.current = controller;
      setPending(format);
      try {
        const blob = await api.export(projectId, format, controller.signal);
        if (controller.signal.aborted) return;
        saveBlob(blob, `swarm-lab-${projectId}.${FILE[format].extension}`);
        toast({ title: FILE[format].done, tone: 'success', duration: 3200 });
      } catch (failure) {
        if (!controller.signal.aborted) {
          toast({
            title: 'The export failed',
            description: `${errorMessage(failure)} The report is as it was.`,
            tone: 'error',
          });
        }
      } finally {
        if (!controller.signal.aborted) setPending(null);
      }
    },
    [pending, projectId, toast],
  );
  return { pending, download };
}
