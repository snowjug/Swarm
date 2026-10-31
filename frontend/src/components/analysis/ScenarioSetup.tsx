import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { Variant } from '../../../../shared/analysis';
import {
  MAX_VARIANTS,
  RUNS_PER_VARIANT_CHOICES,
  USER_SET_NOTE,
  type AnalysisReadiness,
  type StartAnalysisInput,
} from '../../../../shared/analysis-plan';
import { describeEdit, estimateText, setupProblems } from '../../lib/analysis';
import { Notice, Spinner } from '../ui';

/** The scenarios of a comparison, as a person may edit them. Numbers are kept as typed until they are used. */
interface Row {
  variant: Variant;
  intensity: string;
  round: string;
}

type RowPatch = { label?: string; intensity?: string; round?: string };

export interface SetupSettings {
  variants: Variant[];
  runsPerVariant: number;
  sensitivity: boolean;
  baseSeed?: number;
  rounds?: number;
}

const toRow = (variant: Variant): Row => ({
  variant,
  intensity: String(variant.intensity),
  round: String(variant.round),
});

function VariantRow({
  row,
  index,
  canRemove,
  disabled,
  rounds,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  canRemove: boolean;
  disabled: boolean;
  rounds: number;
  onChange: (patch: RowPatch) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const baseline = row.variant.kind === 'baseline';
  return (
    <li className="analysis-variant">
      <div className="analysis-variant-head">
        <span className="analysis-kind">{baseline ? 'Baseline' : `Alternative ${index}`}</span>
        {canRemove && (
          <button
            className="text-button"
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${row.variant.label || 'this scenario'}`}
          >
            Remove
          </button>
        )}
      </div>
      <div className="analysis-variant-fields">
        <div className="field">
          <label htmlFor={`${id}-label`}>Name</label>
          <input
            id={`${id}-label`}
            value={row.variant.label}
            maxLength={120}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </div>
        {baseline ? (
          <p className="analysis-baseline-note">
            Nothing changes: intensity 0, so this shows where the simulated members stand without
            the change.
          </p>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`${id}-intensity`}>How strongly it lands (0 to 1)</label>
              <input
                id={`${id}-intensity`}
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step={0.05}
                value={row.intensity}
                disabled={disabled}
                onChange={(event) => onChange({ intensity: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-round`}>Starts in round (1 to {rounds})</label>
              <input
                id={`${id}-round`}
                type="number"
                inputMode="numeric"
                min={1}
                max={rounds}
                step={1}
                value={row.round}
                disabled={disabled}
                onChange={(event) => onChange({ round: event.target.value })}
              />
            </div>
          </>
        )}
      </div>
      {row.variant.description && <p className="field-help">{row.variant.description}</p>}
    </li>
  );
}

/**
 * The scenarios to compare, how many seeded runs of each, and whether to test the sensitivity of the
 * proposed change to its assumptions, with what that will cost said before anything is run.
 */
