import {
  STAKEHOLDER_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
  type Actor,
  type ActorSet,
  type Stakeholder,
  type StakeholderCategory,
  type StakeholderSet,
  type UncertaintyLevel,
} from '../../../../shared/stakeholders';
import { clusterGroup, clusterLabel, CLUSTER_ORDER } from '../../viz/palette';
import {
  RELATION_INVERSE,
  RELATION_LABEL,
  edgesOf,
  nodesFromActors,
  nodesFromStakeholders,
  type EcoEdge,
  type EcoNode,
} from '../../viz/ecosystem/model';
import { liveStakeholders, orderForReview } from '../../lib/stakeholders/review';

/** What the map is a picture of: the parties found, or the actors made from them. */
export type Subject = 'stakeholders' | 'actors';

/** A place nobody was found for: a kind of party, or a role the evidence hints at, that may be missing. */
export interface Ghost {
  id: string;
  label: string;
  cluster: string;
  /** The category to start an added stakeholder from. */
  category: StakeholderCategory;
  /** The few words as they were written, when the gap is a role and not a kind. */
  text: string | null;
}

export interface MapModel {
  nodes: EcoNode[];
  edges: EcoEdge[];
  ghosts: Ghost[];
}

const MAX_GHOSTS = 5;
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);

/** Gaps as places on the map. A kind that is already shown by a node of its group is not a gap on the map. */
export function ghostsOf(gaps: readonly string[], present: readonly EcoNode[]): Ghost[] {
  const have = new Set(present.map((node) => node.category));
  const seen = new Set<string>();
  const ghosts: Ghost[] = [];
  for (const raw of gaps) {
    const gap = raw.trim();
    if (!gap) continue;
    const known = (STAKEHOLDER_CATEGORIES as readonly string[]).includes(gap);
    const category: StakeholderCategory = known ? (gap as StakeholderCategory) : 'other';
    if (known && have.has(category)) continue;
    const id = `gap:${slug(gap) || 'gap'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ghosts.push({
      id,
      label: known
        ? STAKEHOLDER_CATEGORY_LABELS[category]
        : gap.length > 26
          ? `${gap.slice(0, 25)}…`
          : gap,
      cluster: clusterGroup(category).id,
      category,
      text: known ? null : gap,
    });
    if (ghosts.length >= MAX_GHOSTS) break;
  }
  return ghosts;
}

/** Everything the map draws, from what the project holds. Actors share their stakeholder's id, so the same party keeps its identity from one to the other. */
export function buildMapModel(input: {
  set: StakeholderSet;
  actors: ActorSet | null;
  subject: Subject;
}): MapModel {
  const { set, actors, subject } = input;
  if (subject === 'actors' && actors) {
    const nodes = nodesFromActors(actors.actors, set.stakeholders);
    return {
      nodes,
      edges: edgesOf(actors.relations, new Set(nodes.map((node) => node.id))),
      ghosts: [],
    };
  }
  const nodes = nodesFromStakeholders(set.stakeholders);
  return {
    nodes,
    edges: edgesOf(set.relations, new Set(nodes.map((node) => node.id))),
    ghosts: ghostsOf(set.gaps, nodes),
  };
}

export interface ClusterOption {
  id: string;
  label: string;
  count: number;
}

/** The groups on the map, in a fixed order, with how many each holds: what a filter offers. */
export function clusterOptions(nodes: readonly EcoNode[]): ClusterOption[] {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.cluster, (counts.get(node.cluster) ?? 0) + 1);
  return CLUSTER_ORDER.filter((id) => counts.has(id)).map((id) => ({
    id,
    label: clusterLabel(id),
    count: counts.get(id)!,
  }));
}

/** Stakeholders no person has looked at, in the order a person would look. */
export function reviewQueue(set: StakeholderSet): string[] {
  return orderForReview(set.stakeholders)
    .filter((stakeholder) => stakeholder.status === 'proposed')
    .map((stakeholder) => stakeholder.id);
}

/** The next one to look at after the current one, going round. */
export function nextInQueue(queue: readonly string[], current: string | null): string | null {
  if (queue.length === 0) return null;
  const at = current ? queue.indexOf(current) : -1;
  return queue[(at + 1) % queue.length] ?? null;
}

export interface Connection {
  edgeId: string;
  otherId: string;
  /** What the other party is to this one, as a verb: "influences", "is regulated by". */
  phrase: string;
  strength: number;
}

/** The relations of one party, strongest first, each said from its point of view. */
export function connectionsOf(id: string, edges: readonly EcoEdge[]): Connection[] {
  const found: Connection[] = [];
  for (const edge of edges) {
    if (edge.from === id)
      found.push({
        edgeId: edge.id,
        otherId: edge.to,
        phrase: RELATION_LABEL[edge.type],
        strength: edge.strength,
      });
    else if (edge.to === id)
      found.push({
        edgeId: edge.id,
        otherId: edge.from,
        phrase: RELATION_INVERSE[edge.type],
        strength: edge.strength,
      });
  }
  return found.sort((a, b) => b.strength - a.strength || a.otherId.localeCompare(b.otherId));
}

export const CONFIDENCE_WORD: Record<EcoNode['confidence'], string> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/** How much weight to put on a stakeholder being what it says it is, from the uncertainty it states. */
export const confidenceOf = (level: UncertaintyLevel): 1 | 2 | 3 =>
  level === 'low' ? 3 : level === 'medium' ? 2 : 1;

/** The shares of a population that a node stands for: used for the "stands for about" wording. */
export const standsFor = (count: number): string => count.toLocaleString('en-GB');

/** The kinds of party, as the options of a form, in the order the contract lists them. */
export const CATEGORY_OPTIONS = STAKEHOLDER_CATEGORIES.map((id) => ({
  id,
  label: STAKEHOLDER_CATEGORY_LABELS[id],
}));

/** Whether there is room, and the rule, for adding a stakeholder. */
export function canAddMore(set: StakeholderSet, max: number): boolean {
  return set.stakeholders.length < max;
}

/** Whether approving makes sense: at least two live parties, because a simulation needs more than one. */
export const enoughToApprove = (set: StakeholderSet): boolean =>
  liveStakeholders(set.stakeholders).length >= 2;

/** An actor with a stakeholder's evidence and wording, the two read together in one panel. */
export interface Party {
  id: string;
  stakeholder: Stakeholder | null;
  actor: Actor | null;
}

export function partyOf(
  id: string,
  set: StakeholderSet | null,
  actors: ActorSet | null,
): Party | null {
  const stakeholder = set?.stakeholders.find((item) => item.id === id) ?? null;
  const actor = actors?.actors.find((item) => item.id === id) ?? null;
  return stakeholder || actor ? { id, stakeholder, actor } : null;
}

/** What is said when a stakeholder cites no passage, which depends on who put it on the list. */
export const NO_EVIDENCE: Record<Stakeholder['origin'], string> = {
  rules: 'No quote was kept for this stakeholder.',
  scenario: 'Named in your question. No passage of your sources mentions this group.',
  model: 'Inferred by the model: it could not quote a passage that supports this stakeholder.',
  user: 'Added by you. Evidence comes from your sources, so none is attached.',
};

/** The eyebrow of a party: its kind of party and whether it is one actor or a cohort. */
export function partyKicker(
  party: Party,
  subject: Subject,
): { name: string; text: string; cluster: string } {
  const { actor, stakeholder } = party;
  const asActor = actor !== null && (subject === 'actors' || !stakeholder);
  const category = (asActor ? actor : (stakeholder ?? actor))!.category;
  const kind = asActor
    ? actor!.kind === 'key'
      ? 'Key actor'
      : `Cohort of ${actor!.sampleSize}`
    : (stakeholder?.priority ?? 'standard') === 'key'
      ? 'Key actor'
      : 'Cohort';
  return {
    name: asActor ? actor!.name : (stakeholder?.name ?? actor!.name),
    text: `${STAKEHOLDER_CATEGORY_LABELS[category]} · ${kind}`,
    cluster: clusterGroup(category).id,
  };
}
