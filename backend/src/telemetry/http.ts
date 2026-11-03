import { SpanKind, SpanStatusCode, context, trace, type Span } from '@opentelemetry/api';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicFailure } from '../errors.js';
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

/**
 * Answers a request that was refused before any route was found: an address that cannot be read, or a
 * parameter that is too long. Fastify's own answer to those repeats the address, query string
 * included, in the body, so a token that was sent in a query would be sent straight back. This one
 * says what is wrong and nothing else, in the shape of every other error, with the correlation id.
 */
export function frameworkFailure(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const unreadable = error.code === 'FST_ERR_BAD_URL';
  const tooLong = error.code === 'FST_ERR_MAX_PARAM_LENGTH';
  const status = unreadable ? 400 : tooLong ? 414 : 500;
  const failure = unreadable
    ? { code: 'HTTP_400', message: 'Malformed request. Supply valid JSON and URL encoding.' }
    : tooLong
      ? { code: 'HTTP_414', message: 'The address is too long.' }
      : publicFailure(error);
  signals.apiError({ route: 'unmatched', status, code: failure.code });
  if (status >= 500) {
    request.log.error(
      { code: failure.code, requestId: request.id, errorType: error.name },
      'Request failed before a route was found.',
    );
  }
  void reply
    .code(status)
    .header(REQUEST_ID_HEADER, request.id)
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .send({ error: { ...failure, requestId: request.id } });
}
