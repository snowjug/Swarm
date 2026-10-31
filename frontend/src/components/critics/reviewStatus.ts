import type { CritiquesView } from '../../../../shared/critique';
import { isOutOfDate } from '../../lib/critics';

/**
 * Where the independent review stands, in a few words, from what the page has already read: it adds no
 * request. Null until the review has been read. "Not yet closed" is any criticism that has not been
 * accepted, which is what the executive answer of the brief counts too.
 */
export function reviewStatus(view: CritiquesView | null, failed = false): string | null {
  if (!view) return failed ? 'could not be read' : null;
  if (!view.critiques) return view.analysis ? 'not run yet' : 'no analysis to review yet';
  const { critiques } = view.critiques;
  const stale = isOutOfDate(view) ? ', of an earlier analysis' : '';
  if (critiques.length === 0) return `no criticism raised${stale}`;
  const open = critiques.filter((critique) => critique.status !== 'accepted').length;
  return open === 0 ? `all ${critiques.length} closed${stale}` : `${open} not yet closed${stale}`;
}
