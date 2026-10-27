import { useEffect, useId, useState } from 'react';

export function GraphRoundControl({
  round,
  completed,
  onChange,
}: {
  round: number;
  completed: number;
  onChange: (round: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!playing) return;
    if (round >= completed) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => onChange(round + 1), 1_000);
    return () => clearTimeout(timer);
  }, [playing, round, completed, onChange]);
  return (
    <div className="graph-evolution">
      <p id={`${id}-help`}>
        Recorded memory overlays by round — the source graph itself is static.
      </p>
      <label htmlFor={id}>Round</label>
      <input
        id={id}
        type="range"
        min={0}
        max={completed}
        step={1}
        value={round}
        disabled={completed === 0}
        aria-describedby={`${id}-help`}
        aria-valuetext={`Round ${round} of ${completed} recorded rounds`}
        onChange={(event) => {
          setPlaying(false);
          onChange(Number(event.target.value));
        }}
      />
      <output htmlFor={id} aria-live="polite" aria-atomic="true">
        Round {round} / {completed}
      </output>
      <div className="stage-actions">
        <button
          className="button button-secondary"
          type="button"
          disabled={round === 0}
          onClick={() => {
            setPlaying(false);
            onChange(round - 1);
          }}
        >
          Previous round
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={round >= completed}
          onClick={() => {
            setPlaying(false);
            onChange(round + 1);
          }}
        >
          Next round
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={!completed}
          aria-pressed={playing}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (round >= completed) onChange(0);
              setPlaying(true);
            }
          }}
        >
          {playing ? 'Pause recorded replay' : 'Play recorded rounds'}
        </button>
      </div>
      {completed === 0 && (
        <p className="field-help">
          No simulation rounds are saved yet. Only recorded round-0 seed inputs can be shown;
          playback is disabled.
        </p>
      )}
      {completed > 0 && round === 0 && (
        <p className="field-help">Previous is disabled at the seed boundary, round 0.</p>
      )}
      {completed > 0 && round >= completed && (
        <p className="field-help">
          Next is disabled at the latest saved round. Play restarts recorded replay from round 0.
        </p>
      )}
      <p className="field-help">
        Playback only changes the selected recorded round. It does not execute, accelerate or invent
        simulation activity.
      </p>
    </div>
  );
}
