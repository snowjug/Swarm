import { ArrowLeft, FileText, ListChecks, Scale, ScrollText, Square } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { ProjectDetail } from '../../../../shared/types';
import { cx } from '../../design/cx';
import { Button, EmptyState, Notice, Ring, SkeletonText } from '../../design/ui';
import { canWrite, writingNote, type ChapterProgress, type WritingView } from './model';
import './Writing.css';

/** A way back, always in the same place: the brief is where this page was reached from. */
export function Back({ onBack }: { onBack: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="sw-rep__back"
      icon={<ArrowLeft size={16} aria-hidden="true" />}
      onClick={onBack}
    >
      Back to the brief
    </Button>
  );
}

function Holds({ model }: { model: boolean }) {
  const rows: { icon: ReactNode; title: string; text: string }[] = [
    {
      icon: <ScrollText size={18} aria-hidden="true" />,
      title: 'The summary',
      text: 'The answer, in a paragraph.',
    },
    {
      icon: <FileText size={18} aria-hidden="true" />,
      title: 'Chapters',
      text: 'Each citing the sources and simulated records it rests on.',
    },
    ...(model
      ? [
          {
            icon: <ListChecks size={18} aria-hidden="true" />,
            title: 'Statement checks',
            text: 'Every statement checked against the passage it cites.',
          },
        ]
      : []),
    {
      icon: <Scale size={18} aria-hidden="true" />,
      title: 'Limitations',
      text: 'What the figures cannot say.',
    },
  ];
  return (
    <ul className="sw-wr__holds" role="list" aria-label="What the report holds">
      {rows.map((row, index) => (
        <li key={row.title} style={{ '--i': index } as CSSProperties}>
          <span className="sw-wr__holdicon">{row.icon}</span>
          <span>
            <strong>{row.title}</strong>
            <span>{row.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Nothing written yet, and the deep dive is done: say what the report is, and offer to write it. */
export function Ready({
  project,
  busy,
  onWrite,
  onBack,
}: {
  project: ProjectDetail;
  busy: boolean;
  onWrite: () => void;
  onBack: () => void;
}) {
  const model = project.mode === 'llm';
  const note = writingNote(model);
  return (
    <div className="sw-wr">
      <div className="sw-wr__main">
        <Back onBack={onBack} />
        <div>
          <p className="sw-eyebrow">Detailed report</p>
          <h1 className="sw-wr__title sw-display">
            Write the <em>report</em>
          </h1>
        </div>
        <p className="sw-lead">{note.lead}</p>
        <div className="sw-wr__cta">
          <Button
            variant="accent"
            size="lg"
            busy={busy}
            busyLabel="Starting"
            disabled={!canWrite(project)}
            onClick={onWrite}
          >
            Write the report
          </Button>
          <p className="sw-caption">{note.caption}</p>
        </div>
      </div>
      <Holds model={model} />
    </div>
  );
}

/** The deep dive is not finished, so the report cannot be written yet: where it stands and the way there. */
export function Blocked({
  project,
  running,
  onDeepDive,
  onBack,
}: {
  project: ProjectDetail;
  running: boolean;
  onDeepDive: () => void;
  onBack: () => void;
}) {
  return (
    <div className="sw-wr">
      <div className="sw-wr__main">
        <Back onBack={onBack} />
        <div>
          <p className="sw-eyebrow">Detailed report</p>
          <h1 className="sw-wr__title sw-display">
            The deep dive <em>comes first</em>
          </h1>
        </div>
        <p className="sw-lead">
          {running
            ? 'The deep dive is running. When it has finished, the report can be written from it.'
            : 'The detailed report is written from a finished deep-dive run of the simulation. It has not been run for this question.'}
        </p>
        {running && (
          <div className="sw-wr__progress" role="status">
            <Ring
              value={project.progress / 100}
              size={52}
              label="Deep dive progress"
              valueText={`${Math.round(project.progress)} percent`}
            >
              <span className="num sw-wr__pct">{Math.round(project.progress)}</span>
            </Ring>
            <p className="sw-caption">This page updates by itself.</p>
          </div>
        )}
        <div className="sw-wr__cta">
          <Button variant="primary" size="lg" onClick={onDeepDive}>
            {running ? 'Watch it in the deep dive' : 'Go to the deep dive'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A record that was not made by the guided flow has no report and cannot make one. */
export function Nothing({ onBack }: { onBack: () => void }) {
  return (
    <div className="sw-wr sw-wr--empty">
      <div className="sw-wr__main">
        <Back onBack={onBack} />
      </div>
      <EmptyState
        icon={<ScrollText size={22} aria-hidden="true" />}
        title="No detailed report in this record"
        level={2}
        action={
          <Button variant="glass" onClick={onBack}>
            Back to the brief
          </Button>
        }
      >
        It was made before the guided flow, so there is nothing to write here.
      </EmptyState>
    </div>
  );
}

/**
 * While the report is being written: how far it is, what it is doing, and a way to stop it. The page is the
 * report itself, filling in as chapters arrive; this is the strip above it.
 */
export function WritingStrip({
  writing,
  cancelling,
  advanced,
  onCancel,
}: {
  writing: WritingView;
  cancelling: boolean;
  advanced: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="sw-wstrip" role="status" aria-live="polite">
      <Ring
        value={writing.percent / 100}
        size={52}
        label="Report progress"
        valueText={`${writing.percent} percent`}
      >
        <span className="num sw-wstrip__pct" aria-hidden="true">
          {writing.percent}
        </span>
      </Ring>
      <div className="sw-wstrip__text">
        <p className="sw-wstrip__activity">{writing.activity ?? 'Writing the report'}</p>
        <p className="sw-caption">
          {writing.total > 0 ? `${writing.done} of ${writing.total} chapters written. ` : ''}
          This page updates by itself.
          {advanced && writing.operation ? ` Operation: ${writing.operation}.` : ''}
        </p>
      </div>
      <Button
        variant="glass"
        size="sm"
        icon={<Square size={14} aria-hidden="true" />}
        busy={cancelling}
        busyLabel="Stopping"
        onClick={onCancel}
      >
        Stop
      </Button>
    </div>
  );
}

/** The report stopped before it was finished: what happened, and whether it can be started again. */
export function StoppedNotice({
  project,
  reason,
  busy,
  onWrite,
}: {
  project: ProjectDetail;
  reason: 'failed' | 'cancelled' | 'incomplete';
  busy: boolean;
  onWrite: () => void;
}) {
  return (
    <Notice
      tone={reason === 'failed' ? 'error' : 'caution'}
      title={
        reason === 'failed'
          ? 'The report stopped before it was finished'
          : reason === 'cancelled'
            ? 'You stopped the report'
            : 'This report is not finished'
      }
      action={
        canWrite(project) ? (
          <Button size="sm" variant="glass" busy={busy} onClick={onWrite}>
            {reason === 'failed' ? 'Try again' : 'Write it again'}
          </Button>
        ) : undefined
      }
    >
      {reason === 'failed' && project.error
        ? project.error
        : 'What was written is kept below. Writing it again starts the report from the beginning.'}
    </Notice>
  );
}

/** A chapter that has not arrived yet: its place in the report, and, for the one being written, light passing over it. */
export function ChapterPlaceholder({
  chapter,
  index,
  stopped,
}: {
  chapter: ChapterProgress;
  index: number;
  stopped: boolean;
}) {
  const writing = chapter.state === 'writing';
  return (
    <section
      className={cx('sw-rep__chapter', 'sw-wph', writing && 'is-writing')}
      aria-busy={writing || undefined}
    >
      <header className="sw-rep__chhead">
        <span className="sw-rep__chno num">{String(index + 1).padStart(2, '0')}</span>
        <h2 className="sw-title">{chapter.title}</h2>
      </header>
      <div className="sw-rep__chbody">
        {writing ? (
          <SkeletonText lines={4} />
        ) : (
          <p className="sw-caption">
            {stopped ? 'Not written before it stopped.' : 'Waiting to be written.'}
          </p>
        )}
      </div>
    </section>
  );
}
