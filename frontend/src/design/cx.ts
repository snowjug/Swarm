/** Joins class names, skipping anything that is not a string. */
export function cx(...parts: unknown[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}
