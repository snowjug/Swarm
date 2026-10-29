/**
 * Who is calling, and what they may do. Authorisation is by role, and every role includes the ones
 * below it, so "at least analyst" is a single comparison.
 */
export const ROLES = ['reader', 'analyst', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { reader: 1, analyst: 2, reviewer: 3, admin: 4 };

/** Microsoft Entra app-role values, as an administrator assigns them to users or groups. */
export const APP_ROLES: Readonly<Record<string, Role>> = {
  'swarm.reader': 'reader',
  'swarm.analyst': 'analyst',
  'swarm.reviewer': 'reviewer',
  'swarm.admin': 'admin',
};

export interface Principal {
  /** Stable identifier inside the tenant: the Entra object id, or `local-user` without sign-in. */
  id: string;
  /** The workspace boundary. Everything a principal can see belongs to this tenant. */
  tenantId: string;
  role: Role;
}

/** Without sign-in there is one user, on one machine, who owns everything on it. */
export const LOCAL_PRINCIPAL: Principal = { id: 'local-user', tenantId: 'local', role: 'admin' };

export function atLeast(principal: Principal, required: Role): boolean {
  return RANK[principal.role] >= RANK[required];
}

/** The highest recognised role among a token's app roles, or null when it carries none we know. */
export function highestRole(values: readonly unknown[]): Role | null {
  let best: Role | null = null;
  for (const value of values) {
    const role = typeof value === 'string' ? APP_ROLES[value.toLowerCase()] : undefined;
    if (role && (best === null || RANK[role] > RANK[best])) best = role;
  }
  return best;
}
