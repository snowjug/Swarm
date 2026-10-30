export const THEMES = ['light', 'dark', 'high-contrast'] as const;
export type Theme = (typeof THEMES)[number];

export const PREFERENCES = ['system', ...THEMES] as const;
export type ThemePreference = (typeof PREFERENCES)[number];

/** Where the person's choice is kept. It holds a theme name and nothing else. */
export const THEME_STORAGE_KEY = 'swarm.theme';

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  'high-contrast': 'High contrast',
};

/** The colour of the browser's own chrome (the address bar on a phone) for each theme. */
export const THEME_COLOR: Record<Theme, string> = {
  light: '#ffffff',
  dark: '#1c1f24',
  'high-contrast': '#000000',
};

export interface SystemSettings {
  /** The system asks for a dark appearance. */
  dark: boolean;
  /** The system asks for more contrast. */
  moreContrast: boolean;
}

/** A stored value, or "system" when there is none or it is not one of the names. */
export function parsePreference(value: unknown): ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'system';
}

/**
 * The theme to show. A choice is honoured as made; "system" follows the device: more contrast first,
 * because it is a need and not a taste, then dark, then light.
 */
export function resolveTheme(preference: ThemePreference, system: SystemSettings): Theme {
  if (preference !== 'system') return preference;
  if (system.moreContrast) return 'high-contrast';
  return system.dark ? 'dark' : 'light';
}

type MediaQuery = Pick<MediaQueryList, 'matches'>;

export function readSystem(match: ((query: string) => MediaQuery) | undefined): SystemSettings {
  if (!match) return { dark: false, moreContrast: false };
  return {
    dark: match('(prefers-color-scheme: dark)').matches,
    moreContrast: match('(prefers-contrast: more)').matches,
  };
}

export function readStored(storage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  try {
    return parsePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked; the theme then follows the system.
    return 'system';
  }
}
