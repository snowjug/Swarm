import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import {
  RELATION_WORDS,
  RUN_HINT,
  RUN_HINT_ID,
  chooseRun,
  type RunChoice,
  type RunPair,
} from './runs';
import './pair.css';

function Group({
  side,
  legend,
  choices,
  pair,
  onPair,
}: {
  side: 'base' | 'other';
  legend: string;
  choices: readonly RunChoice[];
  pair: RunPair;
  onPair: (pair: RunPair) => void;
}) {
  const id = useId();
  return (
    <fieldset className="sw-cmp-pairpop__group">
      <legend className="sw-eyebrow">{legend}</legend>
      {choices.map((choice) => (
        <label key={choice.id} className="sw-cmp-pairopt">
          <input
            type="radio"
            name={`${id}-${side}`}
            value={choice.id}
            checked={pair[side] === choice.id}
            onChange={() => onPair(chooseRun(pair, side, choice.id))}
          />
          <span className="sw-cmp-pairopt__mark" aria-hidden="true" />
          <span className="sw-cmp-pairopt__text">
            <span className="sw-cmp-pairopt__name">{choice.name}</span>
            <span className="sw-cmp-pairopt__meta">
              {RELATION_WORDS[choice.relation]} · {choice.rounds}{' '}
              {choice.rounds === 1 ? 'saved round' : 'saved rounds'}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** What the run names open, said once, for anyone who cannot see the chevron. */
export function RunHint() {
  return (
    <span id={RUN_HINT_ID} className="sr-only">
      {RUN_HINT}
    </span>
  );
}

/**
 * The name of a recorded run inside a sentence, which is also the way to choose the runs: a press opens both choices.
 * Choosing the run that is on the other side swaps the two, so there is never a run set against itself.
 */
export function RunName({
  name,
  side,
  choices,
  pair,
  onPair,
}: {
  name: string;
  side: 'base' | 'other';
  choices: readonly RunChoice[];
  pair: RunPair;
  onPair: (pair: RunPair) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="sw-cmp-name"
          data-side={side}
          aria-describedby={RUN_HINT_ID}
        >
          <em>{name}</em>
          <ChevronDown className="sw-cmp-name__chevron" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent width="26rem" align="start" className="sw-cmp-pairpop-shell">
        <div className="sw-cmp-pairpop">
          <Group side="other" legend="Other run" choices={choices} pair={pair} onPair={onPair} />
          <Group side="base" legend="Base run" choices={choices} pair={pair} onPair={onPair} />
          <p className="sw-caption sw-cmp-pairpop__foot-note">
            Differences are the other run minus the base run, round by round.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
