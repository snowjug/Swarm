/** Whole-number percentage of a self-reported 0..1 firmness; null when none was recorded. */
export function firmnessPercent(confidence: number | null | undefined): number | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

export function firmnessText(confidence: number | null | undefined): string | null {
  const percent = firmnessPercent(confidence);
  return percent === null ? null : `Self-reported firmness ${percent}%`;
}

/** The label for a graph node's excerpt, naming every passage the server checked it against. */
export function nodeQuoteLabel(sourceIds: readonly string[]): string {
  const ids = [...new Set(sourceIds)];
  return ids.length
    ? `Source quote (checked verbatim against ${ids.join(', ')})`
    : 'Source quote (no cited passage recorded)';
}

/** Model-written list items, without empty entries. */
export function cleanList(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}
