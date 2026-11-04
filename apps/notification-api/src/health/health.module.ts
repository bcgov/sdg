import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller.js';
import { DependencyIndicators, HTTP_FETCH } from './indicators.js';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'pretty' })],
  controllers: [HealthController],
  providers: [DependencyIndicators, { provide: HTTP_FETCH, useValue: globalThis.fetch.bind(globalThis) }],
})
export class HealthModule {}
