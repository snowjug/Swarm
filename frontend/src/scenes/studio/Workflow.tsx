import { Fragment } from 'react';
import { m } from 'motion/react';
import { Check, Circle, RotateCcw, Send, Undo2 } from 'lucide-react';
import { isEditableState } from '../../../../shared/studio';
import type { StudioView } from '../../../../shared/studio';
import { cx } from '../../design/cx';
import { SPRING } from '../../design/motion';
import { Button } from '../../design/ui';
import { dateTime } from '../../lib/format';
import { actorLabel } from '../../lib/studio';
import type { StepKind } from './actions';
import { STATE_ICONS } from './glyphs';
import { submitBlocker, workflowSteps, type StudioDocument } from './model';
import './Workflow.css';

/**
 * Where the report is in its review, as three places joined by a line, and the one or two things that
 * move it on. The point in view glides to the next place when the state changes.
 */
export function Workflow({
  view,
  document,
  pending,
  onStep,
}: {
  view: StudioView;
  document: StudioDocument;
  pending: string | null;
  onStep: (kind: StepKind) => void;
}) {
  const { state } = document;
  const { capabilities, stale } = view;
  const steps = workflowSteps(state);
  const working = pending !== null;
  const blocker = submitBlocker(view, document);
  const canSubmit = capabilities.edit && isEditableState(state);
  const canReview = capabilities.review && state === 'in-review';
  const canWithdraw = capabilities.edit && (state === 'in-review' || state === 'approved');
  const noAction = !canSubmit && !canReview && !canWithdraw;
  const { approval } = document;

  return (
    <div className="sw-wf" role="group" aria-label="Review workflow">
      <ol className="sw-wf__steps">
        {steps.map((step, index) => {
          const previous = steps[index - 1];
          const Icon = STATE_ICONS[state];
          return (
            <Fragment key={step.id}>
              {index > 0 && (
                <li
                  className="sw-wf__link"
                  aria-hidden="true"
                  data-filled={previous?.status === 'done' || undefined}
                >
                  <span />
                </li>
              )}
              <li
                className={cx('sw-wf__step', `is-${step.status}`)}
                data-tone={step.tone}
                aria-current={step.status === 'current' ? 'step' : undefined}
              >
                <span className="sw-wf__node" aria-hidden="true">
                  {step.status === 'current' && (
                    <m.span
                      layoutId="studio-wf-ring"
                      className="sw-wf__ring"
                      transition={SPRING.lively}
                    />
                  )}
                  <span className="sw-wf__glyph">
                    {step.status === 'done' ? (
                      <Check size={14} strokeWidth={2.6} />
                    ) : step.status === 'current' ? (
                      <Icon size={14} strokeWidth={2.2} />
                    ) : (
                      <Circle size={7} strokeWidth={0} fill="currentColor" />
                    )}
                  </span>
                </span>
                <span className="sw-wf__label">
                  {step.label}
                  <span className="sr-only">
                    {step.status === 'done'
                      ? ', done'
                      : step.status === 'current'
                        ? ', now'
                        : ', not yet'}
                  </span>
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>

      <div className="sw-wf__actions">
        {canSubmit && (
          <Button
            variant="primary"
            icon={<Send size={16} aria-hidden="true" />}
            busy={pending === 'step:submit'}
            busyLabel="Submitting"
            disabled={working || stale || blocker !== null}
            onClick={() => onStep('submit')}
          >
            Submit for review
          </Button>
        )}
        {canReview && (
          <>
            <Button variant="primary" disabled={working || stale} onClick={() => onStep('approve')}>
              Approve…
            </Button>
            <Button
              variant="glass"
              icon={<RotateCcw size={15} aria-hidden="true" />}
              disabled={working || stale}
              onClick={() => onStep('request-changes')}
            >
              Request changes…
            </Button>
          </>
        )}
        {canWithdraw && (
          <Button
            variant={canReview ? 'ghost' : 'glass'}
            icon={<Undo2 size={15} aria-hidden="true" />}
            disabled={working || stale}
            onClick={() => onStep('reopen')}
          >
            {state === 'approved' ? 'Reopen…' : 'Withdraw…'}
          </Button>
        )}
        {noAction && (
          <p className="sw-wf__wait">
            {state === 'in-review'
              ? 'Waiting for a reviewer.'
              : state === 'approved'
                ? 'Approved.'
                : 'Nothing to do here: you can read and export it.'}
          </p>
        )}
      </div>

      <p className="sw-wf__meta">
        <span className="num">Revision {document.revision}</span>
        <span aria-hidden="true">·</span>
        <span>Updated {dateTime(document.updatedAt)}</span>
        {approval && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              Approved by {actorLabel(approval.actor)}, {dateTime(approval.at)}
              {approval.alsoEdited ? ', who also wrote part of this text' : ''}
            </span>
          </>
        )}
        {blocker && canSubmit && !stale && (
          <>
            <span aria-hidden="true">·</span>
            <span className="sw-wf__blocker">{blocker}</span>
          </>
        )}
      </p>
    </div>
  );
}
