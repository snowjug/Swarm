import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { ArrowLeft, ArrowRight, Clock, MapPin, Plus, Shapes, X } from 'lucide-react';
import type {
  ScenarioAlternative,
  ScenarioAmbiguity,
  ScenarioAssumption,
  ScenarioFrame,
  ScenarioVariable,
} from '../../../../shared/scenario';
import { SPRING } from '../../design/motion';
import { Button, Chip, Disclosure, IconButton, Input, Tooltip } from '../../design/ui';
import {
  LIMITS,
  applyAnswer,
  blankChange,
  edited,
  newId,
  originLabel,
  skipQuestion,
} from '../../lib/intake';
import { InlineText } from './InlineText';
import { useRefocus, useRowKeys } from './rows';
import './ScenarioReview.css';

type Patch = Partial<ScenarioFrame>;

function Section({
  title,
  hint,
  children,
  index,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  index: number;
}) {
  return (
    <section className="sw-rv__section sw-rise" style={{ '--i': index } as React.CSSProperties}>
      <header className="sw-rv__sechead">
        <h3 className="sw-eyebrow">{title}</h3>
        {hint}
      </header>
      {children}
    </section>
  );
}

/** What varies, from what, to what: the rows of a list of changes. */
function ChangeRows({
  rows,
  onChange,
  label,
  max = LIMITS.changes,
}: {
  rows: readonly ScenarioVariable[];
  onChange: (rows: ScenarioVariable[]) => void;
  label: string;
  max?: number;
}) {
  const [fresh, setFresh] = useState<number | null>(null);
  const { keys, add, remove } = useRowKeys(rows.length);
  const addButton = useRef<HTMLButtonElement>(null);
  const refocus = useRefocus(() => addButton.current);
  const set = (index: number, patch: Partial<ScenarioVariable>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <ul className="sw-rv__rows">
      <AnimatePresence initial={false}>
        {rows.map((row, index) => (
          <m.li
            key={keys[index]}
            layout
            className="sw-rv__row"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
            transition={SPRING.smooth}
          >
            <div className="sw-rv__change">
              <InlineText
                className="sw-rv__name"
                value={row.name}
                label={`${label} ${index + 1} name`}
                placeholder="What changes"
                maxLength={LIMITS.variableName}
                autoEdit={fresh === index}
                onCommit={(name) => set(index, { name })}
              />
              <span className="sw-rv__shift">
                <InlineText
                  value={row.from ?? ''}
                  label={`${label} ${index + 1}, from`}
                  placeholder="from"
                  maxLength={LIMITS.variableValue}
                  onCommit={(from) => set(index, { from: from || null })}
                />
                <ArrowRight size={14} aria-hidden="true" />
                <InlineText
                  value={row.to ?? ''}
                  label={`${label} ${index + 1}, to`}
                  placeholder="to"
                  maxLength={LIMITS.variableValue}
                  onCommit={(to) => set(index, { to: to || null })}
                />
              </span>
            </div>
            <IconButton
              label={`Remove ${label.toLowerCase()} ${index + 1}`}
              size="sm"
              onClick={() => {
                remove(index);
                setFresh(null);
                onChange(rows.filter((_, at) => at !== index));
                refocus();
              }}
            >
              <X size={15} aria-hidden="true" />
            </IconButton>
          </m.li>
        ))}
      </AnimatePresence>
      {rows.length < max && (
        <li>
          <Button
            ref={addButton}
            variant="ghost"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => {
              add();
              setFresh(rows.length);
              onChange([...rows, blankChange()]);
            }}
          >
            Add {label.toLowerCase()}
          </Button>
        </li>
      )}
    </ul>
  );
}

