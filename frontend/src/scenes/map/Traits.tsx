import { useId } from 'react';
import {
  TRAIT_KEYS,
  TRAIT_MEANINGS,
  type Actor,
  type TraitKey,
} from '../../../../shared/stakeholders';
import { Field, Input, Slider } from '../../design/ui';
import { stanceWord } from '../../viz/palette';
import { TRAIT_LABELS, TRAIT_ORIGIN_LABELS } from '../../lib/stakeholders/labels';
import { changedTraits, traitRange, traitText } from '../../lib/stakeholders/review';
import { OriginChip } from './parts';

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
  const signed = min < 0;
  const words = traitKey === 'priorStance' ? stanceWord(trait.value, 1) : null;
  return (
    <li className="sw-trait">
      <div className="sw-trait__head">
        <span id={id} className="sw-trait__label">
          {TRAIT_LABELS[traitKey]}
        </span>
        <output className="sw-trait__value sw-mono" aria-hidden="true">
          {traitText(traitKey, trait.value)}
        </output>
        <OriginChip origin={origin} />
      </div>
      <Slider
        value={trait.value}
        min={min}
        max={max}
        step={0.05}
        diverging={signed}
        disabled={disabled}
        label={`${TRAIT_LABELS[traitKey]} of ${actor.name}`}
        valueText={`${traitText(traitKey, trait.value)}${words ? `, ${words}` : ''}, ${TRAIT_ORIGIN_LABELS[origin]}`}
        onValueChange={onMove}
      />
      <p className="sw-trait__why">
        {moved ? 'Changed by you; not saved yet.' : trait.rationale || TRAIT_MEANINGS[traitKey]}
      </p>
    </li>
  );
}

/**
 * Every number the engine will use for one actor, on a slider, each with where it came from and why. Nothing
 * is an unexplained input: a trait is an assumption from the category, a reading of the evidence, a model's,
 * or the person's, and it says which.
 */
export function Traits({
  actor,
  stored,
  disabled,
  onMove,
  onChange,
}: {
  actor: Actor;
  stored: Actor;
  disabled: boolean;
  onMove: (key: TraitKey, value: number) => void;
  onChange: (next: Actor) => void;
}) {
  const sampleProblem = actor.sampleSize > actor.size;
  return (
    <div className="sw-traits">
      {actor.kind === 'cohort' && (
        <div className="sw-traits__size">
          <Field label="Stands for about" hint="An assumption, not a count of real people.">
            <Input
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
          </Field>
          <Field
            label="Simulated members"
            error={
              sampleProblem
                ? 'A cohort cannot simulate more members than it stands for.'
                : undefined
            }
          >
            <Input
              type="number"
              min={1}
              max={200}
              value={actor.sampleSize}
              disabled={disabled}
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
          </Field>
        </div>
      )}
      <ul
        className="sw-traits__list"
        aria-label={`Traits of ${actor.name}, with where each came from and why`}
      >
        {TRAIT_KEYS.map((key) => (
          <TraitRow
            key={key}
            actor={actor}
            stored={stored}
            traitKey={key}
            disabled={disabled}
            onMove={(value) => onMove(key, value)}
          />
        ))}
      </ul>
    </div>
  );
}
