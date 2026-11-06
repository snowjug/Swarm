/** What a deployment has been seen to refuse. Only a refusal is remembered; a deployment is assumed to take everything. */
export interface DeploymentCapabilities {
  jsonSchema?: boolean;
  temperature?: boolean;
  reasoningEffort?: boolean;
  /** False for a deployment that takes an effort but not `minimal` (the o-series): its lowest is `low`. */
  minimalEffort?: boolean;
  /** False for a provider that does not know `max_completion_tokens` and is asked with `max_tokens` instead. */
  maxCompletionTokens?: boolean;
}

export interface CapabilityMemoryOptions {
  /** How long a refusal is believed. A deployment can be replaced by a newer model without a restart. */
  ttlMs?: number;
  /** The most deployments and schemas remembered; the oldest is forgotten first. */
  maxEntries?: number;
  now?: () => number;
  /**
   * What the operator has said about a deployment, believed always and for as long as the process runs: a deployment
   * declared not to reason is never sent an effort, so that the first call to it is not a request that is bound to be refused.
   */
  declared?: Readonly<Record<string, DeploymentCapabilities>>;
}

interface Entry<T> {
  value: T;
  until: number;
}

/**
 * What the process has learned about the deployments it calls, by being refused: that one does not
 * take strict structured outputs, or a temperature. It is shared by every client of a process, so the
 * refusal costs one request in all and not one per operation, and it expires, so that a deployment
 * that is replaced is tried again. It holds names and flags, never a request or a reply.
 */
export class CapabilityMemory {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly declared: Readonly<Record<string, DeploymentCapabilities>>;
  private readonly deployments = new Map<string, Entry<DeploymentCapabilities>>();
  private readonly schemas = new Map<string, Entry<true>>();

  constructor(options: CapabilityMemoryOptions = {}) {
    this.ttlMs = options.ttlMs ?? 3_600_000;
    this.maxEntries = options.maxEntries ?? 128;
    this.now = options.now ?? Date.now;
    this.declared = options.declared ?? {};
  }

  get(deployment: string): DeploymentCapabilities {
    const declared = this.declared[deployment];
    const entry = this.deployments.get(deployment);
    if (!entry) return declared ?? {};
    if (entry.until <= this.now()) {
      this.deployments.delete(deployment);
      return declared ?? {};
    }
    return declared ? { ...entry.value, ...declared } : entry.value;
  }

  /**
   * Records that a deployment refused something. What it refused before is kept, so that a deployment
   * found to refuse several things is known to, and one request in all is then enough. The entry's
   * time starts again.
   */
  refused(deployment: string, patch: DeploymentCapabilities): void {
    const known = this.get(deployment);
    this.deployments.delete(deployment);
    this.deployments.set(deployment, {
      value: { ...known, ...patch },
      until: this.now() + this.ttlMs,
    });
    this.trim(this.deployments);
  }

  /** A schema one deployment would not take, though it takes strict structured outputs in general. */
  schemaRefused(deployment: string, schema: string): void {
    const key = `${deployment}\u0000${schema}`;
    this.schemas.delete(key);
    this.schemas.set(key, { value: true, until: this.now() + this.ttlMs });
    this.trim(this.schemas);
  }

  isSchemaRefused(deployment: string, schema: string): boolean {
    const key = `${deployment}\u0000${schema}`;
    const entry = this.schemas.get(key);
    if (!entry) return false;
    if (entry.until > this.now()) return true;
    this.schemas.delete(key);
    return false;
  }

  /** The deployments with a refusal on record, for operators. */
  snapshot(): Record<string, DeploymentCapabilities> {
    const out: Record<string, DeploymentCapabilities> = {};
    for (const name of [...this.deployments.keys()]) {
      const known = this.get(name);
      if (Object.keys(known).length > 0) out[name] = { ...known };
    }
    return out;
  }

  private trim<T>(map: Map<string, T>): void {
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  }
}
