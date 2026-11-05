import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowRight, Check, Save, Undo2, Users } from 'lucide-react';
import { SPRING } from '../../design/motion';
import { Button, Popover, PopoverContent, PopoverTrigger, Ring, Switch } from '../../design/ui';
import './pill.css';

/** Approving turns a reviewed list into actors; making them again from an approved list is the same press. */
export interface ApproveModel {
  mode: 'approve' | 'make';
  /** With a model on offer, the person is asked once whether it may read the key actors. */
  modelAvailable: boolean;
  /** Actors the person changed: approving keeps them instead of making the actors again. */
  keepsEdited: number;
  /** Stakeholders only proposed, which approving will accept. */
  unreviewed: number;
  disabled: boolean;
  /** Why it cannot be pressed yet, in a few words. */
  blocked?: string;
  /** What the button says, when the screen it is on has its own word for the one thing to do. */
  label?: string;
  /**
   * What the person chose: whether the model may read the key actors, and whether it may propose the constraints
   * of the decision (which is on unless they turn it off, since the answer rests on them).
   */
  onConfirm: (options: { model: boolean; constraints: boolean }) => void;
}

export type PillModel =
  | { kind: 'working'; text: string }
  | { kind: 'dirty'; count: number; invalid: boolean; onSave: () => void; onDiscard: () => void }
  | { kind: 'review'; reviewed: number; total: number; onNext: () => void; approve: ApproveModel }
  | {
      /** The review of the proposed participants: how many checks stand in the way, and the one way on. */
      kind: 'gate';
      blocking: number;
      waiting: number;
      total: number;
      approve: ApproveModel;
    }
  | { kind: 'make'; approve: ApproveModel }
  | { kind: 'ready'; actors: number; onContinue: () => void; onConstraints?: () => void }
  | { kind: 'read'; text: string; onContinue?: () => void };