/** A short list of words (who is affected): each can be changed or taken away, and one can be added. */
function ChipList({
  items,
  onChange,
  label,
  max,
  maxLength,
  placeholder,
}: {
  items: readonly string[];
  onChange: (items: string[]) => void;
  label: string;
  max: number;
  maxLength: number;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const { keys, add: addKey, remove: removeKey } = useRowKeys(items.length);
  const field = useRef<HTMLInputElement>(null);
  const refocus = useRefocus(() => field.current);
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    addKey();
    onChange([...items, text]);
    setDraft('');
  };
  const take = (index: number, keepFocus = true) => {
    removeKey(index);
    onChange(items.filter((_, at) => at !== index));
    if (keepFocus) refocus();
  };
  return (
    <div className="sw-rv__chips">
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <m.span
            key={keys[index]}
            layout
            className="sw-rv__chip"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.12 } }}
            transition={SPRING.snappy}
          >
            <InlineText
              value={item}
              label={`${label} ${index + 1}`}
              maxLength={maxLength}
              onCommit={(next, via) => {
                if (next) onChange(items.map((old, at) => (at === index ? next : old)));
                else take(index, via === 'key');
              }}
            />
            <button
              type="button"
              className="sw-rv__chip-x"
              aria-label={`Remove ${item}`}
              onClick={() => take(index)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </m.span>
        ))}
      </AnimatePresence>
      {items.length < max && (
        <form
          className="sw-rv__chip-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            ref={field}
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={`Add to ${label.toLowerCase()}`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={add}
          />
        </form>
      )}
    </div>
  );
}

function AlternativeCard({
  alternative,
  index,
  onChange,
  onRemove,
  fresh,
}: {
  alternative: ScenarioAlternative;
  index: number;
  onChange: (next: ScenarioAlternative) => void;
  onRemove: () => void;
  fresh: boolean;
}) {
  return (
    <m.li
      layout
      className="sw-rv__alt"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={SPRING.smooth}
    >
      <div className="sw-rv__alt-head">
        <InlineText
          className="sw-rv__alt-label"
          value={alternative.label}
          label={`Alternative ${index + 1} name`}
          placeholder="Name this way of doing it"
          maxLength={LIMITS.label}
          autoEdit={fresh}
          onCommit={(label) => onChange({ ...alternative, label })}
        />
        <IconButton label={`Remove alternative ${index + 1}`} size="sm" onClick={onRemove}>
          <X size={15} aria-hidden="true" />
        </IconButton>
      </div>
      <InlineText
        className="sw-rv__alt-desc"
        value={alternative.description}
        label={`Alternative ${index + 1} description`}
        placeholder="How it differs"
        multiline
        maxLength={LIMITS.description}
        onCommit={(description) => onChange({ ...alternative, description })}
      />
      <Disclosure
        summary={`What it changes${alternative.changes.length ? ` · ${alternative.changes.length}` : ''}`}
        tone="quiet"
      >
        <ChangeRows
          rows={alternative.changes}
          label="Change"
          onChange={(changes) => onChange({ ...alternative, changes })}
        />
      </Disclosure>
    </m.li>
  );
}

function Question({
  ambiguity,
  index,
  onAnswer,
  onSkip,
}: {
  ambiguity: ScenarioAmbiguity;
  index: number;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const present = useIsPresent();
  return (
    <m.li
      layout
      className="sw-rv__ask"
      inert={present ? undefined : true}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
      transition={SPRING.smooth}
    >
      <p className="sw-rv__ask-q">{ambiguity.question ?? ambiguity.message}</p>
      <form
        className="sw-rv__ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (answer.trim()) onAnswer(answer);
        }}
      >
        <Input
          value={answer}
          maxLength={LIMITS.question}
          aria-label={`Your answer to question ${index + 1}`}
          placeholder="Your answer"
          onChange={(event) => setAnswer(event.target.value)}
        />
        <Button type="submit" size="sm" variant="glass" disabled={!answer.trim()}>
          Answer
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Skip
        </Button>
      </form>
    </m.li>
  );
}

/**
 * The scenario Swarm read from the question, laid out as something to read and correct, not a form to fill.
 * Everything in it is editable where it stands and everything is the person's from the first edit: the label
 * says who made it. Nothing runs until the person goes on.
 */
