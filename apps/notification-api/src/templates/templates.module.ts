import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CatalogModule } from '../catalog/catalog.module.js';
import type { Env } from '../config/env.js';
import { AdminLayoutsController, AdminPartialsController } from './fragments.controller.js';
import { FragmentsService } from './fragments.service.js';
import { DEFAULT_TIME_ZONE, RenderService } from './render.service.js';
import { AdminTemplatesController } from './templates.controller.js';
import { VersionsService } from './versions.service.js';

/**
 * Pins templates at accept and renders them at delivery (KTD6, KTD7). No controllers, so the worker role can import
 * it for delivery.
 */
@Module({
  providers: [
    RenderService,
    {
      provide: DEFAULT_TIME_ZONE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('DEFAULT_TIMEZONE', { infer: true }),
    },
  ],
  exports: [RenderService, DEFAULT_TIME_ZONE],
})
export class TemplatesModule {}

/** The admin's templates, layouts and partials (R20–R25): the API role's endpoints. */
@Module({
  imports: [TemplatesModule, CatalogModule],
  controllers: [AdminTemplatesController, AdminLayoutsController, AdminPartialsController],
  providers: [VersionsService, FragmentsService],
})
export class TemplatesApiModule {}
