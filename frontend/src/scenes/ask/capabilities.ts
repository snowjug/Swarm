import type { AppConfig } from '../../../../shared/types';

/**
 * What a server may report beyond the shared `AppConfig`. Both parts arrive with later work and are absent from a
 * server that does not know them, so they are read as unknown, and only a `true` counts.
 */
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

/** Whether this server researches on request. Without it, a project needs a source of the person's own. */
export function researchEnabled(config: AppConfig | null): boolean {
  return record(record(config)?.research)?.enabled === true;
}

/**
 * Whether this server can look for sources from a question alone: there is a search provider behind it. Where it
 * cannot, research reads the site or page a person names and nothing else, so what the page promises is that.
 */
export function discoveryAvailable(config: AppConfig | null): boolean {
  return record(record(record(config)?.research)?.discovery)?.available === true;
}

/** Whether this server names and keeps the constraints of a decision. */
export function constraintsEnabled(config: AppConfig | null): boolean {
  return record(record(config)?.features)?.constraints === true;
}

export const CAPABILITY_IDS = [
  'evidence',
  'assumptions',
  'alternatives',
  'constraints',
  'approval',
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface Capability {
  id: CapabilityId;
  label: string;
  /** One sentence on what it means in the product, for the person who asks. */
  detail: string;
}

/**
 * What Swarm can honestly say about how it works, in the order it is said. Nothing here is a claim about how
 * good a result is: each is something the product does, and the page draws it only when this server does it.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'evidence',
    label: 'Evidence linked',
    detail: 'Each claim points to the passage of the source it was read from.',
  },
  {
    id: 'assumptions',
    label: 'Assumptions visible',
    detail: 'What is assumed is listed, marked as yours or Swarm’s, and open to change.',
  },
  {
    id: 'alternatives',
    label: 'Alternatives compared',
    detail: 'Each way of doing it is simulated and set beside what happens if nothing changes.',
  },
  {
    id: 'constraints',
    label: 'Constraints considered',
    detail: 'What limits the decision is listed and kept beside the result.',
  },
  {
    id: 'approval',
    label: 'Human approval before simulation',
    detail: 'Nothing is simulated until you have reviewed and approved the setup.',
  },
];

export type CapabilityFlags = Readonly<Record<CapabilityId, boolean>>;

/**
 * Which capabilities this server has. The first, second, third and fifth are how the product is built; the
 * constraints are drawn only when the server says it has them.
 */
export function capabilityFlags(config: AppConfig | null): CapabilityFlags {
  return {
    evidence: true,
    assumptions: true,
    alternatives: true,
    constraints: constraintsEnabled(config),
    approval: true,
  };
}
