import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { publicConfig, type ServerConfig } from './config.js';
import { registerAuth } from './auth/guard.js';
import { registerAudit } from './auth/audit-policy.js';
import { microsoftEndpoints } from './auth/oidc.js';
import { TokenVerifier } from './auth/tokens.js';
import { AppError, publicFailure } from './errors.js';
import { InteractionService } from './orchestration/interaction.js';
import {
  Orchestrator,
  type ModelFactory,
  type OrchestratorOptions,
} from './orchestration/runner.js';
import { createModelFactory } from './models/factory.js';
import { ProviderTelemetry } from './models/telemetry.js';
import { providerRoutes } from './routes/provider.js';
import { projectRoutes } from './routes/projects.js';
import { budgetRoutes } from './routes/budget.js';
import { memberRoutes } from './routes/members.js';
import { sessionRoutes, sessionStatusRoute } from './routes/session.js';
import { recordApiError, registerRequestTelemetry } from './telemetry/http.js';
import { signals } from './telemetry/signals.js';
import { ledgerRoutes } from './routes/ledger.js';
import { studioRoutes } from './routes/studio.js';
import { ModelSectionRegenerator } from './studio/regenerate.js';
import { StudioService } from './studio/service.js';
import { LedgerService } from './grounding/service.js';
import { Repository } from './storage/repository.js';
import { guidedRoutes } from './routes/guided.js';
// Scenario Lab routes: one block per feature, each edited only by the feature that owns it.
// [url-ingest imports]
import { evidenceRoutes } from './routes/evidence.js';
import type { PublicFetcher } from './ingest/url/fetcher.js';

// [scenario imports]
import { scenarioRoutes } from './routes/scenario.js';

// [stakeholders imports]

// [analysis imports]

// [critics imports]
import { critiqueRoutes } from './routes/critiques.js';

// [brief imports]
import { briefRoutes } from './routes/brief.js';
import { PdfService } from './ingest/pdf.js';
import { APP_VERSION } from '../../shared/types.js';

export interface AppOptions {
  config: ServerConfig;
  repository?: Repository;
  modelFactory?: ModelFactory;
  /** Test hook: verify tokens against local keys instead of Microsoft's published key set. */
  tokenVerifier?: TokenVerifier;
  /** Test hook: capture structured logs to assert that no secret or content is written. */
  logStream?: { write(message: string): void };
  /**
   * Test hook: send people to, and redeem codes at, a local identity provider instead of Microsoft.
   * `authorityHost` replaces `https://login.microsoftonline.com`; `fetcher` replaces the token call.
   */
  oidc?: {
    fetcher?: typeof fetch;
    authorityHost?: string;
    /** Test hook: the managed identity's client assertion, where there is no managed identity. */
    assertion?: () => Promise<string>;
  };
  /** Test hook: how the job queue is run (identity, leases, timers), to model several workers or a crash. */
  jobs?: OrchestratorOptions;
  /** Test hook: read web pages through this fetcher (a stub resolver, or servers on this machine). */
  urlFetcher?: PublicFetcher;
}

/** The routes a platform's health probes call. They answer without sign-in, and for any host. */
const PROBE_ROUTES: ReadonlySet<string> = new Set(['/api/health/live', '/api/health/ready']);

/** How often ended sessions and abandoned sign-ins are removed from the database. */
const SESSION_PURGE_INTERVAL_MS = 10 * 60_000;

/** Larger than the 60 s idle limit most load balancers and command-line clients apply, so the peer closes first. */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const BODY_LIMIT = 600_000;
/** A declared length beyond this many times the route's limit is answered and the connection closed. */
const DRAIN_FACTOR = 8;