function ApproveButton({ approve }: { approve: ApproveModel }) {
  const [useModel, setUseModel] = useState(false);
  const [readConstraints, setReadConstraints] = useState(true);
  const [open, setOpen] = useState(false);
  const making = approve.mode === 'make';
  // The one thing to do is said in two words; what it also does (it accepts the list) is in the name a reader hears.
  const label = approve.label ?? (approve.keepsEdited > 0 && !making ? 'Approve' : 'Create actors');
  const name =
    !approve.label && !making && approve.keepsEdited === 0 ? 'Approve & create actors' : undefined;
  const press = (model: boolean, constraints: boolean) => {
    setOpen(false);
    approve.onConfirm({ model, constraints });
  };
  const button = (
    <Button
      variant="accent"
      size="lg"
      icon={<Users size={18} aria-hidden="true" />}
      disabled={approve.disabled}
      aria-label={name}
      data-stk-focus="approve"
      onClick={approve.modelAvailable ? undefined : () => press(false, false)}
    >
      {label}
    </Button>
  );
  if (!approve.modelAvailable || approve.disabled) {
    return (
      <div className="sw-pill__approve">
        {button}
        {approve.blocked && <span className="sw-pill__hint">{approve.blocked}</span>}
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent side="top" align="end" width="22rem" className="sw-pill__pop">
        <p className="sw-pill__pop-title">
          {approve.keepsEdited > 0 && !making ? 'Approve the stakeholders' : 'Create the actors'}
        </p>
        <p className="sw-caption">
          {approve.keepsEdited > 0
            ? `You changed ${approve.keepsEdited} of the actors. Approving keeps those changes.`
            : 'Each key stakeholder becomes an actor and every other a cohort of simulated members, starting from documented category priors that you can change.'}
          {approve.unreviewed > 0 && ` ${approve.unreviewed} only proposed will be accepted.`}
        </p>
        {approve.keepsEdited === 0 && (
          <Switch
            checked={useModel}
            onChange={(event) => setUseModel(event.target.checked)}
            label="Let the model read the key actors"
            description="Sends your source text to the model. Whatever it sets is labelled as the model’s, and if it fails the category priors stand."
          />
        )}
        <Switch
          checked={readConstraints}
          onChange={(event) => setReadConstraints(event.target.checked)}
          label="Let the model read the constraints"
          description="Sends your source text to the model, which proposes what limits this decision. Nothing it proposes is used by a simulation until you review it. Skipped when constraints have already been read; if the model fails, rules read them and say so."
        />
        <div className="sw-pill__pop-actions">
          <Button
            variant="primary"
            icon={<Check size={16} aria-hidden="true" />}
            onClick={() => press(useModel && approve.keepsEdited === 0, readConstraints)}
          >
            {label}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** How far the review is, and the way to the next party: one button, named by the words it shows. */
function ReviewProgress({ model }: { model: Extract<PillModel, { kind: 'review' }> }) {
  const left = model.total - model.reviewed;
  // With nobody found there is nothing that has been reviewed, and "all" of nothing is not said.
  const done = left === 0 && model.total > 0;
  const detail = useId();
  return (
    <button
      type="button"
      className="sw-pill__progress"
      onClick={model.onNext}
      disabled={left === 0}
      aria-label={
        done ? 'All reviewed' : left > 0 ? `${left} to review, Next` : `${left} to review`
      }
      aria-describedby={detail}
    >
      {/* The ring only draws what the words say, and its own name would be words the button does not show. */}
      <span aria-hidden="true">
        <Ring
          value={model.total ? model.reviewed / model.total : 0}
          size={40}
          stroke={4}
          label="Reviewed"
          valueText={`${model.reviewed} of ${model.total}`}
          tone={done ? 'favor' : 'accent'}
        >
          <span className="sw-pill__ringnum">
            {done ? <Check size={15} aria-hidden="true" /> : left}
          </span>
        </Ring>
      </span>
      {/* A reader of the page's text, not of its layout, finds the number and the words apart without this. */}{' '}
      <span className="sw-pill__label">
        {done ? 'All reviewed' : 'to review'}
        {left > 0 && (
          <>
            {' '}
            <span className="sw-pill__sub">
              Next <ArrowRight size={11} aria-hidden="true" />
            </span>
          </>
        )}
      </span>
      <span id={detail} hidden>
        {model.reviewed} of {model.total} reviewed
      </span>
    </button>
  );
}

function Body({ model }: { model: PillModel }): ReactNode {
  switch (model.kind) {
    case 'working':
      return (
        <p className="sw-pill__working" role="status">
          <span className="sw-pill__pulse" aria-hidden="true" />
          {model.text}
        </p>
      );
    case 'dirty':
      return (
        <>
          <p className="sw-pill__text">
            <span className="sw-pill__main">
              <strong>{model.count}</strong> {model.count === 1 ? 'actor' : 'actors'} changed
            </span>
            <span className="sw-pill__sub">Not saved yet</span>
          </p>
          <div className="sw-pill__buttons">
            <Button
              variant="ghost"
              icon={<Undo2 size={16} aria-hidden="true" />}
              onClick={model.onDiscard}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              icon={<Save size={16} aria-hidden="true" />}
              onClick={model.onSave}
              disabled={model.invalid}
            >
              Save
            </Button>
          </div>
        </>
      );
    case 'review':
      return (
        <>
          <ReviewProgress model={model} />
          <ApproveButton approve={model.approve} />
        </>
      );
    case 'gate':
      return (
        <>
          <p className="sw-pill__text">
            {model.blocking > 0 ? (
              <>
                <span className="sw-pill__main">
                  <strong>{model.blocking}</strong>{' '}
                  {model.blocking === 1 ? 'check to fix' : 'checks to fix'}
                </span>
                <span className="sw-pill__sub">Before these can be used</span>
              </>
            ) : (
              <>
                <span className="sw-pill__main">
                  <strong>{model.total}</strong>{' '}
                  {model.total === 1 ? 'participant' : 'participants'}
                </span>
                <span className="sw-pill__sub">
                  {model.waiting > 0 ? `${model.waiting} still to review` : 'Nothing blocks them'}
                </span>
              </>
            )}
          </p>
          <ApproveButton approve={model.approve} />
        </>
      );
    case 'make':
      return (
        <>
          <p className="sw-pill__text">
            <span className="sw-pill__main">
              <strong>Approved</strong>
            </span>
            <span className="sw-pill__sub">No actors yet</span>
          </p>
          <ApproveButton approve={model.approve} />
        </>
      );
    case 'ready':
      return (
        <>
          <p className="sw-pill__text">
            <span className="sw-pill__main">
              <strong>{model.actors}</strong> {model.actors === 1 ? 'actor' : 'actors'} ready
            </span>
            <span className="sw-pill__sub">Synthetic stand-ins</span>
          </p>
          {model.onConstraints && (
            <Button variant="ghost" size="lg" onClick={model.onConstraints}>
              Constraints
            </Button>
          )}
          <Button
            variant="accent"
            size="lg"
            iconEnd={<ArrowRight size={18} aria-hidden="true" />}
            onClick={model.onContinue}
            data-stk-focus="continue"
          >
            Simulate
          </Button>
        </>
      );
    case 'read':
      return (
        <>
          <p className="sw-pill__text">{model.text}</p>
          {model.onContinue && (
            <Button
              variant="accent"
              size="lg"
              iconEnd={<ArrowRight size={18} aria-hidden="true" />}
              onClick={model.onContinue}
            >
              Simulate
            </Button>
          )}
        </>
      );
  }
}

/** The one thing to do next, floating where the thumb is: it changes with where the work has got to. */
export function Pill({ model }: { model: PillModel | null }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {model && (
        <m.div
          key={model.kind}
          data-kind={model.kind}
          className="sw-pill sw-glass sw-glass--overlay"
          role="group"
          aria-label="Next"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98, transition: { duration: 0.14 } }}
          transition={SPRING.smooth}
        >
          <Body model={model} />
        </m.div>
      )}
    </AnimatePresence>
  );
}
