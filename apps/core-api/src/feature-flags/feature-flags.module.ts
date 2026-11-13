import { Module } from '@nestjs/common';

import { PrincipalsModule } from '../principals/principals.module.js';
import { FeatureFlagsSharedController } from './feature-flags.shared.controller.js';
import { FlagEvaluationService } from './flag-evaluation.service.js';

/** Feature flags: their evaluation, and the shared flag list and hello-world routes. */
@Module({
  imports: [PrincipalsModule],
  controllers: [FeatureFlagsSharedController],
  providers: [FlagEvaluationService],
})
export class FeatureFlagsModule {}
