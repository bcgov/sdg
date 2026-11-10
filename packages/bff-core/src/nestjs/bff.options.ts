import type { CallbackResult, OidcClientOptions } from '@repo/auth';
import type { Audience } from '@repo/server-core/forwarding';

import type { LoginHook } from '../auth/core-api-login.js';

export interface BffSessionOptions {
  /** The session cookie, e.g. `portal.sid`; each BFF has its own. */
  readonly cookieName: string;
  /** SESSION_SECRET: signs the cookie and, through HKDF with `keyInfo`, keys the stored payload's encryption. */
  readonly secret: string;
  /** The HKDF info string (e.g. `portal-session-store`); each BFF has its own, so rows never decrypt across BFFs. */
  readonly keyInfo: string;
  /** Idle lifetime: the cookie's Max-Age and the row's expiry, extended as the user stays active. */
  readonly ttlSeconds: number;
}

/**
 * Where to send the browser when core-api refuses a sign-in (403). It runs after the pending session is ended and
 * before the redirect, so it can also end the Keycloak session (admin-api's not-authorized path).
 */
export type LoginRefusal = (login: CallbackResult) => Promise<string>;

export interface BffModuleOptions {
  /** The BFF's public base URL (APP_URL, no trailing slash): its origin, callback URL and error redirects. */
  readonly appUrl: string;
  /** Postgres URL of this BFF's own login; its `sessions` table lives in that login's schema. */
  readonly databaseUrl: string;
  readonly session: BffSessionOptions;
  /** This BFF's Keycloak client. The redirect URIs follow from `appUrl`. */
  readonly oidc: Omit<OidcClientOptions, 'redirectUri' | 'postLogoutRedirectUri'>;
  /** core-api's base URL (no trailing slash), for forwarding and the default `onLogin`. */
  readonly coreApiUrl: string;
  /** The audiences this BFF forwards (e.g. `['portal']`); `shared` is always forwarded too. */
  readonly audiences: readonly Audience[];
  /** Runs after the code exchange. Defaults to core-api's `/internal/principals/login` (`createCoreApiLogin`). */
  readonly onLogin?: LoginHook;
  /** Runs when `onLogin` is refused. Defaults to `<appUrl>/?authError=access_denied`. */
  readonly onLoginRefused?: LoginRefusal;
}

/** The resolved `BffModuleOptions`. */
export const BFF_OPTIONS: unique symbol = Symbol('BFF_OPTIONS');
/** The `pg` Pool of the BFF's login, ended on application shutdown. */
export const SESSION_POOL: unique symbol = Symbol('SESSION_POOL');
/** The Drizzle `SessionDatabase` over SESSION_POOL; inject it for a readiness check. Tests override it with PGlite. */
export const SESSION_DATABASE: unique symbol = Symbol('SESSION_DATABASE');
/** The express-session store (a `PostgresSessionStore`). */
export const SESSION_STORE: unique symbol = Symbol('SESSION_STORE');
/** The `LoginHook` in effect (`onLogin` or the core-api default). */
export const LOGIN_HOOK: unique symbol = Symbol('LOGIN_HOOK');

/** The OpenAPI security scheme name the auth and forwarded routes declare; register it with `addSessionCookieAuth`. */
export const SESSION_SECURITY_SCHEME = 'session';
