import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isLocalPrincipal } from '../auth/access.js';
import { cookieName, readCookie, serializeCookie } from '../auth/cookies.js';
import { CSRF_HEADER, SESSION_COOKIE, principalOf } from '../auth/guard.js';
import {
  authorizeUrl,
  exchangeCode,
  randomToken,
  safeReturnTo,
  type OidcEndpoints,
} from '../auth/oidc.js';
import type { TokenVerifier } from '../auth/tokens.js';
import type { ServerConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';

const LOGIN_COOKIE = 'swarm_login';
const LOGIN_MAX_AGE_SECONDS = 600;

const callbackQuery = z.object({
  code: z.string().min(1).max(4_096).optional(),
  state: z.string().min(16).max(256).optional(),
  error: z.string().max(200).optional(),
});

/**
 * Browser sign-in with Microsoft Entra: the Authorization Code flow with PKCE, run here, on the
 * server, so that the browser is only ever given an opaque session cookie and no token. These
 * routes sit outside `/api`, because they are how a person gets the right to call it; each does its
 * own checking, and none of them stores or logs a code, a state, a token or a session identifier.
 *
 * Not registered at all unless browser sign-in is configured.
 */
export function sessionRoutes(
  app: FastifyInstance,
  options: {
    config: ServerConfig;
    repository: Repository;
    verifier: TokenVerifier;
    endpoints: OidcEndpoints;
    fetcher?: typeof fetch;
  },
): void {
  const { config, repository, verifier, endpoints, fetcher } = options;
  const session = config.auth.session;
  if (!session) return;
  const secure = session.secureCookies;
  const sessionName = cookieName(SESSION_COOKIE, secure);
  const loginName = cookieName(LOGIN_COOKIE, secure);
  const lifetime = {
    idleMs: session.idleMinutes * 60_000,
    absoluteMs: session.absoluteHours * 3_600_000,
  };
  const limit = {
    config: { rateLimit: { max: 30 * config.rateLimitScale, timeWindow: '1 minute' } },
  };
  const clearLogin = serializeCookie(loginName, '', { maxAge: 0, secure });

  app.get('/auth/login', limit, async (request, reply) => {
    const { returnTo } = z
      .object({ returnTo: z.string().max(600).optional() })
      .parse(request.query);
    const state = randomToken();
    const nonce = randomToken();
    const verifierValue = randomToken();
    const binding = randomToken();
    repository.sessions.createLogin({
      state,
      binding,
      nonce,
      verifier: verifierValue,
      returnTo: safeReturnTo(returnTo),
    });
    return reply
      .header(
        'set-cookie',
        serializeCookie(loginName, binding, { maxAge: LOGIN_MAX_AGE_SECONDS, secure }),
      )
      .header('cache-control', 'no-store')
      .redirect(authorizeUrl(session, endpoints, { state, nonce, verifier: verifierValue }), 302);
  });

  app.get('/auth/callback', limit, async (request, reply) => {
    // Whatever goes wrong, the browser is sent back to the page, which says it did not work. Why it
    // did not is for the log (as a code), never for the person: it would be a clue to an attacker.
    const back = (where: string, reason: string) => {
      request.log.warn({ reason }, 'Sign-in did not complete.');
      return reply
        .header('set-cookie', clearLogin)
        .header('cache-control', 'no-store')
        .redirect(where, 302);
    };
    const query = callbackQuery.safeParse(request.query);
    const binding = readCookie(request.headers.cookie, loginName);
    if (!query.success || !query.data.state || !binding)
      return back('/?signin=failed', 'incomplete');
    // The attempt is spent here, once and whatever follows, so a reply cannot be tried twice.
    const attempt = repository.sessions.consumeLogin(query.data.state, binding);
    if (!attempt) return back('/?signin=failed', 'unknown-attempt');
    if (query.data.error || !query.data.code) return back('/?signin=failed', 'refused');
    try {
      const idToken = await exchangeCode(
        session,
        endpoints,
        { code: query.data.code, verifier: attempt.verifier },
        fetcher,
      );
      const principal = await verifier.verifyIdToken(idToken, {
        audience: session.clientId,
        nonce: attempt.nonce,
      });
      const created = repository.sessions.create(principal, lifetime);
      repository.audit.record({
        actor: principal.id,
        action: 'session.started',
        targetType: 'session',
        targetId: 'sign-in',
      });
      return reply
        .header('set-cookie', [
          serializeCookie(sessionName, created.token, { maxAge: created.maxAgeSeconds, secure }),
          clearLogin,
        ])
        .header('cache-control', 'no-store')
        .redirect(attempt.returnTo, 302);
    } catch (error) {
      if (error instanceof AppError && error.code === 'NO_ROLE') {
        return back('/?signin=norole', 'no-role');
      }
      return back('/?signin=failed', error instanceof AppError ? error.code : 'error');
    }
  });

  app.post('/auth/logout', limit, async (request, reply) => {
    if (request.headers[CSRF_HEADER] !== '1') {
      throw new AppError(
        403,
        'CSRF_REQUIRED',
        'Signing out must be done from the Swarm page itself. Reload it and try again.',
      );
    }
    const token = readCookie(request.headers.cookie, sessionName);
    if (token) {
      const found = repository.sessions.find(token, lifetime.idleMs);
      if (found) {
        repository.audit.record({
          actor: found.principal.id,
          action: 'session.ended',
          targetType: 'session',
          targetId: 'sign-out',
        });
      }
      repository.sessions.revoke(token);
    }
    return reply
      .header('set-cookie', serializeCookie(sessionName, '', { maxAge: 0, secure }))
      .header('cache-control', 'no-store')
      .code(204)
      .send();
  });
}

/** Who is signed in, how, and until when. Names no one: the page needs to know, not to display. */
export function sessionStatusRoute(app: FastifyInstance): void {
  app.get('/api/session', async (request) => {
    const info = request.session;
    if (info) {
      return {
        authenticated: true,
        via: 'session' as const,
        idleExpiresAt: new Date(info.idleExpiresAt).toISOString(),
        expiresAt: new Date(info.expiresAt).toISOString(),
      };
    }
    return {
      authenticated: true,
      via: isLocalPrincipal(principalOf(request)) ? ('local' as const) : ('token' as const),
    };
  });
}
