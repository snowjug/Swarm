import { useEffect, useState, type ReactNode } from 'react';
import { useWorkspace } from '../../app/context';
import { useBrief } from '../../hooks/useBrief';
import { useCritiques } from '../../hooks/useCritiques';
import { useDecision } from '../../hooks/useDecision';
import { ReportBridge } from './canvas/Bridge';
import { DecisionCanvasView } from './canvas/Canvas';
import { DecideDocument } from './DecideDocument';
import { BriefFailed, BriefLoading, WriteBrief, Writing } from './States';
import { SubScene } from './SubScene';
import { useBriefAnalysis } from './hooks';

/** The page the states stand on: the same width and margins as the brief, so that the screen does not jump between them. */
function Page({ children }: { children: ReactNode }) {
  return <div className="sw-decide sw-decide--state">{children}</div>;
}

/**
 * The decision of one project, in whatever state it is in. The decision view stands first in every one of them:
 * it is read on its own, from the newest finished comparison, and says what it can and cannot say when there is
 * none. Beneath it is the full report, the brief, which is being read, not yet written, being written, written
 * and current, or written and out of date. The shell reads the project; this reads the view, the brief, the
 * review beside it and the analysis they are made from, and decides what to show.
 */
function Brief() {
  const { project, mode, view, setView, go } = useWorkspace();
  // The project's own timestamp does not move when a review, a stakeholder or a comparison changes, so the
  // lab's record is read with it.
  const token = `${project.updatedAt}|${JSON.stringify(project.lab ?? null)}`;
  const handle = useBrief(project.id, token);
  const decision = useDecision(project.id, token);
  const review = useCritiques(project.id, {
    refreshOn: token,
    onChanged: () => {
      handle.reload();
      decision.reload();
    },
  });
  const analysis = useBriefAnalysis(project.id, handle.view?.brief?.analysisId ?? null);
  const hasReport = project.report !== null;
  const toReport = hasReport ? () => go('decide', { view: 'report' }) : null;
  // A brief that appears because it was just written is announced and takes the reader's place; one that was
  // there when the page opened is not.
  const [written, setWritten] = useState(false);
  const loaded = handle.view;
  const writing = handle.generating && !loaded?.brief;
  useEffect(() => {
    if (writing) setWritten(true);
  }, [writing]);

  const canvas = (below: boolean) => (
    <DecisionCanvasView
      handle={decision}
      go={{
        ask: () => go('ask'),
        ground: () => go('ground'),
        map: () => go('map'),
        simulate: () => go('simulate'),
      }}
      below={below}
      onDetailed={toReport}
    />
  );

  if (!loaded) {
    return (
      <Page>
        {canvas(true)}
        <ReportBridge />
        {handle.loading ? (
          <BriefLoading />
        ) : (
          <BriefFailed
            level={2}
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
        justWritten={written}
        before={canvas(true)}
        go={{
          simulate: () => go('simulate'),
          studio: () => go('decide', { view: 'studio' }),
          report: () => go('decide', { view: 'report' }),
          ground: () => go('ground', { view: 'conflicts' }),
        }}
      />
    );
  }
  if (handle.generating)
    return (
      <Page>
        {canvas(true)}
        <ReportBridge />
        <Writing level={2} />
      </Page>
    );
  // No finished comparison: the decision view says what is missing and what to do, and there is no report to go to.
  if (!loaded.latestAnalysis) return <Page>{canvas(false)}</Page>;
  return (
    <Page>
      {canvas(true)}
      <ReportBridge />
      <WriteBrief
        level={2}
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
