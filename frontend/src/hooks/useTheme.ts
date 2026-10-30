import { useCallback, useEffect, useState } from 'react';
import {
  THEME_COLOR,
  THEME_STORAGE_KEY,
  readStored,
  readSystem,
  resolveTheme,
  type SystemSettings,
  type Theme,
  type ThemePreference,
} from '../lib/theme';

const match = (): ((query: string) => MediaQueryList) | undefined =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? (query) => window.matchMedia(query)
    : undefined;

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

/**
 * The colour theme: the person's choice (kept in this browser only) or, by default, the device's.
 * The page is already themed before this runs (see `public/theme-init.js`), so there is no flash.
 */
export function useTheme(): {
  preference: ThemePreference;
  theme: Theme;
  choose: (next: ThemePreference) => void;
} {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readStored(typeof localStorage === 'undefined' ? undefined : localStorage),
  );
  const [system, setSystem] = useState<SystemSettings>(() => readSystem(match()));

  useEffect(() => {
    const matcher = match();
    if (!matcher) return;
    const queries = [matcher('(prefers-color-scheme: dark)'), matcher('(prefers-contrast: more)')];
    const update = () => setSystem(readSystem(matcher));
    for (const query of queries) query.addEventListener('change', update);
    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);

  const theme = resolveTheme(preference, system);
  useEffect(() => apply(theme), [theme]);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The choice then lasts until the page is closed.
    }
  }, []);

  return { preference, theme, choose };
}
