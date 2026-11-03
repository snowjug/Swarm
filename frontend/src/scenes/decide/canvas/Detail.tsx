import type { ReactNode } from 'react';
import {
  ALTERNATIVE_VERDICT_WORDS,
  EPISTEMIC_LABELS,
  EPISTEMIC_LABEL_INFO,
  LENS_STANDING_WORDS,
  NO_ACTION_NOTE,
  RECOMMENDATION_PARTS,
  RECOMMENDATION_PART_WORDS,
  REVERSIBILITY_WORDS,
  STATUS_RULES,
  SYNTHETIC_ACTORS_NOTE,
  type DecisionCanvas,
  type Labelled,
  type Part,
} from '../../../../../shared/decision';
import { Disclosure } from '../../../design/ui';
import { perHundred, plural, signedPerHundred } from '../model/format';
import { LabelChip } from './parts';
import {
  COPY,
  FIGURE_UNIT,
  PRIORITY_WORDS,
  alignmentWords,
  categoryWords,
  changeWords,
  moveWords,
  positionWords,
  sensitivityWords,
  validationWords,
  viewWords,
} from './model';
import { DETAILS, type DetailId } from './details';

/** Everything the first viewport sums up, in full, folded away until it is wanted and open when printed. */

function Lines({ lines, empty }: { lines: readonly Labelled[]; empty?: string }) {
  if (lines.length === 0) return empty ? <p className="sw-canvas-quiet">{empty}</p> : null;
  return (
    <ul className="sw-canvas-detail__list">
      {lines.map((line, index) => (
        <li key={`${line.basis ?? ''}-${index}`}>
          <span>{line.text}</span> <LabelChip label={line.label} />
        </li>
      ))}
    </ul>
  );
}

function PartView({ title, part }: { title: string; part: Part }) {
  return (
    <section className="sw-canvas-part">
      <h3 className="sw-canvas-part__title">{title}</h3>
      {part.items.length > 0 ? (
        <Lines lines={part.items} />
      ) : (
        <p className="sw-canvas-missing">
          <strong>Missing.</strong> {part.missing}
        </p>
      )}
    </section>
  );
}

function Plain({ children }: { children: ReactNode }) {
  return <p className="sw-canvas-quiet">{children}</p>;
}

