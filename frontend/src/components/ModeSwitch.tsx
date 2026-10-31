import { MODE_LABELS, MODE_SUMMARIES, UI_MODES, type UiMode } from '../lib/mode';

/** Guided or Advanced. Two buttons, one of them pressed: it works the same from the keyboard and by touch. */
export function ModeSwitch({ mode, onChoose }: { mode: UiMode; onChoose: (next: UiMode) => void }) {
  return (
    <div className="segmented mode-switch" role="group" aria-label="Interface mode">
      {UI_MODES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          title={MODE_SUMMARIES[option]}
          onClick={() => onChoose(option)}
        >
          {MODE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
