import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Lock, Minus, Square } from 'lucide-react';
import { RESPONSE_GROUP_WORDS } from '../../../../../shared/decision';
import type { DecisionCanvas } from '../../../../../shared/decision';
import { Disclosure } from '../../../design/ui';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { plural } from '../model/format';
import type { DetailId } from './details';
import { LabelChip, LabelsOf, ShareBar, StatusIcon } from './parts';
import {
  COPY,
  FIGURE_UNIT,
  ITEMS,
  ITEM_TITLES,
  PRIORITY_WORDS,
  alignmentWords,
  assumptionsOf,
  changeWords,
  checksOf,
  completenessOf,
  basisOf,
  explorationOf,
  reasonsOf,
  reverseWords,
  constraintGlance,
  driverItems,
  futureItems,
  gistOf,
  labelsOf,
  moveWords,
  moverItems,
  positionWords,
  roleName,
  sensitivityWords,
  statusTone,
  strip,
  validationWords,
  viewWords,
  type Item,
} from './model';

interface Props {
  canvas: DecisionCanvas;
  openDetail: (id: DetailId) => void;
}

/**
 * One of the ten items. Wide, it is a heading and what it holds. Narrow, the first two keep their place and the
 * rest fold into disclosures with one line each, in the same order, so that the answer stays first.
 */
function Slot({
  item,
  canvas,
  children,
  chips,
}: {
  item: Item;
  canvas: DecisionCanvas;
  children: ReactNode;
  chips?: ReactNode;
}) {
  const narrow = useMediaQuery('(max-width: 40rem)');
  const number = ITEMS.indexOf(item) + 1;
  const title = ITEM_TITLES[item];
  const folds = narrow && item !== 'question' && item !== 'answer';
  if (folds) {
    return (
      <section className={`sw-canvas-item sw-canvas-item--${item}`} data-canvas-item={item}>
        <Disclosure
          heading={2}
          tone="strong"
          summary={
            <span className="sw-canvas-fold">
              <span className="sw-canvas-no" aria-hidden="true">
                {number}
              </span>
              <span className="sw-canvas-fold__title">{title}</span>
              <span className="sw-canvas-fold__gist">{gistOf(item, canvas)}</span>
            </span>
          }
        >
          <div className="sw-canvas-item__body">
            {chips ? <p className="sw-canvas-row__meta">{chips}</p> : null}
            {children}
          </div>
        </Disclosure>
      </section>
    );
  }
  const id = `canvas-${item}`;
  return (
    <section
      className={`sw-canvas-item sw-canvas-item--${item}`}
      data-canvas-item={item}
      aria-labelledby={id}
    >
      <header className="sw-canvas-item__head">
        <span className="sw-canvas-no" aria-hidden="true">
          {number}
        </span>
        <h2 id={id} className="sw-eyebrow sw-canvas-item__title">
          {title}
        </h2>
        {chips}
      </header>
      <div className="sw-canvas-item__body">{children}</div>
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="sw-canvas-quiet">{children}</p>
);

/** Two texts that differ only in case, spacing or a last full stop are one. */
const normal = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\s.]+/gu, ' ')
    .trim();

function Question({ canvas }: { canvas: DecisionCanvas }) {
  const { question } = canvas;
  // The decision as framed is said again only where it says something the question did not.
  const framed = normal(question.decision.text) !== normal(question.asked);
  return (
    <>
      <p className="sw-canvas-question">{question.asked}</p>
      <dl className="sw-canvas-frame">
        {framed && (
          <div>
            <dt>
              Decision as framed <LabelChip label={question.decision.label} />
            </dt>
            <dd>{question.decision.text}</dd>
          </div>
        )}
        <div>
          <dt>
            If nothing changes <LabelChip label={question.baseline.label} />
          </dt>
          <dd>{question.baseline.text}</dd>
        </div>
      </dl>
    </>
  );
}