export function ScenarioReview({
  frame,
  onFrame,
  readMode,
  model,
  notes,
  evidence,
  issues,
  error,
  next = null,
  continuing,
  onBack,
  onContinue,
}: {
  frame: ScenarioFrame;
  onFrame: (frame: ScenarioFrame) => void;
  readMode: 'rules' | 'model' | null;
  model: string | null;
  notes: readonly string[];
  evidence: ReactNode;
  issues: readonly string[];
  error: string | null;
  /** What the press that goes on will do, in a few words, said after "Nothing runs until you continue." */
  next?: string | null;
  continuing: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const change = (patch: Patch) => onFrame(edited(frame, patch));
  const [freshAlternative, setFreshAlternative] = useState<string | null>(null);
  const [freshAssumption, setFreshAssumption] = useState<string | null>(null);
  // Whatever is taken away takes focus with it: it goes to the control that adds one, which stays, and after
  // a question has been dealt with to the next one, or to the review itself when that was the last.
  const root = useRef<HTMLDivElement>(null);
  const asks = useRef<HTMLUListElement>(null);
  const addWay = useRef<HTMLButtonElement>(null);
  const addAssumption = useRef<HTMLButtonElement>(null);
  const afterWay = useRefocus(() => addWay.current);
  const afterAssumption = useRefocus(() => addAssumption.current);
  const afterAsk = useRefocus(
    () => asks.current?.querySelector<HTMLElement>('li:not([inert]) input') ?? root.current,
  );

  return (
    <div className="sw-rv" ref={root} tabIndex={-1} role="region" aria-label="Your scenario">
      <header className="sw-rv__head sw-rise">
        <p className="sw-eyebrow">Your scenario</p>
        <div className="sw-rv__origin">
          <Chip
            tone={readMode === 'model' && frame.origin !== 'user' ? 'accent' : 'neutral'}
            size="sm"
          >
            {originLabel(frame, readMode)}
            {model && frame.origin !== 'user' ? ` · ${model}` : ''}
          </Chip>
        </div>
      </header>

      <h2
        className="sw-display sw-rv__decision sw-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <InlineText
          value={frame.decision}
          label="The decision or event"
          placeholder="What is being decided"
          multiline
          maxLength={LIMITS.decision}
          onCommit={(decision) => change({ decision })}
        />
      </h2>
      <div className="sw-rv__meta sw-rise" style={{ '--i': 2 } as React.CSSProperties}>
        <span className="sw-rv__meta-item">
          <Shapes size={14} aria-hidden="true" />
          <InlineText
            value={frame.system}
            label="What it affects"
            placeholder="Scope"
            maxLength={LIMITS.system}
            onCommit={(system) => change({ system })}
          />
        </span>
        <span className="sw-rv__meta-item">
          <MapPin size={14} aria-hidden="true" />
          <InlineText
            value={frame.geography ?? ''}
            label="Where"
            placeholder="Where"
            maxLength={LIMITS.geography}
            onCommit={(geography) => change({ geography: geography || null })}
          />
        </span>
        <span className="sw-rv__meta-item">
          <Clock size={14} aria-hidden="true" />
          <InlineText
            value={frame.horizon ?? ''}
            label="Over what time"
            placeholder="When"
            maxLength={LIMITS.horizon}
            onCommit={(horizon) => change({ horizon: horizon || null })}
          />
        </span>
      </div>

      <div className="sw-rv__grid">
        <Section title="What changes" index={3}>
          <ChangeRows
            rows={frame.changes}
            label="Change"
            onChange={(changes) => change({ changes })}
          />
        </Section>

        <Section title="If nothing changes" index={4}>
          <p className="sw-rv__baseline">
            <InlineText
              value={frame.baseline}
              label="What is expected without the change"
              placeholder="What is expected without the change"
              multiline
              maxLength={LIMITS.baseline}
              onCommit={(baseline) => change({ baseline })}
            />
          </p>
        </Section>

        <Section title="Ways to do it" index={5}>
          <ul className="sw-rv__alts">
            <AnimatePresence initial={false}>
              {frame.alternatives.map((alternative, index) => (
                <AlternativeCard
                  key={alternative.id}
                  alternative={alternative}
                  index={index}
                  fresh={freshAlternative === alternative.id}
                  onChange={(next) =>
                    change({
                      alternatives: frame.alternatives.map((item) =>
                        item.id === alternative.id ? next : item,
                      ),
                    })
                  }
                  onRemove={() => {
                    change({
                      alternatives: frame.alternatives.filter((item) => item.id !== alternative.id),
                    });
                    afterWay();
                  }}
                />
              ))}
            </AnimatePresence>
          </ul>
          {frame.alternatives.length < LIMITS.alternatives && (
            <Button
              ref={addWay}
              variant="ghost"
              size="sm"
              icon={<Plus size={14} aria-hidden="true" />}
              onClick={() => {
                const id = newId(
                  'option',
                  frame.alternatives.map((item) => item.id),
                );
                setFreshAlternative(id);
                change({
                  alternatives: [
                    ...frame.alternatives,
                    { id, label: '', description: '', changes: [] },
                  ],
                });
              }}
            >
              Add a way
            </Button>
          )}
        </Section>

        <Section title="Who is affected" index={6}>
          <ChipList
            items={frame.likelyStakeholders}
            label="Group"
            max={LIMITS.stakeholders}
            maxLength={LIMITS.stakeholder}
            placeholder="Add a group"
            onChange={(likelyStakeholders) => change({ likelyStakeholders })}
          />
        </Section>

        <Section title="Assumed" index={7}>
          <ul className="sw-rv__rows">
            <AnimatePresence initial={false}>
              {frame.assumptions.map((assumption: ScenarioAssumption, index) => (
                <m.li
                  key={assumption.id}
                  layout
                  className="sw-rv__row"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
                  transition={SPRING.smooth}
                >
                  <div className="sw-rv__assume">
                    <Tooltip
                      label={
                        assumption.origin === 'user'
                          ? 'You wrote or accepted this'
                          : 'Swarm filled this in; change it if it is wrong'
                      }
                    >
                      <span
                        className="sw-rv__origin-dot"
                        data-origin={assumption.origin}
                        role="img"
                        aria-label={assumption.origin === 'user' ? 'Yours' : 'System assumption'}
                      />
                    </Tooltip>
                    <InlineText
                      value={assumption.text}
                      label={`Assumption ${index + 1}`}
                      multiline
                      maxLength={LIMITS.assumption}
                      autoEdit={freshAssumption === assumption.id}
                      onCommit={(text, via) => {
                        change({
                          assumptions: text
                            ? frame.assumptions.map((item) =>
                                item.id === assumption.id
                                  ? { ...item, text, origin: 'user' }
                                  : item,
                              )
                            : frame.assumptions.filter((item) => item.id !== assumption.id),
                        });
                        if (!text && via === 'key') afterAssumption();
                      }}
                    />
                  </div>
                  <IconButton
                    label={`Remove assumption ${index + 1}`}
                    size="sm"
                    onClick={() => {
                      change({
                        assumptions: frame.assumptions.filter((item) => item.id !== assumption.id),
                      });
                      afterAssumption();
                    }}
                  >
                    <X size={15} aria-hidden="true" />
                  </IconButton>
                </m.li>
              ))}
            </AnimatePresence>
          </ul>
          {frame.assumptions.length < LIMITS.assumptions && (
            <Button
              ref={addAssumption}
              variant="ghost"
              size="sm"
              icon={<Plus size={14} aria-hidden="true" />}
              onClick={() => {
                const id = newId(
                  'assumption',
                  frame.assumptions.map((item) => item.id),
                );
                setFreshAssumption(id);
                change({ assumptions: [...frame.assumptions, { id, text: '', origin: 'user' }] });
              }}
            >
              Add an assumption
            </Button>
          )}
        </Section>

        {frame.ambiguities.length > 0 && (
          <Section title="Swarm asks" index={8}>
            <ul className="sw-rv__asks" ref={asks}>
              <AnimatePresence initial={false}>
                {frame.ambiguities.map((ambiguity, index) => (
                  <Question
                    key={`${ambiguity.field}-${ambiguity.message}`}
                    ambiguity={ambiguity}
                    index={index}
                    onAnswer={(answer) => {
                      onFrame(applyAnswer(frame, index, answer));
                      afterAsk();
                    }}
                    onSkip={() => {
                      onFrame(skipQuestion(frame, index));
                      afterAsk();
                    }}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </Section>
        )}

        <Section title="Evidence" index={9}>
          {evidence}
        </Section>
      </div>

      {notes.length > 0 && (
        <Disclosure summary="How it was read" className="sw-rv__method">
          <ul className="sw-rv__notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      <div className="sw-rv__bar sw-glass sw-glass--overlay" role="group" aria-label="Continue">
        <Button
          variant="ghost"
          icon={<ArrowLeft size={16} aria-hidden="true" />}
          disabled={continuing}
          onClick={onBack}
        >
          Question
        </Button>
        <div className="sw-rv__status" aria-live="polite">
          {error ? (
            <span className="sw-rv__error">{error}</span>
          ) : issues.length > 0 ? (
            <span>{issues[0]}</span>
          ) : (
            <>
              <span className="sw-rv__ok">Nothing runs until you continue.</span>
              {next && <span className="sw-rv__next">{next}</span>}
            </>
          )}
        </div>
        <Button
          variant="primary"
          size="lg"
          busy={continuing}
          busyLabel="Starting"
          disabled={issues.length > 0 || continuing}
          iconEnd={<ArrowRight size={18} aria-hidden="true" />}
          onClick={onContinue}
        >
          Ground it
        </Button>
      </div>
    </div>
  );
}
