import { type DynamicModule, Module, type ModuleMetadata, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createJwtVerifier, type JwtVerifier } from '@repo/auth';

import type { Env } from '../config/env.js';
import { HTTP_FETCH, type HttpFetch } from '../health/indicators.js';
import { AdminGuard } from './admin.guard.js';
import { CredentialGuard } from './credential.guard.js';
import {
  CREDENTIAL_DIRECTORY,
  InMemoryCredentialDirectory,
  InMemorySenderOwnership,
  SENDER_OWNERSHIP,
  type CredentialDirectory,
  type SenderOwnership,
} from './directories.js';
import { OwnerGuard } from './owner.guard.js';
import { NOTIFICATION_JWT_VERIFIER, PrincipalResolver, TOKEN_CLIENTS } from './principal.resolver.js';
import { RecipientGuard } from './recipient.guard.js';
import { acceptedAudience, type TokenClients } from './token-kind.js';

export interface AuthModuleOptions {
  /** Modules the lookups below depend on (e.g. the database). */
  readonly imports?: ModuleMetadata['imports'];
  /** Resolves linked credentials. Defaults to an empty in-memory directory: no client is a credential. */
  readonly credentialDirectory?: Type<CredentialDirectory>;
  /** Answers sender ownership. Defaults to an empty in-memory store: nobody owns a sender. */
  readonly senderOwnership?: Type<SenderOwnership>;
}

const GUARDS = [CredentialGuard, AdminGuard, OwnerGuard, RecipientGuard];

/**
 * Token verification and the four endpoint-class guards (KTD5). Global, so feature modules put the guards on their
 * controllers with `@UseGuards` without importing it. One verifier serves the one configured issuer.
 */
@Module({})
export class AuthModule {
  static register(options: AuthModuleOptions = {}): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        { provide: HTTP_FETCH, useValue: globalThis.fetch.bind(globalThis) },
        {
          provide: TOKEN_CLIENTS,
          useFactory: (config: ConfigService<Env, true>): TokenClients => ({
            ownClientId: config.get('NOTIFICATION_CLIENT_ID', { infer: true }),
            relayingClientIds: config.get('RELAYING_CLIENT_IDS', { infer: true }),
          }),
          inject: [ConfigService],
        },
        { provide: CREDENTIAL_DIRECTORY, useClass: options.credentialDirectory ?? InMemoryCredentialDirectory },
        { provide: SENDER_OWNERSHIP, useClass: options.senderOwnership ?? InMemorySenderOwnership },
        {
          provide: NOTIFICATION_JWT_VERIFIER,
          useFactory: (
            config: ConfigService<Env, true>,
            clients: TokenClients,
            credentials: CredentialDirectory,
            fetch: HttpFetch,
          ): JwtVerifier =>
            createJwtVerifier({
              issuerUrl: config.get('KEYCLOAK_ISSUER_URL', { infer: true }),
              audience: acceptedAudience(clients, credentials),
              fetch,
            }),
          inject: [ConfigService, TOKEN_CLIENTS, CREDENTIAL_DIRECTORY, HTTP_FETCH],
        },
        PrincipalResolver,
        ...GUARDS,
      ],
      exports: [PrincipalResolver, TOKEN_CLIENTS, CREDENTIAL_DIRECTORY, SENDER_OWNERSHIP, ...GUARDS],
    };
  }
}
