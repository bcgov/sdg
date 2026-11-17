import { Module } from '@nestjs/common';

import { MeController } from '../me/me.controller.js';
import { PeopleSearchService } from './people-search.service.js';
import { PeopleConsoleController } from './people.console.controller.js';
import { PrincipalsController } from './principals.controller.js';
import { PrincipalsService } from './principals.service.js';

@Module({
  controllers: [PrincipalsController, MeController, PeopleConsoleController],
  providers: [PrincipalsService, PeopleSearchService],
  exports: [PrincipalsService],
})
export class PrincipalsModule {}
