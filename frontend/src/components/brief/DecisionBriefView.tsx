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
  /** Changes each time a hand-off asks for focus on the brief; it is given once the brief has settled. */
  focusToken?: number;
}

/** Where focus may be taken from: nowhere, or on the stage or the placeholder that was there while the brief loaded. */
function focusIsFree(): boolean {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    active.id === REPORT_BRIEF_ID ||
    active.matches('section.console-stage')
  );
}

/** What the brief shows for each state it can be in, from the handle the hook returns. */
export function BriefPanel({
  projectId,
  handle,
  onNavigate,
  focusToken = 0,
}: {
  projectId: string;
  handle: BriefHandle;
  onNavigate?: (step: ConsoleStep) => void;
  focusToken?: number;
}) {
  const { view, loading, error, generating, generateError, generate, reload } = handle;
  // A hand-off that asked for the brief waits for the page to settle: the element it focused while the
  // brief was loading is replaced by the one that stays, and focus must not be left on nothing. A person
  // who has moved on in the meantime is left where they are.
  const served = useRef(0);
  const settled = !loading && (view !== null || error !== null);
  useEffect(() => {
    if (focusToken === 0 || !settled || served.current === focusToken) return;
    served.current = focusToken;
    if (focusIsFree()) document.getElementById(REPORT_BRIEF_ID)?.focus({ preventScroll: true });
  }, [focusToken, settled]);
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
  // A failed read of what is already shown leaves it on the page, and says that it may not be the latest.
  const staleRead =
    view && error && !loading ? (
      <Notice
        tone="warning"
        title="The brief could not be refreshed"
        action={
          <button className="button button-secondary button-small" type="button" onClick={reload}>
            Try again
          </button>
        }
      >
        {error} What is shown is the last version that could be read.
      </Notice>
    ) : null;
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
        {staleRead}
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
        {staleRead}
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
      {staleRead}
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
  focusToken,
}: DecisionBriefViewProps) {
  // The project's own timestamp does not move when a critique, a stakeholder or a comparison changes.
  const handle = useBrief(project.id, `${project.updatedAt}|${refreshToken}`);
  return (
    <BriefPanel
      projectId={project.id}
      handle={handle}
      onNavigate={onNavigate}
      focusToken={focusToken}
    />
  );
}
