import { Contrast } from 'lucide-react';
import { PREFERENCES, THEME_LABELS, type ThemePreference } from '../lib/theme';

/** Chooses the colour theme. A native select: it is keyboard and screen-reader accessible as it is. */
export function ThemeSwitch({
  preference,
  onChoose,
}: {
  preference: ThemePreference;
  onChoose: (next: ThemePreference) => void;
}) {
  return (
    <label className="theme-switch">
      <Contrast size={14} aria-hidden="true" />
      <span className="sr-only">Colour theme</span>
      <select
        value={preference}
        onChange={(event) => onChoose(event.target.value as ThemePreference)}
        data-testid="theme-select"
      >
        {PREFERENCES.map((option) => (
          <option key={option} value={option}>
            {THEME_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