export async function buildApp(options: AppOptions) {
  const { config } = options;
  const app = Fastify({
    bodyLimit: BODY_LIMIT,
    requestTimeout: 30_000,
    connectionTimeout: 180_000,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    maxRequestsPerSocket: 200,
    // Trust the first N hops from this server: the platform's ingress, and nothing a caller can add.
    trustProxy:
      config.trustedProxies > 0
        ? (_address: string, hop: number) => hop < config.trustedProxies
        : false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    logger: {
      level: config.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url.split('?')[0],
            hostname: request.hostname,
          };
        },
      },
    },
  });
  const repository =
    options.repository ??
    new Repository(config.databaseUrl ?? config.databasePath, {
      entra: config.databaseAuth === 'entra',
    });
  // First, so that every answer, a refusal included, carries the correlation id.
  registerRequestTelemetry(app);
  // Every route as registered, so a test can prove that none of them lacks an authorization policy.
  const routes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) routes.push({ method, url: route.url });
  });
  repository.usage.setDefaults(config.modelBudget);
  repository.recoverInterrupted();
  const telemetry = new ProviderTelemetry(config.provider);
  const modelFactory = options.modelFactory ?? createModelFactory(config, telemetry);
  const jobs = new Orchestrator(
    repository,
    config,
    (projectId, code) => {
      if (code === 'RUN_CANCELLED') app.log.info({ projectId, code }, 'Run cancelled.');
      else
        app.log.error(
          { projectId, code },
          'Run failed; inspect persisted status, not provider response bodies.',
        );
    },
    modelFactory,
    {
      onFault: (code) => app.log.error({ code }, 'The job queue could not be read or written.'),
      ...(options.jobs ?? {}),
    },
  );
  const stopReporting = signals.observe(() => {
    const summary = jobs.summary();
    return {
      role: summary.role,
      jobsByState: summary.counts,
      oldestWaitingSeconds:
        summary.oldestWaitingMs === null ? null : Math.round(summary.oldestWaitingMs / 1000),
      databaseUp: repository.ping(),
      workerBusy: jobs.working(),
    };
  });
  app.addHook('onClose', async () => stopReporting());
  const interaction = new InteractionService(repository, config, modelFactory, (projectId, code) =>
    app.log.error({ projectId, code }, 'Follow-up or survey failed. Inspect its persisted state.'),
  );
  const pdf = new PdfService();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    max: 120 * config.rateLimitScale,
    timeWindow: '1 minute',
    // The plugin throws whatever this returns, so it must be an error the handler understands;
    // a plain object here previously surfaced as a 500 INTERNAL_ERROR instead of a 429.
    errorResponseBuilder: () =>
      new AppError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute before retrying.'),
  });

  app.addHook('onRequest', async (request) => {
    const rawHost = request.headers.host || '';
    // A platform probe sends the replica's own address as its Host, which no allow-list can name in
    // advance. The two probe routes answer with a status word and nothing else, so they are the one
    // place where an unlisted host is let through; a malformed one is still refused.
    const probe = request.method === 'GET' && PROBE_ROUTES.has(request.routeOptions.url ?? '');
    if (
      /[/\\@\s]/u.test(rawHost) ||
      (!probe && !config.allowedHosts.has(request.hostname.toLowerCase()))
    ) {
      throw new AppError(
        403,
        'HOST_NOT_ALLOWED',
        'This HTTP host is not in the configured allowlist.',
      );
    }
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.has(origin)) {
      throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Cross-origin access is not permitted.');
    }
  });
  // A body the route will not accept is refused from its declared length before any of it is read,
  // and the unread remainder is drained. Closing a connection while the client is still sending
  // makes the kernel reset it, so the client saw "connection reset" instead of the 413 that says
  // what to change. A length far beyond the limit is not worth draining: that connection is closed.
  app.addHook('onRequest', async (request, reply) => {
    const declared = Number(request.headers['content-length']);
    const limit = request.routeOptions.bodyLimit;
    if (!Number.isFinite(declared) || declared <= limit) return;
    if (declared > limit * DRAIN_FACTOR) reply.header('connection', 'close');
    throw Object.assign(new Error('Payload Too Large'), { statusCode: 413 });
  });
  const verifier =
    config.auth.mode === 'entra' ? (options.tokenVerifier ?? new TokenVerifier(config.auth)) : null;
  registerAuth(app, { config: config.auth, repository, ...(verifier ? { verifier } : {}) });
  registerAudit(app, repository);
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api')) {
      reply.header('cache-control', 'no-store');
      reply.header('x-content-type-options', 'nosniff');
    }
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    let status = 500;
    let failure = publicFailure(error);
    if (error instanceof ZodError) {
      status = 400;
      failure = {
        code: 'INVALID_INPUT',
        message: error.issues
          .slice(0, 4)
          .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
          .join('; ')
          .slice(0, 800),
      };
    } else if (error instanceof AppError) {
      status = error.statusCode;
    } else if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
    ) {
      const messages: Record<number, string> = {
        400: 'Malformed request. Supply valid JSON and URL encoding.',
        403: 'Access to this resource is forbidden.',
        404: 'This resource does not exist.',
        413: 'The request exceeds the configured endpoint body-size limit.',
        415: 'Unsupported content type. Use application/json.',
        429: 'Too many requests. Wait before retrying.',
      };
      const message = messages[error.statusCode];
      if (message) {
        status = error.statusCode;
        failure = { code: `HTTP_${status}`, message };
      }
    }
    if (status >= 500) {
      request.log.error(
        {
          code: failure.code,
          requestId: request.id,
          errorType: error instanceof Error ? error.name : 'unknown',
        },
        'Request failed. Content and provider exception bodies are intentionally not logged.',
      );
    }
    recordApiError(request, status, failure.code);
    return reply.code(status).send({ error: { ...failure, requestId: request.id } });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'swarm-lab',
    version: APP_VERSION,
    // Counts across every tenant are not for an unauthenticated probe to read.
    ...(config.auth.mode === 'none'
      ? {
          storage: repository.dialect,
          experiments: repository.count(),
          queue: jobs.state(),
          jobs: jobs.summary(),
        }
      : {}),
  }));
  app.get('/api/config', async () => publicConfig(config));
  // Alive: the process is running and its event loop turns. It fails only when the database
  // connection is lost for good, which a restart cures, and otherwise asks nothing of anything it
  // depends on, so that a database that is merely down does not make a healthy process restart.
  app.get('/api/health/live', async (_request, reply) =>
    repository.broken ? reply.code(503).send({ status: 'broken' }) : reply.send({ status: 'live' }),
  );
  // Ready: the database answers. A probe is told whether, and which check failed, and nothing else.
  app.get('/api/health/ready', async (_request, reply) => {
    const database = repository.ping();
    return reply.code(database ? 200 : 503).send({
      status: database ? 'ready' : 'not-ready',
      checks: { database: database ? 'ok' : 'failed' },
    });
  });
  projectRoutes(app, repository, jobs, interaction, config.rateLimitScale);
  memberRoutes(app, repository, config.rateLimitScale);
  budgetRoutes(app, repository, config.rateLimitScale);
  sessionStatusRoute(app);
  if (verifier && config.auth.session) {
    sessionRoutes(app, {
      config,
      repository,
      verifier,
      endpoints: microsoftEndpoints(config.auth.session, options.oidc?.authorityHost),
      ...(options.oidc?.fetcher ? { fetcher: options.oidc.fetcher } : {}),
      ...(options.oidc?.assertion ? { assertion: options.oidc.assertion } : {}),
    });
    const purge = setInterval(() => repository.sessions.purge(), SESSION_PURGE_INTERVAL_MS);
    purge.unref();
    app.addHook('onClose', async () => clearInterval(purge));
  }
  const ledger = new LedgerService(repository);
  ledgerRoutes(app, repository, ledger, config.rateLimitScale);
  studioRoutes(
    app,
    repository,
    new StudioService(
      repository,
      ledger,
      new ModelSectionRegenerator(repository, config, modelFactory),
      { isBusy: (projectId) => jobs.isBusy(projectId) || interaction.isBusy(projectId) },
    ),
    config.rateLimitScale,
  );
  providerRoutes(app, config, telemetry, modelFactory, config.rateLimitScale);
  guidedRoutes(app, repository, jobs, interaction, pdf, config.rateLimitScale);
  // [url-ingest routes]
  evidenceRoutes(app, config, config.rateLimitScale, options.urlFetcher);

  // [scenario routes]
  scenarioRoutes(app, repository, config, modelFactory, config.rateLimitScale);

  // [stakeholders routes]

  // [analysis routes]

  // [critics routes]
  critiqueRoutes(app, repository, modelFactory, {
    modelAvailable: config.provider.configured,
    rateScale: config.rateLimitScale,
  });

  // [brief routes]
  briefRoutes(app, repository, config.rateLimitScale);

  const frontend = resolve(process.cwd(), 'frontend', 'dist');
  if (existsSync(resolve(frontend, 'index.html'))) {
    await app.register(staticFiles, {
      root: frontend,
      prefix: '/',
      dotfiles: 'deny',
      index: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        !request.url.startsWith('/api') &&
        !request.url.startsWith('/auth/') &&
        request.method === 'GET' &&
        request.headers.accept?.includes('text/html')
      ) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      }
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'This resource does not exist.' } });
    });
    app.get('/', async (_request, reply) =>
      reply.header('cache-control', 'no-cache').sendFile('index.html'),
    );
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message:
            'Resource not found. For the UI, start the Vite frontend or build it before starting this server.',
        },
      }),
    );
  }
  app.addHook('preClose', async () => {
    await Promise.all([interaction.stop(), jobs.stop(), pdf.stop()]);
  });
  app.addHook('onClose', async () => repository.close());
  await app.ready();
  return { app, repository, jobs, interaction, pdf, routes };
}