function Answer({ canvas }: { canvas: DecisionCanvas }) {
  const { status, answer } = canvas;
  const provisional = canvas.constraints.provisional;
  const reasons = reasonsOf(canvas);
  return (
    <div className="sw-canvas-answer" data-status={status.status} data-tone={statusTone(canvas)}>
      <div className="sw-canvas-status">
        <StatusIcon status={status.status} />
        <h3 className="sw-canvas-status__name">{status.label}</h3>
        {provisional && <span className="sw-canvas-flag">Provisional</span>}
        {canvas.freshness.stale && <span className="sw-canvas-flag">Not current</span>}
      </div>
      <p className="sw-canvas-headline">
        {answer.headline.text} <LabelChip label={answer.headline.label} />
      </p>
      <p className="sw-canvas-meaning">{status.meaning}</p>
      <ul className="sw-canvas-why" aria-label={reasons.label}>
        {reasons.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function Futures({ canvas, openDetail }: Props) {
  const items = futureItems(canvas);
  if (!canvas.futures.supported || items.length === 0) return <Quiet>{canvas.futures.note}</Quiet>;
  const left = canvas.futures.items.length - items.length;
  return (
    <>
      <ul className="sw-canvas-list sw-canvas-futures" role="list">
        {items.map((future) => (
          <li key={future.alternativeId} data-kind={future.kind}>
            <span className="sw-canvas-row__name">{future.label}</span>
            <ShareBar shares={future.shares} />
            <span className="sw-canvas-row__text">{future.statement.text}</span>
          </li>
        ))}
      </ul>
      <p className="sw-canvas-legendline">
        {(['favourable', 'neutral', 'defensive', 'adverse'] as const).map((group) => (
          <span key={group} className="sw-canvas-key" data-group={group}>
            {RESPONSE_GROUP_WORDS[group]}
          </span>
        ))}
      </p>
      {left > 0 && (
        <button type="button" className="sw-canvas-more" onClick={() => openDetail('lenses')}>
          {plural(left, 'more option')}
        </button>
      )}
    </>
  );
}

function Drivers({ canvas }: { canvas: DecisionCanvas }) {
  const items = driverItems(canvas);
  if (items.length === 0) return <Quiet>No driver stood out in the simulation.</Quiet>;
  return (
    <ul className="sw-canvas-list" role="list">
      {items.map((driver) => (
        <li key={driver.id}>
          <span className="sw-canvas-row__text">
            {driver.statement.text} <LabelChip label={driver.statement.label} />
            {driver.flipsAnswer && (
              <>
                {' '}
                <span className="sw-canvas-flag">{COPY.couldReverse}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Constraints({ canvas, openDetail }: Props) {
  const glance = constraintGlance(canvas);
  return (
    <>
      <p className="sw-canvas-gate" data-tone={glance.words.tone}>
        <Lock size={14} aria-hidden="true" />
        <strong>{glance.words.label}</strong>
        <span>
          {glance.hard} hard · {glance.soft} soft
          {glance.provisional > 0 ? ` · ${glance.provisional} not confirmed` : ''}
        </span>
      </p>
      {glance.rows.length === 0 ? (
        <Quiet>{canvas.constraints.note}</Quiet>
      ) : (
        <ul className="sw-canvas-list sw-canvas-constraints" role="list">
          {glance.rows.map((row) => (
            <li key={row.id}>
              <span className="sw-canvas-row__text">{row.statement}</span>
              <span className="sw-canvas-row__meta">
                <span className="sw-canvas-tag" data-hard={row.hardness === 'hard' || undefined}>
                  {row.hardness === 'hard' ? 'Hard' : 'Soft'}
                </span>
                <span
                  className="sw-canvas-tag"
                  data-open={row.validation !== 'confirmed' || undefined}
                >
                  {validationWords(row.validation)}
                </span>
                {row.enforcement === 'read-only' && (
                  <span className="sw-canvas-tag" data-open>
                    Read only
                  </span>
                )}
                <LabelChip label={row.label} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {(glance.more > 0 || canvas.constraints.missing.length > 0) && (
        <button type="button" className="sw-canvas-more" onClick={() => openDetail('constraints')}>
          {glance.more > 0 ? `${plural(glance.more, 'more constraint')}` : ''}
          {glance.more > 0 && canvas.constraints.missing.length > 0 ? ' and ' : ''}
          {canvas.constraints.missing.length > 0 ? 'open questions' : ''}
        </button>
      )}
    </>
  );
}

function Who({ canvas, openDetail }: Props) {
  const items = moverItems(canvas);
  if (items.length === 0) return <Quiet>No role was simulated.</Quiet>;
  return (
    <>
      <ul className="sw-canvas-list sw-canvas-who" role="list">
        {items.map((actor) => {
          const Arrow =
            actor.moves === 'toward-resistance'
              ? ArrowUp
              : actor.moves === 'toward-support'
                ? ArrowDown
                : Minus;
          const position = positionWords(actor);
          return (
            <li key={actor.actorId} data-moves={actor.moves}>
              <span className="sw-canvas-row__name">{actor.name}</span>
              <span className="sw-canvas-move">
                <Arrow size={14} aria-hidden="true" />
                <span>
                  {moveWords(actor)}
                  {changeWords(actor) ? (
                    <span className="sw-canvas-quiet-inline">
                      {' '}
                      {changeWords(actor)}
                      <span className="sr-only"> {FIGURE_UNIT}</span>
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="sw-canvas-row__sub">
                {roleName(actor)} · {alignmentWords(actor)}
                {position ? ` · ${position}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="sw-canvas-quiet">Simulated roles, not people.</p>
      {canvas.actors.items.length > items.length && (
        <button type="button" className="sw-canvas-more" onClick={() => openDetail('actors')}>
          {plural(canvas.actors.items.length - items.length, 'more role')}
        </button>
      )}
    </>
  );
}

function Changes({ canvas, openDetail }: Props) {
  const views = strip(canvas.changes.counterfactuals.views);
  const { counterfactuals } = canvas.changes;
  const inFull =
    counterfactuals.views.length > 0
      ? `${plural(counterfactuals.views.length, 'view')} in full`
      : 'What else was tried';
  return (
    <>
      {views.length > 0 ? (
        <>
          <ul
            className="sw-canvas-strip"
            role="list"
            aria-label="Counterfactual views of the proposed change"
          >
            {views.map((view) => {
              const words = viewWords(view);
              return (
                <li key={view.id} data-reverses={view.couldChangeAnswer === true || undefined}>
                  <span className="sw-canvas-row__name">
                    {view.label}
                    {view.couldChangeAnswer !== false &&
                      view.deltaVsBase !== null &&
                      !canvas.scope.aboutIndividual && (
                        <span className="sw-canvas-row__sub">{words.flag}</span>
                      )}
                  </span>
                  <span className="sw-canvas-fig num">
                    {words.effect}
                    {view.deltaVsBase !== null && <span className="sr-only"> {FIGURE_UNIT}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="sw-canvas-quiet">Change in simulated members in 100 who resist.</p>
        </>
      ) : (
        <Quiet>{counterfactuals.note}</Quiet>
      )}
      <Quiet>{sensitivityWords(canvas.changes.sensitivity)}</Quiet>
      <button type="button" className="sw-canvas-more" onClick={() => openDetail('changes')}>
        {inFull}
      </button>
    </>
  );
}

function Assumptions({ canvas, openDetail }: Props) {
  const { lines, total, more, flips, missing } = assumptionsOf(canvas);
  if (total === 0) return <Quiet>{missing ?? 'No assumption is recorded for this result.'}</Quiet>;
  return (
    <>
      <ul className="sw-canvas-list" role="list">
        {lines.map((line) => (
          <li key={line.text}>
            <span className="sw-canvas-row__text">
              {line.text} <LabelChip label={line.label} />
            </span>
          </li>
        ))}
      </ul>
      {flips > 0 && (
        <p className="sw-canvas-quiet">
          <span className="sw-canvas-flag">{reverseWords(flips)}</span>
        </p>
      )}
      <button type="button" className="sw-canvas-more" onClick={() => openDetail('assumptions')}>
        {more > 0 ? `${plural(more, 'more assumption')} in full` : 'The assumptions in full'}
      </button>
    </>
  );
}

function Next({ canvas, openDetail }: Props) {
  const card = canvas.answer.recommendation;
  const done = completenessOf(card);
  const basis = basisOf(canvas);
  const exploration = explorationOf(canvas);
  return (
    <>
      <p className="sw-canvas-next">
        {card.what.text} <LabelChip label={card.what.label} />
      </p>
      {exploration ? (
        <div className="sw-canvas-tell" role="group" aria-label={COPY.tellLabel}>
          {exploration.canTell.map((line) => (
            <p key={line.text} data-kind="can">
              <strong>{COPY.canTell}.</strong> {line.text} <LabelChip label={line.label} />
            </p>
          ))}
          {exploration.cannotTell.map((line) => (
            <p key={line.text} data-kind="cannot">
              <strong>{COPY.cannotTell}.</strong> {line.text} <LabelChip label={line.label} />
            </p>
          ))}
        </div>
      ) : (
        <>
          <p className="sw-canvas-basis">
            <strong>Rests on</strong> {basis.counts} <LabelChip label="fact" />
            {basis.level && (
              <>
                {' '}
                <span className="sw-canvas-flag">{basis.level}</span>
              </>
            )}
          </p>
          <p className="sw-canvas-complete" data-gaps={done.missing.length > 0 || undefined}>
            <strong>
              {done.stated} of {done.total} parts stated
            </strong>
            {done.missing.length > 0 ? ` · Missing: ${done.missing.join(', ')}` : ''}
          </p>
        </>
      )}
      <button type="button" className="sw-canvas-more" onClick={() => openDetail('recommendation')}>
        {exploration && exploration.more > 0
          ? `${plural(exploration.more, 'more thing')} in the recommendation in full`
          : 'The recommendation in full'}
      </button>
    </>
  );
}

function Validate({ canvas, openDetail }: Props) {
  const checks = checksOf(canvas);
  if (checks.items.length === 0) return <Quiet>No check was derived.</Quiet>;
  return (
    <>
      <ul className="sw-canvas-list sw-canvas-checks" role="list">
        {checks.items.map((item) => (
          <li key={item.id}>
            <Square size={14} aria-hidden="true" className="sw-canvas-box" />
            <span className="sw-canvas-row__text">
              <span className="sw-canvas-tag" data-hard={item.priority === 'high' || undefined}>
                {PRIORITY_WORDS[item.priority]}
              </span>{' '}
              {item.what}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="sw-canvas-more" onClick={() => openDetail('validation')}>
        {checks.more > 0 ? `${plural(checks.more, 'more check')} and ` : ''}
        {plural(canvas.validation.stopConditions.length, 'stop condition')}
      </button>
    </>
  );
}

/** The first viewport: the ten things a decision is read by, in the order it is read, answer first. */
export function Viewport({ canvas, openDetail }: Props) {
  const futureLabels = labelsOf(canvas.futures.items.map((future) => future.statement));
  const links = (
    <span className="sw-canvas-links">
      <button type="button" className="sw-canvas-more" onClick={() => openDetail('status')}>
        {COPY.whyStatus}
      </button>
      <button type="button" className="sw-canvas-more" onClick={() => openDetail('lenses')}>
        How the options compare
      </button>
    </span>
  );
  return (
    <div className="sw-canvas-grid">
      <Slot item="question" canvas={canvas}>
        <Question canvas={canvas} />
      </Slot>
      <Slot item="answer" canvas={canvas} chips={links}>
        <Answer canvas={canvas} />
      </Slot>
      <Slot item="futures" canvas={canvas} chips={<LabelsOf labels={futureLabels} />}>
        <Futures canvas={canvas} openDetail={openDetail} />
      </Slot>
      <Slot item="who" canvas={canvas} chips={<LabelChip label="simulation-event" />}>
        <Who canvas={canvas} openDetail={openDetail} />
      </Slot>
      <Slot item="constraints" canvas={canvas}>
        <Constraints canvas={canvas} openDetail={openDetail} />
      </Slot>
      <Slot item="assumptions" canvas={canvas}>
        <Assumptions canvas={canvas} openDetail={openDetail} />
      </Slot>
      <Slot item="drivers" canvas={canvas}>
        <Drivers canvas={canvas} />
      </Slot>
      <Slot item="changes" canvas={canvas}>
        <Changes canvas={canvas} openDetail={openDetail} />
      </Slot>
      <Slot item="next" canvas={canvas}>
        <Next canvas={canvas} openDetail={openDetail} />
      </Slot>
      <Slot item="validate" canvas={canvas}>
        <Validate canvas={canvas} openDetail={openDetail} />
      </Slot>
    </div>
  );
}
