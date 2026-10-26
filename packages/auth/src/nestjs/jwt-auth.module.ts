import { Module, type DynamicModule } from '@nestjs/common';

import { createJwtVerifier } from '../jwt-verifier.js';
import type { JwtVerifier, JwtVerifierOptions } from '../types.js';
import type { AsyncModuleOptions } from './async-options.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JWT_VERIFIER } from './tokens.js';

export type JwtAuthModuleAsyncOptions = AsyncModuleOptions<JwtVerifierOptions>;

/** Provides (and exports) `JWT_VERIFIER` and `JwtAuthGuard`. */
@Module({})
export class JwtAuthModule {
  static forRootAsync(options: JwtAuthModuleAsyncOptions): DynamicModule {
    return {
      module: JwtAuthModule,
      global: false,
      imports: options.imports ?? [],
      providers: [
        {
          provide: JWT_VERIFIER,
          inject: options.inject ?? [],
          useFactory: async (...args: never[]): Promise<JwtVerifier> =>
            createJwtVerifier(await options.useFactory(...args)),
        },
        JwtAuthGuard,
      ],
      exports: [JWT_VERIFIER, JwtAuthGuard],
    };
  }
}
