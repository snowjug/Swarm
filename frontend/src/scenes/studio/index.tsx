import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, OctagonAlert } from 'lucide-react';
import { useWorkspace } from '../../app/context';
import { Button, EmptyState, Notice } from '../../design/ui';
import { useStudio } from '../../hooks/useStudio';
import { resolveReport } from '../report/model';
import { useStudioActions } from './actions';
import { NoReport } from './NoReport';
import { Opening } from './Opening';
import { studioTitle } from './model';
import { StudioSkeleton } from './Skeleton';
import { Workbench } from './Workbench';
import './Studio.css';

/**
 * Report Studio: where a person works on the generated report as a document. They read it section by section
 * with the statements the server checked, change the text (every change a new version), ask for a chapter to
 * be written again, send the report for review, and a reviewer approves it or sends it back. The generated
 * report itself is never changed.
 */
export default function StudioScene() {
  const { project, setView, panels } = useWorkspace();
  const studio = useStudio(project.id);
  const { view, reload, pending } = studio;
  const [announcement, setAnnouncement] = useState('');
  const say = useCallback((message: string) => setAnnouncement(message), []);
  const document = view?.document ?? null;
  const actions = useStudioActions({ projectId: project.id, studio, document, say });

  // Someone else may have worked on the report while this tab was elsewhere: read it again on return, at
  // most every half minute, and never while a change of ours is on its way.
  const working = useRef(false);
  working.current = pending !== null;
  useEffect(() => {
    let last = Date.now();
    const back = () => {
      if (window.document.visibilityState !== 'visible' || working.current) return;
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      reload();
    };
    window.addEventListener('focus', back);
    window.document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      window.document.removeEventListener('visibilitychange', back);
    };
  }, [reload]);

  const leave = useCallback(() => setView(null), [setView]);
  const toReport = useCallback(() => setView('report'), [setView]);

  // A report that is finished while this page waits for it makes what the studio read before out of date: read it
  // again, say so, and let the page it opens on take the reader's place.
  const written = resolveReport(project).kind === 'complete';
  const wasWritten = useRef(written);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (written && !wasWritten.current) {
      setArrived(true);
      say('The detailed report is written. It can be opened in the studio.');
      reload();
    }
    wasWritten.current = written;
  }, [written, reload, say]);

  return (
    <section className="sw-studio" aria-label="Report studio">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {!view && studio.loading && <StudioSkeleton title={studioTitle(project.report)} />}

      {!view && !studio.loading && studio.loadError && (
        <div className="sw-open sw-open--empty">
          <div className="sw-open__main">
            <Button
              variant="ghost"
              size="sm"
              className="sw-open__back"
              icon={<ArrowLeft size={16} aria-hidden="true" />}
              onClick={leave}
            >
              Back to the brief
            </Button>
          </div>
          <EmptyState
            icon={<OctagonAlert size={22} aria-hidden="true" />}
            title="The report studio could not be loaded"
            level={1}
            action={
              <Button variant="glass" busy={studio.loading} onClick={reload}>
                Try again
              </Button>
            }
          >
            {studio.loadError}
          </EmptyState>
        </div>
      )}

      {view && studio.loadError && (
        <Notice
          tone="caution"
          title="Could not read the latest"
          action={
            <Button size="sm" variant="glass" busy={studio.loading} onClick={reload}>
              Retry
            </Button>
          }
        >
          Showing what was loaded last. {studio.loadError}
        </Notice>
      )}

      {view && !document && !view.reportReady && <NoReport view={view} onBack={leave} />}

      {view && !document && view.reportReady && (
        <Opening
          view={view}
          report={project.report}
          actions={actions}
          onBack={leave}
          onReport={toReport}
          arrived={arrived}
        />
      )}

      {view && document && (
        <Workbench
          projectId={project.id}
          view={view}
          document={document}
          studio={studio}
          actions={actions}
          onBack={leave}
          onReport={project.report ? toReport : null}
          onAudit={panels.audit}
        />
      )}
    </section>
  );
}
