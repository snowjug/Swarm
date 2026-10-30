import { describe, expect, it } from 'vitest';
import initScript from '../../public/theme-init.js?raw';
import {
  PREFERENCES,
  THEMES,
  parsePreference,
  readStored,
  readSystem,
  resolveTheme,
  type SystemSettings,
} from './theme';

describe('which theme is shown', () => {
  const systems: SystemSettings[] = [
    { dark: false, moreContrast: false },
    { dark: true, moreContrast: false },
    { dark: false, moreContrast: true },
    { dark: true, moreContrast: true },
  ];

  it('honours a choice as made, whatever the device asks for', () => {
    for (const system of systems) {
      for (const theme of THEMES) expect(resolveTheme(theme, system)).toBe(theme);
    }
  });

  it('follows the device by default: more contrast first, then dark, then light', () => {
    expect(resolveTheme('system', { dark: false, moreContrast: false })).toBe('light');
    expect(resolveTheme('system', { dark: true, moreContrast: false })).toBe('dark');
    expect(resolveTheme('system', { dark: false, moreContrast: true })).toBe('high-contrast');
    expect(resolveTheme('system', { dark: true, moreContrast: true })).toBe('high-contrast');
  });

  it('takes only a known name from storage, and survives storage that throws', () => {
    for (const name of PREFERENCES) expect(parsePreference(name)).toBe(name);
    for (const bad of [null, undefined, '', 'solarized', 'DARK', 3, {}, ['dark']]) {
      expect(parsePreference(bad)).toBe('system');
    }
    expect(readStored({ getItem: () => 'dark' })).toBe('dark');
    expect(readStored({ getItem: () => null })).toBe('system');
    expect(
      readStored({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('system');
    expect(readStored(undefined)).toBe('system');
  });

  it('reads both device settings, and says "no preference" where it cannot ask', () => {
    const asked: string[] = [];
    expect(
      readSystem((query) => {
        asked.push(query);
        return { matches: query.includes('dark') };
      }),
    ).toEqual({ dark: true, moreContrast: false });
    expect(asked).toEqual(['(prefers-color-scheme: dark)', '(prefers-contrast: more)']);
    expect(readSystem(undefined)).toEqual({ dark: false, moreContrast: false });
  });
});

describe('the script that themes the page before it is drawn', () => {
  /** Runs the real script against a fake page and returns what it set. */
  function run(options: {
    stored?: string | 'throws' | null;
    dark?: boolean;
    more?: boolean;
    noMatchMedia?: boolean;
  }) {
    const set: Record<string, string> = {};
    const meta = { setAttribute: (name: string, value: string) => (set[`meta.${name}`] = value) };
    const fakeWindow = {
      localStorage: {
        getItem: () => {
          if (options.stored === 'throws') throw new Error('blocked');
          return options.stored ?? null;
        },
      },
      ...(options.noMatchMedia
        ? {}
        : {
            matchMedia: (query: string) => ({
              matches: query.includes('contrast') ? Boolean(options.more) : Boolean(options.dark),
            }),
          }),
    };
    const fakeDocument = {
      documentElement: { setAttribute: (name: string, value: string) => (set[name] = value) },
      querySelector: () => meta,
    };
    // The script is a plain file served to the browser; here it is run against a stand-in page.
    new Function('window', 'document', initScript)(fakeWindow, fakeDocument);
    return set;
  }

  it('reaches the same theme as the application does, for every choice and every device', () => {
    for (const stored of [null, 'system', 'solarized', ...THEMES]) {
      for (const dark of [false, true]) {
        for (const more of [false, true]) {
          const expected = resolveTheme(parsePreference(stored), { dark, moreContrast: more });
          expect(run({ stored, dark, more })['data-theme'], `${stored} ${dark} ${more}`).toBe(
            expected,
          );
        }
      }
    }
  });

  it('colours the browser chrome to match, and shows the light theme where nothing can be asked', () => {
    expect(run({ stored: 'dark' })['meta.content']).toBe('#1c1f24');
    expect(run({ stored: 'high-contrast' })['meta.content']).toBe('#000000');
    expect(run({ stored: 'throws', noMatchMedia: true })['data-theme']).toBe('light');
    expect(run({ noMatchMedia: true })['data-theme']).toBe('light');
  });
});
