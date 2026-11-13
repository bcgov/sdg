import { ConfigService } from '@nestjs/config';
import { bffOptionsFromEnv, type BffModuleAsyncOptions, type BffModuleOptions } from '@repo/bff-core/nestjs';

import type { Env } from '../config/env.js';
import { SESSION_COOKIE, SESSION_KEY_INFO } from './portal-session.js';

/**
 * The public flag list and hello-world demo (KTD1): core-api evaluates them for signed-out visitors too, so a
 * signed-out GET is forwarded with no token instead of 401 (KTD2).
 */
export const OPTIONAL_SESSION_PATHS = ['/api/v1/shared/flags', '/api/v1/shared/hello-world'] as const;

/**
 * bff-core wired for the resident portal: the portal client, the `portal` login, the portal audience, and the
 * paths a signed-out visitor may call.
 */
export function portalBffOptions(config: ConfigService<Env, true>): BffModuleOptions {
  return {
    ...bffOptionsFromEnv((key) => config.get(key, { infer: true }), {
      cookieName: SESSION_COOKIE,
      keyInfo: SESSION_KEY_INFO,
      audiences: ['portal'],
    }),
    optionalSessionPaths: OPTIONAL_SESSION_PATHS,
  };
}

export const portalBff: BffModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: portalBffOptions,
};
