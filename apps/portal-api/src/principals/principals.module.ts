import { Module } from '@nestjs/common';

import { PrincipalsService } from './principals.service.js';

@Module({
  providers: [PrincipalsService],
  exports: [PrincipalsService],
})
export class PrincipalsModule {}
