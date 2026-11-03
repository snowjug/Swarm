import type { FigureSpec } from '../Figures';
import type { GroundResearch } from './context';
import { countersOf } from './model';

/**
 * The four figures of research, in the place of the four of the evidence while research is what the page is about:
 * what has been read, what became a source, how many sites, and whether anything conflicts. A count the run has not
 * reached is a dash, and never a guess.
 */
export function researchFigures(
  research: GroundResearch,
  onConflicts: (() => void) | null,
): FigureSpec[] {
  const { presence, showResearch } = research;
  const run = presence.kind === 'run' ? presence.run : null;
  const known = presence.kind === 'run' || presence.kind === 'empty';
  const counted = countersOf(run);
  const conflicts = counted.conflicts;
  return [
    {
      id: 'pages',
      label: 'Pages read',
      value: known ? counted.pagesRead : null,
      tip: 'Pages fetched and read so far',
      onPress: run ? showResearch : null,
    },
    {
      id: 'used',
      label: 'Sources used',
      value: known ? counted.sourcesUsed : null,
      tip: 'Pages kept as sources for the exploration',
      onPress: run ? showResearch : null,
    },
    {
      id: 'sites',
      label: 'Sites',
      value: known ? counted.sites : null,
      tip: 'Different sites read',
      onPress: null,
    },
    {
      id: 'conflicts',
      label: 'Conflicts',
      value: conflicts,
      note: conflicts === null ? undefined : conflicts === 0 ? 'none found' : 'to review',
      tone: conflicts ? 'caution' : undefined,
      reserve: true,
      tip: 'Passages that give different figures',
      onPress: conflicts ? onConflicts : null,
    },
  ];
}
