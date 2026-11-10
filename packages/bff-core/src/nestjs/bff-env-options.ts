import type { Audience } from '@repo/server-core/forwarding';

import type { BffEnv } from '../env.js';
import type { BffModuleOptions } from './bff.options.js';

/** What sets one BFF apart from another: its cookie, its session encryption key info and its audiences. */
export interface BffIdentity {
  readonly cookieName: string;
  readonly keyInfo: string;
  readonly audiences: readonly Audience[];
}

/**
 * `BffModuleOptions` from the settings `bffEnvShape` validates, read through `env` (typically
 * `(key) => config.get(key, { infer: true })`). Spread the result to add hooks such as `onLoginRefused`.
 */
export function bffOptionsFromEnv(
  env: <K extends keyof BffEnv>(key: K) => BffEnv[K],
  identity: BffIdentity,
): BffModuleOptions {
  return {
    appUrl: env('APP_URL'),
    databaseUrl: env('DATABASE_URL'),
    session: {
      cookieName: identity.cookieName,
      secret: env('SESSION_SECRET'),
      keyInfo: identity.keyInfo,
      ttlSeconds: env('SESSION_TTL_SECONDS'),
    },
    oidc: {
      issuerUrl: env('KEYCLOAK_ISSUER_URL'),
      clientId: env('KEYCLOAK_CLIENT_ID'),
      clientSecret: env('KEYCLOAK_CLIENT_SECRET'),
    },
    coreApiUrl: env('CORE_API_URL'),
    audiences: identity.audiences,
  };
}
