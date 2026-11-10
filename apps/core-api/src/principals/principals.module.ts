import { Module } from '@nestjs/common';

import { MeController } from '../me/me.controller.js';
import { PrincipalsController } from './principals.controller.js';
import { PrincipalsService } from './principals.service.js';

@Module({
  controllers: [PrincipalsController, MeController],
  providers: [PrincipalsService],
  exports: [PrincipalsService],
})
export class PrincipalsModule {}
