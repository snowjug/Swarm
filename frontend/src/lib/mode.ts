export const UI_MODES = ['guided', 'advanced'] as const;
export type UiMode = (typeof UI_MODES)[number];

/** Where the person's choice is kept. It holds a mode name and nothing else. */
export const MODE_STORAGE_KEY = 'swarm.mode';

export const MODE_LABELS: Record<UiMode, string> = { guided: 'Guided', advanced: 'Advanced' };

/** What each mode changes, for the switch to say so. */
export const MODE_SUMMARIES: Record<UiMode, string> = {
  guided: 'Plain-language help under each step.',
  advanced: 'Engine terms and diagnostics, open by default.',
};

/** A stored value, or Guided when there is none or it is not one of the names. */
export function parseMode(value: unknown): UiMode {
  return typeof value === 'string' && (UI_MODES as readonly string[]).includes(value)
    ? (value as UiMode)
    : 'guided';
}

export function readStoredMode(storage: Pick<Storage, 'getItem'> | undefined): UiMode {
  try {
    return parseMode(storage?.getItem(MODE_STORAGE_KEY));
  } catch {
    // Storage can be blocked; the mode is then Guided.
    return 'guided';
  }
}
