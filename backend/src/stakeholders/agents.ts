import {
  STAKEHOLDER_CATEGORY_LABELS,
  type Actor,
  type ActorSet,
  type Trait,
} from '../../../shared/stakeholders.js';
import type { Agent, KnowledgeGraph, SimulationSettings } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { tokenize } from '../knowledge/retrieval.js';
import { truncate } from './names.js';

/** The engine runs between this many agents... */
export const MIN_AGENTS = 4;
/** ...and this many: a model run is limited by its cost, a rules run by its screen. */
export const MAX_AGENTS = { local: 24, llm: 10 } as const;

/** How members of a cohort are spread around its value, in units of its spread, member by member. */
const MEMBER_SPREAD = [1, -1, 0.5, -0.5, 0.75, -0.75, 0.25, -0.25];

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const round3 = (value: number): number => Math.round(value * 1_000) / 1_000;

interface Seat {
  actor: Actor;
  /** 1 for a key actor and for a cohort's representative; 2 and up for further members of a cohort. */
  member: number;
}

export interface ActorAgents {
  agents: Agent[];
  /** Key actors that became agents, cohort representatives added, and key actors left out for the limit. */
  keyActors: number;
  representatives: number;
  omitted: string[];
}

const inclination = (value: number): string =>
  value > 0.25 ? 'in favour' : value < -0.25 ? 'against' : 'undecided';
const effect = (value: number): string =>
  value <= -0.3 ? 'harmful' : value >= 0.3 ? 'beneficial' : 'unclear or mixed';

const shifted = (item: Trait, factor: number, low: number, high: number): number =>
  clamp(item.value + factor * item.spread, low, high);

/** The words that say, in the agent's own persona, what it is and that it is not a person. */
function personaOf(actor: Actor, stance: number): string {
  const label = STAKEHOLDER_CATEGORY_LABELS[actor.category].toLowerCase();
  const group =
    actor.kind === 'cohort' ? `, one member of a modelled cohort of about ${actor.size}` : '';
  const parts = [
    `Fictional proxy for ${actor.name} (${label}${group}).`,
    `Starts ${inclination(stance)} toward the change (inclination ${stance.toFixed(2)}); the change is ${effect(actor.traits.impact.value)} for them.`,
    actor.objectives.length > 0 ? `Wants: ${actor.objectives.join('; ')}.` : '',
    actor.concerns.length > 0 ? `Concerned about: ${actor.concerns.join('; ')}.` : '',
    actor.constraints.length > 0 ? `Limited by: ${actor.constraints.join('; ')}.` : '',
    'These settings are assumptions, category priors unless someone edited them; they are not the beliefs of any real person or group.',
  ];
  return truncate(parts.filter(Boolean).join(' '), 700);
}

/** The graph topics closest to an actor's words, so that agents who share a concern meet in a round. */
function topicsFor(actor: Actor, graph: KnowledgeGraph): string[] {
  const words = new Set(tokenize(`${actor.name} ${actor.role} ${actor.objectives.join(' ')}`));
  return graph.nodes
    .map((node) => ({
      id: node.id,
      weight: node.weight,
      overlap: tokenize(`${node.label} ${node.summary}`).filter((word) => words.has(word)).length,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, 2)
    .map((node) => node.id);
}

function agentOf(seat: Seat, index: number, graph: KnowledgeGraph): Agent {
  const { actor, member } = seat;
  const traits = actor.traits;
  const factor = member <= 1 ? 0 : (MEMBER_SPREAD[(member - 2) % MEMBER_SPREAD.length] ?? 0);
  const stance = round3(shifted(traits.priorStance, factor, -1, 1));
  // Influence on the engine's 0.1 to 2 scale: how much others weigh them, and how far they can act alone.
  const reach = 0.7 * shifted(traits.influence, factor, 0, 1) + 0.3 * traits.authority.value;
  const suffix =
    actor.kind === 'key'
      ? ''
      : member === 1
        ? ' (cohort representative)'
        : ` (cohort member ${member})`;
  const name = `${truncate(actor.name, 100 - suffix.length)}${suffix}`;
  return {
    id: `agent-${index + 1}`,
    name: name.length >= 3 ? name : `${name} (actor)`,
    role:
      actor.role.trim().length >= 3
        ? truncate(actor.role, 100)
        : STAKEHOLDER_CATEGORY_LABELS[actor.category],
    persona: personaOf(actor, stance),
    goals: actor.objectives.slice(0, 3),
    constraints: actor.constraints.slice(0, 3),
    topicIds: topicsFor(actor, graph),
    initialOpinion: stance,
    opinion: stance,
    influence: round3(clamp(0.2 + 1.6 * reach, 0.1, 2)),
    openness: round3(shifted(traits.openness, factor, 0, 1)),
    memory: [],
    sourceIds: [...new Set(actor.evidence.map((ref) => ref.passageId))].slice(0, 6),
  };
}

/**
 * The agents the existing simulation engine runs, made from the actors. Each key actor is one agent.
 * The engine needs at least four, so when there are fewer key actors, the largest cohorts are each
 * represented by one clearly named agent, and then by more of their members (spread around the
 * cohort's values by its spread) if that is still not enough. A cohort is never simulated at its
 * size here: the repeated runs of the analysis do that. Everything an agent has is copied from the
 * actor, so editing the actor edits the agent the next time the environment is prepared.
 */
export function agentsFromActors(
  actors: ActorSet,
  graph: KnowledgeGraph,
  settings: Pick<SimulationSettings, 'mode'>,
): ActorAgents {
  const limit = MAX_AGENTS[settings.mode];
  const reach = (actor: Actor): number =>
    actor.traits.influence.value + actor.traits.authority.value;
  const keys = actors.actors
    .filter((actor) => actor.kind === 'key')
    .sort((a, b) => reach(b) - reach(a) || a.id.localeCompare(b.id));
  const cohorts = actors.actors
    .filter((actor) => actor.kind === 'cohort')
    .sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));

  const seats: Seat[] = keys.slice(0, limit).map((actor) => ({ actor, member: 1 }));
  const keyActors = seats.length;
  for (const cohort of cohorts) {
    if (seats.length >= MIN_AGENTS) break;
    seats.push({ actor: cohort, member: 1 });
  }
  for (let member = 2; seats.length < MIN_AGENTS; member += 1) {
    const room = cohorts.filter((cohort) => member <= cohort.sampleSize);
    if (room.length === 0) break;
    for (const cohort of room) {
      if (seats.length < MIN_AGENTS) seats.push({ actor: cohort, member });
    }
  }
  if (seats.length < MIN_AGENTS) {
    throw new AppError(
      409,
      'ACTORS_TOO_FEW',
      `The simulation engine needs at least ${MIN_AGENTS} agents and these actors give only ${seats.length}. Add a stakeholder that stands for a group of people, not a key actor, and make the actors again.`,
    );
  }
  return {
    agents: seats.map((seat, index) => agentOf(seat, index, graph)),
    keyActors,
    representatives: seats.length - keyActors,
    omitted: keys.slice(limit).map((actor) => actor.name),
  };
}
