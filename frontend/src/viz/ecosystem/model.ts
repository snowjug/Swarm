import type {
  Actor,
  RelationType,
  Stakeholder,
  StakeholderCategory,
  UncertaintyLevel,
} from '../../../../shared/stakeholders';
import { STAKEHOLDER_CATEGORY_LABELS } from '../../../../shared/stakeholders';
import { clusterGroup, type Direction } from '../palette';

/**
 * One party on the map, whether it is still a stakeholder (found, to be reviewed) or already an actor (made,
 * to be simulated). Everything the picture shows of it comes from these fields, which come from the project.
 */
export interface EcoNode {
  id: string;
  label: string;
  category: StakeholderCategory;
  categoryLabel: string;
  /** The cluster it gathers in. */
  cluster: string;
  /** 0 to 1: how much it weighs (an actor's influence; a stakeholder's priority). */
  weight: number;
  /** One actor of its own, or a cohort of simulated members. */
  kind: 'key' | 'cohort';
  /** Whether the change reaches it directly. Known for stakeholders; for actors only through their stakeholder. */
  direct: boolean | null;
  direction: Direction;
  /** How sure Swarm is that it belongs and what it wants: the reverse of its stated uncertainty. */
  confidence: 'low' | 'medium' | 'high';
  /** Where the person's review of a stakeholder has got to. Absent for an actor. */
  status?: Stakeholder['status'];
  /** A number to colour it by when the picture is not by direction: an actor's stance or impact. */
  value?: number;
  /** How many members a cohort simulates. */
  members?: number;
  evidenceCount: number;
  /** An empty slot where nobody was found: a place a person can add to. */
  ghost?: boolean;
}

export interface EcoEdge {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  strength: number;
}

const CONFIDENCE: Record<UncertaintyLevel, EcoNode['confidence']> = {
  low: 'high',
  medium: 'medium',
  high: 'low',
};

const PRIORITY_WEIGHT = { key: 0.88, standard: 0.55, background: 0.3 } as const;

export function nodeFromStakeholder(stakeholder: Stakeholder): EcoNode {
  const population = Math.log10(Math.max(stakeholder.populationSize, 1)) / 6;
  return {
    id: stakeholder.id,
    label: stakeholder.name,
    category: stakeholder.category,
    categoryLabel: STAKEHOLDER_CATEGORY_LABELS[stakeholder.category],
    cluster: clusterGroup(stakeholder.category).id,
    weight: Math.min(1, PRIORITY_WEIGHT[stakeholder.priority] + population * 0.08),
    kind: stakeholder.priority === 'key' ? 'key' : 'cohort',
    direct: stakeholder.directness === 'direct',
    direction: stakeholder.expectedImpact.direction,
    confidence: CONFIDENCE[stakeholder.uncertainty.level],
    status: stakeholder.status,
    evidenceCount: stakeholder.evidence.length,
  };
}

/** The direction an actor's impact trait points, as the same four words a stakeholder's expected impact uses. */
export function directionOfImpact(impact: number, spread: number): Direction {
  if (impact <= -0.08) return 'harmed';
  if (impact >= 0.08) return 'benefited';
  return spread >= 0.2 ? 'mixed' : 'unclear';
}

export function nodeFromActor(actor: Actor, stakeholder?: Stakeholder): EcoNode {
  const impact = actor.traits.impact;
  return {
    id: actor.id,
    label: actor.name,
    category: actor.category,
    categoryLabel: STAKEHOLDER_CATEGORY_LABELS[actor.category],
    cluster: clusterGroup(actor.category).id,
    weight: 0.25 + 0.75 * actor.traits.influence.value,
    kind: actor.kind,
    direct: stakeholder ? stakeholder.directness === 'direct' : null,
    direction:
      stakeholder && stakeholder.expectedImpact.direction !== 'unclear'
        ? stakeholder.expectedImpact.direction
        : directionOfImpact(impact.value, impact.spread),
    confidence: CONFIDENCE[actor.uncertainty.level],
    value: actor.traits.priorStance.value,
    members: actor.kind === 'cohort' ? actor.sampleSize : 1,
    evidenceCount: actor.evidence.length,
  };
}

export function nodesFromStakeholders(list: readonly Stakeholder[]): EcoNode[] {
  return list.filter((stakeholder) => stakeholder.status !== 'removed').map(nodeFromStakeholder);
}

export function nodesFromActors(
  actors: readonly Actor[],
  stakeholders: readonly Stakeholder[] = [],
): EcoNode[] {
  const byId = new Map(stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));
  return actors.map((actor) => nodeFromActor(actor, byId.get(actor.stakeholderId)));
}

export function edgesOf(
  relations: readonly { from: string; to: string; type: RelationType; strength: number }[],
  ids: ReadonlySet<string>,
): EcoEdge[] {
  const seen = new Set<string>();
  const edges: EcoEdge[] = [];
  for (const relation of relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to) || relation.from === relation.to) continue;
    const id = `${relation.from}>${relation.type}>${relation.to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      from: relation.from,
      to: relation.to,
      type: relation.type,
      strength: relation.strength,
    });
  }
  return edges;
}

/** The ids a node is joined to, and the relations that join them: what focusing on it shows. */
export function neighbourhood(
  id: string,
  edges: readonly EcoEdge[],
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([id]);
  const joined = new Set<string>();
  for (const edge of edges) {
    if (edge.from === id) {
      nodes.add(edge.to);
      joined.add(edge.id);
    } else if (edge.to === id) {
      nodes.add(edge.from);
      joined.add(edge.id);
    }
  }
  return { nodes, edges: joined };
}

/** What the first party of a relation is to the second. */
export const RELATION_LABEL: Record<RelationType, string> = {
  influences: 'influences',
  'competes-with': 'competes with',
  'substitutes-for': 'substitutes for',
  regulates: 'regulates',
  supplies: 'supplies',
  'depends-on': 'depends on',
  'partners-with': 'partners with',
  'buys-from': 'buys from',
};

/** The same relation read from the other end: what the party it points at is to the party it starts from. */
export const RELATION_INVERSE: Record<RelationType, string> = {
  influences: 'is influenced by',
  'competes-with': 'competes with',
  'substitutes-for': 'is replaced by',
  regulates: 'is regulated by',
  supplies: 'is supplied by',
  'depends-on': 'is relied on by',
  'partners-with': 'partners with',
  'buys-from': 'sells to',
};

/** Relations that run one way, drawn with a head; the rest are mutual. */
export const DIRECTED: ReadonlySet<RelationType> = new Set([
  'influences',
  'regulates',
  'supplies',
  'depends-on',
  'buys-from',
]);