export function ScenarioSetup({
  readiness,
  initial,
  lastWallMs,
  starting,
  error,
  submitLabel = 'Compare scenarios',
  onStart,
}: {
  readiness: AnalysisReadiness;
  initial?: SetupSettings;
  lastWallMs: number | null;
  starting: boolean;
  error: string | null;
  submitLabel?: string;
  onStart: (input: StartAnalysisInput) => void;
}) {
  const id = useId();
  const original = initial?.variants ?? readiness.suggestedVariants;
  const [rows, setRows] = useState<Row[]>(() => original.map(toRow));
  const [runs, setRuns] = useState(initial?.runsPerVariant ?? 30);
  const [sensitivity, setSensitivity] = useState(initial?.sensitivity ?? true);
  const rounds = initial?.rounds ?? readiness.rounds;

  const parsed: Variant[] = rows.map((row) => ({
    ...row.variant,
    intensity: row.variant.kind === 'baseline' ? 0 : Number(row.intensity),
    round: row.variant.kind === 'baseline' ? row.variant.round : Number(row.round),
  }));
  const problems = setupProblems(parsed, runs, sensitivity, readiness.perturbations, rounds);
  const mayRun = readiness.may.run;
  const choices: number[] = [...RUNS_PER_VARIANT_CHOICES];
  if (!choices.includes(runs)) choices.push(runs);
  choices.sort((a, b) => a - b);
  const alternatives = rows.filter((row) => row.variant.kind === 'alternative').length;

  const update = (index: number, patch: RowPatch) =>
    setRows((old) =>
      old.map((row, at) =>
        at === index
          ? {
              ...row,
              ...(patch.intensity === undefined ? {} : { intensity: patch.intensity }),
              ...(patch.round === undefined ? {} : { round: patch.round }),
              ...(patch.label === undefined
                ? {}
                : { variant: { ...row.variant, label: patch.label } }),
            }
          : row,
      ),
    );

  const add = () =>
    setRows((old) => {
      const used = new Set(old.map((row) => row.variant.id));
      let number = old.length;
      while (used.has(`alternative-${number}`)) number += 1;
      return [
        ...old,
        toRow({
          id: `alternative-${number}`,
          label: `Alternative ${alternatives + 1}`,
          kind: 'alternative',
          description: `Added by you. Intensity 0.5 from round 2 ${USER_SET_NOTE}.`,
          round: Math.min(2, rounds),
          intensity: 0.5,
          impactOverrides: {},
          traitEdits: [],
        }),
      ];
    });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (problems.length > 0 || !mayRun || starting) return;
    onStart({
      runsPerVariant: runs,
      sensitivity,
      variants: parsed.map((variant) => ({
        ...variant,
        label: variant.label.trim(),
        description: describeEdit(
          variant,
          original.find((candidate) => candidate.id === variant.id),
        ),
      })),
      ...(initial?.baseSeed === undefined ? {} : { baseSeed: initial.baseSeed }),
      ...(initial?.rounds === undefined ? {} : { rounds: initial.rounds }),
    });
  };

  return (
    <form
      className="analysis-setup"
      noValidate
      onSubmit={submit}
      aria-describedby={`${id}-estimate ${id}-problems`}
    >
      <p className="field-help">
        Each scenario runs on the same seeds, so that every run of a change can be compared with the
        run of the baseline that shares its randomness. How strongly a change lands is an assumption
        the system made unless you edit it here.
      </p>
      <ol className="analysis-variants" aria-label="Scenarios to compare">
        {rows.map((row, index) => (
          <VariantRow
            key={row.variant.id}
            row={row}
            index={index}
            rounds={rounds}
            disabled={starting || !mayRun}
            canRemove={row.variant.kind === 'alternative' && alternatives > 1}
            onChange={(patch) => update(index, patch)}
            onRemove={() => setRows((old) => old.filter((_, at) => at !== index))}
          />
        ))}
      </ol>
      <div className="analysis-setup-actions">
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={add}
          disabled={starting || !mayRun || rows.length >= MAX_VARIANTS}
        >
          Add an alternative
        </button>
      </div>
      <div className="analysis-setup-options">
        <div className="field">
          <label htmlFor={`${id}-runs`}>Seeded runs of each scenario</label>
          <select
            id={`${id}-runs`}
            value={runs}
            disabled={starting || !mayRun}
            onChange={(event) => setRuns(Number(event.target.value))}
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice} runs
              </option>
            ))}
          </select>
        </div>
        <label className="analysis-switch">
          <input
            type="checkbox"
            checked={sensitivity}
            disabled={starting || !mayRun}
            onChange={(event) => setSensitivity(event.target.checked)}
          />
          <span>
            Also test which assumptions the result is sensitive to
            <small>Moves one assumption at a time and re-runs the same seeds.</small>
          </span>
        </label>
      </div>
      <p id={`${id}-estimate`} className="analysis-estimate">
        {estimateText(
          {
            variants: rows.length,
            runsPerVariant: runs,
            sensitivity,
            perturbations: readiness.perturbations,
          },
          lastWallMs,
        )}
      </p>
      <div id={`${id}-problems`} aria-live="polite">
        {problems.length > 0 && (
          <ul className="analysis-problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {error && (
          <Notice tone="error" title="The comparison did not start">
            {error}
          </Notice>
        )}
        {!mayRun && (
          <Notice tone="info" title="You can read comparisons but not start one">
            Starting a comparison needs a role that may run the project, such as analyst or lead.
          </Notice>
        )}
      </div>
      <div className="stage-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={problems.length > 0 || !mayRun || starting}
        >
          {starting && <Spinner label="Starting the comparison" />} {submitLabel}
        </button>
      </div>
    </form>
  );
}
