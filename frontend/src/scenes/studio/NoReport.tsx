import { useState, type ReactNode } from 'react';
import { ArrowLeft, ScrollText } from 'lucide-react';
import type { StudioView } from '../../../../shared/studio';
import { useWorkspace } from '../../app/context';
import { Button, EmptyState, Orbit } from '../../design/ui';
import { canWrite, resolveReport, writingNote, writingView } from '../report/model';
import { WritingStrip } from '../report/Writing';
import './Studio.css';

/** What a role that cannot do the work is told: who can. */
const WHO_CAN_WRITE = 'Someone with the analyst or lead role needs to write it.';
const WHO_CAN_RUN = 'Someone with the analyst or lead role needs to run it.';

/**
 * The studio when the detailed report it works on is not written. It says where the report stands and offers the one
 * thing that moves it on: to write it here, after which the studio opens on it; to finish the deep dive it is written
 * from; or, for a role that cannot do either, who can. Every state has the page's one level-one heading.
 */
export function NoReport({ view, onBack }: { view: StudioView; onBack: () => void }) {
  const { project, mode, busy, run, cancel, go } = useWorkspace();
  const state = resolveReport(project);
  const may = view.capabilities.edit;
  const [starting, setStarting] = useState(false);
  const note = writingNote(project.mode === 'llm');

  const write = async () => {
    setStarting(true);
    try {
      await run('report');
    } catch {
      // The shell says why it was refused.
    } finally {
      setStarting(false);
    }
  };
  const writeButton = (label: string): ReactNode =>
    may && canWrite(project) ? (
      <Button
        variant="accent"
        size="lg"
        busy={starting || busy}
        busyLabel="Starting"
        onClick={() => void write()}
      >
        {label}
      </Button>
    ) : null;

  let title = 'There is no report to work on yet';
  let text = 'The studio works on a finished detailed report.';
  let action: ReactNode = null;
  let icon: ReactNode = <ScrollText size={22} aria-hidden="true" />;

  switch (state.kind) {
    case 'ready':
      text = may
        ? 'The studio works on a finished detailed report. Write it here, and the studio opens on it.'
        : `The studio works on a finished detailed report, and this one is not written. ${WHO_CAN_WRITE}`;
      action = may ? (
        <div className="sw-open__write">
          {writeButton('Write the detailed report')}
          <p className="sw-caption">{note.caption}</p>
        </div>
      ) : null;
      break;
    case 'writing':
      title = 'The detailed report is being written';
      text = 'The studio opens on it as soon as it is finished.';
      icon = <Orbit size={22} label="Writing the report" />;
      action = (
        <div className="sw-open__progress">
          <WritingStrip
            writing={writingView(project)}
            cancelling={busy}
            advanced={mode === 'advanced'}
            onCancel={() => void cancel()}
          />
        </div>
      );
      break;
    case 'stopped': {
      title =
        state.reason === 'failed'
          ? 'The detailed report stopped before it was finished'
          : state.reason === 'cancelled'
            ? 'The detailed report was stopped'
            : 'The detailed report is not finished';
      const why =
        state.reason === 'failed' && project.error
          ? project.error
          : 'What was written is kept on its page. Writing it again starts the report from the beginning.';
      text = may ? why : `${why} ${WHO_CAN_WRITE}`;
      action = writeButton(state.reason === 'failed' ? 'Try again' : 'Write it again');
      break;
    }
    case 'blocked': {
      const why = state.running
        ? 'The detailed report is written from a deep dive, and the deep dive is running. When it has finished, the report can be written from it.'
        : 'The detailed report is written from a finished deep dive of the simulation. It has not been run for this question.';
      text = may || state.running ? why : `${why} ${WHO_CAN_RUN}`;
      action =
        may || state.running ? (
          <Button variant="accent" size="lg" onClick={() => go('simulate', { view: 'deep' })}>
            {state.running ? 'Watch it in the deep dive' : 'Go to the deep dive'}
          </Button>
        ) : null;
      break;
    }
    case 'complete':
      title = 'The detailed report is written';
      text = 'Opening it in the studio.';
      icon = <Orbit size={22} label="Opening the studio" />;
      break;
    case 'none':
      text =
        'This record was made before the guided flow, so it has no detailed report and cannot make one.';
      break;
  }

  return (
    <div className="sw-open sw-open--empty">
      <div className="sw-open__main">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft size={16} aria-hidden="true" />}
          onClick={onBack}
          className="sw-open__back"
        >
          Back to the brief
        </Button>
      </div>
      <EmptyState icon={icon} title={title} level={1} action={action}>
        {text}
      </EmptyState>
    </div>
  );
}
