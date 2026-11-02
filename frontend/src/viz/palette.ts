import type { StakeholderCategory } from '../../../shared/stakeholders';

/** The diverging scale of stance: against (ember) through neutral to in favour (teal). Any value is valid. */
export function stanceColor(value: number, scale = 0.5): string {
  if (!Number.isFinite(value)) return 'var(--c-neutral)';
  // A mild curve: small moves are seen, and the largest still reaches the full colour.
  const share = Math.min(1, Math.abs(value) / Math.max(scale, 0.01)) ** 0.8;
  const percent = Math.round(share * 1000) / 10;
  const end = value < 0 ? 'var(--c-against)' : 'var(--c-favor)';
  return `color-mix(in oklab, ${end} ${percent}%, var(--c-neutral))`;
}

/** The words for a stance, so that colour is never the only thing said. */
export function stanceWord(value: number, scale = 0.5): string {
  const share = value / Math.max(scale, 0.01);
  if (share <= -0.66) return 'against';
  if (share <= -0.2) return 'leaning against';
  if (share < 0.2) return 'undecided';
  if (share < 0.66) return 'leaning in favour';
  return 'in favour';
}

export type Direction = 'harmed' | 'benefited' | 'mixed' | 'unclear';

export const DIRECTION_LABEL: Record<Direction, string> = {
  harmed: 'Harmed',
  benefited: 'Benefits',
  mixed: 'Mixed',
  unclear: 'Unclear',
};

/**
 * The colour of a party by what it is expected to suffer. A party whose effect is not known is not painted
 * with a verdict: it takes a quiet tint of its own group, so that the ones that carry a reading stand out.
 */
export const directionColor = (direction: Direction, cluster?: string): string =>
  direction === 'harmed'
    ? 'var(--c-against)'
    : direction === 'benefited'
      ? 'var(--c-favor)'
      : direction === 'mixed'
        ? 'var(--c-caution)'
        : cluster
          ? `color-mix(in oklab, ${clusterColour(cluster)} 52%, var(--eco-quiet, var(--c-neutral)))`
          : 'var(--c-neutral)';

/** Several categories share one cluster and one colour, so that a map of fourteen kinds reads as a few groups. */
export interface ClusterGroup {
  id: string;
  label: string;
  /** The custom property holding the group's colour. */
  colour: string;
}

const GROUPS: Record<
  string,
  { label: string; colour: string; members: readonly StakeholderCategory[] }
> = {
  decide: { label: 'Decide', colour: '--cat-1', members: ['decision-maker', 'governance'] },
  use: { label: 'Use & benefit', colour: '--cat-2', members: ['end-user', 'beneficiary'] },
  bear: { label: 'Bear cost & risk', colour: '--cat-3', members: ['cost-bearer', 'risk-bearer'] },
  reach: { label: 'Influence & reach', colour: '--cat-4', members: ['influencer', 'channel'] },
  rival: { label: 'Rivals', colour: '--cat-5', members: ['competitor', 'substitute'] },
  work: { label: 'Partners & operations', colour: '--cat-6', members: ['partner', 'operations'] },
  rules: { label: 'Regulators', colour: '--cat-7', members: ['regulator'] },
  other: { label: 'Others', colour: '--cat-8', members: ['other'] },
};

export function clusterGroup(category: StakeholderCategory): ClusterGroup {
  for (const [id, group] of Object.entries(GROUPS)) {
    if (group.members.includes(category)) return { id, label: group.label, colour: group.colour };
  }
  return { id: 'other', label: GROUPS.other!.label, colour: GROUPS.other!.colour };
}

export const clusterColour = (id: string): string => `var(${GROUPS[id]?.colour ?? '--cat-8'})`;

export const clusterLabel = (id: string): string => GROUPS[id]?.label ?? GROUPS.other!.label;

/** The same names where the canvas has little room: a group's name is the first word or two of its long one. */
const SHORT_LABELS: Record<string, string> = {
  bear: 'Cost & risk',
  reach: 'Influence',
  work: 'Partners',
  use: 'Use',
};
export const clusterShortLabel = (id: string): string => SHORT_LABELS[id] ?? clusterLabel(id);

/** The ids of the groups, in the order they are listed in filters and legends. */
export const CLUSTER_ORDER: readonly string[] = Object.keys(GROUPS);

/** A category that stands for a group, for places that only know the group. */
export const groupCategory = (id: string): StakeholderCategory => GROUPS[id]?.members[0] ?? 'other';
