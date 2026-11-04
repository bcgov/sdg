import { Module } from '@nestjs/common';

import { AdminTopicsController, TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';
import { AdminTypesController } from './types.controller.js';
import { TypesService } from './types.service.js';

/**
 * The admin-curated catalog (R13–R16): Notification types with their data contracts and delivery policies, platform
 * topics with their broadcast grants, and sender topics. Exports the services sends and subscriptions read.
 */
@Module({
  controllers: [AdminTypesController, AdminTopicsController, TopicsController],
  providers: [TypesService, TopicsService],
  exports: [TypesService, TopicsService],
})
export class CatalogModule {}
