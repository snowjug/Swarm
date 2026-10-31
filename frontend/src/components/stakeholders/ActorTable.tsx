import { RotateCcw, Save } from 'lucide-react';
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
  const sampleProblem = actor.sampleSize > actor.size;
  return (
    <article className="stk-actor" aria-label={actor.name}>
      <header>
        <h5 className="stk-name">{actor.name}</h5>
        <ul className="stk-chips">
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
      </header>
      <p className="stk-role">{actor.role}</p>
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
      <details className="stk-traits" open>
        <summary>Traits ({TRAIT_KEYS.length})</summary>
        <table>
          <caption className="sr-only">
            Traits of {actor.name}, with where each came from and why
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
      </details>
    </article>
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
  onSave,
  onMakeAgain,
}: {
  view: ActorsView;
  working: boolean;
  canEdit: boolean;
  canRun: boolean;
  onSave: (actors: Actor[]) => Promise<boolean>;
  onMakeAgain: (confirm: boolean) => Promise<boolean>;
}) {
  const stored = view.actors?.actors ?? [];
  const [draft, setDraft] = useState<Actor[]>(stored);
  const [confirming, setConfirming] = useState(false);
  if (!view.actors) return null;
  const dirty = actorsDiffer(stored, draft);
  const invalid = draft.some((actor) => actor.sampleSize > actor.size);
  const edited = stored.filter((actor) => actor.edited).length;

  return (
    <section className="stk-actors" aria-label="Actors">
      <div className="section-heading">
        <h4>Actors ({stored.length})</h4>
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
      <div className="stk-actor-list">
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
      </div>
      {canEdit && (
        <div className="stk-buttons">
          <button
            className="button button-primary"
            type="button"
            disabled={!dirty || invalid || working}
            onClick={() => void onSave(draft)}
          >
            {working ? <Spinner label="Saving" /> : <Save size={16} aria-hidden="true" />} Save
            changes to the actors
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={!dirty || working}
            onClick={() => setDraft(stored)}
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
                  onClick={() => void onMakeAgain(true).then(() => setConfirming(false))}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Reset every actor to the category
                  priors
                </button>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => setConfirming(false)}
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
