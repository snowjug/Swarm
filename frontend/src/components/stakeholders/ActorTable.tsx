import { ChevronRight, RotateCcw, Save } from 'lucide-react';
import { useId, useState } from 'react';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  TRAIT_KEYS,
  TRAIT_MEANINGS,
  type Actor,
  type ActorsView,
  type TraitKey,
} from '../../../../shared/stakeholders';
import { Notice, Spinner } from '../ui';
import { OriginBadge } from './Chips';
import type { ReviewHooks } from './focus';
import { TRAIT_LABELS, TRAIT_ORIGIN_LABELS, formatDate } from './labels';
import { actorsDiffer, changedTraits, moveTrait, traitRange, traitText } from './review';

function TraitRow({
  actor,
  stored,
  traitKey,
  disabled,
  onMove,
}: {
  actor: Actor;
  stored: Actor;
  traitKey: TraitKey;
  disabled: boolean;
  onMove: (value: number) => void;
}) {
  const id = useId();
  const trait = actor.traits[traitKey];
  const moved = changedTraits(stored, actor).has(traitKey);
  const origin = moved ? 'user' : trait.origin;
  const { min, max } = traitRange(traitKey);
  return (
    <tr>
      <th scope="row">
        <label htmlFor={id}>{TRAIT_LABELS[traitKey]}</label>
        <span className="stk-hint">{TRAIT_MEANINGS[traitKey]}</span>
      </th>
      <td className="stk-slider">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={trait.value}
          disabled={disabled}
          aria-label={`${TRAIT_LABELS[traitKey]} of ${actor.name}`}
          aria-valuetext={`${traitText(traitKey, trait.value)}, ${TRAIT_ORIGIN_LABELS[origin]}`}
          onChange={(event) => onMove(Number(event.target.value))}
        />
        <output htmlFor={id}>{traitText(traitKey, trait.value)}</output>
      </td>
      <td>
        <OriginBadge origin={origin} />
      </td>
      <td className="stk-why-cell">{moved ? 'Changed by you; not saved yet.' : trait.rationale}</td>
    </tr>
  );
}

/**
 * One actor as a line: its name, what kind it is, and its role. Opening it shows what it wants and
 * fears, and every trait on a slider with where the number came from and why.
 */
