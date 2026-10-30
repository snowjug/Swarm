/**
 * Who is calling. What they may do is decided by membership (see roles.ts and the guard), not by
 * anything the token claims beyond "this person may use Swarm at all".
 */
export interface Principal {
  /** Stable identifier inside the tenant: the Entra object id, or `local-user` without sign-in. */
  id: string;
  /** The workspace boundary. Everything a principal can see belongs to this tenant. */
  tenantId: string;
  /**
   * Holds the Platform Administrator app role. That runs the platform (a paid model check, the audit
   * chain's integrity) and confers no access to any workspace's projects.
   */
  platformAdmin: boolean;
  /** Holds the app role that may become the first owner of a workspace that has none. */
  bootstrapAdmin: boolean;
}

/**
 * Without sign-in there is one user, on one machine, who owns everything on it: the owner of the
 * `local` workspace and its platform administrator.
 */
export const LOCAL_PRINCIPAL: Principal = {
  id: 'local-user',
  tenantId: 'local',
  platformAdmin: true,
  bootstrapAdmin: false,
};
