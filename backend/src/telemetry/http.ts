import { SpanKind, SpanStatusCode, context, trace, type Span } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { annotate, signals, tracer } from './signals.js';

/** The header that carries a request's correlation id back to the caller, on every answer. */
export const REQUEST_ID_HEADER = 'x-request-id';

const spans = new WeakMap<FastifyRequest, Span>();

/**
 * Gives every request a correlation id and a span. The id is the one Swarm already puts in its
 * error answers and its logs, so a caller can quote it and an operator can find the request in
 * either place. The span carries the route template, never the URL, the query, a header or a body.
 *
 * Register this before every other hook, so that refused requests are also answered with the id.
 */
export function registerRequestTelemetry(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    const span = tracer().startSpan('swarm.http', { kind: SpanKind.SERVER });
    annotate(span, { 'swarm.request.id': request.id, 'swarm.http.method': request.method });
    spans.set(request, span);
    context.with(trace.setSpan(context.active(), span), done);
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const status = reply.statusCode;
    signals.httpRequest({
      route,
      method: request.method,
      status,
      durationMs: reply.elapsedTime,
    });
    const span = spans.get(request);
    if (span) {
      annotate(span, { 'swarm.http.route': route, 'swarm.http.status': status });
      span.updateName(`${request.method} ${route}`);
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      spans.delete(request);
    }
    done();
  });
}

/** Records an error answer on the request's span and in the error and denial counts. */
export function recordApiError(request: FastifyRequest, status: number, code: string): void {
  const route = request.routeOptions.url ?? 'unmatched';
  signals.apiError({ route, status, code });
  const span = spans.get(request);
  if (span) annotate(span, { 'swarm.error.code': code });
}
