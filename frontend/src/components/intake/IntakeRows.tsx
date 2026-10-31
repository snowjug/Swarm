import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ScenarioVariable } from '../../../../shared/scenario';
import { LIMITS, blankChange } from '../../lib/intake';

/** One labelled control: a line of text, or a few lines, with help text that a screen reader hears. */
export function IntakeField({
  id,
  label,
  help,
  value,
  max,
  disabled = false,
  multiline = false,
  required = false,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  max: number;
  disabled?: boolean;
  multiline?: boolean;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="intake-required"> (required)</span>}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          maxLength={max}
          value={value}
          disabled={disabled}
          aria-describedby={helpId}
          aria-required={required || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          autoComplete="off"
          maxLength={max}
          value={value}
          disabled={disabled}
          aria-describedby={helpId}
          aria-required={required || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {help && (
        <small id={helpId} className="field-help">
          {help}
        </small>
      )}
    </div>
  );
}

/**
 * The rows of a list a person can add to and take from. A new row takes focus, and taking one away
 * returns focus to the control that adds one, so that a keyboard is never left on nothing.
 */
function useRowFocus(idBase: string) {
  const [focus, setFocus] = useState<number | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus === null) return;
    document.getElementById(`${idBase}-${focus}`)?.focus();
    setFocus(null);
  }, [focus, idBase]);
  return { add, focusRow: setFocus, focusAdd: () => add.current?.focus() };
}

/** The changes of a scenario, or of one alternative: what varies, from what, to what. */
export function VariableRows({
  rows,
  noun = 'change',
  max = LIMITS.changes,
  disabled = false,
  onChange,
}: {
  rows: readonly ScenarioVariable[];
  noun?: string;
  max?: number;
  disabled?: boolean;
  onChange: (rows: ScenarioVariable[]) => void;
}) {
  const base = useId();
  const { add, focusRow, focusAdd } = useRowFocus(`${base}-name`);
  const update = (index: number, patch: Partial<ScenarioVariable>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <div className="intake-rows">
      {rows.length === 0 && <p className="field-help">No {noun}s listed.</p>}
      <ul className="intake-list">
        {rows.map((row, index) => {
          const name = `${noun} ${index + 1}`;
          return (
            <li key={index} className="intake-row">
              <div className="intake-row-fields" role="group" aria-label={name}>
                <IntakeField
                  id={`${base}-name-${index}`}
                  label={`Name of ${name}`}
                  value={row.name}
                  max={LIMITS.variableName}
                  disabled={disabled}
                  onChange={(value) => update(index, { name: value })}
                />
                <div className="intake-pair">
                  <IntakeField
                    id={`${base}-from-${index}`}
                    label="From"
                    value={row.from ?? ''}
                    max={LIMITS.variableValue}
                    disabled={disabled}
                    onChange={(value) => update(index, { from: value || null })}
                  />
                  <IntakeField
                    id={`${base}-to-${index}`}
                    label="To"
                    value={row.to ?? ''}
                    max={LIMITS.variableValue}
                    disabled={disabled}
                    onChange={(value) => update(index, { to: value || null })}
                  />
                </div>
                <IntakeField
                  id={`${base}-note-${index}`}
                  label="Note (optional)"
                  value={row.note}
                  max={LIMITS.variableNote}
                  disabled={disabled}
                  onChange={(value) => update(index, { note: value })}
                />
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={disabled}
                aria-label={`Remove ${name}${row.name ? `: ${row.name}` : ''}`}
                onClick={() => {
                  onChange(rows.filter((_, position) => position !== index));
                  focusAdd();
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        ref={add}
        type="button"
        className="button button-secondary button-small"
        disabled={disabled || rows.length >= max}
        onClick={() => {
          onChange([...rows, blankChange()]);
          focusRow(rows.length);
        }}
      >
        <Plus size={14} aria-hidden="true" /> Add a {noun}
      </button>
    </div>
  );
}

/** A list of short texts, such as the groups likely to be affected. */
export function TextRows({
  rows,
  noun,
  label,
  max,
  maxLength,
  disabled = false,
  onChange,
}: {
  rows: readonly string[];
  noun: string;
  label: string;
  max: number;
  maxLength: number;
  disabled?: boolean;
  onChange: (rows: string[]) => void;
}) {
  const base = useId();
  const { add, focusRow, focusAdd } = useRowFocus(`${base}-text`);
  return (
    <div className="intake-rows">
      {rows.length === 0 && <p className="field-help">No {noun}s listed.</p>}
      <ul className="intake-list">
        {rows.map((row, index) => (
          <li key={index} className="intake-row intake-row-single">
            <div className="field">
              <label htmlFor={`${base}-text-${index}`} className="sr-only">
                {label} {index + 1}
              </label>
              <input
                id={`${base}-text-${index}`}
                type="text"
                autoComplete="off"
                maxLength={maxLength}
                value={row}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    rows.map((item, position) => (position === index ? event.target.value : item)),
                  )
                }
              />
            </div>
            <button
              type="button"
              className="icon-button"
              disabled={disabled}
              aria-label={`Remove ${noun} ${index + 1}${row ? `: ${row}` : ''}`}
              onClick={() => {
                onChange(rows.filter((_, position) => position !== index));
                focusAdd();
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        ref={add}
        type="button"
        className="button button-secondary button-small"
        disabled={disabled || rows.length >= max}
        onClick={() => {
          onChange([...rows, '']);
          focusRow(rows.length);
        }}
      >
        <Plus size={14} aria-hidden="true" /> Add a {noun}
      </button>
    </div>
  );
}
