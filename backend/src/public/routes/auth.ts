import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PUBLIC_SIGN_IN_PROBLEMS,
  startGuestSchema,
  startSignInSchema,
  type PublicProviderId,
  type PublicSignInProblem,
  type StartedGuest,
  type StartedSignIn,
} from '../../../../shared/public.js';
import { readCookie, serializeCookie } from '../../auth/cookies.js';
import { CSRF_HEADER } from '../../auth/guard.js';
import { randomToken, safeReturnTo } from '../../auth/oidc.js';
import { AppError } from '../../errors.js';
import type { PublicContext } from '../context.js';
import { SignInRefused } from '../identity/provider.js';

const LOGIN_MAX_AGE_SECONDS = 600;

const providerParams = z.object({ provider: z.enum(['google', 'github']) });
const callbackQuery = z.object({
  code: z.string().min(1).max(4_096).optional(),
  state: z.string().min(16).max(256).optional(),
  error: z.string().max(200).optional(),
});

const noStore = { 'cache-control': 'no-store' } as const;

/**
 * Sign-in for the public edition. These routes sit outside `/api` because they are how a person gets the right to call
 * it: each does its own checking, and none of them stores or logs a code, a state, a token or a session identifier.
 * They are registered only in public mode.
 */
export function authRoutes(app: FastifyInstance, context: PublicContext): void {
  const { pub, config } = context;
  const secure = pub.secureCookies;
  const limit = {
    config: { rateLimit: { max: 30 * config.rateLimitScale, timeWindow: '1 minute' } },
  };
  const clearLogin = serializeCookie(context.loginCookie, '', { maxAge: 0, secure });

  const redirectUri = (provider: PublicProviderId): string =>
    `${pub.baseUrl}/auth/callback/${provider}`;

  /**
   * A visitor who does not sign in: a guest with a private workspace of its own, and the same kind of session as a person
   * who signed in. It is a change (so it carries the header another site cannot make a browser send), it is a new
   * account (so it obeys the switch for new accounts), and it is throttled by address, so that one visitor cannot make
   * allowances without end. Nothing is made by a visit alone: only by this call.
   */
  app.post('/auth/guest', limit, async (request, reply) => {
    if (
      request.headers[CSRF_HEADER] !== '1' ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      throw new AppError(
        403,
        'CSRF_REQUIRED',
        'This must be started from the Swarm page itself. Reload it and try again.',
      );
    }
    if (!pub.guestMode) {
      throw new AppError(
        403,
        'NOT_AVAILABLE',
        'Using this site without signing in is not available.',
      );
    }
    const body = startGuestSchema.parse(request.body ?? {});
    if (!context.signupsOpen()) {
      throw new AppError(
        403,
        'NOT_AVAILABLE',
        'New visitors are not being let in right now. Try again later.',
      );
    }
    if (context.bot && !(await context.bot.verify(body.turnstileToken, request.ip))) {
      throw new AppError(
        403,
        'BOT_CHECK_FAILED',
        'We could not check that you are a person. Reload the page and try again.',
      );
    }
    if (!context.guests.allows(request.ip)) {
      context.ledger.recordBlocked('guest-rate-limited');
      context.auditOnce('public.guest.refused', 'guests', 'rate-limited', {}, 'anonymous');
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many new visitors have started from your network in the last hour. Wait a little while, then try again.',
      );
    }
    const user = context.users.createGuest();
    context.guests.record(request.ip);
    const created = context.repository.sessions.create(
      { id: user.id, tenantId: user.workspaceId, platformAdmin: false, bootstrapAdmin: false },
      context.lifetime,
    );
    context.audit('public.guest.start', user.id);
    const answer: StartedGuest = { started: true };
    return reply
      .header(
        'set-cookie',
        serializeCookie(context.sessionCookie, created.token, {
          maxAge: created.maxAgeSeconds,
          secure,
        }),
      )
      .headers(noStore)
      .send(answer);
  });

  app.post('/auth/start/:provider', limit, async (request, reply) => {
    // A change, so it carries the header that another site cannot make a browser send.
    if (request.headers[CSRF_HEADER] !== '1') {
      throw new AppError(
        403,
        'CSRF_REQUIRED',
        'Sign-in must be started from the Swarm page itself. Reload it and try again.',
      );
    }
    const parsed = providerParams.safeParse(request.params);
    const provider = parsed.success ? context.providers.get(parsed.data.provider) : undefined;
    if (!provider)
      throw new AppError(404, 'NOT_AVAILABLE', 'This way of signing in is not available.');
    const body = startSignInSchema.parse(request.body ?? {});
    if (context.bot && !(await context.bot.verify(body.turnstileToken, request.ip))) {
      throw new AppError(
        403,
        'BOT_CHECK_FAILED',
        'We could not check that you are a person. Reload the page and try again.',
      );
    }
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    const binding = randomToken();
    context.logins.create({
      state,
      binding,
      provider: provider.id,
      nonce,
      verifier,
      returnTo: safeReturnTo(body.returnTo),
    });
    const answer: StartedSignIn = {
      url: provider.authorizeUrl({ state, nonce, verifier, redirectUri: redirectUri(provider.id) }),
    };
    return reply
      .header(
        'set-cookie',
        serializeCookie(context.loginCookie, binding, { maxAge: LOGIN_MAX_AGE_SECONDS, secure }),
      )
      .headers(noStore)
      .send(answer);
  });

  app.get('/auth/callback/:provider', limit, async (request, reply) => {
    // Whatever goes wrong, the browser is sent back to the page, which says it did not work. Why it did not is for the
    // log (as a code), never for the person: it would be a clue to an attacker.
    const back = (problem: PublicSignInProblem, reason: string, actor?: string) => {
      request.log.warn({ reason }, 'Sign-in did not complete.');
      // A refusal of a sign-in that really started is evidence worth keeping; whatever else the internet sends is not.
      if (actor) context.audit('public.signin.refused', actor, { reason });
      return reply
        .header('set-cookie', clearLogin)
        .headers(noStore)
        .redirect(`/?signin=${problem}`, 302);
    };
    const params = providerParams.safeParse(request.params);
    const query = callbackQuery.safeParse(request.query);
    const binding = readCookie(request.headers.cookie, context.loginCookie);
    if (!params.success || !query.success || !query.data.state || !binding) {
      return back('failed', 'incomplete');
    }
    const provider = context.providers.get(params.data.provider);
    if (!provider) return back('failed', 'unknown-provider');
    // The attempt is spent here, once and whatever follows, so a reply cannot be tried twice.
    const attempt = context.logins.consume(query.data.state, binding, provider.id);
    if (!attempt) return back('failed', 'unknown-attempt');
    if (query.data.error || !query.data.code) return back('failed', 'refused', 'anonymous');

    let identity;
    try {
      identity = await provider.complete({
        code: query.data.code,
        verifier: attempt.verifier,
        nonce: attempt.nonce,
        redirectUri: redirectUri(provider.id),
      });
    } catch (error) {
      const reason = error instanceof SignInRefused ? error.reason : 'error';
      return back(reason === 'unverified-email' ? 'unverified' : 'failed', reason, 'anonymous');
    }

    let user = context.users.find(identity.provider, identity.subject);
    if (user) {
      if (user.disabled) return back('disabled', 'disabled', user.id);
      if (user.email !== identity.email) context.users.updateEmail(user.id, identity.email);
      context.users.touchLogin(user.id);
    } else {
      if (!context.signupsOpen()) return back('closed', 'signups-closed', 'anonymous');
      const domain = identity.email.slice(identity.email.lastIndexOf('@') + 1);
      if (pub.blockedEmailDomains.has(domain)) return back('blocked', 'email-domain', 'anonymous');
      if (!context.signups.allows(request.ip))
        return back('blocked', 'signup-throttled', 'anonymous');
      try {
        user = context.users.create({
          provider: identity.provider,
          subject: identity.subject,
          email: identity.email,
        });
        context.signups.record(request.ip);
        context.audit('public.signup', user.id, { provider: identity.provider });
      } catch (error) {
        // Two first sign-ins of the same person at once: one made the account, and this one signs in to it.
        user = context.users.find(identity.provider, identity.subject);
        if (!user) throw error;
      }
    }
    // A new session at every sign-in, so that an identifier planted beforehand is worth nothing.
    const created = context.repository.sessions.create(
      {
        id: user.id,
        tenantId: user.workspaceId,
        platformAdmin: context.isAdmin(user.email),
        bootstrapAdmin: false,
      },
      context.lifetime,
    );
    context.audit('public.signin', user.id, { provider: identity.provider });
    return reply
      .header('set-cookie', [
        serializeCookie(context.sessionCookie, created.token, {
          maxAge: created.maxAgeSeconds,
          secure,
        }),
        clearLogin,
      ])
      .headers(noStore)
      .redirect(attempt.returnTo, 302);
  });

  app.post('/auth/logout', limit, async (request, reply) => {
    if (request.headers[CSRF_HEADER] !== '1') {
      throw new AppError(
        403,
        'CSRF_REQUIRED',
        'Signing out must be done from the Swarm page itself. Reload it and try again.',
      );
    }
    const token = readCookie(request.headers.cookie, context.sessionCookie);
    if (token) {
      const found = context.repository.sessions.find(token, context.lifetime.idleMs);
      if (found) {
        context.audit('public.signout', found.principal.id);
        // Signing out forgets the key the server may be holding for this person's runs.
        context.keys.forget(found.principal.tenantId);
      }
      context.repository.sessions.revoke(token);
    }
    return reply
      .header('set-cookie', serializeCookie(context.sessionCookie, '', { maxAge: 0, secure }))
      .headers(noStore)
      .code(204)
      .send();
  });
}

/** The sign-in problems a page may be told about, for a test. */
export const SIGN_IN_PROBLEMS: readonly string[] = PUBLIC_SIGN_IN_PROBLEMS;
