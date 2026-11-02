import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowRight, Info, Minus, Plus, X } from 'lucide-react';
import type { Variant } from '../../../../shared/analysis';
import {
  MAX_VARIANTS,
  RUNS_PER_VARIANT_CHOICES,
  USER_SET_NOTE,
  planRuns,
  type AnalysisReadiness,
  type StartAnalysisInput,
} from '../../../../shared/analysis-plan';
import { NO_DIRECTION_NOTICE, UNDIRECTED_NOTICE } from '../../../../shared/signal';
import { SPRING } from '../../design/motion';
import {
  Button,
  Disclosure,
  IconButton,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  Slider,
  Switch,
} from '../../design/ui';
import {
  ESTIMATE_BASIS,
  describeEdit,
  estimateText,
  estimateWallText,
  setupProblems,
} from '../../lib/analysis';
import './setup.css';

interface Row {
  variant: Variant;
  intensity: number;
  round: number;
}

export interface SetupSettings {
  variants: Variant[];
  runsPerVariant: number;
  sensitivity: boolean;
  baseSeed?: number;
  rounds?: number;
}

const toRow = (variant: Variant): Row => ({
  variant,
  intensity: variant.intensity,
  round: variant.round,
});

/** A whole number moved up or down by a press: a place for a round, where typing is slower than pressing. */
function Stepper({
  value,
  min,
  max,
  label,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="sw-step" role="group" aria-label={label}>
      <IconButton
        label={`Earlier: ${label}`}
        size="sm"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        tooltip={false}
      >
        <Minus size={15} aria-hidden="true" />
      </IconButton>
      <output className="sw-step__value sw-numeral" aria-live="polite">
        {value}
      </output>
      <IconButton
        label={`Later: ${label}`}
        size="sm"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        tooltip={false}
      >
        <Plus size={15} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function Lane({
  row,
  index,
  rounds,
  about,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  rounds: number;
  /** What the scenario is, as it will be saved: where it came from and whether its strength is the system's or the person's. */
  about: string;
  disabled: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<Pick<Row, 'intensity' | 'round'>> & { label?: string }) => void;
  onRemove: () => void;
}) {
  const baseline = row.variant.kind === 'baseline';
  const id = useId();
  return (
    <m.li
      layout="position"
      className="sw-lane"
      data-kind={row.variant.kind}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
      transition={SPRING.smooth}
    >
      <div className="sw-lane__who">
        <span className="sw-lane__dot" aria-hidden="true" />
        {baseline ? (
          <span className="sw-lane__name">{row.variant.label}</span>
        ) : (
          <>
            <label htmlFor={`${id}-name`} className="sr-only">
              Name of scenario {index}
            </label>
            <input
              id={`${id}-name`}
              className="sw-lane__input"
              value={row.variant.label}
              maxLength={120}
              disabled={disabled}
              autoComplete="off"
              onChange={(event) => onChange({ label: event.target.value })}
            />
          </>
        )}
        <span className="sw-lane__kind">
          {baseline ? 'Baseline' : index === 1 ? 'Proposed' : `Alternative ${index - 1}`}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              label={`About ${row.variant.label || 'this scenario'}`}
              size="sm"
              className="sw-lane__about"
            >
              <Info size={15} aria-hidden="true" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent width="22rem" align="end">
            <p className="sw-eyebrow">About this scenario</p>
            <p className="sw-lane__aboutText">{about}</p>
          </PopoverContent>
        </Popover>
      </div>
      {baseline ? (
        <p className="sw-lane__note">
          Nothing changes: shows where the simulated members stand without it.
        </p>
      ) : (
        <div className="sw-lane__controls">
          <div className="sw-lane__field">
            <span className="sw-lane__label" id={`${id}-int`}>
              How strongly it lands
            </span>
            <div className="sw-lane__slider">
              <Slider
                value={row.intensity}
                min={0}
                max={1}
                step={0.05}
                label={`How strongly ${row.variant.label || 'this scenario'} lands`}
                valueText={`${row.intensity.toFixed(2)} of 1`}
                disabled={disabled}
                onValueChange={(value) => onChange({ intensity: Math.round(value * 100) / 100 })}
              />
              <output className="sw-lane__num sw-numeral">{row.intensity.toFixed(2)}</output>
            </div>
          </div>
          <div className="sw-lane__field">
            <span className="sw-lane__label">From round</span>
            <Stepper
              value={row.round}
              min={1}
              max={rounds}
              label={`Round the change starts in for ${row.variant.label || 'this scenario'}`}
              disabled={disabled}
              onChange={(value) => onChange({ round: value })}
            />
          </div>
        </div>
      )}
      {canRemove && (
        <IconButton
          label={`Remove ${row.variant.label || 'this scenario'}`}
          size="sm"
          className="sw-lane__remove"
          disabled={disabled}
          onClick={onRemove}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      )}
    </m.li>
  );
}

export interface SetupProps {
  readiness: AnalysisReadiness;
  initial?: SetupSettings;
  lastWallMs: number | null;
  starting: boolean;
  error: string | null;
  submitLabel?: string;
  onStart: (input: StartAnalysisInput) => void;
  onOpenMap: () => void;
  /** When this is opened from results, a way back to them. */
  onBack?: () => void;
}

/**
 * The few choices behind a simulation: which scenarios to set against each other, how strongly the change lands in each
 * and from which round, how many seeded runs of each, and whether to test which assumptions the result leans on. The
 * defaults are the ones the system made from the question; a person who changes them is saying so, and it is recorded.
 */
export function Setup({
  readiness,
  initial,
  lastWallMs,
  starting,
  error,
  submitLabel = 'Run the simulation',
  onStart,
  onOpenMap,
  onBack,
}: SetupProps) {
  const id = useId();
  const original = initial?.variants ?? readiness.suggestedVariants;
  const [rows, setRows] = useState<Row[]>(() => original.map(toRow));
  const [runs, setRuns] = useState(initial?.runsPerVariant ?? 30);
  const [sensitivity, setSensitivity] = useState(initial?.sensitivity ?? true);
  const rounds = initial?.rounds ?? readiness.rounds;
  const members = readiness.actors?.members ?? 0;
  const may = readiness.may.run;

  const parsed: Variant[] = useMemo(
    () =>
      rows.map((row) => ({
        ...row.variant,
        intensity: row.variant.kind === 'baseline' ? 0 : row.intensity,
        round: row.variant.kind === 'baseline' ? row.variant.round : row.round,
      })),
    [rows],
  );
  const described = useMemo(
    () =>
      parsed.map((variant) =>
        describeEdit(
          variant,
          original.find((candidate) => candidate.id === variant.id),
        ),
      ),
    [parsed, original],
  );
  const problems = setupProblems(parsed, runs, sensitivity, readiness.perturbations, rounds);
  const plan = planRuns({
    variants: rows.length,
    runsPerVariant: runs,
    sensitivity,
    perturbations: readiness.perturbations,
  });
  const wall = estimateWallText({
    variants: rows.length,
    runsPerVariant: runs,
    sensitivity,
    perturbations: readiness.perturbations,
    members,
    rounds,
  });
  const choices: number[] = [...RUNS_PER_VARIANT_CHOICES];
  if (!choices.includes(runs)) choices.push(runs);
  choices.sort((a, b) => a - b);
  const alternatives = rows.filter((row) => row.variant.kind === 'alternative').length;

  const update = (
    index: number,
    patch: Partial<Pick<Row, 'intensity' | 'round'>> & { label?: string },
  ) =>
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
    if (problems.length > 0 || !may || starting) return;
    onStart({
      runsPerVariant: runs,
      sensitivity,
      variants: parsed.map((variant, index) => ({
        ...variant,
        label: variant.label.trim(),
        description: described[index] ?? variant.description,
      })),
      ...(initial?.baseSeed === undefined ? {} : { baseSeed: initial.baseSeed }),
      ...(initial?.rounds === undefined ? {} : { rounds: initial.rounds }),
    });
  };

  return (
    <section className="sw-setup" aria-labelledby={`${id}-title`}>
      <m.form
        className="sw-setup__panel sw-glass sw-glass--overlay"
        noValidate
        onSubmit={submit}
        initial={{ opacity: 0, y: 24, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING.gentle}
        aria-describedby={`${id}-estimate ${id}-problems`}
      >
        <header className="sw-setup__head">
          <p className="sw-eyebrow">Simulate</p>
          <h1 id={`${id}-title`} className="sw-display">
            Set the futures <em>side by side</em>
          </h1>
          <p className="sw-setup__lead">
            Every scenario runs on the same seeds, so the only difference between them is the
            change.
          </p>
        </header>

        {readiness.warnings.map((warning) => {
          const stuck = warning === NO_DIRECTION_NOTICE;
          const known = stuck || warning === UNDIRECTED_NOTICE;
          return (
            <Notice
              key={warning}
              tone="caution"
              title={
                stuck
                  ? 'Nothing in this change can move anyone yet'
                  : known
                    ? 'No stakeholder has an expected direction yet'
                    : undefined
              }
              action={
                known ? (
                  <Button size="sm" variant="glass" onClick={onOpenMap}>
                    Review stakeholders
                  </Button>
                ) : undefined
              }
            >
              {warning}{' '}
              {known &&
                (stuck
                  ? 'You can still run it: it then shows only how much the simulation varies by chance.'
                  : 'You can still run it: what it shows follows from those assumptions.')}
            </Notice>
          );
        })}

        <ol className="sw-setup__lanes" aria-label="Scenarios to compare">
          <AnimatePresence initial={false}>
            {rows.map((row, index) => (
              <Lane
                key={row.variant.id}
                row={row}
                index={index}
                rounds={rounds}
                about={described[index] ?? ''}
                disabled={starting || !may}
                canRemove={row.variant.kind === 'alternative' && alternatives > 1}
                onChange={(patch) => update(index, patch)}
                onRemove={() => setRows((old) => old.filter((_, at) => at !== index))}
              />
            ))}
          </AnimatePresence>
        </ol>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus size={15} aria-hidden="true" />}
          onClick={add}
          disabled={starting || !may || rows.length >= MAX_VARIANTS}
          className="sw-setup__add"
        >
          Add an alternative
        </Button>

        <div className="sw-setup__options">
          <div className="sw-setup__runs">
            <span className="sw-lane__label">Seeded runs of each</span>
            <Segmented<string>
              size="sm"
              label="Seeded runs of each scenario"
              value={String(runs)}
              onChange={(value) => setRuns(Number(value))}
              options={choices.map((choice) => ({ value: String(choice), label: String(choice) }))}
            />
          </div>
          <Switch
            checked={sensitivity}
            disabled={starting || !may}
            onChange={(event) => setSensitivity(event.target.checked)}
            label="Test which assumptions it leans on"
            description="Moves one assumption at a time and runs the same seeds again."
          />
        </div>

        <p id={`${id}-estimate`} className="sw-setup__estimate">
          <b>{plan.totalRuns.toLocaleString('en-GB')}</b> simulated runs
          <span aria-hidden="true"> · </span>
          {rows.length} scenarios × {runs}
          {plan.sensitivityRuns > 0 && (
            <> + {plan.sensitivityRuns.toLocaleString('en-GB')} for sensitivity</>
          )}
          {wall && (
            <>
              <span aria-hidden="true"> · </span>
              {wall}
            </>
          )}
        </p>

        <div id={`${id}-problems`} aria-live="polite" className="sw-setup__problems">
          {problems.length > 0 && (
            <ul>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {error && (
            <Notice tone="error" title="The simulation did not start">
              {error}
            </Notice>
          )}
          {!may && (
            <Notice tone="info" title="You can read simulations but not start one">
              Starting one needs a role that may run the project, such as analyst or lead.
            </Notice>
          )}
        </div>

        <footer className="sw-setup__foot sw-glass sw-glass--overlay">
          {onBack && (
            <Button variant="ghost" onClick={onBack} type="button">
              Back to the results
            </Button>
          )}
          <Button
            type="submit"
            variant="accent"
            size="lg"
            busy={starting}
            busyLabel="Starting"
            disabled={problems.length > 0 || !may}
            iconEnd={<ArrowRight size={18} aria-hidden="true" />}
            data-focus-key="run"
          >
            {submitLabel}
          </Button>
        </footer>

        <Disclosure summary="How long this takes, and what it costs" className="sw-setup__how">
          <p className="sw-caption">
            {estimateText(
              {
                variants: rows.length,
                runsPerVariant: runs,
                sensitivity,
                perturbations: readiness.perturbations,
                members,
                rounds,
              },
              lastWallMs,
            )}
          </p>
          {members > 0 && <p className="sw-caption">{ESTIMATE_BASIS}</p>}
          <p className="sw-caption">
            How strongly a change lands is an assumption the system made unless you edit it here.
            Everything counts simulated members and seeded runs; none of it is a rate of anything
            real.
          </p>
        </Disclosure>
      </m.form>
    </section>
  );
}
