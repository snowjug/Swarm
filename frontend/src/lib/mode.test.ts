import { describe, expect, it } from 'vitest';
import {
  MODE_LABELS,
  MODE_STORAGE_KEY,
  MODE_SUMMARIES,
  UI_MODES,
  parseMode,
  readStoredMode,
} from './mode';

describe('the interface mode', () => {
  it('is kept under swarm.mode and is Guided or Advanced, nothing else', () => {
    expect(MODE_STORAGE_KEY).toBe('swarm.mode');
    expect(UI_MODES).toEqual(['guided', 'advanced']);
    for (const mode of UI_MODES) {
      expect(MODE_LABELS[mode]).toBeTruthy();
      expect(MODE_SUMMARIES[mode]).toBeTruthy();
    }
  });

  it('is Guided unless Advanced was chosen, whatever else is stored', () => {
    expect(parseMode('advanced')).toBe('advanced');
    expect(parseMode('guided')).toBe('guided');
    for (const value of [null, undefined, '', 'expert', 'ADVANCED', 7, {}, ['advanced']])
      expect(parseMode(value)).toBe('guided');
  });

  it('reads the stored choice, and falls back to Guided when storage is missing or blocked', () => {
    expect(
      readStoredMode({ getItem: (key) => (key === MODE_STORAGE_KEY ? 'advanced' : null) }),
    ).toBe('advanced');
    expect(readStoredMode({ getItem: () => null })).toBe('guided');
    expect(readStoredMode(undefined)).toBe('guided');
    expect(
      readStoredMode({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('guided');
  });
});
