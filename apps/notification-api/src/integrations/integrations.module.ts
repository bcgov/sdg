import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { PLATFORM_INTEGRATIONS, platformIntegrations } from './platform-defaults.js';
import { IntegrationResolver } from './resolver.service.js';

/**
 * The per-attempt integration resolver (KTD9) and the platform defaults it falls back to (R46). No controllers, so
 * the worker role can import it for delivery.
 */
@Module({
  providers: [
    IntegrationResolver,
    {
      provide: PLATFORM_INTEGRATIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        platformIntegrations({
          DEFAULT_SMTP_HOST: config.get('DEFAULT_SMTP_HOST', { infer: true }),
          DEFAULT_SMTP_PORT: config.get('DEFAULT_SMTP_PORT', { infer: true }),
          DEFAULT_SMTP_SECURE: config.get('DEFAULT_SMTP_SECURE', { infer: true }),
          DEFAULT_SMTP_USER: config.get('DEFAULT_SMTP_USER', { infer: true }),
          DEFAULT_SMTP_PASSWORD: config.get('DEFAULT_SMTP_PASSWORD', { infer: true }),
          DEFAULT_SMTP_FROM: config.get('DEFAULT_SMTP_FROM', { infer: true }),
        }),
    },
  ],
  exports: [IntegrationResolver],
})
export class IntegrationsModule {}

/** Sender integration overrides (R47): the API role's endpoints. */
@Module({
  imports: [IntegrationsModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsApiModule {}