function Status({ canvas }: { canvas: DecisionCanvas }) {
  const { status } = canvas;
  const at = STATUS_RULES.findIndex((rule) => rule.id === status.rule);
  return (
    <>
      <p>{status.meaning}</p>
      {status.why.length > 0 && (
        <>
          <h3 className="sw-canvas-part__title">The reasons</h3>
          <ul className="sw-canvas-detail__list">
            {status.why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {status.conditions.length > 0 && (
        <>
          <h3 className="sw-canvas-part__title">It holds only while</h3>
          <ul className="sw-canvas-detail__list">
            {status.conditions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <h3 className="sw-canvas-part__title">The rules</h3>
      <p className="sw-canvas-quiet">{COPY.rulesLead}</p>
      <ol className="sw-canvas-rules" role="list">
        {STATUS_RULES.map((rule, index) => (
          <li
            key={rule.id}
            aria-current={index === at ? 'step' : undefined}
            data-applies={index === at || undefined}
          >
            <span className="sw-canvas-rules__state">
              {index === at ? 'Applies' : index < at ? 'Did not apply' : 'Not reached'}
            </span>
            <span>{rule.rule}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Lenses({ canvas }: { canvas: DecisionCanvas }) {
  const options = canvas.alternatives;
  return (
    <>
      <p>{canvas.lensAgreement.statement}</p>
      <div
        className="sw-canvas-table"
        role="region"
        aria-label="The options on each lens"
        tabIndex={0}
      >
        <table>
          <caption>
            Simulated members in 100, averaged over the seeded runs, with the lowest and highest
            run. A lens only tells two options apart by a clear gap that is larger than the
            run-to-run noise.
          </caption>
          <thead>
            <tr>
              <th scope="col">Lens</th>
              {options.map((option) => (
                <th scope="col" key={option.id}>
                  {option.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {canvas.lenses.map((lens) => (
              <tr key={lens.id}>
                <th scope="row">
                  {lens.name}
                  <span className="sw-canvas-row__sub">
                    {lens.direction === 'lower' ? 'Lower is better' : 'Higher is better'}
                  </span>
                  {lens.note ? <span className="sw-canvas-row__sub">{lens.note}</span> : null}
                </th>
                {options.map((option) => {
                  const result = lens.results.find((entry) => entry.alternativeId === option.id);
                  return (
                    <td key={option.id}>
                      {result && result.value !== null ? (
                        <>
                          <span className="sw-canvas-fig num">{perHundred(result.value)}</span>
                          {result.low !== null && result.high !== null && (
                            <span className="sw-canvas-row__sub num">
                              {perHundred(result.low)} to {perHundred(result.high)}
                            </span>
                          )}
                          <span className="sw-canvas-row__sub">
                            {LENS_STANDING_WORDS[result.standing]}
                          </span>
                          {result.detail ? (
                            <span className="sw-canvas-row__sub">{result.detail}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="sw-canvas-row__sub">
                          {lens.computable ? 'Not available' : 'Not computed'}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="sw-canvas-part__title">The options</h3>
      <ul className="sw-canvas-detail__list">
        {options.map((option) => (
          <li key={option.id}>
            <strong>{option.label}</strong> · {ALTERNATIVE_VERDICT_WORDS[option.verdict]}.{' '}
            {option.why}
          </li>
        ))}
      </ul>
      <Plain>
        The scenario’s own words about what a good outcome is, when it gave any, are context and are
        not scored:{' '}
        {canvas.question.successWording ? canvas.question.successWording.text : 'none was given'}.
      </Plain>
    </>
  );
}

function Recommendation({ canvas }: { canvas: DecisionCanvas }) {
  const card = canvas.answer.recommendation;
  return (
    <>
      <p className="sw-canvas-next">
        {card.what.text} <LabelChip label={card.what.label} />
      </p>
      {RECOMMENDATION_PARTS.slice(0, 2).map((name) => (
        <PartView key={name} title={RECOMMENDATION_PART_WORDS[name]} part={card[name]} />
      ))}
      {RECOMMENDATION_PARTS.slice(2, 7).map((name) => (
        <PartView key={name} title={RECOMMENDATION_PART_WORDS[name]} part={card[name]} />
      ))}
      <section className="sw-canvas-part">
        <h3 className="sw-canvas-part__title">
          {RECOMMENDATION_PART_WORDS.reversibility}: {REVERSIBILITY_WORDS[card.reversibility.value]}
        </h3>
        <Lines lines={[card.reversibility.statement]} />
      </section>
      <PartView title={RECOMMENDATION_PART_WORDS.approval} part={card.approval} />
      <Plain>{NO_ACTION_NOTE}</Plain>
    </>
  );
}

function Changes({ canvas }: { canvas: DecisionCanvas }) {
  const { counterfactuals, assumptions, sensitivity } = canvas.changes;
  return (
    <>
      <h3 className="sw-canvas-part__title">Counterfactual views</h3>
      <Plain>{counterfactuals.note}</Plain>
      <ul className="sw-canvas-detail__list">
        {counterfactuals.views.map((view) => {
          const words = viewWords(view);
          return (
            <li key={view.id}>
              <strong>{view.label}</strong> ·{' '}
              <span className="num">
                {words.effect}
                {view.deltaVsBase !== null ? ` ${FIGURE_UNIT}` : ''}
              </span>{' '}
              · {words.flag}. <span>{view.statement.text}</span>{' '}
              <LabelChip label={view.statement.label} />
            </li>
          );
        })}
      </ul>
      <h3 className="sw-canvas-part__title">Sensitive assumptions</h3>
      <Plain>
        {sensitivityWords(sensitivity)}
        {sensitivity.tested > 0 ? ` ${sensitivity.note}` : ''}
      </Plain>
      <ul className="sw-canvas-detail__list">
        {assumptions.map((row) => (
          <li key={row.id}>
            <span>{row.statement.text}</span> <LabelChip label={row.statement.label} />{' '}
            <span className="num">
              {signedPerHundred(row.shift)} in 100 {FIGURE_UNIT}
            </span>
            {row.flipsAnswer ? <span className="sw-canvas-flag">{COPY.couldReverse}</span> : null}
          </li>
        ))}
      </ul>
      <h3 className="sw-canvas-part__title">Moves that hold under every option and view</h3>
      <Plain>{canvas.noRegret.note}</Plain>
      <Lines lines={canvas.noRegret.moves} />
    </>
  );
}

function Constraints({ canvas }: { canvas: DecisionCanvas }) {
  const { constraints } = canvas;
  const rows = [...constraints.hard, ...constraints.soft];
  return (
    <>
      <p>{constraints.gateSummary}</p>
      {constraints.provisionalLabel ? (
        <p className="sw-canvas-flagline">{constraints.provisionalLabel}</p>
      ) : null}
      {rows.length > 0 ? (
        <div
          className="sw-canvas-table"
          role="region"
          aria-label="Constraints behind the answer"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Constraint</th>
                <th scope="col">Kind</th>
                <th scope="col">Source</th>
                <th scope="col">What kind of statement</th>
                <th scope="col">Validation</th>
                <th scope="col">In the simulation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    {row.statement}
                    {row.effects.length > 0 ? (
                      <span className="sw-canvas-row__sub">{row.effects.join('; ')}</span>
                    ) : null}
                  </th>
                  <td>
                    {row.hardness === 'hard' ? 'Hard' : 'Soft'} · {categoryWords(row.category)}
                    {row.provisional ? (
                      <span className="sw-canvas-row__sub">Not confirmed</span>
                    ) : null}
                  </td>
                  <td>{row.source}</td>
                  <td>
                    <LabelChip label={row.label} />
                  </td>
                  <td>{validationWords(row.validation)}</td>
                  <td>
                    {row.inComparison === 'applied'
                      ? COPY.run
                      : row.inComparison === 'read-only' || row.enforcement === 'read-only'
                        ? COPY.readOnly
                        : row.inComparison === 'not-in-comparison'
                          ? 'Not in the comparison'
                          : 'Not recorded'}
                    {row.violatedBy.length > 0 ? (
                      <span className="sw-canvas-row__sub">
                        Rules out {plural(row.violatedBy.length, 'option')}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Plain>{constraints.note}</Plain>
      )}
      {constraints.missing.length > 0 && (
        <>
          <h3 className="sw-canvas-part__title">Still open</h3>
          <ul className="sw-canvas-detail__list">
            {constraints.missing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {constraints.notModelled.length > 0 && (
        <>
          <h3 className="sw-canvas-part__title">Hard constraints the simulation only read</h3>
          <ul className="sw-canvas-detail__list">
            {constraints.notModelled.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Actors({ canvas }: { canvas: DecisionCanvas }) {
  const { actors } = canvas;
  return (
    <>
      <p className="sw-canvas-quiet">
        {actors.note} {SYNTHETIC_ACTORS_NOTE}
      </p>
      <div className="sw-canvas-table" role="region" aria-label="Every simulated role" tabIndex={0}>
        <table>
          <caption>
            Simulated roles under {actors.focusLabel ?? 'the option shown'}
            {actors.baselineLabel ? `, against ${actors.baselineLabel}` : ''}. Changes are in
            simulated members in 100.
          </caption>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Position</th>
              <th scope="col">Where it ends up</th>
              <th scope="col">Change in those resisting</th>
              <th scope="col">Influence</th>
              <th scope="col">Uncertainty</th>
              <th scope="col">Direction of impact rests on</th>
            </tr>
          </thead>
          <tbody>
            {actors.items.map((actor) => (
              <tr key={actor.actorId}>
                <th scope="row">
                  {actor.name}
                  <span className="sw-canvas-row__sub">{actor.role}</span>
                </th>
                <td>{positionWords(actor) ?? 'No say'}</td>
                <td>{alignmentWords(actor)}</td>
                <td>
                  {moveWords(actor)}
                  {changeWords(actor) ? (
                    <span className="sw-canvas-row__sub num">{changeWords(actor)}</span>
                  ) : null}
                </td>
                <td>{actor.influence}</td>
                <td>{actor.uncertainty}</td>
                <td>
                  <LabelChip label={actor.directionBasis.label} />
                  <span className="sw-canvas-row__sub">
                    {actor.cited ? 'A passage is cited' : 'No passage is cited'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actors.items.some((actor) => actor.plausibleActions.length > 0) && (
        <>
          <h3 className="sw-canvas-part__title">
            What a role could plausibly do (proposed, not observed)
          </h3>
          <ul className="sw-canvas-detail__list">
            {actors.items
              .filter((actor) => actor.plausibleActions.length > 0)
              .map((actor) => (
                <li key={actor.actorId}>
                  <strong>{actor.name}</strong>: {actor.plausibleActions.join('; ')}{' '}
                  <LabelChip label="model-inference" />
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}

function Validation({ canvas }: { canvas: DecisionCanvas }) {
  const { validation } = canvas;
  return (
    <>
      <Plain>{COPY.checklistLead}</Plain>
      <ol className="sw-canvas-checklist">
        {validation.items.map((item) => (
          <li key={item.id}>
            <span className="sw-canvas-checklist__what">{item.what}</span>
            <span className="sw-canvas-row__meta">
              <span className="sw-canvas-tag" data-hard={item.priority === 'high' || undefined}>
                {PRIORITY_WORDS[item.priority]}
              </span>
              <span className="sw-canvas-tag">{item.kind}</span>
              <LabelChip label={item.label} />
            </span>
            <p>
              <strong>Why.</strong> {item.why}
            </p>
            <p>
              <strong>How.</strong> {item.how}
            </p>
          </li>
        ))}
      </ol>
      <h3 className="sw-canvas-part__title">Stop and rethink if</h3>
      <ul className="sw-canvas-detail__list">
        {validation.stopConditions.map((stop) => (
          <li key={stop.id}>
            <strong>{stop.when}</strong> {stop.then}{' '}
            <span className="sw-canvas-quiet-inline">{stop.basis}</span>
          </li>
        ))}
      </ul>
      <Plain>{validation.note}</Plain>
    </>
  );
}

function Evidence({ canvas }: { canvas: DecisionCanvas }) {
  const { evidence, uncertainty, timing, reversibility, question } = canvas;
  return (
    <>
      <Plain>{COPY.basedOn}</Plain>
      <h3 className="sw-canvas-part__title">The question as framed</h3>
      <p>
        <strong>As it was asked.</strong> {question.asked}
      </p>
      <Plain>What follows is what Swarm made of it. None of it is a fact about the world.</Plain>
      <Lines
        lines={[
          question.decision,
          question.baseline,
          ...(question.horizon ? [question.horizon] : []),
          ...(question.geography ? [question.geography] : []),
        ]}
      />
      {question.system ? <Plain>The system it is about: {question.system}</Plain> : null}
      <p>
        <strong>Evidence: {evidence.level}.</strong> {evidence.reasons.join(' ')}
      </p>
      <Lines lines={evidence.statements} />
      <h3 className="sw-canvas-part__title">How far the simulation can be relied on</h3>
      <Lines lines={uncertainty.reasons} />
      <Plain>{uncertainty.note}</Plain>
      <h3 className="sw-canvas-part__title">Timing and reversibility</h3>
      <Lines
        lines={[
          ...(timing.horizon ? [timing.horizon] : []),
          timing.lands,
          ...timing.constraints,
          reversibility.statement,
        ]}
      />
      <h3 className="sw-canvas-part__title">Risks the simulation showed</h3>
      <Lines lines={canvas.risks} empty="No group’s resistance rose clearly in the simulation." />
      <h3 className="sw-canvas-part__title">Opportunities the simulation showed</h3>
      <Lines
        lines={canvas.opportunities}
        empty="No group’s resistance fell clearly in the simulation."
      />
      <h3 className="sw-canvas-part__title">How each option was set up</h3>
      <ul className="sw-canvas-detail__list">
        {canvas.interventions.map((entry) => (
          <li key={entry.alternativeId}>
            <strong>{entry.label}</strong>
            <Lines lines={[...entry.changes, entry.setting]} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Review({ canvas }: { canvas: DecisionCanvas }) {
  const { critic } = canvas;
  return (
    <>
      <p>{critic.note}</p>
      <ul className="sw-canvas-detail__list">
        {critic.challenges.map((challenge) => (
          <li key={challenge.id}>
            <strong>
              {challenge.roleLabel} · {challenge.severity} · {challenge.status}
            </strong>
            <span>
              {' '}
              Objection: “{challenge.objection.text}”{' '}
              <LabelChip label={challenge.objection.label} />
            </span>
            {challenge.impact ? (
              <span className="sw-canvas-row__sub">If it stands: {challenge.impact}</span>
            ) : null}
            {challenge.requestedAction ? (
              <span className="sw-canvas-row__sub">It asks for: {challenge.requestedAction}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function Approvals({ canvas }: { canvas: DecisionCanvas }) {
  return (
    <>
      <ul className="sw-canvas-detail__list">
        {canvas.approvals.map((point) => (
          <li key={point.id}>
            <strong>
              {point.stage === 'before-simulation' ? 'Before the simulation' : 'Before acting'}.
            </strong>{' '}
            {point.text}{' '}
            <span className="sw-canvas-tag" data-hard={point.state === 'open' || undefined}>
              {point.state === 'done' ? 'Recorded' : 'Open'}
            </span>
          </li>
        ))}
      </ul>
      <p>{canvas.highStakes.note}</p>
      <Plain>
        {NO_ACTION_NOTE} {SYNTHETIC_ACTORS_NOTE}
      </Plain>
    </>
  );
}

/** What the labels mean, for the person who is not holding a pointer. */
export function Legend() {
  return (
    <dl className="sw-canvas-legend">
      {EPISTEMIC_LABELS.map((label) => (
        <div key={label}>
          <dt>
            <LabelChip label={label} />
          </dt>
          <dd>{EPISTEMIC_LABEL_INFO[label].meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

const BODIES: Record<DetailId, (props: { canvas: DecisionCanvas }) => ReactNode> = {
  status: Status,
  lenses: Lenses,
  recommendation: Recommendation,
  changes: Changes,
  constraints: Constraints,
  actors: Actors,
  validation: Validation,
  evidence: Evidence,
  review: Review,
  approvals: Approvals,
  labels: Legend,
};

export function Detail({
  canvas,
  open,
  onOpenChange,
}: {
  canvas: DecisionCanvas;
  open: ReadonlySet<DetailId>;
  onOpenChange: (id: DetailId, open: boolean) => void;
}) {
  return (
    <div className="sw-canvas-detail">
      {DETAILS.map((entry) => {
        const Body = BODIES[entry.id];
        return (
          <section
            key={entry.id}
            id={`canvas-detail-${entry.id}`}
            className="sw-canvas-detail__item"
            data-detail={entry.id}
          >
            <Disclosure
              heading={2}
              tone="strong"
              open={open.has(entry.id)}
              onOpenChange={(next) => onOpenChange(entry.id, next)}
              summary={
                <span className="sw-canvas-detail__summary">
                  <span className="sw-canvas-detail__title">{entry.title}</span>
                  <span className="sw-canvas-detail__lead">{entry.lead}</span>
                </span>
              }
            >
              <div className="sw-canvas-detail__body">
                <Body canvas={canvas} />
              </div>
            </Disclosure>
          </section>
        );
      })}
    </div>
  );
}
