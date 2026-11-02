import { useId } from 'react';
import { ArrowLeftRight, ArrowRight, ChevronDown, GitCompareArrows } from 'lucide-react';
import { cx } from '../../design/cx';
import { Button, Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import { setAgainst, setReference, swapPair, type Pair } from './pair';
import { PAIR_HINT, PAIR_HINT_ID } from './copy';
import type { Scenario } from './scenarios';
import './pair.css';

export interface PairControl {
  scenarios: readonly Scenario[];
  pair: Pair;
  onPair: (pair: Pair) => void;
}

const metaOf = (scenario: Scenario): string =>
  scenario.kind === 'baseline'
    ? 'Baseline: nothing changes'
    : `Lands in round ${scenario.round} · intensity ${scenario.intensity}`;

function Group({
  side,
  legend,
  control,
}: {
  side: 'a' | 'b';
  legend: string;
  control: PairControl;
}) {
  const id = useId();
  const { scenarios, pair, onPair } = control;
  const chosen = side === 'a' ? pair.a : pair.b;
  const other = side === 'a' ? pair.b : pair.a;
  return (
    <fieldset className="sw-cmp-pairpop__group">
      <legend className="sw-eyebrow">{legend}</legend>
      {scenarios.map((scenario) => {
        const taken = scenario.id === other;
        return (
          <label key={scenario.id} className="sw-cmp-pairopt" data-taken={taken || undefined}>
            <input
              type="radio"
              name={`${id}-${side}`}
              value={scenario.id}
              checked={chosen === scenario.id}
              disabled={taken}
              onChange={() =>
                onPair(
                  side === 'a'
                    ? setReference(pair, scenarios, scenario.id)
                    : setAgainst(pair, scenarios, scenario.id),
                )
              }
            />
            <span className="sw-cmp-pairopt__mark" aria-hidden="true" />
            <span className="sw-cmp-pairopt__text">
              <span className="sw-cmp-pairopt__name">{scenario.label}</span>
              <span className="sw-cmp-pairopt__meta">{metaOf(scenario)}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** What opens from a scenario's name or from the bar: which scenario is the reference and which is set against it. */
function Chooser({ control }: { control: PairControl }) {
  const { pair, onPair } = control;
  return (
    <div className="sw-cmp-pairpop">
      <Group side="b" legend="Set against" control={control} />
      <Group side="a" legend="Reference" control={control} />
      <div className="sw-cmp-pairpop__foot">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeftRight size={15} aria-hidden="true" />}
          disabled={pair.b === null}
          onClick={() => onPair(swapPair(pair))}
        >
          Swap
        </Button>
        <p className="sw-caption">
          Differences are the first set against the reference, on the same seeds.
        </p>
      </div>
    </div>
  );
}

/** What the scenario names and the pill open, said once, for anyone who cannot see the chevron. */
export function PairHint() {
  return (
    <span id={PAIR_HINT_ID} className="sr-only">
      {PAIR_HINT}
    </span>
  );
}

/**
 * The name of a scenario inside a sentence, which is also the way to change it: set in italics with a small
 * chevron, and a press opens the choice of scenarios. The sentence is the control.
 */
export function PairName({ side, control }: { side: 'a' | 'b'; control: PairControl }) {
  const scenario = control.scenarios.find(
    (entry) => entry.id === (side === 'a' ? control.pair.a : control.pair.b),
  );
  if (!scenario) return null;
  if (control.scenarios.length < 2) return <em>{scenario.label}</em>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="sw-cmp-name"
          data-side={side}
          aria-describedby={PAIR_HINT_ID}
        >
          <em>{scenario.label}</em>
          <ChevronDown className="sw-cmp-name__chevron" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent width="24rem" align="start" className="sw-cmp-pairpop-shell">
        <Chooser control={control} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The same choice from the floating bar: the pair as it stands, "reference to the one set against it". On a phone
 * there is room for one name: the one set against the reference, which the reference is read from in the choice.
 */
export function PairPill({
  control,
  className,
  compact = false,
}: {
  control: PairControl;
  className?: string;
  compact?: boolean;
}) {
  const a = control.scenarios.find((entry) => entry.id === control.pair.a);
  const b = control.scenarios.find((entry) => entry.id === control.pair.b);
  if (!a) return null;
  if (!b || control.scenarios.length < 2) {
    return <span className={cx('sw-cmp-pill', 'is-static', className)}>{a.label}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cx('sw-cmp-pill', className)}
          data-compact={compact || undefined}
          aria-describedby={PAIR_HINT_ID}
        >
          {compact ? (
            <>
              <GitCompareArrows className="sw-cmp-pill__glyph" size={16} aria-hidden="true" />
              <span className="sw-cmp-pill__name" data-side="b" aria-hidden="true">
                {b.label}
              </span>
              <span className="sr-only">
                {a.label} against {b.label}
              </span>
            </>
          ) : (
            <>
              <span className="sw-cmp-pill__name" data-side="a">
                {a.label}
              </span>
              <ArrowRight className="sw-cmp-pill__arrow" size={15} aria-hidden="true" />
              <span className="sr-only">against</span>
              <span className="sw-cmp-pill__name" data-side="b">
                {b.label}
              </span>
            </>
          )}
          <ChevronDown className="sw-cmp-pill__chevron" size={15} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent width="24rem" align="start" side="top" className="sw-cmp-pairpop-shell">
        <Chooser control={control} />
      </PopoverContent>
    </Popover>
  );
}
