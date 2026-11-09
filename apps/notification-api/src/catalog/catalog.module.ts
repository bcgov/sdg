import { Module } from '@nestjs/common';

import { AdminTopicsController, TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';
import { AdminTypesController } from './types.controller.js';
import { TypesService } from './types.service.js';

/**
 * The admin-curated catalog (R13–R16): Notification types with their data contracts and delivery policies, platform
 * topics with their broadcast grants, and sender topics. Exports the services sends and subscriptions read. No
 * controllers, so the worker role can import it (through recipients) without serving its routes.
 */
@Module({
  providers: [TypesService, TopicsService],
  exports: [TypesService, TopicsService],
})
export class CatalogModule {}

/** The catalog's admin and sender endpoints: the API role's. */
@Module({
  imports: [CatalogModule],
  controllers: [AdminTypesController, AdminTopicsController, TopicsController],
})
export class CatalogApiModule {}
