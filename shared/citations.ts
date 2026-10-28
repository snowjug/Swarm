import { z } from 'zod';

/**
 * Identifier lists a model attaches as citations.
 *
 * A list that is merely too long is trimmed, after removing duplicates, instead of rejected. A real
 * model overshoots such caps often, and rejecting the whole reply for it costs a corrective retry
 * each time until a stage fails. Trimming is safe because dropping a citation can only remove
 * claimed provenance, never add any, and every identifier that remains is still checked against
 * what was actually supplied. `hardMax` still bounds how much is read at all.
 */
export function trimmedIds<T extends z.ZodType<string>>(
  element: T,
  max: number,
  options: { min?: number; hardMax?: number } = {},
) {
  const { min = 0, hardMax = Math.max(max * 4, 24) } = options;
  return z
    .array(element)
    .min(min)
    .max(hardMax)
    .transform((ids) => [...new Set(ids)].slice(0, max));
}
