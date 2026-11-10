import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import type { OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import type { BffModuleAsyncOptions, BffModuleOptions } from '@repo/bff-core/nestjs';

import type { Env } from '../config/env.js';
import { notAuthorizedRefusal } from '../not-authorized/not-authorized.js';
import { SESSION_COOKIE, SESSION_KEY_INFO } from './admin-session.js';

/**
 * bff-core wired for administrators: the admin client, the `admin` login, the admin audience, and the not-authorized
 * page for a sign-in core-api refuses. `moduleRef` resolves bff-core's OIDC client when a refusal happens, since that
 * client is built from these options.
 */
export function adminBffOptions(config: ConfigService<Env, true>, moduleRef: ModuleRef): BffModuleOptions {
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
    audiences: ['admin'],
    onLoginRefused: notAuthorizedRefusal({
      appUrl: env('APP_URL'),
      oidc: () => moduleRef.get<OidcClient>(OIDC_CLIENT),
    }),
  };
}

export const adminBff: BffModuleAsyncOptions = {
  inject: [ConfigService, ModuleRef],
  useFactory: adminBffOptions,
};
