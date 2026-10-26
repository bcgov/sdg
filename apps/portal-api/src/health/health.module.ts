import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { AuthModule } from '../auth/auth.module.js';
import { HealthController } from './health.controller.js';
import { DependencyIndicators } from './indicators.js';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'pretty' }), AuthModule],
  controllers: [HealthController],
  providers: [DependencyIndicators],
})
export class HealthModule {}
