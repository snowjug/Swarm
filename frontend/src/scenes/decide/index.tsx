import type { ReactNode } from 'react';
import { useWorkspace } from '../../app/context';
import { useBrief } from '../../hooks/useBrief';
import { useCritiques } from '../../hooks/useCritiques';
import { DecideDocument } from './DecideDocument';
import { BriefFailed, BriefLoading, NoAnalysis, WriteBrief, Writing } from './States';
import { SubScene } from './SubScene';
import { useBriefAnalysis } from './hooks';

/** The page the states stand on: the same width and margins as the brief, so that the screen does not jump between them. */
function Page({ children }: { children: ReactNode }) {
  return <div className="sw-decide sw-decide--state">{children}</div>;
}

/**
 * The brief of one project, in whatever state it is in: being read, not yet written, being written, written
 * and current, written and out of date. The shell reads the project; this reads the brief, the review beside
 * it and the analysis they are made from, and decides what to show.
 */
function Brief() {
  const { project, mode, view, setView, go } = useWorkspace();
  // The project's own timestamp does not move when a review, a stakeholder or a comparison changes, so the
  // lab's record is read with it.
  const token = `${project.updatedAt}|${JSON.stringify(project.lab ?? null)}`;
  const handle = useBrief(project.id, token);
  const review = useCritiques(project.id, { refreshOn: token, onChanged: handle.reload });
  const analysis = useBriefAnalysis(project.id, handle.view?.brief?.analysisId ?? null);
  const hasReport = project.report !== null;
  const toReport = hasReport ? () => go('decide', { view: 'report' }) : null;

  const loaded = handle.view;
  if (!loaded) {
    return (
      <Page>
        {handle.loading ? (
          <BriefLoading />
        ) : (
          <BriefFailed
            message={handle.error ?? 'Reload the page and try again.'}
            onRetry={handle.reload}
            busy={handle.loading}
          />
        )}
      </Page>
    );
  }
  if (loaded.brief) {
    return (
      <DecideDocument
        project={project}
        mode={mode}
        view={{ ...loaded, brief: loaded.brief }}
        handle={handle}
        review={review}
        analysis={analysis}
        reviewOpen={view === 'review'}
        onReviewOpenChange={(open) => setView(open ? 'review' : null)}
        hasReport={hasReport}
        go={{
          simulate: () => go('simulate'),
          studio: () => go('decide', { view: 'studio' }),
          report: () => go('decide', { view: 'report' }),
        }}
      />
    );
  }
  if (handle.generating)
    return (
      <Page>
        <Writing />
      </Page>
    );
  if (!loaded.latestAnalysis)
    return (
      <Page>
        <NoAnalysis onSimulate={() => go('simulate')} onReport={toReport} />
      </Page>
    );
  return (
    <Page>
      <WriteBrief
        completedAt={loaded.latestAnalysis.completedAt}
        may={loaded.may.generate}
        busy={handle.generating}
        error={handle.generateError}
        onWrite={() => void handle.generate()}
        onRetry={() => void handle.generate()}
      />
    </Page>
  );
}

/** The decision brief: what to do about it. */
export default function DecideScene() {
  const { project, view } = useWorkspace();
  if (view === 'studio' || view === 'report') return <SubScene name={view} />;
  return <Brief key={project.id} />;
}
