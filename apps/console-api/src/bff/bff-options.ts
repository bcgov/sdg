import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import type { OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { bffOptionsFromEnv, type BffModuleAsyncOptions, type BffModuleOptions } from '@repo/bff-core/nestjs';

import type { Env } from '../config/env.js';
import { notAuthorizedRefusal } from '../not-authorized/not-authorized.js';
import { SESSION_COOKIE, SESSION_KEY_INFO } from './console-session.js';

/**
 * bff-core wired for the console: the console client, the `console` login, the console audience, and the not-authorized
 * page for a sign-in core-api refuses. `moduleRef` resolves bff-core's OIDC client when a refusal happens, since that
 * client is built from these options.
 */
export function consoleBffOptions(config: ConfigService<Env, true>, moduleRef: ModuleRef): BffModuleOptions {
  const options = bffOptionsFromEnv((key) => config.get(key, { infer: true }), {
    cookieName: SESSION_COOKIE,
    keyInfo: SESSION_KEY_INFO,
    audiences: ['console'],
  });
  return {
    ...options,
    onLoginRefused: notAuthorizedRefusal({
      appUrl: options.appUrl,
      oidc: () => moduleRef.get<OidcClient>(OIDC_CLIENT),
    }),
  };
}

export const consoleBff: BffModuleAsyncOptions = {
  inject: [ConfigService, ModuleRef],
  useFactory: consoleBffOptions,
};
