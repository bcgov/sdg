import { Module } from '@nestjs/common';

import { PrincipalsModule } from '../principals/principals.module.js';
import { FeatureFlagOverridesConsoleController } from './feature-flag-overrides.console.controller.js';
import { FeatureFlagOverridesService } from './feature-flag-overrides.service.js';
import { FeatureFlagsConsoleController } from './feature-flags.console.controller.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { FeatureFlagsSharedController } from './feature-flags.shared.controller.js';
import { FlagEvaluationService } from './flag-evaluation.service.js';

/** Feature flags: their evaluation, the shared flag list and hello-world routes, and the console's management. */
@Module({
  imports: [PrincipalsModule],
  controllers: [FeatureFlagsSharedController, FeatureFlagsConsoleController, FeatureFlagOverridesConsoleController],
  providers: [FlagEvaluationService, FeatureFlagsService, FeatureFlagOverridesService],
})
export class FeatureFlagsModule {}
