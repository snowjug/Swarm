import { useEffect, useRef } from 'react';
import { FilePlus2, ListChecks } from 'lucide-react';
import type { ConsoleStep } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { useBrief, type BriefHandle } from '../../hooks/useBrief';
import { dateTime } from '../../lib/format';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { BriefDocument } from './BriefDocument';
import { REPORT_BRIEF_ID } from './reportNavigation';

export interface DecisionBriefViewProps {
  project: ProjectDetail;
  /** Moves to another stage, so that a person with no analysis yet can be sent to run one. */
  onNavigate?: (step: ConsoleStep) => void;
  /** The brief is read again whenever this changes: a fresh read of the project, or a change to the review beside it. */
  refreshToken?: string;
}

/** What the brief shows for each state it can be in, from the handle the hook returns. */
export function BriefPanel({
  projectId,
  handle,
  onNavigate,
}: {
  projectId: string;
  handle: BriefHandle;
  onNavigate?: (step: ConsoleStep) => void;
}) {
  const { view, loading, error, generating, generateError, generate, reload } = handle;
  // The button that made the brief goes with the panel it was in: focus moves to the brief that
  // replaces it, so that a keyboard or screen reader user is not left on nothing.
  const asked = useRef(false);
  const hasBrief = Boolean(view?.brief);
  useEffect(() => {
    if (generating) asked.current = true;
  }, [generating]);
  useEffect(() => {
    if (hasBrief && asked.current) {
      asked.current = false;
      document.getElementById(REPORT_BRIEF_ID)?.focus({ preventScroll: true });
    }
  }, [hasBrief]);
  const failure = generateError ? (
    <Notice
      tone="error"
      title="The brief could not be made"
      action={
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={() => void generate()}
        >
          Try again
        </button>
      }
    >
      {generateError}
    </Notice>
  ) : null;

  if (!view) {
    return (
      <section
        className="brief brief-state"
        id={REPORT_BRIEF_ID}
        aria-label="Decision brief"
        tabIndex={-1}
      >
        {loading ? (
          <p className="brief-loading">
            <Spinner label="Loading the decision brief" /> Loading the decision brief…
          </p>
        ) : (
          <Notice
            tone="error"
            title="The decision brief could not be loaded"
            action={
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={reload}
              >
                Try again
              </button>
            }
          >
            {error ?? 'Reload the page and try again.'}
          </Notice>
        )}
      </section>
    );
  }

  if (view.brief) {
    return (
      <>
        {failure}
        <BriefDocument
          projectId={projectId}
          view={{ ...view, brief: view.brief }}
          generating={generating}
          onGenerate={() => void generate()}
          onNavigate={onNavigate}
        />
      </>
    );
  }

  if (!view.latestAnalysis) {
    return (
      <section
        className="brief brief-state"
        id={REPORT_BRIEF_ID}
        aria-label="Decision brief"
        tabIndex={-1}
      >
        <EmptyPanel
          title="No decision brief yet"
          level={2}
          icon={<ListChecks size={25} aria-hidden="true" />}
          action={
            onNavigate ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => onNavigate('simulation')}
              >
                Open the Simulation stage
              </button>
            ) : undefined
          }
        >
          A decision brief is written from a finished analysis: the scenario run many times with
          different seeds, compared with a baseline. There is no finished analysis in this project
          yet. Run the analysis in the Simulation stage, then come back here.
        </EmptyPanel>
      </section>
    );
  }

  return (
    <section
      className="brief brief-state"
      id={REPORT_BRIEF_ID}
      aria-label="Decision brief"
      tabIndex={-1}
    >
      {failure}
      <EmptyPanel
        title="Make the decision brief"
        level={2}
        icon={<FilePlus2 size={25} aria-hidden="true" />}
        action={
          view.may.generate ? (
            <button
              className="button button-primary"
              type="button"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? <Spinner label="Generating the brief" /> : null} Generate decision brief
            </button>
          ) : (
            <span className="field-help">
              Your role on this experiment cannot make the brief. Ask someone who can edit it.
            </span>
          )
        }
      >
        {view.latestAnalysis.completedAt
          ? `The analysis finished ${dateTime(view.latestAnalysis.completedAt)}. `
          : 'There is a finished analysis. '}
        The brief gives the answer first: what the simulated runs show, how stable it was across
        seeded runs, what it rests on, what to do about it and how to check it. It is assembled by
        rules from this project’s own data, with every statement labelled by where it comes from. No
        model writes any of it.
      </EmptyPanel>
    </section>
  );
}

/** The answer-first decision brief of a project, with its exports. It sits at the top of the Report stage. */
export function DecisionBriefView({
  project,
  onNavigate,
  refreshToken = '',
}: DecisionBriefViewProps) {
  // The project's own timestamp does not move when a critique, a stakeholder or a comparison changes.
  const handle = useBrief(project.id, `${project.updatedAt}|${refreshToken}`);
  return <BriefPanel projectId={project.id} handle={handle} onNavigate={onNavigate} />;
}