function ActorCard({
  actor,
  stored,
  disabled,
  onChange,
}: {
  actor: Actor;
  stored: Actor;
  disabled: boolean;
  onChange: (next: Actor) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const sampleProblem = actor.sampleSize > actor.size;
  return (
    <li className="stk-actor">
      <div className="stk-row-head">
        <h5 className="stk-row-title">
          <button
            type="button"
            className="stk-row-toggle"
            aria-expanded={open}
            aria-controls={`${id}-detail`}
            data-stk-focus={`actor:${actor.id}`}
            onClick={() => setOpen((old) => !old)}
          >
            <ChevronRight className="stk-chevron" size={14} aria-hidden="true" />
            <span className="stk-name">{actor.name}</span>
          </button>
        </h5>
        <ul className="stk-chips" aria-label={`About the actor ${actor.name}`}>
          <li>
            <span className="stk-pill">{actor.kind === 'key' ? 'Key actor' : 'Cohort'}</span>
          </li>
          <li>
            <span className="stk-pill">{STAKEHOLDER_CATEGORY_LABELS[actor.category]}</span>
          </li>
          {(actor.edited || actorsDiffer([stored], [actor])) && (
            <li>
              <span className="stk-pill stk-pill-you">Edited by you</span>
            </li>
          )}
        </ul>
      </div>
      <p className="stk-why">{actor.role}</p>
      <div id={`${id}-detail`} className="stk-detail" hidden={!open}>
        {actor.kind === 'cohort' && (
          <div className="stk-cohort fields-grid">
            <div className="field">
              <label htmlFor={`${id}-size`}>Stands for about (an assumption)</label>
              <input
                id={`${id}-size`}
                type="number"
                min={1}
                max={1_000_000}
                value={actor.size}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...actor,
                    size: Math.max(1, Math.round(Number(event.target.value) || 1)),
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-sample`}>Simulated members</label>
              <input
                id={`${id}-sample`}
                type="number"
                min={1}
                max={200}
                value={actor.sampleSize}
                disabled={disabled}
                aria-invalid={sampleProblem ? true : undefined}
                onChange={(event) =>
                  onChange({
                    ...actor,
                    sampleSize: Math.min(
                      200,
                      Math.max(1, Math.round(Number(event.target.value) || 1)),
                    ),
                  })
                }
              />
              {sampleProblem && (
                <small className="stk-problem" role="alert">
                  A cohort cannot simulate more members than it stands for.
                </small>
              )}
            </div>
          </div>
        )}
        {(actor.objectives.length > 0 || actor.concerns.length > 0) && (
          <p className="stk-hint">
            What it wants and fears is assumed from its category, or read by a model: it is not
            found in the sources.
          </p>
        )}
        <ul className="stk-wants">
          {actor.objectives.map((text, index) => (
            <li key={`o${index}`}>
              <strong>Wants:</strong> {text}
            </li>
          ))}
          {actor.concerns.map((text, index) => (
            <li key={`c${index}`}>
              <strong>Concerned about:</strong> {text}
            </li>
          ))}
          {actor.constraints.map((text, index) => (
            <li key={`k${index}`}>
              <strong>Limited by:</strong> {text}
            </li>
          ))}
          {actor.dependencies.map((text, index) => (
            <li key={`d${index}`}>
              <strong>Relies on:</strong> {text}
            </li>
          ))}
        </ul>
        <p className="stk-belief">
          <strong>Starting belief:</strong> {actor.priorBelief}
        </p>
        <div className="stk-traits">
          <table>
            <caption className="stk-label">
              Traits ({TRAIT_KEYS.length}){' '}
              <span className="sr-only">of {actor.name}, with where each came from and why</span>
            </caption>
            <thead>
              <tr>
                <th scope="col">Trait</th>
                <th scope="col">Value</th>
                <th scope="col">Origin</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {TRAIT_KEYS.map((key) => (
                <TraitRow
                  key={key}
                  actor={actor}
                  stored={stored}
                  traitKey={key}
                  disabled={disabled}
                  onMove={(value) => onChange(moveTrait(actor, key, value))}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </li>
  );
}

/**
 * The cast the engine will run, with every trait on a slider, labelled with where it came from and
 * why. Changes are held here until they are saved, so that a slider can be dragged freely; saving
 * sends them all, and the server marks what is the person's.
 */
export function ActorTable({
  view,
  working,
  canEdit,
  canRun,
  hooks,
  onSave,
  onMakeAgain,
}: {
  view: ActorsView;
  working: boolean;
  canEdit: boolean;
  canRun: boolean;
  hooks: ReviewHooks;
  onSave: (actors: Actor[]) => Promise<boolean>;
  onMakeAgain: (confirm: boolean) => Promise<boolean>;
}) {
  const stored = view.actors?.actors ?? [];
  const headingId = useId();
  const [draft, setDraft] = useState<Actor[]>(stored);
  const [confirming, setConfirming] = useState(false);
  if (!view.actors) return null;
  const dirty = actorsDiffer(stored, draft);
  const invalid = draft.some((actor) => actor.sampleSize > actor.size);
  const edited = stored.filter((actor) => actor.edited).length;
  // The button that was pressed is disabled or gone once the work is done, so focus goes to the heading.
  const done = (message: string): void => {
    hooks.focus(['region:actors']);
    hooks.say(message);
  };

  return (
    <section className="stk-actors" aria-labelledby={headingId}>
      <div className="section-heading">
        <h4 id={headingId} tabIndex={-1} data-stk-focus="region:actors">
          Actors ({stored.length})
        </h4>
        <span className="stk-hint">Made {formatDate(view.actors.generatedAt)}</span>
      </div>
      <p className="stk-note">{view.actors.note}</p>
      <p className="stk-truth">
        These actors are synthetic. Sizes say how many members a cohort stands for in the model, and
        are assumptions, not counts of real people. Each trait says where it came from: an
        assumption from the category, the evidence, a model, or you.
      </p>
      {view.stale && (
        <Notice tone="warning" title="These actors are out of date">
          The stakeholders changed after these actors were made. Approve the list if it is not
          approved, then use “Reset all actors…” to make them again from it. The simulation uses the
          actors as they are now.
        </Notice>
      )}
      <ul className="stk-rows" aria-label="Actors">
        {draft.map((actor) => {
          const was = stored.find((candidate) => candidate.id === actor.id) ?? actor;
          return (
            <ActorCard
              key={actor.id}
              actor={actor}
              stored={was}
              disabled={!canEdit || working}
              onChange={(next) =>
                setDraft((old) => old.map((item) => (item.id === next.id ? next : item)))
              }
            />
          );
        })}
      </ul>
      {canEdit && (
        <div className="stk-buttons">
          <button
            className="button button-primary"
            type="button"
            disabled={!dirty || invalid || working}
            onClick={() =>
              void onSave(draft).then((saved) => {
                if (saved) done('Saved your changes to the actors.');
              })
            }
          >
            {working ? <Spinner label="Saving" /> : <Save size={16} aria-hidden="true" />} Save
            changes to the actors
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={!dirty || working}
            onClick={() => {
              setDraft(stored);
              done('Discarded the changes that were not saved.');
            }}
          >
            Discard unsaved changes
          </button>
        </div>
      )}
      {canRun && (
        <div className="stk-reset">
          {confirming ? (
            <div className="view-stack">
              <p className="field-help">
                This makes every actor again from the approved stakeholders
                {edited > 0 ? ` and replaces the changes you made to ${edited} of them` : ''}.
              </p>
              <div className="stk-buttons">
                <button
                  className="button button-danger button-small"
                  type="button"
                  disabled={working}
                  onClick={() =>
                    void onMakeAgain(true).then((made) => {
                      setConfirming(false);
                      if (made) done('Made every actor again from the approved stakeholders.');
                    })
                  }
                >
                  <RotateCcw size={14} aria-hidden="true" /> Reset every actor to the category
                  priors
                </button>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    hooks.focus(['reset-actors']);
                  }}
                >
                  Keep the actors as they are
                </button>
              </div>
            </div>
          ) : (
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={working}
              data-stk-focus="reset-actors"
              onClick={() => setConfirming(true)}
            >
              <RotateCcw size={14} aria-hidden="true" /> Reset all actors…
            </button>
          )}
        </div>
      )}
    </section>
  );
}
