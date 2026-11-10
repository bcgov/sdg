import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createJwtVerifier, type AuthFetch, type JwtVerifier } from '@repo/auth';
import { JWT_VERIFIER } from '@repo/auth/nestjs';

import type { Env } from '../config/env.js';
import { AdminGuard, InternalGuard, PortalGuard, SharedGuard } from './audience.guards.js';
import type { KeycloakClients } from './caller.js';
import { acceptedClaims, KEYCLOAK_CLIENTS, PrincipalResolver } from './principal.resolver.js';
import { UserinfoClient } from './userinfo.client.js';

/** Injection token for the fetch used to reach Keycloak (discovery, JWKS, userinfo). Tests point it at a fake IdP. */
export const AUTH_FETCH: unique symbol = Symbol('AUTH_FETCH');

const issuerUrl = (config: ConfigService<Env, true>): string => config.get('KEYCLOAK_ISSUER_URL', { infer: true });

/**
 * Token verification and classification: one JWKS-backed verifier for the realm, accepting the portal client,
 * the admin client and service-account tokens; the resolver, the audience guards and the userinfo client. Global, so
 * every feature module's controllers can use the guards.
 */
@Global()
@Module({
  providers: [
    { provide: AUTH_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies AuthFetch },
    {
      provide: KEYCLOAK_CLIENTS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KeycloakClients => ({
        portal: config.get('PORTAL_CLIENT_ID', { infer: true }),
        admin: config.get('ADMIN_CLIENT_ID', { infer: true }),
      }),
    },
    {
      provide: JWT_VERIFIER,
      inject: [ConfigService, KEYCLOAK_CLIENTS, AUTH_FETCH],
      useFactory: (config: ConfigService<Env, true>, clients: KeycloakClients, fetchImpl: AuthFetch): JwtVerifier =>
        createJwtVerifier({ issuerUrl: issuerUrl(config), audience: acceptedClaims(clients), fetch: fetchImpl }),
    },
    {
      provide: UserinfoClient,
      inject: [ConfigService, AUTH_FETCH],
      useFactory: (config: ConfigService<Env, true>, fetchImpl: AuthFetch) =>
        new UserinfoClient(issuerUrl(config), fetchImpl),
    },
    PrincipalResolver,
    PortalGuard,
    AdminGuard,
    SharedGuard,
    InternalGuard,
  ],
  exports: [PrincipalResolver, UserinfoClient, PortalGuard, AdminGuard, SharedGuard, InternalGuard],
})
export class AuthModule {}
