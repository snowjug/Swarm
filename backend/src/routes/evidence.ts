import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../auth/guard.js';
import type { Principal } from '../auth/principal.js';
import type { ServerConfig } from '../config.js';
import { AppError } from '../errors.js';
import { PublicFetcher } from '../ingest/url/fetcher.js';
import { ingestUrl } from '../ingest/url/ingest.js';
import { FetchRegistry } from '../ingest/url/provenance.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The pages this server fetched recently, which `attestEvidence` checks a project's documents against. */
    fetchRegistry: FetchRegistry;
  }
}

/** The pages this server fetched are remembered for one person in one workspace. */
const scopeOf = (principal: Principal): string => `${principal.tenantId}\n${principal.id}`;

/**
 * Runs before a project is created, on the body as it was sent. A document that claims to have been
 * fetched by the server keeps that claim only if this server fetched exactly that text for this
 * person; otherwise it becomes pasted text. A client can never assert the claim itself, and a
 * server that does not read pages has recorded none, so every such claim fails.
 */
export async function attestEvidence(request: FastifyRequest): Promise<void> {
  const body = request.body;
  if (typeof body !== 'object' || body === null) return;
  const registry: FetchRegistry = request.server.fetchRegistry ?? new FetchRegistry();
  registry.attest(scopeOf(principalOf(request)), (body as { documents?: unknown }).documents);
}

/**
 * Reading a public web page as evidence. Who may call it is in `auth/policy.ts` and what is recorded
 * in `auth/audit-policy.ts`; how the page is fetched, and what is promised about it, is in
 * `docs/security/url-ingestion.md`.
 */
export function evidenceRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  rateScale = 1,
  fetcher: PublicFetcher = new PublicFetcher(),
  registry: FetchRegistry = new FetchRegistry(),
): void {
  app.decorate('fetchRegistry', registry);
  app.post(
    '/api/evidence/url',
    { bodyLimit: 8_192, config: { rateLimit: { max: 10 * rateScale, timeWindow: '1 minute' } } },
    async (request) => {
      const settings = config.urlIngestion;
      if (!settings.enabled) {
        throw new AppError(
          403,
          'URL_INGESTION_DISABLED',
          'Reading web pages is turned off on this server. You can paste the text instead.',
        );
      }
      const given = (request.body as { url?: unknown } | null)?.url;
      const evidence = await ingestUrl(fetcher, typeof given === 'string' ? given : '', settings);
      registry.record(scopeOf(principalOf(request)), evidence.document.provenance);
      return evidence;
    },
  );
}
