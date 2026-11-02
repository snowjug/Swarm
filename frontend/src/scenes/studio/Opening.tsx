import type { CSSProperties } from 'react';
import { ArrowLeft, ArrowUpRight, ScrollText } from 'lucide-react';
import type { SimulationReport } from '../../../../shared/types';
import type { StudioView } from '../../../../shared/studio';
import { Button, EmptyState } from '../../design/ui';
import type { StudioActions } from './actions';
import './Studio.css';

/** The parts a working copy would have: the summary, the chapters in order, the limitations. */
function contents(report: SimulationReport | null): { key: string; index: string; name: string }[] {
  if (!report) return [];
  return [
    ...(report.executiveSummary ? [{ key: 'summary', index: '¶', name: 'Executive summary' }] : []),
    ...report.sections.map((section, position) => ({
      key: `chapter-${position}`,
      index: String(position + 1),
      name: section.title,
    })),
    ...(report.limitations.length ? [{ key: 'limitations', index: '§', name: 'Limitations' }] : []),
  ];
}

/**
 * A report nobody has worked on yet, or none to work on. It shows what the working copy would hold, so that
 * opening it is a decision about something, and says plainly what opening does and does not do.
 */
export function Opening({
  view,
  report,
  actions,
  onBack,
  onReport,
}: {
  view: StudioView;
  report: SimulationReport | null;
  actions: StudioActions;
  onBack: () => void;
  onReport: () => void;
}) {
  const parts = contents(report);
  if (!view.reportReady) {
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
        <EmptyState
          icon={<ScrollText size={22} aria-hidden="true" />}
          title="There is no report to work on yet"
          level={2}
          action={
            <Button
              variant="glass"
              iconEnd={<ArrowUpRight size={16} aria-hidden="true" />}
              onClick={onReport}
            >
              Go to the detailed report
            </Button>
          }
        >
          The studio works on a finished detailed report. Write it first, then come back to edit and
          review it.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="sw-open">
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
        <div>
          <p className="sw-eyebrow">Report studio</p>
          <h1 className="sw-open__title sw-display">
            Work on the <em>report</em>
          </h1>
        </div>
        <p className="sw-lead">
          {view.report?.title
            ? `“${view.report.title}” opens as a working copy. `
            : 'The report opens as a working copy. '}
          Every change is kept as a version, a reviewer approves what they read, and the generated
          report is never changed.
        </p>
        <div className="sw-open__cta">
          {view.capabilities.edit ? (
            <Button
              variant="accent"
              size="lg"
              busy={actions.pending === 'start'}
              busyLabel="Opening"
              onClick={() => void actions.start(false)}
            >
              Open in the studio
            </Button>
          ) : (
            <p className="sw-caption">
              Someone with the analyst or lead role needs to open it first.
            </p>
          )}
          <Button variant="ghost" onClick={onReport}>
            Read the detailed report
          </Button>
        </div>
      </div>
      {parts.length > 0 && (
        <ol className="sw-open__sections" aria-label="What the working copy holds">
          {parts.map((part, index) => (
            <li key={part.key} style={{ '--i': index } as CSSProperties}>
              <span className="sw-open__index num" aria-hidden="true">
                {part.index}
              </span>
              <span className="sw-open__name">{part.name}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
