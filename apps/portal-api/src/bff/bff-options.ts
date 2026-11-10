import { ConfigService } from '@nestjs/config';
import { bffOptionsFromEnv, type BffModuleAsyncOptions, type BffModuleOptions } from '@repo/bff-core/nestjs';

import type { Env } from '../config/env.js';
import { SESSION_COOKIE, SESSION_KEY_INFO } from './portal-session.js';

/** bff-core wired for the resident portal: the portal client, the `portal` login, and the portal audience. */
export function portalBffOptions(config: ConfigService<Env, true>): BffModuleOptions {
  return bffOptionsFromEnv((key) => config.get(key, { infer: true }), {
    cookieName: SESSION_COOKIE,
    keyInfo: SESSION_KEY_INFO,
    audiences: ['portal'],
  });
}

export const portalBff: BffModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: portalBffOptions,
};
