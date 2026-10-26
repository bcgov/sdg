import { Module, type DynamicModule } from '@nestjs/common';

import { createOidcClient } from '../oidc-client.js';
import type { OidcClient, OidcClientOptions } from '../types.js';
import type { AsyncModuleOptions } from './async-options.js';
import { OIDC_CLIENT } from './tokens.js';

export type OidcModuleAsyncOptions = AsyncModuleOptions<OidcClientOptions>;

/** Provides (and exports) `OIDC_CLIENT`. Not global: import it where the client is needed. */
@Module({})
export class OidcModule {
  static forRootAsync(options: OidcModuleAsyncOptions): DynamicModule {
    return {
      module: OidcModule,
      global: false,
      imports: options.imports ?? [],
      providers: [
        {
          provide: OIDC_CLIENT,
          inject: options.inject ?? [],
          useFactory: async (...args: never[]): Promise<OidcClient> =>
            createOidcClient(await options.useFactory(...args)),
        },
      ],
      exports: [OIDC_CLIENT],
    };
  }
}
