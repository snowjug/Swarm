import { useId } from 'react';
import type { Intervention } from '../../../../shared/types';

export function InterventionFields({
  value,
  minRound,
  maxRound,
  disabled = false,
  onChange,
}: {
  value: Intervention;
  minRound: number;
  maxRound: number;
  disabled?: boolean;
  onChange: (value: Intervention) => void;
}) {
  const id = useId();
  return (
    <fieldset className="intervention-fields" disabled={disabled || minRound > maxRound}>
      <legend>Scheduled assumption at a round boundary</legend>
      <div className="field">
        <label htmlFor={`${id}-round`}>Apply before round</label>
        <select
          id={`${id}-round`}
          value={value.round}
          onChange={(event) => onChange({ ...value, round: Number(event.target.value) })}
        >
          {Array.from(
            { length: Math.max(0, maxRound - minRound + 1) },
            (_, index) => minRound + index,
          ).map((round) => (
            <option value={round} key={round}>
              Round {round}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-label`}>Intervention label / assumed event (5–300 characters)</label>
        <textarea
          id={`${id}-label`}
          rows={3}
          minLength={5}
          maxLength={300}
          value={value.label}
          onChange={(event) => onChange({ ...value, label: event.target.value })}
        />
      </div>
      <div className="fields-grid">
        <div className="field">
          <label htmlFor={`${id}-stance`}>Assumed stance (−1 to +1)</label>
          <input
            id={`${id}-stance`}
            type="number"
            min={-1}
            max={1}
            step={0.01}
            value={value.stance}
            aria-describedby={`${id}-stance-help`}
            onChange={(event) => onChange({ ...value, stance: Number(event.target.value) })}
          />
          <small id={`${id}-stance-help`}>
            Unitless inclination: −1 opposing, 0 neutral, +1 supporting.
          </small>
        </div>
        <div className="field">
          <label htmlFor={`${id}-strength`}>Assumed strength (0–1)</label>
          <input
            id={`${id}-strength`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value.strength}
            aria-describedby={`${id}-strength-help`}
            onChange={(event) => onChange({ ...value, strength: Number(event.target.value) })}
          />
          <small id={`${id}-strength-help`}>
            Unitless rule/model input; 0 has no strength, 1 is the maximum. Not a measured
            real-world effect.
          </small>
        </div>
      </div>
    </fieldset>
  );
}
