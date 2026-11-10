import { ConfigService } from '@nestjs/config';
import type { BffModuleAsyncOptions, BffModuleOptions } from '@repo/bff-core/nestjs';

import type { Env } from '../config/env.js';
import { SESSION_COOKIE, SESSION_KEY_INFO } from './portal-session.js';

/** bff-core wired for the resident portal: the portal client, the `portal` login, and the portal audience (R4). */
export function portalBffOptions(config: ConfigService<Env, true>): BffModuleOptions {
  const env = <K extends keyof Env>(key: K): Env[K] => config.get(key, { infer: true });
  return {
    appUrl: env('APP_URL'),
    databaseUrl: env('DATABASE_URL'),
    session: {
      cookieName: SESSION_COOKIE,
      secret: env('SESSION_SECRET'),
      keyInfo: SESSION_KEY_INFO,
      ttlSeconds: env('SESSION_TTL_SECONDS'),
    },
    oidc: {
      issuerUrl: env('KEYCLOAK_ISSUER_URL'),
      clientId: env('KEYCLOAK_CLIENT_ID'),
      clientSecret: env('KEYCLOAK_CLIENT_SECRET'),
    },
    coreApiUrl: env('CORE_API_URL'),
    audiences: ['portal'],
  };
}

export const portalBff: BffModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: portalBffOptions,
};
