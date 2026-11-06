import type { JWTVerifyGetKey } from 'jose';
import type { PublicProviderId } from '../../../shared/public.js';
import type { PublicGuard } from '../auth/guard.js';
import { cookieName } from '../auth/cookies.js';
import { SESSION_COOKIE } from '../auth/guard.js';
import type { ServerConfig } from '../config.js';
import type { Repository } from '../storage/repository.js';
import { asSystemView } from '../storage/system-view.js';
import type { PublicConfig } from './config.js';
import { createBotCheck, type BotCheck } from './bot.js';
import { buildProviders } from './identity/registry.js';
import type { IdentityProvider } from './identity/provider.js';
import { PublicLoginStore } from './storage/login.js';
import { PublicSettings } from './storage/settings.js';
import { SignupLog } from './storage/signups.js';
import { PublicUserStore } from './storage/users.js';

/** The name of the short-lived cookie that binds a sign-in to the browser that started it. */
export const LOGIN_COOKIE = 'swarm_login';

export interface PublicEditionOptions {
  /** Test hook: the `fetch` the identity providers use. The hosts are constants; nothing replaces a URL. */
  fetcher?: typeof fetch;
  /** Test hook: Google's signing keys, without the network. */
  googleKeys?: JWTVerifyGetKey;
  /** Test hook: the clock. */
  now?: () => number;
  /** Test hook: the `fetch` the bot check uses to reach Turnstile. */
  botFetcher?: typeof fetch;
  /** Test hook: wraps the guard, so that a test can take the application-level checks away and see what remains. */
  wrapGuard?: (guard: PublicGuard) => PublicGuard;
  /** Where the terms and privacy files are. Default `./legal`. */
  legalDirectory?: string;
}

/** What every part of the public edition shares. Made once, when the app is built. */
export interface PublicContext {
  config: ServerConfig;
  pub: PublicConfig;
  repository: Repository;
  users: PublicUserStore;
  logins: PublicLoginStore;
  settings: PublicSettings;
  signups: SignupLog;
  providers: ReadonlyMap<PublicProviderId, IdentityProvider>;
  /** Null unless both Turnstile keys are set. */
  bot: BotCheck | null;
  sessionCookie: string;
  loginCookie: string;
  lifetime: { idleMs: number; absoluteMs: number };
  now: () => number;
  options: PublicEditionOptions;
  /** Whether a verified address belongs to a platform administrator. */
  isAdmin(email: string): boolean;
  /** New accounts may be made: the environment says so, and so does the run-time switch. */
  signupsOpen(): boolean;
  /** Records a security event: an actor, a word and codes, never an address, a key or a document. */
  audit(
    action: string,
    actor: string,
    detail?: Record<string, string | number | boolean | null>,
  ): void;
}

export function createContext(
  config: ServerConfig,
  repository: Repository,
  options: PublicEditionOptions,
): PublicContext {
  const pub = config.public;
  if (!pub) throw new Error('The public edition was asked for without its settings.');
  const now = options.now ?? Date.now;
  const { users, logins, settings, signups } = repository.extend((database) => {
    // Their rows belong to no workspace and are looked up before anyone is known: the platform's database.
    const platform = asSystemView(database);
    return {
      users: new PublicUserStore(platform, {
        pepper: pub.pepper,
        retentionDays: pub.deletedAccountRetentionDays,
        now,
      }),
      logins: new PublicLoginStore(platform, now),
      settings: new PublicSettings(platform, now),
      signups: new SignupLog(platform, {
        pepper: pub.pepper,
        perIpPerDay: pub.signups.perIpPerDay,
        perHour: pub.signups.perHour,
        now,
      }),
    };
  });
  return {
    config,
    pub,
    repository,
    users,
    logins,
    settings,
    signups,
    providers: buildProviders(pub, {
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
      ...(options.googleKeys ? { googleKeys: options.googleKeys } : {}),
    }),
    bot: createBotCheck(pub, options.botFetcher),
    sessionCookie: cookieName(SESSION_COOKIE, pub.secureCookies),
    loginCookie: cookieName(LOGIN_COOKIE, pub.secureCookies),
    lifetime: {
      idleMs: pub.session.idleMinutes * 60_000,
      absoluteMs: pub.session.absoluteHours * 3_600_000,
    },
    now,
    options,
    isAdmin: (email) => pub.adminEmails.has(email.toLowerCase()),
    signupsOpen: () => pub.signupsEnabled && settings.flag('signups_enabled', true),
    audit(action, actor, detail = {}) {
      repository.audit.record({
        actor,
        action,
        targetType: 'public',
        targetId: action,
        detail,
      });
    },
  };
}
