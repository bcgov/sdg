import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OidcModule } from '@repo/auth/nestjs';

import type { Env } from '../config/env.js';
import { PrincipalsModule } from '../principals/principals.module.js';
import { AuthController } from './auth.controller.js';
import { SessionAuthGuard } from './session-auth.guard.js';

const oidcModule = OidcModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => {
    const appUrl = config.get('APP_URL', { infer: true });
    return {
      issuerUrl: config.get('KEYCLOAK_ISSUER_URL', { infer: true }),
      clientId: config.get('KEYCLOAK_CLIENT_ID', { infer: true }),
      clientSecret: config.get('KEYCLOAK_CLIENT_SECRET', { infer: true }),
      redirectUri: `${appUrl}/api/auth/callback`,
      postLogoutRedirectUri: `${appUrl}/`,
    };
  },
});

@Module({
  imports: [oidcModule, PrincipalsModule],
  controllers: [AuthController],
  providers: [SessionAuthGuard],
  exports: [oidcModule],
})
export class AuthModule {}
