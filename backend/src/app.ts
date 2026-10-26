import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { publicConfig, type ServerConfig } from './config.js';
import { AppError, publicFailure } from './errors.js';
import { InteractionService } from './orchestration/interaction.js';
import { Orchestrator, type ModelFactory } from './orchestration/runner.js';
import { projectRoutes } from './routes/projects.js';
import { Repository } from './storage/repository.js';
import { guidedRoutes } from './routes/guided.js';
import { PdfService } from './ingest/pdf.js';
import { APP_VERSION } from '../../shared/types.js';

export interface AppOptions {
  config: ServerConfig;
  repository?: Repository;
  modelFactory?: ModelFactory;
}

export async function buildApp(options: AppOptions) {
  const { config } = options;
  const app = Fastify({
    bodyLimit: 600_000,
    requestTimeout: 30_000,
    connectionTimeout: 180_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 200,
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    logger: {
      level: config.logLevel,
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
  const repository = options.repository || new Repository(config.databasePath);
  repository.recoverInterrupted();
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
    options.modelFactory,
  );
  const interaction = new InteractionService(
    repository,
    config,
    options.modelFactory,
    (projectId, code) =>
      app.log.error(
        { projectId, code },
        'Follow-up or survey failed. Inspect its persisted state.',
      ),
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
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a minute before retrying.' },
    }),
  });

  app.addHook('onRequest', async (request) => {
    const rawHost = request.headers.host || '';
    if (/[/\\@\s]/u.test(rawHost) || !config.allowedHosts.has(request.hostname.toLowerCase())) {
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
    return reply.code(status).send({ error: { ...failure, requestId: request.id } });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'swarm-lab',
    version: APP_VERSION,
    storage: 'sqlite',
    experiments: repository.count(),
    queue: jobs.state(),
  }));
  app.get('/api/config', async () => publicConfig(config));
  projectRoutes(app, repository, jobs, interaction);
  guidedRoutes(app, repository, jobs, interaction, pdf);

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
  return { app, repository, jobs, interaction, pdf };
}
